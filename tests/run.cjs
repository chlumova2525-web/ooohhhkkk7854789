// Spustí všechny testy. Bez frameworku — `npm test`.
// Jeden soubor: `npm test -- delnik`

const fs = require("fs");
const path = require("path");
const { sada, DOCASNE } = require("./_pomocnici.cjs");

const filtr = (process.argv[2] || "").toLowerCase();
const soubory = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.cjs"))
  .filter((f) => !filtr || f.toLowerCase().includes(filtr))
  .sort();

const Z = { zelena: "\x1b[32m", cervena: "\x1b[31m", seda: "\x1b[90m", tucne: "\x1b[1m", konec: "\x1b[0m" };

(async () => {
  if (soubory.length === 0) {
    console.log("Žádné testy nenalezeny" + (filtr ? " pro „" + filtr + "“" : "") + ".");
    process.exit(1);
  }

  let proslo = 0;
  const selhalo = [];
  const zacatek = Date.now();

  for (const soubor of soubory) {
    const modul = require(path.join(__dirname, soubor));
    const t = sada(modul.nazev || soubor);
    console.log("\n" + Z.tucne + t.nazev + Z.konec + Z.seda + "  (" + soubor + ")" + Z.konec);

    try {
      await modul.spust(t);
    } catch (e) {
      t.ok(false, "test spadl: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
    }

    for (const v of t.vysledky) {
      if (v.sekce) { console.log(Z.seda + "  " + v.sekce + Z.konec); continue; }
      if (v.ok) { proslo++; console.log("    " + Z.zelena + "✓" + Z.konec + " " + v.popis); }
      else { selhalo.push(t.nazev + " → " + v.popis); console.log("    " + Z.cervena + "✗ " + v.popis + Z.konec); }
    }
  }

  fs.rmSync(DOCASNE, { recursive: true, force: true });

  const sekund = ((Date.now() - zacatek) / 1000).toFixed(1);
  console.log("\n" + "─".repeat(58));
  if (selhalo.length === 0) {
    console.log(Z.zelena + Z.tucne + "VŠECHNO PROŠLO" + Z.konec + "  " + proslo + " kontrol, " + soubory.length + " sad, " + sekund + " s");
    process.exit(0);
  }
  console.log(Z.cervena + Z.tucne + "NEPROŠLO: " + selhalo.length + Z.konec + "  (prošlo " + proslo + ", " + sekund + " s)");
  selhalo.forEach((s) => console.log("  " + Z.cervena + "✗" + Z.konec + " " + s));
  process.exit(1);
})();
