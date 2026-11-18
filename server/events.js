// Server-Sent Events hub: live order tracker (customer) and live ticket board (kitchen).
// Connection caps stop one client from exhausting the server with open streams.
const channels = new Map();
const perIp = new Map();
const MAX_PER_IP = 12;
const MAX_TOTAL = 2000;
let total = 0;

export function subscribe(channel, req, res) {
  const ip = req.ip || 'unknown';
  if (total >= MAX_TOTAL || (perIp.get(ip) || 0) >= MAX_PER_IP) {
    res.status(429).json({ error: 'Per daug atvirų ryšių' });
    return false;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  total++; perIp.set(ip, (perIp.get(ip) || 0) + 1);
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    const set = channels.get(channel);
    set?.delete(res);
    if (set && !set.size) channels.delete(channel);
    total--; const n = (perIp.get(ip) || 1) - 1;
    if (n) perIp.set(ip, n); else perIp.delete(ip);
  });
  return true;
}

export function publish(channel, event, data) {
  const subs = channels.get(channel);
  if (!subs) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) res.write(msg);
}
