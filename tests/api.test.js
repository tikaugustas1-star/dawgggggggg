// End-to-end API flow against an in-memory database.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../server/env.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';

process.env.STRIPE_SECRET_KEY = '';
process.env.PAYMENTS_DEMO = '1';

test('full order flow: quote → order → demo pay → kitchen → completed → points', async (t) => {
  const db = openDb(':memory:');
  db.prepare('UPDATE stores SET hours_json = ?').run(JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, ['00:00', '23:59']]))));
  const app = await createApp({ db });
  db.prepare('UPDATE stores SET hours_json = ?').run(JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, ['00:00', '00:00']]))));
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const jar = {};
  const call = async (method, url, body, who = 'anon') => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie: jar[who] || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: r.status, body: await r.json() };
  };

  const menu = (await call('GET', '/api/menu?storeId=1')).body;
  const burger = menu.items.find((i) => i.name === 'Smash burgeris');
  const defaults = burger.groups.flatMap((g) => g.options.filter((o) => o.isDefault).map((o) => o.id));
  const lines = [{ itemId: burger.id, qty: 2, optionIds: defaults }];

  assert.equal((await call('POST', '/api/auth/login', { email: process.env.CUSTOMER_EMAIL, password: process.env.CUSTOMER_PASSWORD }, 'cust')).status, 200);
  const before = (await call('GET', '/api/me', null, 'cust')).body.user.points;

  // tampering: client price fields are ignored, server recomputes
  const q = (await call('POST', '/api/cart/quote', { storeId: 1, lines: [{ ...lines[0], price: 1 }] }, 'cust')).body;
  assert.equal(q.totals.subtotal, burger.price * 2);
  assert.ok(q.slot.ok, JSON.stringify(q.slot));

  const bad = await call('POST', '/api/orders', { storeId: 1, lines, customerName: 'A', phone: '1' }, 'cust');
  assert.equal(bad.status, 400);

  const created = await call('POST', '/api/orders', { storeId: 1, lines, customerName: 'Demo', phone: '+37060012345', paymentMethod: 'card', rewardId: 1 }, 'cust');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.payment.type, 'demo');
  const tok = created.body.order.token;
  assert.equal(created.body.order.status, 'pending_payment');

  const paid = await call('POST', `/api/orders/${tok}/demo-pay`);
  assert.equal(paid.body.status, 'placed');
  const mid = (await call('GET', '/api/me', null, 'cust')).body.user.points;
  assert.equal(mid, before - 250, 'reward points deducted on placement');

  assert.equal((await call('POST', `/api/kitchen/orders/${paid.body.id}/status`, { status: 'accepted' })).status, 403);
  await call('POST', '/api/auth/login', { email: process.env.STAFF_EMAIL, password: process.env.STAFF_PASSWORD }, 'staff');
  const board = (await call('GET', '/api/kitchen/1/orders', null, 'staff')).body;
  assert.ok(board.some((o) => o.token === tok));
  assert.equal((await call('POST', `/api/kitchen/orders/${paid.body.id}/status`, { status: 'ready' }, 'staff')).status, 400, 'cannot skip steps');
  for (const s of ['accepted', 'preparing', 'ready', 'completed']) {
    const r = await call('POST', `/api/kitchen/orders/${paid.body.id}/status`, { status: s }, 'staff');
    assert.equal(r.body.status, s);
  }
  const after = (await call('GET', '/api/me', null, 'cust')).body.user.points;
  assert.equal(after, mid + paid.body.pointsEarned);

  const re = (await call('POST', `/api/me/orders/${paid.body.id}/reorder`, {}, 'cust')).body;
  assert.equal(re.lines.length, 1);

  // sold-out is enforced server side
  await call('POST', '/api/kitchen/1/sold-out', { itemId: burger.id, soldOut: true }, 'staff');
  const so = await call('POST', '/api/cart/quote', { storeId: 1, lines });
  assert.equal(so.body.code, 'SOLD_OUT');
});
