import { Link } from 'react-router-dom';
import { useApp } from '../lib/app.jsx';
import { NavHead } from '../components/ui.jsx';

// Legal texts are generated from brand.config.json → legal, so every white-label brand gets its own company details.
// They are a starting template, not legal advice: the brand must review them with a lawyer before going live.

function Doc({ title, sub, children }) {
  const { brand } = useApp();
  const L = brand?.legal || {};
  return (
    <>
      <NavHead title={title} sub={sub} back="/account" />
      <article className="page legal" style={{ paddingTop: 8 }}>
        {L.template && (
          <div className="notice">Tai demonstracinio brando šablonas. Prieš naudojant realiam verslui, įmonės duomenis ir tekstą būtina patikrinti su teisininku.</div>
        )}
        {children}
        <p className="tiny muted" style={{ margin: 0 }}>Atnaujinta {L.updated || '—'}</p>
      </article>
    </>
  );
}

const Sec = ({ h, children }) => <section className="col" style={{ gap: 8 }}><h2 style={{ fontSize: 17 }}>{h}</h2>{children}</section>;

export function Privacy() {
  const { brand } = useApp();
  const L = brand?.legal || {}; const name = brand?.name || '';
  return (
    <Doc title="Privatumo politika" sub={`${name} · asmens duomenų tvarkymas`}>
      <p>Šioje politikoje paaiškiname, kokius asmens duomenis tvarkome, kai naudojatės {name} programėle, kodėl ir kaip ilgai juos saugome ir kokias teises turite pagal Bendrąjį duomenų apsaugos reglamentą (BDAR).</p>

      <Sec h="1. Duomenų valdytojas">
        <p>{L.company}, įmonės kodas {L.code}, PVM kodas {L.vat}, {L.address}. Privatumo klausimais: <a href={`mailto:${L.email}`}>{L.email}</a>, tel. {L.phone}.</p>
      </Sec>

      <Sec h="2. Kokius duomenis tvarkome">
        <ul>
          <li><b>Paskyra:</b> vardas, el. paštas, telefono numeris (jei nurodote), slaptažodis (saugomas tik kaip kriptografinė maiša, jo nematome), paskyros sukūrimo ir taisyklių priėmimo data.</li>
          <li><b>Užsakymai:</b> užsakyti patiekalai ir pasirinkimai, sumos, nuolaidos, restoranas, atsiėmimo ar pristatymo būdas ir laikas, vardas ir telefonas susisiekimui, pristatymo adresas, pastabos virtuvei ir kurjeriui, užsakymo būsenų istorija.</li>
          <li><b>Vieta:</b> tik paspaudus „Naudoti mano vietą“ ar „Rasti artimiausią“. Artimiausio restorano paieškai vieta naudojama tik jūsų įrenginyje. Užsakant pristatymą, koordinatės siunčiamos mums tik pristatymo zonai patikrinti ir laikui apskaičiuoti. Jų nesaugome.</li>
          <li><b>Mokėjimai:</b> mokant kortele, mokėjimą apdoroja Stripe. Kortelės duomenų mes negauname, matome tik mokėjimo būseną ir sumą.</li>
          <li><b>Lojalumas ir nuostatos:</b> taškų likutis, panaudoti atlygiai, mėgstami patiekalai.</li>
          <li><b>Techniniai duomenys:</b> IP adresas ir užklausų informacija serverio žurnaluose, prisijungimo sesijos identifikatorius.</li>
        </ul>
      </Sec>

      <Sec h="3. Tikslai ir teisiniai pagrindai">
        <ul>
          <li><b>Užsakymų priėmimas, gaminimas, išdavimas ir pristatymas, paskyros ir lojalumo programos teikimas</b> – sutarties vykdymas (BDAR 6 str. 1 d. b p.).</li>
          <li><b>Apskaita ir mokesčiai</b> – teisinė prievolė (6 str. 1 d. c p.).</li>
          <li><b>Saugumas, sukčiavimo ir piktnaudžiavimo prevencija, paslaugos tobulinimas, asmeninės rekomendacijos</b> – teisėtas interesas (6 str. 1 d. f p.).</li>
          <li><b>Vietos nustatymas ir pranešimai</b> – jūsų sutikimas (6 str. 1 d. a p.), kurį duodate naršyklėje ir galite bet kada atšaukti jos nustatymuose.</li>
        </ul>
      </Sec>

      <Sec h="4. Rekomendacijos">
        <p>Patiekalus siūlome pagal jūsų užsakymų istoriją, paros metą ir tai, ką kiti dažnai perka kartu. Tai neturi jums teisinių ar panašaus reikšmingo poveikio pasekmių. Nesutikti su tokiu tvarkymu galite parašę mums.</p>
      </Sec>

      <Sec h="5. Kam perduodame duomenis">
        <ul>
          <li><b>Restoranui ir kurjeriui</b> – tiek, kiek reikia užsakymui įvykdyti.</li>
          <li><b>Talpinimo paslaugos teikėjui</b> {L.hosting} (serveris ir duomenų bazė, regionas: {L.hostingRegion}).</li>
          <li><b>Stripe Payments Europe, Ltd.</b> – kai mokate kortele.</li>
          <li><b>Žemėlapių ir nuotraukų paslaugoms</b> (OpenFreeMap, OpenStreetMap, Unsplash): kai atidarote žemėlapį ar meniu, jūsų naršyklė iš jų atsisiunčia vaizdus, todėl jie mato jūsų IP adresą. Asmens duomenų mes jiems neperduodame.</li>
          <li><b>Google Maps</b> – tik paspaudus „Maršrutas“; tada atidaroma Google svetainė ir jai galioja Google privatumo politika.</li>
          <li><b>Valstybės institucijoms</b> – tik kai to reikalauja įstatymai.</li>
        </ul>
        <p>Jei duomenys perduodami už Europos ekonominės erdvės ribų (pvz. JAV paslaugų teikėjams), tai daroma remiantis Europos Komisijos sprendimu dėl tinkamumo (ES ir JAV duomenų privatumo sistema) arba standartinėmis sutarčių sąlygomis.</p>
      </Sec>

      <Sec h="6. Kaip saugome">
        <ul>
          <li>El. paštas, vardas, telefonas, pristatymo adresas ir pastabos duomenų bazėje laikomi <b>užšifruoti</b> (AES-256-GCM). Šifravimo raktas laikomas atskirai nuo duomenų bazės.</li>
          <li>Slaptažodžiai nesaugomi: saugome tik jų kriptografinę maišą (scrypt), iš kurios slaptažodžio atkurti neįmanoma.</li>
          <li>Visas ryšys šifruojamas (HTTPS). Taikome prisijungimo bandymų ribojimą ir laikiną paskyros užrakinimą po kelių nesėkmingų bandymų.</li>
        </ul>
      </Sec>

      <Sec h="7. Kiek laiko saugome">
        <ul>
          <li><b>Paskyra</b> – kol ją turite. Ištrynus paskyrą, jos duomenys ištrinami iš karto.</li>
          <li><b>Užsakymai ir mokėjimai</b> – 10 metų, kaip reikalauja LR buhalterinės apskaitos įstatymas. Jei paskyra ištrinama, užsakymuose vardas, telefonas, adresas ir pastabos anonimizuojami, lieka tik apskaitai reikalingi duomenys.</li>
          <li><b>Prisijungimo sesija</b> – iki 30 dienų arba kol atsijungiate.</li>
          <li><b>Serverio žurnalai</b> – trumpą laiką, kiek reikia saugumui užtikrinti.</li>
        </ul>
      </Sec>

      <Sec h="8. Slapukai ir naršyklės saugykla">
        <p>Naudojame tik būtinus įrašus, todėl sutikimo jiems nereikia:</p>
        <ul>
          <li><code>__Host-sid</code> – prisijungimo sesijos slapukas (HttpOnly, galioja iki 30 d.).</li>
          <li>Naršyklės saugykloje (localStorage) jūsų įrenginyje: krepšelis, pasirinktas restoranas ir atsiėmimo būdas, paskutinio užsakymo nuoroda. Kad nereikėtų vesti iš naujo, ten saugomi ir užsakymo kontaktai (vardas, telefonas, adresas); atsijungus jie ištrinami.</li>
        </ul>
        <p>Analitikos ir reklamos slapukų nenaudojame.</p>
      </Sec>

      <Sec h="9. Jūsų teisės">
        <p>Turite teisę susipažinti su savo duomenimis, juos ištaisyti, ištrinti, apriboti jų tvarkymą, juos perkelti, nesutikti su tvarkymu teisėto intereso pagrindu ir bet kada atšaukti sutikimą.</p>
        <p>Paskyros puslapyje galite patys <b>atsisiųsti savo duomenis</b> ir <b>ištrinti paskyrą</b>. Kitais atvejais rašykite <a href={`mailto:${L.email}`}>{L.email}</a>, atsakysime per vieną mėnesį.</p>
        <p>Jei manote, kad jūsų duomenys tvarkomi neteisėtai, galite pateikti skundą Valstybinei duomenų apsaugos inspekcijai (L. Sapiegos g. 17, Vilnius, <a href="https://vdai.lrv.lt" target="_blank" rel="noopener noreferrer">vdai.lrv.lt</a>).</p>
      </Sec>

      <Sec h="10. Vaikai">
        <p>Paskyrą gali susikurti asmenys nuo 14 metų. Jaunesni gali užsakyti tik su tėvų ar globėjų leidimu.</p>
      </Sec>

      <Sec h="11. Pakeitimai">
        <p>Pasikeitus duomenų tvarkymui, atnaujinsime šią politiką ir pakeisime atnaujinimo datą. Apie esminius pakeitimus informuosime programėlėje.</p>
      </Sec>
      <p className="small"><Link className="link" to="/terms">Pirkimo–pardavimo taisyklės</Link></p>
    </Doc>
  );
}

export function Terms() {
  const { brand, stores } = useApp();
  const L = brand?.legal || {}; const name = brand?.name || '';
  const minOrder = Math.min(...stores.map((s) => s.minOrder || 0));
  return (
    <Doc title="Pirkimo–pardavimo taisyklės" sub={`${name} · užsakymai programėlėje`}>
      <Sec h="1. Bendrosios nuostatos">
        <p>Šios taisyklės nustato užsakymų {name} programėlėje sąlygas. Pardavėjas – {L.company}, įmonės kodas {L.code}, PVM kodas {L.vat}, {L.address}, <a href={`mailto:${L.email}`}>{L.email}</a>, tel. {L.phone}. Užsakydami ar kurdami paskyrą patvirtinate, kad susipažinote su šiomis taisyklėmis ir <Link className="link" to="/privacy">Privatumo politika</Link>.</p>
      </Sec>
      <Sec h="2. Užsakymas">
        <p>Užsakyti galite su paskyra arba be jos. Užsakymą pateikiate paspaudę „Užsakyti“, o sutartis sudaroma, kai restoranas užsakymą priima (būsena „Patvirtinta“). Iki tol galite užsakymą atšaukti užsakymo puslapyje.{minOrder > 0 ? ` Minimali užsakymo suma – ${(minOrder / 100).toFixed(2).replace('.', ',')} €.` : ''}</p>
        <p>Nurodytas paruošimo ar pristatymo laikas yra apytikslis ir priklauso nuo virtuvės apkrovos. Suplanuotus užsakymus stengiamės paruošti pasirinktu laiku.</p>
      </Sec>
      <Sec h="3. Kainos ir nuolaidos">
        <p>Kainos nurodytos eurais su PVM. Galutinę sumą (su pristatymu, nuolaidomis ir arbatpinigiais) matote prieš pateikdami užsakymą. Patiekalų pasiūlymai galioja nurodytomis dienomis ir valandomis. Nuolaidos kodų ir pasiūlymų negalima keisti į pinigus. Jei sąlygos kodui netaikomos, programėlė apie tai praneša.</p>
      </Sec>
      <Sec h="4. Apmokėjimas">
        <p>Mokėti galite kortele programėlėje (per Stripe) arba atsiimdami užsakymą ar priimdami jį iš kurjerio. Mokant kortele, užsakymas perduodamas virtuvei tik gavus mokėjimo patvirtinimą.</p>
      </Sec>
      <Sec h="5. Atsiėmimas ir pristatymas">
        <p>Atsiimant restorane, užsakymą išduodame pasakius užsakymo kodą. Pristatome nurodytoje zonoje, o pristatymo kaina ir nemokamo pristatymo riba matomos krepšelyje. Jei kurjeris negali jūsų rasti ar su jumis susisiekti, užsakymas gali būti laikomas įvykdytu.</p>
      </Sec>
      <Sec h="6. Atsisakymas ir pretenzijos">
        <p>Maistas yra greitai gendantis produktas, todėl pagal LR civilinio kodekso 6.228<sup>10</sup> straipsnį 14 dienų teisė atsisakyti sutarties netaikoma. Jei užsakymas neatitinka to, ką užsakėte, ar turite pretenzijų dėl kokybės, nedelsdami susisiekite su restoranu arba parašykite <a href={`mailto:${L.email}`}>{L.email}</a>: pakeisime patiekalą arba grąžinsime pinigus. Atšaukus jau apmokėtą užsakymą, pinigai grąžinami tuo pačiu mokėjimo būdu.</p>
      </Sec>
      <Sec h="7. Alergenai">
        <p>Alergenai nurodyti kiekvieno patiekalo aprašyme. Virtuvėje naudojami įvairūs produktai, todėl negalime visiškai atmesti pėdsakų. Jei turite alergiją, parašykite pastabą virtuvei arba paklauskite darbuotojų.</p>
      </Sec>
      <Sec h="8. Lojalumo programa">
        <p>Už įvykdytus užsakymus su paskyra kaupiami {brand?.loyalty?.name || 'taškai'} ({brand?.loyalty?.pointsPerEuro} tšk. už 1 € už maistą, be pristatymo ir arbatpinigių). Taškus galima panaudoti atlygiams, į pinigus jų keisti negalima. Ištrynus paskyrą, taškai panaikinami.</p>
      </Sec>
      <Sec h="9. Ginčų sprendimas">
        <p>Ginčus pirmiausia sprendžiame derybomis. Jei nepavyksta, vartotojas gali kreiptis į Valstybinę vartotojų teisių apsaugos tarnybą (<a href="https://vvtat.lrv.lt" target="_blank" rel="noopener noreferrer">vvtat.lrv.lt</a>) arba į teismą. Taikoma Lietuvos Respublikos teisė.</p>
      </Sec>
      <p className="small"><Link className="link" to="/privacy">Privatumo politika</Link></p>
    </Doc>
  );
}
