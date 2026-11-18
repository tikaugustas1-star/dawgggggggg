import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/app.jsx';
import { eur } from '../lib/api.js';
import { NavHead, Photo, Icon } from '../components/ui.jsx';

const StoreMap = lazy(() => import('../components/StoreMap.jsx')); // map library loads only on this page

const DAYS = [['mon', 'Pirmadienis'], ['tue', 'Antradienis'], ['wed', 'Trečiadienis'], ['thu', 'Ketvirtadienis'], ['fri', 'Penktadienis'], ['sat', 'Šeštadienis'], ['sun', 'Sekmadienis']];
const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ON_DAY = { mon: 'pirmadienį', tue: 'antradienį', wed: 'trečiadienį', thu: 'ketvirtadienį', fri: 'penktadienį', sat: 'šeštadienį', sun: 'sekmadienį' };

function localNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), min: Number(p.hour) * 60 + Number(p.minute) };
}
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Human status line from opening hours, e.g. "Atidaryta iki 22:00" / "Atsidaro rytoj 08:00". */
export function hoursStatus(s) {
  if (s.paused) return 'Laikinai nepriima užsakymų';
  const { dow, min } = localNow();
  const today = s.hours[KEYS[dow]];
  if (s.open && today) return `Atidaryta iki ${today[1]}`;
  if (today && min < toMin(today[0])) return `Atsidaro šiandien ${today[0]}`;
  for (let d = 1; d <= 7; d++) {
    const h = s.hours[KEYS[(dow + d) % 7]];
    if (h) return `Atsidaro ${d === 1 ? 'rytoj' : ON_DAY[KEYS[(dow + d) % 7]]} ${h[0]}`;
  }
  return 'Uždaryta';
}

function km(a, b) {
  const R = 6371; const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function Locations() {
  const { stores, setPref, storeId, notify, brand } = useApp();
  const nav = useNavigate();
  const [selected, setSelected] = useState(null);
  const [me, setMe] = useState(null);
  const todayKey = KEYS[localNow().dow];

  const list = useMemo(() => [...stores].map((s) => ({ ...s, dist: me ? km(me, s) : null }))
    .sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0) || a.id - b.id), [stores, me]);
  const cities = [...new Set(stores.map((s) => s.address.split(',').pop().trim()))];

  function locate() {
    if (!navigator.geolocation) return notify('Naršyklė nepalaiko vietos nustatymo', 'bad');
    navigator.geolocation.getCurrentPosition(
      (p) => { setMe({ lat: p.coords.latitude, lng: p.coords.longitude }); notify('Rodome artimiausius restoranus'); },
      () => notify('Nepavyko nustatyti vietos', 'bad'), { enableHighAccuracy: true, timeout: 8000 });
  }
  function orderHere(s) { setPref({ storeId: s.id }); notify(`Užsakysite iš: ${s.name}`); nav('/menu'); }
  const directions = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;

  return (
    <>
      <NavHead title="Kur mus rasti" sub={`${stores.length} restoranai · ${cities.join(', ')}`} back="/"
        right={<button className="circle" onClick={locate} aria-label="Rasti artimiausią"><Icon.pin /></button>} />
      <div className="page" style={{ paddingTop: 8 }}>
        <Suspense fallback={<div className="mapcard skeleton" />}>
          <StoreMap stores={stores} selected={selected} onSelect={setSelected} me={me} />
        </Suspense>

        <section className="col" style={{ gap: 10 }}>
          <div className="sec-head"><h2>Restoranai</h2>{!me && <button className="link" onClick={locate}>Rasti artimiausią</button>}</div>
          {list.map((s) => {
            const open = s.id === selected;
            return (
              <div key={s.id} className={`acc${open ? ' open' : ' white'}`}>
                <button className="acc-head" onClick={() => setSelected(open ? null : s.id)} aria-expanded={open}>
                  <Photo item={{ image: s.image, emoji: '📍' }} w={66} h={54} className="thumb" />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="k row" style={{ gap: 6 }}><span className={`dot${s.open ? '' : ' off'}`} />{hoursStatus(s)}</span>
                    <b className="ell">{s.name}</b>
                    <span className="small muted ell" style={{ display: 'block' }}>{s.address}{s.dist != null ? ` · ${s.dist < 10 ? s.dist.toFixed(1) : Math.round(s.dist)} km` : ''}</span>
                  </span>
                  <Icon.chev />
                </button>
                {open && (
                  <div className="acc-body" style={{ gap: 12 }}>
                    {s.about && <p className="small" style={{ margin: 0 }}>{s.about}</p>}
                    <div className="acc white" style={{ padding: 14 }}>
                      <span className="lbl" style={{ marginTop: 0 }}>Darbo laikas</span>
                      <div className="hours">
                        {DAYS.map(([k, label]) => (
                          <span key={k} style={{ display: 'contents' }}>
                            <span className={k === todayKey ? 'today' : 'muted'}>{label}{k === todayKey ? ' (šiandien)' : ''}</span>
                            <span className={k === todayKey ? 'today' : ''}>{s.hours[k] ? `${s.hours[k][0]}–${s.hours[k][1]}` : 'Uždaryta'}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="small muted">Pristatymas iki {s.deliveryRadiusKm} km · {eur(s.deliveryFee)}, nemokamai nuo {eur(s.freeDeliveryOver)}</div>
                    <div className="row" style={{ gap: 8 }}>
                      <a className="btn grow" href={directions(s)} target="_blank" rel="noopener noreferrer">Maršrutas</a>
                      <button className={`btn soft grow`} onClick={() => orderHere(s)}>{s.id === storeId ? 'Užsakyti' : 'Užsakyti čia'}</button>
                      <a className="circle" href={`tel:${s.phone}`} aria-label={`Skambinti ${s.name}`} style={{ width: 52, height: 52 }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" /></svg>
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="loyal" style={{ gap: 8 }}>
          <h2 style={{ color: '#fff' }}>Užsuk arba užsisakyk</h2>
          <p className="small" style={{ margin: 0, opacity: .8 }}>
            {brand?.name} virtuvės dirba {cities.join(' ir ')}. Užsakykite appse ir atsiimkite be eilės: kai patiekalas bus paruoštas, gausite pranešimą,
            o prie kasos tereikės pasakyti užsakymo kodą. Pristatome iki {Math.max(...stores.map((s) => s.deliveryRadiusKm), 0)} km nuo restorano.
          </p>
          <button className="btn" style={{ background: '#fff', color: 'var(--ink)', alignSelf: 'flex-start', marginTop: 6 }} onClick={() => nav('/menu')}>Žiūrėti meniu</button>
        </section>
        <p className="tiny muted" style={{ textAlign: 'center', margin: 0 }}>Žemėlapis: © OpenFreeMap, © OpenMapTiles, © OpenStreetMap bendruomenė</p>
      </div>
    </>
  );
}
