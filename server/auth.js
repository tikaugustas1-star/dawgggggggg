import crypto from 'node:crypto';
import { dec } from './crypto.js';

const SESSION_DAYS = 30;
// scrypt cost: N=2^15 (~32 MB, ~60 ms) — expensive for offline cracking, fine for a login.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
const scrypt = (pw, salt, o) => crypto.scryptSync(pw, salt, o.keylen, { N: o.N, r: o.r, p: o.p, maxmem: 128 * o.N * o.r * 2 });

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${scrypt(pw, salt, SCRYPT).toString('hex')}`;
}

/** Constant-time verify. Supports the legacy format `scrypt$salt$hash` (N=16384). */
export function verifyPassword(pw, stored) {
  const parts = String(stored).split('$');
  let o; let saltHex; let hashHex;
  if (parts.length === 6) { o = { N: +parts[1], r: +parts[2], p: +parts[3], keylen: 64 }; [,,,, saltHex, hashHex] = parts; }
  else if (parts.length === 3) { o = { N: 16384, r: 8, p: 1, keylen: 64 }; [, saltHex, hashHex] = parts; }
  else return false;
  if (!saltHex || !hashHex || o.N > 1 << 17) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = scrypt(String(pw), Buffer.from(saltHex, 'hex'), { ...o, keylen: want.length });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
export const needsRehash = (stored) => !String(stored).startsWith(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$`);

// Burn the same time for unknown accounts, so response timing doesn't reveal which emails are registered.
const DUMMY = hashPassword(crypto.randomBytes(16).toString('hex'));
export const verifyDummy = (pw) => { verifyPassword(pw, DUMMY); return false; };

const COMMON = new Set(['password', 'password1', 'password123', 'qwerty123', 'qwertyuiop', '1234567890', '123456789', '12345678', '1q2w3e4r5t',
  'slaptazodis', 'slaptažodis', 'labas123', 'lietuva123', 'iloveyou', 'admin123', 'welcome1', 'letmein123', 'abc12345', 'football', 'sunshine1']);
/** Returns an error message or null. */
export function passwordProblem(pw, email = '') {
  if (pw.length < 10) return 'Slaptažodis turi būti bent 10 simbolių';
  if (pw.length > 128) return 'Slaptažodis per ilgas (daugiausia 128 simboliai)';
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw) || /^\d+$/.test(pw)) return 'Slaptažodis per lengvai atspėjamas';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && low.includes(local)) return 'Slaptažodyje neturi būti el. pašto vardo';
  return null;
}

export function parseCookies(header = '') {
  const out = {};
  for (const c of header.split(';')) {
    const i = c.indexOf('='); if (i < 1) continue;
    try { out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); } catch { /* malformed cookie: ignore */ }
  }
  return out;
}

// Only a SHA-256 of the session token is stored: a leaked database can't be used to log in as anyone.
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const cookieName = (secure) => (secure ? '__Host-sid' : 'sid'); // __Host- = Secure, Path=/, no Domain: can't be planted by subdomains

export function createSession(db, userId, res, secure) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,?)').run(tokenHash(token), userId, expires);
  res.setHeader('Set-Cookie', `${cookieName(secure)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}

export function clearCookie(res, secure) {
  res.setHeader('Set-Cookie', `${cookieName(secure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
}

export function destroySession(db, req, res, secure) {
  const sid = parseCookies(req.headers.cookie)[cookieName(secure)];
  if (sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash(sid));
  clearCookie(res, secure);
}

export const endAllSessions = (db, userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

export function sessionMiddleware(db, secure) {
  const q = db.prepare(`SELECT u.id, u.email_enc, u.name, u.phone, u.role, u.points FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`);
  const name = cookieName(secure);
  return (req, _res, next) => {
    const sid = parseCookies(req.headers.cookie)[name];
    const row = sid && sid.length < 100 ? q.get(tokenHash(sid), Date.now()) : null;
    req.user = row ? { id: row.id, email: dec(row.email_enc), name: dec(row.name), phone: dec(row.phone), role: row.role, points: row.points } : null;
    next();
  };
}

export const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Prisijunkite' }));
export const requireRole = (...roles) => (req, res, next) =>
  req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Nėra teisių' });

/** Fixed-window limiter. `key` picks the bucket (default: client IP + route). Memory is swept, so it can't grow forever. */
export function rateLimit({ windowMs = 60000, max = 10, key = (req) => `${req.ip}:${req.baseUrl}${req.route?.path || req.path}`, message = 'Per daug bandymų, palaukite' } = {}) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now - v.t > windowMs) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req); const now = Date.now();
    const h = hits.get(k);
    if (!h || now - h.t > windowMs) hits.set(k, { t: now, n: 1 });
    else if (++h.n > max) {
      res.setHeader('Retry-After', Math.ceil((h.t + windowMs - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

export const LOCKOUT = { maxFailures: 5, minutes: 15 };
