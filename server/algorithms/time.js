// Store-local time helpers (stores run on their own wall clock, not the server's).
export const TZ = process.env.STORE_TZ || 'Europe/Vilnius';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});

export function localParts(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second,
    dow: DAYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)],
  };
}

/** Offset (minutes) of TZ vs UTC at a given instant. */
function offsetMin(date) {
  const p = localParts(date);
  return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

/** Build an instant from a store-local wall time. */
export function fromLocal(y, m, d, h, min) {
  const guess = new Date(Date.UTC(y, m - 1, d, h, min));
  const off = offsetMin(guess);
  const t = new Date(guess.getTime() - off * 60000);
  const off2 = offsetMin(t); // DST edge correction
  return off2 === off ? t : new Date(guess.getTime() - off2 * 60000);
}

export function minutesOfDay(date) { const p = localParts(date); return p.h * 60 + p.min; }

export function daypart(date) {
  const h = localParts(date).h;
  if (h < 11) return 'morning';
  if (h < 15) return 'lunch';
  if (h < 17) return 'afternoon';
  return 'evening';
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Opening window for the local day containing `date`: {open, close} instants or null. Supports closing after midnight. */
export function windowFor(hours, date) {
  const p = localParts(date);
  const span = hours[p.dow];
  if (!span) return null;
  const o = toMin(span[0]); let c = toMin(span[1]);
  if (c <= o) c += 24 * 60;
  const open = fromLocal(p.y, p.m, p.d, 0, 0);
  return { open: new Date(open.getTime() + o * 60000), close: new Date(open.getTime() + c * 60000) };
}

export function isOpen(hours, now = new Date()) {
  for (const back of [0, 1]) { // also check yesterday's window that may extend past midnight
    const w = windowFor(hours, new Date(now.getTime() - back * 86400000));
    if (w && now >= w.open && now < w.close) return true;
  }
  return false;
}
