import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/app.jsx';
import { useCart } from '../lib/cart.jsx';
import { api, eur, hhmm, dayLabel } from '../lib/api.js';
import { NavHead, Photo, Stepper, Icon, ProductCard } from '../components/ui.jsx';
import { StoreSheet } from './Home.jsx';

const CK = 'checkout.v1';
const readCk = () => { try { return JSON.parse(localStorage.getItem(CK)) || {}; } catch { return {}; } };

function Block({ title, children, right }) {
  return <section className="col" style={{ gap: 12 }}><div className="sec-head"><h2 style={{ fontSize: 17 }}>{title}</h2>{right}</div>{children}</section>;
}

export default function Cart() {
  const { itemsById, storeId, store, fulfillment, setPref, me, brand, notify } = useApp();
  const { lines, setQty, count } = useCart();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const saved = useMemo(readCk, []);
  const [f, setF] = useState({
    name: me.user?.name || saved.name || '', phone: me.user?.phone || saved.phone || '', address: saved.address || '',
    lat: saved.lat ?? null, lng: saved.lng ?? null, notes: '', payment: 'card', tip: 0, when: 'asap', promo: '', rewardId: null,
  });
  const [promoInput, setPromoInput] = useState('');
  const [quote, setQuote] = useState(null);
  const [qErr, setQErr] = useState(null);
  const [sugg, setSugg] = useState([]);
  const [slots, setSlots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);
  const [storeOpen, setStoreOpen] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const set = (p) => setF((o) => ({ ...o, ...p }));
  const reqId = useRef(0);

  useEffect(() => { if (params.get('cancelled')) notify('Mokėjimas atšauktas, krepšelis išsaugotas', 'bad'); }, [params, notify]);
  useEffect(() => { if (me.user) set({ name: f.name || me.user.name, phone: f.phone || me.user.phone || '' }); }, [me.user]); // eslint-disable-line
  useEffect(() => { try { localStorage.setItem(CK, JSON.stringify({ name: f.name, phone: f.phone, address: f.address, lat: f.lat, lng: f.lng })); } catch { /* */ } },
    [f.name, f.phone, f.address, f.lat, f.lng]);

  const body = useMemo(() => ({
    storeId, fulfillment, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, optionIds: l.optionIds, note: l.note })),
    promoCode: f.promo || undefined, rewardId: f.rewardId || undefined, tipPercent: f.tip, phone: f.phone,
    scheduledFor: f.when === 'asap' ? null : f.when, lat: f.lat ?? undefined, lng: f.lng ?? undefined,
  }), [storeId, fulfillment, lines, f.promo, f.rewardId, f.tip, f.when, f.lat, f.lng, f.phone]);

  // authoritative server quote, debounced
  useEffect(() => {
    if (!lines.length) return setQuote(null);
    const id = ++reqId.current;
    const t = setTimeout(() => api.post('/api/cart/quote', body)
      .then((r) => { if (id === reqId.current) { setQuote(r); setQErr(null); } })
      .catch((e) => { if (id === reqId.current) { setQErr(e.message); setQuote(null); } }), 220);
    return () => clearTimeout(t);
  }, [body, lines.length]);

  const ids = lines.map((l) => l.itemId).join(',');
  useEffect(() => {
    if (!ids) return setSugg([]);
    api.post('/api/cart/suggest', { storeId, itemIds: ids.split(',').map(Number) }).then(setSugg).catch(() => {});
  }, [ids, storeId]);
  useEffect(() => { api.get(`/api/stores/${storeId}/slots`).then(setSlots).catch(() => {}); }, [storeId]);
  useEffect(() => { if (store && !store.open && f.when === 'asap' && slots.length) set({ when: slots.find((s) => s.available)?.start || 'asap' }); }, [store, slots]); // eslint-disable-line

  const days = useMemo(() => {
    const m = new Map();
    for (const s of slots) { const d = dayLabel(s.start); if (!m.has(d)) m.set(d, []); m.get(d).push(s); }
    return [...m.entries()];
  }, [slots]);

  function locate() {
    if (!navigator.geolocation) return notify('Naršyklė nepalaiko vietos', 'bad');
    navigator.geolocation.getCurrentPosition(
      (p) => { set({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }); notify('Vieta nustatyta'); },
      () => notify('Nepavyko nustatyti vietos', 'bad'), { enableHighAccuracy: true, timeout: 8000 });
  }
  async function applyPromo() {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    try {
      const r = await api.post('/api/cart/quote', { ...body, promoCode: code });
      if (r.promo?.ok) { set({ promo: code }); notify(`Pritaikyta: ${r.promo.label}`); } else notify(r.promo?.reason || 'Kodas negalioja', 'bad');
    } catch (e) { notify(e.message, 'bad'); }
  }
  async function placeOrder() {
    setSubmitErr(null); setBusy(true);
    try {
      const r = await api.post('/api/orders', { ...body, customerName: f.name, phone: f.phone, address: f.address, notes: f.notes, paymentMethod: f.payment });
      try { localStorage.setItem('lastOrderToken', r.order.token); } catch { /* */ }
      if (r.payment.type === 'stripe' && r.payment.url) { window.location.href = r.payment.url; return; }
      nav(`/order/${r.order.token}`);
    } catch (e) { setSubmitErr(e.message); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); } finally { setBusy(false); }
  }

  if (!count) return (
    <><NavHead title="Krepšelis" back="/menu" />
      <div className="page" style={{ textAlign: 'center', paddingTop: 70, alignItems: 'center' }}>
        <span className="circle" style={{ width: 88, height: 88 }}><span style={{ display: 'flex', transform: 'scale(1.6)' }}><Icon.bag /></span></span>
        <h2>Krepšelis tuščias</h2><p className="muted" style={{ margin: 0 }}>Išsirinkite ką nors skanaus</p>
        <Link className="btn" to="/menu">Į meniu</Link>
      </div></>
  );

  const t = quote?.totals;
  const canPay = quote && !qErr && !quote.belowMin && quote.slot.ok && f.name.trim().length > 1 && f.phone.replace(/\D/g, '').length >= 8
    && (fulfillment === 'pickup' || f.address.trim().length >= 5);
  const missingHint = !f.name.trim() || f.phone.replace(/\D/g, '').length < 8 ? 'Įveskite vardą ir telefoną' : fulfillment === 'delivery' && f.address.trim().length < 5 ? 'Įveskite adresą' : null;
  const pts = me.user?.points || 0;
  const whenLabel = f.when === 'asap' ? (quote ? `Kuo greičiau · ${quote.eta.min}–${quote.eta.max} min` : 'Kuo greičiau') : `${dayLabel(f.when)} ${hhmm(f.when)}`;

  return (
    <>
      <NavHead title="Krepšelis" sub={`${store?.name || ''} · ${whenLabel}`} back="/menu"
        right={<button className="circle" onClick={() => setStoreOpen(true)} aria-label="Keisti restoraną"><Icon.pin /></button>} />
      <div className="page" style={{ paddingBottom: 130 }}>
        {brand?.delivery?.enabled && (
          <div className="tabs">
            <button className={`chip${fulfillment === 'pickup' ? ' on' : ''}`} onClick={() => setPref({ fulfillment: 'pickup' })}>Atsiimsiu</button>
            <button className={`chip${fulfillment === 'delivery' ? ' on' : ''}`} onClick={() => setPref({ fulfillment: 'delivery' })}>Pristatyti</button>
          </div>
        )}

        <Block title={`Jūsų užsakymas · ${count}`}>
          <div className="col" style={{ gap: 8 }}>
            {lines.map((l, i) => {
              const it = itemsById.get(l.itemId); const ql = quote?.lines?.[i];
              return (
                <div key={l.key} className="acc"><div className="acc-head">
                  <Link to={`/item/${l.itemId}`}><Photo item={it} w={66} h={54} className="thumb" /></Link>
                  <div className="grow">
                    <b className="ell">{it?.name || 'Prekė'}</b>
                    <span className="k ell" style={{ display: 'block' }}>{ql?.options?.length ? ql.options.map((o) => o.name).join(', ') : (l.note ? `„${l.note}“` : 'Be pakeitimų')}</span>
                    <span className="small" style={{ fontWeight: 700 }}>{ql ? eur(ql.total) : '…'}</span>
                  </div>
                  <Stepper small value={l.qty} onChange={(v) => setQty(l.key, v)} />
                </div></div>
              );
            })}
          </div>
        </Block>

        {sugg.length > 0 && (
          <Block title="Gal dar?"><div className="hscroll">{sugg.map((s) => <ProductCard key={s.id} item={itemsById.get(s.id)} />)}</div></Block>
        )}

        <Block title="Kada?">
          <div className="tabs">
            <button className={`chip${f.when === 'asap' ? ' on' : ''}`} disabled={!store?.open} style={!store?.open ? { opacity: .45 } : undefined} onClick={() => set({ when: 'asap' })}>
              {store?.open ? 'Kuo greičiau' : 'Dabar uždaryta'}</button>
            <button className={`chip${f.when !== 'asap' ? ' on' : ''}`} onClick={() => set({ when: slots.find((s) => s.available)?.start || 'asap' })}>Suplanuoti</button>
          </div>
          {f.when !== 'asap' && days.length > 0 && (
            <div className="acc" style={{ padding: 12 }}>
              <div className="chips" style={{ margin: 0, padding: 0 }}>{days.map(([d], i) => <button key={d} className={`chip sm${i === dayIdx ? ' on' : ''}`} style={i === dayIdx ? undefined : { background: '#fff' }} onClick={() => setDayIdx(i)}>{d}</button>)}</div>
              <div className="slot-grid">{days[dayIdx]?.[1].map((s) => (
                <button key={s.start} disabled={!s.available} className={f.when === s.start ? 'on' : ''} onClick={() => set({ when: s.start })}>{hhmm(s.start)}</button>))}</div>
            </div>
          )}
        </Block>

        <Block title="Kontaktai">
          <label className="field">Vardas<input className="input" autoComplete="name" value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field">Telefonas<input className="input" type="tel" autoComplete="tel" inputMode="tel" placeholder="+370…" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
          {fulfillment === 'delivery' && (<>
            <label className="field">Pristatymo adresas
              <input className="input" autoComplete="street-address" placeholder="Gatvė, namas, butas, miestas" value={f.address} onChange={(e) => set({ address: e.target.value })} /></label>
            <button type="button" className="btn soft sm" onClick={locate} style={{ alignSelf: 'flex-start' }}><Icon.pin />{f.lat ? 'Vieta nustatyta' : 'Naudoti mano vietą'}</button>
            {quote && !quote.zoneVerified && <p className="tiny muted" style={{ margin: 0 }}>Be vietos negalime patikrinti zonos, laikas apytikslis.</p>}
          </>)}
          <label className="field">Pastaba (neprivaloma)<textarea className="input" maxLength={300} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Durų kodas, aukštas…" /></label>
        </Block>

        <Block title="Nuolaidos ir taškai">
          {f.promo ? (
            <div className="acc"><div className="acc-head" style={{ padding: '4px 6px' }}>
              <span className="grow"><span className="k">Pritaikytas kodas</span><b>{f.promo}{quote?.promo?.label ? ` · ${quote.promo.label}` : ''}</b></span>
              <button className="link" onClick={() => set({ promo: '' })}>Pašalinti</button></div></div>
          ) : (
            <div className="searchbar" style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}>
              <input placeholder="Nuolaidos kodas" value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && applyPromo()} aria-label="Nuolaidos kodas" />
              <button className="btn sm" onClick={applyPromo}>Taikyti</button>
            </div>
          )}
          {me.user && me.rewards?.length > 0 && (
            <div className="chips">{me.rewards.map((r) => {
              const on = f.rewardId === r.id; const can = pts >= r.cost_points;
              return <button key={r.id} disabled={!can} className={`chip sm${on ? ' on' : ''}`} style={{ opacity: can ? 1 : 0.45 }} onClick={() => set({ rewardId: on ? null : r.id })}>{r.name} · {r.cost_points} tšk.</button>;
            })}</div>
          )}
          {!me.user && <p className="small muted" style={{ margin: 0 }}><Link className="link" to="/account?next=/cart">Prisijunkite</Link> ir gaukite {t ? t.pointsEarned : '…'} tšk. už šį užsakymą.</p>}
        </Block>

        <Block title="Arbatpinigiai komandai">
          <div className="tabs">{(brand?.tipsPercent || [0, 5, 10]).map((p) => <button key={p} className={`chip${f.tip === p ? ' on' : ''}`} onClick={() => set({ tip: p })}>{p ? `${p} %` : 'Ne'}</button>)}</div>
        </Block>

        <Block title="Mokėjimas">
          <div className="acc">
            {brand?.payments !== 'off' && (
              <button className={`choice${f.payment === 'card' ? ' on' : ''}`} onClick={() => set({ payment: 'card' })}>
                <span className="grow"><b>Kortele dabar</b><br /><span className="small muted">{brand?.payments === 'stripe' ? 'Saugus Stripe apmokėjimas' : 'DEMO režimas: pinigai nenuskaičiuojami'}</span></span>
                <span className="tick">{f.payment === 'card' && <Icon.check />}</span>
              </button>
            )}
            <button className={`choice${f.payment === 'cash' ? ' on' : ''}`} onClick={() => set({ payment: 'cash' })}>
              <span className="grow"><b>{fulfillment === 'delivery' ? 'Atsiimant iš kurjerio' : 'Restorane atsiimant'}</b><br /><span className="small muted">Grynais arba kortele</span></span>
              <span className="tick">{f.payment === 'cash' && <Icon.check />}</span>
            </button>
          </div>
        </Block>

        <section className="acc white" style={{ padding: 18, gap: 0 }}>
          {t ? (<>
            <div className="sum-row"><span className="muted">Tarpinė suma</span><span>{eur(t.subtotal)}</span></div>
            {t.discount > 0 && <div className="sum-row okc"><span>Nuolaida</span><span>−{eur(t.discount)}</span></div>}
            {t.rewardCents > 0 && <div className="sum-row okc"><span>Taškai (−{t.pointsSpent})</span><span>−{eur(t.rewardCents)}</span></div>}
            {fulfillment === 'delivery' && <div className="sum-row"><span className="muted">Pristatymas</span><span>{t.deliveryFee ? eur(t.deliveryFee) : 'Nemokamai'}</span></div>}
            {t.tip > 0 && <div className="sum-row"><span className="muted">Arbatpinigiai</span><span>{eur(t.tip)}</span></div>}
            <div className="divider" style={{ margin: '10px 0 0' }} />
            <div className="sum-row total"><span>Iš viso</span><span>{eur(t.total)}</span></div>
            {me.user && <span className="tiny muted">Gausite +{t.pointsEarned} tšk.</span>}
          </>) : <div className="skeleton" style={{ height: 90 }} />}
        </section>

        {qErr && <div className="notice bad">{qErr}</div>}
        {quote?.belowMin && <div className="notice bad">Minimali užsakymo suma {eur(quote.minOrder)}</div>}
        {quote && !quote.slot.ok && <div className="notice bad">{quote.slot.reason}</div>}
        {submitErr && <div className="notice bad">{submitErr}</div>}
        <p className="tiny muted" style={{ textAlign: 'center', margin: 0 }}>Užsakydami sutinkate su {brand?.legal?.company} sąlygomis.</p>
      </div>

      <div className="cta on-bg"><div>
        <button className="btn big block" disabled={!canPay || busy} onClick={placeOrder}>
          {busy ? 'Siunčiama…' : !canPay && missingHint && quote ? missingHint : t ? `Užsakyti · ${eur(t.total)}` : 'Užsakyti'}
        </button>
      </div></div>
      {storeOpen && <StoreSheet onClose={() => setStoreOpen(false)} />}
    </>
  );
}
