// Zkušební verze pro někoho, kdo si má aplikaci jen osahat.
// Nemá připojenou databázi, takže se nepřihlašuje a ukládá do prohlížeče.
//
// Dřív tohle nefungovalo: přihlašovací obrazovka se ukazovala vždycky,
// i bez databáze, a odesílala dotaz na neexistující adresu. Testér se
// nedostal dál a nic si neuložil.

const fs = require("fs");
const path = require("path");
const { KOREN, spustAplikaci, odpoved } = require("./_pomocnici.cjs");

const ZKOUSKA = path.join(KOREN, "docs", "zkouska");

module.exports = {
  nazev: "Zkušební verze bez databáze",
  async spust(t) {
    t.sekce("Soubory");
    for (const f of ["index.html", "app.js", "config.js", "robots.txt"]) {
      t.ok(fs.existsSync(path.join(ZKOUSKA, f)), f + " existuje");
    }
    if (!fs.existsSync(path.join(ZKOUSKA, "app.js"))) return;

    t.ok(
      fs.readFileSync(path.join(ZKOUSKA, "app.js")).equals(fs.readFileSync(path.join(KOREN, "docs", "app.js"))),
      "app.js je shodný s ostrou verzí — testuje se totéž"
    );

    const cfg = fs.readFileSync(path.join(ZKOUSKA, "config.js"), "utf8");
    t.ok(/supabaseUrl:\s*""/.test(cfg), "config.js nemá adresu databáze");
    t.ok(/supabaseKlic:\s*""/.test(cfg), "config.js nemá klíč");
    t.ok(!/gkfgdlgfbzzctrlrhdju/.test(cfg), "neukazuje na ostrou databázi");

    t.sekce("Aplikace bez databáze");
    // Žádná relace, prázdné nastavení — přesně jak to uvidí kolegyně.
    const volani = [];
    const a = await spustAplikaci({
      relace: null,
      nastaveni: { supabaseUrl: "", supabaseKlic: "", zakladOdkazu: "" },
      fetchStub: (u, o) => { volani.push({ u, o }); return odpoved(200, []); },
      cekat: 1000,
    });

    t.ok(!/Přihlášení/.test(a.text()), "NEukazuje přihlašovací obrazovku");
    t.ok(volani.length === 0, "nikam se nevolá (" + volani.length + " dotazů)");
    t.ok(/Zkušební verze/.test(a.text()), "upozorní, že je to zkušební verze");
    t.ok(/jen v tomhle prohlížeči/.test(a.text()), "řekne, kde data jsou");
    t.ok(a.pady.length === 0, "žádná chyba za běhu" + (a.pady.length ? ": " + a.pady.join(" | ") : ""));

    t.sekce("Deník je prázdný, ne cizí");
    t.ok(!/Shejb|Žíželev|3 416 244|426 800/.test(a.text()), "žádná cizí jména ani částky");

    t.sekce("Data se opravdu uloží");
    t.ok(a.klik(/Celá správa/), "vstup do správy");
    await a.pockej(500);
    t.ok(a.klik(/Nastaven/), "Nastavení");
    await a.pockej(500);

    const pole = [...a.w.document.querySelectorAll("input")];
    const nazev = pole[0];
    t.ok(!!nazev, "formulář se vykreslil");
    a.vypln(nazev, "Zkouška u kolegyně");
    await a.pockej(200);
    t.ok(a.klik(/Uložit|Potvrdit|Uložit změny/), "uložení");
    await a.pockej(600);

    const ulozene = a.w.localStorage.getItem("sd:rekonstrukce-v3");
    t.ok(!!ulozene, "něco se zapsalo do prohlížeče");
    if (ulozene) {
      const d = JSON.parse(ulozene);
      t.ok(d.nazev === "Zkouška u kolegyně", "uložil se zadaný název: " + JSON.stringify(d.nazev));
    }
    t.ok(!/nepodařilo uložit/.test(a.text()), "žádná chyba ukládání");
  },
};
