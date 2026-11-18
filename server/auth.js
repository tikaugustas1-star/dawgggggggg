import crypto from 'node:crypto';

const SESSION_DAYS = 30;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim()).filter(Boolean).map((c) => {
    const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
  }));
}

export function createSession(db, userId, res, secure) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,?)').run(token, userId, expires);
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}

export function destroySession(db, req, res) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

export function sessionMiddleware(db) {
  const q = db.prepare(`SELECT u.id, u.email, u.name, u.phone, u.role, u.points FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`);
  return (req, _res, next) => {
    const sid = parseCookies(req.headers.cookie).sid;
    req.user = sid ? q.get(sid, Date.now()) || null : null;
    next();
  };
}

export const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Prisijunkite' }));
export const requireRole = (...roles) => (req, res, next) =>
  req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Nėra teisių' });

// Tiny fixed-window limiter for auth endpoints.
export function rateLimit({ windowMs = 60000, max = 10 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const k = `${req.ip}:${req.path}`; const now = Date.now();
    if (hits.size > 5000) for (const [key, v] of hits) if (now - v.t > windowMs) hits.delete(key); // bounded memory
    const h = hits.get(k);
    if (!h || now - h.t > windowMs) hits.set(k, { t: now, n: 1 });
    else if (++h.n > max) return res.status(429).json({ error: 'Per daug bandymų, palaukite minutę' });
    next();
  };
}
