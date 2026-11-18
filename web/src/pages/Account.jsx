import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/app.jsx';
import { useCart } from '../lib/cart.jsx';
import { api, eur, hhmm, dayLabel } from '../lib/api.js';
import { NavHead, Photo } from '../components/ui.jsx';
import { safeNext } from '../lib/safe.js';

const STATUS = { placed: 'Gautas', accepted: 'Patvirtintas', preparing: 'Gaminamas', ready: 'Paruoštas', out_for_delivery: 'Pakeliui', completed: 'Įvykdytas', cancelled: 'Atšauktas' };

export function Account() {
  const { me, refreshMe, brand, notify } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ email: '', password: '', name: '', phone: '', acceptTerms: false });
  const [del, setDel] = useState(null); // null | { password, busy, err }
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const r = await api.post(`/api/auth/${mode}`, f);
      await refreshMe();
      const next = safeNext(params.get('next'));
      if (r.role === 'staff') nav('/kitchen'); else if (r.role === 'admin') nav(next || '/admin'); else nav(next || '/');
      notify(mode === 'login' ? 'Sveiki sugrįžę!' : 'Paskyra sukurta');
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  async function deleteAccount(e) {
    e.preventDefault(); setDel({ ...del, busy: true, err: null });
    try {
      await api.post('/api/me/delete', { password: del.password });
      try { localStorage.removeItem('checkout.v1'); localStorage.removeItem('lastOrderToken'); } catch { /* */ }
      setDel(null); await refreshMe(); notify('Paskyra ištrinta'); nav('/');
    } catch (e2) { setDel((d) => ({ ...d, busy: false, err: e2.message })); }
  }
  async function logout() {
    await api.post('/api/auth/logout');
    try { localStorage.removeItem('checkout.v1'); } catch { /* */ } // don't leave name/phone/address on a shared phone
    await refreshMe(); notify('Atsijungėte');
  }

  if (me.user) return (
    <><NavHead title="Paskyra" sub={me.user.email} back="/" />
      <div className="page">
        <section className="loyal">
          <span className="small" style={{ opacity: .8 }}>{brand?.loyalty?.name}</span>
          <div className="row between"><h1>{me.user.points}</h1><span className="small" style={{ opacity: .8 }}>{brand?.loyalty?.pointsPerEuro} tšk. už 1 €</span></div>
        </section>
        <section className="col"><h3>Atlygiai</h3>
          {me.rewards.map((r) => (
            <div key={r.id} className="acc"><div className="acc-head" style={{ padding: '4px 6px' }}>
              <span className="grow"><b>{r.name}</b><br /><span className="small muted">{r.cost_points} tšk. · vertė {eur(r.value_cents)}</span></span>
              {me.user.points >= r.cost_points ? <span className="badge">Galima</span> : <span className="small muted">trūksta {r.cost_points - me.user.points}</span>}
            </div></div>
          ))}
          <p className="small muted" style={{ margin: 0 }}>Atlygį pasirinksite krepšelyje.</p>
        </section>
        <section className="acc white" style={{ padding: 18 }}>
          <b>{me.user.name}</b><span className="small muted">{me.user.email}</span>
          {me.user.role !== 'customer' && <div className="row" style={{ gap: 8 }}><Link className="btn sm dark" to="/kitchen">Virtuvė</Link>{me.user.role === 'admin' && <Link className="btn sm dark" to="/admin">Administravimas</Link>}</div>}
          <Link className="btn soft" to="/locations">Kur mus rasti</Link>
          <button className="btn ghost" onClick={logout}>Atsijungti</button>
        </section>
        <section className="acc" style={{ padding: 18, gap: 10 }}>
          <b>Privatumas</b>
          <span className="small muted">Jūsų duomenys tvarkomi pagal <Link className="link" to="/privacy">Privatumo politiką</Link> ir <Link className="link" to="/terms">Pirkimo taisykles</Link>.</span>
          <a className="btn soft sm" href="/api/me/export" download>Atsisiųsti mano duomenis</a>
          {!del ? (
            <button className="btn ghost sm" style={{ color: 'var(--bad)' }} onClick={() => setDel({ password: '', busy: false, err: null })}>Ištrinti paskyrą</button>
          ) : (
            <form className="col" style={{ gap: 8 }} onSubmit={deleteAccount}>
              <span className="small">Paskyra, taškai ir mėgstami bus ištrinti visam laikui. Užsakymai lieka apskaitai, bet be jūsų vardo, telefono ir adreso.</span>
              <label className="field">Patvirtinkite slaptažodžiu
                <input className="input" type="password" autoComplete="current-password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} required /></label>
              {del.err && <div className="notice bad">{del.err}</div>}
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn soft sm grow" onClick={() => setDel(null)}>Atšaukti</button>
                <button className="btn sm grow" style={{ background: 'var(--bad)' }} disabled={del.busy || !del.password}>Ištrinti visam laikui</button>
              </div>
            </form>
          )}
        </section>
      </div></>
  );

  return (
    <><NavHead title={mode === 'login' ? 'Prisijungti' : 'Registracija'} sub="Taškai, istorija ir mėgstami" back="/" />
      <form className="page" onSubmit={submit}>
        <div className="tabs"><button type="button" className={`chip${mode === 'login' ? ' on' : ''}`} onClick={() => setMode('login')}>Prisijungti</button>
          <button type="button" className={`chip${mode === 'register' ? ' on' : ''}`} onClick={() => setMode('register')}>Nauja paskyra</button></div>
        {mode === 'register' && <>
          <label className="field">Vardas<input className="input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label className="field">Telefonas<input className="input" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        </>}
        <label className="field">El. paštas<input className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
        <label className="field">Slaptažodis<input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 10 : undefined} maxLength={128}
          value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label>
        {mode === 'register' && <span className="tiny muted" style={{ marginTop: -14 }}>Bent 10 simbolių. Venkite lengvai atspėjamų slaptažodžių.</span>}
        {mode === 'register' && (
          <label className="consent">
            <input type="checkbox" checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} required />
            <span>Susipažinau su <Link to="/terms">Pirkimo–pardavimo taisyklėmis</Link> ir <Link to="/privacy">Privatumo politika</Link>. Man yra bent 14 metų.</span>
          </label>
        )}
        {err && <div className="notice bad">{err}</div>}
        <button className="btn block big" disabled={busy || (mode === 'register' && !f.acceptTerms)}>{mode === 'login' ? 'Prisijungti' : 'Sukurti paskyrą'}</button>
        {mode === 'login' && (
          <p className="fineprint">Prisijungdami patvirtinate, kad susipažinote su <Link to="/terms">Taisyklėmis</Link> ir <Link to="/privacy">Privatumo politika</Link>.</p>
        )}
        <Link className="btn soft block" to="/locations">Kur mus rasti</Link>
        <div className="acc small" style={{ padding: 18 }}><b>Kodėl verta?</b>
          <span>{brand?.loyalty?.pointsPerEuro} tšk. už kiekvieną eurą</span><span>Užsakymo kartojimas vienu paspaudimu</span><span>Mėgstami patiekalai ir asmeniniai pasiūlymai</span></div>
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>Galite užsakyti ir be paskyros.</p>
        <p className="fineprint"><Link to="/privacy">Privatumo politika</Link> · <Link to="/terms">Pirkimo taisyklės</Link></p>
      </form></>
  );
}

export function Orders() {
  const { me, storeId, notify, itemsById } = useApp();
  const { replace } = useCart();
  const nav = useNavigate();
  const [orders, setOrders] = useState(null);
  const [guestToken] = useState(() => { try { return localStorage.getItem('lastOrderToken'); } catch { return null; } });
  useEffect(() => { if (me.user) api.get('/api/me/orders').then(setOrders); }, [me.user]);

  async function again(o) {
    const r = await api.post(`/api/me/orders/${o.id}/reorder`, { storeId });
    if (!r.lines.length) return notify('Šių patiekalų dabar neturime', 'bad');
    replace(r.lines);
    if (r.dropped.length) notify(`Praleista: ${r.dropped.map((d) => d.name).join(', ')}`, 'bad');
    nav('/cart');
  }

  if (!me.user) return (
    <><NavHead title="Užsakymai" sub="Istorija ir kartojimas" back="/" /><div className="page" style={{ textAlign: 'center', paddingTop: 40 }}>
      <h2>Jūsų užsakymai</h2>
      <p className="muted">Prisijunkite, kad matytumėte istoriją ir kartotumėte užsakymus.</p>
      <Link className="btn" to="/account?next=/orders">Prisijungti</Link>
      {guestToken && <Link className="btn ghost" style={{ marginTop: 10 }} to={`/order/${guestToken}`}>Paskutinis užsakymas</Link>}
    </div></>
  );

  return (
    <><NavHead title="Užsakymai" sub="Istorija ir kartojimas" back="/" />
      <div className="page">
        {!orders && <div className="skeleton" style={{ height: 100 }} />}
        {orders?.length === 0 && <p className="muted">Užsakymų dar nėra. <Link to="/menu">Į meniu</Link></p>}
        {orders?.map((o) => (
          <div key={o.id} className="acc" style={{ gap: 8 }}><div className="acc-head"><Photo item={itemsById.get(o.items[0]?.item_id)} w={66} h={54} className="thumb" /><div className="grow">
            <Link to={`/order/${o.token}`} className="row between" style={{ textDecoration: 'none' }}>
              <span><b>{o.code}</b> <span className="small muted">· {dayLabel(o.createdAt)} {hhmm(o.createdAt)}</span></span>
              <span className="tag" style={{ background: "#fff" }}>{STATUS[o.status] || o.status}</span>
            </Link>
            <span className="small muted ell" style={{ display: 'block' }}>{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</span>
            </div></div>
            <div className="row between" style={{ padding: '0 6px' }}><b>{eur(o.total)}</b><button className="btn sm" onClick={() => again(o)}>Kartoti</button></div>
          </div>
        ))}
      </div></>
  );
}
