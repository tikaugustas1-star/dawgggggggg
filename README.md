# White-label maisto užsakymo PWA

Vienas šablonas maisto brandams. Kiekvienas brandas gauna savo appsą: spalvas, logotipą, meniu ir restoranus.
Veikia telefone kaip programėlė (PWA, „Įdiegti į pradžios ekraną“), nereikia App Store.
Algoritmai ir jų kilmė (Domino's, Starbucks, McDonald's, DoorDash...) aprašyti [ALGORITHMS.md](ALGORITHMS.md).

## Paleidimas
```
npm install
npm run build
npm start            # http://localhost:3001
```
Kūrimo režimas su hot reload: `npm run dev` (UI http://localhost:5173, API 3001).
Testai: `npm test`. Duomenų bazės atstatymas į demo būseną: `npm run seed`.

Reikia Node 22.13+ (naudojamas integruotas `node:sqlite`, native priklausomybių nėra).

## Dizainas
Monochrominis, nuotraukomis paremtas stilius: baltas fonas, pilkos „soft“ kortelės, juodi pill mygtukai,
plaukiojanti tamsi apatinė navigacija, ant hero nuotraukos sukrautos kortelės, pilno ekrano patiekalo puslapis su ant nuotraukos
užeinančiu turinio lapu ir išskleidžiamomis pasirinkimų kortelėmis, prilipęs CTA mygtukas. Šriftas: Plus Jakarta Sans.
Spalvos yra `brand.config.json → theme`, todėl brandui pakanka pakeisti `primary`/`accent`.
Demo nuotraukos yra Unsplash (nemokama licencija, krauname tiesiai iš jų CDN, `server/seed.js → PHOTO`). Realiam brandui jas pakeiskite savo fotografijomis.
Vietoj reitingų rodomi tik tikri duomenys: gaminimo laikas ir užsakymų skaičius per 60 d. Išgalvotų atsiliepimų nėra.

## Ekranai
| Kelias | Kam | Kas |
|---|---|---|
| `/` | klientui | pasisveikinimas pagal paros metą, „Kartoti paskutinį“, asmeninė lentyna, mėgstami, taškai |
| `/menu` | klientui | nuotraukų tinklelis, kategorijos su scroll-spy, paieška ir filtrai (veganiška, aštru…) |
| `/item/:id` | klientui | pilno ekrano patiekalas: hero nuotrauka, pasirinkimų žingsniai, „Tinka kartu“, kiekis + CTA |
| `/locations` | klientui | „Kur mus rasti“: 3D žemėlapis (MapLibre + OpenFreeMap, be API rakto), nuotraukų smeigtukai, jūsų vieta, darbo laikas, maršrutas |
| `/cart` | klientui | vieno puslapio checkout: upsell, laiko langai, kontaktai, kodas, taškai, arbatpinigiai, mokėjimas |
| `/order/:token` | klientui | sekimas realiu laiku (SSE), pranešimas, kai paruošta, atšaukimas |
| `/orders`, `/account` | klientui | istorija + kartojimas, prisijungimas, lojalumas |
| `/kitchen` | virtuvei | bilietų lenta realiu laiku su garso signalu, vėlavimo spalvos, „86“ išparduota, pauzė |
| `/admin` | administratoriui | KPI, apyvarta, top patiekalai, ETA tikslumas/kalibracija, kainos, akcijos, restoranų nustatymai |

Demo paskyrų prisijungimai yra `.env.example`. **Prieš realų paleidimą juos pakeiskite** (`.env`).

## Naujas brandas
1. Nukopijuokite `brand.config.json`, pakeiskite pavadinimą, spalvas (`theme`), lojalumo ir pristatymo nustatymus.
2. `BRAND_CONFIG=./brands/naujas.json` faile `.env`.
3. Meniu, restoranai, valandos: `server/seed.js` (arba admin panelėje kainos, aktyvumas, akcijos). Nuotraukas nurodykite `items.image` (URL); be jų rodoma emoji plytelė.
4. `npm run seed` naujai DB.

## Mokėjimai
- **Be Stripe raktų**: „Kortele“ veikia kaip aiškiai pažymėtas DEMO (pinigai nenuskaičiuojami). „Atsiimant“ veikia visada.
- **Stripe**: į `.env` įrašykite `STRIPE_SECRET_KEY=sk_test_…` (pradžiai testinį) ir `STRIPE_WEBHOOK_SECRET`, o webhook nukreipkite į
  `POST /api/stripe/webhook`. Apmokėjimas tikrinamas serveryje (session id, suma, order id). Atšaukus apmokėtą užsakymą,
  `payment_status=refund_due`. Pačio grąžinimo Stripe'e kodas kol kas neatlieka.
- Stripe integracija parašyta, bet **neištestuota su tikrais raktais** (jų čia nebuvo).

## Saugumas
Kainas, nuolaidas, taškus ir laiko langus visada perskaičiuoja serveris (testas tikrina, kad suklastota kaina ignoruojama).
Slaptažodžiai saugomi scrypt maišos pavidalu, sesijos laikomos HttpOnly slapukuose, prisijungimui taikomas užklausų ribojimas.
Virtuvės ir admin API apsaugoti rolėmis.

## Žinomi apribojimai / kas toliau
- Žemėlapis: jei telefonas palaiko WebGL2, rodomas 3D (MapLibre + OpenFreeMap). Jei ne, arba jei 3D nepavyksta, automatiškai rodomas paprastas žemėlapis (Leaflet), su tais pačiais smeigtukais (`?map=2d` jį įjungia priverstinai).
  Paprasto žemėlapio plytelės pagal nutylėjimą yra OpenStreetMap: jos skirtos tik mažam srautui. Produkcijai nurodykite tiekėją su raktu `brand.config.json → map.rasterTiles`.
- Pristatymo zona tikrinama tik tada, kai klientas paspaudžia „Naudoti mano vietą“. Adreso geokodavimo nėra (reikėtų Google/Mapbox rakto).
- Kurjerių valdymo / maršrutų nėra: statusą „Išvežta“ žymi restoranas (tinka savo kurjeriams).
- Push pranešimai veikia tik naršyklėje, kol sekimo puslapis atidarytas (Notification API). Pilnam Web Push reikia VAPID raktų.
- Demo istoriniai užsakymai (`source='seed'`) yra sintetiniai, kad algoritmai turėtų duomenų nuo pirmos dienos.
- Prieš produkciją: HTTPS (`PUBLIC_URL=https://…`), DB atsarginės kopijos, tikri brando duomenys ir nuotraukos, privatumo/sąlygų puslapiai.

## Paleidimas internete (Render)
1. Repo turi `render.yaml` (Blueprint) ir `Dockerfile`.
2. Spauskite [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/tikaugustas1-star/dawgggggggg) arba Render → New → Blueprint ir pasirinkite šį repo.
3. Render pats sugeneruos atsitiktinius `ADMIN_PASSWORD`, `STAFF_PASSWORD` ir `CUSTOMER_PASSWORD` (juos rasite Render → Environment).
   `.env.example` slaptažodžiai yra vieši, todėl produkcijoje jie atmetami.
4. Adresas bus `https://food-order-app-xxxx.onrender.com`.

**Nemokamo plano apribojimai:** serveris užmiega po 15 min. be lankytojų (pirmas atidarymas užtrunka ~30–60 s),
o diskas laikinas, todėl SQLite duomenys (užsakymai, paskyros) dingsta po kiekvieno perkrovimo ar naujo deploy ir demo duomenys sukuriami iš naujo.
Pastoviems duomenims reikia mokamo plano su disku (`DB_PATH=/var/data/app.db`) arba išorinės DB.
