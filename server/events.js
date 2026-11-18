// Server-Sent Events hub: live order tracker (customer) and live ticket board (kitchen).
const channels = new Map();

export function subscribe(channel, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); channels.get(channel)?.delete(res); });
}

export function publish(channel, event, data) {
  const subs = channels.get(channel);
  if (!subs) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) res.write(msg);
}
