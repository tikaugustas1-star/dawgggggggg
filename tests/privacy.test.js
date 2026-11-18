// GDPR features: terms acceptance at sign-up, data export, account deletion with order anonymisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../server/env.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';

test('register requires terms; export and delete own data', async (t) => {
  const db = openDb(':memory:');
  const app = await createApp({ db });
  db.prepare('UPDATE stores SET hours_json = ?').run(JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, ['00:00', '00:00']]))));
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, headers: r.headers, body: await r.json() };
  };
  const acct = { email: 'ona@example.com', name: 'Ona', phone: '+37061234567', password: 'labai-slapta-1' };

  assert.equal((await call('POST', '/api/auth/register', acct)).status, 400, 'terms must be accepted');
  assert.equal((await call('POST', '/api/auth/register', { ...acct, acceptTerms: true })).status, 201);
  assert.ok(db.prepare('SELECT terms_accepted_at FROM users WHERE email = ?').get(acct.email).terms_accepted_at);

  const fries = db.prepare(`SELECT id FROM items WHERE name = 'Bulvytės'`).get().id;
  const size = db.prepare('SELECT o.id FROM options o JOIN option_groups g ON g.id = o.group_id WHERE g.item_id = ? AND o.is_default = 1').get(fries).id;
  const ord = await call('POST', '/api/orders', { storeId: 1, lines: [{ itemId: fries, qty: 6, optionIds: [size], note: 'be druskos' }],
    customerName: 'Ona', phone: acct.phone, paymentMethod: 'cash', fulfillment: 'delivery', address: 'Gedimino pr. 1, Vilnius', notes: 'durų kodas 123' });
  assert.equal(ord.status, 201);

  const exp = await call('GET', '/api/me/export');
  assert.match(exp.headers.get('content-disposition'), /attachment/);
  assert.equal(exp.body.account.email, acct.email);
  assert.equal(exp.body.account.password_hash, undefined, 'never export the hash');
  assert.equal(exp.body.orders.length, 1);

  // active order blocks deletion; wrong password is rejected
  assert.equal((await call('POST', '/api/me/delete', { password: acct.password })).status, 409);
  db.prepare(`UPDATE orders SET status = 'completed'`).run();
  assert.equal((await call('POST', '/api/me/delete', { password: 'neteisingas' })).status, 401);
  assert.equal((await call('POST', '/api/me/delete', { password: acct.password })).status, 200);

  assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get(acct.email).n, 0);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(ord.body.order.id);
  assert.deepEqual([o.user_id, o.customer_phone, o.address, o.notes], [null, '', null, null], 'contact details anonymised');
  assert.equal(o.total_cents, ord.body.order.total, 'amounts kept for accounting');
  assert.equal(db.prepare('SELECT note FROM order_items WHERE order_id = ?').get(o.id).note, null);
  assert.equal((await call('GET', '/api/me')).body.user, null, 'session ended');
});
