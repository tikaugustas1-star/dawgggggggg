// Item-level deals ("Šiandienos pasiūlymai"): percent/fixed price cuts limited to weekdays and a daily time window,
// evaluated in store-local time. The deal that saves the customer most wins.
import { localParts } from './time.js';

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const ymd = (p) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;

/** Discounted base price (options are never discounted). */
export function applyDeal(priceCents, deal) {
  if (!deal) return priceCents;
  const cut = deal.kind === 'percent' ? Math.round((priceCents * Math.min(100, deal.value)) / 100) : deal.value;
  return Math.max(0, priceCents - cut);
}

/** State of a deal on the local day of `at`: 'active' | 'upcoming' | 'ended' | 'off' (not valid that day). */
export function dealState(deal, at = new Date()) {
  if (!deal.active) return 'off';
  const p = localParts(at);
  const day = ymd(p);
  if (deal.starts_on && day < deal.starts_on) return 'off';
  if (deal.ends_on && day > deal.ends_on) return 'off';
  const days = deal.days ? JSON.parse(deal.days) : null;
  if (days && !days.includes(p.dow)) return 'off';
  const now = p.h * 60 + p.min;
  const from = deal.start_time ? toMin(deal.start_time) : 0;
  const to = deal.end_time ? toMin(deal.end_time) : 24 * 60;
  if (now < from) return 'upcoming';
  if (now >= to) return 'ended';
  return 'active';
}

/** Best deal active at `at` for an item, or null. */
export function activeDealFor(item, deals, at = new Date()) {
  let best = null; let bestPrice = item.price_cents;
  for (const d of deals) {
    if (d.item_id !== item.id || dealState(d, at) !== 'active') continue;
    const p = applyDeal(item.price_cents, d);
    if (p < bestPrice) { best = d; bestPrice = p; }
  }
  return best;
}

export const dealBadge = (d) => (d.kind === 'percent' ? `−${d.value} %` : `−${(d.value / 100).toFixed(2).replace('.', ',')} €`);
