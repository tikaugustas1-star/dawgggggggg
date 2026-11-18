import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { pinEl, meEl, MapControls, fitPadding } from './shared.jsx';
import { useApp } from '../../lib/app.jsx';

// No-WebGL fallback: raster tiles + DOM markers. Works in every mobile browser.
// Tile provider comes from brand.config.json → map (the OSM default is for low traffic only).
const DEFAULT_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const icon = (el) => {
  const wrap = document.createElement('div');
  wrap.className = 'lf-anchor';
  wrap.append(el);
  return L.divIcon({ html: wrap, className: 'lf-icon', iconSize: [0, 0], iconAnchor: [0, 0] });
};

export default function FlatMap({ stores, selected, onSelect, me }) {
  const box = useRef(null);
  const map = useRef(null);
  const pins = useRef(new Map());
  const meMarker = useRef(null);
  const [ready, setReady] = useState(false);
  const { brand } = useApp();
  const cfg = brand?.map || {};

  useEffect(() => {
    const m = L.map(box.current, { zoomControl: false, attributionControl: true, center: [54.8, 24.6], zoom: 7 });
    m.attributionControl.setPrefix(false);
    L.tileLayer(cfg.rasterTiles || DEFAULT_TILES, { maxZoom: cfg.rasterMaxZoom || 19, attribution: cfg.rasterAttribution || DEFAULT_ATTR }).addTo(m);
    map.current = m; setReady(true);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; pins.current.clear(); meMarker.current = null; };
  }, []); // eslint-disable-line

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    pins.current.forEach((mk) => mk.remove()); pins.current.clear();
    for (const s of stores) pins.current.set(s.id, L.marker([s.lat, s.lng], { icon: icon(pinEl(s, onSelect)), keyboard: false }).addTo(m));
    if (!selected && stores.length) fit(false);
  }, [ready, stores]); // eslint-disable-line

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    pins.current.forEach((mk, id) => mk.getElement()?.querySelector('.pin')?.classList.toggle('on', id === selected));
    const s = stores.find((x) => x.id === selected);
    if (s) m.flyTo([s.lat, s.lng], 17, { duration: 1.2 });
  }, [selected, ready]); // eslint-disable-line

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !me) return;
    if (!meMarker.current) meMarker.current = L.marker([me.lat, me.lng], { icon: L.divIcon({ html: meEl(), className: 'lf-icon lf-me', iconSize: [18, 18] }) }).addTo(m);
    else meMarker.current.setLatLng([me.lat, me.lng]);
  }, [me, ready]);

  function fit(animate = true) {
    const m = map.current; if (!m || !stores.length) return;
    const pts = stores.map((s) => [s.lat, s.lng]);
    if (me) pts.push([me.lat, me.lng]);
    const p = fitPadding(box.current);
    m.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [p.left, p.top], paddingBottomRight: [p.right, p.bottom], maxZoom: 15, animate });
  }

  return (<>
    <div ref={box} className="map" aria-label="Restoranų žemėlapis" role="region" />
    <MapControls onZoom={(d) => map.current?.setZoom(map.current.getZoom() + d)}
      onMe={me ? () => map.current?.flyTo([me.lat, me.lng], 15) : null}
      onFitAll={() => { onSelect(null); fit(); }} showFit={stores.length > 1} />
  </>);
}
