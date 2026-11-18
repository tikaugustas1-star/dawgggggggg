// One-tap reorder (Easy Order-style): rebuild a past order against today's menu.
// Prices are NOT copied; options that no longer exist or sold-out items are dropped and reported.

export function rebuildCart(pastLines, { items, groupsByItem, unavailable = new Set() }) {
  const lines = []; const dropped = [];
  for (const l of pastLines) {
    const it = items.get(l.item_id);
    if (!it || !it.active || unavailable.has(l.item_id)) { dropped.push({ name: l.name, why: 'unavailable' }); continue; }
    const valid = new Set((groupsByItem.get(l.item_id) || []).flatMap((g) => g.options.map((o) => o.id)));
    const opts = JSON.parse(l.options_json || '[]').map((o) => o.id);
    if (opts.some((id) => !valid.has(id))) { dropped.push({ name: l.name, why: 'options_changed' }); continue; }
    lines.push({ itemId: l.item_id, qty: l.qty, optionIds: opts, note: l.note || '' });
  }
  return { lines, dropped };
}
