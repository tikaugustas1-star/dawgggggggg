// Personal ranking (Deep Brew-style signals): recency-decayed personal frequency,
// daypart popularity, global popularity and affinity with the current cart.

const HALF_LIFE_DAYS = 30;
const W = { user: 0.45, daypart: 0.25, global: 0.15, cart: 0.15 };

const normalize = (map) => {
  const max = Math.max(0, ...map.values());
  const out = new Map();
  for (const [k, v] of map) out.set(k, max > 0 ? v / max : 0);
  return out;
};

export function userAffinity(history, now = new Date()) {
  const m = new Map();
  for (const h of history) {
    const ageDays = (now - new Date(h.created_at)) / 86400000;
    m.set(h.item_id, (m.get(h.item_id) || 0) + h.qty * 0.5 ** (ageDays / HALF_LIFE_DAYS));
  }
  return normalize(m);
}

/**
 * @param itemIds candidate item ids (already filtered for active / not sold-out)
 * @param history [{item_id, qty, created_at}] for this user
 * @param global Map<item_id, count>  @param daypartCounts Map<item_id, count> for current daypart
 * @param assoc association index from upsell.buildAssociations (optional)
 */
export function rank({ itemIds, history = [], global = new Map(), daypartCounts = new Map(), cartIds = [], assoc = null, now = new Date() }) {
  const U = userAffinity(history, now);
  const G = normalize(global);
  const D = normalize(daypartCounts);
  const C = new Map();
  if (assoc && cartIds.length) {
    for (const id of itemIds) {
      let best = 0;
      for (const a of cartIds) best = Math.max(best, assoc.lift(a, id));
      C.set(id, best);
    }
  }
  const Cn = normalize(C);
  const hasUser = U.size > 0;
  const w = hasUser ? W : { user: 0, daypart: 0.5, global: 0.3, cart: 0.2 };
  return itemIds
    .map((id) => {
      const parts = { user: U.get(id) || 0, daypart: D.get(id) || 0, global: G.get(id) || 0, cart: Cn.get(id) || 0 };
      const score = w.user * parts.user + w.daypart * parts.daypart + w.global * parts.global + w.cart * parts.cart;
      return { id, score: +score.toFixed(4), parts };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
}
