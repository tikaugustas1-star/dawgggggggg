import test from 'node:test';
import assert from 'node:assert/strict';
import { priceLine, evaluatePromo, computeTotals } from '../server/algorithms/pricing.js';
import { estimate, updateCalibration, haversineKm } from '../server/algorithms/eta.js';
import { listSlots, resolveSlot } from '../server/algorithms/slots.js';
import { rank } from '../server/algorithms/recommend.js';
import { buildAssociations, suggest } from '../server/algorithms/upsell.js';
import { canTransition } from '../server/algorithms/orderState.js';
import { isOpen, fromLocal } from '../server/algorithms/time.js';
import { search, osa } from '../web/src/lib/search.js';

const item = { id: 1, name: 'Burger', price_cents: 900, active: 1 };
const groups = [
  { id: 1, name: 'Kepsnys', min: 1, max: 1, options: [{ id: 10, name: 'Jautiena', price_delta_cents: 0 }, { id: 11, name: 'Augalinis', price_delta_cents: 50 }] },
  { id: 2, name: 'Priedai', min: 0, max: 2, options: [{ id: 20, name: 'Sūris', price_delta_cents: 80 }, { id: 21, name: 'Šoninė', price_delta_cents: 120 }, { id: 22, name: 'X', price_delta_cents: 1 }] },
];

test('pricing: options, min/max, unknown ids', () => {
  assert.equal(priceLine(item, groups, [11, 20], 2).total, (900 + 50 + 80) * 2);
  assert.throws(() => priceLine(item, groups, [], 1), /Kepsnys/);
  assert.throws(() => priceLine(item, groups, [10, 20, 21, 22], 1), /Per daug/);
  assert.throws(() => priceLine(item, groups, [10, 999], 1), /Nežinomas/);
  assert.throws(() => priceLine({ ...item, active: 0 }, groups, [10], 1));
});

test('promos and totals', () => {
  const p = { code: 'X', kind: 'percent', value: 10, min_subtotal_cents: 0, active: 1, used: 0, first_order_only: 1 };
  assert.equal(evaluatePromo(p, { subtotal: 2000, deliveryFee: 0, isFirstOrder: false }).ok, false);
  const r = evaluatePromo(p, { subtotal: 2000, deliveryFee: 0, isFirstOrder: true });
  assert.equal(r.discount, 200);
  const t = computeTotals({ lines: [{ total: 2000 }], deliveryFee: 249, promoResult: r, tipPercent: 10, pointsPerEuro: 10 });
  assert.deepEqual([t.discount, t.deliveryFee, t.tip, t.total, t.pointsEarned], [200, 249, 180, 1800 + 249 + 180, 180]);
  const fd = evaluatePromo({ ...p, kind: 'free_delivery', first_order_only: 0, min_subtotal_cents: 1500 }, { subtotal: 1600, deliveryFee: 249 });
  assert.equal(computeTotals({ lines: [{ total: 1600 }], deliveryFee: 249, promoResult: fd }).deliveryFee, 0);
  assert.equal(computeTotals({ lines: [{ total: 3000 }], deliveryFee: 249, freeDeliveryOver: 2500 }).deliveryFee, 0);
  assert.throws(() => computeTotals({ lines: [{ total: 1000 }], reward: { cost_points: 500, value_cents: 300 }, userPoints: 100 }));
});

test('eta: load and delivery increase time; calibration learns and is bounded', () => {
  const lines = [{ prep_min: 8, qty: 1 }, { prep_min: 4, qty: 2 }];
  const a = estimate({ lines });
  const b = estimate({ lines, activeOrders: 8, stations: 2 });
  const c = estimate({ lines, fulfillment: 'delivery', distanceKm: 4 });
  assert.ok(b.min > a.min && c.min > a.min && a.max > a.min);
  let cal = 1; for (let i = 0; i < 30; i++) cal = updateCalibration(cal, 12, 10 * cal);
  assert.ok(cal > 1.15 && cal <= 1.25, `cal=${cal}`);
  assert.equal(updateCalibration(1.9, 500, 1), 2);
  assert.ok(Math.abs(haversineKm({ lat: 54.6872, lng: 25.2797 }, { lat: 54.8975, lng: 23.915 }) - 90.6) < 2);
});

test('slots: capacity and opening hours (store time zone)', () => {
  const hours = { mon: ['10:00', '12:00'], tue: ['10:00', '12:00'], wed: ['10:00', '12:00'], thu: ['10:00', '12:00'], fri: ['10:00', '12:00'], sat: null, sun: null };
  const now = fromLocal(2026, 11, 18, 9, 0); // Wed 09:00 Vilnius
  assert.equal(isOpen(hours, now), false);
  assert.equal(isOpen(hours, fromLocal(2026, 11, 18, 10, 30)), true);
  const s = listSlots({ hours, now, days: 1, leadMin: 20 });
  assert.equal(s.length, 8); // 10:00..11:45
  const full = new Map([[s[0].start, 8]]);
  assert.equal(listSlots({ hours, now, used: full, days: 1 })[0].available, false);
  assert.equal(resolveSlot({ hours, scheduledFor: s[0].start, now, used: full, capacity: 8, leadMin: 20 }).ok, false);
  assert.equal(resolveSlot({ hours, scheduledFor: s[1].start, now, used: full, capacity: 8, leadMin: 20 }).ok, true);
  assert.equal(resolveSlot({ hours, now, used: new Map() }).ok, false); // ASAP while closed
  const late = { ...hours, wed: ['18:00', '01:00'] };
  assert.equal(isOpen(late, fromLocal(2026, 11, 19, 0, 30)), true); // past midnight
});

test('upsell: association lift + meal gap, no duplicates per role', () => {
  const baskets = [];
  for (let i = 0; i < 20; i++) baskets.push([1, 2]); // burger + fries
  for (let i = 0; i < 10; i++) baskets.push([3, 4]); // bowl + lemonade
  for (let i = 0; i < 5; i++) baskets.push([1, 5]); // burger + cola
  const assoc = buildAssociations(baskets);
  assert.ok(assoc.lift(1, 2) > 1);
  const items = new Map([[1, { id: 1, role: 'main', active: 1 }], [2, { id: 2, role: 'side', active: 1 }], [3, { id: 3, role: 'main', active: 1 }],
    [4, { id: 4, role: 'drink', active: 1 }], [5, { id: 5, role: 'drink', active: 1 }], [6, { id: 6, role: 'dessert', active: 1 }]]);
  const s = suggest({ cartIds: [1], items, assoc });
  assert.equal(s[0].id, 2);
  assert.equal(s.filter((x) => x.role === 'drink').length, 1);
  assert.ok(!suggest({ cartIds: [1], items, assoc, unavailable: new Set([2]) }).some((x) => x.id === 2));
});

test('recommend: personal history beats global popularity', () => {
  const now = new Date();
  const global = new Map([[1, 100], [2, 5]]);
  const r = rank({ itemIds: [1, 2], history: [{ item_id: 2, qty: 5, created_at: now.toISOString() }], global, now });
  assert.equal(r[0].id, 2);
  assert.equal(rank({ itemIds: [1, 2], global, now })[0].id, 1);
});

test('state machine', () => {
  assert.ok(canTransition('pickup', 'ready', 'completed'));
  assert.ok(!canTransition('pickup', 'ready', 'out_for_delivery'));
  assert.ok(canTransition('delivery', 'ready', 'out_for_delivery'));
  assert.ok(!canTransition('delivery', 'placed', 'ready'));
  assert.ok(!canTransition('pickup', 'completed', 'cancelled'));
});

test('search: typo + diacritic tolerant', () => {
  const items = [{ name: 'Šaltalankių arbata', description: '', tags: [] }, { name: 'Smash burgeris', description: 'jautiena', tags: [] }, { name: 'Falafelių bowl', description: '', tags: ['veganiška'] }];
  assert.equal(search(items, 'saltalank')[0].name, 'Šaltalankių arbata');
  assert.equal(search(items, 'burgreis')[0].name, 'Smash burgeris');
  assert.equal(search(items, 'veganiska')[0].name, 'Falafelių bowl');
  assert.equal(search(items, 'pica').length, 0);
  assert.equal(osa('ab', 'ba'), 1);
});
