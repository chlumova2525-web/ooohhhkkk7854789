// Hromadný zápis hodin za období. Nedoložených 309 478 Kč je asi
// 1 238 hodin — po jednom dni to nikdo zapisovat nebude.

const {
  nactiZeZdroje, spustAplikaci, odpoved, zaloha, maZalohu, RELACE_PLATNA, jeZapis, jeZapisDeniku,
} = require("./_pomocnici.cjs");

module.exports = {
  nazev: "Zápis hodin za období",
  async spust(t) {
    const { dnyObdobi } = nactiZeZdroje(["dnyObdobi"]);

    t.sekce("Dny v období");
    t.ok(dnyObdobi("2026-03-02", "2026-03-06", false).length === 5, "pondělí až pátek je 5 dní");
    t.ok(dnyObdobi("2026-03-02", "2026-03-02", false).length === 1, "jeden den je jeden den");
    t.ok(dnyObdobi("2026-03-01", "2026-03-31", false).length === 31, "celý březen má 31 dní");

    t.sekce("Víkendy");
    const tyden = dnyObdobi("2026-03-02", "2026-03-08", true);
    t.ok(tyden.length === 5, "z celého týdne zbude 5 pracovních dní");
    t.ok(!tyden.includes("2026-03-07") && !tyden.includes("2026-03-08"), "sobota ani neděle tam nejsou");
    t.ok(dnyObdobi("2026-03-07", "2026-03-08", true).length === 0, "samotný víkend dá prázdno");

    t.sekce("Letní čas den nepřeskočí ani nezdvojí");
    // V Česku se v roce 2026 mění čas 29. 3. a 25. 10.
    const jaro = dnyObdobi("2026-03-27", "2026-03-31", false);
    t.ok(jaro.length === 5, "kolem jarní změny je 5 dní (" + jaro.length + ")");
    t.ok(jaro.includes("2026-03-29"), "den změny tam je");
    const podzim = dnyObdobi("2026-10-23", "2026-10-27", false);
    t.ok(podzim.length === 5, "kolem podzimní změny je 5 dní (" + podzim.length + ")");
    t.ok(podzim.includes("2026-10-25"), "den změny tam je");
    t.ok(new Set(jaro).size === jaro.length, "žádný den dvakrát");

    t.sekce("Nesmyslné zadání nespadne");
    t.ok(dnyObdobi("2026-03-10", "2026-03-01", false).length === 0, "do dřív než od dá prázdno");
    t.ok(dnyObdobi("", "2026-03-01", false).length === 0, "chybějící od");
    t.ok(dnyObdobi("2026-03-01", "", false).length === 0, "chybějící do");
    t.ok(dnyObdobi("nesmysl", "2026-03-01", false).length === 0, "nesmyslné datum");
    t.ok(dnyObdobi("2020-01-01", "2030-01-01", false).length <= 2001, "obrovské období se utne, neseká se");

    if (!maZalohu()) return;

    t.sekce("Formulář zapíše jeden záznam na každý den");
    const data = zaloha();
    const zapsano = [];
    const stub = (u, o) => {
      if (!u.includes("/rest/v1/denik")) return odpoved(200, []);
      const metoda = (o && o.method) || "GET";
      if (metoda === "GET") return odpoved(200, [{ hodnota: JSON.stringify(data), zmeneno: "2026-09-21T08:00:00+00:00" }]);
      const telo = JSON.parse(o.body);
      if (jeZapisDeniku(u, o)) zapsano.push(JSON.parse(telo.hodnota));
      return odpoved(200, [{ hodnota: telo.hodnota, zmeneno: telo.zmeneno }]);
    };

    const a = await spustAplikaci({ relace: RELACE_PLATNA, fetchStub: stub, cekat: 1000 });
    a.klik(/Deník|Majitel|Rozpočet/);
    await a.pockej(300);
    t.ok(a.klik(/Hodiny, platby|^Shejba$|Dělník/), "záložka dělníka");
    await a.pockej(500);
    t.ok(a.klik(/Zapsat práci za období/), "tlačítko „Zapsat práci za období“");
    await a.pockej(400);

    const vstupy = [...a.w.document.querySelectorAll("input")];
    const data_ = vstupy.filter((x) => x.type === "date");
    t.ok(data_.length >= 2, "formulář má pole od a do");
    a.vypln(data_[0], "2026-03-02");
    a.vypln(data_[1], "2026-03-06");
    await a.pockej(200);

    const cisla = [...a.w.document.querySelectorAll("input.n")];
    t.ok(cisla.length > 0, "formulář má pole na hodiny");
    a.vypln(cisla[0], "8");
    await a.pockej(300);

    // kc() formátuje přes Intl, takže oddělovač tisíců je nezlomitelná mezera.
    const nahled = a.text().replace(/\u00a0/g, " ");
    t.ok(/5 dní × 8 h = 40 h/.test(nahled), "náhled říká 5 dní × 8 h = 40 h");
    t.ok(/10 000 Kč/.test(nahled), "a spočítá 40 h × 250 Kč = 10 000 Kč");

    const pred = zapsano.length;
    t.ok(a.klik(/Zapsat 5× do deníku/), "tlačítko zná počet dní");
    await a.pockej(700);
    t.ok(zapsano.length === pred + 1, "uložilo se");

    const po = zapsano[zapsano.length - 1];
    const nove = (po.zaznamy || []).filter((z) => z.typ === "prace");
    t.ok(nove.length === 5, "vzniklo 5 záznamů práce (" + nove.length + ")");
    t.ok(nove.every((z) => z.castka === 2000), "každý na 2 000 Kč (8 h × 250)");
    t.ok(new Set(nove.map((z) => z.datum)).size === 5, "každý na jiný den");
    t.ok(nove.every((z) => z.datum >= "2026-03-02" && z.datum <= "2026-03-06"), "všechny uvnitř období");
    t.ok(a.pady.length === 0, "žádná chyba za běhu" + (a.pady.length ? ": " + a.pady.join(" | ") : ""));
  },
};
