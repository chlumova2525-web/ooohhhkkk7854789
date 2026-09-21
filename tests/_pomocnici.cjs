// Společný základ pro testy. Žádný framework — jen node, esbuild a jsdom.
//
// Funkce v src/app.jsx nejsou exportované, protože soubor je jeden balík
// pro prohlížeč. Testy si proto sestaví dočasnou kopii s přidaným exportem.
// Kopie se po sestavení maže, do gitu se nikdy nedostane.

const fs = require("fs");
const path = require("path");

const KOREN = path.resolve(__dirname, "..");
const DOCASNE = path.join(KOREN, "tests", ".docasne");

// Přes JS API, ne přes spuštění binárky. Na Windows je esbuild .cmd soubor
// a execFileSync na něj od Node 20 padá s EINVAL.
function esbuild() {
  try {
    return require("esbuild");
  } catch (e) {
    throw new Error("esbuild chybí — spusť npm install");
  }
}

// Najde, který modul dané jméno vyváží.
function kdeJeVyvezeno(jmeno) {
  const src = path.join(KOREN, "src");
  for (const soubor of fs.readdirSync(src).filter((f) => /\.(js|jsx)$/.test(f))) {
    const re = new RegExp("^export\\s+(?:async\\s+)?(?:const|let|function|class)\\s+" + jmeno + "\\b", "m");
    if (re.test(fs.readFileSync(path.join(src, soubor), "utf8"))) return soubor;
  }
  return null;
}

// Zpřístupní funkce ze zdrojáku pro testy čistých výpočtů.
// Nekopíruje app.jsx — postaví jen malý soubor, který vyjmenovaná jména
// přeposílá z modulů, kde doopravdy jsou. Díky tomu přesun funkce do
// jiného modulu testy nerozbije.
const cache = new Map();
function nactiZeZdroje(nazvy) {
  const klic = nazvy.slice().sort().join(",");
  if (cache.has(klic)) return cache.get(klic);

  const podleModulu = new Map();
  for (const n of nazvy) {
    const m = kdeJeVyvezeno(n);
    if (!m) throw new Error("žádný modul v src/ nevyváží „" + n + "“");
    if (!podleModulu.has(m)) podleModulu.set(m, []);
    podleModulu.get(m).push(n);
  }

  fs.mkdirSync(DOCASNE, { recursive: true });
  const vstup = path.join(KOREN, "src", "__test-export.jsx");
  const vystup = path.join(DOCASNE, "export-" + Buffer.from(klic).toString("hex").slice(0, 16) + ".cjs");
  try {
    const radky = [...podleModulu].map(([m, jm]) => 'export { ' + jm.join(", ") + ' } from "./' + m + '";');
    fs.writeFileSync(vstup, radky.join("\n") + "\n");
    esbuild().buildSync({
      entryPoints: [vstup],
      bundle: true,
      format: "cjs",
      jsx: "automatic",
      loader: { ".jsx": "jsx" },
      define: { "process.env.NODE_ENV": '"production"' },
      outfile: vystup,
      logLevel: "silent",
    });
  } finally {
    fs.rmSync(vstup, { force: true });
  }

  // app.jsx sahá na localStorage už při načtení modulu.
  pripravProhlizec();
  const modul = require(vystup);
  cache.set(klic, modul);
  return modul;
}

// Minimální náhrada prohlížeče pro testy čistých funkcí.
function pripravProhlizec() {
  const uloziste = {};
  globalThis.localStorage = {
    getItem: (k) => (k in uloziste ? uloziste[k] : null),
    setItem: (k, v) => { uloziste[k] = String(v); },
    removeItem: (k) => { delete uloziste[k]; },
  };
  globalThis.window = globalThis.window || { localStorage: globalThis.localStorage };
}

function zaloha() {
  return JSON.parse(fs.readFileSync(path.join(KOREN, "data", "zaloha-dat.json"), "utf8"));
}

function maZalohu() {
  return fs.existsSync(path.join(KOREN, "data", "zaloha-dat.json"));
}

// ── Spuštění aplikace v jsdom ────────────────────────────────────────
// Testuje se sestavený docs/app.js, tedy přesně to, co dostane prohlížeč.

function spustAplikaci({ relace, fetchStub, nastaveni, cekat = 900 } = {}) {
  const { JSDOM } = require("jsdom");
  const html = fs.readFileSync(path.join(KOREN, "docs", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(KOREN, "docs", "app.js"), "utf8");
  const volani = [];
  const pady = [];

  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://test.invalid/",
    beforeParse(w) {
      w.fetch = (u, o) => { volani.push({ u: String(u), o }); return (fetchStub || (() => odpoved(200, [])))(String(u), o); };
      // jsdom je nezná a komponenty by na nich spadly
      w.scrollTo = () => {};
      w.HTMLElement.prototype.scrollTo = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
    },
  });

  const w = dom.window;
  w.addEventListener("error", (e) => pady.push(e.message));
  if (relace) w.localStorage.setItem("sd:relace", JSON.stringify(relace));
  w.NASTAVENI = nastaveni || { supabaseUrl: "https://test.supabase.co", supabaseKlic: "sb_publishable_test", zakladOdkazu: "" };

  try {
    w.eval(app);
  } catch (e) {
    pady.push("výjimka při spuštění: " + e.message);
  }

  const api = {
    w, volani, pady,
    text: () => (w.document.getElementById("root") || {}).textContent || "",
    html: () => (w.document.getElementById("root") || {}).innerHTML || "",
    tlacitka: () => [...w.document.querySelectorAll("button")],
    klik(hledej) {
      const b = api.tlacitka().find((x) => hledej.test(x.textContent));
      if (b) b.dispatchEvent(new w.Event("click", { bubbles: true }));
      return !!b;
    },
    vypln(el, hodnota) {
      const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
      setter.call(el, hodnota);
      el.dispatchEvent(new w.Event("input", { bubbles: true }));
    },
    pockej: (ms = 400) => new Promise((r) => setTimeout(r, ms)),
  };
  return api.pockej(cekat).then(() => api);
}

// ── Odpovědi serveru ─────────────────────────────────────────────────

const odpoved = (status, telo) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(telo),
  text: () => Promise.resolve(typeof telo === "string" ? telo : JSON.stringify(telo)),
});

// Přesně to, co udělá prohlížeč při ERR_NAME_NOT_RESOLVED nebo blokaci.
const sitovaChyba = () => Promise.reject(new TypeError("Failed to fetch"));

const KLIC_DENIKU = "rekonstrukce-v3";

// Aplikace zapisuje do téže tabulky i denní zálohy pod klíčem
// zaloha:RRRR-MM-DD. Testy, které počítají uložení deníku, musí obojí
// rozlišit — jinak jim do počtu spadne i záloha.
function jeZapis(o) {
  return !!o && (o.method === "POST" || o.method === "PATCH");
}

function klicZapisu(u, o) {
  const m = String(u).match(/klic=eq\.([^&]*)/);
  if (m) return decodeURIComponent(m[1]);
  try {
    return JSON.parse(o.body).klic || null;
  } catch (e) {
    return null;
  }
}

const jeZapisDeniku = (u, o) => jeZapis(o) && klicZapisu(u, o) === KLIC_DENIKU;
const jeZapisZalohy = (u, o) => jeZapis(o) && String(klicZapisu(u, o) || "").startsWith("zaloha:");

const RELACE_PLATNA = { access_token: "tok", refresh_token: "ref", platiDo: Date.now() + 3600e3, email: "test@example.invalid" };
const RELACE_VYPRSELA = { access_token: "stary", refresh_token: "ref", platiDo: Date.now() - 1000, email: "test@example.invalid" };

// ── Hlášení výsledků ─────────────────────────────────────────────────

function sada(nazev) {
  const vysledky = [];
  return {
    nazev,
    ok(podminka, popis) { vysledky.push({ ok: !!podminka, popis }); return !!podminka; },
    sekce(popis) { vysledky.push({ sekce: popis }); },
    vysledky,
  };
}

module.exports = {
  KOREN, DOCASNE,
  nactiZeZdroje, pripravProhlizec, zaloha, maZalohu,
  spustAplikaci, odpoved, sitovaChyba,
  RELACE_PLATNA, RELACE_VYPRSELA,
  KLIC_DENIKU, jeZapis, klicZapisu, jeZapisDeniku, jeZapisZalohy,
  sada,
};
