// Cart cross-sell: association rules (confidence × lift) + category-gap rule + curated pairings.

export function buildAssociations(baskets) {
  const single = new Map(); const pair = new Map(); let n = 0;
  const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (const raw of baskets) {
    const b = [...new Set(raw)];
    if (!b.length) continue;
    n++;
    for (const a of b) single.set(a, (single.get(a) || 0) + 1);
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      const k = key(b[i], b[j]); pair.set(k, (pair.get(k) || 0) + 1);
    }
  }
  const both = (a, b) => pair.get(key(a, b)) || 0;
  return {
    n,
    support: (a) => single.get(a) || 0,
    both,
    confidence: (a, b) => (single.get(a) ? both(a, b) / single.get(a) : 0),
    lift(a, b) {
      const sa = single.get(a) || 0; const sb = single.get(b) || 0;
      if (!sa || !sb || both(a, b) < 3) return 0;
      return (both(a, b) / sa) / (sb / n);
    },
  };
}

// Roles a full meal usually has, in the order we'd nudge them.
const MEAL_ROLES = ['side', 'drink', 'dessert'];

/**
 * @param cartIds item ids in cart
 * @param items Map<id, {id, role, active}>
 * @param pairings Map<id, Set<id>> admin-curated
 * @param unavailable Set<id> sold-out or inactive
 */
export function suggest({ cartIds, items, assoc, pairings = new Map(), unavailable = new Set(), limit = 3 }) {
  if (!cartIds.length) return [];
  const inCart = new Set(cartIds);
  const rolesInCart = new Set(cartIds.map((id) => items.get(id)?.role));
  const hasMain = rolesInCart.has('main');
  const missingRoles = hasMain ? MEAL_ROLES.filter((r) => !rolesInCart.has(r)) : [];
  const scored = [];
  for (const [id, it] of items) {
    if (inCart.has(id) || unavailable.has(id) || !it.active) continue;
    let rule = 0; let reason = null;
    for (const a of cartIds) {
      const lift = assoc ? assoc.lift(a, id) : 0;
      if (lift > 1) {
        const s = assoc.confidence(a, id) * Math.log2(1 + lift);
        if (s > rule) { rule = s; reason = 'often_together'; }
      }
    }
    const gapIdx = missingRoles.indexOf(it.role);
    const gap = gapIdx >= 0 ? 1 - gapIdx * 0.2 : 0;
    const curated = cartIds.some((a) => pairings.get(a)?.has(id)) ? 1 : 0;
    const score = rule + 0.35 * gap + 0.25 * curated;
    if (score <= 0) continue;
    if (!reason) reason = curated ? 'chef_pick' : 'complete_meal';
    scored.push({ id, score: +score.toFixed(4), reason, role: it.role });
  }
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  // diversity: at most one suggestion per role
  const out = []; const seen = new Set();
  for (const s of scored) {
    if (seen.has(s.role)) continue;
    seen.add(s.role); out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
