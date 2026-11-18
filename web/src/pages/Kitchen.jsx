import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../lib/app.jsx';
import { api, hhmm, eur, dayLabel } from '../lib/api.js';
import { Switch, Photo, Icon } from '../components/ui.jsx';
import { StaffHead, StaffLogin } from '../components/staff.jsx';

const NEXT = {
  placed: [['accepted', 'Priimti']], accepted: [['preparing', 'Pradėti gaminti']], preparing: [['ready', 'Paruošta']],
  ready: { pickup: [['completed', 'Atiduota klientui']], delivery: [['out_for_delivery', 'Išvežta']] }, out_for_delivery: [['completed', 'Pristatyta']],
};
const LANES = [['Nauji', ['placed']], ['Gaminama', ['accepted', 'preparing']], ['Išduoti', ['ready', 'out_for_delivery']]];
const STATUS_LT = { accepted: 'Priimta', preparing: 'Gaminama', ready: 'Paruošta', out_for_delivery: 'Pakeliui' };

// One shared AudioContext: browsers cap how many can exist, so a new one per order would go silent.
let audioCtx = null;
function beep() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    [0, 0.18].forEach((t) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16); });
  } catch { /* audio blocked until first interaction */ }
}

function Ticket({ o, now, fresh, itemsById, onMove }) {
  const due = o.scheduledFor ? new Date(o.scheduledFor).getTime() : new Date(o.createdAt).getTime() + o.etaMax * 60000;
  const left = Math.round((due - now) / 60000);
  const waiting = ['ready', 'out_for_delivery'].includes(o.status);
  const late = !waiting && left < 0; const soon = !waiting && left >= 0 && left < 6;
  const actions = Array.isArray(NEXT[o.status]) ? NEXT[o.status] : NEXT[o.status]?.[o.fulfillment] || [];
  const timeStatus = o.scheduledFor && left > 30
    ? <span className="status dark"><Icon.clock />{dayLabel(o.scheduledFor)} {hhmm(o.scheduledFor)}</span>
    : late ? <span className="status bad"><Icon.clock />Vėluoja {-left} min</span>
    : soon ? <span className="status warn"><Icon.clock />Liko {left} min</span>
    : <span className="status"><Icon.clock />Iki {hhmm(new Date(due).toISOString())}</span>;
  return (
    <article className={`ticket${late ? ' late' : soon ? ' soon' : ''}${fresh ? ' fresh' : ''}`}>
      <div className="row between">
        <span className="code">{o.code}</span>
        <span className="row" style={{ gap: 6 }}>
          {STATUS_LT[o.status] && <span className="status">{STATUS_LT[o.status]}</span>}
          <span className="status">{o.fulfillment === 'delivery' ? 'Pristatymas' : 'Atsiėmimas'}</span>
        </span>
      </div>
      <div className="row between small"><span className="ell"><b>{o.customerName}</b> <span className="muted">· {o.customerPhone}</span></span>{timeStatus}</div>
      <div className="col" style={{ gap: 8 }}>
        {o.items.map((i) => (
          <div key={i.id} className="tline">
            <Photo item={itemsById.get(i.item_id)} w={46} h={46} className="thumb" />
            <div className="grow" style={{ minWidth: 0 }}>
              <b className="ell">{i.name}</b>
              {i.options.length > 0 && <div className="mods">{i.options.map((x) => x.name).join(' · ')}</div>}
              {i.note && <div className="mods" style={{ color: 'var(--bad)' }}>Pastaba: {i.note}</div>}
            </div>
            <span className="q">{i.qty}×</span>
          </div>
        ))}
      </div>
      {o.notes && <div className="notice small">{o.notes}</div>}
      {o.fulfillment === 'delivery' && <div className="row small muted" style={{ gap: 6 }}><span style={{ display: 'flex', width: 16 }}><Icon.pin /></span>{o.address}</div>}
      <div className="row between small"><span className="muted">{eur(o.total)}</span>
        {o.paymentStatus === 'demo' ? <span className="status bad">DEMO · nesumokėta</span>
          : <span className={`status${o.paymentStatus === 'paid' ? '' : ' warn'}`}>{o.paymentStatus === 'paid' ? 'Apmokėta' : 'Mokės atsiimant'}</span>}</div>
      <div className="row" style={{ gap: 8 }}>
        {actions.map(([s, label]) => <button key={s} className="btn grow" onClick={() => onMove(o, s)}>{label}</button>)}
        {['placed', 'accepted', 'preparing', 'ready'].includes(o.status) && (
          <button className="circle" style={{ boxShadow: 'inset 0 0 0 1px var(--line)', width: 52, height: 52 }} aria-label={`Atšaukti ${o.code}`}
            onClick={() => confirm(`Atšaukti ${o.code}?`) && onMove(o, 'cancelled')}><Icon.close /></button>
        )}
      </div>
    </article>
  );
}

export default function Kitchen() {
  const { me, stores, menu, itemsById, refreshMenu, refreshStores } = useApp();
  const [storeId, setStoreId] = useState(() => Number(localStorage.getItem('kitchen.store')) || 1);
  const [orders, setOrders] = useState([]);
  const [fresh, setFresh] = useState(new Set());
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState('orders');
  const [err, setErr] = useState(null);
  const [paused, setPaused] = useState(false);
  const known = useRef(new Set());
  const store = stores.find((s) => s.id === storeId);
  const staff = me.user && ['staff', 'admin'].includes(me.user.role);
  useEffect(() => setPaused(!!store?.paused), [store]);
  useEffect(() => { // browsers only allow sound after a user gesture: unlock it on the first tap
    const unlock = () => { try { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* */ } };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    if (!staff) return;
    localStorage.setItem('kitchen.store', storeId);
    known.current = new Set();
    const loadBoard = () => api.get(`/api/kitchen/${storeId}/orders`).then((os) => { os.forEach((o) => known.current.add(o.id)); setOrders(os); }).catch((e) => setErr(e.message));
    loadBoard();
    const es = new EventSource(`/api/kitchen/${storeId}/stream`);
    let first = true;
    es.addEventListener('open', () => { if (!first) loadBoard(); first = false; }); // resync after a dropped connection
    es.addEventListener('order', (e) => {
      const o = JSON.parse(e.data);
      setOrders((prev) => { const i = prev.findIndex((x) => x.id === o.id); if (i < 0) return [...prev, o]; const n = [...prev]; n[i] = o; return n; });
      if (o.status === 'placed' && !known.current.has(o.id)) {
        known.current.add(o.id); beep(); setFresh((s) => new Set(s).add(o.id));
        setTimeout(() => setFresh((s) => { const n = new Set(s); n.delete(o.id); return n; }), 4000);
      }
    });
    es.addEventListener('menu', () => refreshMenu());
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => { es.close(); clearInterval(t); };
  }, [storeId, staff]); // eslint-disable-line

  async function move(o, status) {
    try { const u = await api.post(`/api/kitchen/orders/${o.id}/status`, { status }); setOrders((p) => p.map((x) => (x.id === u.id ? u : x))); }
    catch (e) { setErr(e.message); }
  }
  async function togglePause() { const s = await api.post(`/api/kitchen/${storeId}/pause`, { paused: !paused }); setPaused(s.paused); refreshStores(); }
  async function soldOut(it) { await api.post(`/api/kitchen/${storeId}/sold-out`, { itemId: it.id, soldOut: !it.soldOut }); refreshMenu(); }

  const lanes = useMemo(() => LANES.map(([title, sts]) => [title, orders.filter((o) => sts.includes(o.status))
    .sort((a, b) => a.slotStart.localeCompare(b.slotStart) || a.id - b.id)]), [orders]);
  const doneToday = orders.filter((o) => o.status === 'completed').length;
  const soldCount = (menu?.items || []).filter((i) => i.soldOut).length;

  if (!staff) return <StaffLogin title="Virtuvės ekranas" next="/kitchen" />;
  const today = new Date(now).toLocaleDateString('lt-LT', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="staff">
      <StaffHead title="Virtuvė" sub={`${store?.name || ''} · ${today} · ${hhmm(new Date(now).toISOString())}`} />
      <div className="staff-bar">
        <div className="chips" style={{ margin: 0, padding: 0 }}>
          {stores.map((s) => <button key={s.id} className={`chip${s.id === storeId ? ' on' : ''}`} onClick={() => setStoreId(s.id)}>{s.name}</button>)}
        </div>
        <div className="grow" />
        <div className="tabs" style={{ gap: 6 }}>
          <button className={`chip${view === 'orders' ? ' on' : ''}`} onClick={() => setView('orders')}>Užsakymai</button>
          <button className={`chip${view === 'menu' ? ' on' : ''}`} onClick={() => setView('menu')}>Išparduota{soldCount ? ` · ${soldCount}` : ''}</button>
        </div>
        <span className="chip" style={{ gap: 10, paddingRight: 6 }}>{paused ? 'Pristabdyta' : 'Priimame'}<Switch on={!paused} onClick={togglePause} label="Priimti naujus užsakymus" /></span>
      </div>

      <div className="staff-body">
        {err && <div className="notice bad row between"><span>{err}</span><button className="link" onClick={() => setErr(null)}>Uždaryti</button></div>}
        {paused && <div className="notice bad">Nauji užsakymai pristabdyti. Klientai mato, kad restoranas laikinai nepriima užsakymų.</div>}

        {view === 'menu' ? (
          <section className="panel">
            <div className="panel-head"><h2>Ko šiandien neturime?</h2><span className="small muted">Pažymėtas patiekalas klientams iškart rodomas kaip išparduotas</span></div>
            <div className="soldgrid">
              {menu?.items.map((it) => (
                <div key={it.id} className="rowcard">
                  <Photo item={it} w={54} h={46} className="thumb" out={it.soldOut} />
                  <div className="grow" style={{ minWidth: 0 }}><b className="ell small" style={{ display: 'block' }}>{it.name}</b>
                    <span className={`tiny ${it.soldOut ? 'err' : 'muted'}`}>{it.soldOut ? 'Išparduota' : 'Yra'}</span></div>
                  <Switch red on={it.soldOut} onClick={() => soldOut(it)} label={`${it.name} išparduota`} />
                </div>
              ))}
            </div>
          </section>
        ) : (
          <div className="board">
            {lanes.map(([title, list]) => (
              <section key={title} className="lane">
                <div className="lane-head"><h2>{title}</h2><span className={`badge${list.length ? '' : ' light'}`}>{list.length}</span></div>
                {list.length === 0 && <div className="lane-empty">Tuščia</div>}
                {list.map((o) => <Ticket key={o.id} o={o} now={now} fresh={fresh.has(o.id)} itemsById={itemsById} onMove={move} />)}
              </section>
            ))}
          </div>
        )}
        <p className="tiny muted" style={{ margin: 0, textAlign: 'center' }}>Įvykdyta per 18 val.: {doneToday} · nauji užsakymai pranešami garsu</p>
      </div>
    </div>
  );
}
