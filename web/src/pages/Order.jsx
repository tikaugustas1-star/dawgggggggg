import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, eur, hhmm, dayLabel } from '../lib/api.js';
import { useCart } from '../lib/cart.jsx';
import { useApp } from '../lib/app.jsx';
import { NavHead, Icon, Photo } from '../components/ui.jsx';

const LABEL = {
  placed: ['Užsakymas gautas', 'Restoranas netrukus patvirtins'],
  accepted: ['Patvirtinta', 'Virtuvė jau žino apie jūsų užsakymą'],
  preparing: ['Gaminama', 'Šefas jau prie keptuvės'],
  ready: ['Paruošta', 'Galite atsiimti'],
  out_for_delivery: ['Pakeliui', 'Kurjeris jau veža'],
  completed: ['Įvykdyta', 'Skanaus!'],
};
const FLOW = { pickup: ['placed', 'accepted', 'preparing', 'ready', 'completed'], delivery: ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'] };

export default function Order() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const { clear } = useCart();
  const { refreshMe, notify, itemsById } = useApp();
  const [o, setO] = useState(null);
  const [err, setErr] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const sid = params.get('session_id');
    api.get(`/api/orders/${token}${sid ? `?session_id=${encodeURIComponent(sid)}` : ''}`).then(setO).catch((e) => setErr(e.message));
    const es = new EventSource(`/api/orders/${token}/stream`);
    es.addEventListener('order', (e) => setO(JSON.parse(e.data)));
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => { es.close(); clearInterval(tick); };
  }, [token, params]);

  // clear the cart only once the order is really placed (keeps it if card payment was abandoned)
  useEffect(() => {
    if (!o || o.status === 'pending_payment') return;
    try { if (localStorage.getItem('lastOrderToken') === token) { clear(); localStorage.removeItem('lastOrderToken'); } } catch { /* */ }
    if (o.status === 'completed') refreshMe();
  }, [o?.status]); // eslint-disable-line

  useEffect(() => {
    if (o?.status === 'ready' && o.fulfillment === 'pickup') {
      navigator.vibrate?.([200, 100, 200]);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Užsakymas paruoštas!', { body: `${o.code} laukia ${o.store.name}` });
    }
  }, [o?.status]); // eslint-disable-line

  if (err) return <><NavHead title="Užsakymas" back="/" /><div className="page"><div className="notice bad">{err}</div></div></>;
  if (!o) return <><NavHead title="Užsakymas" back="/" /><div className="page"><div className="skeleton" style={{ height: 220 }} /></div></>;

  async function demoPay() { try { setO(await api.post(`/api/orders/${token}/demo-pay`)); } catch (e) { notify(e.message, 'bad'); } }
  async function cancel() {
    if (!confirm('Atšaukti užsakymą?')) return;
    try { setO(await api.post(`/api/orders/${token}/cancel`)); } catch (e) { notify(e.message, 'bad'); }
  }
  function askNotify() { Notification.requestPermission().then((p) => p === 'granted' && notify('Pranešime, kai bus paruošta')); }

  const flow = FLOW[o.fulfillment];
  const idx = flow.indexOf(o.status);
  const created = new Date(o.createdAt).getTime();
  const target = o.scheduledFor ? new Date(o.scheduledFor).getTime() : created + o.etaMax * 60000;
  const early = o.scheduledFor ? target : created + o.etaMin * 60000;
  const minsLeft = Math.max(0, Math.round((target - now) / 60000));
  const pct = o.status === 'completed' ? 100 : Math.max(8, Math.min(95, ((idx + 1) / flow.length) * 100));
  const heroItem = itemsById.get(o.items[0]?.item_id);
  const sub = `${o.store.name} · ${dayLabel(o.createdAt)} ${hhmm(o.createdAt)}`;

  return (
    <>
      <NavHead title={`Užsakymas ${o.code}`} sub={sub} back="/"
        right={<a className="circle" href={`tel:${o.store.phone}`} aria-label="Skambinti restoranui"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" /></svg></a>} />
      <div className="page" style={{ paddingBottom: o.status === 'pending_payment' ? 130 : 40 }}>
        {o.status === 'pending_payment' ? (
          <section className="acc white col" style={{ padding: 20, alignItems: 'center', textAlign: 'center', gap: 8 }}>
            <h2>Laukia apmokėjimo</h2><span className="muted">Suma {eur(o.total)}</span>
            <div className="notice" style={{ textAlign: 'left' }}><b>DEMO mokėjimas.</b> Stripe raktai nenustatyti, todėl pinigai nenuskaičiuojami. Paspaudus užsakymas bus perduotas virtuvei.</div>
            <button className="link" onClick={cancel}>Atšaukti užsakymą</button>
          </section>
        ) : o.status === 'cancelled' ? (
          <section className="acc white col" style={{ padding: 24, alignItems: 'center', textAlign: 'center' }}><h2>Užsakymas atšauktas</h2>
            {o.paymentStatus === 'refund_due' && <p className="muted" style={{ margin: 0 }}>Pinigai bus grąžinti į jūsų kortelę.</p>}
            <Link className="btn" to="/menu">Užsakyti iš naujo</Link></section>
        ) : (
          <section style={{ position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden', minHeight: 230, color: '#fff', display: 'flex' }}>
            <Photo item={heroItem} w={440} h={260} style={{ position: 'absolute', inset: 0 }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.7))' }} />
            <div className="col" style={{ position: 'relative', marginTop: 'auto', padding: 20, gap: 6, width: '100%' }}>
              <span className="small" style={{ opacity: .85 }}>{LABEL[o.status]?.[1]}</span>
              {o.status === 'completed' ? <div className="track-big">Skanaus!</div>
                : o.status === 'ready' && o.fulfillment === 'pickup' ? <div className="track-big">Paruošta</div>
                : o.scheduledFor ? <><span className="small"><b>{dayLabel(o.scheduledFor)}</b></span><div className="track-big">{hhmm(o.scheduledFor)}</div></>
                : <><div className="track-big">{hhmm(new Date(early).toISOString())}–{hhmm(new Date(target).toISOString())}</div><span className="small" style={{ opacity: .85 }}>apie {minsLeft} min.</span></>}
              <div className="progress" style={{ background: 'rgba(255,255,255,.25)', marginTop: 6 }}><i style={{ width: `${pct}%`, background: '#fff' }} /></div>
              <span className="pill on-photo" style={{ alignSelf: 'flex-start', marginTop: 4 }}><Icon.pin /> {o.fulfillment === 'pickup' ? o.store.address : o.address}</span>
            </div>
          </section>
        )}

        {o.status === 'ready' && o.fulfillment === 'pickup' && <div className="notice row between"><span>Pasakykite kodą prie kasos</span><b className="code">{o.code}</b></div>}

        {!['pending_payment', 'cancelled'].includes(o.status) && (
          <section className="col" style={{ gap: 12 }}>
            <h2 style={{ fontSize: 17 }}>Eiga</h2>
            {flow.map((s, i) => {
              const ev = o.events.find((e) => e.status === s);
              const done = i < idx || o.status === 'completed'; const nowS = i === idx && o.status !== 'completed';
              return (
                <div key={s} className={`stepcard${done ? ' done' : ''}${nowS ? ' now' : ''}`}>
                  <span className="num">{done ? <Icon.check /> : i + 1}</span>
                  <div className="grow"><span className="tiny muted">{i + 1} žingsnis{ev ? ` · ${hhmm(ev.at)}` : ''}</span>
                    <b style={{ display: 'block', color: i > idx ? 'var(--muted)' : undefined }}>{LABEL[s][0]}</b></div>
                </div>
              );
            })}
          </section>
        )}

        {'Notification' in window && Notification.permission === 'default' && ['placed', 'accepted', 'preparing'].includes(o.status) && (
          <button className="btn soft" onClick={askNotify}>Pranešti, kai bus paruošta</button>
        )}

        <section className="acc white" style={{ padding: 16, gap: 8 }}>
          <h3>Jūsų užsakymas</h3>
          {o.items.map((i) => (
            <div key={i.id} className="sum-row"><span>{i.qty}× {i.name}{i.options.length ? <span className="muted"> · {i.options.map((x) => x.name).join(', ')}</span> : ''}</span><span>{eur(i.line_total_cents)}</span></div>
          ))}
          <div className="divider" />
          {o.discount > 0 && <div className="sum-row okc"><span>Nuolaida {o.promoCode}</span><span>−{eur(o.discount)}</span></div>}
          {o.reward > 0 && <div className="sum-row okc"><span>Taškai</span><span>−{eur(o.reward)}</span></div>}
          {o.deliveryFee > 0 && <div className="sum-row"><span>Pristatymas</span><span>{eur(o.deliveryFee)}</span></div>}
          {o.tip > 0 && <div className="sum-row"><span>Arbatpinigiai</span><span>{eur(o.tip)}</span></div>}
          <div className="sum-row total"><span>Iš viso</span><span>{eur(o.total)}</span></div>
          <span className="tiny muted">{o.paymentMethod === 'card' ? (o.paymentStatus === 'paid' ? 'Apmokėta kortele' : 'Kortele') : 'Mokėsite atsiimdami'}
            {o.pointsEarned > 0 && ` · +${o.pointsEarned} tšk. po įvykdymo`}</span>
        </section>
        {o.status === 'placed' && <button className="btn ghost" onClick={cancel}>Atšaukti užsakymą</button>}
      </div>

      {o.status === 'pending_payment' && (
        <div className="cta on-bg"><div><button className="btn big block" onClick={demoPay}>Apmokėti (demo) · {eur(o.total)}</button></div></div>
      )}
    </>
  );
}
