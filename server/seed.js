// Seeds a fictional demo brand. Historical orders are SYNTHETIC (source='seed') so the
// recommendation/upsell/ETA algorithms have data on day one; replace with real data in production.
import './env.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb, tx, ROOT } from './db.js';
import { hashPassword } from './auth.js';
import { pathToFileURL } from 'node:url';

const HOURS = {
  mon: ['08:00', '22:00'], tue: ['08:00', '22:00'], wed: ['08:00', '22:00'], thu: ['08:00', '22:00'],
  fri: ['08:00', '23:30'], sat: ['09:00', '23:30'], sun: ['09:00', '21:00'],
};

const CATS = [
  ['Pusryčiai', 'pusryciai', 'main'], ['Burgeriai', 'burgeriai', 'main'], ["Bowl'ai", 'bowlai', 'main'],
  ['Užkandžiai', 'uzkandziai', 'side'], ['Gėrimai', 'gerimai', 'drink'], ['Desertai', 'desertai', 'dessert'],
];

const BURGER_OPTS = [
  ['Kepsnys', 1, 1, [['Jautiena', 0, 1], ['Traški vištiena', 0], ['Augalinis', 50]]],
  ['Priedai', 0, 4, [['Čederio sūris', 80], ['Šoninė', 120], ['Jalapeño', 50], ['Keptas kiaušinis', 90]]],
  ['Padažas', 1, 1, [['Firminis', 0, 1], ['Aštrus chipotle', 0], ['Česnakinis', 0]]],
];
const BOWL_OPTS = [
  ['Pagrindas', 1, 1, [['Ryžiai', 0, 1], ['Bolivinė balanda', 60], ['Salotos', 0]]],
  ['Papildomai', 0, 3, [['Avokadas', 150], ['Marinuotas kiaušinis', 90], ['Edamame', 70]]],
];
const SIZE = (big) => [['Dydis', 1, 1, [['Įprastas', 0, 1], ['Didelis', big]]]];

// [cat, name, desc, price, emoji, prep, kcal, tags, allergens, options]
const ITEMS = [
  ['pusryciai', 'Kiaušinių bandelė', 'Briošo bandelė, plaktas kiaušinis, čederis, šoninė', 549, '🥯', 5, 520, ['bestseller'], ['gliutenas', 'kiaušiniai', 'pienas'], null],
  ['pusryciai', 'Avižinė su uogomis', 'Avižos ant avižų pieno, miško uogos, medus', 449, '🥣', 3, 380, ['vegetariška'], ['gliutenas'], null],
  ['burgeriai', 'Smash burgeris', 'Du traškūs jautienos paplotėliai, čederis, marinuoti agurkai', 899, '🍔', 8, 780, ['bestseller'], ['gliutenas', 'pienas'], BURGER_OPTS],
  ['burgeriai', 'Aštrus vištienos', 'Traški vištiena, chipotle majonezas, kopūstų salotos', 849, '🌶️', 9, 720, ['aštru'], ['gliutenas', 'kiaušiniai'], BURGER_OPTS],
  ['burgeriai', 'Grybų ir trumų', 'Jautiena, kepti pievagrybiai, trumų majonezas, šveicariškas sūris', 1049, '🍄', 9, 840, ['naujiena'], ['gliutenas', 'pienas', 'kiaušiniai'], BURGER_OPTS],
  ['burgeriai', 'Augalinis klasikas', 'Augalinis paplotėlis, pomidoras, salotos, veganiškas padažas', 899, '🌱', 8, 610, ['veganiška'], ['gliutenas', 'soja'], BURGER_OPTS],
  ['bowlai', 'Teriyaki vištienos bowl', 'Glazūruota vištiena, edamame, agurkai, sezamas', 949, '🍱', 7, 640, ['bestseller'], ['soja', 'sezamas'], BOWL_OPTS],
  ['bowlai', 'Lašišos poke', 'Lašiša, avokadas, mango, nori, ponzu', 1199, '🐟', 6, 590, [], ['žuvis', 'soja', 'sezamas'], BOWL_OPTS],
  ['bowlai', 'Falafelių bowl', 'Falafeliai, humusas, keptos daržovės, tahini', 899, '🧆', 6, 610, ['veganiška'], ['sezamas'], BOWL_OPTS],
  ['uzkandziai', 'Bulvytės', 'Traškios bulvytės su jūros druska', 299, '🍟', 4, 340, ['bestseller'], [], SIZE(100)],
  ['uzkandziai', 'Batatų bulvytės', 'Batatai, rūkyta paprika, česnakinis padažas', 399, '🍠', 5, 380, [], ['kiaušiniai'], SIZE(100)],
  ['uzkandziai', 'Vištienos kąsneliai', '6 vnt. su medaus ir garstyčių padažu', 549, '🍗', 6, 420, [], ['gliutenas'], null],
  ['uzkandziai', 'Svogūnų žiedai', 'Alaus tešloje, su BBQ padažu', 399, '🧅', 5, 360, [], ['gliutenas'], null],
  ['gerimai', 'Naminis limonadas', 'Citrina, mėta, šiek tiek cukraus', 299, '🍋', 1, 120, [], [], SIZE(80)],
  ['gerimai', 'Kola', '0,5 l', 249, '🥤', 0.5, 210, [], [], null],
  ['gerimai', 'Šaltalankių arbata', 'Šilta, su medumi ir apelsinu', 349, '🍵', 2, 140, ['sezoninis'], [], null],
  ['gerimai', 'Kava su pienu', 'Dvigubas espresso, pienas', 329, '☕', 2, 150, [], ['pienas'], [['Pienas', 1, 1, [['Karvės', 0, 1], ['Avižų', 40]]]]],
  ['desertai', 'Sūrio pyragas', 'Niujorko stiliaus, su braškių padažu', 449, '🍰', 1, 450, [], ['pienas', 'gliutenas', 'kiaušiniai'], null],
  ['desertai', 'Vanilinis kokteilis', 'Tirštas pieno kokteilis', 399, '🥛', 3, 520, [], ['pienas'], null],
];

// Demo photos: Unsplash (free licence, hotlinked). Replace with the brand's own photography.
const PHOTO = {
  'Kiaušinių bandelė': '1608039829572-78524f79c4c7',
  'Avižinė su uogomis': '1495214783159-3503fd1b572d',
  'Smash burgeris': '1572802419224-296b0aeee0d9',
  'Aštrus vištienos': '1606755962773-d324e0a13086',
  'Grybų ir trumų': '1568901346375-23c9450c58cd',
  'Augalinis klasikas': '1520072959219-c595dc870360',
  'Teriyaki vištienos bowl': '1546069901-ba9599a7e63c',
  'Lašišos poke': '1512621776951-a57141f2eefd',
  'Falafelių bowl': '1540420773420-3366772f4999',
  'Bulvytės': '1630384060421-cb20d0e0649d',
  'Batatų bulvytės': '1573080496219-bb080dd4f877',
  'Vištienos kąsneliai': '1626082927389-6cd097cdc6ec',
  'Svogūnų žiedai': '1639024471283-03518883512d',
  'Naminis limonadas': '1621263764928-df1444c5e859',
  'Kola': '1556679343-c7306c1976bc',
  'Šaltalankių arbata': '1571934811356-5cc061b6821f',
  'Kava su pienu': '1509042239860-f550ce710b93',
  'Sūrio pyragas': '1533134242443-d4fd215305ad',
  'Vanilinis kokteilis': '1572490122747-3968b75cc699',
};
const photoUrl = (name) => (PHOTO[name] ? `https://images.unsplash.com/photo-${PHOTO[name]}?auto=format&fit=crop&q=80` : null);

const PAIRS = [['Smash burgeris', 'Bulvytės'], ['Aštrus vištienos', 'Naminis limonadas'], ['Lašišos poke', 'Naminis limonadas'],
  ['Kiaušinių bandelė', 'Kava su pienu'], ['Grybų ir trumų', 'Batatų bulvytės']];

// Deterministic PRNG so the demo is reproducible.
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// In production never seed the public example passwords: use the env value, or generate one and print it once.
const EXAMPLE_PW = new Set(['Demo-Admin-2026!', 'Demo-Virtuve-2026!', 'Demo-Klientas-2026!']);
function seedPassword(name) {
  const v = process.env[name];
  if (process.env.NODE_ENV !== 'production' || (v && !EXAMPLE_PW.has(v) && v.length >= 12)) return v;
  const gen = crypto.randomBytes(12).toString('base64url');
  console.warn(`[seed] ${name} not set (or is the public example value). Generated: ${gen}  — set ${name} in the host's environment.`);
  return gen;
}

export function seed(db, { reset = false } = {}) {
  if (!reset && db.prepare('SELECT COUNT(*) n FROM items').get().n > 0) return false;
  const rand = rng(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  tx(db, () => {
    db.exec(`DELETE FROM order_events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM favorites; DELETE FROM sessions;
      DELETE FROM users; DELETE FROM sold_out; DELETE FROM pairings; DELETE FROM options; DELETE FROM option_groups;
      DELETE FROM items; DELETE FROM categories; DELETE FROM stores; DELETE FROM promos; DELETE FROM rewards; DELETE FROM kv;`);
    const st = db.prepare(`INSERT INTO stores(name,address,lat,lng,phone,hours_json,delivery_radius_km,delivery_fee_cents,free_delivery_over_cents,min_order_cents,slot_capacity,prep_stations,image,about) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    st.run('Šilta Gedimino', 'Gedimino pr. 9, Vilnius', 54.6872, 25.2797, '+370 600 00001', JSON.stringify(HOURS), 5, 249, 2500, 800, 10, 3,
      photoUrl('Smash burgeris'), 'Senamiesčio pakraštyje, 2 min. nuo Katedros aikštės. Užsakymą atsiimsite prie kasos, prisistatę kodu.');
    st.run('Šilta Laisvės', 'Laisvės al. 50, Kaunas', 54.8975, 23.915, '+370 600 00002', JSON.stringify(HOURS), 4, 199, 2500, 800, 8, 2,
      photoUrl('Lašišos poke'), 'Laisvės alėjos viduryje, šalia Muzikinio teatro. Vasarą veikia terasa.');

    const catIds = {};
    CATS.forEach(([name, slug, role], i) => {
      catIds[slug] = Number(db.prepare('INSERT INTO categories(name,slug,role,sort) VALUES(?,?,?,?)').run(name, slug, role, i).lastInsertRowid);
    });
    const itemIds = {};
    const insItem = db.prepare(`INSERT INTO items(category_id,name,description,price_cents,emoji,image,prep_min,kcal,tags,allergens,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    const insG = db.prepare('INSERT INTO option_groups(item_id,name,min,max,sort) VALUES(?,?,?,?,?)');
    const insO = db.prepare('INSERT INTO options(group_id,name,price_delta_cents,is_default) VALUES(?,?,?,?)');
    ITEMS.forEach(([cat, name, desc, price, emoji, prep, kcal, tags, allergens, groups], i) => {
      const id = Number(insItem.run(catIds[cat], name, desc, price, emoji, photoUrl(name), prep, kcal, JSON.stringify(tags), JSON.stringify(allergens), i).lastInsertRowid);
      itemIds[name] = id;
      (groups || []).forEach(([gname, min, max, opts], gi) => {
        const gid = insG.run(id, gname, min, max, gi).lastInsertRowid;
        opts.forEach(([oname, delta, def]) => insO.run(gid, oname, delta, def ? 1 : 0));
      });
    });
    for (const [a, b] of PAIRS) db.prepare('INSERT INTO pairings VALUES(?,?)').run(itemIds[a], itemIds[b]);

    const insU = db.prepare('INSERT INTO users(email,name,phone,password_hash,role,points) VALUES(?,?,?,?,?,?)');
    insU.run(process.env.ADMIN_EMAIL, 'Administratorius', null, hashPassword(seedPassword('ADMIN_PASSWORD')), 'admin', 0);
    insU.run(process.env.STAFF_EMAIL, 'Virtuvė', null, hashPassword(seedPassword('STAFF_PASSWORD')), 'staff', 0);
    const custId = Number(insU.run(process.env.CUSTOMER_EMAIL, 'Demo Klientas', '+370 600 12345', hashPassword(seedPassword('CUSTOMER_PASSWORD')), 'customer', 480).lastInsertRowid);

    const insP = db.prepare('INSERT INTO promos(code,kind,value,min_subtotal_cents,max_uses,first_order_only,label) VALUES(?,?,?,?,?,?,?)');
    insP.run('SVEIKI10', 'percent', 10, 0, null, 1, '−10 % pirmam užsakymui');
    insP.run('NEMOKAMAI', 'free_delivery', 0, 1500, null, 0, 'Nemokamas pristatymas nuo 15 €');
    insP.run('PIETUS3', 'fixed', 300, 2000, 500, 0, '−3 € nuo 20 €');
    const insR = db.prepare('INSERT INTO rewards(name,cost_points,value_cents) VALUES(?,?,?)');
    insR.run('Nemokamas gėrimas', 250, 299); insR.run('Nemokamos bulvytės', 350, 399); insR.run('10 € nuolaida', 900, 1000);

    // ---- synthetic history (60 days) ----
    const byCat = (slug) => ITEMS.filter((x) => x[0] === slug).map((x) => x[1]);
    const insO2 = db.prepare(`INSERT INTO orders(code,public_token,user_id,customer_name,customer_phone,store_id,fulfillment,status,subtotal_cents,total_cents,payment_method,payment_status,slot_start,source,created_at,accepted_at,ready_at,completed_at,predicted_prep,points_earned)
      VALUES(?,?,?,?,?,?,?,'completed',?,?,'card','paid',?,'seed',?,?,?,?,?,?)`);
    const insI = db.prepare('INSERT INTO order_items(order_id,item_id,name,qty,unit_price_cents,line_total_cents) VALUES(?,?,?,?,?,?)');
    const priceOf = Object.fromEntries(ITEMS.map((x) => [x[1], x[3]]));
    const prepOf = Object.fromEntries(ITEMS.map((x) => [x[1], x[5]]));
    const now = Date.now();
    for (let n = 0; n < 420; n++) {
      const mine = n % 30 === 0;
      const day = Math.floor(rand() * 60);
      const hour = pick([8, 9, 12, 12, 13, 13, 14, 16, 18, 18, 19, 19, 20, 21]);
      const t = new Date(now - day * 86400000); t.setUTCHours(hour - 2, Math.floor(rand() * 60), 0, 0);
      if (t.getTime() > now) t.setTime(t.getTime() - 86400000);
      const basket = [];
      if (hour < 11) { basket.push(pick(byCat('pusryciai'))); if (rand() < 0.7) basket.push('Kava su pienu'); }
      else {
        const main = mine ? 'Smash burgeris' : rand() < (hour < 15 ? 0.45 : 0.7) ? pick(byCat('burgeriai')) : pick(byCat('bowlai'));
        basket.push(main);
        const isBurger = byCat('burgeriai').includes(main);
        if (isBurger && rand() < 0.65) basket.push(rand() < 0.7 ? 'Bulvytės' : 'Batatų bulvytės');
        if (!isBurger && rand() < 0.15) basket.push('Vištienos kąsneliai');
        if (rand() < 0.55) basket.push(isBurger ? (rand() < 0.6 ? 'Kola' : 'Naminis limonadas') : (rand() < 0.7 ? 'Naminis limonadas' : 'Šaltalankių arbata'));
        if (hour >= 17 && rand() < 0.22) basket.push(pick(byCat('desertai')));
      }
      const subtotal = basket.reduce((s, b) => s + priceOf[b], 0);
      const prep = Math.max(...basket.map((b) => prepOf[b])) + 0.5 * (basket.length - 1);
      const actual = prep * (1.05 + rand() * 0.35);
      const acc = new Date(t.getTime() + 60000);
      const ready = new Date(acc.getTime() + actual * 60000);
      const oid = Number(insO2.run(`S${String(n).padStart(4, '0')}`, crypto.randomBytes(12).toString('base64url'), mine ? custId : null,
        mine ? 'Demo Klientas' : 'Svečias', '+37060000000', rand() < 0.65 ? 1 : 2, rand() < 0.4 ? 'delivery' : 'pickup',
        subtotal, subtotal, t.toISOString(), t.toISOString(), acc.toISOString(), ready.toISOString(), new Date(ready.getTime() + 600000).toISOString(),
        prep, Math.floor(subtotal / 10)).lastInsertRowid);
      for (const b of basket) insI.run(oid, itemIds[b], b, 1, priceOf[b], priceOf[b]);
    }
  });
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  const done = seed(db, { reset: process.argv.includes('--reset') });
  console.log(done ? 'Seeded demo brand.' : 'Already seeded (use --reset).');
  if (!fs.existsSync(path.join(ROOT, 'data'))) fs.mkdirSync(path.join(ROOT, 'data'));
}
