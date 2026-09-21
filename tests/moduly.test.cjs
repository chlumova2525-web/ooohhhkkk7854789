// Kontrola propojení modulů. Po rozdělení app.jsx na soubory je snadné
// zapomenout dovézt jméno, které se přesunulo jinam — esbuild to nenahlásí,
// protože neznámý identifikátor považuje za globální proměnnou. Projeví se
// to až za běhu, a často jen na obrazovce, kam se člověk zrovna neklikne.

const fs = require("fs");
const path = require("path");
const { KOREN } = require("./_pomocnici.cjs");

const SRC = path.join(KOREN, "src");
const DEKL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_][\w]*)/;

function moduly() {
  return fs.readdirSync(SRC).filter((f) => /\.(js|jsx)$/.test(f)).sort();
}

// Odstraňují se jen komentáře, řetězce zůstávají. Vyhazovat řetězce
// regulárem je nespolehlivé — apostrof v českém textu spáruje s jiným
// a spolkne kus kódu mezi nimi, takže by se přehlédl skutečný odkaz.
// U komentářů to nehrozí; jediná past je // uvnitř adresy, proto ta
// podmínka na dvojtečku.
function slovaV(kod) {
  const bezKomentaru = kod
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  return new Set(bezKomentaru.match(/[A-Za-z_][\w]*/g) || []);
}

function rozbor(soubor) {
  const obsah = fs.readFileSync(path.join(SRC, soubor), "utf8");
  const L = obsah.split(/\r?\n/);

  const deklarovane = new Set();
  L.forEach((r) => {
    const m = r.match(DEKL);
    if (m) deklarovane.add(m[1]);
  });

  const vyvezene = new Set();
  L.forEach((r) => {
    const m = r.match(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_][\w]*)/);
    if (m) vyvezene.add(m[1]);
  });

  const dovezene = new Set();
  for (const m of obsah.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    m[1].split(",").forEach((x) => {
      const t = x.trim().split(/\s+as\s+/).pop();
      if (t) dovezene.add(t);
    });
  }
  // Výchozí dovoz, tedy import App from "./app.jsx"
  for (const m of obsah.matchAll(/^import\s+([A-Za-z_][\w]*)\s*(?:,|from)/gm)) {
    dovezene.add(m[1]);
  }

  // Kde končí blok dovozů — za ním začíná samotný kód.
  let konecDovozu = 0;
  L.forEach((r, i) => { if (/from\s+"/.test(r)) konecDovozu = i + 1; });
  const telo = L.slice(konecDovozu).join("\n");

  return { soubor, deklarovane, vyvezene, dovezene, slova: slovaV(obsah), slovaTela: slovaV(telo) };
}

module.exports = {
  nazev: "Propojení modulů",
  async spust(t) {
    const seznam = moduly();
    const rozbory = seznam.map(rozbor);

    t.sekce("Moduly");
    t.ok(seznam.length >= 2, "nalezeno " + seznam.length + " modulů: " + seznam.join(", "));

    // Kdo co vyváží
    const kdeJe = new Map();
    for (const r of rozbory) {
      for (const n of r.vyvezene) {
        if (kdeJe.has(n)) t.ok(false, "jméno " + n + " vyváží dva moduly: " + kdeJe.get(n) + " i " + r.soubor);
        kdeJe.set(n, r.soubor);
      }
    }
    t.ok(kdeJe.size > 0, "moduly dohromady vyvážejí " + kdeJe.size + " jmen");

    // Kde je co deklarované — i to, co se nevyváží. Jinak by proklouzlo
    // jméno, které v jiném modulu existuje, ale není vyvezené: v prohlížeči
    // se z něj stane nedefinovaná globální proměnná a obrazovka spadne.
    const kdeDeklarovano = new Map();
    for (const r of rozbory) {
      for (const n of r.deklarovane) {
        if (!kdeDeklarovano.has(n)) kdeDeklarovano.set(n, []);
        kdeDeklarovano.get(n).push(r.soubor);
      }
    }

    t.sekce("Každý modul dováží, co používá");
    for (const r of rozbory) {
      const chybi = [];
      for (const [jmeno, kde] of kdeDeklarovano) {
        if (kde.includes(r.soubor)) continue;
        if (!r.slova.has(jmeno)) continue;
        if (r.dovezene.has(jmeno)) continue;
        const zdroj = kdeJe.get(jmeno);
        chybi.push(jmeno + (zdroj ? " (z " + zdroj + ")" : " (je v " + kde.join("/") + ", ale nevyváží se)"));
      }
      t.ok(chybi.length === 0, r.soubor + (chybi.length ? " — CHYBÍ: " + chybi.join(", ") : " — v pořádku"));
    }

    t.sekce("Nic se nedováží zbytečně");
    for (const r of rozbory) {
      const zbytecne = [...r.dovezene].filter((n) => !r.slovaTela.has(n));
      t.ok(zbytecne.length === 0, r.soubor + (zbytecne.length ? " — nepoužité dovozy: " + zbytecne.join(", ") : " — v pořádku"));
    }

    t.sekce("Žádný kruh v dovozech");
    const hrany = new Map();
    for (const r of rozbory) {
      const obsah = fs.readFileSync(path.join(SRC, r.soubor), "utf8");
      const cile = [...obsah.matchAll(/from\s+"\.\/([^"]+)"/g)].map((m) => m[1]);
      hrany.set(r.soubor, cile);
    }
    const kruhy = [];
    for (const start of hrany.keys()) {
      const videno = new Set();
      const jdi = (uzel, cesta) => {
        if (uzel === start && cesta.length) { kruhy.push([...cesta, start].join(" -> ")); return; }
        if (videno.has(uzel)) return;
        videno.add(uzel);
        (hrany.get(uzel) || []).forEach((d) => jdi(d, [...cesta, uzel]));
      };
      (hrany.get(start) || []).forEach((d) => jdi(d, [start]));
    }
    t.ok(kruhy.length === 0, kruhy.length ? "KRUH: " + kruhy[0] : "žádný modul nedováží sám sebe oklikou");
  },
};
