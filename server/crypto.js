// Field-level encryption for personal data at rest (emails, names, phones, addresses, notes).
// A stolen database file is useless without DATA_ENCRYPTION_KEY, which lives only in the host's environment.
//   enc()/dec(): AES-256-GCM (authenticated), random 96-bit IV per value.
//   blind():     HMAC-SHA256 "blind index" so we can look up by email/phone without storing them in clear.
import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';
let encKey = null; let macKey = null;

function keys() {
  if (encKey) return;
  let secret = process.env.DATA_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATA_ENCRYPTION_KEY (>= 32 chars) must be set in production. Refusing to start without encryption at rest.');
    }
    secret = 'dev-only-insecure-key-do-not-use-in-production!!'; // local development / tests only
  }
  // derive independent keys for encryption and indexing
  encKey = Buffer.from(crypto.hkdfSync('sha256', secret, 'food-order', 'enc', 32));
  macKey = Buffer.from(crypto.hkdfSync('sha256', secret, 'food-order', 'mac', 32));
}

export const isEnc = (v) => typeof v === 'string' && v.startsWith(PREFIX);

export function enc(plain) {
  if (plain == null || plain === '' || isEnc(plain)) return plain;
  keys();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

/** Decrypts; values written before encryption existed (legacy plaintext) pass through unchanged. */
export function dec(v) {
  if (!isEnc(v)) return v;
  keys();
  try {
    const raw = Buffer.from(v.slice(PREFIX.length), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', encKey, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch { return null; } // tampered or wrong key: never leak ciphertext
}

export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const normPhone = (p) => String(p || '').replace(/[^\d+]/g, '');

export function blind(kind, value) {
  if (!value) return null;
  keys();
  return crypto.createHmac('sha256', macKey).update(`${kind}:${value}`).digest('hex');
}

/** One-time upgrade of rows written before encryption: encrypts PII in place. Idempotent. */
export function encryptLegacyRows(db) {
  const users = db.prepare("SELECT id, email, name, phone FROM users WHERE email LIKE '%@%'").all();
  const ord = db.prepare("SELECT id, customer_name, customer_phone, address, notes FROM orders WHERE (customer_name NOT LIKE 'enc:%') OR (address IS NOT NULL AND address NOT LIKE 'enc:%') OR (notes IS NOT NULL AND notes NOT LIKE 'enc:%') OR (customer_phone != '' AND customer_phone NOT LIKE 'enc:%') OR lat IS NOT NULL").all();
  if (!users.length && !ord.length) return 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const u = db.prepare('UPDATE users SET email = ?, email_enc = ?, name = ?, phone = ? WHERE id = ?');
    for (const r of users) u.run(blind('email', normEmail(r.email)), enc(normEmail(r.email)), enc(r.name), enc(r.phone), r.id);
    const o = db.prepare('UPDATE orders SET customer_name = ?, customer_phone = ?, phone_hash = COALESCE(phone_hash, ?), address = ?, notes = ?, lat = NULL, lng = NULL WHERE id = ?');
    for (const r of ord) {
      const phone = dec(r.customer_phone);
      o.run(enc(r.customer_name), enc(r.customer_phone), phone ? blind('phone', normPhone(phone)) : null, enc(r.address), enc(r.notes), r.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return users.length + ord.length;
}
