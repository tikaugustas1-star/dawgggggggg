// Regression tests for fixed bugs.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../server/env.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';

process.env.STRIPE_SECRET_KEY = '';
process.env.PAYMENTS_DEMO = '1';

async function setup(t) {
  const db = openDb(':memory:');
  const app = await createApp({ db });
  db.prepare('UPDATE stores SET hours_json = ?').run(JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, ['00:00', '00:00']]))));
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const fries = db.prepare(`SELECT id FROM items WHERE name = 'Bulvytės'`).get().id;
  const size = db.prepare(`SELECT o.id FROM options o JOIN option_groups g ON g.id = o.group_id WHERE g.item_id = ? AND o.is_default = 1`).get(fries).id;
  return { db, call, lines: [{ itemId: fries, qty: 6, optionIds: [size] }] }; // stays above the 8 € minimum even with the fries deal
}

test('promo usage limit is enforced at placement, not only at quote time', async (t) => {
  const { db, call, lines } = await setup(t);
  db.prepare(`INSERT INTO promos(code, kind, value, max_uses) VALUES('VIENAS', 'fixed', 100, 1)`).run();
  const mk = (phone) => call('POST', '/api/orders', { storeId: 1, lines, customerName: 'Testas', phone, paymentMethod: 'card', promoCode: 'VIENAS' });
  const a = await mk('+37060000001'); const b = await mk('+37060000002'); // both pass the quote check
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal((await call('POST', `/api/orders/${a.body.order.token}/demo-pay`)).body.status, 'placed');
  const second = await call('POST', `/api/orders/${b.body.order.token}/demo-pay`);
  assert.equal(second.body.status, 'cancelled');
  assert.equal(second.body.paymentStatus, 'demo', 'demo payment stays labelled demo (no real money to refund)');
  assert.equal(db.prepare(`SELECT used FROM promos WHERE code = 'VIENAS'`).get().used, 1);
});

test('scheduled future orders do not inflate the ASAP kitchen load', async (t) => {
  const { db, call, lines } = await setup(t);
  const before = (await call('POST', '/api/cart/quote', { storeId: 1, lines })).body.eta;
  const tomorrow = new Date(Date.now() + 26 * 3600000).toISOString();
  for (let i = 0; i < 6; i++) db.prepare(`INSERT INTO orders(code, public_token, customer_name, customer_phone, store_id, fulfillment, status, subtotal_cents, total_cents,
    payment_method, scheduled_for, slot_start, created_at) VALUES(?, ?, 'X', '1', 1, 'pickup', 'placed', 100, 100, 'cash', ?, ?, ?)`)
    .run(`F${i}`, `tok${i}`, tomorrow, tomorrow, new Date().toISOString());
  const after = (await call('POST', '/api/cart/quote', { storeId: 1, lines })).body.eta;
  assert.deepEqual(after, before);
});
