// Nejhrubší síť: sestavený balík se v prohlížeči spustí a něco vykreslí.
// Chytá překlepy, chybějící importy a výjimky při načtení modulu —
// tedy přesně to, co shodí aplikaci dřív, než se vůbec objeví.

const fs = require("fs");
const path = require("path");
const { spustAplikaci, odpoved, zaloha, maZalohu, KOREN, RELACE_PLATNA } = require("./_pomocnici.cjs");

module.exports = {
  nazev: "Aplikace naběhne",
  async spust(t) {
    t.sekce("Sestavený výstup existuje");
    const app = path.join(KOREN, "docs", "app.js");
    t.ok(fs.existsSync(app), "docs/app.js existuje — jinak spusť npm run build");
    if (!fs.existsSync(app)) return;

    const zdroj = fs.statSync(path.join(KOREN, "src", "app.jsx")).mtimeMs;
    t.ok(fs.statSync(app).mtimeMs >= zdroj, "balík není starší než zdroj");

    t.sekce("Přihlašovací obrazovka");
    {
      const a = await spustAplikaci({ relace: null });
      t.ok(!a.html().includes("Aplikace se nespustila"), "žádné hlášení o pádu");
      t.ok(/Přihlášení/.test(a.text()), "vykreslila se");
      t.ok(a.pady.length === 0, "žádná chyba za běhu" + (a.pady.length ? ": " + a.pady.join(" | ") : ""));
    }

    t.sekce("Kód neobsahuje osobní údaje");
    {
      const kod = fs.readFileSync(app, "utf8");
      const zakazane = ["Ani\\u010D", "anicka", "Vojt", "vojta", "\"David\"", "babi\\u010D", "3416244", "173756", "545146", "4689000"];
      const nalezene = zakazane.filter((x) => kod.includes(x));
      t.ok(nalezene.length === 0, "žádná jména ani reálné částky" + (nalezene.length ? ": " + nalezene.join(", ") : ""));
    }

    if (!maZalohu()) return;

    t.sekce("Deník s reálnými daty");
    {
      const z = JSON.stringify(zaloha());
      const a = await spustAplikaci({
        relace: RELACE_PLATNA,
        fetchStub: (u) => (u.includes("/rest/v1/denik") ? odpoved(200, [{ hodnota: z }]) : odpoved(200, [])),
        cekat: 1000,
      });
      t.ok(!a.html().includes("Aplikace se nespustila"), "žádné hlášení o pádu");
      t.ok(a.text().length > 5000, "vykreslil se obsah (" + a.text().length + " znaků)");
      t.ok(a.pady.length === 0, "žádná chyba za běhu" + (a.pady.length ? ": " + a.pady.join(" | ") : ""));
    }
  },
};
