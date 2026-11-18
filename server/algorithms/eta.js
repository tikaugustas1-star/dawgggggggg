// Leg-based ETA (kitchen + travel + buffer), self-calibrating with EWMA.
// Under-promising is cheaper than lateness (DoorDash), so the upper bound is padded.

export function haversineKm(a, b) {
  const R = 6371; const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad; const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Raw prep minutes for a basket: the slowest item dominates, extra units add a little each. */
export function basketPrep(lines) {
  if (!lines.length) return 0;
  const slowest = Math.max(...lines.map((l) => l.prep_min));
  const units = lines.reduce((s, l) => s + l.qty, 0);
  return slowest + 0.5 * (units - 1);
}

export function estimate({ lines, activeOrders = 0, stations = 2, calibration = 1, distanceKm = 0,
  fulfillment = 'pickup', speedKmPerMin = 0.4, handoffMin = 5 }) {
  const prep = basketPrep(lines);
  const load = 1 + activeOrders / Math.max(1, stations * 2);
  const kitchen = prep * load * calibration;
  const travel = fulfillment === 'delivery' ? handoffMin + distanceKm / speedKmPerMin : 0;
  const base = kitchen + travel;
  const min = Math.max(5, Math.round(base));
  const max = Math.max(min + 5, Math.ceil(base * 1.25 + 3));
  return { prep: +(prep * calibration).toFixed(2), kitchen: +kitchen.toFixed(2), travel: +travel.toFixed(2), min, max };
}

/** EWMA update of the kitchen calibration factor from an observed prep duration. */
export function updateCalibration(current, actualMin, predictedMin, alpha = 0.2) {
  if (!(actualMin > 0) || !(predictedMin > 0)) return current;
  const ratio = Math.min(3, Math.max(0.3, actualMin / predictedMin));
  const next = (1 - alpha) * current + alpha * (current * ratio);
  return +Math.min(2, Math.max(0.6, next)).toFixed(4);
}
