import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';

// Persistent cart: survives reloads, app switching and PWA relaunch (fixes the "cart wiped" complaint).
const KEY = 'cart.v1';
const Ctx = createContext(null);

const lineKey = (l) => `${l.itemId}|${[...l.optionIds].sort((a, b) => a - b).join(',')}|${l.note || ''}`;

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v?.lines) ? v : { lines: [] }; }
  catch { return { lines: [] }; }
}

function reducer(state, a) {
  switch (a.type) {
    case 'add': {
      const k = lineKey(a.line);
      const ex = state.lines.find((l) => lineKey(l) === k);
      const lines = ex
        ? state.lines.map((l) => (l === ex ? { ...l, qty: Math.min(50, l.qty + a.line.qty) } : l))
        : [...state.lines, { ...a.line, key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }];
      return { ...state, lines };
    }
    case 'qty': return { ...state, lines: state.lines.map((l) => (l.key === a.key ? { ...l, qty: a.qty } : l)).filter((l) => l.qty > 0) };
    case 'replace': return { ...state, lines: a.lines.map((l, i) => ({ ...l, key: `${Date.now()}-${i}` })) };
    case 'clear': return { lines: [] };
    default: return state;
  }
}

export function CartProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked */ } }, [state]);
  useEffect(() => {
    const sync = (e) => { if (e.key === KEY) dispatch({ type: 'replace', lines: load().lines }); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const value = useMemo(() => ({
    lines: state.lines,
    count: state.lines.reduce((s, l) => s + l.qty, 0),
    add: (line) => dispatch({ type: 'add', line }),
    setQty: (key, qty) => dispatch({ type: 'qty', key, qty }),
    replace: (lines) => dispatch({ type: 'replace', lines }),
    clear: () => dispatch({ type: 'clear' }),
  }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCart = () => useContext(Ctx);

/** Local price estimate for instant UI feedback; the server quote is authoritative. */
export function linePrice(line, item) {
  if (!item) return 0;
  const deltas = item.groups.flatMap((g) => g.options).filter((o) => line.optionIds.includes(o.id)).reduce((s, o) => s + o.delta, 0);
  return (item.price + deltas) * line.qty;
}
