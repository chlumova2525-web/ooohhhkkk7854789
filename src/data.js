// Datový model a výpočty nad ním. Žádné React komponenty, žádná síť —
// čistá data dovnitř, čistá data ven.
//
// Skutečný tvar dat je JSON uložený v jediném řádku databáze, ne SQL
// schéma. DEFAULT popisuje ten tvar a všechny částky v něm jsou nulové:
// konkrétní čísla a jména patří do dat, ne do kódu.
//
// migruj2 běží při každém načtení i při obnově ze zálohy. Přebírá
// hodnoty z klíčů pod původními názvy a ty staré pak z dat odstraní.

import {
  cislo, uid, jeProplaceno, hodinyCelkem
} from "./vypocty.js";
export const TEMATA = [
  "Materiál (obecný)",
  "Betony",
  "Střecha",
  "Lepenky",
  "Okna a dveře",
  "Vata / izolace",
  "Extruďáky",
  "Fasáda",
  "Omítky",
  "Sádrokartony",
  "Elektromateriál",
  "Voda a odpady",
  "Topení",
  "Vybavení",
  "Práce",
  "Projekt a povolení",
  "Ostatní",
];

export const DEFAULT = {
  heslo: null,
  hesloDelnik: null,
  nazev: "Stavební deník",
  misto: "",
  cenaDomu: 0,
  provize: 0,
  zdroje: {
    hypoteka: { celkem: 0, koupe: 0, budouci: false },
    uver: { celkem: 0, koupe: 0, budouci: false },
    vlastni: { celkem: 0, koupe: 0, budouci: false },
    dotace: { celkem: 0, koupe: 0, budouci: false },
  },
  // Dva účty na kontrolu zůstatku. Jak se jmenují, patří do dat, ne do kódu —
  // popisA/popisB se vyplňují v Nastavení, prázdné = obecné „Účet 1/2".
  kontrola: { popisA: "", ucetA: "", popisB: "", ucetB: "", datum: "" },
  zakladOdkazu: "doklady/",
  temata: TEMATA,
  planTema: {},
  ukoly: [],
  polozky: [],
  delnik: { jmeno: "Dělník", dluh: 0 },
  sazba: 250,
  pracanti: [
    { id: "p1", jmeno: "První pracant", sazba: 250, aktivni: true },
    { id: "p2", jmeno: "Druhý pracant", sazba: 250, aktivni: false },
    { id: "p3", jmeno: "Třetí pracant", sazba: 250, aktivni: false },
  ],
  cekajici: [],
  zalohy: [],
  nacteneFaktury: [],
  upominky: [],
  nactenePlatby: [],
  zaznamy: [],
  faktury: [],
  uklFotky: true,
};

export const ZDROJ = {
  hypoteka: { label: "Hypotéka", zkratka: "HYP", barva: "#6D9773", tmava: "#3E6B4C", svetla: "#E4EDE5" },
  uver: { label: "Druhý úvěr", zkratka: "ÚVĚR", barva: "#C9AE85", tmava: "#8A6A3C", svetla: "#F1E8D8" },
  vlastni: { label: "Vlastní zdroje", zkratka: "VL", barva: "#B46617", tmava: "#B46617", svetla: "#F7E7D6" },
  dotace: { label: "Dotace", zkratka: "DOT", barva: "#FFBA00", tmava: "#8A6100", svetla: "#FFF2D0" },
};

export const STAV = {
  plan: { label: "Plánováno", znak: "○", barva: "#8FA69A" },
  probiha: { label: "Probíhá", znak: "◑", barva: "#B46617" },
  hotovo: { label: "Hotovo", znak: "●", barva: "#3E6B4C" },
};

export const TYP_Z = {
  prace: { label: "Odpracováno", znak: "P", barva: "#0C3B2E" },
  platba: { label: "Vyplaceno", znak: "V", barva: "#3E6B4C" },
  dluh: { label: "Odbydlen dluh", znak: "D", barva: "#B03A2E" },
};

export const PLAN_HYPOTEKA = [];

export const PLAN_SOUCET = PLAN_HYPOTEKA.reduce((a, r) => a + r[4], 0);

// [období, popis, částka (+ přičteno / − odmazáno), poznámka, chybí vysvětlení]
export const DLUH_SEZNAM = [];

export function dluhZeSeznamu() {
  return DLUH_SEZNAM.map((r) => ({
    id: uid(),
    datum: "",
    obdobi: r[0],
    popis: r[1],
    castka: r[2],
    poznamka: r[3],
    doplnit: r[4],
  }));
}

// Faktury zadané ručně přes chat. Každá má stálé id — díky tomu se dá
// seznam kdykoli doplnit a naimportují se jen ty, které tu ještě nebyly.
// Formát: { id, datum, popis, kategorie (název z rozpočtu), tema, castka,
//           zdroj: hypoteka|uver|vlastni|dotace, pres, dolozeno, proplaceno }
export const FAKTURY_ZADANE = [];

// Platby dělníkovi zadané přes chat. Stálá id, importují se jen nové.
export const PLATBY_ZADANE = [];

export function seedPlatby(jizNactene) {
  return PLATBY_ZADANE.filter((p) => !jizNactene.includes(p.id)).map((p) => ({
    id: p.id,
    datum: p.datum,
    typ: "platba",
    castka: p.castka,
    popis: p.popis,
    ukol: null,
    zdroj: p.zdroj || "hypoteka",
  }));
}

export function seedFaktury(ukoly, jizNactene) {
  return FAKTURY_ZADANE.filter((f) => !jizNactene.includes(f.id)).map((f) => {
    const k = ukoly.find(
      (u) => u.nazev.toLowerCase() === String(f.kategorie || "").toLowerCase()
    );
    return {
      id: f.id,
      datum: f.datum,
      popis: f.popis,
      dodavatel: f.dodavatel || "",
      cisloDokladu: f.cislo || "",
      poznamka: f.poznamka || "",
      odkaz: f.odkaz || "",
      priponaDokladu: f.pripona || "",
      tema: f.tema || "Materiál (obecný)",
      ukol: k ? k.id : null,
      castka: f.castka,
      zdroj: f.zdroj || "hypoteka",
      pres: !!f.pres,
      dolozeno: f.dolozeno !== false,
      proplaceno: f.proplaceno !== false,
      zPlateb: f.zPlateb !== false,
      kRozpadu: !!f.kRozpadu,
    };
  });
}

export function rozpadDluhu(polozky) {
  const pripsano = polozky.filter((d) => d.castka > 0).reduce((a, d) => a + d.castka, 0);
  const odmazano = polozky.filter((d) => d.castka < 0).reduce((a, d) => a - d.castka, 0);
  return { pripsano, odmazano };
}

export const KATEGORIE_NAVIC = [
  ["Pronájem techniky", "Ostatní"],
  ["Drobné nářadí a provoz", "Ostatní"],
  ["projekt a povolení", "Ostatní", 48400],
  ["Spojovací materiál", "Ostatní"],
  ["Čeká na rozpad faktury", "Ostatní"],
];

export function planNaUkoly() {
  const navic = KATEGORIE_NAVIC.map((k) => ({
    id: uid(),
    nazev: k[0],
    skupina: k[1],
    odhad: k[2] || 0,
    stav: "probiha",
    typ: "pridano",
  }));
  return PLAN_HYPOTEKA.map((r) => ({
    id: uid(),
    nazev: r[0],
    mnozstvi: r[1],
    jednotka: r[2],
    jedcena: r[3],
    odhad: r[4],
    skupina: r[5],
    stav: "plan",
    typ: "puvodni",
  })).concat(navic);
}

// Dřív se oba kontrolní účty jmenovaly podle konkrétních lidí. Teď jsou to
// neutrální ucetA/ucetB a jméno je součástí dat — staré klíče se přenesou.
export const KONTROLA_KLICE = ["popisA", "ucetA", "popisB", "ucetB", "datum", "zustatek"];

export function migrujKontrolu(k) {
  if (!k) return { ...DEFAULT.kontrola };
  const m = { ...DEFAULT.kontrola, ...k };
  // Starší verze držely zůstatky pod klíči pojmenovanými po konkrétních lidech.
  // Přenese se jen částka, a to podle pořadí — žádné jméno tak nemusí být
  // vypsané tady v kódu. Popis účtu si uživatel vyplní v Nastavení.
  const stare = Object.keys(k).filter((x) => !KONTROLA_KLICE.includes(x));
  ["ucetA", "ucetB"].forEach((cil, i) => {
    if (stare[i] !== undefined && !m[cil]) m[cil] = k[stare[i]];
  });
  stare.forEach((x) => delete m[x]);
  return m;
}

export function migruj2(o) {
  const stare = o.zdroje || {};
  const meCisla =
    (Number(stare.hypoteka) || 0) +
      (Number(stare.dotace) || 0) +
      (Number(stare.vlastni) || 0) >
    0;
  const zd = {};
  Object.keys(ZDROJ).forEach((k) => {
    if (stare[k] && typeof stare[k] === "object") {
      zd[k] = { ...stare[k] };
    } else if (meCisla) {
      zd[k] = { celkem: Number(stare[k]) || 0, koupe: 0, budouci: false };
    } else {
      zd[k] = { ...DEFAULT.zdroje[k] };
    }
  });
  const maUkoly = o.ukoly && o.ukoly.length > 0;
  const nasadit = !o.planNacten && !maUkoly;

  // Dřív se klíč jmenoval příjmením konkrétního člověka. Data uložená pod
  // starým názvem se převezmou, aby se při přejmenování nic neztratilo.
  const staryDelnik = o.delnik || o.shejba || {};
  const maDluh = staryDelnik.dluhPolozky && staryDelnik.dluhPolozky.length > 0;
  const nasaditDluh = !o.dluhNacten && !maDluh && !staryDelnik.dluh;

  let ukolyFinal = nasadit ? planNaUkoly() : o.ukoly || [];

  // Kategorie, které potřebují zadané faktury, ale v seznamu chybí, se doplní.
  FAKTURY_ZADANE.forEach((f) => {
    if (!f.kategorie) return;
    const je = ukolyFinal.some(
      (u) => u.nazev.toLowerCase() === f.kategorie.toLowerCase()
    );
    if (!je)
      ukolyFinal = [
        ...ukolyFinal,
        {
          id: uid(),
          nazev: f.kategorie,
          skupina: "Ostatní",
          odhad: 0,
          stav: "probiha",
          typ: "pridano",
        },
      ];
  });

  const jizNactene = o.nacteneFaktury || [];
  const noveFaktury = seedFaktury(ukolyFinal, jizNactene);
  const jizPlatby = o.nactenePlatby || [];
  const novePlatby = seedPlatby(jizPlatby);

  const vysledek = {
    ...DEFAULT,
    ...o,
    zdroje: zd,
    ukoly: ukolyFinal,
    polozky: [...(o.polozky || []), ...noveFaktury],
    nacteneFaktury: [...jizNactene, ...FAKTURY_ZADANE.map((f) => f.id)],
    zaznamy: [...(o.zaznamy || []), ...novePlatby],
    nactenePlatby: [...jizPlatby, ...PLATBY_ZADANE.map((p) => p.id)],
    planNacten: true,
    pracanti: (o.pracanti && o.pracanti.length ? o.pracanti : DEFAULT.pracanti).map(
      (p, i) => ({
        ...(DEFAULT.pracanti[i] || {}),
        ...p,
        sazba: Number(p.sazba) || Number(o.sazba) || 250,
        aktivni: p.aktivni !== undefined ? p.aktivni : true,
      })
    ),
    delnik: {
      ...DEFAULT.delnik,
      ...staryDelnik,
      dluhPolozky: nasaditDluh
        ? dluhZeSeznamu()
        : staryDelnik.dluhPolozky || [],
    },
    kontrola: migrujKontrolu(o.kontrola),
    // Totéž pro kód dělníka — přebírá se i z původního názvu klíče.
    hesloDelnik:
      o.hesloDelnik !== undefined && o.hesloDelnik !== null
        ? o.hesloDelnik
        : o.hesloShejba !== undefined
        ? o.hesloShejba
        : null,
    dluhNacten: true,
  };
  // Hodnoty z klíčů pod původními názvy jsou přenesené výš. Samotné klíče
  // se zahodí, aby se jméno nedrželo v datech ani v nových zálohách.
  delete vysledek.shejba;
  delete vysledek.hesloShejba;
  return vysledek;
}

export function migruj(v1) {
  const polozky = (v1.polozky || []).map((p) => ({
    id: p.id || uid(),
    datum: p.datum,
    popis: p.popis,
    tema: TEMATA.includes(p.kategorie) ? p.kategorie : "Materiál (obecný)",
    ukol: null,
    castka: p.castka,
    zdroj: p.zdroj,
    pres: false,
    dolozeno: false,
  }));
  (v1.zaznamy || [])
    .filter((z) => z.typ === "material")
    .forEach((z) =>
      polozky.push({
        id: z.id || uid(),
        datum: z.datum,
        popis: z.popis || "materiál",
        tema: "Materiál (obecný)",
        ukol: null,
        castka: z.castka,
        zdroj: z.zdroj || "hypoteka",
        pres: true,
        dolozeno: false,
      })
    );
  return {
    ...DEFAULT,
    heslo: v1.heslo,
    nazev: v1.nazev || DEFAULT.nazev,
    zdroje: v1.zdroje || DEFAULT.zdroje,
    polozky,
    delnik: { jmeno: DEFAULT.delnik.jmeno, dluh: (v1.delnik && v1.delnik.dluh) || 0 },
    zaznamy: (v1.zaznamy || []).filter((z) => z.typ !== "material"),
  };
}

export function spocitej(data) {
  const { zdroje, polozky, zaznamy, delnik, ukoly } = data;

  const dostupne = {};
  let celkem = 0;
  let koupeCelkem = 0;
  Object.keys(ZDROJ).forEach((k) => {
    const z = zdroje[k] || { celkem: 0, koupe: 0 };
    dostupne[k] = (z.celkem || 0) - (z.koupe || 0);
    celkem += dostupne[k];
    koupeCelkem += z.koupe || 0;
  });

  const zalohy = data.zalohy || [];
  const zalohaCeka = (z) => !polozky.some((p) => p.zalohaId === z.id);
  const zalohyCeka = zalohy.filter(zalohaCeka);
  const zalohyCekaCelkem = zalohyCeka.reduce((a, z) => a + z.castka, 0);

  const hotovost = [
    ...polozky
      .filter((p) => jeProplaceno(p) && !p.zalohaId && !p.zPlateb)
      .map((p) => ({ zdroj: p.zdroj, castka: p.castka })),
    ...zalohy.map((z) => ({ zdroj: z.zdroj, castka: z.castka })),
    ...zaznamy
      .filter((z) => z.typ === "platba")
      .map((z) => ({ zdroj: z.zdroj, castka: z.castka })),
  ];
  const cerpano = {};
  Object.keys(ZDROJ).forEach((k) => (cerpano[k] = 0));
  hotovost.forEach((h) => {
    if (cerpano[h.zdroj] !== undefined) cerpano[h.zdroj] += h.castka;
  });
  const utraceno = Object.values(cerpano).reduce((a, b) => a + b, 0);

  let naUctu = 0;
  let prijde = 0;
  Object.keys(ZDROJ).forEach((k) => {
    const zbytek = dostupne[k] - cerpano[k];
    if (zdroje[k] && zdroje[k].budouci) prijde += zbytek;
    else naUctu += zbytek;
  });

  const sz = (t) =>
    zaznamy.filter((z) => z.typ === t).reduce((a, z) => a + z.castka, 0);
  const odpracovano = sz("prace");
  const vyplaceno = sz("platba");
  const odbydleno = sz("dluh");
  const presNej = polozky.filter((p) => p.pres);
  const zPlatebSuma = presNej
    .filter((p) => p.zPlateb)
    .reduce((a, p) => a + p.castka, 0);
  const neproplaceneFa = presNej.filter((p) => p.proplaceno === false);
  const neproplacenoFa = neproplaceneFa.reduce((a, p) => a + p.castka, 0);
  const materialPresNej = presNej.reduce((a, p) => a + p.castka, 0);
  const nedolozeno = presNej
    .filter((p) => !p.dolozeno)
    .reduce((a, p) => a + p.castka, 0);
  const zbyvaVyplatit = odpracovano - (vyplaceno - zPlatebSuma) - odbydleno;
  const dluhSeznam =
    delnik.dluhPolozky && delnik.dluhPolozky.length
      ? delnik.dluhPolozky
      : delnik.dluh
      ? [{ id: "puv", datum: "", popis: "Původní dluh", castka: delnik.dluh }]
      : [];
  const zbyvaDluh =
    dluhSeznam.reduce((a, d) => a + (d.castka || 0), 0) - odbydleno;
  const dluhRozpad = rozpadDluhu(dluhSeznam);

  const skutTema = {};
  polozky.forEach((p) => {
    skutTema[p.tema] = (skutTema[p.tema] || 0) + p.castka;
  });
  if (vyplaceno) skutTema["Práce"] = (skutTema["Práce"] || 0) + vyplaceno;

  const skutUkol = {};
  polozky.forEach((p) => {
    if (p.ukol) skutUkol[p.ukol] = (skutUkol[p.ukol] || 0) + p.castka;
  });
  zaznamy
    .filter((z) => z.typ === "platba" && z.ukol)
    .forEach((z) => {
      skutUkol[z.ukol] = (skutUkol[z.ukol] || 0) + z.castka;
    });
  const hotovoHodnota = ukoly
    .filter((u) => u.stav === "hotovo")
    .reduce((a, u) => a + (u.odhad || 0), 0);
  const bezUkolu = polozky
    .filter((p) => !p.ukol)
    .reduce((a, p) => a + p.castka, 0);

  const odhadPuvodni = ukoly
    .filter((u) => u.typ === "puvodni")
    .reduce((a, u) => a + (u.odhad || 0), 0);
  const odhadPridany = ukoly
    .filter((u) => u.typ === "pridano")
    .reduce((a, u) => a + (u.odhad || 0), 0);

  return {
    celkem,
    dostupne,
    koupeCelkem,
    naUctu,
    prijde,
    cerpano,
    utraceno,
    zbyva: celkem - utraceno,
    volne: celkem - utraceno - Math.max(zbyvaVyplatit, 0) - neproplacenoFa,
    odpracovano,
    vyplaceno,
    odbydleno,
    materialPresNej,
    nedolozeno,
    zbyvaVyplatit,
    zbyvaDluh,
    skutTema,
    skutUkol,
    bezUkolu,
    odhadPuvodni,
    odhadPridany,
    hotovoHodnota,
    neproplacenoFa,
    zalohyCeka,
    zalohyCekaCelkem,
  };
}

export function spocitejDelnika(data) {
  const sazba = data.sazba || 250;
  const zaznamy = data.zaznamy || [];
  const prace = zaznamy.filter((z) => z.typ === "prace");
  const platby = zaznamy
    .filter((z) => z.typ === "platba")
    .sort((a, b) => (a.datum < b.datum ? 1 : -1));
  const odbydlene = zaznamy
    .filter((z) => z.typ === "dluh")
    .sort((a, b) => (a.datum < b.datum ? 1 : -1));

  const odpracovano = prace.reduce((a, z) => a + z.castka, 0);
  const vyplaceno = platby.reduce((a, z) => a + z.castka, 0);
  const odbydleno = odbydlene.reduce((a, z) => a + z.castka, 0);

  // Část poslaných peněz, kterou dělník utratil za materiál pro stavbu,
  // není jeho odměna — dokládá ji fakturou, takže se od plateb odečítá.
  const dolozenoFakturami = (data.polozky || [])
    .filter((p) => p.pres && p.zPlateb)
    .reduce((a, p) => a + p.castka, 0);
  const vyplacenoNaPraci = vyplaceno - dolozenoFakturami;
  const zbyvaVyplatit = odpracovano - vyplacenoNaPraci - odbydleno;

  const ulozene = (data.delnik && data.delnik.dluhPolozky) || [];
  const dluhPolozky =
    ulozene.length > 0
      ? ulozene
      : data.delnik && data.delnik.dluh
      ? [{ id: "puv", datum: "", popis: "Původní dluh", castka: data.delnik.dluh }]
      : [];
  const { pripsano: dluhPripsano, odmazano: dluhOdmazano } = rozpadDluhu(dluhPolozky);
  const dluhCelkem = dluhPripsano;
  const zbyvaDluh = dluhPripsano - dluhOdmazano - odbydleno;

  const hodinRadku = (z) =>
    z.hodiny ? hodinyCelkem(z.hodiny) : sazba ? z.castka / sazba : 0;

  const mesice = {};
  prace.forEach((z) => {
    const m = (z.datum || "").slice(0, 7);
    if (!m) return;
    mesice[m] = (mesice[m] || 0) + hodinRadku(z);
  });
  const mesicniRada = Object.entries(mesice).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  const tentoMesic = new Date().toISOString().slice(0, 7);
  const hodinyMesic = mesice[tentoMesic] || 0;

  const hodinyCelkove = prace.reduce((a, z) => a + hodinRadku(z), 0);
  const mojeHodiny = prace.reduce(
    (a, z) => a + (Number((z.hodiny || {}).p1) || 0),
    0
  );

  const material = (data.polozky || [])
    .filter((p) => p.pres)
    .sort((a, b) => (a.datum < b.datum ? 1 : -1));
  const materialCelkem = material.reduce((a, p) => a + p.castka, 0);
  const zalohyCeka = (data.zalohy || []).filter(
    (z) => !(data.polozky || []).some((p) => p.zalohaId === z.id)
  );
  const zalohyCekaCelkem = zalohyCeka.reduce((a, z) => a + z.castka, 0);
  // Čím jsou poslané peníze podložené: odpracovanou prací a materiálem, který
  // z nich nakoupil a doložil fakturou. Co zbyde, po něm chceme doložit —
  // a dokud to nedoloží, je to dlužná částka.
  const podlozeno = odpracovano + dolozenoFakturami;
  const nedolozeno = vyplaceno - podlozeno;
  // Původní název, drží se kvůli místům, která s ním už počítají.
  const nevysvetleno = nedolozeno;
  const neproplacene = material.filter((p) => p.proplaceno === false);
  const neproplacenoCelkem = neproplacene.reduce((a, p) => a + p.castka, 0);
  const kVyplate = zbyvaVyplatit + neproplacenoCelkem;

  return {
    sazba, prace, platby, odbydlene, odpracovano, vyplaceno, odbydleno,
    zbyvaVyplatit, vyplacenoNaPraci, dluhPolozky, dluhCelkem, dluhPripsano, dluhOdmazano, zbyvaDluh, mesicniRada,
    hodinyMesic, tentoMesic, hodinyCelkove, mojeHodiny, material, materialCelkem,
    neproplacene, neproplacenoCelkem, kVyplate, zalohyCeka, zalohyCekaCelkem,
    dolozenoFakturami, nevysvetleno, podlozeno, nedolozeno,
  };
}
