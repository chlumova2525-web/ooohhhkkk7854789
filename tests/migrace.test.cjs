// Migrace dat. Běží při každém načtení a při obnově ze zálohy — když
// se rozbije, uživatel uvidí prázdný deník nebo aplikace spadne.

const { nactiZeZdroje, zaloha, maZalohu } = require("./_pomocnici.cjs");

module.exports = {
  nazev: "Migrace dat",
  async spust(t) {
    const { migruj2, migrujKontrolu, spocitej, DEFAULT } = nactiZeZdroje([
      "migruj2", "migrujKontrolu", "spocitej", "DEFAULT",
    ]);

    t.sekce("Výchozí hodnoty v kódu neobsahují nic osobního");
    t.ok(DEFAULT.cenaDomu === 0 && DEFAULT.provize === 0, "žádné částky v DEFAULT");
    t.ok(
      !/[Ss]hejb|Ani[čc]|Vojt|David|babi[čc]/.test(JSON.stringify(DEFAULT)),
      "žádná jména v DEFAULT"
    );
    t.ok(
      Object.values(DEFAULT.zdroje).every((z) => z.celkem === 0 && z.koupe === 0),
      "všechny zdroje financí vynulované"
    );

    t.sekce("Přejmenované klíče se přenesou, staré zmizí");
    const stary = {
      shejba: { jmeno: "Novák", dluh: 1200 },
      hesloShejba: "kod123",
      kontrola: { anicka: "12000", vojta: "8000", datum: "2026-01-05" },
    };
    const novy = migruj2(stary);
    t.ok(novy.delnik && novy.delnik.jmeno === "Novák", "jméno dělníka přeneseno ze starého klíče");
    t.ok(novy.delnik.dluh === 1200, "dluh dělníka přenesen");
    t.ok(novy.hesloDelnik === "kod123", "kód dělníka přenesen");
    t.ok(novy.shejba === undefined, "starý klíč shejba odstraněn");
    t.ok(novy.hesloShejba === undefined, "starý klíč hesloShejba odstraněn");
    t.ok(novy.kontrola.ucetA === "12000" && novy.kontrola.ucetB === "8000", "zůstatky účtů přeneseny podle pořadí");
    t.ok(novy.kontrola.anicka === undefined && novy.kontrola.vojta === undefined, "staré klíče účtů odstraněny");
    t.ok(novy.kontrola.popisA === "" && novy.kontrola.popisB === "", "popisy účtů prázdné — doplní je uživatel, ne kód");

    t.sekce("Migrace kontroly samostatně");
    const k = migrujKontrolu({ anicka: "500", vojta: "", datum: "2026-02-02" });
    t.ok(k.ucetA === "500", "první zůstatek přenesen");
    t.ok(k.datum === "2026-02-02", "datum zachováno");
    t.ok(migrujKontrolu(null).ucetA === "", "chybějící kontrola nepadá");

    t.sekce("Prázdný vstup nepadá");
    const prazdny = migruj2({});
    t.ok(!!prazdny.delnik, "vznikne delnik");
    t.ok(Array.isArray(prazdny.polozky) && prazdny.polozky.length === 0, "prázdné položky");
    t.ok(!!spocitej(prazdny), "výpočty nad prázdnými daty projdou");

    if (!maZalohu()) {
      t.sekce("Reálná záloha (data/zaloha-dat.json chybí — přeskočeno)");
      return;
    }

    t.sekce("Reálná záloha projde migrací beze ztrát");
    const z = zaloha();
    const m = migruj2(z);
    t.ok(m.polozky.length === z.polozky.length, "položky zachovány: " + m.polozky.length);
    t.ok(m.ukoly.length === z.ukoly.length, "úkoly zachovány: " + m.ukoly.length);
    t.ok(m.zaznamy.length === z.zaznamy.length, "záznamy práce zachovány: " + m.zaznamy.length);
    t.ok(m.cenaDomu === z.cenaDomu, "cena domu z dat, ne z kódu");
    t.ok(m.zdroje.hypoteka.celkem === z.zdroje.hypoteka.celkem, "zdroje financí z dat");
    t.ok(m.delnik.jmeno === z.shejba.jmeno, "jméno dělníka pochází z dat");

    const soucet = (x) => Math.round(x.reduce((a, p) => a + (Number(p.castka) || 0), 0));
    t.ok(soucet(m.polozky) === soucet(z.polozky), "součet částek beze změny: " + soucet(m.polozky).toLocaleString("cs-CZ") + " Kč");

    t.sekce("Obnova ze staré zálohy nesmí shodit výpočty");
    let spadlo = false;
    try { spocitej({ ...z, heslo: null }); } catch (e) { spadlo = true; }
    t.ok(spadlo, "nemigrovaná záloha výpočet shodí — proto obnova musí migrovat");
    t.ok(!!spocitej(m), "po migraci výpočet projde");
  },
};
