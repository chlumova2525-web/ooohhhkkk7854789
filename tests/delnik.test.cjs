// Výpočty kolem dělníka. Nedoložené peníze se berou jako dluh —
// vzorec je vyplaceno − odpracovaná práce − materiál doložený fakturou.
// Nesmí se slít s ručně vedeným seznamem půjček, jinak by se část
// dluhu započítala dvakrát.

const { nactiZeZdroje, zaloha, maZalohu } = require("./_pomocnici.cjs");

module.exports = {
  nazev: "Výpočty u dělníka",
  async spust(t) {
    const { spocitejDelnika, migruj2 } = nactiZeZdroje(["spocitejDelnika", "migruj2"]);

    t.sekce("Vzorec na umělých datech");
    {
      const d = migruj2({
        sazba: 250,
        zaznamy: [
          { id: "p", datum: "2026-01-01", typ: "platba", castka: 100000 },
          { id: "w", datum: "2026-01-02", typ: "prace", castka: 30000, hodiny: { p1: 120 } },
        ],
        polozky: [
          { id: "m", datum: "2026-01-03", castka: 20000, pres: true, zPlateb: true, popis: "materiál" },
        ],
      });
      const s = spocitejDelnika(d);
      t.ok(s.vyplaceno === 100000, "vyplaceno 100 000");
      t.ok(s.odpracovano === 30000, "odpracováno 30 000");
      t.ok(s.dolozenoFakturami === 20000, "materiál 20 000");
      t.ok(s.podlozeno === 50000, "podloženo = práce + materiál = 50 000");
      t.ok(s.nedolozeno === 50000, "nedoloženo = 100 000 − 50 000 = 50 000");
      t.ok(s.nevysvetleno === s.nedolozeno, "původní název počítá totéž");
    }

    t.sekce("Materiál hrazený jinak než z plateb se neodečítá");
    {
      const d = migruj2({
        zaznamy: [{ id: "p", datum: "2026-01-01", typ: "platba", castka: 10000 }],
        polozky: [{ id: "m", datum: "2026-01-02", castka: 4000, pres: true, popis: "materiál" }],
      });
      const s = spocitejDelnika(d);
      t.ok(s.materialCelkem === 4000, "materiál přes něj je 4 000");
      t.ok(s.dolozenoFakturami === 0, "ale z poslaných peněz nic (chybí zPlateb)");
      t.ok(s.nedolozeno === 10000, "nedoloženo zůstává 10 000");
    }

    t.sekce("Když doloží víc, než dostal, dluží naopak vy jemu");
    {
      const d = migruj2({
        zaznamy: [
          { id: "p", datum: "2026-01-01", typ: "platba", castka: 10000 },
          { id: "w", datum: "2026-01-02", typ: "prace", castka: 25000, hodiny: { p1: 100 } },
        ],
      });
      const s = spocitejDelnika(d);
      t.ok(s.nedolozeno === -15000, "nedoloženo je záporné: " + s.nedolozeno);
    }

    t.sekce("Osobní dluh je oddělený a zápis práce s ním nehne");
    {
      const d = migruj2({
        zaznamy: [{ id: "p", datum: "2026-01-01", typ: "platba", castka: 50000 }],
        delnik: { jmeno: "X", dluhPolozky: [
          { id: "a", datum: "", popis: "půjčka", castka: 8000 },
          { id: "b", datum: "", popis: "odmakáno", castka: -3000 },
        ] },
      });
      const s = spocitejDelnika(d);
      t.ok(s.zbyvaDluh === 5000, "osobní dluh 8 000 − 3 000 = 5 000");
      t.ok(s.nedolozeno === 50000, "nedoloženo je samostatné číslo");

      const sPraci = spocitejDelnika({
        ...d,
        zaznamy: [...d.zaznamy, { id: "w", datum: "2026-02-01", typ: "prace", castka: 20000, hodiny: { p1: 80 } }],
      });
      t.ok(sPraci.nedolozeno === 30000, "zápis práce snížil nedoloženo na 30 000");
      t.ok(sPraci.zbyvaDluh === 5000, "osobního dluhu se nedotkl");
    }

    if (!maZalohu()) return;

    t.sekce("Reálná data");
    {
      const s = spocitejDelnika(migruj2(zaloha()));
      // Částky nesou haléře (117 322,15), aplikace je zobrazuje zaokrouhlené.
      t.ok(s.vyplaceno === 426800, "vyplaceno 426 800 Kč");
      t.ok(Math.round(s.dolozenoFakturami) === 117322, "doloženo fakturami 117 322 Kč");
      t.ok(Math.round(s.nedolozeno) === 309478, "nedoloženo 309 478 Kč");
      t.ok(
        Math.abs(s.vyplaceno - s.podlozeno - s.nedolozeno) < 0.01,
        "vzorec sedí i v haléřích: 426 800 − " + s.podlozeno + " = " + s.nedolozeno
      );
      t.ok(Math.round(s.zbyvaDluh) === 59320, "osobní dluh 59 320 Kč");
      t.ok(
        Math.round(s.nedolozeno) + Math.round(s.zbyvaDluh) === 368798 && s.nedolozeno !== s.zbyvaDluh,
        "obě čísla zůstávají oddělená, nesčítají se na 368 798"
      );
    }
  },
};
