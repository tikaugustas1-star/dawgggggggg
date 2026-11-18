import './env.js';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, tx, kvGet, kvSet, loadBrand, ROOT } from './db.js';
import { seed, seedDeals } from './seed.js';
import { hashPassword, verifyPassword, createSession, destroySession, sessionMiddleware, requireUser, requireRole, rateLimit } from './auth.js';
import { subscribe, publish } from './events.js';
import { initPayments, mode as paymentMode, createCheckout, verifyStripe, webhookEvent } from './payments.js';
import { priceLine, evaluatePromo, computeTotals, PricingError } from './algorithms/pricing.js';
import { estimate, haversineKm, updateCalibration } from './algorithms/eta.js';
import { listSlots, resolveSlot, slotStart } from './algorithms/slots.js';
import { rank } from './algorithms/recommend.js';
import { buildAssociations, suggest } from './algorithms/upsell.js';
import { canTransition, ACTIVE } from './algorithms/orderState.js';
import { rebuildCart } from './algorithms/reorder.js';
import { isOpen, daypart } from './algorithms/time.js';
import { activeDealFor, applyDeal, dealState, dealBadge } from './algorithms/deals.js';

export async function createApp({ db = openDb(), brand = loadBrand() } = {}) {
  seed(db);
  seedDeals(db);
  await initPayments();
  const app = express();
  app.set('trust proxy', 1);
  const BASE = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3001}`;
  const secureCookies = BASE.startsWith('https');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // Stripe webhook needs the raw body, so it is mounted before the JSON parser.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    let event;
    try { event = webhookEvent(req.body, req.headers['stripe-signature']); } catch { return res.status(400).end(); }
    if (event?.type === 'checkout.session.completed') {
      const o = db.prepare('SELECT * FROM orders WHERE stripe_session_id = ?').get(event.data.object.id);
      if (o && o.status === 'pending_payment' && event.data.object.amount_total === o.total_cents) markPaidAndPlace(o);
    }
    res.json({ received: true });
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(sessionMiddleware(db));

  // ---------- data helpers ----------
  const q = {
    store: db.prepare('SELECT * FROM stores WHERE id = ?'),
    stores: db.prepare('SELECT * FROM stores ORDER BY id'),
    item: db.prepare('SELECT i.*, c.role FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id = ?'),
    order: db.prepare('SELECT * FROM orders WHERE id = ?'),
    orderByToken: db.prepare('SELECT * FROM orders WHERE public_token = ?'),
    orderItems: db.prepare('SELECT * FROM order_items WHERE order_id = ?'),
    soldOut: db.prepare('SELECT item_id FROM sold_out WHERE store_id = ?'),
    activeCount: db.prepare(`SELECT COUNT(*) n FROM orders WHERE store_id = ? AND status IN ('placed','accepted','preparing') AND slot_start <= ?`),
    slotUse: db.prepare(`SELECT slot_start, COUNT(*) n FROM orders WHERE store_id = ? AND slot_start >= ? AND status NOT IN ('cancelled','pending_payment') GROUP BY slot_start`),
    promo: db.prepare('SELECT * FROM promos WHERE code = ? COLLATE NOCASE'),
    reward: db.prepare('SELECT * FROM rewards WHERE id = ?'),
    userOrderCount: db.prepare(`SELECT COUNT(*) n FROM orders WHERE user_id = ? AND status NOT IN ('cancelled','pending_payment')`),
    deals: db.prepare('SELECT * FROM deals WHERE active = 1'),
    phoneOrderCount: db.prepare(`SELECT COUNT(*) n FROM orders WHERE customer_phone = ? AND status NOT IN ('cancelled','pending_payment')`),
  };

  // Public view of an item's deal at `at` (null when none applies).
  function dealView(item, deals, at = new Date()) {
    const d = activeDealFor(item, deals, at);
    if (!d) return null;
    return { id: d.id, title: d.title, badge: dealBadge(d), price: applyDeal(item.price_cents, d), until: d.end_time || null };
  }

  function storeView(s, now = new Date()) {
    const hours = JSON.parse(s.hours_json);
    return { id: s.id, name: s.name, address: s.address, lat: s.lat, lng: s.lng, phone: s.phone, hours, image: s.image, about: s.about,
      open: isOpen(hours, now) && !s.paused, paused: !!s.paused, deliveryRadiusKm: s.delivery_radius_km,
      deliveryFee: s.delivery_fee_cents, freeDeliveryOver: s.free_delivery_over_cents, minOrder: s.min_order_cents };
  }

  function loadMenu() {
    const cats = db.prepare('SELECT * FROM categories ORDER BY sort').all();
    const items = db.prepare('SELECT i.*, c.role, c.slug FROM items i JOIN categories c ON c.id = i.category_id ORDER BY i.sort').all();
    const groups = db.prepare('SELECT * FROM option_groups ORDER BY sort').all();
    const opts = db.prepare('SELECT * FROM options ORDER BY id').all();
    const groupsByItem = new Map();
    for (const g of groups) {
      g.options = opts.filter((o) => o.group_id === g.id);
      if (!groupsByItem.has(g.item_id)) groupsByItem.set(g.item_id, []);
      groupsByItem.get(g.item_id).push(g);
    }
    const itemMap = new Map(items.map((i) => [i.id, i]));
    return { cats, items, itemMap, groupsByItem };
  }

  function unavailableFor(storeId, menu) {
    const s = new Set(q.soldOut.all(storeId).map((r) => r.item_id));
    for (const i of menu.items) if (!i.active) s.add(i.id);
    return s;
  }

  // Popularity + association index over the last 60 days, cached 5 min.
  let statsCache = null;
  function stats() {
    if (statsCache && Date.now() - statsCache.at < 300000) return statsCache;
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const rows = db.prepare(`SELECT o.id, o.created_at, oi.item_id, oi.qty FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status = 'completed' AND o.created_at >= ?`).all(since);
    const baskets = new Map(); const global = new Map(); const byDaypart = {};
    for (const r of rows) {
      if (!baskets.has(r.id)) baskets.set(r.id, []);
      baskets.get(r.id).push(r.item_id);
      global.set(r.item_id, (global.get(r.item_id) || 0) + r.qty);
      const dp = daypart(new Date(r.created_at));
      byDaypart[dp] ??= new Map();
      byDaypart[dp].set(r.item_id, (byDaypart[dp].get(r.item_id) || 0) + r.qty);
    }
    statsCache = { at: Date.now(), global, byDaypart, assoc: buildAssociations([...baskets.values()]) };
    return statsCache;
  }

  function calibration(storeId) {
    let c = kvGet(db, `cal:${storeId}`, null);
    if (c == null) { // bootstrap from history: median actual/predicted
      const rows = db.prepare(`SELECT predicted_prep p, (julianday(ready_at) - julianday(accepted_at)) * 1440 a FROM orders
        WHERE store_id = ? AND ready_at IS NOT NULL AND accepted_at IS NOT NULL AND predicted_prep > 0 ORDER BY id DESC LIMIT 60`).all(storeId);
      const r = rows.map((x) => x.a / x.p).sort((a, b) => a - b);
      c = r.length ? +Math.min(2, Math.max(0.6, r[Math.floor(r.length / 2)])).toFixed(4) : 1;
      kvSet(db, `cal:${storeId}`, c);
    }
    return c;
  }

  function slotUsage(storeId) {
    const from = slotStart(new Date(Date.now() - 15 * 60000)).toISOString();
    return new Map(q.slotUse.all(storeId, from).map((r) => [r.slot_start, r.n]));
  }

  // ---------- quote: single source of truth for prices, ETA and slot ----------
  function buildQuote(body, user) {
    const store = q.store.get(Number(body.storeId));
    if (!store) throw new PricingError('Pasirinkite restoraną', 'STORE');
    const menu = loadMenu();
    const unavailable = unavailableFor(store.id, menu);
    if (!Array.isArray(body.lines) || !body.lines.length) throw new PricingError('Krepšelis tuščias', 'EMPTY');
    if (body.lines.length > 40) throw new PricingError('Per daug eilučių', 'TOO_MANY');
    // deals are priced at the time the food is made: now for ASAP, the slot time for scheduled orders
    const dealAt = body.scheduledFor && !Number.isNaN(Date.parse(body.scheduledFor)) ? new Date(body.scheduledFor) : new Date();
    const deals = q.deals.all();
    const lines = body.lines.map((l) => {
      const it = menu.itemMap.get(Number(l.itemId));
      if (it && unavailable.has(it.id)) throw new PricingError(`${it.name} šiuo metu neturime`, 'SOLD_OUT');
      const deal = it ? activeDealFor(it, deals, dealAt) : null;
      const base = it ? applyDeal(it.price_cents, deal) : 0;
      const p = priceLine(it && { ...it, price_cents: base }, menu.groupsByItem.get(it?.id) || [], l.optionIds || [], Number(l.qty));
      return { ...p, itemId: it.id, name: it.name, prep_min: it.prep_min, note: String(l.note || '').slice(0, 140),
        deal: deal ? { title: deal.title, badge: dealBadge(deal), saved: (it.price_cents - base) * p.qty } : null };
    });

    const fulfillment = body.fulfillment === 'delivery' ? 'delivery' : 'pickup';
    let distanceKm = 0; let zoneVerified = true;
    if (fulfillment === 'delivery') {
      if (!brand.delivery?.enabled) throw new PricingError('Pristatymas neteikiamas', 'NO_DELIVERY');
      if (Number.isFinite(body.lat) && Number.isFinite(body.lng)) {
        distanceKm = haversineKm(store, { lat: body.lat, lng: body.lng });
        if (distanceKm > store.delivery_radius_km) throw new PricingError(`Adresas už pristatymo zonos (${store.delivery_radius_km} km)`, 'OUT_OF_ZONE');
      } else { distanceKm = store.delivery_radius_km * 0.6; zoneVerified = false; }
    }

    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const deliveryFee = fulfillment === 'delivery' ? store.delivery_fee_cents : 0;
    let promoResult = null;
    if (body.promoCode) {
      const isFirst = user ? q.userOrderCount.get(user.id).n === 0 : body.phone ? q.phoneOrderCount.get(String(body.phone)).n === 0 : true;
      promoResult = evaluatePromo(q.promo.get(String(body.promoCode).trim()), { subtotal, deliveryFee, isFirstOrder: isFirst });
    }
    let reward = null;
    if (body.rewardId) {
      if (!user) throw new PricingError('Prisijunkite, kad panaudotumėte taškus', 'LOGIN');
      reward = q.reward.get(Number(body.rewardId));
    }
    const totals = computeTotals({ lines, deliveryFee, freeDeliveryOver: store.free_delivery_over_cents, promoResult, reward,
      userPoints: user?.points || 0, tipPercent: Number(body.tipPercent) || 0, pointsPerEuro: brand.loyalty.pointsPerEuro });
    const belowMin = subtotal < store.min_order_cents;

    const eta = estimate({ lines: lines.map((l) => ({ prep_min: l.prep_min, qty: l.qty })), activeOrders: q.activeCount.get(store.id, new Date(Date.now() + 45 * 60000).toISOString()).n,
      stations: store.prep_stations, calibration: calibration(store.id), distanceKm, fulfillment,
      speedKmPerMin: brand.delivery.speedKmPerMin, handoffMin: brand.delivery.handoffMin });
    const slot = resolveSlot({ hours: JSON.parse(store.hours_json), paused: store.paused, scheduledFor: body.scheduledFor || null,
      used: slotUsage(store.id), capacity: store.slot_capacity, leadMin: Math.max(20, eta.max) });

    return { store, lines, fulfillment, distanceKm: +distanceKm.toFixed(2), zoneVerified, totals, promo: promoResult,
      reward, eta, slot, belowMin, minOrder: store.min_order_cents };
  }

  const publicQuote = (qt) => ({
    lines: qt.lines.map((l) => ({ itemId: l.itemId, name: l.name, qty: l.qty, unit: l.unit, total: l.total, options: l.options, deal: l.deal })),
    totals: qt.totals, promo: qt.promo, eta: { min: qt.eta.min, max: qt.eta.max }, slot: qt.slot,
    belowMin: qt.belowMin, minOrder: qt.minOrder, zoneVerified: qt.zoneVerified, distanceKm: qt.distanceKm,
  });

  function orderView(o) {
    const items = q.orderItems.all(o.id).map((i) => ({ ...i, options: JSON.parse(i.options_json) }));
    const events = db.prepare('SELECT status, at FROM order_events WHERE order_id = ? ORDER BY id').all(o.id);
    const s = q.store.get(o.store_id);
    return { id: o.id, code: o.code, token: o.public_token, status: o.status, fulfillment: o.fulfillment, address: o.address,
      customerName: o.customer_name, customerPhone: o.customer_phone, notes: o.notes,
      store: { id: s.id, name: s.name, address: s.address, phone: s.phone, lat: s.lat, lng: s.lng },
      subtotal: o.subtotal_cents, discount: o.discount_cents, reward: o.reward_cents, deliveryFee: o.delivery_fee_cents,
      tip: o.tip_cents, total: o.total_cents, promoCode: o.promo_code, pointsEarned: o.points_earned, pointsSpent: o.points_spent,
      paymentMethod: o.payment_method, paymentStatus: o.payment_status, scheduledFor: o.scheduled_for, slotStart: o.slot_start,
      etaMin: o.eta_min, etaMax: o.eta_max, createdAt: o.created_at, acceptedAt: o.accepted_at, readyAt: o.ready_at,
      completedAt: o.completed_at, items, events };
  }

  function addEvent(orderId, status) {
    db.prepare('INSERT INTO order_events(order_id, status, at) VALUES(?,?,?)').run(orderId, status, new Date().toISOString());
  }

  function broadcast(orderId) {
    const o = q.order.get(orderId); const v = orderView(o);
    publish(`order:${o.public_token}`, 'order', v);
    publish(`store:${o.store_id}`, 'order', v);
  }

  // Placement re-checks scarce resources atomically: points balance and promo usage limit.
  function placeOrder(o) {
    tx(db, () => {
      if (db.prepare(`UPDATE orders SET status = 'placed' WHERE id = ? AND status = 'pending_payment'`).run(o.id).changes === 0) return;
      if (o.points_spent && o.user_id && db.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?')
        .run(o.points_spent, o.user_id, o.points_spent).changes === 0) throw new PricingError('Nepakanka taškų', 'POINTS');
      if (o.promo_code && db.prepare('UPDATE promos SET used = used + 1 WHERE code = ? AND (max_uses IS NULL OR used < max_uses)')
        .run(o.promo_code).changes === 0) throw new PricingError('Nuolaidos kodas jau išnaudotas', 'PROMO');
      addEvent(o.id, 'placed');
    });
    broadcast(o.id);
  }
  function markPaidAndPlace(o) {
    db.prepare(`UPDATE orders SET payment_status = 'paid' WHERE id = ?`).run(o.id);
    try { placeOrder(q.order.get(o.id)); }
    catch (e) {
      // Paid but no longer placeable (points/promo used up meanwhile): cancel and flag the refund instead of leaving it hanging.
      if (!(e instanceof PricingError)) throw e;
      cancelOrder(q.order.get(o.id));
    }
  }

  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof PricingError) return res.status(400).json({ error: e.message, code: e.code });
      console.error(e); res.status(500).json({ error: 'Serverio klaida' });
    }
  };

  // ---------- public ----------
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/brand', (_req, res) => res.json({ ...brand, payments: paymentMode() }));

  app.get('/api/stores', (_req, res) => res.json(q.stores.all().map((s) => storeView(s))));

  app.get('/api/stores/:id/slots', wrap((req, res) => {
    const s = q.store.get(Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'Nerasta' });
    res.json(listSlots({ hours: JSON.parse(s.hours_json), used: slotUsage(s.id), capacity: s.slot_capacity, leadMin: 25 }));
  }));

  app.get('/api/menu', wrap((req, res) => {
    const storeId = Number(req.query.storeId) || 1;
    const menu = loadMenu(); const un = unavailableFor(storeId, menu); const st = stats(); const deals = q.deals.all();
    res.json({
      categories: menu.cats.map((c) => ({ id: c.id, name: c.name, slug: c.slug, role: c.role })),
      items: menu.items.filter((i) => i.active).map((i) => ({
        id: i.id, categoryId: i.category_id, name: i.name, description: i.description, price: i.price_cents,
        image: i.image, emoji: i.emoji, kcal: i.kcal, tags: JSON.parse(i.tags), allergens: JSON.parse(i.allergens),
        soldOut: un.has(i.id), role: i.role, prepMin: i.prep_min, orders60d: st.global.get(i.id) || 0, deal: dealView(i, deals),
        groups: (menu.groupsByItem.get(i.id) || []).map((g) => ({ id: g.id, name: g.name, min: g.min, max: g.max,
          options: g.options.map((o) => ({ id: o.id, name: o.name, delta: o.price_delta_cents, isDefault: !!o.is_default })) })),
      })),
    });
  }));

  // "Šiandienos pasiūlymai": deals still valid today (active or later today); if none are left, tomorrow's.
  app.get('/api/deals/today', wrap((req, res) => {
    const storeId = Number(req.query.storeId) || 1;
    const menu = loadMenu(); const un = unavailableFor(storeId, menu); const deals = q.deals.all();
    const build = (at, day) => deals.map((d) => ({ d, st: dealState(d, at), it: menu.itemMap.get(d.item_id) }))
      .filter((x) => x.it && !un.has(x.it.id) && (day === 'tomorrow' ? x.st !== 'off' : ['active', 'upcoming'].includes(x.st)))
      .map(({ d, st, it }) => ({ id: d.id, itemId: it.id, title: d.title, badge: dealBadge(d), price: applyDeal(it.price_cents, d), was: it.price_cents,
        from: d.start_time, until: d.end_time, state: day === 'tomorrow' ? 'tomorrow' : st }))
      .sort((a, b) => (a.state === 'active' ? 0 : 1) - (b.state === 'active' ? 0 : 1) || (b.was - b.price) - (a.was - a.price));
    let list = build(new Date(), 'today'); let day = 'today';
    if (!list.length) { list = build(new Date(Date.now() + 86400000), 'tomorrow'); day = 'tomorrow'; }
    res.json({ day, deals: list });
  }));

  // "Tau" shelf: personalised ranking for the current daypart.
  app.get('/api/recommendations', wrap((req, res) => {
    const storeId = Number(req.query.storeId) || 1;
    const menu = loadMenu(); const un = unavailableFor(storeId, menu);
    const st = stats(); const dp = daypart(new Date());
    const history = req.user ? db.prepare(`SELECT oi.item_id, oi.qty, o.created_at FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = ? AND o.status = 'completed' ORDER BY o.id DESC LIMIT 200`).all(req.user.id) : [];
    const cartIds = String(req.query.cart || '').split(',').map(Number).filter(Boolean);
    const ranked = rank({ itemIds: menu.items.filter((i) => !un.has(i.id)).map((i) => i.id), history, global: st.global,
      daypartCounts: st.byDaypart[dp] || new Map(), cartIds, assoc: st.assoc });
    // Shelf diversity: lead with mains (what people open the app for), at most 2 items per role.
    const roleBoost = { main: 1, side: 0.7, drink: 0.6, dessert: 0.65 };
    const perRole = {}; const shelf = [];
    for (const r of ranked.map((x) => ({ ...x, adj: x.score * (roleBoost[menu.itemMap.get(x.id).role] ?? 0.7) })).sort((a, b) => b.adj - a.adj)) {
      const role = menu.itemMap.get(r.id).role;
      if ((perRole[role] = (perRole[role] || 0) + 1) > (role === 'main' ? 4 : 2)) continue;
      shelf.push({ id: r.id, score: r.score, parts: r.parts });
      if (shelf.length >= 8) break;
    }
    res.json({ daypart: dp, personalized: history.length > 0, items: shelf });
  }));

  app.post('/api/cart/suggest', wrap((req, res) => {
    const storeId = Number(req.body.storeId) || 1;
    const menu = loadMenu(); const st = stats();
    const pairings = new Map();
    for (const p of db.prepare('SELECT * FROM pairings').all()) {
      if (!pairings.has(p.item_id)) pairings.set(p.item_id, new Set());
      pairings.get(p.item_id).add(p.suggest_id);
    }
    const cartIds = (req.body.itemIds || []).map(Number).filter((id) => menu.itemMap.has(id));
    res.json(suggest({ cartIds, items: menu.itemMap, assoc: st.assoc, pairings, unavailable: unavailableFor(storeId, menu) }));
  }));

  app.post('/api/cart/quote', wrap((req, res) => res.json(publicQuote(buildQuote(req.body, req.user)))));

  app.post('/api/orders', wrap(async (req, res) => {
    const b = req.body;
    const name = String(b.customerName || req.user?.name || '').trim().slice(0, 80);
    const phone = String(b.phone || req.user?.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
    if (name.length < 2) throw new PricingError('Įveskite vardą', 'NAME');
    if (phone.length < 8) throw new PricingError('Įveskite telefono numerį', 'PHONE');
    const qt = buildQuote({ ...b, phone }, req.user);
    if (qt.belowMin) throw new PricingError(`Minimali užsakymo suma ${(qt.minOrder / 100).toFixed(2)} €`, 'MIN_ORDER');
    if (!qt.slot.ok) throw new PricingError(qt.slot.reason, 'SLOT');
    if (qt.promo && !qt.promo.ok) throw new PricingError(qt.promo.reason, 'PROMO');
    if (qt.fulfillment === 'delivery' && String(b.address || '').trim().length < 5) throw new PricingError('Įveskite pristatymo adresą', 'ADDRESS');
    const method = b.paymentMethod === 'cash' ? 'cash' : 'card';
    if (method === 'card' && paymentMode() === 'off') throw new PricingError('Mokėjimas kortele neprieinamas', 'PAYMENTS_OFF');

    const now = new Date().toISOString();
    const token = crypto.randomBytes(18).toString('base64url');
    const t = qt.totals;
    let orderId;
    for (let attempt = 0; attempt < 5 && !orderId; attempt++) {
      const code = `${brand.logoText.slice(0, 1)}${crypto.randomInt(1000, 9999)}`;
      try {
        orderId = tx(db, () => {
          const id = Number(db.prepare(`INSERT INTO orders(code, public_token, user_id, customer_name, customer_phone, store_id, fulfillment,
            address, lat, lng, notes, status, subtotal_cents, discount_cents, reward_cents, delivery_fee_cents, tip_cents, total_cents,
            promo_code, reward_id, points_earned, points_spent, payment_method, scheduled_for, slot_start, eta_min, eta_max, predicted_prep, created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending_payment',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            code, token, req.user?.id ?? null, name, phone, qt.store.id, qt.fulfillment,
            qt.fulfillment === 'delivery' ? String(b.address).slice(0, 200) : null,
            Number.isFinite(b.lat) ? b.lat : null, Number.isFinite(b.lng) ? b.lng : null, String(b.notes || '').slice(0, 300) || null,
            t.subtotal, t.discount, t.rewardCents, t.deliveryFee, t.tip, t.total,
            qt.promo?.ok ? String(b.promoCode).trim().toUpperCase() : null, qt.reward?.id ?? null, req.user ? t.pointsEarned : 0, t.pointsSpent,
            method, b.scheduledFor || null, qt.slot.slot, qt.eta.min, qt.eta.max, qt.eta.kitchen, now).lastInsertRowid);
          const ins = db.prepare('INSERT INTO order_items(order_id, item_id, name, qty, unit_price_cents, options_json, note, line_total_cents) VALUES(?,?,?,?,?,?,?,?)');
          for (const l of qt.lines) ins.run(id, l.itemId, l.name, l.qty, l.unit, JSON.stringify(l.options), l.note || null, l.total);
          addEvent(id, 'pending_payment');
          return id;
        });
      } catch (e) { if (!String(e.message).includes('UNIQUE')) throw e; }
    }
    let o = q.order.get(orderId);
    let payment = { type: 'none' };
    if (method === 'cash') placeOrder(o);
    else {
      payment = await createCheckout(o, brand, BASE);
      if (payment.sessionId) db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(payment.sessionId, o.id);
    }
    o = q.order.get(orderId);
    res.status(201).json({ order: orderView(o), payment: { type: payment.type, url: payment.url } });
  }));

  app.get('/api/orders/:token', wrap(async (req, res) => {
    let o = q.orderByToken.get(req.params.token);
    if (!o) return res.status(404).json({ error: 'Užsakymas nerastas' });
    if (o.status === 'pending_payment' && req.query.session_id && await verifyStripe(o, String(req.query.session_id))) {
      markPaidAndPlace(o); o = q.order.get(o.id);
    }
    res.json(orderView(o));
  }));

  app.get('/api/orders/:token/stream', (req, res) => {
    const o = q.orderByToken.get(req.params.token);
    if (!o) return res.status(404).end();
    subscribe(`order:${o.public_token}`, req, res);
    res.write(`event: order\ndata: ${JSON.stringify(orderView(o))}\n\n`);
  });

  // DEMO card payment: only when Stripe is not configured. No money moves.
  app.post('/api/orders/:token/demo-pay', wrap((req, res) => {
    if (paymentMode() !== 'demo') return res.status(400).json({ error: 'Demo mokėjimai išjungti' });
    const o = q.orderByToken.get(req.params.token);
    if (!o || o.status !== 'pending_payment') return res.status(400).json({ error: 'Užsakymas jau apmokėtas' });
    markPaidAndPlace(o);
    res.json(orderView(q.order.get(o.id)));
  }));

  app.post('/api/orders/:token/cancel', wrap((req, res) => {
    const o = q.orderByToken.get(req.params.token);
    if (!o) return res.status(404).json({ error: 'Nerasta' });
    if (!['pending_payment', 'placed'].includes(o.status)) return res.status(400).json({ error: 'Virtuvė jau pradėjo gaminti. Susisiekite su restoranu.' });
    cancelOrder(o);
    res.json(orderView(q.order.get(o.id)));
  }));

  function cancelOrder(o) {
    tx(db, () => {
      db.prepare(`UPDATE orders SET status = 'cancelled', payment_status = CASE WHEN payment_status = 'paid' THEN 'refund_due' ELSE payment_status END WHERE id = ?`).run(o.id);
      if (o.status !== 'pending_payment' && o.points_spent && o.user_id) db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(o.points_spent, o.user_id);
      addEvent(o.id, 'cancelled');
    });
    broadcast(o.id);
  }

  // ---------- auth & account ----------
  const authLimit = rateLimit({ max: 10 });
  app.post('/api/auth/register', authLimit, wrap((req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim().slice(0, 80);
    const pw = String(req.body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Neteisingas el. paštas' });
    if (name.length < 2) return res.status(400).json({ error: 'Įveskite vardą' });
    if (pw.length < 8) return res.status(400).json({ error: 'Slaptažodis turi būti bent 8 simbolių' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Paskyra jau egzistuoja' });
    const id = Number(db.prepare('INSERT INTO users(email, name, phone, password_hash) VALUES(?,?,?,?)')
      .run(email, name, String(req.body.phone || '').slice(0, 20) || null, hashPassword(pw)).lastInsertRowid);
    createSession(db, id, res, secureCookies);
    res.status(201).json({ ok: true });
  }));

  app.post('/api/auth/login', authLimit, wrap((req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(req.body.email || '').trim().toLowerCase());
    if (!u || !verifyPassword(String(req.body.password || ''), u.password_hash)) return res.status(401).json({ error: 'Neteisingi prisijungimo duomenys' });
    createSession(db, u.id, res, secureCookies);
    res.json({ ok: true, role: u.role });
  }));

  app.post('/api/auth/logout', (req, res) => { destroySession(db, req, res); res.json({ ok: true }); });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    const favs = db.prepare('SELECT item_id FROM favorites WHERE user_id = ?').all(req.user.id).map((r) => r.item_id);
    res.json({ user: req.user, favorites: favs, rewards: db.prepare('SELECT * FROM rewards ORDER BY cost_points').all() });
  });

  app.post('/api/me/favorites/:itemId', requireUser, (req, res) => {
    const id = Number(req.params.itemId);
    const del = db.prepare('DELETE FROM favorites WHERE user_id = ? AND item_id = ?').run(req.user.id, id);
    if (!del.changes) db.prepare('INSERT OR IGNORE INTO favorites VALUES(?,?)').run(req.user.id, id);
    res.json({ favorite: !del.changes });
  });

  app.get('/api/me/orders', requireUser, (req, res) => {
    const rows = db.prepare(`SELECT * FROM orders WHERE user_id = ? AND status != 'pending_payment' ORDER BY created_at DESC LIMIT 30`).all(req.user.id);
    res.json(rows.map(orderView));
  });

  app.post('/api/me/orders/:id/reorder', requireUser, wrap((req, res) => {
    const o = q.order.get(Number(req.params.id));
    if (!o || o.user_id !== req.user.id) return res.status(404).json({ error: 'Nerasta' });
    const menu = loadMenu();
    res.json(rebuildCart(q.orderItems.all(o.id), { items: menu.itemMap, groupsByItem: menu.groupsByItem,
      unavailable: unavailableFor(Number(req.body.storeId) || o.store_id, menu) }));
  }));

  // ---------- kitchen (staff/admin) ----------
  const staff = requireRole('staff', 'admin');
  app.get('/api/kitchen/:storeId/orders', staff, (req, res) => {
    const since = new Date(Date.now() - 18 * 3600000).toISOString();
    const rows = db.prepare(`SELECT * FROM orders WHERE store_id = ? AND source = 'app' AND status NOT IN ('pending_payment')
      AND (status IN ('placed','accepted','preparing','ready','out_for_delivery') OR created_at >= ?) ORDER BY slot_start, id`).all(Number(req.params.storeId), since);
    res.json(rows.map(orderView));
  });

  app.get('/api/kitchen/:storeId/stream', staff, (req, res) => subscribe(`store:${Number(req.params.storeId)}`, req, res));

  app.post('/api/kitchen/orders/:id/status', staff, wrap((req, res) => {
    const o = q.order.get(Number(req.params.id));
    if (!o) return res.status(404).json({ error: 'Nerasta' });
    const to = String(req.body.status);
    if (!canTransition(o.fulfillment, o.status, to)) return res.status(400).json({ error: `Negalima: ${o.status} → ${to}` });
    if (to === 'cancelled') { cancelOrder(o); return res.json(orderView(q.order.get(o.id))); }
    const now = new Date();
    tx(db, () => {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(to, o.id);
      if (to === 'accepted') db.prepare('UPDATE orders SET accepted_at = ? WHERE id = ?').run(now.toISOString(), o.id);
      if (to === 'ready') {
        db.prepare('UPDATE orders SET ready_at = ? WHERE id = ?').run(now.toISOString(), o.id);
        const startedAt = new Date(o.accepted_at || o.created_at);
        const actual = (now - startedAt) / 60000;
        if (!o.scheduled_for && actual > 0.5 && actual < 180) kvSet(db, `cal:${o.store_id}`, updateCalibration(calibration(o.store_id), actual, o.predicted_prep));
      }
      if (to === 'completed') {
        db.prepare(`UPDATE orders SET completed_at = ?, payment_status = 'paid' WHERE id = ?`).run(now.toISOString(), o.id);
        if (o.user_id && o.points_earned) db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(o.points_earned, o.user_id);
        statsCache = null;
      }
      addEvent(o.id, to);
    });
    broadcast(o.id);
    res.json(orderView(q.order.get(o.id)));
  }));

  app.post('/api/kitchen/:storeId/sold-out', staff, (req, res) => {
    const storeId = Number(req.params.storeId); const itemId = Number(req.body.itemId);
    if (req.body.soldOut) db.prepare('INSERT OR IGNORE INTO sold_out VALUES(?,?)').run(storeId, itemId);
    else db.prepare('DELETE FROM sold_out WHERE store_id = ? AND item_id = ?').run(storeId, itemId);
    publish(`store:${storeId}`, 'menu', { itemId, soldOut: !!req.body.soldOut });
    res.json({ ok: true });
  });

  app.post('/api/kitchen/:storeId/pause', staff, (req, res) => {
    db.prepare('UPDATE stores SET paused = ? WHERE id = ?').run(req.body.paused ? 1 : 0, Number(req.params.storeId));
    res.json(storeView(q.store.get(Number(req.params.storeId))));
  });

  // ---------- admin ----------
  const admin = requireRole('admin');
  app.get('/api/admin/stats', admin, (req, res) => {
    const day0 = new Date(); day0.setHours(0, 0, 0, 0);
    const done = `status NOT IN ('cancelled','pending_payment')`;
    const today = db.prepare(`SELECT COUNT(*) orders, COALESCE(SUM(total_cents),0) revenue, COALESCE(AVG(total_cents),0) avg FROM orders WHERE ${done} AND created_at >= ?`).get(day0.toISOString());
    const days = db.prepare(`SELECT substr(created_at,1,10) day, COUNT(*) orders, SUM(total_cents) revenue FROM orders WHERE ${done} AND created_at >= ? GROUP BY day ORDER BY day`)
      .all(new Date(Date.now() - 14 * 86400000).toISOString());
    const top = db.prepare(`SELECT oi.item_id itemId, oi.name, SUM(oi.qty) qty, SUM(oi.line_total_cents) revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.${done} AND o.created_at >= ? GROUP BY oi.item_id ORDER BY qty DESC LIMIT 8`).all(new Date(Date.now() - 30 * 86400000).toISOString());
    const eta = db.prepare(`SELECT COUNT(*) n, AVG(ABS((julianday(ready_at) - julianday(accepted_at)) * 1440 - predicted_prep)) mae
      FROM orders WHERE source = 'app' AND ready_at IS NOT NULL AND accepted_at IS NOT NULL`).get();
    const attach = db.prepare(`SELECT AVG(n) v FROM (SELECT COUNT(*) n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.${done} GROUP BY o.id)`).get();
    res.json({ today, days, top, etaAccuracy: eta, itemsPerOrder: attach.v,
      calibration: q.stores.all().map((s) => ({ store: s.name, factor: calibration(s.id) })), payments: paymentMode() });
  });

  app.get('/api/admin/items', admin, (_req, res) => res.json(db.prepare('SELECT i.*, c.name category FROM items i JOIN categories c ON c.id = i.category_id ORDER BY c.sort, i.sort').all()));
  app.patch('/api/admin/items/:id', admin, wrap((req, res) => {
    const allowed = { name: 'string', description: 'string', price_cents: 'number', active: 'number', prep_min: 'number', image: 'string', emoji: 'string' };
    const sets = []; const vals = [];
    for (const [k, t] of Object.entries(allowed)) if (k in req.body) {
      const v = req.body[k];
      if (t === 'number' && (!Number.isFinite(v) || v < 0)) return res.status(400).json({ error: `Bloga reikšmė: ${k}` });
      sets.push(`${k} = ?`); vals.push(t === 'number' ? v : String(v ?? '').slice(0, 500));
    }
    if (!sets.length) return res.status(400).json({ error: 'Nėra ką keisti' });
    db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...vals, Number(req.params.id));
    res.json(q.item.get(Number(req.params.id)));
  }));

  app.get('/api/admin/promos', admin, (_req, res) => res.json(db.prepare('SELECT * FROM promos ORDER BY code').all()));
  app.post('/api/admin/promos', admin, wrap((req, res) => {
    const b = req.body; const code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) return res.status(400).json({ error: 'Kodas: 3–20 raidžių/skaičių' });
    if (!['percent', 'fixed', 'free_delivery'].includes(b.kind)) return res.status(400).json({ error: 'Blogas tipas' });
    db.prepare('INSERT INTO promos(code, kind, value, min_subtotal_cents, max_uses, expires_at, first_order_only, label) VALUES(?,?,?,?,?,?,?,?)')
      .run(code, b.kind, Number(b.value) || 0, Number(b.min_subtotal_cents) || 0, b.max_uses ? Number(b.max_uses) : null, b.expires_at || null, b.first_order_only ? 1 : 0, b.label || null);
    res.status(201).json(q.promo.get(code));
  }));
  app.patch('/api/admin/promos/:code', admin, (req, res) => {
    db.prepare('UPDATE promos SET active = ? WHERE code = ?').run(req.body.active ? 1 : 0, req.params.code);
    res.json(q.promo.get(req.params.code));
  });

  app.get('/api/admin/deals', admin, (_req, res) => res.json(db.prepare(`SELECT d.*, i.name item_name, i.price_cents FROM deals d
    JOIN items i ON i.id = d.item_id ORDER BY d.active DESC, d.id`).all()));
  app.post('/api/admin/deals', admin, wrap((req, res) => {
    const b = req.body; const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const hm = (t) => (t ? (/^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null) : null);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(Number(b.item_id))) return res.status(400).json({ error: 'Pasirinkite patiekalą' });
    if (!['percent', 'fixed'].includes(b.kind)) return res.status(400).json({ error: 'Blogas tipas' });
    const value = Math.round(Number(b.value));
    if (!(value > 0) || (b.kind === 'percent' && value > 90)) return res.status(400).json({ error: 'Nuolaida: 1–90 % arba suma > 0' });
    const title = String(b.title || '').trim().slice(0, 40);
    if (title.length < 3) return res.status(400).json({ error: 'Įveskite pavadinimą' });
    const days = Array.isArray(b.days) && b.days.length && b.days.length < 7 ? b.days.filter((d) => DAYS.includes(d)) : null;
    if ((b.start_time && !hm(b.start_time)) || (b.end_time && !hm(b.end_time))) return res.status(400).json({ error: 'Laikas formatu HH:MM' });
    if (hm(b.start_time) && hm(b.end_time) && b.start_time >= b.end_time) return res.status(400).json({ error: 'Pabaiga turi būti po pradžios' });
    const id = Number(db.prepare('INSERT INTO deals(item_id, kind, value, title, days, start_time, end_time) VALUES(?,?,?,?,?,?,?)')
      .run(Number(b.item_id), b.kind, value, title, days ? JSON.stringify(days) : null, hm(b.start_time), hm(b.end_time)).lastInsertRowid);
    res.status(201).json(db.prepare('SELECT * FROM deals WHERE id = ?').get(id));
  }));
  app.patch('/api/admin/deals/:id', admin, (req, res) => {
    db.prepare('UPDATE deals SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, Number(req.params.id));
    res.json(db.prepare('SELECT * FROM deals WHERE id = ?').get(Number(req.params.id)));
  });

  app.patch('/api/admin/stores/:id', admin, wrap((req, res) => {
    const allowed = ['delivery_fee_cents', 'free_delivery_over_cents', 'min_order_cents', 'slot_capacity', 'prep_stations', 'delivery_radius_km', 'paused'];
    for (const k of allowed) if (k in req.body) {
      const v = Number(req.body[k]);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `Bloga reikšmė: ${k}` });
      db.prepare(`UPDATE stores SET ${k} = ? WHERE id = ?`).run(v, Number(req.params.id));
    }
    res.json(storeView(q.store.get(Number(req.params.id))));
  }));

  // ---------- static PWA ----------
  const dist = path.join(ROOT, 'web', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, setHeaders: (res, p) => {
      if (p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
      else if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Nerasta' }));
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'server', 'index.js')) {
  const port = Number(process.env.PORT || 3001);
  const app = await createApp();
  app.listen(port, '0.0.0.0', () => console.log(`Food app on port ${port}  (payments: ${paymentMode()})`));
}
