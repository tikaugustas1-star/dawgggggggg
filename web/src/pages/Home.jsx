import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../lib/app.jsx';
import { useCart } from '../lib/cart.jsx';
import { api, eur } from '../lib/api.js';
import { Photo, Sheet, Icon, ProductCard, FavButton, sized } from '../components/ui.jsx';
import { hoursStatus } from './Locations.jsx';

const GREET = { morning: 'Labas rytas', lunch: 'Laba diena', afternoon: 'Laba diena', evening: 'Labas vakaras' };

/** Store + pickup/delivery chooser, opened from a compact line. */
export function StoreSheet({ onClose }) {
  const { stores, store, fulfillment, setPref, brand } = useApp();
  return (
    <Sheet onClose={onClose} label="Restoranas">
      <div className="page">
        <h2>Kaip ir iš kur?</h2>
        {brand?.delivery?.enabled && (
          <div className="tabs">
            <button className={`chip${fulfillment === 'pickup' ? ' on' : ''}`} onClick={() => setPref({ fulfillment: 'pickup' })}>Atsiimsiu</button>
            <button className={`chip${fulfillment === 'delivery' ? ' on' : ''}`} onClick={() => setPref({ fulfillment: 'delivery' })}>Pristatyti</button>
          </div>
        )}
        <div className="acc">
          {stores.map((s) => (
            <button key={s.id} className={`choice${s.id === store?.id ? ' on' : ''}`} onClick={() => { setPref({ storeId: s.id }); onClose(); }}>
              <span className={`dot${s.open ? '' : ' off'}`} />
              <span className="grow"><b>{s.name}</b><br /><span className="small muted">{s.address} · {s.paused ? 'pauzė' : s.open ? 'atidaryta' : 'uždaryta'}</span></span>
              <span className="tick">{s.id === store?.id && <Icon.check />}</span>
            </button>
          ))}
        </div>
        <Link to="/locations" className="btn soft block" onClick={onClose}><Icon.pin />Žiūrėti žemėlapyje</Link>
      </div>
    </Sheet>
  );
}

function HeroStack({ items, kicker }) {
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const drag = useRef(null);
  useEffect(() => setI(0), [items]);
  const n = items.length;
  if (!n) return <div className="skeleton" style={{ height: 410 }} />;
  const go = (d) => setI((x) => (x + d + n) % n);
  const pos = (k) => { const d = ((k - i) % n + n) % n; return d === 0 ? 'p0' : d === 1 ? 'p1' : d === n - 1 && n > 2 ? 'pm1' : 'ph2'; };

  // swipe left/right to flip cards; a swipe must not also count as a tap
  const down = (e) => { drag.current = { x: e.clientX, moved: false }; };
  const move = (e) => { if (drag.current && Math.abs(e.clientX - drag.current.x) > 8) drag.current.moved = true; };
  const up = (e) => {
    const d = drag.current;
    if (d && Math.abs(e.clientX - d.x) > 40) go(e.clientX < d.x ? 1 : -1);
    setTimeout(() => { drag.current = null; }, 0);
  };
  const open = (it) => (e) => { if (drag.current?.moved) { e.preventDefault(); return; } nav(`/item/${it.id}`); };

  return (
    <>
      <div className="stack" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}>
        {items.map((it, k) => {
          const p = pos(k);
          return (
            <article key={it.id} className={`card-x ${p}`} aria-hidden={p !== 'p0'}>
              {it.image ? <img src={sized(it.image, 360, 420)} alt="" draggable="false" /> : <Photo item={it} style={{ height: '100%' }} />}
              <div className="shade" />
              {p === 'p0' && (<>
                <FavButton itemId={it.id} glass className="fav" />
                <div className="info" onClick={open(it)} style={{ cursor: 'pointer' }}>
                  <div className="kicker">{kicker}</div>
                  <h2>{it.name}</h2>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="pill on-photo"><Icon.clock /> {Math.max(1, Math.round(it.prepMin))} min</span>
                    <span className="small" style={{ opacity: .85 }}>{eur(it.price)}{it.orders60d ? ` · ${it.orders60d} užsakymų` : ''}</span>
                  </div>
                </div>
                <div className="seemore">
                  <button style={{ position: 'absolute', inset: 0, color: '#fff', fontWeight: 600 }} onClick={open(it)}>Peržiūrėti</button>
                  <button className="circle" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Kitas patiekalas"><Icon.next /></button>
                </div>
              </>)}
            </article>
          );
        })}
      </div>
      {n > 1 && <div className="stack-dots" aria-hidden>{items.map((it, k) => <i key={it.id} className={k === i ? 'on' : ''} />)}</div>}
    </>
  );
}

export default function Home() {
  const { me, menu, itemsById, storeId, store, stores, fulfillment, notify, brand } = useApp();
  const { replace } = useCart();
  const nav = useNavigate();
  const [rec, setRec] = useState(null);
  const [offers, setOffers] = useState(null);
  const [last, setLast] = useState(null);
  const [cat, setCat] = useState(null);
  const [q, setQ] = useState('');
  const [storeOpen, setStoreOpen] = useState(false);

  useEffect(() => { api.get(`/api/recommendations?storeId=${storeId}`).then(setRec).catch(() => {}); }, [storeId, me.user?.id]);
  useEffect(() => { api.get(`/api/deals/today?storeId=${storeId}`).then(setOffers).catch(() => setOffers({ day: 'today', deals: [] })); }, [storeId, menu]);
  useEffect(() => {
    if (!me.user) return setLast(null);
    api.get('/api/me/orders').then((os) => setLast(os.find((o) => o.status === 'completed') || os[0] || null)).catch(() => {});
  }, [me.user]);

  const dp = rec?.daypart || 'lunch';
  const mains = useMemo(() => (menu?.categories || []).filter((c) => menu.items.some((i) => i.categoryId === c.id)), [menu]);
  useEffect(() => {
    if (cat || !mains.length || !rec) return;
    const want = dp === 'morning' ? 'pusryciai' : 'burgeriai';
    setCat((mains.find((c) => c.slug === want) || mains[0]).id);
  }, [mains, rec, dp, cat]);
  const stackItems = useMemo(() => (menu?.items || []).filter((i) => i.categoryId === cat && !i.soldOut)
    .sort((a, b) => b.orders60d - a.orders60d), [menu, cat]);

  async function reorder() {
    const r = await api.post(`/api/me/orders/${last.id}/reorder`, { storeId });
    if (!r.lines.length) return notify('Šių patiekalų dabar neturime', 'bad');
    replace(r.lines);
    if (r.dropped.length) notify(`Praleista: ${r.dropped.map((d) => d.name).join(', ')}`, 'bad');
    nav('/cart');
  }

  // bestsellers: real sales over the last 60 days, in order
  const best = useMemo(() => (menu?.items || []).filter((i) => i.orders60d > 0).sort((a, b) => b.orders60d - a.orders60d).slice(0, 10), [menu]);
  const favs = (me.favorites || []).map((id) => itemsById.get(id)).filter(Boolean);
  const nextReward = me.rewards?.find((r) => r.cost_points > (me.user?.points || 0)) || me.rewards?.[me.rewards.length - 1];
  const first = me.user?.name?.split(' ')[0];

  return (
    <>
      <header className="greet">
        <div className="grow">
          <h1 className="ell">{GREET[dp]}{first ? `, ${first}` : ''}</h1>
          <button onClick={() => setStoreOpen(true)} className="row" style={{ gap: 4, marginTop: 2 }}>
            <span className="small muted ell">{fulfillment === 'delivery' ? 'Pristatymas' : 'Atsiėmimas'} · {store?.name || '…'}</span>
            <span className={`dot${store?.open ? '' : ' off'}`} /><span style={{ color: 'var(--muted)', display: 'flex' }}><Icon.chev /></span>
          </button>
        </div>
        <Link to="/account" className={`avatar${me.user ? '' : ' ghost'}`} aria-label="Paskyra">
          {me.user ? me.user.name.slice(0, 1).toUpperCase() : <Icon.user />}
        </Link>
      </header>

      <div className="page">
        <form className="searchbar" role="search" onSubmit={(e) => { e.preventDefault(); nav(`/menu?q=${encodeURIComponent(q)}`); }}>
          <Icon.search />
          <input placeholder="Ieškoti patiekalo" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Paieška" />
          <button type="button" className="circle dark" onClick={() => nav('/menu?filters=1')} aria-label="Filtrai"><Icon.filter /></button>
        </form>

        <section className="col" style={{ gap: 14 }}>
          <h2>Ką valgysi {dp === 'evening' ? 'šįvakar' : 'šiandien'}?</h2>
          <div className="chips">
            {mains.map((c) => <button key={c.id} className={`chip${cat === c.id ? ' on' : ''}`} onClick={() => setCat(c.id)}>{c.name}</button>)}
          </div>
          <HeroStack items={stackItems} kicker={mains.find((c) => c.id === cat)?.name || ''} />
        </section>

        {last && (
          <section className="acc">
            <div className="acc-head">
              <Photo item={itemsById.get(last.items[0]?.item_id)} w={66} h={54} className="thumb" />
              <div className="grow"><span className="k">Paskutinis užsakymas · {eur(last.total)}</span>
                <b className="ell">{last.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</b></div>
              <button className="btn sm" onClick={reorder}>Kartoti</button>
            </div>
          </section>
        )}

        {!me.user && (
          <div className="notice row"><span className="grow">Pirmam užsakymui −10 % su kodu <b>SVEIKI10</b></span>
            <Link to="/account" className="link">Prisijungti</Link></div>
        )}

        <section className="col" style={{ gap: 14 }}>
          <div className="sec-head">
            <h2>{offers?.day === 'tomorrow' ? 'Rytojaus pasiūlymai' : 'Šiandienos pasiūlymai'}</h2>
            <Link to="/menu" className="link">Visas meniu</Link>
          </div>
          <div className="hscroll">
            {!offers && [0, 1].map((k) => <div key={k} className="skeleton" style={{ width: 236, height: 290 }} />)}
            {offers?.deals.map((o) => <ProductCard key={o.id} item={itemsById.get(o.itemId)} offer={o} />)}
          </div>
          {offers && !offers.deals.length && <p className="small muted" style={{ margin: 0 }}>Šiandien pasiūlymų nebėra. Užsukite rytoj!</p>}
        </section>

        {best.length > 0 && (
          <section className="col" style={{ gap: 14 }}>
            <div className="sec-head"><h2>Bestselleriai</h2><Link to="/menu" className="link">Visas meniu</Link></div>
            <div className="hscroll">{best.map((it, i) => <ProductCard key={it.id} item={it} rank={i + 1} />)}</div>
          </section>
        )}

        {favs.length > 0 && (
          <section className="col" style={{ gap: 14 }}>
            <h2>Mėgstami</h2>
            <div className="hscroll">{favs.map((it) => <ProductCard key={it.id} item={it} />)}</div>
          </section>
        )}

        <section className="col" style={{ gap: 14 }}>
          <div className="sec-head"><h2>Kur mus rasti</h2><Link to="/locations" className="link">Žemėlapis</Link></div>
          <Link to="/locations" className="acc" style={{ textDecoration: 'none' }}>
            {stores.map((s) => (
              <div key={s.id} className="acc-head">
                <Photo item={{ image: s.image, emoji: '📍' }} w={66} h={54} className="thumb" />
                <span className="grow" style={{ minWidth: 0 }}><span className="k row" style={{ gap: 6 }}><span className={`dot${s.open ? '' : ' off'}`} />{hoursStatus(s)}</span>
                  <b className="ell">{s.name}</b><span className="small muted ell" style={{ display: 'block' }}>{s.address}</span></span>
                <span className="circle dark xs" aria-hidden><Icon.arrow /></span>
              </div>
            ))}
          </Link>
        </section>

        {me.user && nextReward && (
          <section className="loyal">
            <div className="row between"><span className="small" style={{ opacity: .7 }}>{brand?.loyalty?.name}</span><b>{me.user.points} tšk.</b></div>
            <div className="meter"><i style={{ width: `${Math.min(100, (me.user.points / nextReward.cost_points) * 100)}%` }} /></div>
            <span className="small" style={{ opacity: .85 }}>
              {me.user.points >= nextReward.cost_points ? `Galite atsiimti: ${nextReward.name}` : `Iki „${nextReward.name}“ trūksta ${nextReward.cost_points - me.user.points} tšk.`}
            </span>
          </section>
        )}
      </div>
      {storeOpen && <StoreSheet onClose={() => setStoreOpen(false)} />}
    </>
  );
}
