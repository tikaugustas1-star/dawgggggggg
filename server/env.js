// Minimal .env loader (no dependency). Real env vars win over the file; .env.example is the fallback.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './db.js';

for (const name of ['.env', '.env.example']) {
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
