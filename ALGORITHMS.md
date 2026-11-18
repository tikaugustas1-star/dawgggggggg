# Algoritmai, paimti iš top brandų

Tyrimas: 2026-11-18. Šaltiniai pabaigoje. Svarbu: viešai prieinami šaltiniai aprašo **ką** šie brandai daro
(funkcijas, signalus), bet ne jų modelių vidų. Žemiau esantys algoritmai yra mūsų įgyvendinimai,
atkartojantys tą elgseną. Tai nėra nukopijuotas jų kodas, ir rezultatų (konversijos, upsell %) mes negarantuojame.

| # | Ką daro top brandas | Kas tai įrodo | Mūsų algoritmas | Failas |
|---|---|---|---|---|
| 1 | **Domino's Easy Order**: išsaugotas užsakymas, kurį pakartoji vienu paspaudimu; pradžioje 5 paspaudimai, vėliau "Zero Click" | Domino's FAQ, hospitalitytech | „Kartoti“: paskutinis užsakymas ir mėgstamiausi pagrindiniame ekrane, vienu paspaudimu į krepšelį, kainos ir prieinamumas tikrinami iš naujo | `server/algorithms/reorder.js` |
| 2 | **Starbucks Deep Brew**: personalizacija pagal pirkimų istoriją, paros laiką, orą ir vietą | Harvard D3, AI Magazine 2026 | Asmeninis reitingas: laike blėstantis vartotojo dažnis + paros meto populiarumas + bendras populiarumas + ryšys su krepšeliu | `server/algorithms/recommend.js` |
| 3 | **Chick-fil-A / McDonald's** „gal dar bulvyčių?“: siūlomi gėrimai ir priedai (cituojamas +50 % upsell, tai tiekėjo šaltinis) | mParticle, Algonomy | Krepšelio upsell: kartu perkamų prekių asociacijos (confidence × lift) + trūkstamos kategorijos taisyklė (yra pagrindinis, nėra gėrimo) + admino porų sąrašas, kol dar mažai duomenų | `server/algorithms/upsell.js` |
| 4 | **DoorDash / Zomato / Coupang ETA**: laikas skaidomas į etapus (virtuvė + kelionė + buferis); per mažas ETA kenkia labiau nei per didelis | DoorDash eng. blog, Coupang eng. | ETA = gaminimas (ilgiausias patiekalas + papildomos prekės) × virtuvės apkrova (eilė / stotys) + pristatymas (atstumas / greitis) + buferis. Kalibruojama EWMA pagal realius gaminimo laikus. Klientui rodomas intervalas, viršutinė riba konservatyvi | `server/algorithms/eta.js` |
| 5 | **Domino's Tracker**: statusas nuo užsakymo iki pristatymo kas minutę | Domino's App Store | Būsenų mašina (placed → accepted → preparing → ready → out_for_delivery → completed / cancelled), realiu laiku per SSE | `server/algorithms/orderState.js`, `server/events.js` |
| 6 | **Starbucks Rewards**: lojalumas yra personalizacijos variklis | Starbucks / PYMNTS | Taškai: 10 tšk./€, atlygiai už taškus, panaudojama apmokėjimo metu, taškai skaičiuojami tik serveryje | `server/algorithms/pricing.js` |
| 7 | **Chipotle / Starbucks** detalus patiekalo pritaikymas | App Store aprašymai | Modifikatorių grupės su min/max, kainų skirtumais ir numatytaisiais pasirinkimais. Serveris viską validuoja ir perskaičiuoja kainą (klientu nepasitikima) | `server/algorithms/pricing.js` |
| 8 | **Starbucks / Domino's** išankstiniai užsakymai ir pralaidumas | Starbucks: virtuvė pirmiau gamina pagal kliento atstumą | 15 min. laiko langai su talpa kiekvienai parduotuvei; pilni langai išjungiami; ASAP užsakymai įskaičiuojami į einamąjį langą | `server/algorithms/slots.js` |
| 9 | **Domino's** skundas: krepšelis dingsta perjungus programėlę | unitQ vartotojų atsiliepimai | Krepšelis išsaugomas `localStorage` + PWA, išlieka perkrovus ar perjungus programėlę. Tai daroma geriau nei pas Domino's | `web/src/lib/cart.jsx` |
| 10 | Paieška, atlaikanti klaidas | Bendra praktika | Diakritikų normalizavimas (ą→a, š→s…) + žetonų prefiksų atitikimas + Damerau-Levenshtein ≤1–2 | `web/src/lib/search.js` |
| 11 | Akcijų variklis (McDonald's app deals) | McDonald's push kuponai | Nuolaidų kodai: procentinė / fiksuota / nemokamas pristatymas, minimali suma, galiojimas, panaudojimų limitas, tik pirmam užsakymui. Validuojama serveryje | `server/algorithms/pricing.js` |
| 12 | Svečio pirkimas (frikcijos mažinimas) | Bendra QSR praktika | Galima užsakyti be paskyros. Paskyra suteikia taškus, istoriją ir „Kartoti“ | `server/index.js` |
| 13 | „86“: išparduota prekė (POS praktika) | Restoranų operacijos | Prekės išjungimas konkrečioje parduotuvėje iš virtuvės ekrano, iškart matoma kliento meniu | `server/index.js` |

## Formulės

### Asmeninis reitingas (2)
```
score(i) = 0.45·U(i) + 0.25·D(i, daypart) + 0.15·P(i) + 0.15·C(i, cart)
U = Σ qty·0.5^(age_days/30)   (vartotojo istorija, pusėjimo trukmė 30 d.), normalizuota iki 0..1
D = prekės dalis tame paros mete (rytas/pietūs/popietė/vakaras), normalizuota
P = bendras 60 d. populiarumas, normalizuotas
C = didžiausias krepšelio prekių lift su i, normalizuotas
```
Kai vartotojas naujas, U=0 ir svoriai persiskirsto: reitingą lemia D ir P.

### Upsell (3)
```
confidence(A→B) = orders(A∧B) / orders(A)
lift(A→B)      = confidence / P(B)
kandidatas, jei orders(A∧B) ≥ 3 ir lift > 1
score(B) = max_A conf·log2(1+lift) + 0.35·kategorijos_spraga(B) + 0.25·admino_pora(A,B)
```
Prekės, jau esančios krepšelyje, ir išparduotos prekės atmetamos. Rodomos ne daugiau kaip 3.

### ETA (4)
```
prep    = max(item.prep) + 0.5·(Σ qty − 1)                      (minutės)
load    = 1 + aktyvūs_užsakymai / (stotys·2)
kitchen = prep·load·kalibracija
kalibracija ← 0.8·kalibracija + 0.2·(realus_gaminimas / prognozė)   (EWMA, ribos 0.6..2.0)
delivery = 5 + haversine_km / 0.4 km/min                        (tik pristatymui)
ETA [min, max] = [kitchen+delivery, ⌈(kitchen+delivery)·1.25 + 3⌉]
```

## Šaltiniai
- https://www.mparticle.com/blog/quick-serve-restaurant-app
- https://algonomy.com/?p=58038
- https://anyware.dominos.com
- https://hospitalitytech.com/new-dominos-app-seeks-eliminate-ordering-friction
- https://unitq.com/unitq-scorecards/dominospizzausa
- https://apps.apple.com/us/app/-/id436491861
- https://d3.harvard.edu/platform-digit/submission/brewing-with-a-dash-of-data-and-analytics-starbucks/
- https://publication.aimagazine.com/ai-magazine-january-2026/0420777001765974917/p83
- https://careersatdoordash.com/?p=4704
- https://medium.com/coupang-engineering/overcoming-food-delivery-challenges-with-data-science-6420cac1d59
- https://techblog.cloudkitchens.com/p/food-prep-time-prediction
