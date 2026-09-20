import { useState, useEffect, useRef } from "react";

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

async function prihlasSe(email, heslo) {
  const { url, klic } = dbAdresa();
  const r = await fetch(url + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: klic, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password: heslo }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const zprava = (d && (d.error_description || d.msg || d.message)) || "";
    if (/invalid login/i.test(zprava) || r.status === 400)
      throw new Error("E-mail nebo heslo nesedí.");
    throw new Error("Přihlášení se nepovedlo: " + (zprava || r.status));
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

async function obnovToken() {
  if (!RELACE || !RELACE.refresh_token) return null;
  const { url, klic } = dbAdresa();
  try {
    const r = await fetch(url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: klic, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: RELACE.refresh_token }),
    });
    if (!r.ok) {
      zrusRelaci();
      return null;
    }
    ulozRelaci(await r.json());
    return RELACE.access_token;
  } catch (e) {
    return null;
  }
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
    const hlavicky = async () => {
      const token = await platnyToken();
      return {
        apikey: SUPABASE_KLIC,
        Authorization: "Bearer " + (token || SUPABASE_KLIC),
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
        const r = await fetch(
          `${zaklad}?klic=eq.${encodeURIComponent(klic)}&select=hodnota`,
          { headers: await hlavicky() }
        );
        if (!r.ok) throw await popisChyby(r, "Čtení z databáze");
        const d = await r.json();
        return d.length ? { key: klic, value: d[0].hodnota } : null;
      },
      async set(klic, hodnota) {
        const r = await fetch(zaklad, {
          method: "POST",
          headers: { ...(await hlavicky()), Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ klic, hodnota }),
        });
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

const DUM_OBRAZEK = "data:image/jpeg;base64,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";

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

  useEffect(() => {
    (async () => {
      let d = null;
      try {
        const r = await ULOZISTE.get(KEY, true);
        d = r ? JSON.parse(r.value) : null;
      } catch (e) {}
      if (!d) {
        try {
          const s2 = await ULOZISTE.get(KEY_V2, true);
          if (s2) d = JSON.parse(s2.value);
        } catch (e) {}
      }
      if (!d) {
        try {
          const s1 = await ULOZISTE.get(KEY_STARY, true);
          if (s1) d = migruj(JSON.parse(s1.value));
        } catch (e) {}
      }
      setData(migruj2(d || {}));
      setNacteno(true);
    })();
  }, [znovu]);

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

  if (!nacteno)
    return (
      <div className="sd">
        <style>{CSS}</style>
        <p className="prazdno" style={{ paddingTop: 70 }}>
          Otevírám deník…
        </p>
      </div>
    );

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

  if (!prihlasena)
    return (
      <Prihlaseni
        onHotovo={() => {
          setPrihlasena(true);
          setZnovu((x) => x + 1);
        }}
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

function Smazat({ onSmaz, co = "tento záznam", popisek = "Smazat" }) {
  const [ptam, setPtam] = useState(false);
  if (!ptam)
    return (
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
            <img src={DUM_OBRAZEK} alt="Náš dům v Žíželevsi" />
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
          <small>On dluží nám</small>
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
              Má ke všemu podklady?
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
              <tr style={{ borderTop: "2px solid #C9AE85" }}>
                <td>
                  <span className="tecka" style={{ background: "#E0D5BF" }} />
                </td>
                <td style={{ fontWeight: 800, paddingTop: 11 }}>
                  {s.nevysvetleno > 0 ? "Zatím nevysvětleno" : "Odpracováno nad rámec plateb"}
                </td>
                <td
                  className="r n nowrap"
                  style={{
                    fontWeight: 800,
                    paddingTop: 11,
                    color: s.nevysvetleno > 0 ? "#B03A2E" : "#3E6B4C",
                  }}
                >
                  {kc(Math.abs(s.nevysvetleno))}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="pozn">
            {s.nevysvetleno > 0
              ? `Z poslaných peněz zbývá vysvětlit ${kc(s.nevysvetleno)}. To musí pokrýt odpracované hodiny — až doplníš pracovní deník, číslo klesne. Co zůstane, je podklad k jednání.`
              : `Podklady pokrývají všechno, co jste poslali. ${kc(-s.nevysvetleno)} je práce navíc, kterou mu ještě dlužíte.`}
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
          Dluh {data.delnik.jmeno}y
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
  const nevysvetleno = vyplaceno - dolozenoFakturami - odpracovano;
  const neproplacene = material.filter((p) => p.proplaceno === false);
  const neproplacenoCelkem = neproplacene.reduce((a, p) => a + p.castka, 0);
  const kVyplate = zbyvaVyplatit + neproplacenoCelkem;

  return {
    sazba, prace, platby, odbydlene, odpracovano, vyplaceno, odbydleno,
    zbyvaVyplatit, vyplacenoNaPraci, dluhPolozky, dluhCelkem, dluhPripsano, dluhOdmazano, zbyvaDluh, mesicniRada,
    hodinyMesic, tentoMesic, hodinyCelkove, mojeHodiny, material, materialCelkem,
    neproplacene, neproplacenoCelkem, kVyplate, zalohyCeka, zalohyCekaCelkem,
    dolozenoFakturami, nevysvetleno,
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
      </div>
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
                uloz({ ...nove, heslo: data.heslo });
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
