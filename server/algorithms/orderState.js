// Order lifecycle state machine (tracker steps).
export const FLOW = {
  pickup: ['placed', 'accepted', 'preparing', 'ready', 'completed'],
  delivery: ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'],
};

const TERMINAL = new Set(['completed', 'cancelled']);

export function canTransition(fulfillment, from, to) {
  if (TERMINAL.has(from)) return false;
  if (to === 'cancelled') return from !== 'out_for_delivery';
  if (from === 'pending_payment') return to === 'placed';
  const f = FLOW[fulfillment];
  return f.indexOf(to) === f.indexOf(from) + 1;
}

export function nextStatus(fulfillment, from) {
  const f = FLOW[fulfillment]; const i = f.indexOf(from);
  return i >= 0 && i < f.length - 1 ? f[i + 1] : null;
}

export const ACTIVE = ['placed', 'accepted', 'preparing'];
