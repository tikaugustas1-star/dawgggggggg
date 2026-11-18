import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
const PREF = 'prefs.v1';
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } };

export function applyTheme(t) {
  const r = document.documentElement.style;
  const map = { primary: '--primary', primaryInk: '--primary-ink', accent: '--accent', bg: '--bg', surface: '--surface',
    ink: '--ink', muted: '--muted', line: '--line', soft: '--soft', radius: '--radius', fontDisplay: '--font-display', fontBody: '--font-body' };
  for (const [k, v] of Object.entries(map)) if (t[k]) r.setProperty(v, t[k]);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.bg);
}

export function AppProvider({ children }) {
  const [brand, setBrand] = useState(null);
  const [stores, setStores] = useState([]);
  const [menu, setMenu] = useState(null);
  const [me, setMe] = useState({ user: null, favorites: [], rewards: [] });
  const [prefs, setPrefs] = useState(readPrefs);
  const [toast, setToast] = useState(null);

  const storeId = prefs.storeId || stores[0]?.id || 1;
  const fulfillment = prefs.fulfillment || 'pickup';
  const setPref = useCallback((p) => setPrefs((old) => {
    const n = { ...old, ...p }; try { localStorage.setItem(PREF, JSON.stringify(n)); } catch { /* ignore */ } return n;
  }), []);

  const refreshMe = useCallback(() => api.get('/api/me').then(setMe).catch(() => {}), []);
  const refreshMenu = useCallback(() => api.get(`/api/menu?storeId=${storeId}`).then(setMenu), [storeId]);

  // open/closed/paused changes during the day, so store status is refreshed every minute and on app focus
  const refreshStores = useCallback(() => api.get('/api/stores').then(setStores).catch(() => {}), []);
  useEffect(() => {
    api.get('/api/brand').then((b) => { setBrand(b); applyTheme(b.theme); document.title = `${b.name} — užsakyk`; });
    refreshStores(); refreshMe();
    const t = setInterval(refreshStores, 60000);
    const vis = () => { if (!document.hidden) refreshStores(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [refreshMe, refreshStores]);
  useEffect(() => { refreshMenu(); }, [refreshMenu]);

  const notify = useCallback((msg, kind = 'ok') => {
    const id = Date.now() + Math.random();
    setToast({ msg, kind, id });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 2600);
  }, []);

  const itemsById = useMemo(() => new Map((menu?.items || []).map((i) => [i.id, i])), [menu]);
  const store = stores.find((s) => s.id === storeId) || stores[0];

  const value = { brand, stores, store, storeId, fulfillment, setPref, menu, itemsById, refreshMenu, refreshStores, me, refreshMe, notify, toast };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);
