import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre v6 runs tile parsing in a separate worker file: let Vite bundle it (with its imports) and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);
import { pinEl, meEl, MapControls, fitPadding } from './shared.jsx';

// Free vector tiles, no API key. Style includes a 3D building layer ("building-3d").
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const VIEW_3D = { pitch: 60, bearing: -24, zoom: 16.4 };
const LOAD_TIMEOUT_MS = 12000;

/** WebGL 3D map. Calls onFail() on any sign the device can't run it, so the caller can fall back. */
export default function Map3D({ stores, selected, onSelect, me, onFail }) {
  const box = useRef(null);
  const map = useRef(null);
  const pins = useRef(new Map());
  const meMarker = useRef(null);
  const [ready, setReady] = useState(false);
  const [is3d, setIs3d] = useState(true);

  useEffect(() => {
    if (!box.current) return undefined;
    let m; let loaded = false;
    try {
      m = new maplibregl.Map({
        container: box.current, style: STYLE, center: [24.6, 54.8], zoom: 7, pitch: 40, bearing: -10,
        attributionControl: { compact: true }, maxPitch: 75,
        pixelRatio: Math.min(2, window.devicePixelRatio || 1), // phones: cap GPU load
        fadeDuration: 0, antialias: false,
      });
    } catch { onFail('init'); return undefined; }
    map.current = m;
    const timer = setTimeout(() => { if (!loaded) onFail('timeout'); }, LOAD_TIMEOUT_MS);
    m.on('load', () => { loaded = true; clearTimeout(timer); setReady(true); });
    // before the first render any HTTP, WebGL or worker failure means this device/network can't show the 3D map
    m.on('error', (e) => { if (!loaded && (e?.error?.status || /webgl|worker/i.test(String(e?.error?.message)))) onFail('error'); });
    const canvas = m.getCanvas();
    const lost = (ev) => { ev.preventDefault(); onFail('context-lost'); };
    canvas.addEventListener('webglcontextlost', lost);
    return () => { clearTimeout(timer); canvas.removeEventListener('webglcontextlost', lost); m.remove(); map.current = null; pins.current.clear(); meMarker.current = null; };
  }, []); // eslint-disable-line

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    pins.current.forEach((mk) => mk.remove()); pins.current.clear();
    for (const s of stores) pins.current.set(s.id, new maplibregl.Marker({ element: pinEl(s, onSelect), anchor: 'bottom' }).setLngLat([s.lng, s.lat]).addTo(m));
    if (!selected && stores.length) fit(0);
  }, [ready, stores]); // eslint-disable-line

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    pins.current.forEach((mk, id) => mk.getElement().classList.toggle('on', id === selected));
    const s = stores.find((x) => x.id === selected);
    if (s) m.flyTo({ center: [s.lng, s.lat], ...(is3d ? VIEW_3D : { pitch: 0, bearing: 0, zoom: 16 }), duration: 1800, essential: true });
  }, [selected, ready]); // eslint-disable-line

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !me) return;
    if (!meMarker.current) meMarker.current = new maplibregl.Marker({ element: meEl() }).setLngLat([me.lng, me.lat]).addTo(m);
    else meMarker.current.setLngLat([me.lng, me.lat]);
  }, [me, ready]);

  function fit(duration = 1200) {
    const m = map.current; if (!m || !stores.length) return;
    const b = new maplibregl.LngLatBounds();
    stores.forEach((s) => b.extend([s.lng, s.lat]));
    if (me) b.extend([me.lng, me.lat]);
    m.fitBounds(b, { padding: fitPadding(box.current), pitch: is3d ? 40 : 0, bearing: is3d ? -10 : 0, maxZoom: 15, duration });
  }
  function toggle3d() {
    const next = !is3d; setIs3d(next);
    map.current?.easeTo(next ? { pitch: VIEW_3D.pitch, bearing: VIEW_3D.bearing, duration: 800 } : { pitch: 0, bearing: 0, duration: 800 });
  }

  return (<>
    <div ref={box} className="map" aria-label="Restoranų žemėlapis" role="region" />
    <MapControls is3d={is3d} on3d={toggle3d} onZoom={(d) => map.current?.easeTo({ zoom: map.current.getZoom() + d, duration: 300 })}
      onMe={me ? () => map.current?.flyTo({ center: [me.lng, me.lat], zoom: 15, duration: 1200 }) : null}
      onFitAll={() => { onSelect(null); fit(); }} showFit={stores.length > 1} />
  </>);
}
