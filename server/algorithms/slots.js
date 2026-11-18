// 15-minute capacity-throttled time slots (order-ahead throughput control).
import { windowFor, isOpen } from './time.js';

export const SLOT_MIN = 15;
const MS = SLOT_MIN * 60000;

export const slotStart = (date) => new Date(Math.floor(date.getTime() / MS) * MS);

/**
 * @param used Map<isoSlotStart, count> of orders already booked per slot
 * @returns [{start: ISO, available: bool, left: n}]
 */
export function listSlots({ hours, now = new Date(), used = new Map(), capacity = 8, leadMin = 20, days = 2 }) {
  const out = [];
  const earliest = new Date(now.getTime() + leadMin * 60000);
  for (let d = 0; d < days; d++) {
    const w = windowFor(hours, new Date(now.getTime() + d * 86400000));
    if (!w) continue;
    // last slot must start at least 15 min before close
    for (let t = Math.ceil(w.open.getTime() / MS) * MS; t + MS <= w.close.getTime(); t += MS) {
      if (t < earliest.getTime()) continue;
      const iso = new Date(t).toISOString();
      const left = capacity - (used.get(iso) || 0);
      out.push({ start: iso, available: left > 0, left: Math.max(0, left) });
    }
  }
  return out;
}

/** Validate an ASAP or scheduled request; returns the slot ISO to book. */
export function resolveSlot({ hours, paused, scheduledFor, now = new Date(), used, capacity, leadMin }) {
  if (paused) return { ok: false, reason: 'Parduotuvė laikinai nepriima užsakymų' };
  if (!scheduledFor) {
    if (!isOpen(hours, now)) return { ok: false, reason: 'Šiuo metu uždaryta. Pasirinkite vėlesnį laiką.' };
    const iso = slotStart(now).toISOString();
    // ASAP orders may spill one slot over capacity, then the kitchen is "busy"
    if ((used.get(iso) || 0) >= capacity * 1.5) return { ok: false, reason: 'Virtuvė perkrauta. Pasirinkite laiką.' };
    return { ok: true, slot: iso };
  }
  const s = slotStart(new Date(scheduledFor)).toISOString();
  const slot = listSlots({ hours, now, used, capacity, leadMin }).find((x) => x.start === s);
  if (!slot) return { ok: false, reason: 'Šis laikas negalimas' };
  if (!slot.available) return { ok: false, reason: 'Šis laikas jau užimtas' };
  return { ok: true, slot: s };
}
