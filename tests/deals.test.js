import test from 'node:test';
import assert from 'node:assert/strict';
import '../server/env.js';
import { applyDeal, dealState, activeDealFor } from '../server/algorithms/deals.js';
import { fromLocal } from '../server/algorithms/time.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';

const wedAt = (h, m = 0) => fromLocal(2026, 11, 18, h, m); // Wednesday, store-local time

test('deal maths and time windows', () => {
  assert.equal(applyDeal(949, { kind: 'percent', value: 20 }), 759);
  assert.equal(applyDeal(299, { kind: 'fixed', value: 500 }), 0, 'never below zero');
  const lunch = { active: 1, days: JSON.stringify(['mon', 'tue', 'wed', 'thu', 'fri']), start_time: '11:00', end_time: '15:00' };
  assert.equal(dealState(lunch, wedAt(10, 59)), 'upcoming');
  assert.equal(dealState(lunch, wedAt(11, 0)), 'active');
  assert.equal(dealState(lunch, wedAt(15, 0)), 'ended');
  assert.equal(dealState(lunch, fromLocal(2026, 11, 21, 12, 0)), 'off', 'Saturday is not a deal day');
  assert.equal(dealState({ ...lunch, active: 0 }, wedAt(12)), 'off');
  assert.equal(dealState({ active: 1, ends_on: '2026-11-17' }, wedAt(12)), 'off', 'expired');
  const item = { id: 1, price_cents: 1000 };
  const best = activeDealFor(item, [{ id: 1, item_id: 1, active: 1, kind: 'percent', value: 10 }, { id: 2, item_id: 1, active: 1, kind: 'fixed', value: 250 }], wedAt(12));
  assert.equal(best.id, 2, 'the bigger saving wins');
});

test('quote applies deals server-side, at the time the food is made', async (t) => {
  const db = openDb(':memory:');
  const app = await createApp({ db });
  db.prepare('UPDATE stores SET hours_json = ?').run(JSON.stringify(Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, ['00:00', '00:00']]))));
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const post = async (u, b) => (await fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
  const item = (name) => db.prepare('SELECT * FROM items WHERE name = ?').get(name);
  const def = (id) => db.prepare('SELECT o.id FROM options o JOIN option_groups g ON g.id = o.group_id WHERE g.item_id = ? AND o.is_default = 1').all(id).map((r) => r.id);

  // all-day deal: Bulvytės −1 €
  const fries = item('Bulvytės');
  const q1 = await post('/api/cart/quote', { storeId: 1, lines: [{ itemId: fries.id, qty: 3, optionIds: def(fries.id) }] });
  assert.equal(q1.lines[0].unit, fries.price_cents - 100);
  assert.equal(q1.lines[0].deal.saved, 300);

  // morning-only deal (Kava 08:00–11:00): price follows the scheduled slot time, not the order time
  const coffee = item('Kava su pienu');
  const tomorrow = new Date(Date.now() + 86400000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow).split('-').map(Number);
  const at = (h) => fromLocal(p[0], p[1], p[2], h, 0).toISOString();
  const morning = await post('/api/cart/quote', { storeId: 1, scheduledFor: at(9), lines: [{ itemId: coffee.id, qty: 1, optionIds: def(coffee.id) }] });
  const evening = await post('/api/cart/quote', { storeId: 1, scheduledFor: at(19), lines: [{ itemId: coffee.id, qty: 1, optionIds: def(coffee.id) }] });
  assert.equal(morning.lines[0].unit, Math.round(coffee.price_cents * 0.75));
  assert.equal(evening.lines[0].unit, coffee.price_cents);
  assert.equal(evening.lines[0].deal, null);

  // menu + today endpoint expose deals
  const today = await (await fetch(`${base}/api/deals/today?storeId=1`)).json();
  assert.ok(['today', 'tomorrow'].includes(today.day) && today.deals.length > 0);
  assert.ok(today.deals.every((d) => d.price < d.was));
});
