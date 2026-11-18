import { lazy, Suspense, useCallback, useState } from 'react';

// Each engine is its own chunk: phones without WebGL never download the 3D library.
const Map3D = lazy(() => import('./map/Map3D.jsx'));
const FlatMap = lazy(() => import('./map/FlatMap.jsx'));

/** MapLibre needs WebGL2; old phones, Lockdown Mode and some power-saving modes don't have it. */
function canRun3D() {
  try {
    if (new URLSearchParams(location.search).get('map') === '2d') return false; // manual override / testing
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // release the probe context
    return true;
  } catch { return false; }
}

/** Store map: 3D when the device can, otherwise (or on any 3D failure) a flat map with the same pins. */
export default function StoreMap(props) {
  const [engine, setEngine] = useState(() => (canRun3D() ? '3d' : 'flat'));
  const [why, setWhy] = useState(null);
  const fallback = useCallback((reason) => { setWhy(reason); setEngine('flat'); }, []);
  return (
    <div className="mapcard">
      <Suspense fallback={<div className="map skeleton" style={{ borderRadius: 0 }} />}>
        {engine === '3d' ? <Map3D {...props} onFail={fallback} /> : <FlatMap {...props} />}
      </Suspense>
      {engine === 'flat' && why && <span className="map-note">Rodomas paprastas žemėlapis</span>}
    </div>
  );
}
