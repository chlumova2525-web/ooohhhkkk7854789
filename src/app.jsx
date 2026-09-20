import { useState, useEffect, useRef } from "react";
import { DUM_OBRAZEK } from "./obrazek-dum.js";

// ── Zámek na vstupu ──────────────────────────────────────────────
// true  = při otevření se ptá na heslo (ostrý provoz)
// false = appka se otevře rovnou (vývoj)
// Kdybyste se zamkli ven, přepněte zpátky na false.
const HESLO_ZAPNUTO = false;

// ── Úložiště ────────────────────────────────────────────────────
// Aplikace umí běžet ve třech režimech a sama pozná, který platí:
//   1. uvnitř Claude        → sdílené úložiště artefaktu
//   2. vlastní web + Supabase → sdílené mezi všemi (vyplň dva údaje níž)
//   3. vlastní web bez ničeho → jen tento prohlížeč, data se nesdílí
// Připojení k databázi se nastavuje v souboru config.js vedle aplikace,
// ne tady — aby přežilo zmenšení souboru při sestavení.
// Doklady, které opravdu leží ve složce na webu. Odkaz „otevřít originál"
// se nabídne jen u nich — jinak by vedl na neexistující stránku.
// Soubory ve složce na webu. Klíčem je číslo dokladu, hodnotou název souboru
// ve tvaru téma_dodavatel_číslo_datum_částka. Odkaz „otevřít originál" se
// nabídne jen u dokladů, které tu jsou.
const DOKLADY_NA_WEBU = {};



// Když je vyplněná databáze, používá se i uvnitř Claude — aby artefakt
// i web pracovaly nad stejnými daty.
const VESTAVENA_DB = { url: "", klic: "" };


// ── Přihlášení k databázi ───────────────────────────────────────
// Token drží prohlížeč, ne databáze. Platí hodinu a sám se obnovuje.
const RELACE_KLIC = "sd:relace";
let RELACE = null;
try {
  RELACE = JSON.parse(localStorage.getItem(RELACE_KLIC) || "null");
} catch (e) {}

function dbAdresa() {
  const nast = (typeof window !== "undefined" && window.NASTAVENI) || {};
  return {
    url: (nast.supabaseUrl || "").replace(/\/$/, ""),
    klic: nast.supabaseKlic || "",
  };
}

function ulozRelaci(d, email) {
  RELACE = {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    platiDo: Date.now() + (d.expires_in || 3600) * 1000,
    email: email || (d.user && d.user.email) || (RELACE && RELACE.email) || "",
  };
  try {
    localStorage.setItem(RELACE_KLIC, JSON.stringify(RELACE));
  } catch (e) {}
}

function zrusRelaci() {
  RELACE = null;
  try {
    localStorage.removeItem(RELACE_KLIC);
  } catch (e) {}
}

// Supabase vrací pod stavem 400 spoustu různých důvodů. Házet na všechny
// „heslo nesedí" je zavádějící — hlavně u nepotvrzeného účtu, kdy je heslo
// správně a uživatel marně zkouší jiná.
const DUVODY_PRIHLASENI = {
  invalid_credentials: "E-mail nebo heslo nesedí.",
  email_not_confirmed:
    "Účet zatím není potvrzený. Otevři odkaz v e-mailu, který přišel po jeho založení.",
  user_banned: "Tenhle účet je zablokovaný.",
  over_request_rate_limit: "Moc pokusů za sebou. Zkus to prosím za chvíli.",
  over_email_send_rate_limit: "Moc e-mailů za sebou. Zkus to prosím za chvíli.",
  validation_failed: "Vyplň prosím e-mail i heslo.",
};

// Když fetch vůbec neodejde, prohlížeč řekne jen „Failed to fetch". Příčina
// bývá mimo aplikaci — DNS, blokace, výpadek — a bez nápovědy se to hledá těžko.
function jeSitovaChyba(e) {
  return e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(e && e.message));
}

function popisSitoveChyby() {
  const { url } = dbAdresa();
  const host = url.replace(/^https?:\/\//, "") || "databázi";
  return (
    "Nepodařilo se spojit s databází (" + host + "). " +
    "Požadavek vůbec neodešel, takže to není heslem. Bývá to síť, DNS nebo " +
    "blokující rozšíření prohlížeče — zkus jinou síť nebo anonymní okno."
  );
}

async function prihlasSe(email, heslo) {
  const { url, klic } = dbAdresa();
  let r;
  try {
    r = await fetch(url + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: klic, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password: heslo }),
    });
  } catch (e) {
    if (jeSitovaChyba(e)) throw new Error(popisSitoveChyby());
    throw e;
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const kod = (d && (d.error_code || d.error)) || "";
    if (DUVODY_PRIHLASENI[kod]) throw new Error(DUVODY_PRIHLASENI[kod]);
    const zprava = (d && (d.error_description || d.msg || d.message)) || "";
    if (/invalid login/i.test(zprava)) throw new Error(DUVODY_PRIHLASENI.invalid_credentials);
    if (/not confirmed/i.test(zprava)) throw new Error(DUVODY_PRIHLASENI.email_not_confirmed);
    throw new Error("Přihlášení se nepovedlo (" + r.status + "). " + (zprava || ""));
  }
  ulozRelaci(d, email.trim());
  return RELACE;
}

// Změna hesla přihlášeného uživatele.
async function zmenHeslo(nove) {
  const { url, klic } = dbAdresa();
  const token = await platnyToken();
  if (!token) throw new Error("Nejsi přihlášená.");
  const r = await fetch(url + "/auth/v1/user", {
    method: "PUT",
    headers: {
      apikey: klic,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: nove }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      (d && (d.msg || d.error_description || d.message)) || "Heslo se nepodařilo změnit."
    );
  return true;
}

// Odeslání odkazu na obnovu zapomenutého hesla.
async function posliObnovu(email) {
  const { url, klic } = dbAdresa();
  const kam = window.location.origin + window.location.pathname;
  const r = await fetch(url + "/auth/v1/recover", {
    method: "POST",
    headers: { apikey: klic, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), redirect_to: kam }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(
      (d && (d.msg || d.error_description)) ||
        "Odkaz se nepodařilo odeslat. Zkus to za chvíli, nebo heslo změň přímo v Supabase."
    );
  }
  return true;
}

// Návrat z e-mailu s odkazem na obnovu — token přijde v adrese za mřížkou.
function zachytObnovu() {
  try {
    const h = window.location.hash || "";
    if (!h.includes("access_token")) return false;
    const p = new URLSearchParams(h.slice(1));
    if (p.get("type") !== "recovery") return false;
    ulozRelaci({
      access_token: p.get("access_token"),
      refresh_token: p.get("refresh_token"),
      expires_in: Number(p.get("expires_in")) || 3600,
    });
    history.replaceState(null, "", window.location.pathname);
    return true;
  } catch (e) {
    return false;
  }
}

// Vrací token, nebo null když databáze relaci odmítla — to je tvrdé
// odhlášení. Výpadek sítě je něco jiného: relace může být pořád platná,
// jen se na ni teď nedá zeptat. Proto se síťová chyba vyhodí ven a volající
// ji odliší od odhlášení.
async function obnovToken() {
  if (!RELACE || !RELACE.refresh_token) return null;
  const { url, klic } = dbAdresa();
  let r;
  try {
    r = await fetch(url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: klic, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: RELACE.refresh_token }),
    });
  } catch (e) {
    if (jeSitovaChyba(e)) throw new Error(popisSitoveChyby());
    throw e;
  }
  if (!r.ok) {
    zrusRelaci();
    return null;
  }
  ulozRelaci(await r.json());
  return RELACE.access_token;
}

async function platnyToken() {
  if (!RELACE) return null;
  if (RELACE.platiDo - 60000 < Date.now()) return await obnovToken();
  return RELACE.access_token;
}

const ULOZISTE = (() => {
  const nast = (typeof window !== "undefined" && window.NASTAVENI) || {};
  const SUPABASE_URL = nast.supabaseUrl || VESTAVENA_DB.url || "";
  const SUPABASE_KLIC = nast.supabaseKlic || VESTAVENA_DB.klic || "";

  if (!SUPABASE_URL && typeof window !== "undefined" && window.storage) {
    return { ...window.storage, rezim: "claude" };
  }

  if (SUPABASE_URL && SUPABASE_KLIC) {
    const zaklad = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/denik";
    // Bez tokenu se dotaz neposílá vůbec. Dřív se místo něj podstrčil
    // veřejný klíč — jenže RLS pouští jen přihlášené a PostgREST na
    // zamítnuté čtení neodpoví chybou, ale prázdným seznamem se stavem 200.
    // Aplikace to brala jako „v databázi nic není" a otevřela prázdný deník.
    const hlavicky = async () => {
      const token = await platnyToken();
      if (!token) throw new Error("Nejsi přihlášená — přihlas se prosím znovu.");
      return {
        apikey: SUPABASE_KLIC,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      };
    };
    const popisChyby = async (r, co) => {
      if (r.status === 401 || r.status === 403)
        return new Error("Nejsi přihlášená — přihlas se prosím znovu.");
      let d = "";
      try {
        d = (await r.text()).slice(0, 200);
      } catch (e) {}
      return new Error(`${co} selhalo (${r.status}) ${d}`);
    };
    return {
      rezim: "supabase",
      async get(klic) {
        const hlav = await hlavicky();
        let r;
        try {
          r = await fetch(
            `${zaklad}?klic=eq.${encodeURIComponent(klic)}&select=hodnota`,
            { headers: hlav }
          );
        } catch (e) {
          throw jeSitovaChyba(e) ? new Error(popisSitoveChyby()) : e;
        }
        if (!r.ok) throw await popisChyby(r, "Čtení z databáze");
        const d = await r.json();
        return d.length ? { key: klic, value: d[0].hodnota } : null;
      },
      async set(klic, hodnota) {
        const hlav = await hlavicky();
        let r;
        try {
          r = await fetch(zaklad, {
            method: "POST",
            headers: { ...hlav, Prefer: "resolution=merge-duplicates" },
            body: JSON.stringify({ klic, hodnota }),
          });
        } catch (e) {
          throw jeSitovaChyba(e) ? new Error(popisSitoveChyby()) : e;
        }
        if (!r.ok) throw await popisChyby(r, "Zápis do databáze");
        return { key: klic, value: hodnota };
      },
      async delete(klic) {
        await fetch(`${zaklad}?klic=eq.${encodeURIComponent(klic)}`, {
          method: "DELETE",
          headers: await hlavicky(),
        });
        return { key: klic, deleted: true };
      },
    };
  }

  if (typeof window !== "undefined" && window.storage) {
    return { ...window.storage, rezim: "claude" };
  }

  return {
    rezim: "prohlizec",
    async get(klic) {
      const v = localStorage.getItem("sd:" + klic);
      return v === null ? null : { key: klic, value: v };
    },
    async set(klic, hodnota) {
      localStorage.setItem("sd:" + klic, hodnota);
      return { key: klic, value: hodnota };
    },
    async delete(klic) {
      localStorage.removeItem("sd:" + klic);
      return { key: klic, deleted: true };
    },
  };
})();


const KEY = "rekonstrukce-v3";
const SESSION_KLIC = "sd:prihlasenido";

// Přihlášení se pamatuje jen v tomhle prohlížeči, ne v databázi —
// jinak by přihlášení na mobilu odemklo appku i ostatním.
function ulozPrihlaseni(rezim) {
  try {
    localStorage.setItem(
      SESSION_KLIC,
      JSON.stringify({ rezim, platiDo: Date.now() + 30 * 24 * 3600 * 1000 })
    );
  } catch (e) {}
}
function nactiPrihlaseni() {
  try {
    const r = JSON.parse(localStorage.getItem(SESSION_KLIC) || "null");
    if (r && r.platiDo > Date.now()) return r.rezim;
  } catch (e) {}
  return null;
}
function zapomenPrihlaseni() {
  try {
    localStorage.removeItem(SESSION_KLIC);
  } catch (e) {}
}
const KEY_V2 = "rekonstrukce-v2";
const KEY_STARY = "rekonstrukce-v1";

const TEMATA = [
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

const DEFAULT = {
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

const ZDROJ = {
  hypoteka: { label: "Hypotéka", zkratka: "HYP", barva: "#6D9773", tmava: "#3E6B4C", svetla: "#E4EDE5" },
  uver: { label: "Druhý úvěr", zkratka: "ÚVĚR", barva: "#C9AE85", tmava: "#8A6A3C", svetla: "#F1E8D8" },
  vlastni: { label: "Vlastní zdroje", zkratka: "VL", barva: "#B46617", tmava: "#B46617", svetla: "#F7E7D6" },
  dotace: { label: "Dotace", zkratka: "DOT", barva: "#FFBA00", tmava: "#8A6100", svetla: "#FFF2D0" },
};

const STAV = {
  plan: { label: "Plánováno", znak: "○", barva: "#8FA69A" },
  probiha: { label: "Probíhá", znak: "◑", barva: "#B46617" },
  hotovo: { label: "Hotovo", znak: "●", barva: "#3E6B4C" },
};

const TYP_Z = {
  prace: { label: "Odpracováno", znak: "P", barva: "#0C3B2E" },
  platba: { label: "Vyplaceno", znak: "V", barva: "#3E6B4C" },
  dluh: { label: "Odbydlen dluh", znak: "D", barva: "#B03A2E" },
};

const kc = (n) =>
  new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(
    Math.round(n || 0)
  ) + " Kč";
const kcKratce = (n) =>
  new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(
    Math.round(n || 0)
  );
const dnes = () => new Date().toISOString().slice(0, 10);
const datumCz = (d) => {
  if (!d) return "";
  const [r, m, den] = d.split("-");
  return `${Number(den)}.${Number(m)}.${r.slice(2)}`;
};
const cislo = (v) => parseFloat(String(v).replace(/\s/g, "").replace(",", ".")) || 0;
const uid = () => Math.random().toString(36).slice(2, 9);

// Faktura přes dělníka se počítá jako čerpání až ve chvíli proplacení.
const jeProplaceno = (p) => !p.pres || p.proplaceno !== false;

function sazbaPracanta(data, id) {
  const p = (data.pracanti || []).find((x) => x.id === id);
  return Number(p && p.sazba) || Number(data.sazba) || 250;
}

function castkaZaHodiny(data, hodiny) {
  return Object.entries(hodiny || {}).reduce(
    (a, [pid, h]) => a + (Number(h) || 0) * sazbaPracanta(data, pid),
    0
  );
}

const PLAN_HYPOTEKA = [];


const PLAN_SOUCET = PLAN_HYPOTEKA.reduce((a, r) => a + r[4], 0);

// [období, popis, částka (+ přičteno / − odmazáno), poznámka, chybí vysvětlení]
const DLUH_SEZNAM = [];


function dluhZeSeznamu() {
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
const FAKTURY_ZADANE = [];


// Platby dělníkovi zadané přes chat. Stálá id, importují se jen nové.
const PLATBY_ZADANE = [];


function seedPlatby(jizNactene) {
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

function seedFaktury(ukoly, jizNactene) {
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

function rozpadDluhu(polozky) {
  const pripsano = polozky.filter((d) => d.castka > 0).reduce((a, d) => a + d.castka, 0);
  const odmazano = polozky.filter((d) => d.castka < 0).reduce((a, d) => a - d.castka, 0);
  return { pripsano, odmazano };
}

const SKUPINY = [
  "Bourání a likvidace",
  "Střecha, krov a podkroví",
  "Zateplení",
  "Podlahy",
  "Rozvody",
  "Odpady a voda",
  "Okna a dveře",
  "Vnitřní úpravy",
  "Vybavení",
  "Ostatní",
];

const SKUPINA_BARVY = {
  "Bourání a likvidace": "#C2452F",
  "Střecha, krov a podkroví": "#B4562A",
  "Zateplení": "#E8A317",
  "Podlahy": "#A67C52",
  "Rozvody": "#2E7D8F",
  "Odpady a voda": "#4A9FBF",
  "Okna a dveře": "#2F6B4F",
  "Vnitřní úpravy": "#7FA86B",
  "Vybavení": "#B5638F",
  "Ostatní": "#7A8C85",
};

const SKUPINA_PODLE_NAZVU = PLAN_HYPOTEKA.reduce((o, r) => {
  o[r[0].toLowerCase()] = r[5];
  return o;
}, {});

function skupinaUkolu(u) {
  return u.skupina || SKUPINA_PODLE_NAZVU[(u.nazev || "").toLowerCase()] || "Ostatní";
}

const KATEGORIE_NAVIC = [
  ["Pronájem techniky", "Ostatní"],
  ["Drobné nářadí a provoz", "Ostatní"],
  ["projekt a povolení", "Ostatní", 48400],
  ["Spojovací materiál", "Ostatní"],
  ["Čeká na rozpad faktury", "Ostatní"],
];

function planNaUkoly() {
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


const CSS = `
.sd{
  --krem:#F4EEE1; --krem2:#E9DFC9; --bila:#FFFFFF;
  --les:#0C3B2E; --les2:#14503D; --lesDum:#0C3C30; --salvej:#6D9773; --salvej2:#8FB396;
  --piskovec:#C9AE85; --piskovec2:#E6D9C0; --piskovec3:#A8906A;
  --okr:#B46617; --zluta:#FFBA00;
  --text:#132C22; --text2:#5E7268; --linka:#E0D5BF; --cerven:#B03A2E;
  background:var(--krem);
  color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  font-size:14px; line-height:1.5; min-height:100vh; padding-bottom:80px;
}
.sd *{box-sizing:border-box;}
.n{font-variant-numeric:tabular-nums;letter-spacing:-.02em;}
.wrap{max-width:1020px;margin:0 auto;padding:0 16px;}
.eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--text2);font-weight:800;}

.hlava{padding:24px 0 2px;}
.znacka{display:flex;align-items:center;gap:14px;}
.znacka .mark{flex-shrink:0;width:46px;height:46px;background:var(--bila);border:1.5px solid var(--piskovec);border-radius:12px;display:flex;align-items:center;justify-content:center;}
.nazev{font-size:29px;font-weight:800;letter-spacing:-.03em;margin:1px 0 0;line-height:1.05;color:var(--les);}

/* ---- hrdinská karta: zelené okno v pískovcovém ostění ---- */
.hero{background:var(--les);color:#EFF5F0;border-radius:18px;padding:22px;margin-top:18px;position:relative;overflow:hidden;border:5px solid var(--piskovec2);outline:1.5px solid var(--piskovec);outline-offset:-6.5px;}
.hero::after{content:"";position:absolute;right:-80px;top:-80px;width:230px;height:230px;border-radius:50%;background:rgba(109,151,115,.16);}
.heroin{position:relative;display:flex;gap:20px;align-items:center;flex-wrap:wrap;}
.herotext{flex:1;min-width:190px;}
.herotext .eyebrow{color:var(--salvej2);}
.heroc{font-size:37px;font-weight:800;letter-spacing:-.035em;line-height:1.05;margin-top:4px;color:#fff;}
.heropod{font-size:13px;color:var(--salvej2);margin-top:5px;}
.prsten{flex-shrink:0;width:112px;height:112px;}
.dumblok{flex-shrink:0;text-align:center;}
.dumblok svg{display:block;width:246px;height:auto;}
.dumblok figcaption{font-size:11px;color:var(--salvej2);margin-top:6px;font-weight:700;letter-spacing:.04em;}
@media (max-width:900px){.dumblok{display:none;}}

.lat{margin-top:20px;position:relative;}
.latbar{display:flex;height:12px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.14);}
.latseg{position:relative;flex-basis:0;overflow:hidden;border-right:2px solid var(--les);}
.latseg:last-child{border-right:none;}
.latbg{position:absolute;inset:0;opacity:.28;}
.latfill{position:absolute;left:0;top:0;bottom:0;transition:width .6s cubic-bezier(.2,.8,.2,1);}
.latpopis{display:flex;margin-top:11px;gap:4px;flex-wrap:wrap;}
.latitem{flex-basis:0;min-width:96px;padding-right:10px;}
.latitem .tec{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;}
.latitem .lbl{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:var(--salvej2);}
.latitem b{display:block;font-size:15px;font-weight:800;color:#fff;margin-top:2px;}
.latitem span.z{font-size:11.5px;color:var(--salvej2);}

/* ---- dlaždice: bílá stěna, pískovcový sokl ---- */
.dlazdice{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin-top:14px;}
.dl{background:var(--bila);border-radius:14px;padding:15px;border:1px solid var(--linka);border-bottom:4px solid var(--piskovec2);}
.dl .ikonka{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:11px;}
.dl small{display:block;font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--text2);font-weight:800;}
.dl b{display:block;font-size:23px;font-weight:800;letter-spacing:-.03em;margin-top:3px;}
.dl em{font-style:normal;font-size:11.5px;color:var(--text2);display:block;margin-top:3px;}

.dvojka{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:14px;}

.box{background:var(--bila);border:1px solid var(--linka);border-radius:14px;padding:18px;margin-top:14px;}
.boxh{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;margin:0 0 14px;display:flex;justify-content:space-between;gap:12px;align-items:center;color:var(--les);}
.boxh span{letter-spacing:0;text-transform:none;font-size:12px;color:var(--text2);font-weight:600;}
.boxh .hi{display:flex;align-items:center;gap:9px;letter-spacing:.14em;text-transform:uppercase;font-size:11px;color:var(--les);font-weight:800;}
.boxh .hi i{width:28px;height:28px;border-radius:8px;background:var(--piskovec2);display:flex;align-items:center;justify-content:center;flex-shrink:0;}

.karty{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:12px;}
.karta{background:var(--bila);border:1px solid var(--linka);border-bottom:4px solid var(--piskovec2);border-radius:14px;padding:14px 15px 15px;}
.karta small{display:block;font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--text2);font-weight:800;margin-bottom:5px;}
.karta b{font-size:21px;font-weight:800;letter-spacing:-.03em;display:block;}
.karta em{font-style:normal;font-size:11.5px;color:var(--text2);display:block;margin-top:3px;}

table.t{width:100%;border-collapse:collapse;font-size:13.5px;}
table.t th{text-align:left;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);font-weight:800;padding:0 8px 8px 0;border-bottom:1.5px solid var(--piskovec2);}
table.t td{padding:9px 8px 9px 0;border-bottom:1px solid var(--linka);vertical-align:middle;}
table.t tr:last-child td{border-bottom:none;}
.r{text-align:right;}
.nowrap{white-space:nowrap;}

.stitek{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:3px 7px;border-radius:6px;white-space:nowrap;}
.znak{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;font-size:11px;font-weight:800;border-radius:7px;}

.tabs{display:flex;gap:6px;margin:20px 0 16px;overflow-x:auto;padding-bottom:2px;}
.tab{display:inline-flex;align-items:center;gap:7px;background:var(--krem2);border:none;border-radius:9px;padding:9px 14px;font:inherit;font-size:13px;font-weight:700;color:var(--text2);cursor:pointer;white-space:nowrap;}
.tabpopis{font-size:12.5px;color:var(--text2);margin:14px 0 4px;line-height:1.4;text-align:center;}

@media (max-width:560px){
  .pozor{padding:10px 12px;gap:9px;margin:12px -16px 0;border-radius:0;}
  .pozorik{width:28px;height:28px;border-radius:8px;}
  .pozortext{font-size:12.5px;}
  .pozorbtn{padding:8px 12px;font-size:11.5px;}
  .wrap{padding:0 14px;}
}

.zalozkyBlok{display:flex;align-items:center;gap:4px;margin-top:18px;}
.zalSip{flex-shrink:0;width:26px;height:56px;background:none;border:none;color:var(--piskovec);font-size:24px;font-weight:400;cursor:pointer;line-height:1;padding:0;}
.zalSip:hover{color:var(--les);}
.zalPas{display:flex;gap:9px;overflow-x:auto;padding:3px 2px;scrollbar-width:none;-ms-overflow-style:none;scroll-snap-type:x proximity;}
.zalPas::-webkit-scrollbar{display:none;}
.zalKarta{flex:0 0 auto;min-width:92px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;background:var(--bila);border:1px solid var(--linka);border-radius:17px;padding:13px 15px;font:inherit;font-size:12.5px;font-weight:700;color:var(--text2);cursor:pointer;scroll-snap-align:center;transition:background .15s,color .15s,border-color .15s;}
.zalKarta:hover{border-color:var(--salvej);color:var(--les);}
.zalKarta[data-a="1"]{background:var(--les);border-color:var(--les);color:#fff;box-shadow:0 4px 14px rgba(12,59,46,.22);}
.zalKarta[data-poz="1"]{background:var(--zluta);border-color:var(--zluta);color:var(--les);}
.zalKarta[data-poz="1"][data-a="1"]{background:var(--les);border-color:var(--les);color:var(--zluta);}
.zalTecky{display:flex;justify-content:center;gap:7px;margin-top:11px;}
.zalTecky i{display:block;width:16px;height:4px;border-radius:99px;background:var(--piskovec2);transition:width .25s,background .25s;}
.zalTecky i[data-a="1"]{width:34px;background:var(--les);}
@media (max-width:460px){
  .zalKarta{min-width:78px;padding:11px 12px;font-size:11.5px;}
  .zalSip{width:20px;}
}
.podtabs{display:flex;gap:4px;margin-top:14px;border-bottom:1.5px solid var(--linka);overflow-x:auto;}
.podtab{background:none;border:none;border-bottom:3px solid transparent;padding:9px 14px;font:inherit;font-size:13px;font-weight:700;color:var(--text2);cursor:pointer;white-space:nowrap;margin-bottom:-1.5px;}
.podtab:hover{color:var(--les);}
.podtab[data-a="1"]{color:var(--les);border-bottom-color:var(--zluta);}
.tab:hover{background:var(--piskovec2);color:var(--les);}
.tab[data-a="1"]{background:var(--les);color:var(--krem);}

.form{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:11px;align-items:end;}
.pole label{display:block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);font-weight:800;margin-bottom:5px;}
.pole input,.pole select{width:100%;background:var(--krem);border:1.5px solid var(--linka);padding:9px 11px;font:inherit;font-size:14px;color:var(--text);border-radius:8px;}
.pole input:focus,.pole select:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.25);}
.mini{width:100%;background:var(--krem);border:1.5px solid var(--linka);padding:6px 8px;font:inherit;font-size:13px;color:var(--text);border-radius:7px;}
.mini:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.22);}
.chk{display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;user-select:none;padding-bottom:9px;}
.chk input{width:17px;height:17px;accent-color:#0C3B2E;}
.btn{background:var(--les);color:var(--krem);border:none;padding:11px 20px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;border-radius:9px;}
.btn:hover{background:var(--les2);}
.btn:disabled{opacity:.45;cursor:default;}
.btn2{background:var(--piskovec2);color:var(--les);border:none;padding:10px 16px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;border-radius:9px;}
.btn2:hover{background:var(--piskovec);}
.x{background:none;border:none;color:var(--piskovec);cursor:pointer;font-size:17px;padding:0 4px;line-height:1;}
.x:hover{color:var(--cerven);}

.pruh{height:9px;background:var(--krem2);border-radius:99px;position:relative;overflow:hidden;min-width:52px;}
.pruh i{position:absolute;left:0;top:0;bottom:0;display:block;border-radius:99px;}

.brana{max-width:420px;margin:0 auto;padding:48px 16px;}
.branaKarta{position:relative;background:var(--bila);border:6px solid var(--les);border-radius:24px;padding:30px 26px 26px;box-shadow:0 18px 46px rgba(12,59,46,.16);}
.branaKarta::before{content:"";position:absolute;inset:-14px;border:2px solid var(--salvej);border-radius:32px;opacity:.35;pointer-events:none;}
.branaKarta .nazev{font-size:24px;}
.odkazTlac{display:block;width:100%;background:none;border:none;margin-top:14px;padding:6px;font:inherit;font-size:13px;font-weight:700;color:var(--salvej);text-decoration:underline;text-underline-offset:3px;cursor:pointer;}
.odkazTlac:hover{color:var(--les);}

.volba{display:flex;align-items:center;gap:15px;width:100%;background:var(--bila);border:2px solid var(--linka);border-radius:16px;padding:16px 18px;margin-top:12px;font:inherit;text-align:left;cursor:pointer;color:var(--text);}
.volba:hover{border-color:var(--salvej);background:#FBF9F3;}
.volbaIkona{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.volbaText{flex:1;min-width:0;}
.volba b{display:block;font-size:17px;font-weight:800;color:var(--les);letter-spacing:-.02em;}
.volba small{display:block;font-size:12.5px;color:var(--text2);margin-top:3px;}
.volbaZnak{background:var(--zluta);color:var(--les);font-weight:800;font-size:13px;border-radius:99px;padding:4px 11px;flex-shrink:0;}

.poleOko{position:relative;display:block;}
.poleOko input{width:100%;padding-right:46px;}
.okoBtn{position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:7px;color:var(--piskovec3);display:flex;border-radius:8px;}
.okoBtn:hover{color:var(--les);background:var(--krem);}
.zustat{display:flex;align-items:center;gap:10px;margin-top:14px;font-size:13.5px;font-weight:600;color:var(--text2);cursor:pointer;}
.zustat input{width:18px;height:18px;accent-color:#0C3B2E;flex-shrink:0;}
.branaKarta .btn{width:100%;justify-content:center;padding:13px 20px;font-size:15px;}
.branaKarta .btn2{width:100%;}
@media (max-width:460px){
  .brana{padding:32px 14px;}
  .branaKarta{padding:24px 18px 20px;border-width:5px;}
  .branaKarta::before{inset:-10px;border-radius:28px;}
}
.prazdno{color:var(--text2);font-size:13.5px;padding:18px 0;text-align:center;}
.pozn{font-size:12px;color:var(--text2);line-height:1.55;margin-top:12px;}
.rada{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:16px;}

.skener{border:2px dashed var(--piskovec);background:var(--bila);border-radius:14px;padding:18px;margin-top:14px;}
.drop{border:2px dashed var(--linka);background:var(--krem);padding:30px 16px;text-align:center;cursor:pointer;border-radius:12px;display:block;}
.drop:hover{border-color:var(--salvej);background:#FBF7EE;}
.drop b{display:block;font-size:15.5px;font-weight:800;margin-bottom:4px;color:var(--les);}
.drop span{font-size:12.5px;color:var(--text2);}
.nahled{max-width:150px;border-radius:10px;border:1px solid var(--linka);display:block;}
.spin{display:inline-block;width:15px;height:15px;border:2.5px solid var(--krem2);border-top-color:var(--les);border-radius:50%;animation:ot .8s linear infinite;vertical-align:-3px;margin-right:9px;}
@keyframes ot{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation-duration:2.4s}.latfill,.prstenk,.okno{transition:none}}
.hlaska{border-radius:10px;background:rgba(255,186,0,.16);border-left:4px solid var(--zluta);padding:11px 14px;font-size:13px;margin-top:13px;}
.hlaska.zle{background:rgba(176,58,46,.1);border-left-color:var(--cerven);}
.hlaska.dobre{background:rgba(109,151,115,.16);border-left-color:var(--salvej);}

.mriz{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;}
.fa{border:1px solid var(--linka);border-radius:12px;overflow:hidden;background:var(--krem);}
.faobr{display:block;width:100%;height:150px;padding:0;border:none;background:#fff;cursor:pointer;overflow:hidden;}
.faobr img{width:100%;height:100%;object-fit:cover;object-position:top;display:block;}
.faobr.prazdna{display:flex;align-items:center;justify-content:center;background:var(--krem2);color:var(--text2);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;cursor:default;font-weight:800;}
.fatext{padding:11px 12px 12px;}
.fatext b{display:block;font-size:14px;font-weight:800;line-height:1.25;color:var(--les);}
.fatext span{display:block;font-size:11.5px;color:var(--text2);margin-top:2px;}
.fabtny{display:flex;gap:12px;margin-top:9px;}
.odkaz{background:none;border:none;padding:0;font:inherit;font-size:11.5px;font-weight:700;color:var(--text2);cursor:pointer;text-decoration:underline;text-underline-offset:2px;}
.odkaz:hover{color:var(--cerven);}
.lupa{position:fixed;inset:0;background:rgba(12,59,46,.94);z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out;}
.lupa img{max-width:100%;max-height:88vh;object-fit:contain;border-radius:6px;}
.lupax{position:absolute;top:16px;right:16px;background:var(--krem);border:none;color:var(--les);padding:10px 18px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;border-radius:9px;}

.stavy{display:flex;gap:10px;flex-wrap:wrap;}
.stavc{flex:1;min-width:112px;background:var(--krem);border-radius:11px;padding:13px 14px;display:flex;align-items:center;gap:11px;}
.stavc b{font-size:22px;font-weight:800;line-height:1;display:block;}
.stavc small{font-size:11px;color:var(--text2);font-weight:700;letter-spacing:.06em;text-transform:uppercase;}

.srov{margin-top:2px;}
.srovbar{display:flex;height:24px;border-radius:6px;overflow:hidden;background:var(--krem2);}
.srovbar i{display:block;height:100%;}
.srovleg{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px;}
.srovleg span{display:flex;align-items:center;gap:6px;color:var(--text2);}
.srovleg u{width:11px;height:11px;border-radius:2px;display:block;}
.okno{transition:fill .5s ease;}


/* ---- hlavička přehledu ---- */
.heroV{position:relative;background:var(--lesDum);border:5px solid var(--piskovec2);border-radius:22px;padding:26px 28px 22px;margin-top:18px;color:#EFF5F0;overflow:hidden;}
.heroVrch{display:grid;grid-template-columns:minmax(220px,1.4fr) 128px minmax(240px,1fr);align-items:center;gap:22px;}
.heroUkoly{display:none;font-size:13px;color:var(--salvej2);font-weight:600;margin-top:10px;}
.heroText .eyebrow{letter-spacing:.22em;}
.heroCislo{font-size:clamp(34px,5vw,52px);font-weight:800;letter-spacing:-.04em;line-height:1.02;color:#fff;margin-top:8px;}
.heroPod{font-size:13.5px;color:var(--salvej2);margin-top:10px;line-height:1.5;}
.heroPrsten{width:128px;height:128px;justify-self:center;}
.heroDum{margin:0;justify-self:end;width:100%;}
.heroDum img{display:block;width:100%;max-width:440px;margin-left:auto;}
.heroDum figcaption{text-align:right;font-size:13px;color:var(--salvej2);margin-top:8px;font-weight:600;}
.heroPruh{display:flex;gap:4px;height:14px;margin-top:20px;}
.heroSeg{position:relative;flex-basis:0;min-width:8px;background:rgba(255,255,255,.13);border-radius:99px;overflow:hidden;}
.heroSeg i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;transition:width .7s cubic-bezier(.2,.8,.2,1);}
.heroPruhPopis{display:flex;justify-content:space-between;gap:12px;margin-top:9px;font-size:12.5px;color:var(--salvej2);}
.heroPruhPopis b{color:#fff;font-weight:800;}
.heroZdroje{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px;margin-top:22px;padding-top:20px;border-top:1px solid rgba(255,255,255,.12);}
.zdrojKarta{display:flex;align-items:center;gap:14px;}
.zdrojIkona{width:54px;height:54px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.zdrojKarta{align-items:flex-start;}
.zdrojText{flex:1;min-width:0;}
.zdrojKarta small{display:block;font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;font-weight:800;}
.zdrojKarta b{display:block;font-size:23px;font-weight:800;letter-spacing:-.03em;color:#fff;margin-top:4px;line-height:1.1;}
.zdrojKarta b em{font-style:normal;font-size:12px;font-weight:700;color:var(--salvej2);letter-spacing:.04em;text-transform:uppercase;margin-left:6px;}
.zdrojPruh{display:block;height:6px;border-radius:99px;background:rgba(255,255,255,.14);margin-top:9px;overflow:hidden;}
.zdrojPruh i{display:block;height:100%;border-radius:99px;transition:width .7s cubic-bezier(.2,.8,.2,1);}
.zdrojPod{display:block;font-size:11.5px;color:var(--salvej2);margin-top:6px;}
@media (max-width:900px){
  .heroVrch{grid-template-columns:1fr auto;align-items:center;gap:16px;}
  .heroDum{display:none;}
  .heroUkoly{display:block;}
  .heroPrsten{width:104px;height:104px;justify-self:end;}
}
@media (max-width:460px){
  .heroV{padding:20px 18px 18px;}
  .heroPrsten{width:88px;height:88px;}
  .heroZdroje{gap:14px;margin-top:18px;padding-top:16px;}
  .zdrojIkona{width:46px;height:46px;}
  .zdrojKarta b{font-size:21px;}
}

/* ---- rozpočet podle návrhu ---- */
.filtrPas{position:relative;background:var(--les);border-radius:18px;padding:14px 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;overflow:hidden;margin-top:14px;}
.listy{position:absolute;right:6px;top:2px;width:130px;height:76px;pointer-events:none;}
.filtrTlac{position:relative;background:transparent;border:1.5px solid rgba(255,255,255,.45);color:#EFF5F0;border-radius:99px;padding:9px 18px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:8px;}
.filtrTlac:hover{border-color:#fff;}
.filtrTlac[data-a="1"]{background:#fff;color:var(--les);border-color:#fff;}
.filtrTlac[data-jemny="1"]{background:rgba(255,255,255,.14);border-color:transparent;}
.filtrTlac[data-jemny="1"]:hover{background:rgba(255,255,255,.24);}
.filtrHledej{position:relative;flex:1;min-width:180px;}
.filtrHledej input{width:100%;background:rgba(255,255,255,.14);border:1.5px solid rgba(255,255,255,.3);border-radius:99px;padding:9px 16px;font:inherit;font-size:13.5px;color:#fff;}
.filtrHledej input::placeholder{color:rgba(239,245,240,.6);}
.filtrHledej input:focus{outline:none;border-color:var(--zluta);}

.diskSeznam{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;}
.diskSeznam li{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;background:var(--krem);border-radius:10px;padding:9px 12px;font-size:13px;}
.diskSeznam b{color:var(--les);font-weight:700;}
.diskSeznam span{color:var(--text2);font-size:12px;}
.diskSeznam li span:last-child{margin-left:auto;color:var(--text);font-size:13px;}

.fakturyMriz{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;}
.fakturaKarta{background:var(--bila);border:1.5px solid rgba(109,151,115,.45);border-radius:14px;padding:12px;}
.fakturaKarta[data-disk="1"]{border-color:#3E6B4C;background:#FAFCFA;}
.fakturaFoto{display:block;width:100%;height:150px;object-fit:cover;border-radius:10px;background:var(--krem2);cursor:pointer;border:1px solid var(--linka);}
.fakturaNacitam{display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text2);cursor:default;}
.fakturaText{margin-top:9px;}
.fakturaText b{display:block;font-size:14px;font-weight:700;color:var(--les);line-height:1.25;}
.fakturaText small{display:block;font-size:11.5px;color:var(--text2);margin:3px 0 4px;}

.fakturniRadky{background:var(--krem);border-radius:14px;padding:14px;margin-top:12px;}
.fakturniR{display:flex;align-items:center;gap:12px;background:var(--bila);border:1.5px solid rgba(109,151,115,.4);border-radius:11px;padding:10px 12px;cursor:pointer;}
.fakturniR[data-prirazeno="1"]{opacity:.5;background:var(--krem2);cursor:default;}
.fakturniR input[type="checkbox"]{width:18px;height:18px;accent-color:#0C3B2E;flex-shrink:0;}
.fakturniText{flex:1;min-width:0;}
.fakturniText b{display:block;font-size:13.5px;font-weight:700;color:var(--les);line-height:1.3;}
.fakturniText small{display:block;font-size:11px;color:var(--text2);margin-top:2px;}

.poznamkaPole{width:100%;min-height:82px;background:var(--krem);border:1.5px solid var(--linka);border-radius:12px;padding:11px 13px;font:inherit;font-size:14px;line-height:1.5;color:var(--text);resize:vertical;}
.poznamkaPole:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.22);}

.upominkySeznam{display:flex;flex-direction:column;gap:8px;}
.upominka{display:flex;align-items:flex-start;gap:12px;background:var(--krem);border:1.5px solid rgba(109,151,115,.4);border-radius:12px;padding:11px 13px;}
.upominka[data-hotovo="1"]{opacity:.55;background:var(--bila);}
.upominka[data-hotovo="1"] .upominkaText b{text-decoration:line-through;}
.upominkaText{flex:1;min-width:0;}
.upominkaText b{display:block;font-size:14px;font-weight:700;color:var(--les);line-height:1.35;}
.upominkaText small{display:block;font-size:11.5px;color:var(--text2);margin-top:3px;}

.pridatKarta{display:flex;align-items:center;gap:14px;width:100%;background:var(--bila);border:1px solid var(--linka);border-radius:18px;padding:16px 18px;margin-top:14px;font:inherit;font-size:15px;font-weight:700;color:var(--les);cursor:pointer;}
.pridatKarta:hover{border-color:var(--salvej);background:#FBF9F3;}
.pridatPlus{width:38px;height:38px;border-radius:11px;background:var(--krem);display:flex;align-items:center;justify-content:center;flex-shrink:0;}

.skupinaKarta{background:var(--bila);border:1px solid var(--linka);border-radius:20px;margin-top:14px;overflow:hidden;}
.skupinaHlava{display:grid;grid-template-columns:64px minmax(150px,1.6fr) repeat(3,minmax(84px,.9fr)) 110px 26px;align-items:center;gap:12px;width:100%;background:none;border:none;padding:16px 18px;font:inherit;text-align:left;cursor:pointer;color:var(--text);}
.skupinaHlava:hover{background:#FBF9F3;}
.skupinaIkona{width:56px;height:56px;border-radius:50%;background:var(--krem);border:2px solid;display:flex;align-items:center;justify-content:center;}
.skupinaNazev b{display:block;font-size:17px;font-weight:800;letter-spacing:-.02em;line-height:1.2;}
.skupinaNazev small{display:block;font-size:12.5px;color:var(--text2);margin-top:3px;}
.sloupceSk{display:contents;}
.cisla{display:contents;}
.sloupec small{display:block;font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--text2);font-weight:800;}
.sloupec b{display:block;font-size:16px;font-weight:800;letter-spacing:-.02em;margin-top:3px;white-space:nowrap;}
.skupinaPruh{display:block;height:9px;border-radius:99px;background:var(--krem2);position:relative;overflow:hidden;}
.skupinaPruh i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;}
.skupinaTelo{padding:0 12px 12px;}

.polozkaR{display:grid;grid-template-columns:34px minmax(150px,1.6fr) repeat(3,minmax(84px,.9fr)) 110px 26px 26px;align-items:center;gap:12px;background:var(--bila);border:1.5px solid rgba(109,151,115,.5);border-radius:14px;padding:12px 14px;margin-top:8px;}
.polozkaR:hover{border-color:var(--salvej);}
.polozkaNazev b{display:block;font-size:14px;font-weight:700;line-height:1.25;color:var(--les);}
.polozkaNazev small{display:block;font-size:12px;color:var(--text2);margin-top:2px;}
.stavPilulka{display:inline-block;margin-left:8px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;border-radius:6px;padding:2px 7px;vertical-align:2px;}
.ctaDetail{background:var(--zluta);border:1.5px solid var(--zluta);border-radius:10px;padding:9px 16px;font:inherit;font-size:12.5px;font-weight:800;color:var(--les);cursor:pointer;white-space:nowrap;}
.ctaDetail:hover{background:var(--les);border-color:var(--les);color:var(--zluta);}

.stitekNavic{display:inline-block;margin-left:7px;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#B46617;background:#F7E7D6;border-radius:6px;padding:2px 6px;vertical-align:1px;}

.stavKolecko{width:26px;height:26px;border-radius:50%;border:2px solid var(--linka);background:var(--bila);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}
.stavKolecko[data-stav="hotovo"]{background:#3E6B4C;border-color:#3E6B4C;}
.stavKolecko[data-stav="probiha"]{border-color:#D98C0A;}
.stavKolecko .pulka{width:11px;height:11px;border-radius:50%;background:#D98C0A;}
.stavKolecko:hover{border-color:var(--salvej);}

.odhadPole input{width:100%;background:var(--krem);border:1.5px solid var(--linka);border-radius:10px;padding:8px 10px;font:inherit;font-size:14px;font-weight:700;text-align:center;color:var(--text);}
.odhadPole input:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.22);}
.skutPole b,.rozdilPole b{display:block;font-size:14px;font-weight:700;text-align:center;}
.cisla small{display:none;}
.stavStitek{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;white-space:nowrap;}
.detailSipka{background:none;border:none;color:var(--piskovec);font-size:17px;font-weight:800;cursor:pointer;padding:0;line-height:1;}
.detailSipka:hover{color:var(--okr);}
.polozkaSmaz{display:flex;justify-content:flex-end;}

.viceTlac{display:block;width:100%;background:none;border:none;border-top:1px dashed var(--linka);margin-top:8px;padding:12px;font:inherit;font-size:13.5px;font-weight:700;color:var(--salvej);cursor:pointer;}
.viceTlac:hover{color:var(--les);}

@media (max-width:760px){
  .tKarty thead{display:none;}
  .tKarty,.tKarty tbody,.tKarty tr,.tKarty td{display:block;width:100%;}
  .tKarty tr{background:var(--bila);border:1.5px solid rgba(109,151,115,.45);border-radius:14px;padding:12px 14px;margin-top:10px;}
  .tKarty td{border-bottom:none!important;padding:3px 0;text-align:left!important;}
  .tKarty td[data-popis]{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 0;border-top:1px solid var(--linka)!important;}
  .tKarty td[data-popis]::before{content:attr(data-popis);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);font-weight:800;flex-shrink:0;}
  .tKarty td[data-popis] .mini{width:130px;text-align:right;}
  .tKarty .bunkaDatum{font-size:11.5px;font-weight:700;}
  .tKarty .bunkaPopis{font-size:15px;font-weight:700;color:var(--les);line-height:1.3;padding-bottom:6px;}
  .tKarty .bunkaCastka{font-size:16px;font-weight:800;}
  .tKarty tr[style*="border-top"]{background:var(--krem2);}
  .box{max-width:100%;overflow-x:auto;}
}

.patka{display:flex;align-items:center;gap:14px;background:var(--krem2);border-radius:16px;padding:14px 18px;margin-top:18px;flex-wrap:wrap;}
.patkaI{width:34px;height:34px;border-radius:50%;background:var(--les);color:var(--zluta);display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0;}
.patka p{flex:1;margin:0;font-size:13px;color:var(--text2);min-width:180px;}

@media (max-width:900px){
  .skupinaHlava{
    grid-template-columns:48px minmax(0,1fr) 26px;
    grid-template-areas:"ikona nazev sipka" "cisla cisla cisla" "pruh pruh pruh";
    gap:12px;padding:14px;
  }
  .skupinaIkona{grid-area:ikona;width:48px;height:48px;}
  .skupinaNazev{grid-area:nazev;}
  .skupinaNazev b{font-size:17px;}
  .skupinaHlava .sipka{grid-area:sipka;}
  .sloupceSk{grid-area:cisla;display:flex;gap:10px;}
  .sloupceSk .sloupec{flex:1;min-width:0;}
  .sloupceSk .sloupec b{font-size:14px;}
  .skupinaPruh{grid-area:pruh;}
  .skupinaTelo{padding:0 8px 8px;}

  .polozkaR{
    grid-template-columns:28px minmax(0,1fr) 24px;
    grid-template-areas:"stav nazev smaz" "cisla cisla cisla" "cta cta cta";
    gap:12px 10px;padding:16px 14px;
  }
  .polozkaR .stavKolecko{grid-area:stav;width:28px;height:28px;}
  .polozkaNazev{grid-area:nazev;}
  .polozkaNazev b{display:block;font-size:15px;font-weight:700;letter-spacing:-.01em;line-height:1.25;color:var(--les);}
  .polozkaNazev .stavPilulka{display:inline-block;margin:7px 0 0;vertical-align:0;font-size:10.5px;}
  .polozkaNazev small{font-size:12.5px;margin-top:5px;}
  .polozkaSmaz{grid-area:smaz;justify-self:end;}

  .cisla{grid-area:cisla;display:block;border-top:1px solid var(--linka);}
  .cisla > span{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 2px;border-bottom:1px solid var(--linka);}
  .cisla small{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);font-weight:800;margin:0;text-align:left;}
  .odhadPole input{width:132px;text-align:right;font-size:16px;padding:9px 12px;}
  .skutPole b,.rozdilPole b{text-align:right;font-size:17px;font-weight:800;}

  .polozkaR .ctaDetail{grid-area:cta;justify-self:start;font-size:13.5px;padding:11px 20px;}
}


.vchod{display:flex;align-items:center;gap:14px;width:100%;text-align:left;background:var(--bila);border:1px solid var(--linka);border-bottom:4px solid var(--piskovec2);border-radius:14px;padding:16px;margin-bottom:12px;cursor:pointer;font:inherit;color:var(--text);}
.vchod:hover{border-color:var(--salvej);}
.vchod b{display:block;font-size:16px;font-weight:800;color:var(--les);}
.vchod small{display:block;font-size:12px;color:var(--text2);margin-top:2px;}
.vikona{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.odznak{margin-left:auto;background:var(--zluta);color:var(--les);font-size:12px;font-weight:800;border-radius:99px;min-width:24px;height:24px;display:flex;align-items:center;justify-content:center;padding:0 7px;}

.velkytlac{background:var(--bila);border:1px solid var(--linka);border-bottom:4px solid var(--piskovec2);border-radius:14px;padding:22px 16px;cursor:pointer;font:inherit;color:var(--text);text-align:center;}
.velkytlac:hover{border-color:var(--salvej);}
.velkytlac .vikona{margin:0 auto 12px;}
.velkytlac b{display:block;font-size:17px;font-weight:800;color:var(--les);}
.velkytlac small{display:block;font-size:12.5px;color:var(--text2);margin-top:3px;}

.hodinari{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;}
.hodinar{display:flex;align-items:center;gap:9px;background:var(--krem);border-radius:11px;padding:10px 12px;}
.hodinar label{flex:1;font-size:13.5px;font-weight:700;color:var(--les);}
.hodSazba{display:block;font-size:11px;color:var(--text2);font-weight:600;margin-top:1px;}
.hodinar input{width:66px;background:var(--bila);border:1.5px solid var(--linka);border-radius:8px;padding:9px;font:inherit;font-size:17px;font-weight:700;text-align:center;color:var(--text);}
.hodinar input:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.25);}
.hodinar span{font-size:12px;color:var(--text2);font-weight:700;}

.soucet{display:flex;justify-content:space-between;align-items:center;background:var(--les);color:#fff;border-radius:12px;padding:14px 18px;margin-top:16px;}
.soucet span{font-size:13px;color:var(--salvej2);font-weight:700;}
.soucet b{font-size:24px;font-weight:800;letter-spacing:-.03em;}

.rozcest{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:14px;}
.mesicpas{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;background:var(--les);color:#fff;border-radius:16px;padding:18px 20px;margin-top:18px;border:5px solid var(--piskovec2);}
.mesicpas .eyebrow{color:var(--salvej2);display:block;}
.mesicpas b{display:block;font-size:32px;font-weight:800;letter-spacing:-.035em;line-height:1.05;margin-top:3px;}
.mesicpas small{display:block;font-size:13px;color:var(--salvej2);margin-top:2px;}
.mesicpravo{text-align:right;}
.mesicpravo b{font-size:22px;color:var(--zluta);}

.pozor{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:12px;background:var(--zluta);color:var(--les);padding:13px 16px;margin:14px -16px 0;border-radius:12px;box-shadow:0 3px 14px rgba(12,59,46,.18);}
.pozorik{width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.55);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.pozortext{flex:1;font-size:13.5px;line-height:1.35;}
.pozorbtn{background:var(--les);color:var(--zluta);border:none;padding:9px 15px;font:inherit;font-size:12.5px;font-weight:800;border-radius:9px;cursor:pointer;flex-shrink:0;}
.pozorbtn:hover{background:var(--les2);}

.modal{position:fixed;inset:0;background:rgba(12,59,46,.62);z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;}
.modalkarta{background:var(--bila);border-radius:18px;border-top:7px solid var(--zluta);padding:26px;max-width:430px;width:100%;box-shadow:0 20px 60px rgba(12,59,46,.35);}
.modalik{width:60px;height:60px;border-radius:16px;background:#F7E7D6;display:flex;align-items:center;justify-content:center;margin-bottom:16px;}
.modalnadpis{font-size:22px;font-weight:800;letter-spacing:-.025em;color:var(--les);margin:0 0 8px;line-height:1.15;}
.modaltext{font-size:14px;color:var(--text2);margin:0;line-height:1.55;}

.rozpadk{margin-top:8px;display:flex;flex-direction:column;gap:4px;align-items:flex-end;}
.rozpadk span{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--salvej2);}
.rozpadk u{width:9px;height:9px;border-radius:2px;display:block;text-decoration:none;}
.rozpadk b{color:#fff;font-weight:800;}

.fotoblok{flex-shrink:0;width:230px;}
.fotoTlac{display:block;width:100%;padding:0;border:1.5px solid var(--piskovec);border-radius:10px;background:#fff;cursor:zoom-in;overflow:hidden;}
.fotoTlac img{display:block;width:100%;max-height:300px;object-fit:cover;object-position:top;}
.fotoTlac:hover{border-color:var(--salvej);}
.fotoPopis{display:block;font-size:11px;color:var(--text2);text-align:center;margin-top:5px;font-weight:700;}
.fotoCeka{border:1.5px dashed var(--linka);border-radius:10px;padding:26px 12px;text-align:center;font-size:12.5px;color:var(--text2);font-weight:700;}
@media (max-width:640px){.fotoblok{width:100%;}}

.combo{position:relative;width:100%;}
.combolist{position:absolute;z-index:35;top:100%;left:0;right:0;min-width:230px;background:#fff;border:1.5px solid var(--linka);border-radius:10px;margin-top:4px;max-height:240px;overflow:auto;box-shadow:0 10px 28px rgba(12,59,46,.2);text-align:left;}
.comboitem{display:block;width:100%;text-align:left;background:none;border:none;padding:9px 12px;font:inherit;font-size:13.5px;color:var(--text);cursor:pointer;}
.comboitem:hover{background:var(--krem);}
.comboitem.nova{color:var(--okr);font-weight:700;border-top:1px solid var(--linka);}
.comboodhad{color:var(--text2);font-size:11.5px;}
.comboprazdno{padding:10px 12px;font-size:12.5px;color:var(--text2);}

.potvrz{display:inline-flex;align-items:center;gap:7px;background:#F7DED9;border-radius:9px;padding:5px 9px;white-space:nowrap;}
.potvrzT{font-size:11.5px;font-weight:700;color:#B03A2E;}
.potvrzAno{background:#B03A2E;color:#fff;border:none;border-radius:7px;padding:5px 10px;font:inherit;font-size:11.5px;font-weight:800;cursor:pointer;}
.potvrzNe{background:none;border:none;color:#5E7268;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer;text-decoration:underline;}

.vraceno{background:#F7DED9;border-radius:10px;padding:11px 13px;margin-bottom:8px;}
.vraceno b{display:block;font-size:13.5px;color:var(--les);line-height:1.35;}
.vraceno span{display:block;font-size:13px;color:#B03A2E;margin-top:4px;font-weight:700;}

.skupinaR{cursor:pointer;transition:filter .15s;}
.skupinaR:hover{filter:brightness(.96);}
.skupinaR td{border-bottom:none!important;padding-top:14px;padding-bottom:14px;}
.skupinaR td:first-child{padding-left:12px;border-radius:10px 0 0 10px;}
.skupinaR td:last-child{border-radius:0 10px 10px 0;padding-right:12px;}
.skupinaR b{font-size:15px;font-weight:800;letter-spacing:-.01em;display:block;}
.sipka{display:inline-block;font-size:19px;font-weight:800;line-height:1;transition:transform .2s;transform-origin:center;}
.sipka[data-open="0"]{transform:rotate(-90deg);}
.skupinaPocet{display:block;font-size:11.5px;color:var(--text2);font-weight:600;margin-top:2px;}
.zalohaPole{width:100%;min-height:110px;margin-top:10px;background:var(--krem);border:1.5px solid var(--linka);border-radius:10px;padding:10px 12px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:1.5;color:var(--text2);resize:vertical;}
.zalohaPole:focus{outline:none;border-color:var(--salvej);box-shadow:0 0 0 3px rgba(109,151,115,.22);}

.presunR{display:block;margin-top:5px;min-width:150px;}
.presunR .mini{font-size:11.5px;padding:4px 7px;border-style:dashed;border-color:var(--piskovec);}
.presunR .mini:focus{border-style:solid;}

.dokladR{display:block;font-size:11.5px;color:var(--text2);margin-top:2px;}
.dokladR b{font-weight:800;color:var(--les);}
.dokladR em{font-style:italic;color:var(--okr);}
.origOdkaz{color:var(--salvej);font-weight:700;text-decoration:underline;text-underline-offset:2px;}
.origOdkaz:hover{color:var(--les);}

.nazevOdkaz{background:none;border:none;padding:0;font:inherit;font-size:13.5px;font-weight:650;color:var(--les);cursor:pointer;text-align:left;border-bottom:1px dotted var(--piskovec);}
.nazevOdkaz:hover{color:var(--okr);border-bottom-color:var(--okr);}
.radekPod{display:block;font-size:11.5px;color:var(--text2);margin-top:3px;}
.skupinaVyber{background:none;border:none;font:inherit;font-size:11.5px;color:var(--text2);cursor:pointer;padding:0;border-bottom:1px dotted var(--linka);}

.doklBar{display:flex;height:26px;border-radius:8px;overflow:hidden;background:var(--krem2);}
.doklBar i{display:block;height:100%;}
.tecka{display:inline-block;width:10px;height:10px;border-radius:3px;}

.dluhSouhrn{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;background:var(--krem);border-radius:12px;padding:14px 16px;margin-top:4px;}
.dluhSouhrn b{display:block;font-size:19px;font-weight:800;letter-spacing:-.025em;margin-top:2px;}

.zalohabox{border-left:5px solid var(--zluta);}
.ctaMaly{padding:7px 14px;font-size:12.5px;border-radius:8px;}
.zalohaNadpis{font-size:13.5px;font-weight:800;color:var(--les);margin:0 0 10px;}

.zalohapas{display:flex;align-items:flex-start;gap:12px;background:#FFF2D0;border-left:4px solid var(--zluta);border-radius:12px;padding:13px 15px;margin-top:14px;}
.zalohapas b{font-size:13.5px;color:var(--les);display:block;line-height:1.35;}
.zalohapas > div{flex:1;}
.zalohaR{display:block;font-size:12px;color:#8A6100;margin-top:4px;}
.zalohaR b{display:inline;font-weight:800;}

.tab[data-poz="1"]{background:var(--zluta);color:var(--les);}
.tab[data-poz="1"][data-a="1"]{background:var(--les);color:var(--zluta);}
`;

export default function App() {
  const [data, setData] = useState(null);
  const [nacteno, setNacteno] = useState(false);
  const [chyba, setChyba] = useState("");
  const [tab, setTab] = useState("prehled");
  const [rezim, setRezim] = useState(null);
  const [obnovaHesla, setObnovaHesla] = useState(() => zachytObnovu());
  const [prihlasena, setPrihlasena] = useState(!!RELACE);
  const [znovu, setZnovu] = useState(0);
  const [chybaNacteni, setChybaNacteni] = useState("");

  useEffect(() => {
    // Dokud není jisté, kdo je přihlášený, nemá se z databáze na co ptát.
    if (!prihlasena || obnovaHesla) return;
    let zruseno = false;

    (async () => {
      setNacteno(false);
      setChybaNacteni("");

      // Relace uložená v prohlížeči může být dávno neplatná. Ověří se dřív,
      // než se na ni navěsí čtení dat — jinak by odmítnutí vypadalo
      // jako prázdná databáze.
      if (ULOZISTE.rezim === "supabase") {
        let token;
        try {
          token = await platnyToken();
        } catch (e) {
          if (zruseno) return;
          setChybaNacteni(e && e.message ? e.message : "Spojení s databází selhalo.");
          setNacteno(true);
          return;
        }
        if (zruseno) return;
        if (!token) {
          zrusRelaci();
          setPrihlasena(false);
          setNacteno(true);
          return;
        }
      }

      // Selhané čtení se odliší od „nic tam není". Chyba se nepolyká —
      // kdyby se spolkla, otevřel by se prázdný deník a první uložení by
      // skutečná data v databázi přepsalo.
      let d = null;
      try {
        const r = await ULOZISTE.get(KEY, true);
        if (r) d = JSON.parse(r.value);
        if (!d) {
          const s2 = await ULOZISTE.get(KEY_V2, true);
          if (s2) d = JSON.parse(s2.value);
        }
        if (!d) {
          const s1 = await ULOZISTE.get(KEY_STARY, true);
          if (s1) d = migruj(JSON.parse(s1.value));
        }
      } catch (e) {
        if (zruseno) return;
        setChybaNacteni(e && e.message ? e.message : "Data se nepodařilo načíst.");
        setNacteno(true);
        return;
      }

      if (zruseno) return;
      setData(migruj2(d || {}));
      setNacteno(true);
    })();

    return () => {
      zruseno = true;
    };
  }, [znovu, prihlasena, obnovaHesla]);

  const uloz = async (nove) => {
    setData(nove);
    try {
      await ULOZISTE.set(KEY, JSON.stringify(nove), true);
      setChyba("");
    } catch (e) {
      setChyba(
        "Pozor: data se nepodařilo uložit — " +
          (e && e.message ? e.message : "neznámá chyba") +
          ". Co teď zapíšeš, po zavření zmizí."
      );
    }
  };

  const odhlas = () => {
    zrusRelaci();
    zapomenPrihlaseni();
    setRezim(null);
    setPrihlasena(false);
  };

  if (obnovaHesla)
    return (
      <NoveHeslo
        onHotovo={() => {
          setObnovaHesla(false);
          setPrihlasena(true);
          setZnovu((x) => x + 1);
        }}
      />
    );

  // Přihlášení se řeší dřív než data — dokud není, není se koho ptát.
  if (!prihlasena)
    return (
      <Prihlaseni
        onHotovo={() => {
          setPrihlasena(true);
          setZnovu((x) => x + 1);
        }}
      />
    );

  if (!nacteno)
    return (
      <div className="sd">
        <style>{CSS}</style>
        <p className="prazdno" style={{ paddingTop: 70 }}>
          Otevírám deník…
        </p>
      </div>
    );

  // Když se data nepodařilo přečíst, deník se neotevře prázdný. Prázdný
  // deník vypadá jako ztracená data a první uložení by je opravdu přepsalo.
  if (chybaNacteni)
    return (
      <ChybaNacteni
        zprava={chybaNacteni}
        znovu={() => setZnovu((x) => x + 1)}
        odhlas={odhlas}
      />
    );

  if (!rezim)
    return (
      <Rozcestnik
        data={data}
        onVolba={setRezim}
        ceka={
          (data.cekajici || []).filter((z) => z.stav === "ceka").length +
          (data.polozky || []).filter((p) => p.kRozpadu).length
        }
      />
    );

  if (rezim === "delnik")
    return <AppDelnik data={data} uloz={uloz} zpet={odhlas} />;

  return (
    <Denik
      data={data}
      uloz={uloz}
      tab={tab}
      setTab={setTab}
      chyba={chyba}
      odhlas={odhlas}
    />
  );
}

// Dřív se oba kontrolní účty jmenovaly podle konkrétních lidí. Teď jsou to
// neutrální ucetA/ucetB a jméno je součástí dat — staré klíče se přenesou.
const KONTROLA_KLICE = ["popisA", "ucetA", "popisB", "ucetB", "datum", "zustatek"];

function migrujKontrolu(k) {
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

function migruj2(o) {
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

function migruj(v1) {
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

function Rozcestnik({ data, onVolba, ceka }) {
  return (
    <div className="sd">
      <style>{CSS}</style>
      <div className="brana">
        <div className="branaKarta">
          <div className="znacka" style={{ marginBottom: 24 }}>
            <span className="mark">
              <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.4 10.4 12 3.6l7.6 6.8v9.6H4.4z" fill="#fff" stroke="#D8CDB6" strokeWidth="1" />
                <path d="M2.6 11 12 2.6l9.4 8.4" fill="none" stroke="#B4562A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="9.1" y="7.4" width="2.1" height="2.4" fill="#0C3B2E" />
                <rect x="12.2" y="7.4" width="2.1" height="2.4" fill="#0C3B2E" />
                <rect x="6.6" y="12.6" width="3.5" height="4" fill="#0C3B2E" />
                <rect x="13.4" y="12.6" width="3.5" height="4" fill="#0C3B2E" />
                <path d="M4.4 18.4h15.2v1.6H4.4z" fill="#C9AE85" />
              </svg>
            </span>
            <div>
              <div className="eyebrow">
                Stavební deník{data.misto ? " · " + data.misto : ""}
              </div>
              <h1 className="nazev">{data.nazev}</h1>
            </div>
          </div>

          <button className="volba" onClick={() => onVolba("my")}>
            <span className="volbaIkona" style={{ background: "#E4EDE5" }}>
              <Ik d={IKO.dum} c="#0C3B2E" s={26} w={1.7} />
            </span>
            <span className="volbaText">
              <b>Celá správa</b>
              <small>Rozpočet, faktury, dotace, schvalování</small>
            </span>
            {ceka > 0 && <span className="volbaZnak">{ceka}</span>}
          </button>

          <button className="volba" onClick={() => onVolba("delnik")}>
            <span className="volbaIkona" style={{ background: "#F7E7D6" }}>
              <Ik d={IKO.tuzka} c="#B46617" s={26} w={1.7} />
            </span>
            <span className="volbaText">
              <b>{data.delnik.jmeno}</b>
              <small>Zápis hodin a faktur</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function NoveHeslo({ onHotovo }) {
  const [h1, setH1] = useState("");
  const [h2, setH2] = useState("");
  const [vidim, setVidim] = useState(false);
  const [chyba, setChyba] = useState("");
  const [pracuju, setPracuju] = useState(false);

  const odesli = async () => {
    if (h1.length < 6) return setChyba("Heslo musí mít aspoň 6 znaků.");
    if (h1 !== h2) return setChyba("Hesla se neshodují.");
    setPracuju(true);
    setChyba("");
    try {
      await zmenHeslo(h1);
      onHotovo();
    } catch (e) {
      setChyba(e.message);
      setPracuju(false);
    }
  };

  return (
    <div className="sd">
      <style>{CSS}</style>
      <div className="brana">
        <div className="branaKarta">
          <div className="znacka" style={{ marginBottom: 22 }}>
            <span className="mark">
              <Ik d={IKO.zamek} c="#0C3B2E" s={26} w={1.8} />
            </span>
            <div>
              <div className="eyebrow">Stavební deník</div>
              <h1 className="nazev">Nové heslo</h1>
            </div>
          </div>

          <div className="pole">
            <label>Nové heslo</label>
            <span className="poleOko">
              <input
                type={vidim ? "text" : "password"}
                value={h1}
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  setH1(e.target.value);
                  setChyba("");
                }}
              />
              <button className="okoBtn" onClick={() => setVidim(!vidim)}
                aria-label={vidim ? "Skrýt heslo" : "Zobrazit heslo"}>
                <Ik d={vidim ? IKO.okoSkrt : IKO.oko} s={19} w={1.7} />
              </button>
            </span>
          </div>

          <div className="pole" style={{ marginTop: 12 }}>
            <label>Ještě jednou pro kontrolu</label>
            <input
              type={vidim ? "text" : "password"}
              value={h2}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setH2(e.target.value);
                setChyba("");
              }}
              onKeyDown={(e) => e.key === "Enter" && odesli()}
            />
          </div>

          <button className="btn" style={{ marginTop: 16 }} onClick={odesli}
            disabled={pracuju || !h1 || !h2}>
            {pracuju ? "Ukládám…" : "Nastavit heslo"}
          </button>

          {chyba && <div className="hlaska zle">{chyba}</div>}
        </div>
      </div>
    </div>
  );
}

function Prihlaseni({ onHotovo }) {
  const [email, setEmail] = useState((RELACE && RELACE.email) || "");
  const [heslo, setHeslo] = useState("");
  const [vidim, setVidim] = useState(false);
  const [chyba, setChyba] = useState("");
  const [pracuju, setPracuju] = useState(false);
  const [zapomnela, setZapomnela] = useState(false);
  const [poslano, setPoslano] = useState("");

  const odesli = async () => {
    if (!email.trim() || !heslo) return;
    setPracuju(true);
    setChyba("");
    try {
      await prihlasSe(email, heslo);
      onHotovo();
    } catch (e) {
      setChyba(e.message || "Přihlášení se nepovedlo.");
      setPracuju(false);
    }
  };

  return (
    <div className="sd">
      <style>{CSS}</style>
      <div className="brana">
        <div className="branaKarta">
          <div className="znacka" style={{ marginBottom: 24 }}>
            <span className="mark">
              <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.4 10.4 12 3.6l7.6 6.8v9.6H4.4z" fill="#fff" stroke="#D8CDB6" strokeWidth="1" />
                <path d="M2.6 11 12 2.6l9.4 8.4" fill="none" stroke="#B4562A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="9.1" y="7.4" width="2.1" height="2.4" fill="#0C3B2E" />
                <rect x="12.2" y="7.4" width="2.1" height="2.4" fill="#0C3B2E" />
                <rect x="6.6" y="12.6" width="3.5" height="4" fill="#0C3B2E" />
                <rect x="13.4" y="12.6" width="3.5" height="4" fill="#0C3B2E" />
                <path d="M4.4 18.4h15.2v1.6H4.4z" fill="#C9AE85" />
              </svg>
            </span>
            <div>
              <div className="eyebrow">Stavební deník</div>
              <h1 className="nazev">Přihlášení</h1>
            </div>
          </div>

          <div className="pole">
            <label>E-mail</label>
            <input
              type="email"
              value={email}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              inputMode="email"
              onChange={(e) => {
                setEmail(e.target.value);
                setChyba("");
              }}
            />
          </div>

          <div className="pole" style={{ marginTop: 12 }}>
            <label>Heslo</label>
            <span className="poleOko">
              <input
                type={vidim ? "text" : "password"}
                value={heslo}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="current-password"
                onChange={(e) => {
                  setHeslo(e.target.value);
                  setChyba("");
                }}
                onKeyDown={(e) => e.key === "Enter" && odesli()}
              />
              <button
                className="okoBtn"
                onClick={() => setVidim(!vidim)}
                aria-label={vidim ? "Skrýt heslo" : "Zobrazit heslo"}
              >
                <Ik d={vidim ? IKO.okoSkrt : IKO.oko} s={19} w={1.7} />
              </button>
            </span>
          </div>

          <button
            className="btn"
            style={{ marginTop: 16 }}
            onClick={odesli}
            disabled={pracuju || !email.trim() || !heslo}
          >
            {pracuju ? "Přihlašuji…" : "Přihlásit se"}
          </button>

          {chyba && <div className="hlaska zle">{chyba}</div>}

          {!zapomnela ? (
            <button className="odkazTlac" onClick={() => setZapomnela(true)}>
              Zapomněla jsem heslo
            </button>
          ) : (
            <div className="hlaska" style={{ marginBottom: 0 }}>
              <b>Obnova hesla.</b> Vyplň nahoře e-mail a pošleme ti na něj odkaz,
              kterým si nastavíš nové.
              <div className="rada">
                <button
                  className="btn2"
                  disabled={!email.trim() || poslano === "posilam"}
                  onClick={async () => {
                    setPoslano("posilam");
                    try {
                      await posliObnovu(email);
                      setPoslano("ok");
                    } catch (e) {
                      setPoslano("");
                      setChyba(e.message);
                    }
                  }}
                >
                  {poslano === "posilam" ? "Odesílám…" : "Poslat odkaz"}
                </button>
                <button className="btn2" onClick={() => setZapomnela(false)}>
                  Zpět
                </button>
              </div>
              {poslano === "ok" && (
                <p className="pozn" style={{ marginBottom: 0 }}>
                  Odkaz je na cestě. Kdyby nedorazil do pár minut, mrkni do
                  spamu — nebo heslo přepiš přímo v Supabase.
                </p>
              )}
            </div>
          )}

          <p className="pozn">
            Přihlášení ověřuje databáze, ne aplikace. Bez účtu se k číslům
            nedostane nikdo, ani kdo zná adresu.
          </p>
        </div>
      </div>
    </div>
  );
}

// Data se nepodařilo přečíst. Vědomě se tu nic nenabízí k zápisu — dokud
// není jisté, co v databázi je, každé uložení může přepsat něco živého.
function ChybaNacteni({ zprava, znovu, odhlas }) {
  return (
    <div className="sd">
      <style>{CSS}</style>
      <div className="brana">
        <div className="branaKarta">
          <div className="znacka" style={{ marginBottom: 20 }}>
            <span className="mark">
              <Ik d={IKO.stit} c="#B03A2E" s={26} w={2} />
            </span>
            <div>
              <div className="eyebrow">Stavební deník</div>
              <h1 className="nazev">Data se nenačetla</h1>
            </div>
          </div>

          <div className="hlaska zle" style={{ marginTop: 0 }}>
            {zprava}
          </div>

          <p className="pozn">
            Deník se schválně neotevřel prázdný. Prázdný deník vypadá jako
            ztracená data a první uložení by ta skutečná v databázi přepsalo.
            V databázi je zatím všechno tak, jak to bylo.
          </p>

          <div className="rada" style={{ marginTop: 14 }}>
            <button className="btn" onClick={znovu}>
              Zkusit znovu
            </button>
            <button className="btn2" onClick={odhlas}>
              Odhlásit se
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function spocitej(data) {
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

function Zalozky({ taby, tab, setTab, ceka }) {
  const pas = useRef(null);

  const posun = (smer) => {
    if (pas.current) pas.current.scrollBy({ left: smer * 220, behavior: "smooth" });
  };

  useEffect(() => {
    const p = pas.current;
    if (!p) return;
    const el = p.querySelector('[data-a="1"]');
    if (!el) return;
    p.scrollTo({
      left: Math.max(0, el.offsetLeft - (p.clientWidth - el.offsetWidth) / 2),
      behavior: "smooth",
    });
  }, [tab]);

  return (
    <>
      <div className="zalozkyBlok">
        <button className="zalSip" onClick={() => posun(-1)} aria-label="Předchozí záložky">
          ‹
        </button>
        <div className="zalPas" ref={pas}>
          {taby.map(([id, l, ikona]) => (
            <button
              key={id}
              className="zalKarta"
              data-a={tab === id ? "1" : "0"}
              data-poz={id === "schvalit" && ceka ? "1" : "0"}
              onClick={() => setTab(id)}
            >
              <Ik d={ikona} s={21} w={1.9} />
              <span>{l}</span>
            </button>
          ))}
        </div>
        <button className="zalSip" onClick={() => posun(1)} aria-label="Další záložky">
          ›
        </button>
      </div>
      <div className="zalTecky" aria-hidden="true">
        {taby.map(([id]) => (
          <i key={id} data-a={tab === id ? "1" : "0"} />
        ))}
      </div>
    </>
  );
}

function Denik({ data, uloz, tab, setTab, chyba, odhlas }) {
  const v = spocitej(data);
  const cekajiciSeznam = (data.cekajici || []).filter((z) => z.stav === "ceka");
  const kRozpaduPocet = (data.polozky || []).filter((p) => p.kRozpadu).length;
  const ceka = cekajiciSeznam.length + kRozpaduPocet;
  const [oknoVidet, setOknoVidet] = useState(ceka > 0);
  const dochazek = cekajiciSeznam.filter((z) => z.druh === "dochazka").length;
  const faktur = ceka - dochazek;
  const taby = [
    ["prehled", "Přehled", IKO.dum, "Kolik zbývá, kolik je hotovo a jak jste na tom proti plánu"],
    ["delnik", data.delnik.jmeno || DEFAULT.delnik.jmeno, IKO.kladivo, "Hodiny, platby, dluh a materiál — všechno kolem " + (data.delnik.jmeno || DEFAULT.delnik.jmeno)],
    ["schvalit", ceka ? `Ke schválení (${ceka})` : "Ke schválení", IKO.fajfka, "Co " + (data.delnik.jmeno || DEFAULT.delnik.jmeno) + " poslal a čeká na vaše potvrzení"],
    ["ukoly", "Rozpočet", IKO.strecha, "Dva pohledy: rozpočet k hypotéce po pracech a rozpočet dotace po opatřeních"],
    ["vydaje", "Výdaje", IKO.ucet, "Kniha všech výdajů, archiv vyfocených faktur a rozpad podle materiálu"],
    ["nastaveni", "Nastavení", IKO.nastaveni, "Zdroje peněz, sazby, jména a úklid dat"],
  ];
  const aktivni = taby.find((t) => t[0] === tab);

  return (
    <div className="sd">
      <style>{CSS}</style>
      <div className="wrap">
        <header className="hlava">
          <div className="znacka">
            <span className="mark">
              <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.4 10.4 12 3.6l7.6 6.8v9.6H4.4z" fill="#fff" stroke="#D8CDB6" strokeWidth="1" />
                <path d="M2.6 11 12 2.6l9.4 8.4" fill="none" stroke="#B4562A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="9.1" y="7.4" width="2.1" height="2.4" fill="#0C3B2E" />
                <rect x="12.2" y="7.4" width="2.1" height="2.4" fill="#0C3B2E" />
                <rect x="6.6" y="12.6" width="3.5" height="4" fill="#0C3B2E" />
                <rect x="13.4" y="12.6" width="3.5" height="4" fill="#0C3B2E" />
                <path d="M4.4 18.4h15.2v1.6H4.4z" fill="#C9AE85" />
              </svg>
            </span>
            <div>
              <div className="eyebrow">
                Stavební deník{data.misto ? " · " + data.misto : ""}
              </div>
              <h1 className="nazev">{data.nazev}</h1>
            </div>
          </div>
        </header>
        {ceka > 0 && (
          <div className="pozor">
            <span className="pozorik">
              <Ik d={IKO.kladivo} c="#0C3B2E" s={18} w={2.1} />
            </span>
            <span className="pozortext">
              <b>
                Hej, {data.delnik.jmeno} něco chce — {ceka}{" "}
                {ceka === 1 ? "zápis" : ceka < 5 ? "zápisy" : "zápisů"} čeká na
                schválení.
              </b>
            </span>
            <button className="pozorbtn" onClick={() => setTab("schvalit")}>
              Podívat se
            </button>
          </div>
        )}

        <Zalozky taby={taby} tab={tab} setTab={setTab} ceka={ceka} />
        {aktivni && <p className="tabpopis">{aktivni[3]}</p>}
        {ULOZISTE.rezim === "prohlizec" && (
          <div className="hlaska zle">
            <b>Data se ukládají jen v tomhle prohlížeči.</b> Ostatní zařízení je
            neuvidí. Pro sdílení je potřeba doplnit připojení k databázi — návod
            je v souboru NAVOD.md.
          </div>
        )}
        {chyba && (
          <p className="pozn" style={{ color: "#B03A2E" }}>
            {chyba}
          </p>
        )}
        {tab === "prehled" && <Prehled data={data} v={v} uloz={uloz} />}
        {tab === "ukoly" && <RozpocetSekce data={data} uloz={uloz} v={v} />}
        {tab === "vydaje" && <VydajeSekce data={data} uloz={uloz} v={v} />}
        {tab === "schvalit" && <Schvalovani data={data} uloz={uloz} />}
        {tab === "delnik" && <Delnik data={data} uloz={uloz} v={v} />}
        {tab === "nastaveni" && <Nastaveni data={data} uloz={uloz} odhlas={odhlas} />}

        {oknoVidet && ceka > 0 && (
          <div className="modal" onClick={() => setOknoVidet(false)}>
            <div className="modalkarta" onClick={(e) => e.stopPropagation()}>
              <span className="modalik">
                <Ik d={IKO.kladivo} c="#B46617" s={30} w={1.9} />
              </span>
              <h2 className="modalnadpis">
                Hej, {data.delnik.jmeno} něco chce!
              </h2>
              <p className="modaltext">
                Čeká{ceka === 1 ? "" : "jí"} na tebe {ceka}{" "}
                {ceka === 1 ? "zápis" : ceka < 5 ? "zápisy" : "zápisů"}
                {dochazek > 0 && faktur > 0
                  ? ` — ${dochazek}× docházka a ${faktur}× faktura`
                  : dochazek > 0
                  ? " — docházka"
                  : " — faktura za materiál"}
                . Dokud to neschválíš, do rozpočtu se nic nezapíše.
              </p>
              <div className="rada" style={{ marginTop: 18 }}>
                <button
                  className="btn"
                  onClick={() => {
                    setTab("schvalit");
                    setOknoVidet(false);
                  }}
                >
                  Projít zápisy
                </button>
                <button className="btn2" onClick={() => setOknoVidet(false)}>
                  Později
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const IKO = {
  dum: "M3 10.6 12 3.2l9 7.4M5.6 9.4V20.4h12.8V9.4M9.9 20.4v-5.2h4.2v5.2",
  bankovka:
    "M2.6 6.4h18.8v11.2H2.6zM15.2 12a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0M5.8 9.4h.02M18.2 14.6h.02",
  mince:
    "M4.5 7.5c0-1.4 3.4-2.5 7.5-2.5s7.5 1.1 7.5 2.5-3.4 2.5-7.5 2.5S4.5 8.9 4.5 7.5M4.5 7.5v9c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-9M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5",
  stit: "M12 3.2 4.8 6v5.6c0 4.4 3 8.2 7.2 9.2 4.2-1 7.2-4.8 7.2-9.2V6zM9.3 12.1l2 2 3.5-3.7",
  kladivo:
    "M14.4 3.6 20.4 9.6 17.6 12.4 11.6 6.4zM12.6 7.4 4.4 15.6a2 2 0 0 0 0 2.8l1.2 1.2a2 2 0 0 0 2.8 0l8.2-8.2",
  ucet: "M5.6 2.9h12.8v18.2l-2.1-1.5-2.1 1.5-2.2-1.5-2.1 1.5-2.1-1.5-2.2 1.5zM8.7 7.6h6.6M8.7 11.6h6.6M8.7 15.6h3.9",
  fajfka: "M4.8 12.6 9.6 17.4 19.2 6.6",
  hodiny: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 6.9V12l3.4 2",
  krouzek: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  osoba: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4.8 20.4c0-3.6 3.2-6.2 7.2-6.2s7.2 2.6 7.2 6.2",
  graf: "M4.6 19.6V9.9M10.2 19.6V4.6M15.8 19.6v-7.1M21.4 19.6V7.2",
  plus: "M12 4.9v14.2M4.9 12h14.2",
  nastaveni: "M5 4.6v14.8M12 4.6v14.8M19 4.6v14.8M2.6 8.8h4.8M9.6 14.4h4.8M16.6 7.6h4.8",
  zamek: "M6.4 10.4V7.6a5.6 5.6 0 0 1 11.2 0v2.8M4.8 10.4h14.4a1.2 1.2 0 0 1 1.2 1.2v8a1.2 1.2 0 0 1-1.2 1.2H4.8a1.2 1.2 0 0 1-1.2-1.2v-8a1.2 1.2 0 0 1 1.2-1.2zM12 14.6v3",
  oko: "M1.8 12S5.4 5.2 12 5.2 22.2 12 22.2 12 18.6 18.8 12 18.8 1.8 12 1.8 12zM12 15.1a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2z",
  okoSkrt: "M9.6 5.6A9.6 9.6 0 0 1 12 5.2c6.6 0 10.2 6.8 10.2 6.8a18 18 0 0 1-2.9 3.9M6.5 7.3A17.6 17.6 0 0 0 1.8 12S5.4 18.8 12 18.8c1.4 0 2.7-.3 3.8-.8M9.9 9.9a3.1 3.1 0 0 0 4.3 4.3M3.2 3.2l17.6 17.6",
  banka: "M2.9 9.4 12 4.2l9.1 5.2M4.8 9.8v8.8M9.6 9.8v8.8M14.4 9.8v8.8M19.2 9.8v8.8M2.6 20.4h18.8",
  darek: "M3.4 8.6h17.2v3.6H3.4zM4.9 12.2v8.2h14.2v-8.2M12 8.6v11.8M12 8.6c-1.4 0-3.4-.4-3.9-1.6-.5-1.2.6-2.6 1.9-2.3 1.3.3 2 2.3 2 3.9M12 8.6c1.4 0 3.4-.4 3.9-1.6.5-1.2-.6-2.6-1.9-2.3-1.3.3-2 2.3-2 3.9",
  okno: "M4.6 3.9h14.8v16.2H4.6zM12 3.9v16.2M4.6 12h14.8M3.2 3.9h17.6",
  strecha: "M2.6 12.4 12 4.2l9.4 8.2M5.4 11.2v8.6h13.2v-8.6",
  kamen: "M3.4 7.4h17.2v9.2H3.4zM3.4 12h17.2M9.2 7.4V12M14.8 12v4.6",
};

function VyberKategorie({ ukoly, hodnota, onZmena, onNova, placeholder = "začni psát…" }) {
  const nazevZ = (id) => (ukoly.find((u) => u.id === id) || {}).nazev || "";
  const [text, setText] = useState(() => nazevZ(hodnota));
  const [otevreno, setOtevreno] = useState(false);

  useEffect(() => {
    setText(nazevZ(hodnota));
  }, [hodnota]);

  const dotaz = text.trim().toLowerCase();
  const presnaShoda = ukoly.find((u) => u.nazev.toLowerCase() === dotaz);
  const navrhy = dotaz
    ? ukoly.filter((u) => u.nazev.toLowerCase().includes(dotaz))
    : ukoly;

  const vyber = (u) => {
    onZmena(u.id);
    setText(u.nazev);
    setOtevreno(false);
  };

  return (
    <div className="combo">
      <input
        className="mini"
        value={text}
        placeholder={placeholder}
        style={{ borderColor: hodnota ? undefined : "#B03A2E" }}
        onFocus={() => setOtevreno(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOtevreno(true);
          if (hodnota) onZmena("");
        }}
        onBlur={() =>
          setTimeout(() => {
            setOtevreno(false);
            if (presnaShoda) vyber(presnaShoda);
            else setText(nazevZ(hodnota));
          }, 160)
        }
      />
      {otevreno && (
        <div className="combolist">
          {navrhy.length === 0 && !onNova && (
            <div className="comboprazdno">Nic takového tu není.</div>
          )}
          {navrhy.slice(0, 40).map((u) => (
            <button
              key={u.id}
              type="button"
              className="comboitem"
              onMouseDown={(e) => {
                e.preventDefault();
                vyber(u);
              }}
            >
              {u.nazev}
              {u.odhad ? (
                <span className="comboodhad n"> {kc(u.odhad)}</span>
              ) : null}
            </button>
          ))}
          {onNova && dotaz && !presnaShoda && (
            <button
              type="button"
              className="comboitem nova"
              onMouseDown={(e) => {
                e.preventDefault();
                setOtevreno(false);
                onNova(text.trim());
              }}
            >
              + založit „{text.trim()}" jako novou kategorii
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Doklad({ p, zaklad }) {
  const odkaz = odkazDokladu(p, zaklad);
  if (!p.dodavatel && !p.cisloDokladu && !p.poznamka && !odkaz) return null;
  return (
    <span className="dokladR">
      {p.dodavatel && <b>{p.dodavatel}</b>}
      {p.cisloDokladu && <span className="n"> · doklad {p.cisloDokladu}</span>}
      {odkaz && (
        <>
          {" · "}
          <a
            className="origOdkaz"
            href={odkaz}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            otevřít originál
          </a>
        </>
      )}
      {p.poznamka && <em> · {p.poznamka}</em>}
    </span>
  );
}

// Běžně stačí nenápadné ×. Tam, kde stojí vedle velkých tlačítek a dalo by
// se přehlédnout, se dá zapnout tlacitko a vykreslí se s popiskem.
function Smazat({ onSmaz, co = "tento záznam", popisek = "Smazat", tlacitko = false }) {
  const [ptam, setPtam] = useState(false);
  if (!ptam)
    return tlacitko ? (
      <button className="btn2" onClick={() => setPtam(true)}>
        {popisek}
      </button>
    ) : (
      <button className="x" onClick={() => setPtam(true)} aria-label={popisek}>
        ×
      </button>
    );
  return (
    <span className="potvrz">
      <span className="potvrzT">Opravdu smazat {co}?</span>
      <button className="potvrzAno" onClick={onSmaz}>
        Ano, smazat
      </button>
      <button className="potvrzNe" onClick={() => setPtam(false)}>
        Ne
      </button>
    </span>
  );
}

function Ik({ d, s = 20, c = "currentColor", w = 1.8 }) {
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth={w}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

function PrstenHotovo({ pct }) {
  const r = 46;
  const o = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  const uhel = (p / 100) * 2 * Math.PI - Math.PI / 2;
  return (
    <svg className="heroPrsten" viewBox="0 0 120 120" role="img"
      aria-label={`Hotovo ${Math.round(p)} procent`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,.13)" strokeWidth="9" />
      <circle cx="60" cy="60" r={r} fill="none" stroke="#6D9773" strokeWidth="9"
        strokeLinecap="round" strokeDasharray={`${(p / 100) * o} ${o}`}
        transform="rotate(-90 60 60)"
        style={{ transition: "stroke-dasharray .7s cubic-bezier(.2,.8,.2,1)" }} />
      <circle cx={60 + r * Math.cos(uhel)} cy={60 + r * Math.sin(uhel)} r="7" fill="#FFBA00" />
      <text x="60" y="59" textAnchor="middle" fontSize="24" fill="#fff" fontWeight="800">
        {Math.round(p)}%
      </text>
      <text x="60" y="76" textAnchor="middle" fontSize="10" fill="#FFBA00"
        letterSpacing="1.5" fontWeight="800">
        HOTOVO
      </text>
    </svg>
  );
}

function Prsten({ pct, popis = "UTRACENO" }) {
  const r = 50;
  const obvod = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * obvod;
  return (
    <svg className="prsten" viewBox="0 0 120 120" role="img" aria-label={`${popis}: ${Math.round(pct)} procent`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="13" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke={pct > 100 ? "#B03A2E" : "#FFBA00"}
        strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${obvod}`}
        transform="rotate(-90 60 60)"
        className="prstenk"
        style={{ transition: "stroke-dasharray .7s cubic-bezier(.2,.8,.2,1)" }}
      />
      <text x="60" y="58" textAnchor="middle" fontSize="27" fill="#fff" fontWeight="800">
        {Math.round(pct)}%
      </text>
      <text x="60" y="77" textAnchor="middle" fontSize="10" fill="#8FB396" letterSpacing="1.4" fontWeight="700">
        {popis}
      </text>
    </svg>
  );
}

const STENA = {
  A: [112, 76],
  B: [278, 90],
  C: [112, 160],
  D: [278, 134],
};

function bodSteny(t, f) {
  const { A, B, C, D } = STENA;
  const tx = A[0] + t * (B[0] - A[0]);
  const ty = A[1] + t * (B[1] - A[1]);
  const bx = C[0] + t * (D[0] - C[0]);
  const by = C[1] + t * (D[1] - C[1]);
  return [tx + f * (bx - tx), ty + f * (by - ty)];
}

function ctverec(t1, t2, f1, f2) {
  return [
    bodSteny(t1, f1),
    bodSteny(t2, f1),
    bodSteny(t2, f2),
    bodSteny(t1, f2),
  ]
    .map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1))
    .join(" ");
}

function OknoBok({ t1, t2, f1, f2, sviti }) {
  const stred = (t1 + t2) / 2;
  return (
    <g>
      <polygon
        points={ctverec(t1 - 0.016, t2 + 0.016, f1 - 0.055, f2 + 0.055)}
        fill="#E6D9C0"
        stroke="#C9AE85"
        strokeWidth="0.8"
      />
      <polygon
        className="okno"
        points={ctverec(t1, t2, f1, f2)}
        fill={sviti ? "#FFBA00" : "#0C3B2E"}
      />
      <polygon
        points={ctverec(stred - 0.004, stred + 0.004, f1, f2)}
        fill={sviti ? "#0C3B2E" : "#2C5C4B"}
      />
    </g>
  );
}

function OknoStit({ x, y, w, h, sviti, ostena = true }) {
  return (
    <g>
      {ostena && (
        <rect
          x={x - 4.5}
          y={y - 4}
          width={w + 9}
          height={h + 8}
          rx="1"
          fill="#E6D9C0"
          stroke="#C9AE85"
          strokeWidth="0.9"
        />
      )}
      <rect
        className="okno"
        x={x}
        y={y}
        width={w}
        height={h}
        fill={sviti ? "#FFBA00" : "#0C3B2E"}
      />
      <path
        d={`M${x + w / 2} ${y}V${y + h}`}
        stroke={sviti ? "#0C3B2E" : "#2C5C4B"}
        strokeWidth="1.8"
      />
    </g>
  );
}

function Domek({ hotovo, celkem }) {
  const pocet = 7;
  const sviti = celkem ? Math.round((hotovo / celkem) * pocet) : 0;
  const on = (i) => i < sviti;

  return (
    <figure className="dumblok">
      <svg viewBox="0 0 300 196" role="img" aria-label={`Náš dům — ${hotovo} z ${celkem} úkolů hotovo`}>
        {/* dlouhá boční stěna */}
        <polygon points="112,76 278,90 278,134 112,160" fill="#FFFFFF" />
        <polygon points="112,148 278,126 278,134 112,160" fill="#C9AE85" />
        <polygon points="112,76 278,90 278,134 112,160" fill="none" stroke="#D8CDB6" strokeWidth="1" />

        {/* štítová stěna */}
        <polygon points="36,150 112,160 112,76 74,36 36,70" fill="#F8F5EE" />
        <polygon points="36,140 112,148 112,160 36,150" fill="#BFA478" />
        <polygon points="36,150 112,160 112,76 74,36 36,70" fill="none" stroke="#D8CDB6" strokeWidth="1" />

        {/* okna v boční stěně */}
        <OknoBok t1={0.07} t2={0.17} f1={0.3} f2={0.62} sviti={on(3)} />
        <OknoBok t1={0.25} t2={0.34} f1={0.3} f2={0.62} sviti={on(4)} />
        <OknoBok t1={0.56} t2={0.64} f1={0.31} f2={0.62} sviti={on(5)} />
        <OknoBok t1={0.71} t2={0.78} f1={0.32} f2={0.62} sviti={on(6)} />

        {/* dveře a schody */}
        <polygon
          points={ctverec(0.4, 0.485, 0.2, 0.9)}
          fill="#E6D9C0"
          stroke="#C9AE85"
          strokeWidth="0.8"
        />
        <polygon points={ctverec(0.412, 0.473, 0.25, 0.88)} fill="#0C3B2E" />
        <polygon points={ctverec(0.395, 0.5, 0.9, 1.06)} fill="#D9D2C4" />
        <polygon points={ctverec(0.4, 0.495, 1.0, 1.14)} fill="#CFC7B6" />

        {/* okna ve štítu */}
        <OknoStit x={56} y={52} w={13} h={14} sviti={on(1)} ostena={false} />
        <OknoStit x={74} y={54} w={13} h={14} sviti={on(2)} ostena={false} />
        <rect x="50" y="46" width="45" height="27" rx="1" fill="none" stroke="#C9AE85" strokeWidth="2.4" />
        <OknoStit x={58} y={100} w={30} h={30} sviti={on(0)} />

        {/* domovní číslo */}
        <rect x="96" y="88" width="12" height="9" rx="1.5" fill="#B03A2E" />
        <text x="102" y="95" textAnchor="middle" fontSize="6.5" fill="#fff" fontWeight="700">
          45
        </text>

        {/* střecha — pálená krytina */}
        <polygon points="74,30 250,62 286,92 106,72" fill="#B4562A" />
        <polygon points="74,30 250,62 286,92 106,72" fill="none" stroke="#8C3F1C" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M96 67 262 82" stroke="#8C3F1C" strokeWidth="1" opacity=".55" />
        <path d="M86 55 256 72" stroke="#8C3F1C" strokeWidth="1" opacity=".45" />
        <path d="M80 43 253 66" stroke="#8C3F1C" strokeWidth="1" opacity=".35" />
        <path d="M106 72 286 92" stroke="#7A3416" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M28 66 74 26 120 74" fill="none" stroke="#8C3F1C" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M28 66 74 26 120 74" fill="none" stroke="#B4562A" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />

        {/* komín a svod */}
        <rect x="188" y="24" width="13" height="26" rx="1" fill="#E6D9C0" stroke="#C9AE85" strokeWidth="1" />
        <rect x="185" y="21" width="19" height="5" rx="1.5" fill="#B4562A" />
        <path d="M116 74V162" stroke="#B9BEBB" strokeWidth="2.6" strokeLinecap="round" />

        {/* terén */}
        <path
          d="M22 154 112 165 288 137"
          fill="none"
          stroke="#C9AE85"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M20 152c5-12 11-12 16 0" fill="none" stroke="#6D9773" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M262 140c6-10 13-10 19 0" fill="none" stroke="#6D9773" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M292 138c4-8 9-8 13 0" fill="none" stroke="#8FB396" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <figcaption>
        {celkem ? `${hotovo} z ${celkem} úkolů hotovo` : "Přidej první úkol"}
      </figcaption>
    </figure>
  );
}

function Lat({ dostupne, cerpano, celkem }) {
  if (!celkem)
    return (
      <p className="heropod" style={{ marginTop: 14 }}>
        V Nastavení zadej zdroje a částku, která padla na koupi domu.
      </p>
    );
  const klice = Object.keys(ZDROJ).filter((k) => dostupne[k] > 0);
  return (
    <div className="lat">
      <div className="latbar">
        {klice.map((k) => {
          const limit = dostupne[k];
          const pct = Math.min(100, (cerpano[k] / limit) * 100);
          const pres = cerpano[k] > limit;
          return (
            <div
              key={k}
              className="latseg"
              style={{ flexGrow: limit }}
              title={`${ZDROJ[k].label}: ${kc(cerpano[k])} z ${kc(limit)}`}
            >
              <div className="latbg" style={{ background: ZDROJ[k].barva }} />
              <div
                className="latfill"
                style={{ width: pct + "%", background: pres ? "#B03A2E" : ZDROJ[k].barva }}
              />
            </div>
          );
        })}
      </div>
      <div className="latpopis">
        {klice.map((k) => (
          <div key={k} className="latitem" style={{ flexGrow: dostupne[k] }}>
            <span className="lbl">
              <i className="tec" style={{ background: ZDROJ[k].barva }} />
              {ZDROJ[k].label}
            </span>
            <b className="n">{kc(cerpano[k])}</b>
            <span className="z n">z {kc(dostupne[k])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dlazdice({ ikona, barva, pozadi, popis, hodnota, pod }) {
  return (
    <div className="dl">
      <div className="ikonka" style={{ background: pozadi }}>
        <Ik d={ikona} c={barva} s={20} />
      </div>
      <small>{popis}</small>
      <b className="n" style={{ color: barva }}>
        {hodnota}
      </b>
      {pod && <em>{pod}</em>}
    </div>
  );
}

function Vyrovnani({ data, uloz, rozdil }) {
  const [otevreno, setOtevreno] = useState(false);
  const [ukol, setUkol] = useState("");
  const [zdroj, setZdroj] = useState("hypoteka");
  const [popis, setPopis] = useState("Drobný materiál a nářadí bez dokladu");
  const chybi = -rozdil;

  const zapis = () => {
    let ukoly = data.ukoly;
    let cilovy = ukol;
    if (!cilovy) {
      const existuje = ukoly.find(
        (u) => u.nazev.toLowerCase() === "drobný materiál a nářadí"
      );
      if (existuje) cilovy = existuje.id;
      else {
        cilovy = uid();
        ukoly = [
          ...ukoly,
          {
            id: cilovy,
            nazev: "Drobný materiál a nářadí",
            odhad: 0,
            skupina: "Ostatní",
            stav: "probiha",
            typ: "pridano",
          },
        ];
      }
    }
    uloz({
      ...data,
      ukoly,
      polozky: [
        ...data.polozky,
        {
          id: uid(),
          datum: (data.kontrola && data.kontrola.datum) || dnes(),
          popis: popis.trim() || "Vyrovnání podle zůstatku",
          tema: "Materiál (obecný)",
          ukol: cilovy,
          castka: chybi,
          zdroj,
          pres: false,
          dolozeno: false,
          proplaceno: true,
        },
      ],
    });
    setOtevreno(false);
  };

  if (!otevreno)
    return (
      <div className="rada">
        <button className="btn2" onClick={() => setOtevreno(true)}>
          Zapsat chybějících {kc(chybi)} jako výdaj bez dokladu
        </button>
      </div>
    );

  return (
    <div className="hlaska" style={{ marginTop: 14 }}>
      <div className="form">
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Za co to nejspíš bylo</label>
          <input value={popis} onChange={(e) => setPopis(e.target.value)} />
        </div>
        <div className="pole">
          <label>Kategorie</label>
          <VyberKategorie
            ukoly={data.ukoly}
            hodnota={ukol}
            onZmena={setUkol}
            placeholder="nechat prázdné = drobnosti"
          />
        </div>
        <div className="pole">
          <label>Placeno z</label>
          <select value={zdroj} onChange={(e) => setZdroj(e.target.value)}>
            {Object.entries(ZDROJ).map(([k, z]) => (
              <option key={k} value={k}>
                {z.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="rada">
        <button className="btn" onClick={zapis}>
          Zapsat {kc(chybi)}
        </button>
        <button className="btn2" onClick={() => setOtevreno(false)}>
          Zrušit
        </button>
      </div>
      <p className="pozn">
        Zapíše se jako výdaj bez dokladu, takže do podkladů k dotaci nespadne.
        Když kategorii nevybereš, založí se „Drobný materiál a nářadí".
      </p>
    </div>
  );
}

function Nastenka({ data, uloz }) {
  const [novy, setNovy] = useState({ text: "", termin: "", ukolId: "" });
  const vse = data.upominky || [];
  const otevrene = vse
    .filter((z) => !z.hotovo)
    .sort((a, b) => {
      if (!a.termin) return 1;
      if (!b.termin) return -1;
      return a.termin < b.termin ? -1 : 1;
    });
  const hotove = vse.filter((z) => z.hotovo).slice(-5);
  const poTerminu = otevrene.filter((z) => z.termin && z.termin < dnes()).length;

  const pridej = () => {
    const t = novy.text.trim();
    if (!t) return;
    uloz({
      ...data,
      upominky: [
        ...vse,
        {
          id: uid(),
          text: t,
          ukolId: novy.ukolId || null,
          termin: novy.termin,
          hotovo: false,
          vytvoreno: dnes(),
        },
      ],
    });
    setNovy({ text: "", termin: "", ukolId: "" });
  };

  return (
    <div className="box" style={{ borderLeft: "5px solid #FFBA00" }}>
      <h2 className="boxh">
        <span className="hi">
          <i style={{ background: "#FFF2D0" }}>
            <Ik d={IKO.fajfka} c="#8A6100" s={16} />
          </i>
          K vyřízení
        </span>
        <span>
          {otevrene.length === 0
            ? "nic nečeká"
            : `${otevrene.length} otevřených${poTerminu ? ` · ${poTerminu} po termínu` : ""}`}
        </span>
      </h2>

      {otevrene.length > 0 && (
        <div className="upominkySeznam">
          {otevrene.map((z) => (
            <Upominka key={z.id} z={z} data={data} uloz={uloz} sKategorii />
          ))}
        </div>
      )}

      <div className="form" style={{ marginTop: otevrene.length ? 14 : 0 }}>
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Co je potřeba vyřídit</label>
          <input
            value={novy.text}
            placeholder="např. zavolat na SFŽP kvůli dokladům"
            onChange={(e) => setNovy({ ...novy, text: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && pridej()}
          />
        </div>
        <div className="pole">
          <label>Ke kategorii</label>
          <VyberKategorie
            ukoly={data.ukoly}
            hodnota={novy.ukolId}
            onZmena={(id) => setNovy({ ...novy, ukolId: id })}
            placeholder="nepovinné"
          />
        </div>
        <div className="pole">
          <label>Do kdy</label>
          <input
            type="date"
            value={novy.termin}
            onChange={(e) => setNovy({ ...novy, termin: e.target.value })}
          />
        </div>
        <button className="btn" onClick={pridej} disabled={!novy.text.trim()}>
          Přidat
        </button>
      </div>

      {hotove.length > 0 && (
        <>
          <h3 className="eyebrow" style={{ marginTop: 18, marginBottom: 8 }}>
            Nedávno vyřízené
          </h3>
          <div className="upominkySeznam">
            {hotove.map((z) => (
              <Upominka key={z.id} z={z} data={data} uloz={uloz} sKategorii />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Prehled({ data, v, uloz }) {
  const plan = v.odhadPuvodni + v.odhadPridany;
  const hotovoPct = plan ? (v.hotovoHodnota / plan) * 100 : 0;
  const posledni = [...data.polozky]
    .sort((a, b) => (a.datum < b.datum ? 1 : -1))
    .slice(0, 6);
  const pocty = {
    hotovo: data.ukoly.filter((u) => u.stav === "hotovo").length,
    probiha: data.ukoly.filter((u) => u.stav === "probiha").length,
    plan: data.ukoly.filter((u) => u.stav === "plan").length,
  };
  const zaklad = Math.max(plan, v.utraceno, 1);
  const probihaji = data.ukoly.filter((u) => u.stav === "probiha");

  return (
    <>
      <div className="heroV">
        <div className="heroVrch">
          <div className="heroText">
            <div className="eyebrow" style={{ color: "#FFBA00" }}>
              Zbývá k dispozici
            </div>
            <div className="heroCislo n">{kc(v.zbyva)}</div>
            <div className="heroPod">
              z {kc(v.celkem)} po odečtení koupě domu — reálně volné {kc(v.volne)}
            </div>
            <div className="heroUkoly">
              {pocty.hotovo} z {data.ukoly.length} úkolů hotovo
            </div>
          </div>
          <PrstenHotovo pct={hotovoPct} />
          <figure className="heroDum">
            <img src={DUM_OBRAZEK} alt={data.misto ? "Dům — " + data.misto : "Dům"} />
            <figcaption>
              {pocty.hotovo} z {data.ukoly.length} úkolů hotovo
            </figcaption>
          </figure>
        </div>

        <div className="heroPruh">
          {Object.keys(ZDROJ)
            .filter((k) => v.dostupne[k] > 0)
            .map((k) => {
              const pct = Math.min(100, (v.cerpano[k] / v.dostupne[k]) * 100);
              return (
                <span
                  key={k}
                  className="heroSeg"
                  style={{ flexGrow: v.dostupne[k] }}
                  title={`${ZDROJ[k].label}: vyčerpáno ${kc(v.cerpano[k])} z ${kc(v.dostupne[k])}`}
                >
                  <i style={{ width: pct + "%", background: ZDROJ[k].barva }} />
                </span>
              );
            })}
        </div>
        <div className="heroPruhPopis">
          <span>
            Vyčerpáno <b className="n">{kc(v.utraceno)}</b> z {kc(v.celkem)}
          </span>
          <span>
            {v.celkem ? Math.round((v.utraceno / v.celkem) * 100) : 0} %
          </span>
        </div>

        <div className="heroZdroje">
          {Object.keys(ZDROJ)
            .filter((k) => v.dostupne[k] > 0)
            .map((k) => {
              const zbyva = v.dostupne[k] - v.cerpano[k];
              const pct = Math.min(100, (v.cerpano[k] / v.dostupne[k]) * 100);
              const zluty = k === "dotace";
              return (
                <div className="zdrojKarta" key={k}>
                  <span
                    className="zdrojIkona"
                    style={{ background: zluty ? "rgba(255,186,0,.14)" : "rgba(109,151,115,.16)" }}
                  >
                    <Ik d={zluty ? IKO.darek : IKO.banka}
                      c={zluty ? "#FFBA00" : "#8FB396"} s={26} w={1.7} />
                  </span>
                  <span className="zdrojText">
                    <small style={{ color: zluty ? "#FFBA00" : "#8FB396" }}>
                      {ZDROJ[k].label}
                    </small>
                    <b className="n">
                      {kc(zbyva)} <em>zbývá</em>
                    </b>
                    <span className="zdrojPruh">
                      <i style={{ width: pct + "%", background: ZDROJ[k].barva }} />
                    </span>
                    <span className="zdrojPod n">
                      vyčerpáno {kc(v.cerpano[k])} z {kc(v.dostupne[k])} · {Math.round(pct)} %
                    </span>
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      {(data.faktury || []).filter((f) => f.mafoto && !f.naDisku).length > 0 && (
        <div className="box" style={{ borderLeft: "5px solid #FFBA00" }}>
          <h2 className="boxh">
            <span className="hi">
              <i style={{ background: "#FFF2D0" }}>
                <Ik d={IKO.foto} c="#8A6100" s={16} />
              </i>
              Stáhnout faktury na Disk
            </span>
            <span>
              {(data.faktury || []).filter((f) => f.mafoto && !f.naDisku).length} čeká
            </span>
          </h2>
          <p className="pozn" style={{ marginTop: 0, marginBottom: 12 }}>
            Vyfocené doklady zatím leží jen v databázi. Ve Výdajích pod záložkou
            Archiv faktur je stáhneš, nahraješ na Disk a odškrtneš.
          </p>
          <ul className="diskSeznam">
            {(data.faktury || [])
              .filter((f) => f.mafoto && !f.naDisku)
              .sort((a, b) => (a.datum < b.datum ? 1 : -1))
              .slice(0, 6)
              .map((f) => (
                <li key={f.id}>
                  <b>{f.dodavatel || "Bez názvu"}</b>
                  <span className="n">
                    {datumCz(f.datum)}
                    {f.cislo ? " · " + f.cislo : ""}
                  </span>
                  <span className="n" style={{ fontWeight: 800 }}>{kc(f.celkem || 0)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <Nastenka data={data} uloz={uloz} />

      {probihaji.length > 0 && (
        <div className="box">
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.hodiny} c="#0C3B2E" s={16} />
              </i>
              Právě se dělá
            </span>
            <span>{probihaji.length} rozdělaných</span>
          </h2>
          <table className="t">
            <tbody>
              {probihaji.map((u) => {
                const sk = v.skutUkol[u.id] || 0;
                const roz = (u.odhad || 0) - sk;
                const pct = u.odhad ? Math.min(100, (sk / u.odhad) * 100) : 0;
                return (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 700 }}>{u.nazev}</td>
                    <td style={{ width: "26%" }}>
                      <div className="pruh">
                        <i
                          style={{
                            width: pct + "%",
                            background: roz < 0 ? "#B03A2E" : "#6D9773",
                          }}
                        />
                      </div>
                    </td>
                    <td className="r n nowrap">{kc(sk)}</td>
                    <td className="r n nowrap" style={{ color: "#5E7268" }}>
                      z {kc(u.odhad)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.ukoly.length > 0 && (
        <div className="box">
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.graf} c="#0C3B2E" s={16} />
              </i>
              Stav kategorií
            </span>
            <span>{data.ukoly.length} celkem</span>
          </h2>
          <div className="stavy">
            <div className="stavc">
              <span className="znak" style={{ background: "#E4EDE5" }}>
                <Ik d={IKO.fajfka} c="#3E6B4C" s={14} w={2.4} />
              </span>
              <span>
                <b style={{ color: "#3E6B4C" }}>{pocty.hotovo}</b>
                <small>Hotovo</small>
              </span>
            </div>
            <div className="stavc">
              <span className="znak" style={{ background: "#F7E7D6" }}>
                <Ik d={IKO.hodiny} c="#B46617" s={14} w={2.1} />
              </span>
              <span>
                <b style={{ color: "#B46617" }}>{pocty.probiha}</b>
                <small>Probíhá</small>
              </span>
            </div>
            <div className="stavc">
              <span className="znak" style={{ background: "#EFE8D6" }}>
                <Ik d={IKO.krouzek} c="#8FA69A" s={14} w={2.1} />
              </span>
              <span>
                <b style={{ color: "#8FA69A" }}>{pocty.plan}</b>
                <small>Čeká</small>
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="dvojka">
        <div className="box" style={{ marginTop: 0 }}>
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.strecha} c="#0C3B2E" s={16} />
              </i>
              Plán proti realitě
            </span>
          </h2>
          <div className="srov">
            <div className="srovbar">
              <i
                style={{ width: (v.odhadPuvodni / zaklad) * 100 + "%", background: "#6D9773" }}
              />
              <i
                style={{ width: (v.odhadPridany / zaklad) * 100 + "%", background: "#FFBA00" }}
              />
            </div>
            <div className="srovbar" style={{ marginTop: 5 }}>
              <i
                style={{
                  width: (v.utraceno / zaklad) * 100 + "%",
                  background: v.utraceno > plan && plan ? "#B03A2E" : "#0C3B2E",
                }}
              />
            </div>
            <div className="srovleg">
              <span>
                <u style={{ background: "#6D9773" }} />
                Plán z hypotéky <b className="n">{kc(v.odhadPuvodni)}</b>
              </span>
              <span>
                <u style={{ background: "#FFBA00" }} />
                Přibylo <b className="n">{kc(v.odhadPridany)}</b>
              </span>
              <span>
                <u style={{ background: "#0C3B2E" }} />
                Utraceno <b className="n">{kc(v.utraceno)}</b>
              </span>
            </div>
          </div>
          <table className="t" style={{ marginTop: 14 }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700 }}>Aktuální plán</td>
                <td className="r n nowrap" style={{ fontWeight: 800 }}>
                  {kc(plan)}
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Rozdíl proti utracenému</td>
                <td
                  className="r n nowrap"
                  style={{ fontWeight: 800, color: v.utraceno > plan ? "#B03A2E" : "#3E6B4C" }}
                >
                  {plan ? (plan - v.utraceno >= 0 ? "+" : "") + kc(plan - v.utraceno) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="box" style={{ marginTop: 0 }}>
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.osoba} c="#0C3B2E" s={16} />
              </i>
              Vyrovnání — {data.delnik.jmeno}
            </span>
          </h2>
          <table className="t">
            <tbody>
              <tr>
                <td style={{ width: 24 }}>
                  <Ik d={IKO.kladivo} c="#6D9773" s={16} />
                </td>
                <td>Zbývá vyplatit za práci</td>
                <td className="r n nowrap" style={{ fontWeight: 800 }}>
                  {kc(v.zbyvaVyplatit)}
                </td>
              </tr>
              <tr>
                <td>
                  <Ik d={IKO.mince} c="#B03A2E" s={16} />
                </td>
                <td>Zbývá jeho dluh u vás</td>
                <td className="r n nowrap" style={{ fontWeight: 800, color: "#B03A2E" }}>
                  {kc(v.zbyvaDluh)}
                </td>
              </tr>
              <tr>
                <td>
                  <Ik d={IKO.ucet} c="#B46617" s={16} />
                </td>
                <td>Materiál bez účtenky</td>
                <td
                  className="r n nowrap"
                  style={{ fontWeight: 800, color: v.nedolozeno ? "#B46617" : undefined }}
                >
                  {kc(v.nedolozeno)}
                </td>
              </tr>
            </tbody>
          </table>
          {v.zbyvaVyplatit > 0 && v.zbyvaDluh > 0 && (
            <div className="hlaska dobre">
              Můžete si vzájemně započíst až{" "}
              <b className="n">{kc(Math.min(v.zbyvaVyplatit, v.zbyvaDluh))}</b>.
            </div>
          )}
        </div>
      </div>

      <div className="box">
        <h2 className="boxh">
          <span className="hi">
            <i>
              <Ik d={IKO.mince} c="#0C3B2E" s={16} />
            </i>
            Kontrola zůstatků
          </span>
          <span>
            {data.kontrola && data.kontrola.datum
              ? "k " + datumCz(data.kontrola.datum)
              : ""}
          </span>
        </h2>
        <table className="t">
          <tbody>
            <tr>
              <td>Podle deníku má být na účtech</td>
              <td className="r n nowrap" style={{ fontWeight: 800 }}>
                {kc(v.naUctu)}
              </td>
            </tr>
            <tr style={{ display: v.prijde > 0 ? undefined : "none" }}>
              <td>
                Dotace teprve přijde
                <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                  proplácí se zpětně po doložení
                </span>
              </td>
              <td className="r n nowrap" style={{ fontWeight: 800, color: "#8A6100" }}>
                {kc(v.prijde)}
              </td>
            </tr>
            <tr>
              <td colSpan={2} style={{ paddingTop: 6 }}>
                <div className="form" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))" }}>
                  <div className="pole">
                    <label>Zůstatek {popisUctu(data.kontrola, "A")}</label>
                    <input
                      className="n"
                      inputMode="decimal"
                      value={(data.kontrola && data.kontrola.ucetA) || ""}
                      onChange={(e) =>
                        uloz({
                          ...data,
                          kontrola: {
                            ...(data.kontrola || {}),
                            ucetA: e.target.value,
                            datum: (data.kontrola && data.kontrola.datum) || dnes(),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="pole">
                    <label>Zůstatek {popisUctu(data.kontrola, "B")}</label>
                    <input
                      className="n"
                      inputMode="decimal"
                      value={(data.kontrola && data.kontrola.ucetB) || ""}
                      onChange={(e) =>
                        uloz({
                          ...data,
                          kontrola: {
                            ...(data.kontrola || {}),
                            ucetB: e.target.value,
                            datum: (data.kontrola && data.kontrola.datum) || dnes(),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="pole">
                    <label>Ke dni</label>
                    <input
                      type="date"
                      value={(data.kontrola && data.kontrola.datum) || dnes()}
                      onChange={(e) =>
                        uloz({
                          ...data,
                          kontrola: { ...(data.kontrola || {}), datum: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
              </td>
            </tr>
            <tr style={{ borderTop: "2px solid #C9AE85" }}>
              <td style={{ fontWeight: 800, paddingTop: 11 }}>
                Skutečně na účtech dohromady
              </td>
              <td className="r n nowrap" style={{ fontWeight: 800, paddingTop: 11 }}>
                {zustatekCelkem(data.kontrola)
                  ? kc(zustatekCelkem(data.kontrola))
                  : "—"}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 800 }}>Rozdíl proti deníku</td>
              <td className="r n nowrap" style={{ fontWeight: 800 }}>
                {zustatekCelkem(data.kontrola) ? (
                  <span
                    style={{
                      color:
                        Math.abs(zustatekCelkem(data.kontrola) - v.naUctu) < 5000
                          ? "#3E6B4C"
                          : "#B46617",
                    }}
                  >
                    {zustatekCelkem(data.kontrola) - v.naUctu >= 0 ? "+" : ""}
                    {kc(zustatekCelkem(data.kontrola) - v.naUctu)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="pozn">
          Rozdíl je míra toho, jak přesně sedí deník s realitou. Když roste,
          někde chybí zápis — nebo se hypoteční a vlastní peníze na běžném účtu
          promíchaly víc, než deník tuší.
        </p>
        {zustatekCelkem(data.kontrola) > 0 &&
          zustatekCelkem(data.kontrola) - v.naUctu < -1 && (
            <Vyrovnani
              data={data}
              uloz={uloz}
              rozdil={zustatekCelkem(data.kontrola) - v.naUctu}
            />
          )}
      </div>

      <div className="box">
        <h2 className="boxh">
          <span className="hi">
            <i>
              <Ik d={IKO.ucet} c="#0C3B2E" s={16} />
            </i>
            Poslední výdaje
          </span>
          <span>{data.polozky.length} zápisů</span>
        </h2>
        {posledni.length === 0 ? (
          <p className="prazdno">Zatím prázdno. Vyfoť první fakturu v záložce Výdaje.</p>
        ) : (
          <table className="t">
            <tbody>
              {posledni.map((p) => {
                const u = data.ukoly.find((x) => x.id === p.ukol);
                return (
                  <tr key={p.id}>
                    <td className="n nowrap" style={{ color: "#5E7268" }}>
                      {datumCz(p.datum)}
                    </td>
                    <td>
                      {p.popis}
                      {p.pres && (
                        <span
                          className="stitek"
                          style={{ marginLeft: 6, color: "#B46617", background: "#F7E7D6" }}
                        >
                          {data.delnik.jmeno}
                        </span>
                      )}
                      <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                        {u ? u.nazev : "nezařazeno"}
                      </span>
                    </td>
                    <td className="r n nowrap" style={{ fontWeight: 700 }}>
                      {kc(p.castka)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

const SKUPINA_IKONY = {
  "Bourání a likvidace":
    "M8.6 3.4h6.8v3.8H8.6zM10.4 7.2h3.2v6.4h-3.2zM12 13.6v3.4M5.5 20.6h13M6.6 17.2h.02M17.4 18.2h.02M4.8 14.6h.02",
  "Střecha, krov a podkroví":
    "M2.8 11.2 12 3.4l9.2 7.8M5.4 9.6V20.6h13.2V9.6M9.6 20.6v-6.2h4.8v6.2",
  Zateplení:
    "M12 3.2 4.9 6.1v5.5c0 4.3 3 8 7.1 9.1 4.1-1.1 7.1-4.8 7.1-9.1V6.1zM8.6 10.4c1.2.9 2.2-.9 3.4 0s2.2-.9 3.4 0M8.6 14c1.2.9 2.2-.9 3.4 0s2.2-.9 3.4 0",
  Podlahy:
    "M12 3.2 21.2 7.8 12 12.4 2.8 7.8zM2.8 12l9.2 4.6 9.2-4.6M2.8 16.2l9.2 4.6 9.2-4.6",
  Rozvody:
    "M4.2 6.4h4.6a4 4 0 0 1 4 4v3a4 4 0 0 0 4 4h3M4.2 3.8v5.2M19.8 15.8v5.2M2.6 6.4h3.2M18.2 17.4h3.2",
  "Odpady a voda":
    "M12 3.4c3.6 4.3 5.6 7.2 5.6 9.7a5.6 5.6 0 1 1-11.2 0c0-2.5 2-5.4 5.6-9.7M9.4 13.6a2.6 2.6 0 0 0 2.6 2.6",
  "Okna a dveře":
    "M4.4 3.6h15.2v16.8H4.4zM12 3.6v16.8M4.4 12h15.2M2.8 20.4h18.4",
  "Vnitřní úpravy":
    "M3.4 5.2h11.2v4.4H3.4zM9 9.6v3.2h5.8v2.8M12.2 15.6h5.4v5.2h-5.4z",
  Vybavení:
    "M4.4 11.2V8.6a2.2 2.2 0 0 1 2.2-2.2h10.8a2.2 2.2 0 0 1 2.2 2.2v2.6M2.6 13a2.1 2.1 0 0 1 4.2 0v2.8h10.4V13a2.1 2.1 0 0 1 4.2 0v5.6H2.6zM6.8 15.8h10.4M5.2 18.6v1.8M18.8 18.6v1.8",
  Ostatní:
    "M12 2.9 20.4 7v10L12 21.1 3.6 17V7zM3.6 7l8.4 4.6L20.4 7M12 11.6v9.5",
};

const STAV_VZHLED = {
  plan: { label: "Plánováno", barva: "#8FA69A", pozadi: "#EFE8D6",
    ikona: "M6.4 3.4v3M17.6 3.4v3M3.6 8.6h16.8M4.6 5.2h14.8a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z" },
  probiha: { label: "Probíhá", barva: "#D98C0A", pozadi: "#FFF2D0",
    ikona: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 6.9V12l3.4 2" },
  hotovo: { label: "Hotovo", barva: "#3E6B4C", pozadi: "#E4EDE5",
    ikona: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 12.2l2.8 2.8L16 9.6" },
};

const DALSI_STAV = { plan: "probiha", probiha: "hotovo", hotovo: "plan" };

function Listy() {
  return (
    <svg className="listy" viewBox="0 0 120 70" aria-hidden="true">
      <g fill="none" stroke="#6D9773" strokeWidth="1.6" opacity=".45">
        <path d="M18 62c0-20 10-34 28-40M46 22c-10 2-16 8-18 16 9 1 15-4 18-16M46 22c8 4 11 11 9 19-8-2-11-9-9-19" />
        <path d="M62 64c4-18 14-29 32-33M94 31c-9 1-14 6-16 13 8 1 13-3 16-13M94 31c7 4 9 10 7 17-7-2-9-8-7-17" />
      </g>
      <g fill="#FFBA00" opacity=".5">
        <circle cx="104" cy="16" r="3" />
        <circle cx="30" cy="12" r="2.2" />
        <circle cx="76" cy="9" r="1.8" />
      </g>
    </svg>
  );
}

function StavZnak({ stav, onKlik }) {
  const v = STAV_VZHLED[stav];
  return (
    <button
      className="stavKolecko"
      data-stav={stav}
      onClick={(e) => {
        e.stopPropagation();
        onKlik();
      }}
      title={"Změnit stav — teď " + v.label}
      aria-label={"Stav: " + v.label}
    >
      {stav === "hotovo" && (
        <svg viewBox="0 0 24 24" width="15" height="15">
          <path d="M6 12.4l3.6 3.6L18 7.6" fill="none" stroke="#fff" strokeWidth="2.6"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {stav === "probiha" && <span className="pulka" />}
    </button>
  );
}

function StavStitek({ stav }) {
  const v = STAV_VZHLED[stav];
  return (
    <span className="stavStitek" style={{ color: v.barva }}>
      <Ik d={v.ikona} c={v.barva} s={15} w={1.9} />
      {v.label}
    </span>
  );
}

function KartaSkupiny({ nazev, barva, ikona, pocet, hotovych, plan, skut, deti, otevreno, prepni }) {
  const roz = plan - skut;
  const pct = plan ? Math.min(100, (skut / plan) * 100) : 0;
  return (
    <div className="skupinaKarta">
      <button className="skupinaHlava" onClick={prepni}>
        <span className="skupinaIkona" style={{ borderColor: barva + "55" }}>
          <Ik d={ikona} c={barva} s={30} w={1.5} />
        </span>
        <span className="skupinaNazev">
          <b style={{ color: barva }}>{nazev}</b>
          <small>
            {pocet} položek · hotovo {hotovych} z {pocet}
          </small>
        </span>
        <span className="sloupceSk">
          <span className="sloupec">
            <small>Odhad</small>
            <b className="n">{plan ? kc(plan) : "—"}</b>
          </span>
          <span className="sloupec">
            <small>Skutečnost</small>
            <b className="n">{skut ? kc(skut) : "—"}</b>
          </span>
          <span className="sloupec">
            <small>Rozdíl</small>
            <b className="n" style={{ color: skut ? (roz < 0 ? "#B03A2E" : "#3E6B4C") : "#5E7268" }}>
              {skut ? (roz >= 0 ? "+" : "") + kc(roz) : "—"}
            </b>
          </span>
        </span>
        <span className="skupinaPruh">
          <i style={{ width: pct + "%", background: roz < 0 ? "#B03A2E" : "#6D9773" }} />
        </span>
        <span className="sipka" data-open={otevreno ? "1" : "0"} style={{ color: barva }}>
          ⌄
        </span>
      </button>
      {otevreno && <div className="skupinaTelo">{deti}</div>}
    </div>
  );
}

function pocetSlovem(n) {
  if (n === 1) return "1 položka";
  if (n >= 2 && n <= 4) return n + " položky";
  return n + " položek";
}

function RadekPolozky({ u, skutecnost, pocet, zmen, otevriDetail, smaz }) {
  const roz = (u.odhad || 0) - skutecnost;
  const st = STAV_VZHLED[u.stav];
  return (
    <div className="polozkaR">
      <StavZnak stav={u.stav} onKlik={() => zmen(u.id, "stav", DALSI_STAV[u.stav])} />
      <span className="polozkaNazev">
        <b>
          {u.nazev}
          <span className="stavPilulka" style={{ color: st.barva, background: st.pozadi }}>
            {st.label}
          </span>
        </b>
        {u.typ === "pridano" && <span className="stitekNavic">navíc</span>}
        <small className="n">
          {u.mnozstvi
            ? `${u.mnozstvi} ${u.jednotka} · ${kc(u.jedcena)}/${u.jednotka || "ks"}`
            : u.odhad
            ? "vlastní položka"
            : "bez odhadu"}
        </small>
      </span>
      <span className="cisla">
        <span className="odhadPole">
          <small>Odhad</small>
          <input
            className="n"
            inputMode="decimal"
            value={u.odhad || ""}
            placeholder="0"
            onChange={(e) => zmen(u.id, "odhad", cislo(e.target.value))}
          />
        </span>
        <span className="skutPole">
          <small>Skutečnost</small>
          <b className="n">{skutecnost ? kc(skutecnost) : "—"}</b>
        </span>
        <span className="rozdilPole">
          <small>Rozdíl</small>
          <b
            className="n"
            style={{ color: skutecnost && u.odhad ? (roz < 0 ? "#B03A2E" : "#3E6B4C") : "#5E7268" }}
          >
            {skutecnost && u.odhad ? (roz >= 0 ? "+" : "") + kcKratce(roz) : "—"}
          </b>
        </span>
      </span>
      <button className="ctaDetail" onClick={() => otevriDetail(u)}>
        {pocet ? pocetSlovem(pocet) : "Detail"}
        <span aria-hidden="true"> →</span>
      </button>
      <span className="polozkaSmaz">
        <Smazat onSmaz={() => smaz(u.id)} co="tuto položku" />
      </span>
    </div>
  );
}

function RozpocetSekce({ data, uloz, v }) {
  const [pod, setPod] = useState("hypoteka");
  return (
    <>
      <div className="podtabs">
        <button
          className="podtab"
          data-a={pod === "hypoteka" ? "1" : "0"}
          onClick={() => setPod("hypoteka")}
        >
          Rozpočet k hypotéce
        </button>
        <button
          className="podtab"
          data-a={pod === "dotace" ? "1" : "0"}
          onClick={() => setPod("dotace")}
        >
          Rozpočet dotace
        </button>
      </div>
      {pod === "hypoteka" ? (
        <Ukoly data={data} uloz={uloz} v={v} />
      ) : (
        <DotaceSekce data={data} uloz={uloz} />
      )}
    </>
  );
}

function Ukoly({ data, uloz, v }) {
  const [nazev, setNazev] = useState("");
  const [odhad, setOdhad] = useState("");
  const [typ, setTyp] = useState("pridano");
  const [skupina, setSkupina] = useState("Ostatní");
  const [filtr, setFiltr] = useState("vse");
  const [sbalene, setSbalene] = useState({});
  const [rozbalene, setRozbalene] = useState({});
  const [detail, setDetail] = useState(null);
  const [hledani, setHledani] = useState(false);
  const [pridavam, setPridavam] = useState(false);
  const [dotaz, setDotaz] = useState("");

  const exportCsv = () => {
    const hlavicka = "Skupina;Polozka;Mnozstvi;Jednotka;Jed.cena;Odhad;Skutecnost;Rozdil;Stav\n";
    const radky = data.ukoly
      .map((u) => {
        const sk = v.skutUkol[u.id] || 0;
        return [
          skupinaUkolu(u), u.nazev, u.mnozstvi || "", u.jednotka || "",
          u.jedcena || "", u.odhad || 0, sk, (u.odhad || 0) - sk,
          STAV[u.stav].label,
        ].join(";");
      })
      .join("\n");
    const blob = new Blob(["\uFEFF" + hlavicka + radky], {
      type: "text/csv;charset=utf-8",
    });
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(blob);
    a2.download = "rozpocet.csv";
    a2.click();
    setTimeout(() => URL.revokeObjectURL(a2.href), 2000);
  };
  const prepniSkupinu = (sk) => setSbalene((x) => ({ ...x, [sk]: !x[sk] }));


  const nactiPlan = () =>
    uloz({ ...data, ukoly: [...data.ukoly, ...planNaUkoly()] });

  const pridej = () => {
    if (!nazev.trim()) return;
    uloz({
      ...data,
      ukoly: [
        ...data.ukoly,
        {
          id: uid(),
          nazev: nazev.trim(),
          odhad: cislo(odhad),
          skupina,
          stav: "plan",
          typ,
        },
      ],
    });
    setNazev("");
    setOdhad("");
  };
  const zmen = (id, pole, hod) =>
    uloz({
      ...data,
      ukoly: data.ukoly.map((u) => (u.id === id ? { ...u, [pole]: hod } : u)),
    });
  const smaz = (id) =>
    uloz({
      ...data,
      ukoly: data.ukoly.filter((u) => u.id !== id),
      polozky: data.polozky.map((p) => (p.ukol === id ? { ...p, ukol: null } : p)),
      zaznamy: data.zaznamy.map((z) => (z.ukol === id ? { ...z, ukol: null } : z)),
    });

  const pocty = {};
  data.polozky.forEach((p) => {
    if (p.ukol) pocty[p.ukol] = (pocty[p.ukol] || 0) + 1;
  });
  data.zaznamy.forEach((z) => {
    if (z.ukol) pocty[z.ukol] = (pocty[z.ukol] || 0) + 1;
  });

  const poradi = { probiha: 0, plan: 1, hotovo: 2 };
  const serazene = [...data.ukoly]
    .filter((u) => filtr === "vse" || u.stav === filtr)
    .filter((u) => !dotaz.trim() || u.nazev.toLowerCase().includes(dotaz.trim().toLowerCase()))
    .sort((a, b) => poradi[a.stav] - poradi[b.stav]);

  if (data.ukoly.length === 0)
    return (
      <div className="box" style={{ marginTop: 0 }}>
        <h2 className="boxh">
          <span className="hi">
            <i>
              <Ik d={IKO.strecha} c="#0C3B2E" s={16} />
            </i>
            Kategorie rekonstrukce
          </span>
        </h2>
        <p style={{ fontSize: 14, marginBottom: 4 }}>
          Kategorie jsou položky z rozpočtu, podle kterého jste si brali hypotéku.
          Do nich se pak zařazují faktury i {data.delnik.jmeno}ova práce — díky tomu
          uvidíš, kde jste přestřelili a kde ušetřili.
        </p>
        <div className="rada">
          <button className="btn" onClick={nactiPlan}>
            Načíst plán z hypotéky
          </button>
          <span style={{ fontSize: 12.5, color: "#5E7268" }}>
            {PLAN_HYPOTEKA.length} položek · {kc(PLAN_SOUCET)}
          </span>
        </div>
      </div>
    );

  return (
    <>
      <div className="karty">
        <div className="karta">
          <small>Plán z hypotéky</small>
          <b className="n">{kc(v.odhadPuvodni)}</b>
        </div>
        <div className="karta">
          <small>Přibylo navíc</small>
          <b className="n" style={{ color: v.odhadPridany ? "#B46617" : undefined }}>
            {kc(v.odhadPridany)}
          </b>
          <em>{data.ukoly.filter((u) => u.typ === "pridano").length} kategorií</em>
        </div>
        <div className="karta">
          <small>Hotovo</small>
          <b className="n" style={{ color: "#3E6B4C" }}>
            {kc(v.hotovoHodnota)}
          </b>
          <em>
            {data.ukoly.filter((u) => u.stav === "hotovo").length} z {data.ukoly.length}
          </em>
        </div>
        <div className="karta">
          <small>Výdaje bez kategorie</small>
          <b className="n">{kc(v.bezUkolu)}</b>
        </div>
      </div>

      {!pridavam ? (
        <button className="pridatKarta" onClick={() => setPridavam(true)}>
          <span className="pridatPlus">
            <Ik d={IKO.plus} c="#0C3B2E" s={18} w={2.2} />
          </span>
          Přidat kategorii
        </button>
      ) : (
      <div className="box">
        <h2 className="boxh">
          <span className="hi">
            <i>
              <Ik d={IKO.plus} c="#0C3B2E" s={16} />
            </i>
            Přidat kategorii
          </span>
          <button className="x" onClick={() => setPridavam(false)} aria-label="Zavřít">
            ×
          </button>
        </h2>
        <div className="form">
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Název</label>
            <input
              value={nazev}
              placeholder="např. zpevněná plocha u vjezdu"
              onChange={(e) => setNazev(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pridej()}
            />
          </div>
          <div className="pole">
            <label>Odhad</label>
            <input
              className="n"
              inputMode="decimal"
              value={odhad}
              onChange={(e) => setOdhad(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pridej()}
            />
          </div>
          <div className="pole">
            <label>Skupina</label>
            <select value={skupina} onChange={(e) => setSkupina(e.target.value)}>
              {SKUPINY.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="pole">
            <label>Odkud</label>
            <select value={typ} onChange={(e) => setTyp(e.target.value)}>
              <option value="pridano">Přidáno navíc</option>
              <option value="puvodni">Bylo v plánu</option>
            </select>
          </div>
          <button className="btn" onClick={pridej}>
            Přidat
          </button>
        </div>
      </div>
      )}

      <div className="filtrPas">
        <Listy />
        <button
          className="filtrTlac"
          data-jemny="1"
          data-a={hledani ? "1" : "0"}
          onClick={() => setHledani(!hledani)}
        >
          <Ik d={IKO.nastaveni} s={15} w={2.1} />
          Filtry
        </button>
        {hledani ? (
          <div className="filtrHledej">
            <input
              autoFocus
              value={dotaz}
              placeholder="Hledat položku…"
              onChange={(e) => setDotaz(e.target.value)}
            />
          </div>
        ) : (
          ["vse", "probiha", "plan", "hotovo"].map((k) => (
            <button
              key={k}
              className="filtrTlac"
              data-a={filtr === k ? "1" : "0"}
              onClick={() => setFiltr(k)}
            >
              {k === "vse" ? "Vše" : STAV[k].label}
            </button>
          ))
        )}
      </div>

      {SKUPINY.map((sk) => {
        const vSkupine = serazene.filter((u) => skupinaUkolu(u) === sk);
        if (vSkupine.length === 0) return null;
        const barva = SKUPINA_BARVY[sk] || "#7A8C85";
        const plan = vSkupine.reduce((a2, u) => a2 + (u.odhad || 0), 0);
        const skut = vSkupine.reduce((a2, u) => a2 + (v.skutUkol[u.id] || 0), 0);
        const hotovych = vSkupine.filter((u) => u.stav === "hotovo").length;
        const otevreno = !sbalene[sk];
        const vse = rozbalene[sk];
        const videt = vse ? vSkupine : vSkupine.slice(0, 4);
        return (
          <KartaSkupiny
            key={sk}
            nazev={sk}
            barva={barva}
            ikona={SKUPINA_IKONY[sk] || SKUPINA_IKONY["Ostatní"]}
            pocet={vSkupine.length}
            hotovych={hotovych}
            plan={plan}
            skut={skut}
            otevreno={otevreno}
            prepni={() => prepniSkupinu(sk)}
            deti={
              <>
                {videt.map((u) => (
                  <RadekPolozky
                    key={u.id}
                    u={u}
                    skutecnost={v.skutUkol[u.id] || 0}
                    pocet={pocty[u.id] || 0}
                    zmen={zmen}
                    otevriDetail={setDetail}
                    smaz={smaz}
                  />
                ))}
                {vSkupine.length > 4 && (
                  <button
                    className="viceTlac"
                    onClick={() => setRozbalene((x) => ({ ...x, [sk]: !x[sk] }))}
                  >
                    {vse
                      ? "Skrýt položky ⌃"
                      : `+ ${vSkupine.length - 4} dalších položek ⌄`}
                  </button>
                )}
              </>
            }
          />
        );
      })}

      <div className="patka">
        <span className="patkaI">i</span>
        <p>
          Odhady jsou orientační, skutečnost se plní z faktur. Klikni na název
          položky nebo na šipku vpravo a uvidíš, co se do ní počítá.
        </p>
        <button className="btn" onClick={exportCsv}>
          Exportovat rozpočet
        </button>
      </div>

      {detail && (
        <DetailKategorie
          data={data}
          uloz={uloz}
          ukol={detail}
          skutecnost={v.skutUkol[detail.id] || 0}
          zavri={() => setDetail(null)}
        />
      )}
    </>
  );
}

const DOTACE_OPATRENI = [
  { id: "fasada", nazev: "Fasáda", mnozstvi: "128,62 m²", sazba: 1300, dotace: 167206,
    barva: "#B4562A", kategorie: ["fasáda"] },
  { id: "nevytapene", nazev: "Konstrukce k nevytápěným prostorům", mnozstvi: "85,80 m²", sazba: 500, dotace: 42900,
    barva: "#E8A317", kategorie: ["tepelná izolace stropu"] },
  { id: "zemina", nazev: "Konstrukce k zemině", mnozstvi: "81,88 m²", sazba: 1700, dotace: 139196,
    barva: "#A67C52", kategorie: ["tepelná izolace podlahy tl. 15 cm", "hydroizolace podlah", "podkladní betony + kari síť", "vrchní beton"] },
  { id: "otvory", nazev: "Otvorové výplně (okna, dveře, střešní okna)", mnozstvi: "19,56 m²", sazba: 4900, dotace: 95844,
    barva: "#2F6B4F", kategorie: ["výměna oken"] },
  { id: "projekt", nazev: "Podpora na zpracování projektu", mnozstvi: "1 projekt", sazba: 50000, dotace: 50000,
    barva: "#2E7D8F", kategorie: ["projekt a povolení"] },
  { id: "retence", nazev: "Retence — dešťovka", mnozstvi: "1 ks", sazba: 50000, dotace: 50000,
    barva: "#4A9FBF", kategorie: ["dešťová jímka"] },
];

const DOTACE_CELKEM = DOTACE_OPATRENI.reduce((a, o) => a + o.dotace, 0);

// Návrh zařazení podle kategorie rozpočtu; ruční volba (p.opatreni) má přednost.
// Když je nastavený základ odkazů, poskládá se cesta z čísla dokladu.
function odkazDokladu(p, zaklad) {
  if (p.odkaz) return p.odkaz;
  // Jednosouborová verze si nese plnou adresu složky s doklady, aby odkazy
  // fungovaly i když se soubor otevře odkudkoli.
  const nast = (typeof window !== "undefined" && window.NASTAVENI) || {};
  if (nast.zakladOdkazu) zaklad = nast.zakladOdkazu;
  if (!zaklad || !p.cisloDokladu) return "";
  const soubor = DOKLADY_NA_WEBU[String(p.cisloDokladu)];
  if (!soubor) return "";
  return zaklad + soubor;
}

// Popis účtu si uživatel vyplní v Nastavení. Když ho nevyplní, ukáže se
// obecný název — v kódu žádná konkrétní jména nejsou.
function popisUctu(k, ktery) {
  const p = k && (ktery === "A" ? k.popisA : k.popisB);
  return (p && String(p).trim()) || (ktery === "A" ? "účet 1" : "účet 2");
}

function zustatekCelkem(k) {
  if (!k) return 0;
  const soucet = cislo(k.ucetA) + cislo(k.ucetB);
  return soucet || cislo(k.zustatek);
}

function opatreniPolozky(p, ukoly) {
  if (p.opatreni !== undefined && p.opatreni !== null) return p.opatreni;
  const u = ukoly.find((x) => x.id === p.ukol);
  if (!u) return "";
  const o = DOTACE_OPATRENI.find((x) =>
    x.kategorie.some((k) => k.toLowerCase() === u.nazev.toLowerCase())
  );
  return o ? o.id : "";
}

function DotaceSekce({ data, uloz }) {
  const [otevrene, setOtevrene] = useState({});
  const prepni = (id) => setOtevrene((x) => ({ ...x, [id]: !x[id] }));

  const doklady = {};
  DOTACE_OPATRENI.forEach((o) => (doklady[o.id] = []));
  const nezarazene = [];
  data.polozky.forEach((p) => {
    const o = opatreniPolozky(p, data.ukoly);
    if (o && doklady[o]) doklady[o].push(p);
    else nezarazene.push(p);
  });

  const soucet = (id) => doklady[id].reduce((a, p) => a + p.castka, 0);
  const dolozenoCelkem = DOTACE_OPATRENI.reduce((a, o) => a + soucet(o.id), 0);

  const zmenOpatreni = (p, novy) =>
    uloz({
      ...data,
      polozky: data.polozky.map((x) =>
        x.id === p.id ? { ...x, opatreni: novy } : x
      ),
    });

  const vyber = (p) => (
    <select
      className="mini"
      style={{ width: "auto", fontSize: 11.5, padding: "3px 6px" }}
      value={opatreniPolozky(p, data.ukoly)}
      onChange={(e) => zmenOpatreni(p, e.target.value)}
    >
      <option value="">— mimo dotaci —</option>
      {DOTACE_OPATRENI.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nazev}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <div className="karty" style={{ marginTop: 14 }}>
        <div className="karta">
          <small>Přiznaná dotace</small>
          <b className="n">{kc(DOTACE_CELKEM)}</b>
          <em>6 opatření</em>
        </div>
        <div className="karta">
          <small>Doložené náklady</small>
          <b className="n" style={{ color: "#3E6B4C" }}>
            {kc(dolozenoCelkem)}
          </b>
          <em>{Math.round((dolozenoCelkem / DOTACE_CELKEM) * 100)} % dotace</em>
        </div>
        <div className="karta">
          <small>Opatření bez dokladů</small>
          <b className="n" style={{ color: "#B46617" }}>
            {DOTACE_OPATRENI.filter((o) => soucet(o.id) === 0).length}
          </b>
          <em>z 6</em>
        </div>
        <div className="karta">
          <small>Výdaje mimo dotaci</small>
          <b className="n">{kc(nezarazene.reduce((a, p) => a + p.castka, 0))}</b>
          <em>{nezarazene.length} položek</em>
        </div>
      </div>

      <div className="filtrPas">
        <Listy />
        <span className="filtrTlac" data-a="1" style={{ cursor: "default" }}>
          Dotace {kc(DOTACE_CELKEM)}
        </span>
        <span className="filtrTlac" data-jemny="1" style={{ cursor: "default" }}>
          Doloženo {kc(dolozenoCelkem)}
        </span>
        <span
          className="filtrTlac"
          data-jemny="1"
          style={{ cursor: "default", color: "#FFBA00" }}
        >
          {Math.round((dolozenoCelkem / DOTACE_CELKEM) * 100)} % pokryto
        </span>
      </div>

      {DOTACE_OPATRENI.map((o) => {
        const sk = soucet(o.id);
        const malo = sk < o.dotace;
        const otevreno = otevrene[o.id];
        const seznam = doklady[o.id].sort((a2, b2) => (a2.datum < b2.datum ? 1 : -1));
        return (
          <div className="skupinaKarta" key={o.id}>
            <button className="skupinaHlava" onClick={() => prepni(o.id)}>
              <span className="skupinaIkona" style={{ borderColor: o.barva + "55" }}>
                <Ik d={IKO.stit} c={o.barva} s={28} w={1.5} />
              </span>
              <span className="skupinaNazev">
                <b style={{ color: o.barva }}>{o.nazev}</b>
                <small>
                  {o.mnozstvi} × {kc(o.sazba)} · {seznam.length} dokladů
                </small>
              </span>
              <span className="sloupec">
                <small>Dotace</small>
                <b className="n">{kc(o.dotace)}</b>
              </span>
              <span className="sloupec">
                <small>Doloženo</small>
                <b className="n" style={{ color: malo ? "#B46617" : "#3E6B4C" }}>
                  {kc(sk)}
                </b>
              </span>
              <span className="sloupec">
                <small>Chybí</small>
                <b className="n" style={{ color: malo ? "#B03A2E" : "#3E6B4C" }}>
                  {malo ? kc(o.dotace - sk) : "pokryto"}
                </b>
              </span>
              <span className="skupinaPruh">
                <i
                  style={{
                    width: Math.min(100, o.dotace ? (sk / o.dotace) * 100 : 0) + "%",
                    background: malo ? "#FFBA00" : "#3E6B4C",
                  }}
                />
              </span>
              <span className="sipka" data-open={otevreno ? "1" : "0"} style={{ color: o.barva }}>
                ⌄
              </span>
            </button>
            {otevreno && (
              <div className="skupinaTelo">
                {seznam.length === 0 ? (
                  <p className="prazdno">
                    Na tohle opatření zatím není doložený žádný náklad.
                  </p>
                ) : (
                  seznam.map((p) => (
                    <div className="polozkaR" key={p.id} style={{ gridTemplateColumns: "1fr 120px 200px" }}>
                      <span className="polozkaNazev">
                        <b>{p.popis}</b>
                        <Doklad p={p} zaklad={data.zakladOdkazu} />
                      </span>
                      <span className="skutPole n">{kc(p.castka)}</span>
                      <span>{vyber(p)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="patka">
        <span className="patkaI">i</span>
        <p>
          Doložené náklady jsou výdaje, které na dané opatření padly. Když jsou
          nižší než přiznaná dotace, svítí žlutě — u vyúčtování to bývá problém.
        </p>
      </div>

      {nezarazene.length > 0 && (
        <div className="box">
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.ucet} c="#0C3B2E" s={16} />
              </i>
              Výdaje mimo dotaci
            </span>
            <span className="n">
              {kc(nezarazene.reduce((a, p) => a + p.castka, 0))}
            </span>
          </h2>
          <table className="t">
            <tbody>
              {nezarazene
                .sort((a, b) => b.castka - a.castka)
                .slice(0, 40)
                .map((p) => {
                  const u = data.ukoly.find((x) => x.id === p.ukol);
                  return (
                    <tr key={p.id}>
                      <td className="n nowrap" style={{ color: "#5E7268", width: 74 }}>
                        {datumCz(p.datum)}
                      </td>
                      <td>
                        {p.popis}
                        <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                          {u ? u.nazev : "bez kategorie"}
                        </span>
                      </td>
                      <td className="r n nowrap" style={{ fontWeight: 700 }}>
                        {kc(p.castka)}
                      </td>
                      <td className="r">{vyber(p)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="pozn">
            Tyhle výdaje se do dotace nepočítají. Když některý patří k některému
            opatření, vyber ho vpravo.
          </p>
        </div>
      )}
    </>
  );
}

function DetailKategorie({ data, uloz, ukol, skutecnost, zavri }) {
  const barva = SKUPINA_BARVY[skupinaUkolu(ukol)] || "#7A8C85";
  const [novaUpominka, setNovaUpominka] = useState({ text: "", termin: "" });
  const mojeUpominky = (data.upominky || []).filter((z) => z.ukolId === ukol.id);

  const pridejUpominku = () => {
    const t = novaUpominka.text.trim();
    if (!t) return;
    uloz({
      ...data,
      upominky: [
        ...(data.upominky || []),
        {
          id: uid(),
          text: t,
          ukolId: ukol.id,
          termin: novaUpominka.termin,
          hotovo: false,
          vytvoreno: dnes(),
        },
      ],
    });
    setNovaUpominka({ text: "", termin: "" });
  };
  const vydaje = data.polozky
    .filter((p) => p.ukol === ukol.id)
    .map((p) => ({
      id: "v" + p.id,
      origId: p.id,
      kam: "polozky",
      datum: p.datum,
      popis: p.popis,
      dodavatel: p.dodavatel,
      cisloDokladu: p.cisloDokladu,
      poznamka: p.poznamka,
      odkaz: p.odkaz,
      castka: p.castka,
      druh: p.pres ? "materiál přes " + data.delnik.jmeno + "u" : "faktura",
      barva: p.pres ? "#B46617" : "#2E7D8F",
      zdroj: p.zdroj,
      dolozeno: p.dolozeno,
    }));
  const prace = data.zaznamy
    .filter((z) => z.ukol === ukol.id && z.typ !== "dluh")
    .map((z) => ({
      id: "z" + z.id,
      origId: z.id,
      kam: "zaznamy",
      datum: z.datum,
      popis: z.popis + (z.hodiny ? ` · ${hodinyCelkem(z.hodiny)} h` : ""),
      castka: z.castka,
      druh: z.typ === "prace" ? "odpracováno" : "vyplaceno",
      barva: z.typ === "prace" ? "#7FA86B" : "#2F6B4F",
      zdroj: z.zdroj,
      dolozeno: true,
    }));
  const vse = [...vydaje, ...prace].sort((a, b) => (a.datum < b.datum ? 1 : -1));

  const presun = (r, novyUkol) => {
    if (!novyUkol || novyUkol === ukol.id) return;
    if (r.kam === "polozky")
      uloz({
        ...data,
        polozky: data.polozky.map((p) =>
          p.id === r.origId ? { ...p, ukol: novyUkol } : p
        ),
      });
    else
      uloz({
        ...data,
        zaznamy: data.zaznamy.map((z) =>
          z.id === r.origId ? { ...z, ukol: novyUkol } : z
        ),
      });
  };
  const soucet = vse.reduce((a, r) => a + r.castka, 0);
  const rozdil = (ukol.odhad || 0) - skutecnost;

  return (
    <div className="modal" onClick={zavri}>
      <div
        className="modalkarta"
        style={{ maxWidth: 620, borderTopColor: barva }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eyebrow" style={{ color: barva }}>
          {skupinaUkolu(ukol)}
        </div>
        <h2 className="modalnadpis" style={{ marginTop: 3 }}>
          {ukol.nazev}
        </h2>
        {ukol.mnozstvi ? (
          <p className="modaltext n" style={{ marginBottom: 12 }}>
            {ukol.mnozstvi} {ukol.jednotka} × {kc(ukol.jedcena)} podle rozpočtu
          </p>
        ) : null}

        <div className="dluhSouhrn" style={{ marginBottom: 4 }}>
          <div>
            <span className="eyebrow">Odhad</span>
            <b className="n">{ukol.odhad ? kc(ukol.odhad) : "—"}</b>
          </div>
          <div>
            <span className="eyebrow">Skutečnost</span>
            <b className="n">{kc(skutecnost)}</b>
          </div>
          <div>
            <span className="eyebrow">Rozdíl</span>
            <b className="n" style={{ color: rozdil < 0 ? "#B03A2E" : "#3E6B4C" }}>
              {ukol.odhad ? (rozdil >= 0 ? "+" : "") + kc(rozdil) : "—"}
            </b>
          </div>
        </div>

        {vse.length > 0 && (
          <p className="pozn" style={{ marginTop: 14, marginBottom: 0 }}>
            Když sem něco nepatří, vyber u toho jinou kategorii — přesune se tam
            i s částkou.
          </p>
        )}
        {vse.length === 0 ? (
          <p className="prazdno">Do téhle položky se zatím nic nezapočítalo.</p>
        ) : (
          <table className="t" style={{ marginTop: 14 }}>
            <tbody>
              {vse.map((r) => (
                <tr key={r.id}>
                  <td className="n nowrap" style={{ color: "#5E7268", width: 74 }}>
                    {datumCz(r.datum)}
                  </td>
                  <td>
                    {r.popis}
                    <Doklad p={r} zaklad={data.zakladOdkazu} />
                    <span style={{ display: "block", marginTop: 3 }}>
                      <span
                        className="stitek"
                        style={{ color: "#fff", background: r.barva }}
                      >
                        {r.druh}
                      </span>
                      {r.zdroj && ZDROJ[r.zdroj] && (
                        <span
                          className="stitek"
                          style={{
                            marginLeft: 5,
                            color: ZDROJ[r.zdroj].tmava,
                            background: ZDROJ[r.zdroj].svetla,
                          }}
                        >
                          {ZDROJ[r.zdroj].zkratka}
                        </span>
                      )}
                      {r.dolozeno === false && (
                        <span
                          className="stitek"
                          style={{ marginLeft: 5, color: "#8A6100", background: "#FFF2D0" }}
                        >
                          bez dokladu
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="r n nowrap" style={{ fontWeight: 700 }}>
                    {kc(r.castka)}
                    <span className="presunR">
                      <VyberKategorie
                        ukoly={data.ukoly.filter((u) => u.id !== ukol.id)}
                        hodnota=""
                        onZmena={(id) => presun(r, id)}
                        placeholder="přeřadit jinam…"
                      />
                    </span>
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid " + barva }}>
                <td colSpan={2} style={{ fontWeight: 800, paddingTop: 11 }}>
                  Celkem {vse.length} položek
                </td>
                <td className="r n nowrap" style={{ fontWeight: 800, paddingTop: 11 }}>
                  {kc(soucet)}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        <h3 className="eyebrow" style={{ marginTop: 22, marginBottom: 8 }}>
          Poznámka
        </h3>
        <textarea
          className="poznamkaPole"
          value={ukol.poznamka || ""}
          placeholder="Cokoli, co si k téhle položce chceš pamatovat…"
          onChange={(e) =>
            uloz({
              ...data,
              ukoly: data.ukoly.map((x) =>
                x.id === ukol.id ? { ...x, poznamka: e.target.value } : x
              ),
            })
          }
        />

        <h3 className="eyebrow" style={{ marginTop: 20, marginBottom: 8 }}>
          Upomínky
          {mojeUpominky.length > 0 && (
            <span style={{ color: "#B46617" }}> · {mojeUpominky.filter((z) => !z.hotovo).length} otevřených</span>
          )}
        </h3>

        {mojeUpominky.length > 0 && (
          <div className="upominkySeznam">
            {mojeUpominky.map((z) => (
              <Upominka key={z.id} z={z} data={data} uloz={uloz} />
            ))}
          </div>
        )}

        <div className="form" style={{ marginTop: 10 }}>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Co je potřeba vyřídit</label>
            <input
              value={novaUpominka.text}
              placeholder="např. doobjednat 3 balíky vaty"
              onChange={(e) => setNovaUpominka({ ...novaUpominka, text: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && pridejUpominku()}
            />
          </div>
          <div className="pole">
            <label>Do kdy</label>
            <input
              type="date"
              value={novaUpominka.termin}
              onChange={(e) => setNovaUpominka({ ...novaUpominka, termin: e.target.value })}
            />
          </div>
          <button className="btn" onClick={pridejUpominku} disabled={!novaUpominka.text.trim()}>
            Přidat upomínku
          </button>
        </div>
        <p className="pozn">
          Upomínky se sesbírají na nástěnce K vyřízení na přehledu.
        </p>

        <div className="rada">
          <button className="btn2" onClick={zavri}>
            Zavřít
          </button>
        </div>
      </div>
    </div>
  );
}

function Upominka({ z, data, uloz, sKategorii }) {
  const u = data.ukoly.find((x) => x.id === z.ukolId);
  const poTerminu = z.termin && !z.hotovo && z.termin < dnes();
  return (
    <div className="upominka" data-hotovo={z.hotovo ? "1" : "0"}>
      <button
        className="stavKolecko"
        data-stav={z.hotovo ? "hotovo" : "plan"}
        onClick={() =>
          uloz({
            ...data,
            upominky: data.upominky.map((x) =>
              x.id === z.id ? { ...x, hotovo: !x.hotovo } : x
            ),
          })
        }
        aria-label={z.hotovo ? "Znovu otevřít" : "Odškrtnout"}
      >
        {z.hotovo && (
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path d="M6 12.4l3.6 3.6L18 7.6" fill="none" stroke="#fff" strokeWidth="2.8"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <span className="upominkaText">
        <b>{z.text}</b>
        <small>
          {sKategorii && u ? u.nazev : ""}
          {sKategorii && u && z.termin ? " · " : ""}
          {z.termin && (
            <span style={{ color: poTerminu ? "#B03A2E" : undefined, fontWeight: poTerminu ? 800 : 600 }}>
              {poTerminu ? "po termínu " : "do "}
              {datumCz(z.termin)}
            </span>
          )}
        </small>
      </span>
      <Smazat
        co="tuto upomínku"
        onSmaz={() =>
          uloz({ ...data, upominky: data.upominky.filter((x) => x.id !== z.id) })
        }
      />
    </div>
  );
}

function Vydaje({ data, uloz }) {
  const [f, setF] = useState({
    datum: dnes(),
    popis: "",
    tema: data.temata[0],
    ukol: "",
    castka: "",
    zdroj: "hypoteka",
    pres: false,
    dolozeno: false,
    proplaceno: true,
    dodavatel: "",
    cisloDokladu: "",
  });
  const [filtr, setFiltr] = useState("");
  const [skener, setSkener] = useState(false);
  const [novaKat, setNovaKat] = useState({ zobraz: false, nazev: "", odhad: "" });

  const zalozKategorii = () => {
    const nazev = novaKat.nazev.trim();
    if (!nazev) return;
    const id = uid();
    uloz({
      ...data,
      ukoly: [
        ...data.ukoly,
        { id, nazev, odhad: cislo(novaKat.odhad), stav: "probiha", typ: "pridano" },
      ],
    });
    setF((x) => ({ ...x, ukol: id }));
    setNovaKat({ zobraz: false, nazev: "", odhad: "" });
  };

  const pridejVice = (nove) =>
    uloz({ ...data, polozky: [...data.polozky, ...nove] });

  const zapisFakturu = async (nove, faktura, archiv) => {
    let mafoto = false;
    if (archiv && data.uklFotky !== false) {
      try {
        await ULOZISTE.set("fa:" + faktura.id, archiv, true);
        mafoto = true;
      } catch (e) {
        mafoto = false;
      }
    }
    uloz({
      ...data,
      polozky: [...data.polozky, ...nove],
      faktury: [
        ...(data.faktury || []),
        { ...faktura, mafoto, pocet: nove.length },
      ],
    });
  };

  const pridej = () => {
    const c = cislo(f.castka);
    if (!c || !f.popis.trim()) return;
    uloz({
      ...data,
      polozky: [
        ...data.polozky,
        { ...f, ukol: f.ukol || null, castka: c, id: uid() },
      ],
    });
    setF({ ...f, popis: "", castka: "", cisloDokladu: "", odkaz: "" });
  };
  const smaz = (id) =>
    uloz({ ...data, polozky: data.polozky.filter((p) => p.id !== id) });
  const prepni = (id, pole) =>
    uloz({
      ...data,
      polozky: data.polozky.map((p) =>
        p.id === id ? { ...p, [pole]: !p[pole] } : p
      ),
    });

  const jmenoUkolu = (id) => {
    const u = data.ukoly.find((x) => x.id === id);
    return u ? u.nazev : "—";
  };
  const seznam = [...data.polozky]
    .filter(
      (p) =>
        !filtr ||
        (p.popis + p.tema + jmenoUkolu(p.ukol) + (p.dodavatel || "") + (p.cisloDokladu || ""))
          .toLowerCase()
          .includes(filtr.toLowerCase())
    )
    .sort((a, b) => (a.datum < b.datum ? 1 : -1));
  const suma = seznam.reduce((a, p) => a + p.castka, 0);

  return (
    <>
      {skener ? (
        <Skener data={data} hotovo={zapisFakturu} zavri={() => setSkener(false)} />
      ) : (
        <div className="rada" style={{ marginTop: 0, marginBottom: 4 }}>
          <button className="btn" onClick={() => setSkener(true)}>
            Vyfotit doklad
          </button>
          <span style={{ fontSize: 12, color: "#5E7268" }}>
            Uloží se i fotka. Kategorii můžeš doplnit později.
          </span>
        </div>
      )}

      <div className="box">
        <h2 className="boxh">Nový výdaj ručně</h2>
        {novaKat.zobraz && (
          <div className="hlaska" style={{ marginTop: 0, marginBottom: 14 }}>
            <div className="form">
              <div className="pole" style={{ gridColumn: "span 2" }}>
                <label>Název nové kategorie</label>
                <input
                  autoFocus
                  value={novaKat.nazev}
                  placeholder="např. zpevněná plocha u vjezdu"
                  onChange={(e) => setNovaKat({ ...novaKat, nazev: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && zalozKategorii()}
                />
              </div>
              <div className="pole">
                <label>Odhad (nepovinné)</label>
                <input
                  className="n"
                  inputMode="decimal"
                  value={novaKat.odhad}
                  onChange={(e) => setNovaKat({ ...novaKat, odhad: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && zalozKategorii()}
                />
              </div>
              <button className="btn" onClick={zalozKategorii}>
                Založit
              </button>
              <button
                className="btn2"
                onClick={() => setNovaKat({ zobraz: false, nazev: "", odhad: "" })}
              >
                Zrušit
              </button>
            </div>
          </div>
        )}
        <div className="form">
          <div className="pole">
            <label>Datum</label>
            <input
              type="date"
              value={f.datum}
              onChange={(e) => setF({ ...f, datum: e.target.value })}
            />
          </div>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Popis</label>
            <input
              value={f.popis}
              placeholder="např. extrudovaný polystyren 80 mm"
              onChange={(e) => setF({ ...f, popis: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && pridej()}
            />
          </div>
          <div className="pole">
            <label>Dodavatel</label>
            <input
              value={f.dodavatel}
              placeholder="např. DEK"
              onChange={(e) => setF({ ...f, dodavatel: e.target.value })}
            />
          </div>
          <div className="pole">
            <label>Číslo dokladu</label>
            <input
              className="n"
              value={f.cisloDokladu}
              placeholder="z faktury"
              onChange={(e) => setF({ ...f, cisloDokladu: e.target.value })}
            />
          </div>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Odkaz na originál</label>
            <input
              value={f.odkaz}
              placeholder="odkaz na PDF v Disku, Dropboxu…"
              onChange={(e) => setF({ ...f, odkaz: e.target.value })}
            />
          </div>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Kategorie z rozpočtu</label>
            <VyberKategorie
              ukoly={data.ukoly}
              hodnota={f.ukol}
              onZmena={(id) => setF({ ...f, ukol: id })}
              onNova={(nazev) => setNovaKat({ zobraz: true, nazev, odhad: "" })}
            />
          </div>
          <div className="pole">
            <label>Druh materiálu</label>
            <select
              value={f.tema}
              onChange={(e) => setF({ ...f, tema: e.target.value })}
            >
              {data.temata.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="pole">
            <label>Placeno z</label>
            <select
              value={f.zdroj}
              onChange={(e) => setF({ ...f, zdroj: e.target.value })}
            >
              {Object.entries(ZDROJ).map(([k, z]) => (
                <option key={k} value={k}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
          <div className="pole">
            <label>Částka</label>
            <input
              className="n"
              inputMode="decimal"
              value={f.castka}
              onChange={(e) => setF({ ...f, castka: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && pridej()}
            />
          </div>
          <label className="chk">
            <input
              type="checkbox"
              checked={f.pres}
              onChange={(e) => setF({ ...f, pres: e.target.checked })}
            />
            Peníze šly přes {data.delnik.jmeno}
          </label>
          <label className="chk">
            <input
              type="checkbox"
              checked={f.dolozeno}
              onChange={(e) => setF({ ...f, dolozeno: e.target.checked })}
            />
            Doloženo účtenkou
          </label>
          {f.pres && (
            <label className="chk">
              <input
                type="checkbox"
                checked={f.proplaceno}
                onChange={(e) => setF({ ...f, proplaceno: e.target.checked })}
              />
              Už proplaceno {data.delnik.jmeno}ovi
            </label>
          )}
          <button className="btn" onClick={pridej}>
            Zapsat
          </button>
        </div>
        <p className="pozn">
          Když zaškrtneš „peníze šly přes {data.delnik.jmeno}", částka se započítá
          do tématu i na jeho účet — zapisuješ ji jen jednou.
        </p>
      </div>

      <div className="box">
        <h2 className="boxh">
          Kniha výdajů
          <span className="n">
            {seznam.length} zápisů · {kc(suma)}
          </span>
        </h2>
        <div className="pole" style={{ marginBottom: 12 }}>
          <input
            placeholder="Hledat v popisu, tématu nebo úkolu…"
            value={filtr}
            onChange={(e) => setFiltr(e.target.value)}
          />
        </div>
        {seznam.length === 0 ? (
          <p className="prazdno">Nic k zobrazení.</p>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Popis</th>
                <th>Kategorie</th>
                <th>Materiál</th>
                <th>Zdroj</th>
                <th className="r">Částka</th>
                <th>Dokl.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {seznam.map((p) => (
                <tr key={p.id}>
                  <td className="n nowrap bunkaDatum" style={{ color: "#5E7268" }}>
                    {datumCz(p.datum)}
                  </td>
                  <td className="bunkaPopis">
                    {p.popis}
                    {p.pres && (
                      <span
                        className="stitek"
                        style={{ marginLeft: 6, color: "#B46617", background: "#F7E7D6" }}
                      >
                        {data.delnik.jmeno}
                      </span>
                    )}
                    <Doklad p={p} zaklad={data.zakladOdkazu} />
                  </td>
                  <td data-popis="Kategorie" style={{ fontWeight: 600 }}>
                    {p.ukol ? jmenoUkolu(p.ukol) : <span style={{ color: "#B46617" }}>nezařazeno</span>}
                  </td>
                  <td data-popis="Materiál" style={{ color: "#5E7268" }}>{p.tema}</td>
                  <td data-popis="Zdroj">
                    <span
                      className="stitek"
                      style={{ color: ZDROJ[p.zdroj].tmava, background: ZDROJ[p.zdroj].svetla }}
                    >
                      {ZDROJ[p.zdroj].zkratka}
                    </span>
                  </td>
                  <td className="r n nowrap bunkaCastka" data-popis="Částka">{kc(p.castka)}</td>
                  <td data-popis="Doklad">
                    <input
                      type="checkbox"
                      checked={!!p.dolozeno}
                      onChange={() => prepni(p.id, "dolozeno")}
                      style={{ width: 15, height: 15, accentColor: "#3E6B4C" }}
                      aria-label="Doloženo účtenkou"
                    />
                  </td>
                  <td>
                    <Smazat onSmaz={() => smaz(p.id)} co="tento výdaj" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

async function zmensiObrazek(file) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("Soubor se nepodařilo přečíst."));
    r.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Tohle není čitelný obrázek."));
    i.src = dataUrl;
  });
  const max = 1600;
  let w = img.width,
    h = img.height;
  if (Math.max(w, h) > max) {
    const s = max / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL("image/jpeg", 0.82);

  let aw = img.width,
    ah = img.height;
  const maxA = 1100;
  if (Math.max(aw, ah) > maxA) {
    const s = maxA / Math.max(aw, ah);
    aw = Math.round(aw * s);
    ah = Math.round(ah * s);
  }
  const ca = document.createElement("canvas");
  ca.width = aw;
  ca.height = ah;
  const cta = ca.getContext("2d");
  cta.fillStyle = "#fff";
  cta.fillRect(0, 0, aw, ah);
  cta.drawImage(img, 0, 0, aw, ah);
  const archiv = ca.toDataURL("image/jpeg", 0.58);

  return { url, base64: url.split(",")[1], archiv };
}

function vytahniJson(text) {
  let t = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("bez json");
  return JSON.parse(t.slice(a, b + 1));
}

function Skener({ data, hotovo, zavri }) {
  const [stav, setStav] = useState("cekam"); // cekam | zpracuju | formular
  const [nahled, setNahled] = useState("");
  const [archiv, setArchiv] = useState("");
  const [chyba, setChyba] = useState("");
  const [ulozFotku, setUlozFotku] = useState(true);
  const [f, setF] = useState({
    datum: dnes(),
    dodavatel: "",
    cisloDokladu: "",
    popis: "",
    castka: "",
    ukol: "",
    tema: "Materiál (obecný)",
    zdroj: "hypoteka",
    odkaz: "",
  });

  const vyber = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setChyba("");
    setStav("zpracuju");
    try {
      const { url, archiv: arch } = await zmensiObrazek(file);
      setNahled(url);
      setArchiv(arch);
      setStav("formular");
    } catch (err) {
      setChyba("Fotku se nepodařilo zpracovat. Zkus jinou.");
      setStav("cekam");
    }
  };

  const zapis = () => {
    const c = cislo(f.castka);
    if (!c) return;
    const bezKategorie = !f.ukol;
    const idFaktury = uid();
    hotovo(
      [
        {
          id: uid(),
          datum: f.datum,
          popis: f.popis.trim() || "Doklad bez popisu",
          castka: c,
          ukol: bezKategorie ? null : f.ukol,
          tema: f.tema,
          zdroj: f.zdroj,
          dodavatel: f.dodavatel.trim(),
          cisloDokladu: f.cisloDokladu.trim(),
          kRozpadu: bezKategorie,
          jeProplaceno: true,
          fakturaId: idFaktury,
        },
      ],
      {
        id: idFaktury,
        datum: f.datum,
        dodavatel: f.dodavatel.trim(),
        cislo: f.cisloDokladu.trim(),
        celkem: c,
      },
      ulozFotku ? archiv : ""
    );
  };

  return (
    <div className="box" style={{ borderLeft: "5px solid #6D9773" }}>
      <h2 className="boxh">
        <span className="hi">
          <i>
            <Ik d={IKO.foto} c="#0C3B2E" s={16} />
          </i>
          Vyfotit a uložit doklad
        </span>
        <button className="x" onClick={zavri} aria-label="Zavřít">
          ×
        </button>
      </h2>

      {stav === "cekam" && (
        <>
          <label className="fotoPole">
            <input type="file" accept="image/*" capture="environment" onChange={vyber} />
            <span className="fotoIkona">
              <Ik d={IKO.foto} c="#0C3B2E" s={30} w={1.6} />
            </span>
            <b>Vyfotit nebo vybrat doklad</b>
            <span>
              Fotka se uloží do archivu faktur. Údaje doplníš do formuláře pod ní.
            </span>
          </label>
          {chyba && <div className="hlaska zle">{chyba}</div>}
        </>
      )}

      {stav === "zpracuju" && (
        <p className="prazdno">Zpracovávám fotku…</p>
      )}

      {stav === "formular" && (
        <>
          <div className="fotoRada">
            {nahled && <img className="fotoNahled" src={nahled} alt="Vyfocený doklad" />}
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="zustat" style={{ marginTop: 0 }}>
                <input
                  type="checkbox"
                  checked={ulozFotku}
                  onChange={(e) => setUlozFotku(e.target.checked)}
                />
                Uložit fotku do archivu
              </label>
              <p className="pozn" style={{ marginTop: 8 }}>
                Fotku pak najdeš ve Výdajích pod záložkou Archiv faktur. Kliknutím
                se zvětší.
              </p>
              <button className="btn2" onClick={() => setStav("cekam")}>
                Vyfotit znovu
              </button>
            </div>
          </div>

          <div className="form" style={{ marginTop: 14 }}>
            <div className="pole">
              <label>Datum</label>
              <input
                type="date"
                value={f.datum}
                onChange={(e) => setF({ ...f, datum: e.target.value })}
              />
            </div>
            <div className="pole">
              <label>Částka</label>
              <input
                className="n"
                inputMode="decimal"
                value={f.castka}
                placeholder="0"
                onChange={(e) => setF({ ...f, castka: e.target.value })}
              />
            </div>
            <div className="pole">
              <label>Dodavatel</label>
              <input
                value={f.dodavatel}
                placeholder="např. DEK"
                onChange={(e) => setF({ ...f, dodavatel: e.target.value })}
              />
            </div>
            <div className="pole">
              <label>Číslo dokladu</label>
              <input
                className="n"
                value={f.cisloDokladu}
                placeholder="z faktury"
                onChange={(e) => setF({ ...f, cisloDokladu: e.target.value })}
              />
            </div>
            <div className="pole" style={{ gridColumn: "span 2" }}>
              <label>Co to bylo</label>
              <input
                value={f.popis}
                placeholder="např. omítky a profily"
                onChange={(e) => setF({ ...f, popis: e.target.value })}
              />
            </div>
            <div className="pole" style={{ gridColumn: "span 2" }}>
              <label>Kategorie z rozpočtu — nepovinné</label>
              <VyberKategorie
                ukoly={data.ukoly.filter((u) => u.nazev !== "Čeká na rozpad faktury")}
                hodnota={f.ukol}
                onZmena={(id) => setF({ ...f, ukol: id })}
                placeholder="nechat na později…"
              />
            </div>
            <div className="pole">
              <label>Druh materiálu</label>
              <select value={f.tema} onChange={(e) => setF({ ...f, tema: e.target.value })}>
                {TEMATA.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="pole">
              <label>Placeno z</label>
              <select value={f.zdroj} onChange={(e) => setF({ ...f, zdroj: e.target.value })}>
                {Object.keys(ZDROJ).map((k) => (
                  <option key={k} value={k}>
                    {ZDROJ[k].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!f.ukol && (
            <div className="hlaska">
              Bez kategorie se doklad uloží mezi <b>Ke schválení</b>, kde ho
              kdykoli později zařadíš nebo rozdělíš na víc položek.
            </div>
          )}

          <div className="rada">
            <button className="btn" onClick={zapis} disabled={!cislo(f.castka)}>
              Uložit doklad
            </button>
            <button className="btn2" onClick={zavri}>
              Zrušit
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function VydajeSekce({ data, uloz, v }) {
  const [pod, setPod] = useState("kniha");
  const podtaby = [
    ["kniha", "Kniha výdajů"],
    ["archiv", "Archiv faktur"],
    ["material", "Podle materiálu"],
  ];
  return (
    <>
      <div className="podtabs">
        {podtaby.map(([id, l]) => (
          <button
            key={id}
            className="podtab"
            data-a={pod === id ? "1" : "0"}
            onClick={() => setPod(id)}
          >
            {l}
          </button>
        ))}
      </div>
      {pod === "kniha" && <Vydaje data={data} uloz={uloz} />}
      {pod === "archiv" && <Faktury data={data} uloz={uloz} />}
      {pod === "material" && <Temata data={data} uloz={uloz} v={v} />}
    </>
  );
}

function Faktury({ data, uloz }) {
  const [fotky, setFotky] = useState({});
  const [zvetsena, setZvetsena] = useState(null);
  const seznam = [...(data.faktury || [])].sort((a, b) =>
    a.datum < b.datum ? 1 : -1
  );

  useEffect(() => {
    let zivy = true;
    (async () => {
      const nove = {};
      for (const f of seznam.filter((x) => x.mafoto)) {
        if (fotky[f.id]) continue;
        try {
          const r = await ULOZISTE.get("fa:" + f.id, true);
          if (r && r.value) nove[f.id] = r.value;
        } catch (e) {}
      }
      if (zivy && Object.keys(nove).length) setFotky((x) => ({ ...x, ...nove }));
    })();
    return () => {
      zivy = false;
    };
  }, [seznam.length]);

  const nazevSouboru = (f) => {
    const cast = [
      (f.dodavatel || "doklad").replace(/[^\w\u00C0-\u017F-]+/g, "-"),
      f.cislo || "",
      datumCz(f.datum).replace(/\s/g, ""),
      f.celkem ? Math.round(f.celkem) : "",
    ].filter(Boolean);
    return cast.join("_") + ".jpg";
  };

  const stahni = (f) => {
    const obr = fotky[f.id];
    if (!obr) return;
    const a = document.createElement("a");
    a.href = obr;
    a.download = nazevSouboru(f);
    a.click();
  };

  const prepniDisk = (f) =>
    uloz({
      ...data,
      faktury: data.faktury.map((x) =>
        x.id === f.id ? { ...x, naDisku: !x.naDisku } : x
      ),
    });

  const smaz = async (f) => {
    try {
      await ULOZISTE.delete("fa:" + f.id, true);
    } catch (e) {}
    uloz({ ...data, faktury: data.faktury.filter((x) => x.id !== f.id) });
  };

  const ceka = seznam.filter((f) => f.mafoto && !f.naDisku);

  return (
    <>
      {ceka.length > 0 && (
        <div className="box" style={{ borderLeft: "5px solid #FFBA00" }}>
          <h2 className="boxh">
            <span className="hi">
              <i style={{ background: "#FFF2D0" }}>
                <Ik d={IKO.foto} c="#8A6100" s={16} />
              </i>
              K uložení na Disk
            </span>
            <span>
              {ceka.length} {pocetSlovem(ceka.length).split(" ")[1]}
            </span>
          </h2>
          <p className="pozn" style={{ marginTop: 0 }}>
            Tyhle fotky zatím leží jen v databázi. Stáhni je, nahraj na Disk a
            odškrtni — pak budou v plné kvalitě tam, kde mají být.
          </p>
        </div>
      )}

      <div className="box">
        <h2 className="boxh">
          <span className="hi">
            <i>
              <Ik d={IKO.ucet} c="#0C3B2E" s={16} />
            </i>
            Archiv faktur
          </span>
          <span>
            {seznam.length === 0
              ? "zatím prázdno"
              : `${seznam.length} dokladů · ${seznam.filter((f) => f.naDisku).length} na Disku`}
          </span>
        </h2>

        {seznam.length === 0 ? (
          <p className="prazdno">
            Zatím tu nic není. Vyfocené doklady se ukládají sem.
          </p>
        ) : (
          <div className="fakturyMriz">
            {seznam.map((f) => (
              <div className="fakturaKarta" key={f.id} data-disk={f.naDisku ? "1" : "0"}>
                {f.mafoto ? (
                  fotky[f.id] ? (
                    <img
                      className="fakturaFoto"
                      src={fotky[f.id]}
                      alt={f.dodavatel || "Doklad"}
                      onClick={() => setZvetsena(fotky[f.id])}
                    />
                  ) : (
                    <div className="fakturaFoto fakturaNacitam">načítám…</div>
                  )
                ) : (
                  <div className="fakturaFoto fakturaNacitam">bez fotky</div>
                )}

                <div className="fakturaText">
                  <b>{f.dodavatel || "Bez názvu"}</b>
                  <small className="n">
                    {datumCz(f.datum)}
                    {f.cislo ? " · " + f.cislo : ""}
                  </small>
                  <b className="n" style={{ fontSize: 15 }}>
                    {kc(f.celkem || 0)}
                  </b>
                </div>

                <label className="zustat" style={{ marginTop: 10, fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    checked={!!f.naDisku}
                    onChange={() => prepniDisk(f)}
                  />
                  Uloženo na Disk
                </label>

                <div className="rada" style={{ marginTop: 8 }}>
                  {f.mafoto && fotky[f.id] && (
                    <button className="btn2" onClick={() => stahni(f)}>
                      Stáhnout
                    </button>
                  )}
                  <Smazat co="tenhle doklad z archivu" onSmaz={() => smaz(f)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {zvetsena && (
        <div className="modal" onClick={() => setZvetsena(null)}>
          <div className="modalObsah" onClick={(e) => e.stopPropagation()}>
            <button className="x" onClick={() => setZvetsena(null)} aria-label="Zavřít">
              ×
            </button>
            <img src={zvetsena} alt="Doklad" style={{ width: "100%", borderRadius: 12 }} />
          </div>
        </div>
      )}
    </>
  );
}

function Temata({ data, uloz, v }) {
  const zmen = (t, hod) =>
    uloz({ ...data, planTema: { ...data.planTema, [t]: cislo(hod) } });
  const planCelkem = data.temata.reduce((a, t) => a + (data.planTema[t] || 0), 0);
  const skutCelkem = Object.values(v.skutTema).reduce((a, b) => a + b, 0);
  const max = Math.max(...data.temata.map((t) => v.skutTema[t] || 0), 1);
  const aktivni = data.temata.filter(
    (t) => (v.skutTema[t] || 0) > 0 || (data.planTema[t] || 0) > 0
  );
  const ostatni = data.temata.filter((t) => !aktivni.includes(t));

  const radek = (t) => {
    const p = data.planTema[t] || 0;
    const sk = v.skutTema[t] || 0;
    const roz = p - sk;
    return (
      <tr key={t}>
        <td style={{ fontWeight: 600 }}>{t}</td>
        <td>
          <input
            className="mini n"
            inputMode="decimal"
            value={data.planTema[t] || ""}
            placeholder="0"
            onChange={(e) => zmen(t, e.target.value)}
          />
        </td>
        <td className="r n nowrap">{kc(sk)}</td>
        <td
          className="r n nowrap"
          style={{ color: roz < 0 ? "#B03A2E" : "#3E6B4C", fontWeight: 650 }}
        >
          {p ? (roz >= 0 ? "+" : "") + kcKratce(roz) : "—"}
        </td>
        <td>
          <div className="pruh">
            <i
              style={{
                width: (sk / max) * 100 + "%",
                background: p && sk > p ? "#B03A2E" : "#6D9773",
              }}
            />
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="box" style={{ marginTop: 0 }}>
      <h2 className="boxh">
        Témata faktur
        <span className="n">plán {kc(planCelkem)} · skutečnost {kc(skutCelkem)}</span>
      </h2>
      <table className="t">
        <thead>
          <tr>
            <th>Téma</th>
            <th style={{ width: 100 }}>Plán</th>
            <th className="r">Skutečnost</th>
            <th className="r">Rozdíl</th>
            <th style={{ width: "26%" }}>Podíl</th>
          </tr>
        </thead>
        <tbody>
          {aktivni.map(radek)}
          {aktivni.length > 0 && ostatni.length > 0 && (
            <tr>
              <td colSpan={5} style={{ paddingTop: 14 }}>
                <span className="eyebrow">Zatím bez pohybu</span>
              </td>
            </tr>
          )}
          {ostatni.map(radek)}
        </tbody>
      </table>
      <p className="pozn">
        Do „Práce" se automaticky připočítává, co jsi {data.delnik.jmeno}ovi
        vyplatila. Materiál nakoupený přes něj sedí v tématu, které jsi u výdaje
        vybrala.
      </p>
    </div>
  );
}

function Delnik({ data, uloz, v }) {
  const [akce, setAkce] = useState(null);
  const s = spocitejDelnika(data);
  const formRef = useRef(null);

  useEffect(() => {
    if (!akce || !formRef.current) return;
    const t = setTimeout(() => {
      if (formRef.current)
        formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => clearTimeout(t);
  }, [akce]);

  const zavri = () => setAkce(null);

  return (
    <>
      <HlavaDelnika s={s} />

      <div className="karty" style={{ marginTop: 14 }}>
        <div className="karta">
          <small>{s.zbyvaVyplatit >= 0 ? "Za práci k výplatě" : "Zálohou napřed"}</small>
          <b className="n" style={{ color: s.zbyvaVyplatit < 0 ? "#B46617" : undefined }}>
            {s.zbyvaVyplatit < 0 ? "− " : ""}
            {kc(Math.abs(s.zbyvaVyplatit))}
          </b>
          <em>{s.hodinyCelkove} h odpracováno</em>
        </div>
        <div className="karta">
          <small>Faktury k proplacení</small>
          <b className="n" style={{ color: s.neproplacenoCelkem ? "#B46617" : undefined }}>
            {kc(s.neproplacenoCelkem)}
          </b>
          <em>{s.neproplacene.length} faktur</em>
        </div>
        <div className="karta">
          <small>{s.kVyplate >= 0 ? "Celkem mu dlužíme" : "Zbývá vyúčtovat"}</small>
          <b className="n" style={{ color: s.kVyplate < 0 ? "#B46617" : "#0C3B2E" }}>
            {s.kVyplate < 0 ? "− " : ""}
            {kc(Math.abs(s.kVyplate))}
          </b>
          {s.kVyplate < 0 && <em>prací ani fakturou nepokryto</em>}
        </div>
        <div className="karta">
          <small>Zálohy bez faktury</small>
          <b className="n" style={{ color: s.zalohyCekaCelkem ? "#8A6100" : undefined }}>
            {kc(s.zalohyCekaCelkem)}
          </b>
          <em>{s.zalohyCeka.length} plateb</em>
        </div>
        <div className="karta">
          <small>Nedoloženo z plateb</small>
          <b className="n" style={{ color: s.nedolozeno > 0 ? "#B03A2E" : "#3E6B4C" }}>
            {s.nedolozeno < 0 ? "− " : ""}
            {kc(Math.abs(s.nedolozeno))}
          </b>
          <em>
            {s.nedolozeno > 0
              ? "dokud nedoloží, je to dluh"
              : "vše doloženo"}
          </em>
        </div>
        <div className="karta">
          <small>Půjčky a osobní dluh</small>
          <b className="n" style={{ color: s.zbyvaDluh > 0 ? "#B03A2E" : "#3E6B4C" }}>
            {kc(s.zbyvaDluh)}
          </b>
          <em>odbydleno {kc(s.odbydleno)}</em>
        </div>
      </div>

      <div className="rozcest" style={{ marginTop: 14 }}>
        <button className="velkytlac" onClick={() => setAkce("platba")}>
          <span className="vikona" style={{ background: "#E4EDE5" }}>
            <Ik d={IKO.bankovka} c="#0C3B2E" s={22} />
          </span>
          <b>Zapsat platbu</b>
          <small>poslali jsme mu peníze</small>
        </button>
        <button className="velkytlac" onClick={() => setAkce("prace")}>
          <span className="vikona" style={{ background: "#F1E8D8" }}>
            <Ik d={IKO.kladivo} c="#8A6A3C" s={22} />
          </span>
          <b>Zapsat práci</b>
          <small>za něj, bez schvalování</small>
        </button>
        <button className="velkytlac" onClick={() => setAkce("faktura")}>
          <span className="vikona" style={{ background: "#F7E7D6" }}>
            <Ik d={IKO.ucet} c="#B46617" s={22} />
          </span>
          <b>Přidat fakturu</b>
          <small>materiál, který koupil</small>
        </button>
        <button className="velkytlac" onClick={() => setAkce("dluh")}>
          <span className="vikona" style={{ background: "#EFE8D6" }}>
            <Ik d={IKO.mince} c="#B03A2E" s={22} />
          </span>
          <b>Přidat dluh</b>
          <small>co si u nás půjčil</small>
        </button>
      </div>

      <div ref={formRef} style={{ scrollMarginTop: 70 }}>
        {akce === "platba" && <FormPlatba data={data} uloz={uloz} s={s} zavri={zavri} />}
        {akce === "prace" && <FormPraceZaNej data={data} uloz={uloz} s={s} zavri={zavri} />}
        {akce === "faktura" && <FormFakturaZaNej data={data} uloz={uloz} zavri={zavri} />}
        {akce === "dluh" && <FormDluh data={data} uloz={uloz} s={s} zavri={zavri} />}
      </div>

      {s.vyplaceno > 0 && (
        <div className="box" style={{ borderLeft: "5px solid #6D9773" }}>
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.stit} c="#0C3B2E" s={16} />
              </i>
              Co z poslaných peněz doložil?
            </span>
            <span className="n">posláno {kc(s.vyplaceno)}</span>
          </h2>
          <div className="doklBar">
            <i
              style={{
                width: (s.dolozenoFakturami / s.vyplaceno) * 100 + "%",
                background: "#B46617",
              }}
              title="Doloženo fakturami"
            />
            <i
              style={{
                width: (Math.max(0, Math.min(s.odpracovano, s.vyplaceno - s.dolozenoFakturami)) / s.vyplaceno) * 100 + "%",
                background: "#6D9773",
              }}
              title="Doloženo prací"
            />
            <i
              style={{
                width: (Math.max(0, s.nevysvetleno) / s.vyplaceno) * 100 + "%",
                background: "#E0D5BF",
              }}
              title="Zatím nevysvětleno"
            />
          </div>
          <table className="t" style={{ marginTop: 14 }}>
            <tbody>
              <tr>
                <td style={{ width: 18 }}>
                  <span className="tecka" style={{ background: "#B46617" }} />
                </td>
                <td>Doloženo fakturami za materiál</td>
                <td className="r n nowrap" style={{ fontWeight: 800 }}>
                  {kc(s.dolozenoFakturami)}
                </td>
              </tr>
              <tr>
                <td>
                  <span className="tecka" style={{ background: "#6D9773" }} />
                </td>
                <td>
                  Doloženo odpracovanými hodinami
                  <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                    {s.hodinyCelkove} h podle pracovního deníku
                  </span>
                </td>
                <td className="r n nowrap" style={{ fontWeight: 800 }}>
                  {kc(s.odpracovano)}
                </td>
              </tr>
              <tr style={{ borderTop: "1.5px solid #D8CDB6" }}>
                <td />
                <td style={{ fontWeight: 800, paddingTop: 9 }}>
                  Materiál + práce dohromady
                </td>
                <td className="r n nowrap" style={{ fontWeight: 800, paddingTop: 9 }}>
                  {kc(s.podlozeno)}
                </td>
              </tr>
              <tr>
                <td />
                <td style={{ color: "#5E7268" }}>Posláno mu celkem</td>
                <td className="r n nowrap" style={{ color: "#5E7268" }}>
                  − {kc(s.vyplaceno)}
                </td>
              </tr>
              <tr style={{ borderTop: "2px solid #C9AE85" }}>
                <td>
                  <span className="tecka" style={{ background: "#E0D5BF" }} />
                </td>
                <td style={{ fontWeight: 800, paddingTop: 11 }}>
                  {s.nedolozeno > 0 ? "Nedoloženo — bere se jako dluh" : "Odpracováno nad rámec plateb"}
                </td>
                <td
                  className="r n nowrap"
                  style={{
                    fontWeight: 800,
                    paddingTop: 11,
                    color: s.nedolozeno > 0 ? "#B03A2E" : "#3E6B4C",
                  }}
                >
                  {kc(Math.abs(s.nedolozeno))}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="pozn">
            {s.nedolozeno > 0
              ? `Na ${kc(s.nedolozeno)} zatím nejsou podklady. Bere se to jako jeho dluh, dokud je nedoloží — odpracovanými hodinami nebo fakturou za materiál. Jak budeš doplňovat pracovní deník, částka bude klesat.`
              : `Podklady pokrývají všechno, co jste poslali. ${kc(-s.nedolozeno)} je práce navíc, kterou mu ještě dlužíte.`}
          </p>
        </div>
      )}

      {s.zalohyCeka.length > 0 && (
        <div className="box">
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.ucet} c="#0C3B2E" s={16} />
              </i>
              Zálohy čekající na fakturu
            </span>
            <span className="n">{kc(s.zalohyCekaCelkem)}</span>
          </h2>
          <table className="t">
            <tbody>
              {s.zalohyCeka.map((z) => (
                <tr key={z.id}>
                  <td className="n nowrap" style={{ color: "#5E7268" }}>
                    {datumCz(z.datum)}
                  </td>
                  <td>{z.popis}</td>
                  <td className="r n nowrap" style={{ fontWeight: 700 }}>
                    {kc(z.castka)}
                  </td>
                  <td>
                    <Smazat
                      co="tuto zálohu"
                      onSmaz={() =>
                        uloz({
                          ...data,
                          zalohy: (data.zalohy || []).filter((x) => x.id !== z.id),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pozn">
            Tyhle peníze už z účtu odešly, ale nejsou zařazené do žádné
            kategorie. Zařadí se, až {data.delnik.jmeno} dodá fakturu a ty ji
            při schvalování navážeš na zálohu.
          </p>
        </div>
      )}

      <PrehledDelnik data={data} s={s} uloz={uloz} bezHlavy />

      <div className="box">
        <h2 className="boxh">
          <span className="hi">
            <i>
              <Ik d={IKO.graf} c="#0C3B2E" s={16} />
            </i>
            Kniha zápisů
          </span>
          <span>{data.zaznamy.length} záznamů</span>
        </h2>
        {data.zaznamy.length === 0 ? (
          <p className="prazdno">Zatím žádný zápis.</p>
        ) : (
          <table className="t">
            <tbody>
              {[...data.zaznamy]
                .sort((a, b) => (a.datum < b.datum ? 1 : -1))
                .map((z) => {
                  const meta = TYP_Z[z.typ] || TYP_Z.prace;
                  const u = data.ukoly.find((x) => x.id === z.ukol);
                  return (
                    <tr key={z.id}>
                      <td style={{ width: 30 }}>
                        <span className="znak" style={{ color: "#fff", background: meta.barva }}>
                          {meta.znak}
                        </span>
                      </td>
                      <td className="n nowrap" style={{ color: "#5E7268" }}>
                        {datumCz(z.datum)}
                      </td>
                      <td>
                        {z.popis || meta.label}
                        <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                          {meta.label}
                          {u ? " · " + u.nazev : ""}
                          {z.hodiny ? ` · ${hodinyCelkem(z.hodiny)} h` : ""}
                        </span>
                      </td>
                      <td className="r n nowrap" style={{ fontWeight: 700 }}>
                        {kc(z.castka)}
                      </td>
                      <td style={{ width: 30 }}>
                        <Smazat
                          co="tento zápis"
                          onSmaz={() =>
                            uloz({
                              ...data,
                              zaznamy: data.zaznamy.filter((x) => x.id !== z.id),
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function FormPlatba({ data, uloz, s, zavri }) {
  const [f, setF] = useState({
    datum: dnes(),
    zaPraci: "",
    zDluhu: "",
    popis: "",
    zdroj: "hypoteka",
    zaloha: "",
    zalohaNaCo: "",
  });
  const [vybrane, setVybrane] = useState({});

  const sumaFa = s.neproplacene
    .filter((p) => vybrane[p.id])
    .reduce((a, p) => a + p.castka, 0);
  const zaPraci = cislo(f.zaPraci);
  const zDluhu = cislo(f.zDluhu);
  const zaloha = cislo(f.zaloha);
  const odeslano = zaPraci + sumaFa + zaloha;

  const zapis = () => {
    if (odeslano <= 0 && zDluhu <= 0) return;
    const nove = [];
    if (zaPraci > 0)
      nove.push({
        id: uid(),
        datum: f.datum,
        typ: "platba",
        castka: zaPraci,
        popis: f.popis.trim() || "platba za práci",
        ukol: null,
        zdroj: f.zdroj,
      });
    if (zDluhu > 0)
      nove.push({
        id: uid(),
        datum: f.datum,
        typ: "dluh",
        castka: zDluhu,
        popis: f.popis.trim() || "sraženo z platby",
        zdroj: f.zdroj,
      });
    const polozky = data.polozky.map((p) =>
      vybrane[p.id]
        ? { ...p, proplaceno: true, datumProplaceni: f.datum, zdroj: f.zdroj }
        : p
    );
    const zalohy = [...(data.zalohy || [])];
    if (zaloha > 0)
      zalohy.push({
        id: uid(),
        datum: f.datum,
        castka: zaloha,
        popis: f.zalohaNaCo.trim() || "materiál",
        zdroj: f.zdroj,
      });
    uloz({ ...data, zaznamy: [...data.zaznamy, ...nove], polozky, zalohy });
    zavri();
  };

  return (
    <div className="box" style={{ borderLeft: "5px solid #6D9773" }}>
      <h2 className="boxh">
        <span className="hi">
          <i>
            <Ik d={IKO.bankovka} c="#0C3B2E" s={16} />
          </i>
          Zapsat platbu {data.delnik.jmeno}ovi
        </span>
        <button className="x" onClick={zavri} aria-label="Zavřít">
          ×
        </button>
      </h2>

      <div className="form">
        <div className="pole">
          <label>Datum</label>
          <input type="date" value={f.datum} onChange={(e) => setF({ ...f, datum: e.target.value })} />
        </div>
        <div className="pole">
          <label>Kolik za práci</label>
          <input
            className="n"
            inputMode="decimal"
            value={f.zaPraci}
            onChange={(e) => setF({ ...f, zaPraci: e.target.value })}
          />
        </div>
        <div className="pole">
          <label>Kolik strháváme z dluhu</label>
          <input
            className="n"
            inputMode="decimal"
            value={f.zDluhu}
            onChange={(e) => setF({ ...f, zDluhu: e.target.value })}
          />
        </div>
        <div className="pole">
          <label>Placeno z</label>
          <select value={f.zdroj} onChange={(e) => setF({ ...f, zdroj: e.target.value })}>
            {Object.entries(ZDROJ).map(([k, z]) => (
              <option key={k} value={k}>
                {z.label}
              </option>
            ))}
          </select>
        </div>
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Poznámka</label>
          <input
            value={f.popis}
            placeholder="např. převod na účet"
            onChange={(e) => setF({ ...f, popis: e.target.value })}
          />
        </div>
      </div>

      <div className="rada" style={{ marginTop: 10 }}>
        <button
          className="btn2"
          onClick={() => setF({ ...f, zaPraci: String(Math.max(0, s.zbyvaVyplatit)) })}
        >
          Doplnit vše za práci ({kc(s.zbyvaVyplatit)})
        </button>
        {s.zbyvaDluh > 0 && (
          <button
            className="btn2"
            onClick={() => setF({ ...f, zDluhu: String(Math.min(s.zbyvaDluh, Math.max(0, s.zbyvaVyplatit))) })}
          >
            Strhnout maximum z dluhu
          </button>
        )}
      </div>

      <h3 className="eyebrow" style={{ marginTop: 20, marginBottom: 9 }}>
        Které faktury proplácíme
      </h3>
      {s.neproplacene.length === 0 ? (
        <p className="prazdno" style={{ padding: "8px 0" }}>
          Žádná faktura nečeká na proplacení.
        </p>
      ) : (
        <table className="t">
          <tbody>
            {s.neproplacene.map((p) => {
              const u = data.ukoly.find((x) => x.id === p.ukol);
              return (
                <tr key={p.id}>
                  <td style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      checked={!!vybrane[p.id]}
                      onChange={() => setVybrane({ ...vybrane, [p.id]: !vybrane[p.id] })}
                      style={{ width: 16, height: 16, accentColor: "#0C3B2E" }}
                      aria-label={"Proplatit " + p.popis}
                    />
                  </td>
                  <td className="n nowrap" style={{ color: "#5E7268" }}>
                    {datumCz(p.datum)}
                  </td>
                  <td>
                    {p.popis}
                    <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                      {u ? u.nazev : "bez kategorie"}
                    </span>
                  </td>
                  <td className="r n nowrap" style={{ fontWeight: 700 }}>
                    {kc(p.castka)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3 className="eyebrow" style={{ marginTop: 20, marginBottom: 9 }}>
        Záloha na materiál — fakturu dodá {data.delnik.jmeno}
      </h3>
      <div className="form">
        <div className="pole">
          <label>Částka zálohy</label>
          <input
            className="n"
            inputMode="decimal"
            value={f.zaloha}
            onChange={(e) => setF({ ...f, zaloha: e.target.value })}
          />
        </div>
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Za co to má být</label>
          <input
            value={f.zalohaNaCo}
            placeholder="např. sádrokarton a profily"
            onChange={(e) => setF({ ...f, zalohaNaCo: e.target.value })}
          />
        </div>
      </div>
      {zaloha > 0 && (
        <div className="hlaska">
          {data.delnik.jmeno}ovi se v aplikaci objeví upozornění, že tahle
          záloha čeká na svou fakturu. Do kategorií se částka započítá, až
          fakturu dodá.
        </div>
      )}

      <div className="soucet">
        <span>
          práce {kc(zaPraci)} + faktury {kc(sumaFa)}
          {zaloha > 0 ? ` + záloha ${kc(zaloha)}` : ""}
          {zDluhu > 0 ? ` · z dluhu strženo ${kc(zDluhu)}` : ""}
        </span>
        <b className="n">{kc(odeslano)}</b>
      </div>
      <p className="pozn">
        Velké číslo je částka, která reálně odejde z účtu. Sražený dluh se
        neposílá — jen se odečte z toho, co mu dlužíte za práci.
      </p>

      <div className="rada">
        <button className="btn" onClick={zapis} disabled={odeslano <= 0 && zDluhu <= 0}>
          Zapsat platbu
        </button>
        <button className="btn2" onClick={zavri}>
          Zrušit
        </button>
      </div>
    </div>
  );
}

function FormPraceZaNej({ data, uloz, s, zavri }) {
  const [f, setF] = useState({ datum: dnes(), ukol: "", popis: "", stavPrace: "" });
  const [hodiny, setHodiny] = useState({});
  const sazba = s.sazba;
  const celkem = hodinyCelkem(hodiny);
  const castkaCelkem = castkaZaHodiny(data, hodiny);

  const zapis = () => {
    if (!celkem) return;
    const cisty = {};
    (data.pracanti || []).forEach((p) => {
      const h = cislo(hodiny[p.id]);
      if (h > 0) cisty[p.id] = h;
    });
    uloz({
      ...data,
      zaznamy: [
        ...data.zaznamy,
        {
          id: uid(),
          datum: f.datum,
          typ: "prace",
          popis: f.popis.trim() || "práce",
          stavPrace: f.stavPrace.trim(),
          ukol: f.ukol || null,
          castka: castkaZaHodiny(data, cisty),
          hodiny: cisty,
          zdroj: "hypoteka",
        },
      ],
    });
    zavri();
  };

  return (
    <div className="box" style={{ borderLeft: "5px solid #C9AE85" }}>
      <h2 className="boxh">
        <span className="hi">
          <i>
            <Ik d={IKO.kladivo} c="#0C3B2E" s={16} />
          </i>
          Zapsat práci za {data.delnik.jmeno}u
        </span>
        <button className="x" onClick={zavri} aria-label="Zavřít">
          ×
        </button>
      </h2>
      <div className="form">
        <div className="pole">
          <label>Datum</label>
          <input type="date" value={f.datum} onChange={(e) => setF({ ...f, datum: e.target.value })} />
        </div>
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Kategorie</label>
          <VyberKategorie
            ukoly={data.ukoly}
            hodnota={f.ukol}
            onZmena={(id) => setF({ ...f, ukol: id })}
          />
        </div>
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Co se dělalo</label>
          <input
            value={f.popis}
            placeholder="např. špalety okna ložnice"
            onChange={(e) => setF({ ...f, popis: e.target.value })}
          />
        </div>
        <div className="pole">
          <label>Stav úkolu</label>
          <input
            value={f.stavPrace}
            placeholder="jsme v polovině…"
            onChange={(e) => setF({ ...f, stavPrace: e.target.value })}
          />
        </div>
      </div>

      <div className="hodinari" style={{ marginTop: 16 }}>
        {(data.pracanti || []).filter((p) => p.aktivni !== false).map((p) => (
          <div className="hodinar" key={p.id}>
            <label htmlFor={"oh-" + p.id}>
              {p.jmeno}
              <span className="hodSazba n">{sazbaPracanta(data, p.id)} Kč/h</span>
            </label>
            <input
              id={"oh-" + p.id}
              className="n"
              inputMode="decimal"
              placeholder="0"
              value={hodiny[p.id] || ""}
              onChange={(e) => setHodiny({ ...hodiny, [p.id]: e.target.value })}
            />
            <span>hod</span>
          </div>
        ))}
      </div>

      <div className="soucet">
        <span>{celkem} h</span>
        <b className="n">{kc(castkaCelkem)}</b>
      </div>

      <div className="rada">
        <button className="btn" onClick={zapis} disabled={!celkem}>
          Zapsat práci
        </button>
        <button className="btn2" onClick={zavri}>
          Zrušit
        </button>
      </div>
    </div>
  );
}

function FormFakturaZaNej({ data, uloz, zavri }) {
  const [f, setF] = useState({
    datum: dnes(),
    dodavatel: "",
    cisloDokladu: "",
    popis: "",
    castka: "",
    ukol: "",
    tema: data.temata[0],
    proplaceno: false,
    zdroj: "hypoteka",
  });

  const zapis = () => {
    const c = cislo(f.castka);
    if (!c) return;
    uloz({
      ...data,
      polozky: [
        ...data.polozky,
        {
          id: uid(),
          datum: f.datum,
          popis: f.popis.trim() || "Materiál",
          dodavatel: f.dodavatel.trim(),
          cisloDokladu: f.cisloDokladu.trim(),
          tema: f.tema,
          ukol: f.ukol || null,
          castka: c,
          zdroj: f.zdroj,
          pres: true,
          dolozeno: true,
          proplaceno: f.proplaceno,
        },
      ],
    });
    zavri();
  };

  return (
    <div className="box" style={{ borderLeft: "5px solid #B46617" }}>
      <h2 className="boxh">
        <span className="hi">
          <i>
            <Ik d={IKO.ucet} c="#0C3B2E" s={16} />
          </i>
          Faktura, kterou koupil {data.delnik.jmeno}
        </span>
        <button className="x" onClick={zavri} aria-label="Zavřít">
          ×
        </button>
      </h2>
      <div className="form">
        <div className="pole">
          <label>Datum</label>
          <input type="date" value={f.datum} onChange={(e) => setF({ ...f, datum: e.target.value })} />
        </div>
        <div className="pole">
          <label>Kde nakoupil</label>
          <input value={f.dodavatel} onChange={(e) => setF({ ...f, dodavatel: e.target.value })} />
        </div>
        <div className="pole">
          <label>Číslo dokladu</label>
          <input
            className="n"
            value={f.cisloDokladu}
            onChange={(e) => setF({ ...f, cisloDokladu: e.target.value })}
          />
        </div>
        <div className="pole">
          <label>Částka</label>
          <input
            className="n"
            inputMode="decimal"
            value={f.castka}
            onChange={(e) => setF({ ...f, castka: e.target.value })}
          />
        </div>
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Kategorie</label>
          <VyberKategorie
            ukoly={data.ukoly}
            hodnota={f.ukol}
            onZmena={(id) => setF({ ...f, ukol: id })}
          />
        </div>
        <div className="pole">
          <label>Druh materiálu</label>
          <select value={f.tema} onChange={(e) => setF({ ...f, tema: e.target.value })}>
            {data.temata.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Popis</label>
          <input
            value={f.popis}
            placeholder="např. extrudovaný polystyren 80 mm"
            onChange={(e) => setF({ ...f, popis: e.target.value })}
          />
        </div>
        <label className="chk">
          <input
            type="checkbox"
            checked={f.proplaceno}
            onChange={(e) => setF({ ...f, proplaceno: e.target.checked })}
          />
          Už jsme mu to proplatili
        </label>
        {f.proplaceno && (
          <div className="pole">
            <label>Placeno z</label>
            <select value={f.zdroj} onChange={(e) => setF({ ...f, zdroj: e.target.value })}>
              {Object.entries(ZDROJ).map(([k, z]) => (
                <option key={k} value={k}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p className="pozn">
        Dokud není proplaceno, počítá se to jako částka, kterou{" "}
        {data.delnik.jmeno}ovi dlužíte — z účtu ještě nic neodešlo.
      </p>
      <div className="rada">
        <button className="btn" onClick={zapis} disabled={!cislo(f.castka)}>
          Zapsat fakturu
        </button>
        <button className="btn2" onClick={zavri}>
          Zrušit
        </button>
      </div>
    </div>
  );
}

function FormDluh({ data, uloz, s, zavri }) {
  const [f, setF] = useState({
    obdobi: "",
    popis: "",
    castka: "",
    poznamka: "",
    typ: "pricist",
  });
  const dluhy = s.dluhPolozky;

  const ulozDluhy = (nove) =>
    uloz({ ...data, delnik: { ...data.delnik, dluh: 0, dluhPolozky: nove } });

  const pridej = () => {
    const c = cislo(f.castka);
    if (!c || !f.popis.trim()) return;
    ulozDluhy([
      ...dluhy,
      {
        id: uid(),
        datum: "",
        obdobi: f.obdobi.trim() || "Neuvedeno",
        popis: f.popis.trim(),
        castka: f.typ === "odmazat" ? -Math.abs(c) : Math.abs(c),
        poznamka: f.poznamka.trim(),
        doplnit: false,
      },
    ]);
    setF({ obdobi: "", popis: "", castka: "", poznamka: "", typ: "pricist" });
  };

  const zmen = (id, pole, hod) =>
    ulozDluhy(dluhy.map((d) => (d.id === id ? { ...d, [pole]: hod, doplnit: false } : d)));

  const chybi = dluhy.filter((d) => d.doplnit);

  return (
    <div className="box" style={{ borderLeft: "5px solid #B03A2E" }}>
      <h2 className="boxh">
        <span className="hi">
          <i>
            <Ik d={IKO.mince} c="#0C3B2E" s={16} />
          </i>
          Půjčky a osobní dluh — {data.delnik.jmeno}
        </span>
        <button className="x" onClick={zavri} aria-label="Zavřít">
          ×
        </button>
      </h2>

      {dluhy.length === 0 && (
        <>
          <p style={{ fontSize: 14, marginTop: 0 }}>
            Zatím tu nic není. Můžeš načíst připravený seznam —{" "}
            {DLUH_SEZNAM.length} položek.
          </p>
          <div className="rada" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => ulozDluhy(dluhZeSeznamu())}>
              Načíst připravený seznam
            </button>
          </div>
        </>
      )}

      {dluhy.length > 0 && (
        <>
          <div className="dluhSouhrn">
            <div>
              <span className="eyebrow">Přičteno</span>
              <b className="n">{kc(s.dluhPripsano)}</b>
            </div>
            <div>
              <span className="eyebrow">Odmazáno</span>
              <b className="n" style={{ color: "#3E6B4C" }}>
                {kc(s.dluhOdmazano + s.odbydleno)}
              </b>
            </div>
            <div>
              <span className="eyebrow">Zbývá</span>
              <b className="n" style={{ color: s.zbyvaDluh > 0 ? "#B03A2E" : "#3E6B4C" }}>
                {kc(s.zbyvaDluh)}
              </b>
            </div>
          </div>

          {chybi.length > 0 && (
            <div className="hlaska">
              U {chybi.length} položek chybí vysvětlení, za co byly. Přepiš jim
              název, až to dohledáte — příznak pak zmizí.
            </div>
          )}

          <table className="t" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Období</th>
                <th>Za co</th>
                <th className="r" style={{ width: 110 }}>Částka</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dluhy.map((d) => (
                <tr key={d.id} style={d.doplnit ? { background: "#FFF8E6" } : undefined}>
                  <td>
                    <input
                      className="mini"
                      value={d.obdobi || ""}
                      placeholder="kdy"
                      onChange={(e) => zmen(d.id, "obdobi", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="mini"
                      value={d.popis}
                      style={d.doplnit ? { borderColor: "#B46617" } : undefined}
                      onChange={(e) => zmen(d.id, "popis", e.target.value)}
                    />
                    {(d.poznamka || d.doplnit) && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 11.5,
                          marginTop: 3,
                          color: d.doplnit ? "#B46617" : "#5E7268",
                        }}
                      >
                        {d.poznamka}
                      </span>
                    )}
                  </td>
                  <td className="r">
                    <input
                      className="mini n"
                      inputMode="decimal"
                      style={{
                        textAlign: "right",
                        fontWeight: 700,
                        color: d.castka < 0 ? "#3E6B4C" : undefined,
                      }}
                      value={d.castka}
                      onChange={(e) => zmen(d.id, "castka", cislo(e.target.value) * (String(e.target.value).trim().startsWith("-") ? -1 : 1))}
                    />
                  </td>
                  <td style={{ width: 30 }}>
                    <Smazat
                      co="tuto položku dluhu"
                      onSmaz={() => ulozDluhy(dluhy.filter((x) => x.id !== d.id))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3 className="eyebrow" style={{ marginTop: 20, marginBottom: 9 }}>
        Přidat položku
      </h3>
      <div className="form">
        <div className="pole">
          <label>Období</label>
          <input
            value={f.obdobi}
            placeholder="např. Duben"
            onChange={(e) => setF({ ...f, obdobi: e.target.value })}
          />
        </div>
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Za co</label>
          <input
            value={f.popis}
            placeholder="např. půjčka na auto"
            onChange={(e) => setF({ ...f, popis: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && pridej()}
          />
        </div>
        <div className="pole">
          <label>Přičíst nebo odmazat</label>
          <select value={f.typ} onChange={(e) => setF({ ...f, typ: e.target.value })}>
            <option value="pricist">Přičíst k dluhu</option>
            <option value="odmazat">Odmazat z dluhu</option>
          </select>
        </div>
        <div className="pole">
          <label>Částka</label>
          <input
            className="n"
            inputMode="decimal"
            value={f.castka}
            onChange={(e) => setF({ ...f, castka: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && pridej()}
          />
        </div>
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Poznámka</label>
          <input
            value={f.poznamka}
            placeholder="např. kdo to platil"
            onChange={(e) => setF({ ...f, poznamka: e.target.value })}
          />
        </div>
        <button className="btn" onClick={pridej}>
          Přidat
        </button>
      </div>
      <p className="pozn">
        Rozpis {data.delnik.jmeno} uvidí ve svém přehledu pod „Za co všechno to
        je". „Odmazat z dluhu" použij na to, co si už odpracoval mimo stavbu —
        práce na stavbě se odečítá sama přes platby.
      </p>
      <div className="rada">
        <button className="btn2" onClick={zavri}>
          Hotovo
        </button>
      </div>
    </div>
  );
}

const POZDRAVY = [
  "Vítej zpět, kapitáne!",
  "Buenos días, señor {k}ovski!",
  "Nazdar, {k}ovski!",
  "Hola, amigo {j}!",
  "Čauko, {k}í!",
  "Servus, pane {k}ovský!",
  "Zdravíčko, mistře!",
  "Don {k}os přichází!",
  "Zdar jak sviňa!",
  "Bonjour, monsieur {k}é!",
  "Vítejte v práci, pane {k}astře!",
  "Dobré jitro, lorde {k}ingtone!",
  "Achtung, {k}meister dorazil!",
  "Vítej v dalším dílu seriálu \u201e{j} pracuje\u201c.",
  "Tak jdeme makat, Don Pablo {k}ovski!",
];

// Utne koncovou samohlásku, aby šlo přilepit koncovku
function kmenJmena(j) {
  return String(j || DEFAULT.delnik.jmeno).replace(/[aeiouyáéíóúůýě]$/i, "");
}

function nahodnyPozdrav(jmeno) {
  const j = jmeno || DEFAULT.delnik.jmeno;
  const p = POZDRAVY[Math.floor(Math.random() * POZDRAVY.length)];
  return p.replace(/\{k\}/g, kmenJmena(j)).replace(/\{j\}/g, j);
}

const MESICE_CZ = [
  "leden", "únor", "březen", "duben", "květen", "červen",
  "červenec", "srpen", "září", "říjen", "listopad", "prosinec",
];

function mesicNazev(klic) {
  if (!klic) return "";
  const [r, m] = klic.split("-");
  return MESICE_CZ[Number(m) - 1] + " " + r;
}

function hodinyCelkem(h) {
  return Object.values(h || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

function spocitejDelnika(data) {
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

function AppDelnik({ data, uloz, zpet }) {
  const [kde, setKde] = useState("rozcestnik");
  const [pozdrav] = useState(() => nahodnyPozdrav(data.delnik.jmeno));
  const vracene = (data.cekajici || []).filter(
    (z) => z.stav === "vraceno" && z.videno === false
  );
  const [vraceneVidet, setVraceneVidet] = useState(true);

  const potvrdVracene = () => {
    uloz({
      ...data,
      cekajici: (data.cekajici || []).map((z) =>
        z.stav === "vraceno" && z.videno === false ? { ...z, videno: true } : z
      ),
    });
    setVraceneVidet(false);
  };
  const s = spocitejDelnika(data);
  const ceka = (data.cekajici || []).filter((z) => z.stav === "ceka").length;

  const [oprava, setOprava] = useState(null);
  const [zalohaK, setZalohaK] = useState(null);

  const posli = (zaznam) => {
    const jeUprava =
      zaznam.id && (data.cekajici || []).some((x) => x.id === zaznam.id);
    if (jeUprava) {
      uloz({
        ...data,
        cekajici: data.cekajici.map((x) =>
          x.id === zaznam.id
            ? {
                ...x,
                ...zaznam,
                stav: "ceka",
                poznamka: "",
                videno: true,
                vytvoreno: new Date().toISOString(),
              }
            : x
        ),
      });
    } else {
      uloz({
        ...data,
        cekajici: [
          ...(data.cekajici || []),
          {
            ...zaznam,
            id: zaznam.id || uid(),
            stav: "ceka",
            vytvoreno: new Date().toISOString(),
          },
        ],
      });
    }
    setOprava(null);
    setZalohaK(null);
  };

  const spustOpravu = (z) => {
    setOprava(z);
    setKde(z.druh === "faktura" ? "faktura" : "denik");
    setVraceneVidet(false);
    if (z.videno === false) {
      uloz({
        ...data,
        cekajici: (data.cekajici || []).map((x) =>
          x.id === z.id ? { ...x, videno: true } : x
        ),
      });
    }
  };

  const vsechnyVracene = (data.cekajici || []).filter((z) => z.stav === "vraceno");

  return (
    <div className="sd">
      <style>{CSS}</style>
      <div className="wrap" style={{ maxWidth: 640 }}>
        <header className="hlava">
          <div className="eyebrow">Pracovní deník · {data.nazev}</div>
          <h1 className="nazev">
            {kde === "rozcestnik"
              ? pozdrav
              : kde === "denik"
              ? "Pracovní deník"
              : kde === "faktura"
              ? "Přidat fakturu"
              : "Celkový přehled"}
          </h1>
        </header>

        {kde !== "rozcestnik" && (
          <div className="rada" style={{ marginTop: 14 }}>
            <button
              className="btn2"
              onClick={() => {
                setOprava(null);
                setKde("rozcestnik");
              }}
            >
              ← Zpátky na rozcestník
            </button>
          </div>
        )}

        {kde === "rozcestnik" && (
          <>
            <div className="mesicpas">
              <div>
                <span className="eyebrow">{mesicNazev(s.tentoMesic)}</span>
                <b className="n">{s.hodinyMesic} h</b>
                <small className="n">{kc(s.hodinyMesic * s.sazba)}</small>
              </div>
              {s.zbyvaVyplatit > 0 && (
                <div className="mesicpravo">
                  <span className="eyebrow">K výplatě</span>
                  <b className="n">{kc(s.zbyvaVyplatit)}</b>
                </div>
              )}
            </div>

            <div className="rozcest">
              <button className="velkytlac" onClick={() => setKde("denik")}>
                <span className="vikona" style={{ background: "#E4EDE5" }}>
                  <Ik d={IKO.hodiny} c="#0C3B2E" s={24} />
                </span>
                <b>Pracovní deník</b>
                <small>zapsat hodiny · {s.sazba} Kč/h</small>
              </button>
              <button className="velkytlac" onClick={() => setKde("faktura")}>
                <span className="vikona" style={{ background: "#F7E7D6" }}>
                  <Ik d={IKO.ucet} c="#B46617" s={24} />
                </span>
                <b>Přidat fakturu</b>
                <small>za nakoupený materiál</small>
              </button>
              <button className="velkytlac" onClick={() => setKde("prehled")}>
                <span className="vikona" style={{ background: "#FFF2D0" }}>
                  <Ik d={IKO.graf} c="#8A6100" s={24} />
                </span>
                <b>Celkový přehled</b>
                <small>hodiny, platby, dluh</small>
              </button>
            </div>

            <ZalohyBlok
              s={s}
              onZadat={(z) => {
                setOprava(null);
                setZalohaK(z);
                setKde("faktura");
              }}
            />

            {vsechnyVracene.length > 0 && (
              <div className="box">
                <h2 className="boxh">
                  <span className="hi">
                    <i>
                      <Ik d={IKO.ucet} c="#B03A2E" s={16} />
                    </i>
                    Vrácené k opravě
                  </span>
                </h2>
                <table className="t">
                  <tbody>
                    {vsechnyVracene.map((z) => (
                      <tr key={z.id}>
                        <td className="n nowrap" style={{ color: "#5E7268" }}>
                          {datumCz(z.datum)}
                        </td>
                        <td>
                          {z.druh === "faktura"
                            ? `Faktura ${z.dodavatel || ""}`
                            : `${hodinyCelkem(z.hodiny)} h — ${z.popis || "práce"}`}
                          <span style={{ display: "block", fontSize: 12, color: "#B03A2E", fontWeight: 700 }}>
                            {z.poznamka}
                          </span>
                        </td>
                        <td className="r">
                          <button className="btn2" onClick={() => spustOpravu(z)}>
                            Opravit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {ceka > 0 && (
              <div className="hlaska">
                {ceka} {ceka === 1 ? "zápis čeká" : "zápisů čeká"} na potvrzení.
                Do přehledu se započítá, jakmile ho potvrdí.
              </div>
            )}

            <div className="rada">
              <button className="btn2" onClick={zpet}>
                Odhlásit
              </button>
            </div>
          </>
        )}

        {vracene.length > 0 && vraceneVidet && (
          <div className="modal" onClick={() => setVraceneVidet(false)}>
            <div
              className="modalkarta"
              style={{ borderTopColor: "#B03A2E" }}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="modalik" style={{ background: "#F7DED9" }}>
                <Ik d={IKO.ucet} c="#B03A2E" s={30} w={1.9} />
              </span>
              <h2 className="modalnadpis">
                {vracene.length === 1
                  ? vracene[0].druh === "faktura"
                    ? "Byla ti vrácena faktura"
                    : "Byl ti vrácen zápis hodin"
                  : "Máš vrácené zápisy"}
              </h2>
              {vracene.map((z) => (
                <div className="vraceno" key={z.id}>
                  <b>
                    {datumCz(z.datum)} ·{" "}
                    {z.druh === "faktura"
                      ? `faktura ${z.dodavatel || ""} ${z.castka ? kc(z.castka) : ""}`
                      : `${hodinyCelkem(z.hodiny)} h — ${z.popis || "práce"}`}
                  </b>
                  <span>z důvodu: {z.poznamka}</span>
                  <button
                    className="btn2"
                    style={{ marginTop: 9 }}
                    onClick={() => spustOpravu(z)}
                  >
                    Opravit teď
                  </button>
                </div>
              ))}
              <p className="modaltext" style={{ marginTop: 12 }}>
                Oprav to a pošli znovu.
              </p>
              <div className="rada" style={{ marginTop: 16 }}>
                <button className="btn" onClick={potvrdVracene}>
                  Rozumím, opravím to
                </button>
              </div>
            </div>
          </div>
        )}

        {kde === "denik" && (
          <DenikDelnik
            key={oprava ? oprava.id : "novy"}
            data={data}
            posli={posli}
            s={s}
            puvodni={oprava && oprava.druh === "dochazka" ? oprava : null}
          />
        )}
        {kde === "faktura" && (
          <FormFaktura
            key={oprava ? oprava.id : zalohaK ? zalohaK.id : "nova"}
            zaloha={zalohaK}
            data={data}
            posli={posli}
            zpet={() => {
              setOprava(null);
              setZalohaK(null);
              setKde("rozcestnik");
            }}
            puvodni={oprava && oprava.druh === "faktura" ? oprava : null}
          />
        )}
        {kde === "prehled" && <PrehledDelnik data={data} s={s} />}
      </div>
    </div>
  );
}

function DenikDelnik({ data, posli, s, puvodni }) {
  const moje = [...(data.cekajici || [])]
    .filter((z) => z.druh === "dochazka")
    .sort((a, b) => (a.datum < b.datum ? 1 : -1))
    .slice(0, 20);

  return (
    <>
      <FormHodiny
        data={data}
        sazba={s.sazba}
        pracanti={data.pracanti || []}
        posli={posli}
        puvodni={puvodni}
      />
      {moje.length > 0 && (
        <div className="box">
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.graf} c="#0C3B2E" s={16} />
              </i>
              Poslední zápisy
            </span>
          </h2>
          <table className="t">
            <tbody>
              {moje.map((z) => {
                const st =
                  z.stav === "schvaleno"
                    ? { t: "Potvrzeno", c: "#3E6B4C", b: "#E4EDE5" }
                    : z.stav === "vraceno"
                    ? { t: "Vráceno", c: "#B03A2E", b: "#F7DED9" }
                    : { t: "Čeká", c: "#8A6100", b: "#FFF2D0" };
                const u = data.ukoly.find((x) => x.id === z.ukol);
                return (
                  <tr key={z.id}>
                    <td className="n nowrap" style={{ color: "#5E7268" }}>
                      {datumCz(z.datum)}
                    </td>
                    <td>
                      <b className="n">{hodinyCelkem(z.hodiny)} h</b> — {z.popis || "práce"}
                      <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                        {u ? u.nazev : z.ukolText || "bez zařazení"}
                        {z.stavPrace ? " · " + z.stavPrace : ""}
                        {z.stav === "vraceno" && z.poznamka ? " · " + z.poznamka : ""}
                      </span>
                    </td>
                    <td className="r n nowrap" style={{ fontWeight: 700 }}>
                      {kc(hodinyCelkem(z.hodiny) * s.sazba)}
                    </td>
                    <td className="r">
                      <span className="stitek" style={{ color: st.c, background: st.b }}>
                        {st.t}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FormHodiny({ data, sazba, pracanti, posli, puvodni }) {
  const [datum, setDatum] = useState((puvodni && puvodni.datum) || dnes());
  const [ukolText, setUkolText] = useState((puvodni && puvodni.ukolText) || "");
  const [popis, setPopis] = useState((puvodni && puvodni.popis) || "");
  const [stavPrace, setStavPrace] = useState((puvodni && puvodni.stavPrace) || "");
  const [hodiny, setHodiny] = useState(
    puvodni && puvodni.hodiny ? { ...puvodni.hodiny } : {}
  );
  const [hotovo, setHotovo] = useState(null);

  const celkem = hodinyCelkem(hodiny);
  const castka = castkaZaHodiny(data, hodiny);
  const ruzneSazby = new Set(
    (data.pracanti || []).map((p) => sazbaPracanta(data, p.id))
  ).size > 1;

  const odesli = () => {
    const text = ukolText.trim();
    if (!celkem || !text) return;
    const cisty = {};
    pracanti.forEach((p) => {
      const h = cislo(hodiny[p.id]);
      if (h > 0) cisty[p.id] = h;
    });
    const shoda = (data.ukoly || []).find(
      (u) => u.nazev.toLowerCase() === text.toLowerCase()
    );
    posli({
      id: puvodni ? puvodni.id : undefined,
      druh: "dochazka",
      datum,
      ukol: shoda ? shoda.id : null,
      ukolText: text,
      popis: popis.trim(),
      stavPrace: stavPrace.trim(),
      hodiny: cisty,
    });
    setHotovo({ celkem, castka });
    setHodiny({});
    setPopis("");
    setStavPrace("");
  };

  return (
    <div className="box" style={{ marginTop: 18 }}>
      <h2 className="boxh">
        <span className="hi">
          <i>
            <Ik d={IKO.hodiny} c="#0C3B2E" s={16} />
          </i>
          Nový den
        </span>
      </h2>

      {puvodni && !hotovo && (
        <div className="hlaska zle" style={{ marginTop: 0, marginBottom: 14 }}>
          Tenhle zápis byl vrácen — <b>{puvodni.poznamka}</b>. Oprav ho a pošli
          znovu.
        </div>
      )}

      {hotovo && (
        <div className="hlaska dobre" style={{ marginTop: 0, marginBottom: 14 }}>
          <b>Odesláno.</b> {hotovo.celkem} h za {kc(hotovo.castka)}. Do přehledu
          se to započítá po potvrzení.
        </div>
      )}

      <div className="form">
        <div className="pole">
          <label>Datum</label>
          <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
        </div>
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Na čem se dělalo</label>
          <input
            value={ukolText}
            placeholder="omítky, podlaha, zateplení…"
            onChange={(e) => setUkolText(e.target.value)}
          />
        </div>
        <div className="pole" style={{ gridColumn: "span 3" }}>
          <label>Co se dělalo</label>
          <input
            value={popis}
            placeholder="např. špalety okna ložnice"
            onChange={(e) => setPopis(e.target.value)}
          />
        </div>
        <div className="pole" style={{ gridColumn: "span 3" }}>
          <label>Stav úkolu</label>
          <input
            value={stavPrace}
            placeholder="hotovo, zbývá ještě jedna vrstva, jsme v polovině…"
            onChange={(e) => setStavPrace(e.target.value)}
          />
        </div>
      </div>

      <h3 className="eyebrow" style={{ marginTop: 20, marginBottom: 10 }}>
        Odpracované hodiny
      </h3>
      <div className="hodinari">
        {pracanti.filter((p) => p.aktivni !== false).map((p) => (
          <div className="hodinar" key={p.id}>
            <label htmlFor={"h-" + p.id}>
              {p.jmeno}
              <span className="hodSazba n">{sazbaPracanta(data, p.id)} Kč/h</span>
            </label>
            <input
              id={"h-" + p.id}
              className="n"
              inputMode="decimal"
              placeholder="0"
              value={hodiny[p.id] || ""}
              onChange={(e) => setHodiny({ ...hodiny, [p.id]: e.target.value })}
            />
            <span>hod</span>
          </div>
        ))}
      </div>

      <div className="soucet">
        <span>
          {celkem} h
          {ruzneSazby ? " · různé sazby" : ` × ${sazba} Kč`}
        </span>
        <b className="n">{kc(castka)}</b>
      </div>

      <div className="rada">
        <button className="btn" onClick={odesli} disabled={!celkem || !ukolText.trim()}>
          {puvodni ? "Poslat znovu" : "Odeslat"}
        </button>
      </div>
      {!ukolText.trim() && celkem > 0 && (
        <p className="pozn" style={{ color: "#B03A2E" }}>
          Vyber ještě, na čem se dělalo.
        </p>
      )}
    </div>
  );
}

function ZalohyBlok({ s, onZadat }) {
  if (s.zalohyCeka.length === 0) return null;
  return (
    <div className="box zalohabox">
      <h2 className="boxh">
        <span className="hi">
          <i style={{ background: "#FFF2D0" }}>
            <Ik d={IKO.ucet} c="#8A6100" s={16} />
          </i>
          Zálohy na faktury
        </span>
        <span className="n" style={{ fontWeight: 800, color: "#8A6100" }}>
          {kc(s.zalohyCekaCelkem)}
        </span>
      </h2>
      <p className="zalohaNadpis">Je potřeba doložit fakturu za:</p>
      <table className="t">
        <tbody>
          {s.zalohyCeka.map((z) => (
            <tr key={z.id}>
              <td className="n nowrap" style={{ color: "#5E7268", width: 80 }}>
                {datumCz(z.datum)}
              </td>
              <td style={{ fontWeight: 650 }}>{z.popis}</td>
              <td className="r n nowrap" style={{ fontWeight: 800 }}>
                {kc(z.castka)}
              </td>
              {onZadat && (
                <td className="r" style={{ width: 90 }}>
                  <button className="btn ctaMaly" onClick={() => onZadat(z)}>
                    Zadat
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HlavaDelnika({ s }) {
  return (
    <div className="hero" style={{ marginTop: 18 }}>
      <div className="heroin">
        <div className="herotext">
          <div className="eyebrow">{mesicNazev(s.tentoMesic)}</div>
          <div className="heroc n">{s.hodinyMesic} h</div>
          <div className="heropod">
            {kc(s.hodinyMesic * s.sazba)} · sazba {s.sazba} Kč/hod
          </div>
        </div>
        <div className="herotext" style={{ textAlign: "right", minWidth: 200 }}>
          {s.kVyplate >= 0 ? (
            <>
              <div className="eyebrow">Celkem k výplatě</div>
              <div className="heroc n">{kc(s.kVyplate)}</div>
              <div className="rozpadk">
                <span>
                  <u style={{ background: "#6D9773" }} />
                  vydělaná částka za práci <b className="n">{kc(s.zbyvaVyplatit)}</b>
                </span>
                <span>
                  <u style={{ background: "#FFBA00" }} />
                  faktury čekající na proplacení{" "}
                  <b className="n">{kc(s.neproplacenoCelkem)}</b>
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="eyebrow" style={{ color: "#FFBA00" }}>
                Zbývá vyúčtovat
              </div>
              <div className="heroc n">− {kc(-s.kVyplate)}</div>
              <div className="rozpadk">
                <span>
                  <u style={{ background: "#FFBA00" }} />
                  posláno zálohou <b className="n">{kc(s.vyplaceno)}</b>
                </span>
                <span>
                  <u style={{ background: "#B46617" }} />
                  doloženo fakturami <b className="n">{kc(s.dolozenoFakturami)}</b>
                </span>
                <span>
                  <u style={{ background: "#6D9773" }} />
                  doloženo prací <b className="n">{kc(s.odpracovano)}</b>
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PrehledDelnik({ data, s, uloz, bezHlavy }) {
  const [dluhOtevren, setDluhOtevren] = useState(false);
  const maxHodin = Math.max(...s.mesicniRada.map((m) => m[1]), 1);

  return (
    <>
      {!bezHlavy && <HlavaDelnika s={s} />}

      <ZalohyBlok s={s} />

      <div className="dlazdice">
        <Dlazdice
          ikona={IKO.kladivo}
          barva="#0C3B2E"
          pozadi="#E4EDE5"
          popis="Odpracováno celkem"
          hodnota={kc(s.odpracovano)}
          pod={`${s.hodinyCelkove} h${s.mojeHodiny ? ` · moje ${s.mojeHodiny} h` : ""}`}
        />
        <Dlazdice
          ikona={IKO.bankovka}
          barva="#3E6B4C"
          pozadi="#E4EDE5"
          popis="Vyplaceno"
          hodnota={kc(s.vyplaceno)}
          pod={`${s.platby.length} plateb`}
        />
        <Dlazdice
          ikona={IKO.ucet}
          barva="#B46617"
          pozadi="#F7E7D6"
          popis="Nakoupený materiál"
          hodnota={kc(s.materialCelkem)}
          pod={
            s.neproplacenoCelkem
              ? `čeká na proplacení ${kc(s.neproplacenoCelkem)}`
              : `${s.material.length} faktur · vše proplaceno`
          }
        />
        <Dlazdice
          ikona={IKO.mince}
          barva={s.zbyvaDluh > 0 ? "#B03A2E" : "#3E6B4C"}
          pozadi="#EFE8D6"
          popis="Můj dluh"
          hodnota={kc(s.zbyvaDluh)}
          pod={s.odbydleno ? `odbydleno ${kc(s.odbydleno)}` : "zatím nic odbydleno"}
        />
      </div>

      {s.mesicniRada.length > 0 && (
        <div className="box">
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.graf} c="#0C3B2E" s={16} />
              </i>
              Hodiny po měsících
            </span>
          </h2>
          <table className="t">
            <tbody>
              {s.mesicniRada.map(([m, h]) => (
                <tr key={m}>
                  <td style={{ fontWeight: 650, width: "30%" }}>{mesicNazev(m)}</td>
                  <td>
                    <div className="pruh">
                      <i style={{ width: (h / maxHodin) * 100 + "%", background: "#6D9773" }} />
                    </div>
                  </td>
                  <td className="r n nowrap" style={{ fontWeight: 700 }}>
                    {h} h
                  </td>
                  <td className="r n nowrap" style={{ color: "#5E7268" }}>
                    {kc(h * s.sazba)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="box">
        <h2 className="boxh">
          <span className="hi">
            <i>
              <Ik d={IKO.bankovka} c="#0C3B2E" s={16} />
            </i>
            Přijaté platby
          </span>
          <span className="n">{kc(s.vyplaceno)}</span>
        </h2>
        {s.platby.length === 0 ? (
          <p className="prazdno">Zatím žádná platba.</p>
        ) : (
          <table className="t">
            <tbody>
              {s.platby.map((p) => (
                <tr key={p.id}>
                  <td className="n nowrap" style={{ color: "#5E7268" }}>
                    {datumCz(p.datum)}
                  </td>
                  <td>{p.popis || "platba"}</td>
                  <td className="r n nowrap" style={{ fontWeight: 800, color: "#3E6B4C" }}>
                    {kc(p.castka)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="box">
        <h2 className="boxh">
          <span className="hi">
            <i>
              <Ik d={IKO.mince} c="#0C3B2E" s={16} />
            </i>
            Můj dluh
          </span>
          <span className="n" style={{ color: s.zbyvaDluh > 0 ? "#B03A2E" : "#3E6B4C", fontWeight: 800 }}>
            {kc(s.zbyvaDluh)}
          </span>
        </h2>
        <button className="btn2" onClick={() => setDluhOtevren(!dluhOtevren)}>
          {dluhOtevren ? "Skrýt rozpis" : "Za co všechno to je"}
        </button>
        {dluhOtevren && (
          <table className="t" style={{ marginTop: 14 }}>
            <tbody>
              {s.dluhPolozky.map((d) => (
                <tr key={d.id}>
                  <td className="n nowrap" style={{ color: "#5E7268", width: 90 }}>
                    {d.datum ? datumCz(d.datum) : d.obdobi || "—"}
                  </td>
                  <td>
                    {d.popis}
                    {(d.poznamka || d.doplnit) && (
                      <span style={{ display: "block", fontSize: 11.5, color: d.doplnit ? "#B46617" : "#5E7268" }}>
                        {d.poznamka}
                      </span>
                    )}
                  </td>
                  <td
                    className="r n nowrap"
                    style={{ fontWeight: 700, color: d.castka < 0 ? "#3E6B4C" : undefined }}
                  >
                    {d.castka < 0 ? "− " + kc(-d.castka) : kc(d.castka)}
                  </td>
                </tr>
              ))}
              {s.odbydlene.map((o) => (
                <tr key={o.id}>
                  <td className="n nowrap" style={{ color: "#5E7268" }}>
                    {datumCz(o.datum)}
                  </td>
                  <td style={{ color: "#3E6B4C" }}>
                    Sraženo z platby{o.popis ? " — " + o.popis : ""}
                  </td>
                  <td className="r n nowrap" style={{ fontWeight: 700, color: "#3E6B4C" }}>
                    − {kc(o.castka)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid #C9AE85" }}>
                <td colSpan={2} style={{ paddingTop: 11 }}>
                  Přičteno k dluhu
                </td>
                <td className="r n nowrap" style={{ fontWeight: 700, paddingTop: 11 }}>
                  {kc(s.dluhPripsano)}
                </td>
              </tr>
              <tr>
                <td colSpan={2} style={{ color: "#3E6B4C" }}>
                  Odmazáno
                </td>
                <td className="r n nowrap" style={{ fontWeight: 700, color: "#3E6B4C" }}>
                  − {kc(s.dluhOdmazano + s.odbydleno)}
                </td>
              </tr>
              <tr>
                <td colSpan={2} style={{ fontWeight: 800 }}>
                  Zbývá
                </td>
                <td
                  className="r n nowrap"
                  style={{ fontWeight: 800, color: s.zbyvaDluh > 0 ? "#B03A2E" : "#3E6B4C" }}
                >
                  {kc(s.zbyvaDluh)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="box">
        <h2 className="boxh">
          <span className="hi">
            <i>
              <Ik d={IKO.ucet} c="#0C3B2E" s={16} />
            </i>
            Co jsem nakoupil
          </span>
          <span className="n">{kc(s.materialCelkem)}</span>
        </h2>
        {s.material.length === 0 ? (
          <p className="prazdno">Zatím žádná faktura.</p>
        ) : (
          <table className="t">
            <tbody>
              {s.material.slice(0, 30).map((p) => {
                const u = data.ukoly.find((x) => x.id === p.ukol);
                return (
                  <tr key={p.id}>
                    <td className="n nowrap" style={{ color: "#5E7268" }}>
                      {datumCz(p.datum)}
                    </td>
                    <td>
                      {p.popis}
                      <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                        {u ? u.nazev : "bez kategorie"}
                        {!p.dolozeno && " · chybí účtenka"}
                      </span>
                    </td>
                    <td className="r n nowrap" style={{ fontWeight: 700 }}>
                      {kc(p.castka)}
                    </td>
                    <td className="r">
                      {p.proplaceno === false ? (
                        uloz ? (
                          <button
                            className="stitek"
                            style={{
                              color: "#8A6100",
                              background: "#FFF2D0",
                              border: "none",
                              cursor: "pointer",
                              font: "inherit",
                              fontSize: 10,
                              fontWeight: 800,
                              textTransform: "uppercase",
                            }}
                            onClick={() =>
                              uloz({
                                ...data,
                                polozky: data.polozky.map((x) =>
                                  x.id === p.id
                                    ? { ...x, proplaceno: true, datumProplaceni: dnes() }
                                    : x
                                ),
                              })
                            }
                          >
                            Neproplaceno
                          </button>
                        ) : (
                          <span className="stitek" style={{ color: "#8A6100", background: "#FFF2D0" }}>
                            Čeká
                          </span>
                        )
                      ) : (
                        <span className="stitek" style={{ color: "#3E6B4C", background: "#E4EDE5" }}>
                          Proplaceno
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function FormFaktura({ data, posli, zpet, puvodni, zaloha }) {
  const [datum, setDatum] = useState((puvodni && puvodni.datum) || dnes());
  const [dodavatel, setDodavatel] = useState((puvodni && puvodni.dodavatel) || "");
  const [cisloDokl, setCisloDokl] = useState((puvodni && puvodni.cisloDokladu) || "");
  const [castka, setCastka] = useState(
    (puvodni && puvodni.castka) || (zaloha && zaloha.castka) || ""
  );
  const [ukolText, setUkolText] = useState(
    (puvodni && puvodni.ukolText) || (zaloha && zaloha.popis) || ""
  );
  const [nahled, setNahled] = useState(null);
  const [archiv, setArchiv] = useState(null);
  const [stav, setStav] = useState("form");
  const [chyba, setChyba] = useState("");

  useEffect(() => {
    if (!puvodni || !puvodni.mafoto) return;
    let zivy = true;
    (async () => {
      try {
        const r = await ULOZISTE.get("fa:" + puvodni.id, true);
        if (r && zivy) setNahled(r.value);
      } catch (e) {}
    })();
    return () => {
      zivy = false;
    };
  }, []);

  const vyberFoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setChyba("");
    try {
      const { url, archiv: a } = await zmensiObrazek(file);
      setNahled(url);
      setArchiv(a);
    } catch (err) {
      setChyba("Fotku se nepodařilo načíst, zkus to znovu.");
    }
  };

  const odesli = async () => {
    const c = cislo(castka);
    if (!c) return;
    const id = puvodni ? puvodni.id : uid();
    let mafoto = !!(puvodni && puvodni.mafoto);
    if (archiv) {
      try {
        await ULOZISTE.set("fa:" + id, archiv, true);
        mafoto = true;
      } catch (err) {
        mafoto = mafoto || false;
      }
    }
    const text = ukolText.trim();
    const shoda = (data.ukoly || []).find(
      (u) => u.nazev.toLowerCase() === text.toLowerCase()
    );
    posli({
      id,
      druh: "faktura",
      datum,
      dodavatel: dodavatel.trim(),
      cisloDokladu: cisloDokl.trim(),
      castka: c,
      ukol: shoda ? shoda.id : null,
      ukolText: text,
      popis: "Materiál",
      zalohaId: (puvodni && puvodni.zalohaId) || (zaloha && zaloha.id) || null,
      mafoto,
    });
    setStav("hotovo");
  };

  if (stav === "hotovo")
    return (
      <div className="box" style={{ marginTop: 18 }}>
        <div className="hlaska dobre" style={{ marginTop: 0 }}>
          <b>{puvodni ? "Faktura poslána znovu." : "Faktura odeslána."}</b>{" "}
          {kc(cislo(castka))}
          {dodavatel ? " — " + dodavatel : ""}.
        </div>
        <div className="rada">
          <button className="btn2" onClick={zpet}>
            Hotovo
          </button>
        </div>
      </div>
    );

  return (
    <div className="box" style={{ marginTop: 18 }}>
      <h2 className="boxh">
        <span className="hi">
          <i>
            <Ik d={IKO.ucet} c="#0C3B2E" s={16} />
          </i>
          {puvodni ? "Oprava faktury" : "Faktura za materiál"}
        </span>
      </h2>

      {zaloha && !puvodni && (
        <div className="hlaska" style={{ marginTop: 0, marginBottom: 14 }}>
          Tahle faktura doloží zálohu z {datumCz(zaloha.datum)} na{" "}
          <b className="n">{kc(zaloha.castka)}</b> — {zaloha.popis}. Když se
          částka liší, přepiš ji podle dokladu.
        </div>
      )}

      {puvodni && (
        <div className="hlaska zle" style={{ marginTop: 0, marginBottom: 14 }}>
          Tahle faktura byla vrácena — <b>{puvodni.poznamka}</b>. Oprav ji a
          pošli znovu.
        </div>
      )}

      {nahled ? (
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 14 }}>
          <img className="nahled" src={nahled} alt="Náhled faktury" />
          <button className="btn2" onClick={() => { setNahled(null); setArchiv(null); }}>
            Vyfotit znovu
          </button>
        </div>
      ) : (
        <label className="drop" style={{ marginBottom: 14 }}>
          <b>Vyfotit doklad</b>
          <span>Celý doklad v záběru, rovnou shora.</span>
          <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={vyberFoto} />
        </label>
      )}
      {chyba && <div className="hlaska zle">{chyba}</div>}

      <div className="form">
        <div className="pole">
          <label>Datum</label>
          <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
        </div>
        <div className="pole">
          <label>Kde nakoupeno</label>
          <input
            value={dodavatel}
            placeholder="např. DEK"
            onChange={(e) => setDodavatel(e.target.value)}
          />
        </div>
        <div className="pole">
          <label>Číslo dokladu</label>
          <input
            className="n"
            value={cisloDokl}
            placeholder="z faktury"
            onChange={(e) => setCisloDokl(e.target.value)}
          />
        </div>
        <div className="pole">
          <label>Částka celkem</label>
          <input
            className="n"
            inputMode="decimal"
            placeholder="0"
            value={castka}
            onChange={(e) => setCastka(e.target.value)}
          />
        </div>
        <div className="pole" style={{ gridColumn: "span 2" }}>
          <label>Na co to je</label>
          <input
            value={ukolText}
            placeholder="např. obklady do koupelny"
            onChange={(e) => setUkolText(e.target.value)}
          />
        </div>
      </div>

      <div className="rada">
        <button className="btn" onClick={odesli} disabled={!cislo(castka)}>
          Odeslat ke schválení
        </button>
        <button className="btn2" onClick={zpet}>
          Zpět
        </button>
      </div>
    </div>
  );
}

function RozpadPolozky({ data, uloz, polozka }) {
  const [rady, setRady] = useState([
    { id: "r1", ukol: "", castka: String(polozka.castka) },
  ]);
  const [oznacene, setOznacene] = useState({});
  const [novaR, setNovaR] = useState({ popis: "", castka: "" });
  const [rozepsat, setRozepsat] = useState(false);

  const radky = polozka.radky || [];
  const suma = rady.reduce((a, r) => a + cislo(r.castka), 0);
  const zbytek = polozka.castka - suma;
  const sedi = Math.abs(zbytek) < 1;
  const hotovo = rady.every((r) => r.ukol && cislo(r.castka) > 0) && sedi;

  const ulozRadky = (nove) =>
    uloz({
      ...data,
      polozky: data.polozky.map((p) =>
        p.id === polozka.id ? { ...p, radky: nove } : p
      ),
    });

  const pridejFakturniRadek = () => {
    const c = cislo(novaR.castka);
    if (!c) return;
    ulozRadky([
      ...radky,
      { id: uid(), popis: novaR.popis.trim() || "položka", castka: c },
    ]);
    setNovaR({ popis: "", castka: "" });
  };

  const volne = radky.filter((r) => !r.prirazeno);
  const oznacenoSuma = volne
    .filter((r) => oznacene[r.id])
    .reduce((a, r) => a + r.castka, 0);

  const vytvorZOznacenych = () => {
    const vybrane = volne.filter((r) => oznacene[r.id]);
    if (vybrane.length === 0) return;
    const idRadku = uid();
    const prazdny = rady.find((r) => !r.ukol && cislo(r.castka) === 0);
    const novy = { id: idRadku, ukol: "", castka: String(Math.round(oznacenoSuma * 100) / 100) };
    setRady(prazdny ? rady.map((r) => (r.id === prazdny.id ? novy : r)) : [...rady, novy]);
    ulozRadky(
      radky.map((r) => (oznacene[r.id] && !r.prirazeno ? { ...r, prirazeno: idRadku } : r))
    );
    setOznacene({});
  };

  const zmen = (id, pole, hod) =>
    setRady(rady.map((r) => (r.id === id ? { ...r, [pole]: hod } : r)));
  const pridej = () =>
    setRady([
      ...rady,
      { id: uid(), ukol: "", castka: zbytek > 0 ? String(Math.round(zbytek * 100) / 100) : "" },
    ]);
  const smaz = (id) => {
    setRady(rady.filter((r) => r.id !== id));
    if (radky.some((r) => r.prirazeno === id))
      ulozRadky(radky.map((r) => (r.prirazeno === id ? { ...r, prirazeno: null } : r)));
  };

  // Doklad nejde ze seznamu ke schválení dostat jinak než úplným rozepsáním.
  // Tohle ho z něj odebere a nechá jako běžný výdaj — částka zůstane,
  // jen nebude rozepsaná do kategorií.
  const nechatVcelku = () =>
    uloz({
      ...data,
      polozky: data.polozky.map((p) =>
        p.id === polozka.id
          ? {
              ...p,
              kRozpadu: false,
              popis: p.popis.replace(/\s*\(čeká na rozpad\)\s*$/i, ""),
            }
          : p
      ),
    });

  const zapis = () => {
    if (!hotovo) return;
    const zaklad = polozka.popis.replace(/\s*\(čeká na rozpad\)\s*$/i, "");
    const nove = rady.map((r) => {
      const k = data.ukoly.find((u) => u.id === r.ukol);
      const patrici = radky.filter((x) => x.prirazeno === r.id);
      return {
        ...polozka,
        id: uid(),
        kRozpadu: false,
        radky: patrici.length ? patrici.map(({ prirazeno, ...z }) => z) : undefined,
        ukol: r.ukol,
        castka: cislo(r.castka),
        popis: patrici.length
          ? patrici.map((x) => x.popis).join(", ")
          : rady.length > 1 && k
          ? `${zaklad} — ${k.nazev}`
          : zaklad,
      };
    });
    uloz({
      ...data,
      polozky: [...data.polozky.filter((x) => x.id !== polozka.id), ...nove],
    });
  };

  return (
    <div className="box" style={{ borderLeft: "5px solid #B46617" }}>
      <h2 className="boxh">
        <span className="hi">
          <i style={{ background: "#F7E7D6" }}>
            <Ik d={IKO.ucet} c="#B46617" s={16} />
          </i>
          K rozdělení do kategorií
        </span>
        <span className="n">
          {datumCz(polozka.datum)} · {kc(polozka.castka)}
        </span>
      </h2>

      <p style={{ fontSize: 14, margin: "0 0 4px", fontWeight: 650 }}>
        {polozka.popis.replace(/\s*\(čeká na rozpad\)\s*$/i, "")}
      </p>
      <Doklad p={polozka} zaklad={data.zakladOdkazu} />

      <div className="rada" style={{ marginTop: 14 }}>
        <button className="btn2" onClick={() => setRozepsat(!rozepsat)}>
          {rozepsat ? "Skrýt položky z faktury ⌃" : "Rozepsat položky z faktury ⌄"}
        </button>
        {radky.length > 0 && (
          <span style={{ fontSize: 12.5, color: "#5E7268" }}>
            {radky.length} rozepsaných · {volne.length} nezařazených
          </span>
        )}
      </div>

      {rozepsat && (
        <div className="fakturniRadky">
          {radky.length > 0 && (
            <div className="upominkySeznam" style={{ marginBottom: 12 }}>
              {radky.map((r) => {
                const kat = r.prirazeno
                  ? data.ukoly.find(
                      (u) => u.id === (rady.find((x) => x.id === r.prirazeno) || {}).ukol
                    )
                  : null;
                return (
                  <label className="fakturniR" key={r.id} data-prirazeno={r.prirazeno ? "1" : "0"}>
                    <input
                      type="checkbox"
                      disabled={!!r.prirazeno}
                      checked={!!oznacene[r.id] && !r.prirazeno}
                      onChange={() => setOznacene({ ...oznacene, [r.id]: !oznacene[r.id] })}
                    />
                    <span className="fakturniText">
                      <b>{r.popis}</b>
                      {r.prirazeno && (
                        <small>zařazeno {kat ? "· " + kat.nazev : ""}</small>
                      )}
                    </span>
                    <span className="n" style={{ fontWeight: 700 }}>
                      {kc(r.castka)}
                    </span>
                    <Smazat
                      co="tuto položku faktury"
                      onSmaz={() => ulozRadky(radky.filter((x) => x.id !== r.id))}
                    />
                  </label>
                );
              })}
            </div>
          )}

          {oznacenoSuma > 0 && (
            <div className="soucet" style={{ marginTop: 0, marginBottom: 12 }}>
              <span>označeno {volne.filter((r) => oznacene[r.id]).length} položek</span>
              <b className="n">{kc(oznacenoSuma)}</b>
              <button
                className="btn"
                style={{ background: "#FFBA00", color: "#0C3B2E", marginLeft: 14 }}
                onClick={vytvorZOznacenych}
              >
                Vytvořit řádek
              </button>
            </div>
          )}

          <div className="form">
            <div className="pole" style={{ gridColumn: "span 2" }}>
              <label>Položka z faktury</label>
              <input
                value={novaR.popis}
                placeholder="např. omítka CEMIX 25 kg"
                onChange={(e) => setNovaR({ ...novaR, popis: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && pridejFakturniRadek()}
              />
            </div>
            <div className="pole">
              <label>Částka</label>
              <input
                className="n"
                inputMode="decimal"
                value={novaR.castka}
                onChange={(e) => setNovaR({ ...novaR, castka: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && pridejFakturniRadek()}
              />
            </div>
            <button className="btn2" onClick={pridejFakturniRadek}>
              Přidat
            </button>
          </div>
          <p className="pozn">
            Opiš položky z faktury, zaškrtni ty, které patří k sobě, a nech je
            sečíst. Nemusíš rozepisovat všechno — zbytek dorovnáš ručně.
          </p>
        </div>
      )}

      <h3 className="eyebrow" style={{ marginTop: 18, marginBottom: 9 }}>
        Rozdělení do kategorií
      </h3>
      <table className="t">
        <tbody>
          {rady.map((r) => (
            <tr key={r.id}>
              <td>
                <VyberKategorie
                  ukoly={data.ukoly.filter((u) => u.nazev !== "Čeká na rozpad faktury")}
                  hodnota={r.ukol}
                  onZmena={(id) => zmen(r.id, "ukol", id)}
                />
              </td>
              <td style={{ width: 120 }}>
                <input
                  className="mini n"
                  inputMode="decimal"
                  style={{ textAlign: "right" }}
                  value={r.castka}
                  onChange={(e) => zmen(r.id, "castka", e.target.value)}
                />
              </td>
              <td style={{ width: 28 }}>
                {rady.length > 1 && (
                  <button className="x" onClick={() => smaz(r.id)} aria-label="Odebrat">
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rada" style={{ marginTop: 10 }}>
        <button className="btn2" onClick={pridej}>
          + další kategorie
        </button>
        <span
          style={{ fontSize: 12.5, fontWeight: 700, color: sedi ? "#3E6B4C" : "#B03A2E" }}
        >
          {sedi
            ? `Sedí na ${kc(polozka.castka)}`
            : zbytek > 0
            ? `Nerozdělených ${kc(zbytek)}`
            : `Rozděleno o ${kc(-zbytek)} víc, než je na dokladu`}
        </span>
      </div>

      <div className="rada">
        <button className="btn" onClick={zapis} disabled={!hotovo}>
          Rozdělit a zapsat
        </button>
        <button className="btn2" onClick={nechatVcelku}>
          Nechat nerozdělený
        </button>
        <Smazat
          tlacitko
          popisek="Smazat doklad"
          co="tenhle doklad i s jeho částkou"
          onSmaz={() =>
            uloz({
              ...data,
              polozky: data.polozky.filter((p) => p.id !== polozka.id),
            })
          }
        />
      </div>
      <p className="pozn">
        <b>Nechat nerozdělený</b> doklad z tohoto seznamu odebere, ale částka
        zůstane ve výdajích — jen nebude rozepsaná do kategorií.{" "}
        <b>Smazat</b> ho odstraní i s částkou.
      </p>
    </div>
  );
}

function Schvalovani({ data, uloz }) {
  const [fotky, setFotky] = useState({});
  const [zdroje, setZdroje] = useState({});
  const [kategorie, setKategorie] = useState({});
  const [zalohaK, setZalohaK] = useState({});
  const [vraceni, setVraceni] = useState({});
  const [upravy, setUpravy] = useState({});
  const [rozpady, setRozpady] = useState({});
  const [lupa, setLupa] = useState(null);

  const cekajici = (data.cekajici || []).filter((z) => z.stav === "ceka");
  const kRozpadu = (data.polozky || []).filter((p) => p.kRozpadu);
  const vyrizene = (data.cekajici || [])
    .filter((z) => z.stav !== "ceka")
    .sort((a, b) => (a.vytvoreno < b.vytvoreno ? 1 : -1))
    .slice(0, 12);
  const sazba = data.sazba || 250;
  const volneZalohy = (data.zalohy || []).filter(
    (z) => !(data.polozky || []).some((p) => p.zalohaId === z.id)
  );

  useEffect(() => {
    let zivy = true;
    (async () => {
      const sbirka = {};
      for (const z of cekajici.filter((x) => x.druh === "faktura" && x.mafoto)) {
        try {
          const r = await ULOZISTE.get("fa:" + z.id, true);
          if (r) sbirka[z.id] = r.value;
        } catch (e) {}
      }
      if (zivy) setFotky(sbirka);
    })();
    return () => {
      zivy = false;
    };
  }, [cekajici.length]);

  const jmenoPracanta = (id) => {
    const p = (data.pracanti || []).find((x) => x.id === id);
    return p ? p.jmeno : id;
  };

  const uprava = (z) => ({
    dodavatel: z.dodavatel || "",
    cisloDokladu: z.cisloDokladu || "",
    castka: z.castka || "",
    popis: z.popis || "",
    ...(upravy[z.id] || {}),
  });
  const zmenUpravu = (z, pole, hod) =>
    setUpravy({ ...upravy, [z.id]: { ...uprava(z), [pole]: hod } });

  const vybranaKat = (z) =>
    kategorie[z.id] !== undefined ? kategorie[z.id] : z.ukol || "";
  const vybranaZaloha = (z) =>
    zalohaK[z.id] !== undefined ? zalohaK[z.id] : z.zalohaId || "";

  const zalozKategorii = (z) => {
    const nazev = (z.ukolText || z.popis || "").trim();
    if (!nazev) return;
    const id = uid();
    uloz({
      ...data,
      ukoly: [...data.ukoly, { id, nazev, odhad: 0, stav: "probiha", typ: "pridano" }],
    });
    setKategorie({ ...kategorie, [z.id]: id });
  };

  // ── rozpad faktury do více kategorií ──
  const rozpad = (z) =>
    rozpady[z.id] || [{ id: "r1", ukol: z.ukol || "", castka: uprava(z).castka || "" }];
  const setRozpad = (z, rady) => setRozpady({ ...rozpady, [z.id]: rady });
  const sumaRozpadu = (z) => rozpad(z).reduce((a, r) => a + cislo(r.castka), 0);
  const zbytek = (z) => cislo(uprava(z).castka) - sumaRozpadu(z);
  const rozpadOk = (z) => {
    const rady = rozpad(z);
    return (
      rady.length > 0 &&
      rady.every((r) => r.ukol && cislo(r.castka) > 0) &&
      Math.abs(zbytek(z)) < 1
    );
  };
  const pridejRadek = (z) =>
    setRozpad(z, [
      ...rozpad(z),
      { id: uid(), ukol: "", castka: zbytek(z) > 0 ? String(Math.round(zbytek(z))) : "" },
    ]);
  const zmenRadek = (z, id, pole, hod) =>
    setRozpad(z, rozpad(z).map((r) => (r.id === id ? { ...r, [pole]: hod } : r)));
  const smazRadek = (z, id) =>
    setRozpad(z, rozpad(z).filter((r) => r.id !== id));

  const schval = (z) => {
    const oznac = (data.cekajici || []).map((x) =>
      x.id === z.id ? { ...x, stav: "schvaleno" } : x
    );

    if (z.druh === "dochazka") {
      const h = hodinyCelkem(z.hodiny);
      uloz({
        ...data,
        zaznamy: [
          ...data.zaznamy,
          {
            id: uid(),
            datum: z.datum,
            typ: "prace",
            popis: z.popis || z.ukolText || "práce",
            stavPrace: z.stavPrace || "",
            ukol: vybranaKat(z) || null,
            castka: castkaZaHodiny(data, z.hodiny),
            hodiny: z.hodiny,
            zdroj: "hypoteka",
          },
        ],
        cekajici: oznac,
      });
      return;
    }

    const u = uprava(z);
    const zdroj = zdroje[z.id] || "hypoteka";
    const naZalohu = vybranaZaloha(z) || null;
    const celkem = cislo(u.castka);
    const rady = rozpad(z);
    const zaklad = u.popis && u.popis !== "Materiál" ? u.popis : "Materiál";

    const nove = rady.map((r, i) => ({
      id: uid(),
      datum: z.datum,
      popis:
        (rady.length > 1
          ? `${zaklad} (${
              (data.ukoly.find((k) => k.id === r.ukol) || {}).nazev || "část"
            })`
          : zaklad) + (u.dodavatel ? " — " + u.dodavatel : ""),
      tema: data.temata[0],
      ukol: r.ukol,
      castka: cislo(r.castka),
      zdroj,
      pres: true,
      dolozeno: !!z.mafoto,
      proplaceno: naZalohu ? true : false,
      zalohaId: i === 0 ? naZalohu : null,
      faktura: z.mafoto ? z.id : null,
    }));

    uloz({
      ...data,
      polozky: [...data.polozky, ...nove],
      faktury: z.mafoto
        ? [
            ...(data.faktury || []),
            {
              id: z.id,
              datum: z.datum,
              dodavatel: u.dodavatel || "Bez názvu",
              celkem,
              mafoto: true,
              pocet: nove.length,
            },
          ]
        : data.faktury || [],
      cekajici: oznac,
    });
  };

  const vrat = (z) => {
    const duvod = (vraceni[z.id] || "").trim();
    if (!duvod) return;
    uloz({
      ...data,
      cekajici: (data.cekajici || []).map((x) =>
        x.id === z.id ? { ...x, stav: "vraceno", poznamka: duvod, videno: false } : x
      ),
    });
  };

  const lzeSchvalit = (z) =>
    z.druh === "dochazka" ? !!vybranaKat(z) : cislo(uprava(z).castka) > 0 && rozpadOk(z);

  return (
    <>
      {kRozpadu.length > 0 && (
        <>
          <div className="hlaska" style={{ marginTop: 0 }}>
            <b>
              {kRozpadu.length}{" "}
              {kRozpadu.length === 1 ? "doklad čeká" : "dokladů čeká"} na
              rozdělení do kategorií — celkem{" "}
              <span className="n">
                {kc(kRozpadu.reduce((a, p) => a + p.castka, 0))}
              </span>
              .
            </b>{" "}
            Částka se už počítá do rozpočtu, jen zatím visí na jedné hromádce.
          </div>
          {kRozpadu
            .sort((a, b) => b.castka - a.castka)
            .map((p) => (
              <RozpadPolozky key={p.id} data={data} uloz={uloz} polozka={p} />
            ))}
        </>
      )}

      {cekajici.length === 0 && kRozpadu.length === 0 ? (
        <div className="box" style={{ marginTop: 0 }}>
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.fajfka} c="#0C3B2E" s={16} />
              </i>
              Ke schválení
            </span>
          </h2>
          <p className="prazdno">Nic nečeká. Vše je vyřízené.</p>
        </div>
      ) : (
        cekajici.map((z) => {
          const h = hodinyCelkem(z.hodiny);
          const u = uprava(z);
          return (
            <div className="box" key={z.id} style={{ borderLeft: "5px solid #FFBA00" }}>
              <h2 className="boxh">
                <span className="hi">
                  <i>
                    <Ik d={z.druh === "dochazka" ? IKO.hodiny : IKO.ucet} c="#0C3B2E" s={16} />
                  </i>
                  {z.druh === "dochazka" ? "Docházka" : "Faktura za materiál"}
                </span>
                <span className="n">{datumCz(z.datum)}</span>
              </h2>

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {z.druh === "faktura" && (
                  <div className="fotoblok">
                    {z.mafoto ? (
                      fotky[z.id] ? (
                        <>
                          <button
                            className="fotoTlac"
                            onClick={() => setLupa(fotky[z.id])}
                            aria-label="Zvětšit fakturu"
                          >
                            <img src={fotky[z.id]} alt="Faktura od dělníka" />
                          </button>
                          <span className="fotoPopis">Klikni pro zvětšení</span>
                        </>
                      ) : (
                        <div className="fotoCeka">
                          <i className="spin" />
                          Načítám fotku…
                        </div>
                      )
                    ) : (
                      <div className="fotoCeka">Bez fotky</div>
                    )}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 250 }}>
                  <table className="t">
                    <tbody>
                      {z.druh === "dochazka" ? (
                        <>
                          <tr>
                            <td>
                              Zařadit do kategorie
                              {z.ukolText && (
                                <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                                  napsal: „{z.ukolText}"
                                </span>
                              )}
                            </td>
                            <td className="r">
                              <VyberKategorie
                                ukoly={data.ukoly}
                                hodnota={vybranaKat(z)}
                                onZmena={(id) =>
                                  setKategorie({ ...kategorie, [z.id]: id })
                                }
                              />
                              {!vybranaKat(z) && (z.ukolText || z.popis) && (
                                <button
                                  className="odkaz"
                                  style={{ display: "block", marginTop: 6, marginLeft: "auto" }}
                                  onClick={() => zalozKategorii(z)}
                                >
                                  + založit „{z.ukolText || z.popis}" jako kategorii
                                </button>
                              )}
                            </td>
                          </tr>
                          {Object.entries(z.hodiny || {}).map(([pid, hod]) => (
                            <tr key={pid}>
                              <td>{jmenoPracanta(pid)}</td>
                              <td className="r n">
                                {hod} h × {sazbaPracanta(data, pid)} ={" "}
                                {kc(hod * sazbaPracanta(data, pid))}
                              </td>
                            </tr>
                          ))}
                          <tr>
                            <td>
                              {z.popis || "bez poznámky"}
                              {z.stavPrace && (
                                <span
                                  className="stitek"
                                  style={{ marginLeft: 6, color: "#8A6100", background: "#FFF2D0" }}
                                >
                                  {z.stavPrace}
                                </span>
                              )}
                            </td>
                            <td className="r n" style={{ fontWeight: 800 }}>
                              {h} h = {kc(castkaZaHodiny(data, z.hodiny))}
                            </td>
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr>
                            <td>
                              Popis
                              {z.ukolText && (
                                <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                                  napsal: „{z.ukolText}"
                                </span>
                              )}
                            </td>
                            <td className="r">
                              <input
                                className="mini"
                                value={u.popis}
                                placeholder="co to je"
                                onChange={(e) => zmenUpravu(z, "popis", e.target.value)}
                              />
                            </td>
                          </tr>
                          <tr>
                            <td>Dodavatel</td>
                            <td className="r">
                              <input
                                className="mini"
                                value={u.dodavatel}
                                placeholder="kde nakoupil"
                                onChange={(e) => zmenUpravu(z, "dodavatel", e.target.value)}
                              />
                            </td>
                          </tr>
                          <tr>
                            <td>Číslo dokladu</td>
                            <td className="r">
                              <input
                                className="mini n"
                                value={u.cisloDokladu}
                                placeholder="z faktury"
                                onChange={(e) => zmenUpravu(z, "cisloDokladu", e.target.value)}
                              />
                            </td>
                          </tr>
                          <tr>
                            <td>Částka celkem</td>
                            <td className="r">
                              <input
                                className="mini n"
                                inputMode="decimal"
                                style={{
                                  textAlign: "right",
                                  fontWeight: 800,
                                  borderColor: cislo(u.castka) ? undefined : "#B03A2E",
                                }}
                                value={u.castka}
                                onChange={(e) => zmenUpravu(z, "castka", e.target.value)}
                              />
                            </td>
                          </tr>
                          {volneZalohy.length > 0 && (
                            <tr>
                              <td>
                                Hradí se ze zálohy?
                                <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                                  peníze už jste poslali dopředu
                                </span>
                              </td>
                              <td className="r">
                                <select
                                  className="mini"
                                  style={{ width: "auto" }}
                                  value={vybranaZaloha(z)}
                                  onChange={(e) => setZalohaK({ ...zalohaK, [z.id]: e.target.value })}
                                >
                                  <option value="">ne, platíme zvlášť</option>
                                  {volneZalohy.map((zl) => (
                                    <option key={zl.id} value={zl.id}>
                                      {datumCz(zl.datum)} · {zl.popis} · {kc(zl.castka)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          )}
                          <tr style={{ display: vybranaZaloha(z) ? "none" : undefined }}>
                            <td>Zaplatit z</td>
                            <td className="r">
                              <select
                                className="mini"
                                style={{ width: "auto" }}
                                value={zdroje[z.id] || "hypoteka"}
                                onChange={(e) => setZdroje({ ...zdroje, [z.id]: e.target.value })}
                              >
                                {Object.entries(ZDROJ).map(([k, zz]) => (
                                  <option key={k} value={k}>
                                    {zz.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {z.druh === "faktura" && (
                <>
                  <h3 className="eyebrow" style={{ marginTop: 18, marginBottom: 9 }}>
                    Rozdělit do kategorií
                  </h3>
                  <table className="t">
                    <tbody>
                      {rozpad(z).map((r) => (
                        <tr key={r.id}>
                          <td>
                            <VyberKategorie
                              ukoly={data.ukoly}
                              hodnota={r.ukol}
                              onZmena={(id) => zmenRadek(z, r.id, "ukol", id)}
                            />
                          </td>
                          <td style={{ width: 120 }}>
                            <input
                              className="mini n"
                              inputMode="decimal"
                              style={{ textAlign: "right" }}
                              value={r.castka}
                              onChange={(e) => zmenRadek(z, r.id, "castka", e.target.value)}
                            />
                          </td>
                          <td style={{ width: 28 }}>
                            {rozpad(z).length > 1 && (
                              <button
                                className="x"
                                onClick={() => smazRadek(z, r.id)}
                                aria-label="Odebrat řádek"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="rada" style={{ marginTop: 10 }}>
                    <button className="btn2" onClick={() => pridejRadek(z)}>
                      + další kategorie
                    </button>
                    {Math.abs(zbytek(z)) >= 1 && cislo(u.castka) > 0 && (
                      <span style={{ fontSize: 12.5, color: "#B03A2E", fontWeight: 700 }}>
                        {zbytek(z) > 0
                          ? `Nerozdělených ${kc(zbytek(z))}`
                          : `Rozděleno o ${kc(-zbytek(z))} víc, než je na faktuře`}
                      </span>
                    )}
                    {Math.abs(zbytek(z)) < 1 && cislo(u.castka) > 0 && (
                      <span style={{ fontSize: 12.5, color: "#3E6B4C", fontWeight: 700 }}>
                        Sedí na {kc(cislo(u.castka))}
                      </span>
                    )}
                  </div>
                </>
              )}

              <div className="form" style={{ marginTop: 16 }}>
                <div className="pole" style={{ gridColumn: "span 2" }}>
                  <label>Důvod vrácení</label>
                  <input
                    value={vraceni[z.id] || ""}
                    placeholder="např. chybí účtenka, sedí to na jiný den…"
                    onChange={(e) => setVraceni({ ...vraceni, [z.id]: e.target.value })}
                  />
                </div>
              </div>
              <div className="rada">
                <button className="btn" onClick={() => schval(z)} disabled={!lzeSchvalit(z)}>
                  Schválit a zapsat
                </button>
                <Smazat
                  tlacitko
                  popisek="Smazat"
                  co="tento zápis úplně"
                  onSmaz={() =>
                    uloz({
                      ...data,
                      cekajici: (data.cekajici || []).filter((x) => x.id !== z.id),
                    })
                  }
                />
                <button
                  className="btn2"
                  onClick={() => vrat(z)}
                  disabled={!(vraceni[z.id] || "").trim()}
                  style={{ opacity: (vraceni[z.id] || "").trim() ? 1 : 0.45 }}
                >
                  Vrátit s důvodem
                </button>
                {z.druh === "dochazka" && !vybranaKat(z) && (
                  <span style={{ fontSize: 12.5, color: "#B03A2E" }}>
                    Nejdřív vyber kategorii.
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}

      {lupa && (
        <div className="lupa" onClick={() => setLupa(null)} role="dialog">
          <img src={lupa} alt="Faktura" />
          <button className="lupax" onClick={() => setLupa(null)}>
            Zavřít
          </button>
        </div>
      )}

      {vyrizene.length > 0 && (
        <div className="box">
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.graf} c="#0C3B2E" s={16} />
              </i>
              Vyřízené
            </span>
          </h2>
          <table className="t">
            <tbody>
              {vyrizene.map((z) => (
                <tr key={z.id}>
                  <td className="n nowrap" style={{ color: "#5E7268" }}>
                    {datumCz(z.datum)}
                  </td>
                  <td>
                    {z.druh === "dochazka"
                      ? `${hodinyCelkem(z.hodiny)} h — ${z.popis || z.ukolText || "práce"}`
                      : `Faktura ${z.dodavatel || ""}`}
                    {z.stav === "vraceno" && z.poznamka && (
                      <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                        {z.poznamka}
                      </span>
                    )}
                  </td>
                  <td className="r">
                    <span
                      className="stitek"
                      style={
                        z.stav === "schvaleno"
                          ? { color: "#3E6B4C", background: "#E4EDE5" }
                          : { color: "#B03A2E", background: "#F7DED9" }
                      }
                    >
                      {z.stav === "schvaleno" ? "Schváleno" : "Vráceno"}
                    </span>
                  </td>
                  <td style={{ width: 30 }}>
                    <Smazat
                      co="tento zápis z historie"
                      onSmaz={() =>
                        uloz({
                          ...data,
                          cekajici: (data.cekajici || []).filter((x) => x.id !== z.id),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Nastaveni({ data, uloz, odhlas }) {
  const [n, setN] = useState({
    nazev: data.nazev,
    misto: data.misto || "",
    popisA: (data.kontrola && data.kontrola.popisA) || "",
    popisB: (data.kontrola && data.kontrola.popisB) || "",
    cenaDomu: data.cenaDomu || "",
    provize: data.provize || "",
    jmeno: data.delnik.jmeno,
    dluh: data.delnik.dluh || "",
    sazba: data.sazba || 250,
    pracanti: (data.pracanti || []).map((p) => ({ ...p })),
    heslo: "",
    hesloDelnik: "",
  });
  const [zd, setZd] = useState(() => {
    const o = {};
    Object.keys(ZDROJ).forEach((k) => {
      const z = data.zdroje[k] || {};
      o[k] = {
        celkem: z.celkem || "",
        koupe: z.koupe || "",
        budouci: !!z.budouci,
      };
    });
    return o;
  });
  const zmenZd = (k, pole, hod) =>
    setZd((x) => ({ ...x, [k]: { ...x[k], [pole]: hod } }));
  const soucetKoupe = Object.keys(ZDROJ).reduce((a, k) => a + cislo(zd[k].koupe), 0);
  const soucetDost = Object.keys(ZDROJ).reduce(
    (a, k) => a + cislo(zd[k].celkem) - cislo(zd[k].koupe),
    0
  );
  const [noveTema, setNoveTema] = useState("");
  const [potvrzeno, setPotvrzeno] = useState("");
  const [zaloha, setZaloha] = useState("");
  const [obnova, setObnova] = useState("");
  const [zkopirovano, setZkopirovano] = useState(false);
  const [chybaObnovy, setChybaObnovy] = useState("");
  const [hromadne, setHromadne] = useState("");
  const [vysledek, setVysledek] = useState("");
  const [noveH, setNoveH] = useState({ a: "", b: "", stav: "" });
  const [novyDluh, setNovyDluh] = useState({ datum: dnes(), popis: "", castka: "" });
  const dluhy =
    (data.delnik.dluhPolozky && data.delnik.dluhPolozky.length
      ? data.delnik.dluhPolozky
      : data.delnik.dluh
      ? [{ id: "puv", datum: "", popis: "Původní dluh", castka: data.delnik.dluh }]
      : []) || [];
  const soucetDluhu = dluhy.reduce((a, d) => a + (d.castka || 0), 0);
  const [ok, setOk] = useState(false);

  const potvrd = () => {
    uloz({
      ...data,
      nazev: n.nazev || DEFAULT.nazev,
      misto: n.misto,
      kontrola: {
        ...(data.kontrola || DEFAULT.kontrola),
        popisA: n.popisA.trim(),
        popisB: n.popisB.trim(),
      },
      cenaDomu: cislo(n.cenaDomu),
      provize: cislo(n.provize),
      zdroje: Object.keys(ZDROJ).reduce((o, k) => {
        o[k] = {
          celkem: cislo(zd[k].celkem),
          koupe: cislo(zd[k].koupe),
          budouci: zd[k].budouci,
        };
        return o;
      }, {}),
      delnik: { ...data.delnik, jmeno: n.jmeno || DEFAULT.delnik.jmeno },
      sazba: cislo(n.sazba) || 250,
      pracanti: n.pracanti.map((p, i) => ({
        ...p,
        jmeno: p.jmeno.trim() || "Pracant " + (i + 1),
        sazba: cislo(p.sazba) || cislo(n.sazba) || 250,
        aktivni: p.aktivni !== false,
      })),
      heslo: n.heslo ? n.heslo : data.heslo,
      hesloDelnik: n.hesloDelnik ? n.hesloDelnik : data.hesloDelnik,
    });
    setOk(true);
    setTimeout(() => setOk(false), 2500);
  };
  const pridejTema = () => {
    const t = noveTema.trim();
    if (!t || data.temata.includes(t)) return;
    uloz({ ...data, temata: [...data.temata, t] });
    setNoveTema("");
  };
  const smazTema = (t) => {
    if (data.polozky.some((p) => p.tema === t)) return;
    uloz({ ...data, temata: data.temata.filter((x) => x !== t) });
  };

  return (
    <>
      <div className="box" style={{ marginTop: 0 }}>
        <h2 className="boxh">Stavba</h2>
        <div className="form">
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Název stavby</label>
            <input value={n.nazev} onChange={(e) => setN({ ...n, nazev: e.target.value })} />
          </div>
          <div className="pole">
            <label>Obec</label>
            <input value={n.misto} onChange={(e) => setN({ ...n, misto: e.target.value })} />
          </div>
          <div className="pole">
            <label>Název 1. účtu</label>
            <input
              value={n.popisA}
              placeholder="účet 1"
              onChange={(e) => setN({ ...n, popisA: e.target.value })}
            />
          </div>
          <div className="pole">
            <label>Název 2. účtu</label>
            <input
              value={n.popisB}
              placeholder="účet 2"
              onChange={(e) => setN({ ...n, popisB: e.target.value })}
            />
          </div>
          <div className="pole">
            <label>Kupní cena domu</label>
            <input
              className="n"
              inputMode="decimal"
              value={n.cenaDomu}
              onChange={(e) => setN({ ...n, cenaDomu: e.target.value })}
            />
          </div>
          <div className="pole">
            <label>Provize realitce a poplatky</label>
            <input
              className="n"
              inputMode="decimal"
              value={n.provize}
              onChange={(e) => setN({ ...n, provize: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="box">
        <h2 className="boxh">
          Zdroje peněz
          <span className="n">na rekonstrukci zbývá {kc(soucetDost)}</span>
        </h2>
        <table className="t tKarty">
          <thead>
            <tr>
              <th>Zdroj</th>
              <th style={{ width: "24%" }}>Celkem</th>
              <th style={{ width: "24%" }}>Z toho na koupi</th>
              <th className="r">Na rekonstrukci</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(ZDROJ).map(([k, z]) => (
              <tr key={k}>
                <td>
                  <span
                    className="stitek"
                    style={{ color: z.tmava, background: z.svetla }}
                  >
                    {z.label}
                  </span>
                  {zd[k].budouci && (
                    <span style={{ display: "block", fontSize: 11, color: "#5E7268", marginTop: 3 }}>
                      přijde až zpětně
                    </span>
                  )}
                </td>
                <td data-popis="Celkem">
                  <input
                    className="mini n"
                    inputMode="decimal"
                    value={zd[k].celkem}
                    placeholder="0"
                    onChange={(e) => zmenZd(k, "celkem", e.target.value)}
                  />
                </td>
                <td data-popis="Z toho na koupi">
                  <input
                    className="mini n"
                    inputMode="decimal"
                    value={zd[k].koupe}
                    placeholder="0"
                    onChange={(e) => zmenZd(k, "koupe", e.target.value)}
                  />
                </td>
                <td className="r n nowrap bunkaCastka" data-popis="Na rekonstrukci" style={{ fontWeight: 800 }}>
                  {kc(cislo(zd[k].celkem) - cislo(zd[k].koupe))}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid #C9AE85" }}>
              <td style={{ fontWeight: 800, paddingTop: 11 }}>Celkem</td>
              <td className="n" style={{ fontWeight: 800, paddingTop: 11 }}>
                {kc(Object.keys(ZDROJ).reduce((a, k) => a + cislo(zd[k].celkem), 0))}
              </td>
              <td className="n" style={{ fontWeight: 800, paddingTop: 11 }}>
                {kc(soucetKoupe)}
              </td>
              <td className="r n nowrap" style={{ fontWeight: 800, paddingTop: 11 }}>
                {kc(soucetDost)}
              </td>
            </tr>
          </tbody>
        </table>
        {cislo(n.cenaDomu) > 0 &&
          Math.abs(soucetKoupe - (cislo(n.cenaDomu) + cislo(n.provize))) > 1 && (
            <div className="hlaska zle">
              Součet částek na koupi ({kc(soucetKoupe)}) nesedí s kupní cenou plus
              provizí ({kc(cislo(n.cenaDomu) + cislo(n.provize))}) — rozdíl{" "}
              {kc(cislo(n.cenaDomu) + cislo(n.provize) - soucetKoupe)}.
            </div>
          )}
        {cislo(n.cenaDomu) > 0 &&
          Math.abs(soucetKoupe - (cislo(n.cenaDomu) + cislo(n.provize))) <= 1 && (
            <div className="hlaska dobre">
              Sedí: {kc(cislo(n.cenaDomu))} kupní cena + {kc(cislo(n.provize))}{" "}
              provize = {kc(soucetKoupe)}.
            </div>
          )}
        <p className="pozn">
          „Z toho na koupi" je část zdroje, která padla na pořízení domu. Zbytek
          je to, s čím se počítá na rekonstrukci.
        </p>
      </div>

      <div className="box">
        <h2 className="boxh">Dělník a parta</h2>
        <div className="form">
          <div className="pole">
            <label>Jméno</label>
            <input value={n.jmeno} onChange={(e) => setN({ ...n, jmeno: e.target.value })} />
          </div>
          <div className="pole">
            <label>Hodinová sazba</label>
            <input
              className="n"
              inputMode="decimal"
              value={n.sazba}
              onChange={(e) => setN({ ...n, sazba: e.target.value })}
            />
          </div>
        </div>
        <h3 className="eyebrow" style={{ marginTop: 18, marginBottom: 9 }}>
          Kdo se objeví v píchačce
        </h3>
        <div className="form">
          {(data.pracanti || []).map((p, i) => (
            <div className="pole" key={p.id}>
              <label>{i === 0 ? "Hlavní" : "Výpomoc " + i}</label>
              <input
                value={(n.pracanti[i] && n.pracanti[i].jmeno) || ""}
                onChange={(e) => {
                  const kopie = n.pracanti.map((x, j) =>
                    j === i ? { ...x, jmeno: e.target.value } : x
                  );
                  setN({ ...n, pracanti: kopie });
                }}
              />
              <input
                className="n"
                inputMode="decimal"
                style={{ marginTop: 6 }}
                placeholder="sazba Kč/h"
                value={(n.pracanti[i] && n.pracanti[i].sazba) || ""}
                onChange={(e) => {
                  const kopie = n.pracanti.map((x, j) =>
                    j === i ? { ...x, sazba: e.target.value } : x
                  );
                  setN({ ...n, pracanti: kopie });
                }}
              />
              <label className="chk" style={{ marginTop: 7, paddingBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={(n.pracanti[i] && n.pracanti[i].aktivni) !== false}
                  onChange={(e) => {
                    const kopie = n.pracanti.map((x, j) =>
                      j === i ? { ...x, aktivni: e.target.checked } : x
                    );
                    setN({ ...n, pracanti: kopie });
                  }}
                />
                <span style={{ fontSize: 12 }}>v píchačce</span>
              </label>
            </div>
          ))}
        </div>
        <p className="pozn">
          Každý může mít vlastní sazbu. Odškrtnutím „v píchačce" pracanta
          schováš — zůstane v nastavení, ale {n.jmeno} ho v zápisu hodin
          neuvidí.
        </p>
      </div>

      <div className="box">
        <h2 className="boxh">
          Z čeho se skládá {n.jmeno}ův dluh
          <span className="n">{kc(soucetDluhu)}</span>
        </h2>
        {dluhy.length > 0 && (
          <table className="t">
            <tbody>
              {dluhy.map((d) => (
                <tr key={d.id}>
                  <td className="n nowrap" style={{ color: "#5E7268", width: 90 }}>
                    {d.datum ? datumCz(d.datum) : "—"}
                  </td>
                  <td>{d.popis}</td>
                  <td className="r n nowrap" style={{ fontWeight: 700 }}>
                    {kc(d.castka)}
                  </td>
                  <td>
                    <Smazat
                      co="tuto položku dluhu"
                      onSmaz={() =>
                        uloz({
                          ...data,
                          delnik: {
                            ...data.delnik,
                            dluhPolozky: dluhy.filter((x) => x.id !== d.id),
                          },
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="form" style={{ marginTop: 12 }}>
          <div className="pole">
            <label>Datum</label>
            <input
              type="date"
              value={novyDluh.datum}
              onChange={(e) => setNovyDluh({ ...novyDluh, datum: e.target.value })}
            />
          </div>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Za co</label>
            <input
              value={novyDluh.popis}
              placeholder="např. půjčka na auto"
              onChange={(e) => setNovyDluh({ ...novyDluh, popis: e.target.value })}
            />
          </div>
          <div className="pole">
            <label>Částka</label>
            <input
              className="n"
              inputMode="decimal"
              value={novyDluh.castka}
              onChange={(e) => setNovyDluh({ ...novyDluh, castka: e.target.value })}
            />
          </div>
          <button
            className="btn2"
            onClick={() => {
              const c = cislo(novyDluh.castka);
              if (!c || !novyDluh.popis.trim()) return;
              uloz({
                ...data,
                delnik: {
                  ...data.delnik,
                  dluh: 0,
                  dluhPolozky: [
                    ...dluhy,
                    { id: uid(), datum: novyDluh.datum, popis: novyDluh.popis.trim(), castka: c },
                  ],
                },
              });
              setNovyDluh({ datum: dnes(), popis: "", castka: "" });
            }}
          >
            Přidat
          </button>
        </div>
        <p className="pozn">
          Tento rozpis {n.jmeno} uvidí ve svém přehledu pod tlačítkem „Za co
          všechno to je". Splátky prací se odečítají automaticky.
        </p>
      </div>

      <div className="box">
        <h2 className="boxh">Plán z hypotéky</h2>
        <p className="pozn" style={{ marginTop: 0 }}>
          Rozpočet o {PLAN_HYPOTEKA.length} položkách v celkové výši{" "}
          {kc(PLAN_SOUCET)}. Načtením se položky přidají ke stávajícím
          kategoriím — pokud už je tam máš, vzniknou dvojmo.
        </p>
        <div className="rada">
          <button
            className="btn2"
            onClick={() => {
              if (potvrzeno !== "plan") return setPotvrzeno("plan");
              uloz({ ...data, ukoly: [...data.ukoly, ...planNaUkoly()] });
              setPotvrzeno("");
            }}
          >
            {potvrzeno === "plan"
              ? "Opravdu načíst znovu?"
              : "Načíst plán z hypotéky"}
          </button>
          {potvrzeno === "plan" && (
            <button className="btn2" onClick={() => setPotvrzeno("")}>
              Zrušit
            </button>
          )}
        </div>
      </div>

      <div className="box">
        <h2 className="boxh">Druhy materiálu</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {data.temata.map((t) => {
            const pouzito = data.polozky.some((p) => p.tema === t);
            return (
              <span
                key={t}
                className="stitek"
                style={{
                  color: "#5E7268",
                  background: "#EFE8D6",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 5px",
                }}
              >
                {t}
                {!pouzito && (
                  <Smazat onSmaz={() => smazTema(t)} co={"téma " + t} />
                )}
              </span>
            );
          })}
        </div>
        <div className="form">
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Přidat téma</label>
            <input
              value={noveTema}
              placeholder="např. klempířina"
              onChange={(e) => setNoveTema(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pridejTema()}
            />
          </div>
          <button className="btn2" onClick={pridejTema}>
            Přidat
          </button>
        </div>
        <p className="pozn">Téma, na které je navázaný výdaj, smazat nejde.</p>
      </div>

      <div className="box">
        <h2 className="boxh">Fotky faktur a soukromí</h2>
        <label className="chk" style={{ paddingBottom: 12 }}>
          <input
            type="checkbox"
            checked={data.uklFotky !== false}
            onChange={(e) => uloz({ ...data, uklFotky: e.target.checked })}
          />
          Ukládat fotky faktur do archivu
        </label>
        <p className="pozn" style={{ marginTop: 0 }}>
          Heslo na vstupu je jednoduchý zámek, ne šifrování. Skutečná ochrana je
          odkaz na tuhle appku — ber ho jako klíč od domu a nikam ho nevkládej.
          Fotky jsou komprimované, na doložení dotace si nech originály jinde.
        </p>
        <div className="rada">
          <button
            className="btn2"
            onClick={async () => {
              if (potvrzeno !== "fotky") return setPotvrzeno("fotky");
              for (const f of data.faktury || []) {
                try {
                  await ULOZISTE.delete("fa:" + f.id, true);
                } catch (e) {}
              }
              uloz({
                ...data,
                faktury: (data.faktury || []).map((f) => ({ ...f, mafoto: false })),
              });
              setPotvrzeno("");
            }}
          >
            {potvrzeno === "fotky"
              ? "Opravdu smazat všechny fotky?"
              : "Smazat všechny uložené fotky"}
          </button>
          {potvrzeno === "fotky" && (
            <button className="btn2" onClick={() => setPotvrzeno("")}>
              Zrušit
            </button>
          )}
        </div>
      </div>

      <div className="box">
        <h2 className="boxh">
          Odkazy na originály dokladů
          <span className="n">
            {data.polozky.filter((p) => p.odkaz).length} z {data.polozky.length}
          </span>
        </h2>
        <div className="form" style={{ marginBottom: 14 }}>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Složka s doklady na webu</label>
            <input
              value={data.zakladOdkazu || ""}
              placeholder="doklady/"
              onChange={(e) => uloz({ ...data, zakladOdkazu: e.target.value })}
            />
          </div>
        </div>
        <p className="pozn" style={{ marginTop: 0 }}>
          Když sem zadáš složku, odkaz se poskládá sám z čísla dokladu — třeba
          <span className="n"> doklady/cislo-faktury.pdf</span>. Do políček níž
          vlož odkaz u každého dokladu, který máš uložený jinde — třeba na Disku.
        </p>
        <div className="hlaska" style={{ marginTop: 0 }}>
          <b>Hromadné vložení.</b> Zkopíruj z Disku odkazy a vlož sem — na každý
          řádek číslo dokladu, mezeru nebo tabulátor a odkaz. Přiřadí se samy.
          <textarea
            className="zalohaPole"
            placeholder={"cislo-dokladu https://drive.google.com/...\ndalsi-cislo https://drive.google.com/..."}
            value={hromadne}
            onChange={(e) => setHromadne(e.target.value)}
          />
          <div className="rada">
            <button
              className="btn"
              disabled={!hromadne.trim()}
              onClick={() => {
                const mapa = {};
                hromadne.split("\n").forEach((r) => {
                  const m = r.trim().match(/^(\S+)[\s\t]+(https?:\/\/\S+)$/);
                  if (m) mapa[m[1]] = m[2];
                });
                const pocet = Object.keys(mapa).length;
                if (!pocet) return setVysledek("Nenašel jsem žádný použitelný řádek.");
                let sedlo = 0;
                const nove = data.polozky.map((p) => {
                  const o = mapa[String(p.cisloDokladu)];
                  if (!o) return p;
                  sedlo++;
                  return { ...p, odkaz: o };
                });
                uloz({ ...data, polozky: nove });
                setHromadne("");
                setVysledek(
                  `Vloženo ${pocet} odkazů, přiřadilo se jich ${sedlo}.` +
                    (sedlo < pocet ? " Zbytek neodpovídá žádnému číslu dokladu." : "")
                );
              }}
            >
              Přiřadit odkazy
            </button>
            {vysledek && (
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#3E6B4C" }}>
                {vysledek}
              </span>
            )}
          </div>
        </div>

        <table className="t">
          <tbody>
            {[...data.polozky]
              .sort((a, b) => (a.datum < b.datum ? 1 : -1))
              .map((p) => (
                <tr key={p.id}>
                  <td className="n nowrap" style={{ color: "#5E7268", width: 74 }}>
                    {datumCz(p.datum)}
                  </td>
                  <td style={{ width: "34%" }}>
                    {p.dodavatel || p.popis}
                    {p.cisloDokladu && (
                      <span className="n" style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                        {p.cisloDokladu}
                      </span>
                    )}
                  </td>
                  <td>
                    <input
                      className="mini"
                      value={p.odkaz || ""}
                      placeholder="odkaz na PDF…"
                      onChange={(e) =>
                        uloz({
                          ...data,
                          polozky: data.polozky.map((x) =>
                            x.id === p.id ? { ...x, odkaz: e.target.value } : x
                          ),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="box">
        <h2 className="boxh">Kde se ukládají data</h2>
        {ULOZISTE.rezim === "supabase" && (
          <div className="hlaska dobre" style={{ marginTop: 0 }}>
            <b>Sdílená databáze.</b> Všichni, kdo znají adresu a heslo, vidí ta
            samá čísla — z mobilu i z počítače.
          </div>
        )}
        {ULOZISTE.rezim === "claude" && (
          <div className="hlaska dobre" style={{ marginTop: 0 }}>
            <b>Sdílené úložiště.</b> Aplikace běží uvnitř Claude, data se sdílí
            mezi zařízeními.
          </div>
        )}
        {ULOZISTE.rezim === "prohlizec" && (
          <div className="hlaska zle" style={{ marginTop: 0 }}>
            <b>Jen tenhle prohlížeč.</b> Ostatní zařízení data neuvidí. Chybí
            připojení k databázi — doplň ho v souboru <b>config.js</b>.
          </div>
        )}
      </div>

      <div className="box" style={{ borderLeft: "5px solid #6D9773" }}>
        <h2 className="boxh">Záloha dat</h2>
        <p className="pozn" style={{ marginTop: 0 }}>
          Vyexportuje všechno kromě fotek faktur. Text si ulož nebo pošli — dá
          se z něj kdykoli obnovit stav, i v jiné verzi aplikace.
        </p>
        <div className="rada">
          <button
            className="btn2"
            onClick={() => {
              const { heslo, ...bezHesla } = data;
              setZaloha(JSON.stringify(bezHesla));
            }}
          >
            Vytvořit zálohu
          </button>
          {zaloha && (
            <button
              className="btn2"
              onClick={() => {
                try {
                  navigator.clipboard.writeText(zaloha);
                  setZkopirovano(true);
                  setTimeout(() => setZkopirovano(false), 2500);
                } catch (e) {}
              }}
            >
              {zkopirovano ? "Zkopírováno" : "Zkopírovat"}
            </button>
          )}
        </div>
        {zaloha && (
          <textarea
            className="zalohaPole"
            readOnly
            value={zaloha}
            onClick={(e) => e.target.select()}
          />
        )}

        <h3 className="eyebrow" style={{ marginTop: 20, marginBottom: 8 }}>
          Obnovit ze zálohy
        </h3>
        <textarea
          className="zalohaPole"
          placeholder="Sem vlož text zálohy…"
          value={obnova}
          onChange={(e) => setObnova(e.target.value)}
        />
        <div className="rada">
          <button
            className="btn2"
            style={{ background: "#F7DED9", color: "#B03A2E" }}
            onClick={() => {
              if (potvrzeno !== "obnova") return setPotvrzeno("obnova");
              try {
                const nove = JSON.parse(obnova);
                if (!nove || typeof nove !== "object") throw new Error("x");
                // Záloha může být z libovolně staré verze — musí projít
                // stejnou migrací jako data načtená z databáze. Bez toho by
                // se do aplikace dostaly klíče pod původními názvy.
                uloz(migruj2({ ...nove, heslo: data.heslo }));
                setObnova("");
                setPotvrzeno("");
                setChybaObnovy("");
              } catch (e) {
                setChybaObnovy("Text zálohy se nepodařilo přečíst. Zkontroluj, že jsi vložila celý.");
                setPotvrzeno("");
              }
            }}
            disabled={!obnova.trim()}
          >
            {potvrzeno === "obnova"
              ? "Opravdu přepsat všechna data?"
              : "Obnovit ze zálohy"}
          </button>
          {potvrzeno === "obnova" && (
            <button className="btn2" onClick={() => setPotvrzeno("")}>
              Zrušit
            </button>
          )}
        </div>
        {chybaObnovy && <div className="hlaska zle">{chybaObnovy}</div>}
      </div>

      <div className="box" style={{ borderLeft: "5px solid #B03A2E" }}>
        <h2 className="boxh">Úklid po testování</h2>
        <p className="pozn" style={{ marginTop: 0 }}>
          Smaže všechny výdaje, faktury, zápisy práce, platby, zálohy i
          čekající zápisy. Kategorie, zdroje peněz a nastavení zůstanou.
        </p>
        <div className="rada">
          <button
            className="btn2"
            style={{ background: "#F7DED9", color: "#B03A2E" }}
            onClick={async () => {
              if (potvrzeno !== "reset") return setPotvrzeno("reset");
              for (const f of data.faktury || []) {
                try {
                  await ULOZISTE.delete("fa:" + f.id, true);
                } catch (e) {}
              }
              for (const z of data.cekajici || []) {
                try {
                  await ULOZISTE.delete("fa:" + z.id, true);
                } catch (e) {}
              }
              uloz({
                ...data,
                polozky: [],
                zaznamy: [],
                faktury: [],
                cekajici: [],
                zalohy: [],
                // Popisy účtů nejsou záznam, ty se mazáním testovacích dat neruší.
                kontrola: {
                  ...DEFAULT.kontrola,
                  popisA: (data.kontrola && data.kontrola.popisA) || "",
                  popisB: (data.kontrola && data.kontrola.popisB) || "",
                },
                delnik: { ...data.delnik, dluhPolozky: [], dluh: 0 },
                ukoly: data.ukoly.map((u) => ({ ...u, stav: "plan" })),
              });
              setPotvrzeno("");
            }}
          >
            {potvrzeno === "reset"
              ? "Opravdu smazat všechny záznamy?"
              : "Smazat všechna testovací data"}
          </button>
          {potvrzeno === "reset" && (
            <button className="btn2" onClick={() => setPotvrzeno("")}>
              Zrušit
            </button>
          )}
        </div>
      </div>

      <div className="box">
        <h2 className="boxh">
          Moje heslo
          {RELACE && RELACE.email && (
            <span className="n" style={{ fontSize: 12.5 }}>{RELACE.email}</span>
          )}
        </h2>
        <div className="form">
          <div className="pole">
            <label>Nové heslo</label>
            <input
              type="password"
              value={noveH.a}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setNoveH({ ...noveH, a: e.target.value, stav: "" })}
            />
          </div>
          <div className="pole">
            <label>Ještě jednou</label>
            <input
              type="password"
              value={noveH.b}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setNoveH({ ...noveH, b: e.target.value, stav: "" })}
            />
          </div>
          <button
            className="btn"
            disabled={!noveH.a || !noveH.b || noveH.stav === "pracuju"}
            onClick={async () => {
              if (noveH.a.length < 6)
                return setNoveH({ ...noveH, stav: "Heslo musí mít aspoň 6 znaků." });
              if (noveH.a !== noveH.b)
                return setNoveH({ ...noveH, stav: "Hesla se neshodují." });
              setNoveH({ ...noveH, stav: "pracuju" });
              try {
                await zmenHeslo(noveH.a);
                setNoveH({ a: "", b: "", stav: "Heslo je změněné." });
              } catch (e) {
                setNoveH({ ...noveH, stav: e.message });
              }
            }}
          >
            {noveH.stav === "pracuju" ? "Ukládám…" : "Změnit heslo"}
          </button>
        </div>
        {noveH.stav && noveH.stav !== "pracuju" && (
          <div className={"hlaska " + (noveH.stav === "Heslo je změněné." ? "dobre" : "zle")}>
            {noveH.stav}
          </div>
        )}
        <p className="pozn">
          Mění se heslo účtu {RELACE && RELACE.email ? RELACE.email : ", pod kterým jsi přihlášená"}.
          Hesla ostatních se mění v Supabase, nebo si je každý změní tady sám.
        </p>
      </div>

      <div className="box" style={{ display: "none" }}>
        <h2 className="boxh">
          Hesla
          {odhlas && (
            <button className="btn2" onClick={odhlas}>
              Odhlásit
            </button>
          )}
        </h2>
        {!HESLO_ZAPNUTO && (
          <div className="hlaska">
            Zámek je teď vypnutý, appka se otevírá rovnou. Až budete nasazovat
            naostro, přepni v kódu nahoře <b>HESLO_ZAPNUTO</b> na <b>true</b> —
            heslo nastavené tady se pak začne vyžadovat.
          </div>
        )}
        <div className="form" style={{ marginTop: 12 }}>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Vaše heslo {data.heslo ? "(prázdné = ponechat)" : ""}</label>
            <input
              type="password"
              value={n.heslo}
              onChange={(e) => setN({ ...n, heslo: e.target.value })}
            />
          </div>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>
              Kód pro {n.jmeno} {data.hesloDelnik ? "(prázdné = ponechat)" : "(nepovinné)"}
            </label>
            <input
              type="text"
              value={n.hesloDelnik}
              placeholder="nechat prázdné = bez kódu"
              onChange={(e) => setN({ ...n, hesloDelnik: e.target.value })}
            />
          </div>
        </div>
        <p className="pozn">
          Vaše heslo chrání rozpočet a faktury. Kód pro {n.jmeno} chrání jeho
          pracovní deník — jeho hodiny, platby a rozpis dluhu. Když ho necháš
          prázdný, jeho stranu si otevře kdokoli s odkazem.
        </p>
      </div>

      <div className="rada">
        <button className="btn" onClick={potvrd}>
          Uložit nastavení
        </button>
        {ok && (
          <span style={{ fontSize: 13, color: "#3E6B4C", fontWeight: 650 }}>Uloženo.</span>
        )}
      </div>
    </>
  );
}
