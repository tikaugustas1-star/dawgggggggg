import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../lib/app.jsx';
import { api, eur } from '../lib/api.js';
import { Switch, Photo, Icon } from '../components/ui.jsx';
import { StaffHead, StaffLogin } from '../components/staff.jsx';

const TABS = [['stats', 'Apžvalga'], ['items', 'Meniu'], ['promos', 'Akcijos'], ['stores', 'Restoranai']];
const WEEK = [['mon', 'Pr'], ['tue', 'An'], ['wed', 'Tr'], ['thu', 'Kt'], ['fri', 'Pn'], ['sat', 'Št'], ['sun', 'Sk']];
const PROMO_KIND = { percent: 'Procentai', fixed: 'Fiksuota suma', free_delivery: 'Nemokamas pristatymas' };

function Kpi({ k, v, sub, dark }) {
  return <div className={`kpi${dark ? ' dark' : ''}`}><span className="k">{k}</span><span className="v">{v}</span>{sub && <span className="tiny" style={{ opacity: .7 }}>{sub}</span>}</div>;
}

export default function Admin() {
  const { me, stores, notify, refreshMenu, itemsById, brand } = useApp();
  const [tab, setTab] = useState('stats');
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [promos, setPromos] = useState([]);
  const [deals, setDeals] = useState([]);
  const [nd, setNd] = useState({ item_id: '', kind: 'percent', value: 20, title: '', days: [], start_time: '', end_time: '' });
  const [q, setQ] = useState('');
  const [np, setNp] = useState({ code: '', kind: 'percent', value: 10, min_subtotal_cents: 0, label: '' });
  const [storeEdits, setStoreEdits] = useState({});
  const [storeList, setStoreList] = useState([]);
  const ok = me.user?.role === 'admin';

  const load = () => {
    api.get('/api/admin/stats').then(setStats);
    api.get('/api/admin/items').then(setItems);
    api.get('/api/admin/promos').then(setPromos);
    api.get('/api/admin/deals').then(setDeals);
    api.get('/api/stores').then(setStoreList);
  };
  useEffect(() => { if (ok) load(); }, [ok]);

  const shownItems = useMemo(() => items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase())), [items, q]);
  if (!ok) return <StaffLogin title="Administravimas" next="/admin" />;

  async function saveItem(it, patch) {
    try { const u = await api.patch(`/api/admin/items/${it.id}`, patch); setItems((p) => p.map((x) => (x.id === it.id ? { ...x, ...u } : x))); refreshMenu(); notify('Išsaugota'); }
    catch (e) { notify(e.message, 'bad'); }
  }
  async function createPromo(e) {
    e.preventDefault();
    try {
      const body = { ...np, value: np.kind === 'fixed' ? Math.round(np.value * 100) : Number(np.value), min_subtotal_cents: Math.round(Number(np.min_subtotal_cents) * 100) };
      await api.post('/api/admin/promos', body); setNp({ ...np, code: '', label: '' }); load(); notify('Kodas sukurtas');
    } catch (e2) { notify(e2.message, 'bad'); }
  }
  async function createDeal(e) {
    e.preventDefault();
    try {
      await api.post('/api/admin/deals', { ...nd, value: nd.kind === 'fixed' ? Math.round(Number(nd.value) * 100) : Number(nd.value) });
      setNd({ ...nd, title: '' }); load(); refreshMenu(); notify('Pasiūlymas sukurtas');
    } catch (e2) { notify(e2.message, 'bad'); }
  }
  const dealSchedule = (d) => {
    const days = d.days ? JSON.parse(d.days).map((k) => WEEK.find((w) => w[0] === k)?.[1]).join(', ') : 'Kasdien';
    return `${days} · ${d.start_time ? `${d.start_time}–${d.end_time || '24:00'}` : 'visą dieną'}`;
  };

  async function saveStore(s, extra = {}) {
    try {
      const u = await api.patch(`/api/admin/stores/${s.id}`, { ...(storeEdits[s.id] || {}), ...extra });
      setStoreList((p) => p.map((x) => (x.id === s.id ? { ...x, ...u } : x))); setStoreEdits((p) => ({ ...p, [s.id]: {} })); notify('Restorano nustatymai išsaugoti');
    } catch (e) { notify(e.message, 'bad'); }
  }

  const maxRev = Math.max(1, ...(stats?.days || []).map((d) => d.revenue));
  const maxTop = Math.max(1, ...(stats?.top || []).map((t) => t.qty));
  const promoValue = (p) => (p.kind === 'percent' ? `−${p.value} %` : p.kind === 'fixed' ? `−${eur(p.value)}` : 'Nemokamas pristatymas');

  return (
    <div className="staff">
      <StaffHead title="Administravimas" sub={`${brand?.name || ''} · ${stores.length} restoranai`} />
      <div className="staff-bar">
        <div className="chips" style={{ margin: 0, padding: 0 }}>
          {TABS.map(([k, l]) => <button key={k} className={`chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      </div>

      <div className="staff-body">
        {tab === 'stats' && !stats && <div className="skeleton" style={{ height: 300 }} />}
        {tab === 'stats' && stats && (<>
          <div className="kpis">
            <Kpi dark k="Apyvarta šiandien" v={eur(stats.today.revenue)} sub={`${stats.today.orders} užsakymai`} />
            <Kpi k="Vidutinis krepšelis" v={eur(Math.round(stats.today.avg))} />
            <Kpi k="Prekių užsakyme" v={(stats.itemsPerOrder || 0).toFixed(2)} sub="Rodo, kiek veikia upsell" />
            <Kpi k="Laiko prognozės paklaida" v={stats.etaAccuracy.n ? `±${stats.etaAccuracy.mae.toFixed(1)} min` : '—'} sub={`${stats.etaAccuracy.n} appso užsakymų`} />
          </div>
          <div className="two">
            <section className="panel">
              <div className="panel-head"><h2>Apyvarta, 14 d.</h2><span className="tiny muted">Įskaičiuoti ir sintetiniai demo duomenys</span></div>
              <div className="bars">
                {stats.days.map((d, i) => (
                  <div key={d.day} className={`b${i === stats.days.length - 1 ? ' last' : ''}`}>
                    <div data-l={`${eur(d.revenue)} · ${d.orders} užs.`} style={{ height: `${(d.revenue / maxRev) * 100}%` }} />
                    <span>{d.day.slice(8)}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Virtuvės kalibracija</h2><span className="status">Mokėjimai: {stats.payments}</span></div>
              <div className="rows">
                {stats.calibration.map((c) => (
                  <div key={c.store} className="rowcard" style={{ padding: '14px 16px' }}>
                    <span className="grow"><b className="small">{c.store}</b><span className="tiny muted" style={{ display: 'block' }}>{c.factor > 1 ? 'lėčiau nei bazinis laikas' : 'greičiau nei bazinis laikas'}</span></span>
                    <b style={{ fontSize: 20 }}>×{c.factor}</b>
                  </div>
                ))}
              </div>
              <p className="tiny muted" style={{ margin: 0 }}>Koeficientas mokosi iš realaus gaminimo laiko (EWMA). Pagal jį klientams rodomas laukimo laikas.</p>
            </section>
          </div>
          <section className="panel">
            <div className="panel-head"><h2>Populiariausi patiekalai, 30 d.</h2></div>
            <div className="rows">
              {stats.top.map((t, i) => (
                <div key={t.name} className="rowcard">
                  <span className="rank">{i + 1}</span>
                  <Photo item={itemsById.get(t.itemId)} w={54} h={46} className="thumb" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row between small"><b className="ell">{t.name}</b><span className="muted">{t.qty} vnt. · <b style={{ color: 'var(--ink)' }}>{eur(t.revenue)}</b></span></div>
                    <div className="minibar" style={{ marginTop: 6 }}><i style={{ width: `${(t.qty / maxTop) * 100}%` }} /></div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>)}

        {tab === 'items' && (
          <section className="panel">
            <div className="panel-head">
              <h2>Meniu · {items.length}</h2>
              <div className="searchbar" style={{ height: 46, boxShadow: 'inset 0 0 0 1px var(--line)', minWidth: 240 }}>
                <Icon.search /><input placeholder="Ieškoti" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ieškoti meniu" />
              </div>
            </div>
            <div className="row tiny muted" style={{ padding: '0 14px 0 74px', gap: 12 }}>
              <span className="grow">Patiekalas</span><span style={{ width: 100 }}>Kaina, €</span><span style={{ width: 84 }}>Gaminimas, min</span><span style={{ width: 48 }}>Rodomas</span>
            </div>
            <div className="rows">
              {shownItems.map((it) => (
                <div key={it.id} className="rowcard" style={{ opacity: it.active ? 1 : 0.55 }}>
                  <Photo item={it} w={54} h={46} className="thumb" />
                  <div className="grow" style={{ minWidth: 0 }}><b className="ell small" style={{ display: 'block' }}>{it.name}</b><span className="tiny muted">{it.category}</span></div>
                  <input className="input" style={{ width: 100 }} type="number" step="0.01" min="0" defaultValue={(it.price_cents / 100).toFixed(2)} aria-label={`${it.name} kaina`}
                    onBlur={(e) => { const v = Math.round(Number(e.target.value) * 100); if (v !== it.price_cents) saveItem(it, { price_cents: v }); }} />
                  <input className="input" style={{ width: 84 }} type="number" step="0.5" min="0" defaultValue={it.prep_min} aria-label={`${it.name} gaminimo laikas`}
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== it.prep_min) saveItem(it, { prep_min: v }); }} />
                  <span style={{ width: 48, display: 'flex' }}><Switch on={!!it.active} onClick={() => saveItem(it, { active: it.active ? 0 : 1 })} label={`${it.name} rodomas`} /></span>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'promos' && (<>
          <form className="panel" onSubmit={createDeal}>
            <div className="panel-head"><h2>Naujas patiekalo pasiūlymas</h2><span className="small muted">Rodomas pradžioje „Šiandienos pasiūlymai“, kaina taikoma automatiškai</span></div>
            <div className="formrow">
              <label className="field">Patiekalas<select className="input" value={nd.item_id} onChange={(e) => setNd({ ...nd, item_id: e.target.value })} required>
                <option value="">Pasirinkite…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name} · {eur(i.price_cents)}</option>)}</select></label>
              <label className="field">Tipas<select className="input" value={nd.kind} onChange={(e) => setNd({ ...nd, kind: e.target.value })}>
                <option value="percent">Procentai</option><option value="fixed">Suma, €</option></select></label>
              <label className="field">{nd.kind === 'percent' ? 'Nuolaida, %' : 'Nuolaida, €'}<input className="input" style={{ width: 110 }} type="number" min="0" step={nd.kind === 'fixed' ? '0.01' : '1'} value={nd.value} onChange={(e) => setNd({ ...nd, value: e.target.value })} /></label>
              <label className="field grow">Pavadinimas<input className="input" value={nd.title} onChange={(e) => setNd({ ...nd, title: e.target.value })} placeholder="pvz. Pietų pasiūlymas" required /></label>
            </div>
            <div className="formrow">
              <div className="field"><span>Dienos (nieko = kasdien)</span>
                <div className="row" style={{ gap: 6 }}>{WEEK.map(([k, l]) => {
                  const on = nd.days.includes(k);
                  return <button type="button" key={k} className={`chip sm${on ? ' on' : ''}`} onClick={() => setNd({ ...nd, days: on ? nd.days.filter((x) => x !== k) : [...nd.days, k] })}>{l}</button>;
                })}</div></div>
              <label className="field">Nuo<input className="input" style={{ width: 120 }} type="time" value={nd.start_time} onChange={(e) => setNd({ ...nd, start_time: e.target.value })} /></label>
              <label className="field">Iki<input className="input" style={{ width: 120 }} type="time" value={nd.end_time} onChange={(e) => setNd({ ...nd, end_time: e.target.value })} /></label>
              <button className="btn" style={{ height: 54 }}>Sukurti</button>
            </div>
          </form>
          <section className="panel">
            <div className="panel-head"><h2>Patiekalų pasiūlymai · {deals.length}</h2></div>
            <div className="rows">
              {deals.map((d) => (
                <div key={d.id} className="rowcard" style={{ opacity: d.active ? 1 : 0.55 }}>
                  <Photo item={itemsById.get(d.item_id)} w={54} h={46} className="thumb" />
                  <div className="grow" style={{ minWidth: 0 }}><b className="small ell" style={{ display: 'block' }}>{d.title} · {d.item_name}</b>
                    <span className="tiny muted">{dealSchedule(d)}</span></div>
                  <span className="deal-badge" style={{ position: 'static' }}>{d.kind === 'percent' ? `−${d.value} %` : `−${eur(d.value)}`}</span>
                  <Switch on={!!d.active} onClick={() => api.patch(`/api/admin/deals/${d.id}`, { active: !d.active }).then(() => { load(); refreshMenu(); })} label={`${d.title} aktyvus`} />
                </div>
              ))}
            </div>
          </section>

          <form className="panel" onSubmit={createPromo}>
            <div className="panel-head"><h2>Naujas nuolaidos kodas</h2></div>
            <div className="formrow">
              <label className="field">Kodas<input className="input" style={{ width: 150 }} value={np.code} onChange={(e) => setNp({ ...np, code: e.target.value.toUpperCase() })} required /></label>
              <label className="field">Tipas<select className="input" value={np.kind} onChange={(e) => setNp({ ...np, kind: e.target.value })}>
                {Object.entries(PROMO_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              {np.kind !== 'free_delivery' && <label className="field">{np.kind === 'percent' ? 'Nuolaida, %' : 'Nuolaida, €'}<input className="input" style={{ width: 110 }} type="number" min="0" step={np.kind === 'fixed' ? '0.01' : '1'} value={np.value} onChange={(e) => setNp({ ...np, value: e.target.value })} /></label>}
              <label className="field">Min. suma, €<input className="input" style={{ width: 110 }} type="number" min="0" value={np.min_subtotal_cents} onChange={(e) => setNp({ ...np, min_subtotal_cents: e.target.value })} /></label>
              <label className="field grow">Aprašas klientui<input className="input" value={np.label} onChange={(e) => setNp({ ...np, label: e.target.value })} placeholder="pvz. −5 € nuo 20 €" /></label>
              <button className="btn" style={{ height: 54 }}>Sukurti</button>
            </div>
          </form>
          <section className="panel">
            <div className="panel-head"><h2>Kodai · {promos.length}</h2></div>
            <div className="rows">
              {promos.map((p) => (
                <div key={p.code} className="rowcard" style={{ padding: '12px 16px', opacity: p.active ? 1 : 0.55 }}>
                  <span className="status dark" style={{ height: 32, fontSize: 13 }}>{p.code}</span>
                  <div className="grow" style={{ minWidth: 0 }}><b className="small ell" style={{ display: 'block' }}>{p.label || promoValue(p)}</b>
                    <span className="tiny muted">{promoValue(p)}{p.min_subtotal_cents ? ` · nuo ${eur(p.min_subtotal_cents)}` : ''}{p.first_order_only ? ' · tik pirmam užsakymui' : ''}</span></div>
                  <span className="small muted">Panaudota {p.used}{p.max_uses ? ` / ${p.max_uses}` : ''}</span>
                  <Switch on={!!p.active} onClick={() => api.patch(`/api/admin/promos/${p.code}`, { active: !p.active }).then(load)} label={`${p.code} aktyvus`} />
                </div>
              ))}
            </div>
          </section>
        </>)}

        {tab === 'stores' && (storeList.length ? storeList : stores).map((s) => {
          const e = storeEdits[s.id] || {};
          const set = (k, v) => setStoreEdits((p) => ({ ...p, [s.id]: { ...(p[s.id] || {}), [k]: v } }));
          const F = ({ k, label, cents, def }) => (
            <label className="field" key={k}>{label}<input className="input" style={{ width: 140 }} type="number" min="0" step={cents ? '0.01' : '1'}
              defaultValue={cents ? (def / 100).toFixed(2) : def} onChange={(ev) => set(k, cents ? Math.round(Number(ev.target.value) * 100) : Number(ev.target.value))} /></label>);
          return (
            <section key={s.id} className="panel">
              <div className="panel-head">
                <div><h2>{s.name}</h2><span className="small muted">{s.address}</span></div>
                <span className="row small" style={{ gap: 10 }}><span className={`status${s.open ? '' : ' bad'}`}>{s.paused ? 'Pristabdyta' : s.open ? 'Atidaryta' : 'Uždaryta'}</span>
                  Priima užsakymus <Switch on={!s.paused} onClick={() => saveStore(s, { paused: s.paused ? 0 : 1 })} label="Priima užsakymus" /></span>
              </div>
              <div className="formrow">
                {F({ k: 'delivery_fee_cents', label: 'Pristatymas, €', cents: true, def: s.deliveryFee })}
                {F({ k: 'free_delivery_over_cents', label: 'Nemokamai nuo, €', cents: true, def: s.freeDeliveryOver })}
                {F({ k: 'min_order_cents', label: 'Min. užsakymas, €', cents: true, def: s.minOrder })}
                {F({ k: 'delivery_radius_km', label: 'Pristatymo zona, km', def: s.deliveryRadiusKm })}
                <button className="btn" style={{ height: 54 }} disabled={!Object.keys(e).length} onClick={() => saveStore(s)}>Išsaugoti</button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
