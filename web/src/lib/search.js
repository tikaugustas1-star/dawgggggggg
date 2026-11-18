// Typo-tolerant, diacritic-insensitive menu search ("sasl" finds "Šaltalankių", "burgr" finds "burgeris").
const MAP = { ą: 'a', č: 'c', ę: 'e', ė: 'e', į: 'i', š: 's', ų: 'u', ū: 'u', ž: 'z' };
export const fold = (s) => String(s).toLowerCase().replace(/[ąčęėįšųūž]/g, (c) => MAP[c]).normalize('NFD').replace(/[̀-ͯ]/g, '');
const tokens = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

// Optimal string alignment (Damerau-Levenshtein) with early exit.
export function osa(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

function termScore(term, words) {
  let best = 0;
  for (const w of words) {
    if (w === term) return 3;
    if (w.startsWith(term)) best = Math.max(best, 2.5);
    else if (term.length >= 3) {
      const allowed = term.length >= 6 ? 2 : 1;
      const prefix = w.slice(0, Math.max(term.length, 1));
      if (osa(term, prefix, allowed) <= allowed) best = Math.max(best, 1.5);
      else if (w.includes(term)) best = Math.max(best, 1);
    }
  }
  return best;
}

export function search(items, query) {
  const terms = tokens(query);
  if (!terms.length) return items;
  return items
    .map((it) => {
      const name = tokens(it.name); const rest = tokens(`${it.description} ${(it.tags || []).join(' ')}`);
      let s = 0;
      for (const t of terms) {
        const n = termScore(t, name); const r = termScore(t, rest) * 0.5;
        if (!n && !r) return null; // every term must match somewhere
        s += Math.max(n * 1.5, r);
      }
      return { it, s };
    })
    .filter(Boolean)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.it);
}
