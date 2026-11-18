import { sized } from '../ui.jsx';

/** Store pin as a DOM element (safe: text via textContent). Shared by the 3D and flat maps. */
export function pinEl(store, onClick) {
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

export function meEl() {
  const el = document.createElement('div');
  el.className = 'me-dot';
  el.setAttribute('aria-label', 'Jūsų vieta');
  return el;
}

/** Same circle-button controls for both engines. */
export function MapControls({ is3d, on3d, onZoom, onMe, onFitAll, showFit }) {
  return (<>
    <div className="map-ctrls">
      {on3d && <button className={`circle${is3d ? ' on' : ''}`} onClick={on3d} aria-pressed={is3d} aria-label="3D vaizdas">3D</button>}
      <button className="circle" onClick={() => onZoom(1)} aria-label="Priartinti">+</button>
      <button className="circle" onClick={() => onZoom(-1)} aria-label="Nutolinti">−</button>
      {onMe && <button className="circle" onClick={onMe} aria-label="Mano vieta">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="20" height="20"><circle cx="12" cy="12" r="3.5" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg></button>}
    </div>
    {showFit && <div className="map-bottom"><button className="chip sm" onClick={onFitAll}>Visi restoranai</button></div>}
  </>);
}

/** Padding that keeps pins + labels inside the card on narrow phones and wide desktops alike. */
export function fitPadding(el) {
  const w = el?.clientWidth || 360; const h = el?.clientHeight || 400;
  const x = Math.round(Math.min(110, Math.max(48, w * 0.18)));
  return { top: Math.round(Math.min(110, h * 0.22)), bottom: Math.round(Math.min(70, h * 0.12)), left: x, right: x };
}
