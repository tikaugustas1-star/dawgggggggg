// Server-authoritative pricing: modifiers, promos, rewards, loyalty points.
// The client sends only ids + quantities; every cent is recomputed here.

export class PricingError extends Error {
  constructor(message, code = 'PRICING') { super(message); this.code = code; this.status = 400; }
}

/**
 * Validate a configured item and compute its unit price.
 * @param item {id, name, price_cents, active}
 * @param groups [{id, name, min, max, options:[{id, name, price_delta_cents}]}]
 * @param selected array of option ids
 */
export function priceLine(item, groups, selected = [], qty = 1) {
  if (!item || !item.active) throw new PricingError('Prekė nebeprieinama', 'ITEM_UNAVAILABLE');
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new PricingError('Netinkamas kiekis', 'BAD_QTY');
  const sel = new Set(selected.map(Number));
  const chosen = [];
  const known = new Set();
  for (const g of groups) {
    const picked = g.options.filter((o) => sel.has(o.id));
    picked.forEach((o) => known.add(o.id));
    if (picked.length < g.min) throw new PricingError(`Pasirinkite: ${g.name}`, 'OPTION_MIN');
    if (picked.length > g.max) throw new PricingError(`Per daug pasirinkimų: ${g.name}`, 'OPTION_MAX');
    for (const o of picked) chosen.push({ id: o.id, group: g.name, name: o.name, delta: o.price_delta_cents });
  }
  for (const id of sel) if (!known.has(id)) throw new PricingError('Nežinomas pasirinkimas', 'OPTION_UNKNOWN');
  const unit = item.price_cents + chosen.reduce((s, o) => s + o.delta, 0);
  return { unit, qty, total: unit * qty, options: chosen };
}

/** @returns {ok, discount, freeDelivery, reason, label} */
export function evaluatePromo(promo, { subtotal, deliveryFee, isFirstOrder, now = new Date() }) {
  if (!promo || !promo.active) return { ok: false, reason: 'Kodas negalioja' };
  if (promo.expires_at && new Date(promo.expires_at) < now) return { ok: false, reason: 'Kodo galiojimas baigėsi' };
  if (promo.max_uses != null && promo.used >= promo.max_uses) return { ok: false, reason: 'Kodas išnaudotas' };
  if (promo.first_order_only && !isFirstOrder) return { ok: false, reason: 'Tik pirmam užsakymui' };
  if (subtotal < promo.min_subtotal_cents)
    return { ok: false, reason: `Minimali suma ${(promo.min_subtotal_cents / 100).toFixed(2)} €` };
  let discount = 0; let freeDelivery = false;
  if (promo.kind === 'percent') discount = Math.round((subtotal * Math.min(promo.value, 100)) / 100);
  else if (promo.kind === 'fixed') discount = Math.min(promo.value, subtotal);
  else if (promo.kind === 'free_delivery') freeDelivery = deliveryFee > 0;
  return { ok: true, discount, freeDelivery, label: promo.label || promo.code };
}

/**
 * Totals. Order of application: subtotal → promo → reward → delivery → tip.
 * Points are earned on what the customer pays for food (excl. delivery and tip).
 */
export function computeTotals({ lines, deliveryFee = 0, freeDeliveryOver = Infinity, promoResult = null,
  reward = null, userPoints = 0, tipPercent = 0, pointsPerEuro = 10 }) {
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  let discount = promoResult?.ok ? promoResult.discount : 0;
  let fee = subtotal >= freeDeliveryOver ? 0 : deliveryFee;
  if (promoResult?.ok && promoResult.freeDelivery) fee = 0;
  let rewardCents = 0; let pointsSpent = 0;
  if (reward) {
    if (userPoints < reward.cost_points) throw new PricingError('Nepakanka taškų', 'POINTS');
    rewardCents = Math.min(reward.value_cents, subtotal - discount);
    pointsSpent = reward.cost_points;
  }
  const food = Math.max(0, subtotal - discount - rewardCents);
  const tip = Math.round((food * Math.max(0, Math.min(tipPercent, 30))) / 100);
  const total = food + fee + tip;
  const pointsEarned = Math.floor((food / 100) * pointsPerEuro);
  return { subtotal, discount, rewardCents, deliveryFee: fee, tip, total, pointsEarned, pointsSpent };
}
