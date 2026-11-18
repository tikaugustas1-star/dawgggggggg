import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { sized } from './ui.jsx';

// Free vector tiles, no API key. Style includes a 3D building layer ("building-3d").
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const VIEW_3D = { pitch: 60, bearing: -24, zoom: 16.4 };

function pinEl(store, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pin';
  el.setAttribute('aria-label', store.name);
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const face = mk('span', 'face');
  if (store.image) { const img = mk('img'); img.src = sized(store.image, 58, 58); img.alt = ''; face.append(img); }
  else face.append(mk('span', 'ini', store.name.slice(0, 1)));
  const lbl = mk('span', 'lbl');
  lbl.append(mk('span', `dot${store.open ? '' : ' off'}`), document.createTextNode(store.name));
  el.append(face, lbl);
  el.addEventListener('click', (e) => { e.stopPropagation(); onClick(store.id); });
  return el;
}

/** 3D store map: photo pins, user location dot, fly-to on select, 2D/3D toggle. */
export default function StoreMap({ stores, selected, onSelect, me }) {
  const box = useRef(null);
  const map = useRef(null);
  const pins = useRef(new Map());
  const meMarker = useRef(null);
  const [ready, setReady] = useState(false);
  const [is3d, setIs3d] = useState(true);
  const [error, setError] = useState(null);

  // create map once
  useEffect(() => {
    if (!box.current) return;
    let m;
    try {
      m = new maplibregl.Map({
        container: box.current, style: STYLE, center: [24.6, 54.8], zoom: 7, pitch: 40, bearing: -10,
        attributionControl: { compact: true }, dragRotate: true, maxPitch: 75,
      });
    } catch {
      setError('Žemėlapio nepavyko įkelti: įrenginys nepalaiko WebGL.');
      return undefined;
    }
    map.current = m;
    m.on('load', () => setReady(true));
    m.on('error', (e) => { if (!m.loaded() && e?.error?.status) setError('Žemėlapio nepavyko įkelti. Patikrinkite interneto ryšį.'); });
    return () => { m.remove(); map.current = null; pins.current.clear(); };
  }, []);

  // store pins
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    pins.current.forEach((mk) => mk.remove()); pins.current.clear();
    for (const s of stores) {
      const mk = new maplibregl.Marker({ element: pinEl(s, onSelect), anchor: 'bottom' }).setLngLat([s.lng, s.lat]).addTo(m);
      pins.current.set(s.id, mk);
    }
    if (!selected && stores.length) {
      const b = new maplibregl.LngLatBounds();
      stores.forEach((s) => b.extend([s.lng, s.lat]));
      m.fitBounds(b, { padding: { top: 110, bottom: 70, left: 110, right: 110 }, pitch: 40, maxZoom: 15, duration: 0 });
    }
  }, [ready, stores]); // eslint-disable-line

  // highlight + fly to the selected store
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    pins.current.forEach((mk, id) => mk.getElement().classList.toggle('on', id === selected));
    const s = stores.find((x) => x.id === selected);
    if (s) m.flyTo({ center: [s.lng, s.lat], ...(is3d ? VIEW_3D : { pitch: 0, bearing: 0, zoom: 16 }), duration: 1800, essential: true });
  }, [selected, ready]); // eslint-disable-line

  // user location (stays in the browser; never sent to the server)
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !me) return;
    if (!meMarker.current) {
      const el = document.createElement('div'); el.className = 'me-dot'; el.setAttribute('aria-label', 'Jūsų vieta');
      meMarker.current = new maplibregl.Marker({ element: el }).setLngLat([me.lng, me.lat]).addTo(m);
    } else meMarker.current.setLngLat([me.lng, me.lat]);
  }, [me, ready]);

  function toggle3d() {
    const m = map.current; if (!m) return;
    const next = !is3d; setIs3d(next);
    m.easeTo(next ? { pitch: VIEW_3D.pitch, bearing: VIEW_3D.bearing, duration: 800 } : { pitch: 0, bearing: 0, duration: 800 });
  }
  function fitAll() {
    const m = map.current; if (!m || !stores.length) return;
    onSelect(null);
    const b = new maplibregl.LngLatBounds();
    stores.forEach((s) => b.extend([s.lng, s.lat]));
    if (me) b.extend([me.lng, me.lat]);
    m.fitBounds(b, { padding: { top: 110, bottom: 70, left: 110, right: 110 }, pitch: is3d ? 40 : 0, bearing: is3d ? -10 : 0, maxZoom: 15, duration: 1200 });
  }
  const zoom = (d) => map.current?.easeTo({ zoom: map.current.getZoom() + d, duration: 300 });
  const goMe = () => me && map.current?.flyTo({ center: [me.lng, me.lat], zoom: 15, duration: 1200 });

  return (
    <div className="mapcard">
      <div ref={box} className="map" aria-label="Restoranų žemėlapis" role="region" />
      {error && <div className="map-msg">{error}</div>}
      {!error && (<>
        <div className="map-ctrls">
          <button className={`circle${is3d ? ' on' : ''}`} onClick={toggle3d} aria-pressed={is3d} aria-label="3D vaizdas">3D</button>
          <button className="circle" onClick={() => zoom(1)} aria-label="Priartinti">+</button>
          <button className="circle" onClick={() => zoom(-1)} aria-label="Nutolinti">−</button>
          {me && <button className="circle" onClick={goMe} aria-label="Mano vieta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="20" height="20"><circle cx="12" cy="12" r="3.5" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg></button>}
        </div>
        {stores.length > 1 && <div className="map-bottom"><button className="chip sm" onClick={fitAll}>Visi restoranai</button></div>}
      </>)}
    </div>
  );
}
