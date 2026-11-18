import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'app.db');

export function openDb(file = DB_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL,
    lat REAL NOT NULL, lng REAL NOT NULL, phone TEXT,
    hours_json TEXT NOT NULL,            -- {"mon":["10:00","22:00"],...}
    paused INTEGER NOT NULL DEFAULT 0,   -- kitchen "pause orders"
    delivery_radius_km REAL NOT NULL DEFAULT 5,
    delivery_fee_cents INTEGER NOT NULL DEFAULT 249,
    free_delivery_over_cents INTEGER NOT NULL DEFAULT 2500,
    min_order_cents INTEGER NOT NULL DEFAULT 800,
    slot_capacity INTEGER NOT NULL DEFAULT 8,
    prep_stations INTEGER NOT NULL DEFAULT 2
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'main',   -- main | side | drink | dessert  (used by upsell gap rule)
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL, image TEXT, emoji TEXT,
    tags TEXT NOT NULL DEFAULT '[]', kcal INTEGER, allergens TEXT NOT NULL DEFAULT '[]',
    prep_min REAL NOT NULL DEFAULT 6, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS option_groups (
    id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    name TEXT NOT NULL, min INTEGER NOT NULL DEFAULT 0, max INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL, price_delta_cents INTEGER NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sold_out (
    store_id INTEGER NOT NULL REFERENCES stores(id), item_id INTEGER NOT NULL REFERENCES items(id),
    PRIMARY KEY (store_id, item_id)
  );
  CREATE TABLE IF NOT EXISTS pairings (
    item_id INTEGER NOT NULL REFERENCES items(id), suggest_id INTEGER NOT NULL REFERENCES items(id),
    PRIMARY KEY (item_id, suggest_id)
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', -- customer | staff | admin
    points INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id), PRIMARY KEY (user_id, item_id)
  );
  CREATE TABLE IF NOT EXISTS promos (
    code TEXT PRIMARY KEY, kind TEXT NOT NULL,       -- percent | fixed | free_delivery
    value INTEGER NOT NULL DEFAULT 0, min_subtotal_cents INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER, used INTEGER NOT NULL DEFAULT 0, expires_at TEXT,
    first_order_only INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, label TEXT
  );
  CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, cost_points INTEGER NOT NULL, value_cents INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, public_token TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id), customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    fulfillment TEXT NOT NULL,           -- pickup | delivery
    address TEXT, lat REAL, lng REAL, notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending_payment',
    subtotal_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL DEFAULT 0,
    reward_cents INTEGER NOT NULL DEFAULT 0, delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
    tip_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL,
    promo_code TEXT, reward_id INTEGER, points_earned INTEGER NOT NULL DEFAULT 0, points_spent INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL,        -- card | cash
    payment_status TEXT NOT NULL DEFAULT 'unpaid', stripe_session_id TEXT,
    scheduled_for TEXT,                  -- ISO, null = ASAP
    slot_start TEXT NOT NULL,
    eta_min INTEGER, eta_max INTEGER, predicted_prep REAL,
    source TEXT NOT NULL DEFAULT 'app',  -- app | seed
    created_at TEXT NOT NULL, accepted_at TEXT, ready_at TEXT, completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_orders_store_status ON orders(store_id, status);
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id), name TEXT NOT NULL, qty INTEGER NOT NULL,
    unit_price_cents INTEGER NOT NULL, options_json TEXT NOT NULL DEFAULT '[]', note TEXT,
    line_total_cents INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_oi_order ON order_items(order_id);
  CREATE TABLE IF NOT EXISTS order_events (
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                  -- percent | fixed
    value INTEGER NOT NULL,              -- % or cents
    title TEXT NOT NULL,                 -- e.g. "Pietų pasiūlymas"
    days TEXT,                           -- JSON ["mon",...] or NULL = every day
    start_time TEXT, end_time TEXT,      -- 'HH:MM' store-local, NULL = whole day
    starts_on TEXT, ends_on TEXT,        -- 'YYYY-MM-DD', NULL = open-ended
    active INTEGER NOT NULL DEFAULT 1
  );
  `);
  // additive migrations for existing databases
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  const storeCols = cols('stores');
  if (!storeCols.has('image')) db.exec('ALTER TABLE stores ADD COLUMN image TEXT');
  if (!storeCols.has('about')) db.exec('ALTER TABLE stores ADD COLUMN about TEXT');
  const userCols = cols('users');
  if (!userCols.has('terms_accepted_at')) db.exec('ALTER TABLE users ADD COLUMN terms_accepted_at TEXT');
  if (!userCols.has('email_enc')) db.exec('ALTER TABLE users ADD COLUMN email_enc TEXT');       // encrypted email; `email` holds its blind index
  if (!userCols.has('failed_logins')) db.exec('ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0');
  if (!userCols.has('locked_until')) db.exec('ALTER TABLE users ADD COLUMN locked_until INTEGER');
  if (!cols('orders').has('phone_hash')) db.exec('ALTER TABLE orders ADD COLUMN phone_hash TEXT'); // blind index for first-order checks
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_phone_hash ON orders(phone_hash)');
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function kvGet(db, k, fallback) {
  const row = db.prepare('SELECT v FROM kv WHERE k = ?').get(k);
  return row ? JSON.parse(row.v) : fallback;
}
export function kvSet(db, k, v) {
  db.prepare('INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));
}

export function loadBrand() {
  const p = process.env.BRAND_CONFIG || path.join(ROOT, 'brand.config.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
