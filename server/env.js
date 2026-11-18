// Minimal .env loader (no dependency). Real env vars win over the file.
// .env.example is a LOCAL fallback only: in production it would inject localhost URLs and public demo passwords.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './db.js';

const files = process.env.NODE_ENV === 'production' ? ['.env'] : ['.env', '.env.example'];
for (const name of files) {
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
