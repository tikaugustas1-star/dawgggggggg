import { useEffect } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../lib/app.jsx';
import { useCart, linePrice } from '../lib/cart.jsx';
import { api, eur } from '../lib/api.js';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24' };
export const Icon = {
  home: () => <svg {...P}><path d="M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" /></svg>,
  menu: () => <svg {...P}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M9 10h6M9 14h6" /></svg>,
  bag: () => <svg {...P}><path d="M5.5 8.5h13l-.9 10.6a1 1 0 0 1-1 .9H7.4a1 1 0 0 1-1-.9zM9 8.5V7a3 3 0 0 1 6 0v1.5" /></svg>,
  receipt: () => <svg {...P}><path d="M6.5 4h11v16l-2.75-1.6L12 20l-2.75-1.6L6.5 20zM9.5 9h5M9.5 13h5" /></svg>,
  user: () => <svg {...P}><circle cx="12" cy="8.5" r="3.6" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>,
  search: () => <svg {...P} className="ic"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>,
  filter: () => <svg {...P}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>,
  heart: ({ on }) => <svg {...P} fill={on ? 'currentColor' : 'none'}><path d="M12 19.5s-7-4.3-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z" /></svg>,
  back: () => <svg {...P}><path d="M14.5 6 8.5 12l6 6" /></svg>,
  next: () => <svg {...P}><path d="M9.5 6l6 6-6 6" /></svg>,
  arrow: () => <svg {...P}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  plus: () => <svg {...P}><path d="M12 5v14M5 12h14" /></svg>,
  chev: () => <svg {...P} width="20" height="20" className="chev"><path d="m6 9 6 6 6-6" /></svg>,
  clock: () => <svg {...P}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></svg>,
  pin: () => <svg {...P}><path d="M12 20.5s-6.5-5.8-6.5-10.3a6.5 6.5 0 0 1 13 0c0 4.5-6.5 10.3-6.5 10.3z" /><circle cx="12" cy="10" r="2.3" /></svg>,
  check: () => <svg {...P} width="13" height="13" strokeWidth="3"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  close: () => <svg {...P}><path d="M6 6l12 12M18 6 6 18" /></svg>,
  fire: () => <svg {...P}><path d="M12 21a6 6 0 0 0 6-6c0-3.5-2.5-5.5-3.5-8.5-1.5 2-2 3.5-2 5-1-1-1.5-2.5-1.5-4C8 9.5 6 12 6 15a6 6 0 0 0 6 6z" /></svg>,
};

/** Responsive photo with graceful emoji fallback. Unsplash URLs are resized on the CDN. */
export function Photo({ item, w = 400, h, className = '', style, out }) {
  const src = item?.image ? sized(item.image, w, h || w) : null;
  return (
    <div className={`ph ${out ? 'out ' : ''}${className}`} style={style}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className="emo" aria-hidden>{item?.emoji || '🍽️'}</span>}
    </div>
  );
}
export function sized(url, w, h) {
  if (!url.includes('images.unsplash.com')) return url;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return `${url}&w=${Math.round(w * dpr)}&h=${Math.round(h * dpr)}`;
}

export function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div className={`toast${toast.kind === 'bad' ? ' bad' : ''}`} role="status">{toast.msg}</div>;
}

export function useBack(fallback = '/') {
  const nav = useNavigate();
  return () => (window.history.state?.idx > 0 ? nav(-1) : nav(fallback));
}

/** Centred title header with circle buttons (reference screen 3). */
export function NavHead({ title, sub, back = '/', right, noBack }) {
  const goBack = useBack(back);
  return (
    <header className="navhead">
      {noBack ? <span /> : <button className="circle" onClick={goBack} aria-label="Atgal"><Icon.back /></button>}
      <div className="t"><h3 className="ell">{title}</h3>{sub && <span className="ell">{sub}</span>}</div>
      {right || <span />}
    </header>
  );
}

export function FavButton({ itemId, glass, className = '' }) {
  const { me, refreshMe, notify } = useApp();
  const on = me.favorites?.includes(itemId);
  async function toggle(e) {
    e.preventDefault(); e.stopPropagation();
    if (!me.user) return notify('Prisijunkite, kad išsaugotumėte mėgstamus', 'bad');
    await api.post(`/api/me/favorites/${itemId}`); refreshMe();
  }
  return (
    <button className={`circle sm ${glass ? 'glass' : ''} ${className}`} onClick={toggle} aria-label={on ? 'Pašalinti iš mėgstamų' : 'Į mėgstamus'} aria-pressed={!!on}
      style={on ? { color: glass ? '#fff' : 'var(--accent)' } : undefined}>
      <Icon.heart on={on} />
    </button>
  );
}

/** When an offer applies, in words: "iki 15:00", "nuo 11:00", "rytoj nuo 08:00", "visą dieną". */
export function offerWhen(o) {
  if (o.state === 'tomorrow') return o.from ? `rytoj nuo ${o.from}` : 'rytoj visą dieną';
  if (o.state === 'upcoming') return `šiandien nuo ${o.from}`;
  return o.until ? `iki ${o.until}` : 'visą dieną';
}

/** Product card (reference "Upcoming tours" card). `offer` = today's deal entry, `rank` = bestseller position. */
export function ProductCard({ item, grid, rank, offer }) {
  if (!item) return null;
  const deal = offer || item.deal; // menu items carry a currently-active deal
  const live = deal && (!offer || offer.state === 'active');
  const price = live ? deal.price : item.price;
  return (
    <div className={`pcard${grid ? ' grid' : ''}`}>
      <Link to={`/item/${item.id}`} className="stretch" aria-label={`${item.name}, ${eur(price)}${deal ? `, ${deal.title} ${deal.badge}` : ''}`} />
      <Photo item={item} w={grid ? 220 : 240} h={grid ? 220 : 180} out={item.soldOut} />
      {item.soldOut ? <span className="soldout">Išparduota</span>
        : rank ? <span className="rank-badge">#{rank}</span>
        : deal ? <span className="deal-badge">{deal.badge}</span> : null}
      <FavButton itemId={item.id} className="fav" />
      <div className="body">
        <b className={grid ? '' : 'ell'}>{item.name}</b>
        {offer
          ? <span className="meta"><span className="okc" style={{ fontWeight: 600 }}>{offer.title}</span><i />{offerWhen(offer)}</span>
          : <span className="meta"><span>{Math.max(1, Math.round(item.prepMin))} min</span>{item.kcal && <><i />{item.kcal} kcal</>}{rank && deal && <><i /><span className="okc">{deal.badge}</span></>}</span>}
      </div>
      <div className="foot">
        <span className="row" style={{ gap: 6, minWidth: 0 }}>
          <span className="price">{eur(offer ? offer.price : price)}</span>
          {deal ? <s className="meta">{eur(offer ? offer.was : item.price)}</s>
            : item.orders60d > 0 && <span className="meta ell" title="Užsakymai per 60 d."><Icon.fire />{item.orders60d}</span>}
        </span>
        {!item.soldOut && <span className={`circle dark ${grid ? 'xs' : 'sm'}`} aria-hidden><Icon.arrow /></span>}
      </div>
    </div>
  );
}

export function Dock() {
  const { count } = useCart();
  const tabs = [['/', 'Pradžia', Icon.home], ['/menu', 'Meniu', Icon.menu], ['/cart', 'Krepšelis', Icon.bag], ['/orders', 'Užsakymai', Icon.receipt], ['/account', 'Paskyra', Icon.user]];
  return (
    <div className="dock"><nav aria-label="Pagrindinė navigacija">
      {tabs.map(([to, label, I]) => (
        <NavLink key={to} to={to} end={to === '/'} aria-label={label} title={label} className={({ isActive }) => (isActive ? 'active' : '')}>
          <I />{to === '/cart' && count > 0 && <span className="dot-badge">{count}</span>}
        </NavLink>
      ))}
    </nav></div>
  );
}

export function CartPill() {
  const { lines, count } = useCart();
  const { itemsById } = useApp();
  const loc = useLocation();
  if (!count || !['/', '/menu'].includes(loc.pathname)) return null;
  const total = lines.reduce((s, l) => s + linePrice(l, itemsById.get(l.itemId)), 0);
  return (
    <div className="cartpill">
      <Link to="/cart">
        <span className="grow"><b>{count} {count === 1 ? 'prekė' : count < 10 ? 'prekės' : 'prekių'}</b> <span className="muted">· {eur(total)}</span></span>
        <span className="small" style={{ fontWeight: 600 }}>Krepšelis</span>
        <span className="circle dark sm"><Icon.arrow /></span>
      </Link>
    </div>
  );
}

export function Sheet({ onClose, children, label }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />{children}
      </div>
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, small }) {
  return (
    <div className={`stepper${small ? ' sm' : ''}`}>
      <button type="button" aria-label="Mažiau" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label="Daugiau" onClick={() => onChange(Math.min(50, value + 1))}>+</button>
    </div>
  );
}

export const Switch = ({ on, onClick, red, label }) => (
  <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={`switch${on ? ' on' : ''}${red ? ' red' : ''}`} onClick={onClick} />
);
