import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../lib/app.jsx';
import { useCart } from '../lib/cart.jsx';
import { api, eur } from '../lib/api.js';
import { Photo, Icon, FavButton, ProductCard, Stepper, useBack } from '../components/ui.jsx';

// Full-page product view: hero photo, overlapping sheet, accordion option groups, sticky CTA.
export default function Item() {
  const { id } = useParams();
  const { itemsById, menu, storeId, notify } = useApp();
  const { add } = useCart();
  const back = useBack('/menu');
  const item = itemsById.get(Number(id));
  const [sel, setSel] = useState(new Set());
  const [open, setOpen] = useState(new Set());
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [more, setMore] = useState(false);
  const [tried, setTried] = useState(false);
  const [pairs, setPairs] = useState([]);

  useEffect(() => {
    if (!item) return;
    setSel(new Set(item.groups.flatMap((g) => g.options.filter((o) => o.isDefault).map((o) => o.id))));
    setOpen(new Set(item.groups.filter((g) => g.max > 1 || !g.options.some((o) => o.isDefault)).slice(0, 1).map((g) => g.id)));
    setQty(1); setNote(''); setMore(false); setTried(false);
    api.post('/api/cart/suggest', { storeId, itemIds: [item.id] }).then(setPairs).catch(() => setPairs([]));
    window.scrollTo(0, 0);
  }, [item?.id]); // eslint-disable-line

  const missing = useMemo(() => (item?.groups || []).filter((g) => g.options.filter((o) => sel.has(o.id)).length < g.min), [item, sel]);
  if (!menu) return <div className="detail"><div className="skeleton" style={{ height: 360, borderRadius: 0 }} /></div>;
  if (!item) return <div className="detail page"><h2>Patiekalas nerastas</h2><Link className="btn" to="/menu">Į meniu</Link></div>;

  const unit = item.price + item.groups.flatMap((g) => g.options).filter((o) => sel.has(o.id)).reduce((s, o) => s + o.delta, 0);
  const cat = menu.categories.find((c) => c.id === item.categoryId);

  function toggle(g, o) {
    setSel((prev) => {
      const n = new Set(prev);
      if (g.max === 1) { g.options.forEach((x) => n.delete(x.id)); n.add(o.id); return n; }
      if (n.has(o.id)) n.delete(o.id);
      else if (g.options.filter((x) => n.has(x.id)).length < g.max) n.add(o.id);
      else notify(`Daugiausia ${g.max}`, 'bad');
      return n;
    });
  }
  const flip = (gid) => setOpen((p) => { const n = new Set(p); n.has(gid) ? n.delete(gid) : n.add(gid); return n; });

  function submit() {
    setTried(true);
    if (missing.length) { setOpen((p) => new Set([...p, ...missing.map((g) => g.id)])); return notify(`Pasirinkite: ${missing[0].name}`, 'bad'); }
    add({ itemId: item.id, qty, optionIds: [...sel], note: note.trim() });
    notify(`${item.name} krepšelyje`);
    back();
  }

  return (
    <div className="detail">
      <div className="detail-hero">
        <Photo item={item} w={480} h={420} out={item.soldOut} />
        <div className="bar">
          <button className="circle" onClick={back} aria-label="Atgal"><Icon.back /></button>
          <FavButton itemId={item.id} />
        </div>
      </div>

      <div className="detail-sheet">
        <div className="grab" />
        <div className="col" style={{ gap: 8 }}>
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <h1 style={{ fontSize: 24 }}>{item.name}</h1>
            <span className="pill"><Icon.clock /> {Math.max(1, Math.round(item.prepMin))} min</span>
          </div>
          <div className="row between">
            <span className="row small" style={{ gap: 8 }}><span className="circle xs" style={{ boxShadow: 'none', background: 'var(--soft)', fontSize: 15 }}>{item.emoji}</span>{cat?.name}</span>
            {item.orders60d > 0 && <span className="link" style={{ textDecoration: 'underline' }}>{item.orders60d} užsakymai per 60 d.</span>}
          </div>
        </div>

        <div className="col" style={{ gap: 6 }}>
          <p className={`muted ${more ? '' : 'clamp'}`} style={{ margin: 0, fontSize: 14 }}>
            {item.description}.{item.kcal ? ` ${item.kcal} kcal.` : ''}{item.allergens.length ? ` Alergenai: ${item.allergens.join(', ')}.` : ''}
          </p>
          <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setMore((v) => !v)}>{more ? 'Rodyti mažiau' : 'Skaityti daugiau'}</button>
        </div>

        {item.groups.length > 0 && (
          <section className="col" style={{ gap: 10 }}>
            <h2>Susidėliok</h2>
            {item.groups.map((g, gi) => {
              const isOpen = open.has(g.id);
              const chosen = g.options.filter((o) => sel.has(o.id));
              const bad = tried && missing.includes(g);
              return (
                <div key={g.id} className={`acc${isOpen ? ' open' : ' white'}`}>
                  <button className="acc-head" onClick={() => flip(g.id)} aria-expanded={isOpen}>
                    <span className="grow" style={{ padding: '4px 6px' }}>
                      <span className={`k${bad ? ' err' : ''}`}>{gi + 1} žingsnis · {g.min > 0 ? 'privaloma' : 'neprivaloma'}{g.max > 1 ? `, iki ${g.max}` : ''}</span>
                      <b>{g.name}</b>
                      {!isOpen && <span className="small muted ell" style={{ display: 'block' }}>{chosen.length ? chosen.map((o) => o.name).join(', ') : 'Nepasirinkta'}</span>}
                    </span>
                    <Icon.chev />
                  </button>
                  {isOpen && (
                    <div className="acc-body" role="group" aria-label={g.name}>
                      {g.options.map((o) => {
                        const on = sel.has(o.id);
                        return (
                          <button key={o.id} type="button" className={`opt${on ? ' on' : ''}`} onClick={() => toggle(g, o)} aria-pressed={on}>
                            <span className={`tick${g.max > 1 ? ' sq' : ''}`}>{on && <Icon.check />}</span>
                            <span className="grow">{o.name}</span>
                            {o.delta > 0 && <span className="muted small">+{eur(o.delta)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <label className="field" style={{ marginTop: 4 }}>Pastaba virtuvei
              <input className="input" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} placeholder="pvz. be svogūnų" />
            </label>
          </section>
        )}

        {pairs.length > 0 && (
          <section className="col" style={{ gap: 14 }}>
            <div className="sec-head"><h2>Tinka kartu</h2><Link to="/menu" className="link">Visas meniu</Link></div>
            <div className="hscroll">{pairs.map((p) => <ProductCard key={p.id} item={itemsById.get(p.id)} />)}</div>
          </section>
        )}
      </div>

      <div className="cta"><div>
        <Stepper value={qty} onChange={setQty} min={1} />
        <button className="btn big grow" onClick={submit} disabled={item.soldOut}>
          {item.soldOut ? 'Šiandien išparduota' : `Į krepšelį · ${eur(unit * qty)}`}
        </button>
      </div></div>
    </div>
  );
}
