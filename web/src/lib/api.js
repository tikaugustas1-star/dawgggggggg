export class ApiError extends Error {
  constructor(msg, status, code) { super(msg); this.status = status; this.code = code; }
}

async function req(method, url, body) {
  const r = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(data.error || 'Klaida', r.status, data.code);
  return data;
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b = {}) => req('POST', u, b),
  patch: (u, b = {}) => req('PATCH', u, b),
};

export const eur = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
export const hhmm = (iso) => new Date(iso).toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' });
export const dayLabel = (iso) => {
  const d = new Date(iso); const t = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, t)) return 'Šiandien';
  if (same(d, new Date(t.getTime() + 86400000))) return 'Rytoj';
  return d.toLocaleDateString('lt-LT', { weekday: 'long', month: 'short', day: 'numeric' });
};
