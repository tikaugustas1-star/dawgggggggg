// Attack tests: each one tries something an attacker would and checks it fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../server/env.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { enc, dec, blind, encryptLegacyRows } from '../server/crypto.js';
import { passwordProblem, hashPassword } from '../server/auth.js';
import { safeNext } from '../web/src/lib/safe.js';

process.env.PAYMENTS_DEMO = '1';

async function boot(t) {
  const db = openDb(':memory:');
  const app = await createApp({ db });
  db.prepare('UPDATE stores SET hours_json = ?').run(JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, ['00:00', '00:00']]))));
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const jars = {};
  const call = async (method, url, body, { who = 'anon', headers = {}, raw } = {}) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '', ...headers },
      body: ['GET', 'HEAD'].includes(method) ? undefined : raw ?? (body ? JSON.stringify(body) : undefined) });
    const sc = r.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
    let json = null; try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, headers: r.headers, body: json };
  };
  const fries = db.prepare(`SELECT id FROM items WHERE name = 'Bulvytės'`).get().id;
  const size = db.prepare('SELECT o.id FROM options o JOIN option_groups g ON g.id = o.group_id WHERE g.item_id = ? AND o.is_default = 1').get(fries).id;
  return { db, call, jars, base, lines: [{ itemId: fries, qty: 6, optionIds: [size] }] };
}
const CUST = () => ({ email: process.env.CUSTOMER_EMAIL, password: process.env.CUSTOMER_PASSWORD });

test('security headers on pages and API', async (t) => {
  const { call } = await boot(t);
  const r = await call('GET', '/api/brand');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'(;|$)/, 'no inline/eval scripts');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null, 'no framework fingerprint');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
  const bad = await call('POST', '/api/auth/login', null, { raw: '{"email": ' });
  assert.equal(bad.status, 400); assert.ok(bad.body?.error, 'malformed JSON gets a JSON error, no stack trace');
});

test('CSRF: cross-site requests are rejected', async (t) => {
  const { call, base } = await boot(t);
  assert.equal((await call('POST', '/api/auth/login', CUST(), { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('POST', '/api/auth/login', CUST(), { headers: { Origin: 'http://localhost' } })).status, 403, 'other port = other origin');
  assert.equal((await call('POST', '/api/orders', {}, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const same = await call('POST', '/api/auth/login', CUST(), { headers: { Origin: base } });
  assert.notEqual(same.status, 403, 'same-origin requests still work');
});

test('personal data is encrypted at rest; sessions are stored hashed', async (t) => {
  const { db, call, jars, lines } = await boot(t);
  const secret = { email: 'ruta.slapta@example.com', name: 'Rūta Slaptoji', phone: '+37069998877', password: 'Ilgas-Slaptazodis-42', acceptTerms: true };
  assert.equal((await call('POST', '/api/auth/register', secret, { who: 'ruta' })).status, 201);
  const o = await call('POST', '/api/orders', { storeId: 1, lines, customerName: secret.name, phone: secret.phone, paymentMethod: 'cash',
    fulfillment: 'delivery', address: 'Slaptoji g. 7-3, Vilnius', notes: 'kodas 4455', lat: 54.69, lng: 25.27 }, { who: 'ruta' });
  assert.equal(o.status, 201);

  // dump every table and look for any of the secrets in clear text
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name);
  const dump = JSON.stringify(tables.map((tb) => db.prepare(`SELECT * FROM ${tb}`).all()));
  for (const needle of ['ruta.slapta@example.com', 'Rūta Slaptoji', '69998877', 'Slaptoji g.', 'kodas 4455', secret.password]) {
    assert.ok(!dump.includes(needle), `"${needle}" must not appear in the database`);
  }
  const row = db.prepare('SELECT lat, lng FROM orders WHERE id = ?').get(o.body.order.id);
  assert.deepEqual([row.lat, row.lng], [null, null], 'GPS coordinates are not stored');
  const token = jars.ruta.split('=')[1];
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token = ?').get(token).n, 0, 'raw session token is never stored');

  // the app itself still sees the real values
  const me = await call('GET', '/api/me', null, { who: 'ruta' });
  assert.equal(me.body.user.email, secret.email);
  assert.equal(me.body.user.phone, secret.phone);
  assert.equal((await call('GET', `/api/orders/${o.body.order.token}`)).body.address, 'Slaptoji g. 7-3, Vilnius');
});

test('ciphertext is authenticated; legacy plaintext gets encrypted', async (t) => {
  const c = enc('labas@example.com');
  assert.equal(dec(c), 'labas@example.com');
  assert.notEqual(enc('x'), enc('x'), 'random IV: equal values encrypt differently');
  const flipped = c.slice(0, -2) + (c.endsWith('A') ? 'B' : 'A') + c.slice(-1);
  assert.equal(dec(flipped), null, 'tampered ciphertext is rejected, never half-decrypted');

  const { db, call } = await boot(t);
  db.prepare(`INSERT INTO users(email, name, phone, password_hash) VALUES('senas@example.com', 'Senas Vartotojas', '+37061111111', ?)`).run(hashPassword('Senas-Slaptazodis-9'));
  encryptLegacyRows(db);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(blind('email', 'senas@example.com'));
  assert.ok(u && u.email_enc.startsWith('enc:v1:') && u.name.startsWith('enc:v1:'));
  assert.equal((await call('POST', '/api/auth/login', { email: 'senas@example.com', password: 'Senas-Slaptazodis-9' })).status, 200, 'migrated user can still log in');
});

test('login: no user enumeration, lockout after 5 failures, old hashes upgraded', async (t) => {
  const { db, call } = await boot(t);
  const unknown = await call('POST', '/api/auth/login', { email: 'nera@example.com', password: 'kazkas-blogo-1' });
  const wrong = await call('POST', '/api/auth/login', { email: CUST().email, password: 'kazkas-blogo-1' });
  assert.deepEqual([unknown.status, unknown.body], [wrong.status, wrong.body], 'same answer for unknown email and wrong password');

  const victim = { email: 'auka@example.com', name: 'Auka', password: 'Teisingas-Slaptazodis-1', acceptTerms: true };
  await call('POST', '/api/auth/register', victim, { who: 'v' });
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { email: victim.email, password: `bandymas-${i}-xx` }, { headers: { 'X-Forwarded-For': `10.0.0.${i}` } });
  const locked = await call('POST', '/api/auth/login', { email: victim.email, password: victim.password });
  assert.equal(locked.status, 429, 'correct password is refused while locked (guessing from many IPs does not help)');

  // legacy hash format (weaker params) is transparently upgraded on next successful login
  const legacyPw = 'Legacy-Password-77';
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const crypto = await import('node:crypto');
  const legacy = `scrypt$${salt.toString('hex')}$${crypto.scryptSync(legacyPw, salt, 64).toString('hex')}`;
  db.prepare(`INSERT INTO users(email, email_enc, name, password_hash) VALUES(?, ?, 'L', ?)`).run(blind('email', 'legacy@example.com'), enc('legacy@example.com'), legacy);
  assert.equal((await call('POST', '/api/auth/login', { email: 'legacy@example.com', password: legacyPw })).status, 200);
  assert.match(db.prepare('SELECT password_hash FROM users WHERE email = ?').get(blind('email', 'legacy@example.com')).password_hash, /^scrypt\$32768\$8\$1\$/);
});

test('weak passwords are refused', () => {
  for (const pw of ['short1', 'password123', '1234567890', 'aaaaaaaaaaaa', 'x'.repeat(200)]) assert.ok(passwordProblem(pw), pw.slice(0, 20));
  assert.ok(passwordProblem('jonas.petraitis-2026', 'jonas.petraitis@example.com'), 'contains the email name');
  assert.equal(passwordProblem('Skanus-Burgeris-77', 'ona@example.com'), null);
});

test('injection and tampering attempts fail', async (t) => {
  const { db, call, lines } = await boot(t);
  assert.equal((await call('POST', '/api/auth/login', { email: "' OR 1=1 --", password: "' OR '1'='1" })).status, 401);
  const q = await call('POST', '/api/cart/quote', { storeId: 1, lines, promoCode: "SVEIKI10' OR '1'='1" });
  assert.equal(q.body.promo.ok, false, 'SQL in promo code is just an unknown code');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM items').get().n > 0, true, 'tables intact');

  const cheap = await call('POST', '/api/cart/quote', { storeId: 1, lines: [{ ...lines[0], price: 1, unit: 1, total: 1 }] });
  assert.ok(cheap.body.totals.subtotal > 600, 'client-sent prices are ignored');
  for (const qty of [-1, 0, 1000, 1.5]) assert.equal((await call('POST', '/api/cart/quote', { storeId: 1, lines: [{ ...lines[0], qty }] })).status, 400, `qty ${qty}`);
  const bigTip = await call('POST', '/api/cart/quote', { storeId: 1, lines, tipPercent: 10000 });
  assert.ok(bigTip.body.totals.tip <= Math.round(bigTip.body.totals.subtotal * 0.3), 'tip is capped');
  const xss = '<img src=x onerror=alert(1)>';
  const ord = await call('POST', '/api/orders', { storeId: 1, lines, customerName: xss, phone: '+37060000009', paymentMethod: 'cash', notes: xss });
  assert.equal(ord.status, 201);
  assert.equal(ord.body.order.customerName, xss, 'stored as inert text (React escapes it when rendering)');
});

test('authorization: roles, ownership, demo payments, admin input', async (t) => {
  const { db, call, lines } = await boot(t);
  await call('POST', '/api/auth/login', CUST(), { who: 'cust' });
  for (const [m, u] of [['GET', '/api/kitchen/1/orders'], ['GET', '/api/admin/stats'], ['POST', '/api/kitchen/1/pause'], ['PATCH', '/api/admin/items/1']]) {
    assert.equal((await call(m, u, {}, { who: 'cust' })).status, 403, `customer → ${u}`);
  }
  assert.equal((await call('GET', '/api/me/export')).status, 401, 'guest cannot export');
  assert.equal((await call('POST', '/api/me/delete', { password: 'x' })).status, 401, 'guest cannot delete');

  // someone else's order: cannot reorder it; guessing tokens fails
  const other = await call('POST', '/api/orders', { storeId: 1, lines, customerName: 'Kitas', phone: '+37060000010', paymentMethod: 'cash' });
  db.prepare('UPDATE orders SET user_id = (SELECT id FROM users WHERE role = ?) WHERE id = ?').run('admin', other.body.order.id);
  assert.equal((await call('POST', `/api/me/orders/${other.body.order.id}/reorder`, {}, { who: 'cust' })).status, 404);
  assert.equal((await call('GET', '/api/orders/AAAAAAAAAAAAAAAAAAAAAAAA')).status, 404);

  // demo card payment must never look like real money in the kitchen
  const card = await call('POST', '/api/orders', { storeId: 1, lines, customerName: 'Demo', phone: '+37060000011', paymentMethod: 'card' });
  const paid = await call('POST', `/api/orders/${card.body.order.token}/demo-pay`);
  assert.equal(paid.body.paymentStatus, 'demo');
  assert.equal((await call('POST', `/api/orders/${card.body.order.token}/demo-pay`)).status, 400, 'cannot pay twice');

  await call('POST', '/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }, { who: 'adm' });
  for (const image of ['javascript:alert(1)', 'http://plain.example/x.jpg', 'https://ok.example/"onerror="x']) {
    assert.equal((await call('PATCH', '/api/admin/items/1', { image }, { who: 'adm' })).status, 400, image);
  }
  assert.equal((await call('PATCH', '/api/admin/items/1', { image: 'https://images.unsplash.com/photo-1?w=1' }, { who: 'adm' })).status, 200);
});

test('open redirect guard', () => {
  for (const ok of ['/cart', '/admin', '/orders?x=1']) assert.equal(safeNext(ok), ok);
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/a"><script>', null, 42]) assert.equal(safeNext(bad), null, String(bad));
});

test('order flooding is rate limited', async (t) => {
  const { call, lines } = await boot(t);
  let limited = false;
  for (let i = 0; i < 25 && !limited; i++) {
    const r = await call('POST', '/api/orders', { storeId: 1, lines, customerName: 'Spam', phone: `+3706000${String(i).padStart(4, '0')}`, paymentMethod: 'cash' });
    if (r.status === 429) limited = true;
  }
  assert.ok(limited, 'more than 20 orders in 10 minutes from one IP are refused');
});
