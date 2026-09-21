// Souběžná editace ze dvou zařízení. Ukládá se celý deník najednou
// a platí „poslední zápis vyhrává“ — bez ochrany by druhý člověk tiše
// přepsal práci prvního. S sebou proto jde otisk verze (sloupec zmeneno)
// a při nesouladu se nic nezapíše.

const {
  spustAplikaci, odpoved, zaloha, maZalohu, RELACE_PLATNA, jeZapisDeniku,
} = require("./_pomocnici.cjs");

const VERZE_PUVODNI = "2026-09-21T08:00:00+00:00";

const VERZE_CIZI = "2026-09-21T09:30:00+00:00";

// Postaví obsluhu databáze. `konflikt` znamená, že hned po načtení uložil
// někdo jiný: podmíněný zápis nic netrefí a v řádku je cizí verze.
function databaze(data, { konflikt = false } = {}) {
  const zapisy = [];
  let nacteno = false;
  const obsluha = (u, o) => {
    if (!u.includes("/rest/v1/denik")) return odpoved(200, []);
    const metoda = (o && o.method) || "GET";
    if (metoda === "GET") {
      // První čtení je načtení deníku. Cizí zápis přijde až po něm.
      const verze = konflikt && nacteno ? VERZE_CIZI : VERZE_PUVODNI;
      nacteno = true;
      return odpoved(200, [{ klic: "rekonstrukce-v3", hodnota: JSON.stringify(data), zmeneno: verze }]);
    }
    const telo = JSON.parse(o.body);
    // Denní záloha jde pod jiný klíč a do sledovaných zápisů nepatří.
    if (jeZapisDeniku(u, o)) zapisy.push({ metoda, url: u, telo });
    if (metoda === "PATCH" && konflikt && jeZapisDeniku(u, o)) return odpoved(200, []);
    return odpoved(200, [{ klic: "rekonstrukce-v3", hodnota: telo.hodnota, zmeneno: telo.zmeneno }]);
  };
  return { obsluha, zapisy };
}

// Otevře deník a jednou v něm něco změní (smaže položku ke schválení).
async function otevriAZmen(db) {
  const a = await spustAplikaci({ relace: RELACE_PLATNA, fetchStub: db.obsluha, cekat: 1000 });
  a.klik(/Deník|Majitel|Rozpočet/);
  await a.pockej(300);
  a.klik(/Ke schválení/);
  await a.pockej(500);
  a.klik(/^Smazat$/);
  await a.pockej(250);
  a.klik(/Ano, smazat/);
  await a.pockej(600);
  return a;
}

module.exports = {
  nazev: "Souběžná editace",
  async spust(t) {
    if (!maZalohu()) {
      t.sekce("data/zaloha-dat.json chybí — přeskočeno");
      return;
    }
    const zaklad = zaloha();
    zaklad.cekajici = [{
      id: "c1", druh: "faktura", datum: "2026-09-01", dodavatel: "Testovací",
      castka: 1000, stav: "ceka", mafoto: false, vytvoreno: "2026-09-01",
    }];

    t.sekce("Běžné uložení pošle otisk verze a projde");
    {
      const db = databaze(zaklad);
      const a = await otevriAZmen(db);
      const zapis = db.zapisy[0];
      t.ok(!!zapis, "něco se zapsalo");
      t.ok(zapis.metoda === "PATCH", "jde PATCHem s podmínkou, ne slepým přepisem (" + (zapis && zapis.metoda) + ")");
      t.ok(zapis.url.includes("zmeneno=eq."), "v adrese je kontrola verze");
      t.ok(zapis.url.includes(encodeURIComponent(VERZE_PUVODNI)), "kontroluje se verze, která se načetla");
      t.ok(!!zapis.telo.zmeneno && zapis.telo.zmeneno !== VERZE_PUVODNI, "zapisuje se nový otisk verze");
      t.ok(!/Někdo byl rychlejší/.test(a.text()), "žádné varování");
      t.ok(a.pady.length === 0, "žádná chyba za běhu");
    }

    t.sekce("Když mezitím uložil někdo jiný, změna se nezapíše");
    {
      const db = databaze(zaklad, { konflikt: true });
      const a = await otevriAZmen(db);
      t.ok(/Někdo byl rychlejší/.test(a.text()), "ukáže varování");
      t.ok(/nezapsala/.test(a.text()), "řekne, že se úprava nezapsala");
      t.ok(!/nepodařilo uložit/.test(a.text()), "netváří se to jako chyba spojení");
      t.ok(db.zapisy.every((z) => z.metoda === "PATCH"), "nic se neprosadilo silou");

      t.sekce("Nabízí obě cesty ven");
      t.ok(a.tlacitka().some((b) => /Načíst jejich verzi/.test(b.textContent)), "„Načíst jejich verzi“");
      t.ok(a.tlacitka().some((b) => /Prosadit moji verzi/.test(b.textContent)), "„Prosadit moji verzi“");

      t.sekce("Prosazení vlastní verze chce potvrzení a pak přepíše");
      const pred = db.zapisy.length;
      a.klik(/Prosadit moji verzi/);
      await a.pockej(250);
      t.ok(/Opravdu přepsat/.test(a.text()), "zeptá se na potvrzení");
      t.ok(db.zapisy.length === pred, "bez potvrzení se nic nezapsalo");
      a.klik(/Opravdu přepsat/);
      await a.pockej(600);
      const posledni = db.zapisy[db.zapisy.length - 1];
      t.ok(db.zapisy.length === pred + 1, "po potvrzení se zapsalo");
      t.ok(posledni.metoda === "POST", "přepis jde POSTem, tedy bez podmínky");
      t.ok(!posledni.url.includes("zmeneno=eq."), "kontrola verze se obešla vědomě");
      t.ok(!/Někdo byl rychlejší/.test(a.text()), "varování zmizelo");
    }

    t.sekce("Když podmínka nic netrefí, ale verze sedí, nejde o konflikt");
    {
      // Databáze, kde PATCH vždy vrátí prázdno — třeba kvůli tomu, že se
      // neshodlo porovnání časového otisku. Verze řádku se ale nezměnila.
      const zapisy = [];
      const obsluha = (u, o) => {
        if (!u.includes("/rest/v1/denik")) return odpoved(200, []);
        const metoda = (o && o.method) || "GET";
        if (metoda === "GET") {
          return odpoved(200, [{ hodnota: JSON.stringify(zaklad), zmeneno: VERZE_PUVODNI }]);
        }
        const telo = JSON.parse(o.body);
        if (jeZapisDeniku(u, o)) zapisy.push({ metoda, url: u });
        if (metoda === "PATCH") return odpoved(200, []);
        return odpoved(200, [{ hodnota: telo.hodnota, zmeneno: telo.zmeneno }]);
      };
      const a = await otevriAZmen({ obsluha, zapisy });
      t.ok(!/Někdo byl rychlejší/.test(a.text()), "uživatele to neobtěžuje falešným konfliktem");
      t.ok(zapisy.some((z) => z.metoda === "PATCH"), "nejdřív zkusí podmíněný zápis");
      t.ok(zapisy.some((z) => z.metoda === "POST"), "po ověření uloží napřímo");
      t.ok(a.pady.length === 0, "žádná chyba za běhu");
    }

    t.sekce("Bez sloupce zmeneno se ochrana prostě nepoužije");
    {
      const zapisy = [];
      const obsluha = (u, o) => {
        if (!u.includes("/rest/v1/denik")) return odpoved(200, []);
        const metoda = (o && o.method) || "GET";
        if (metoda === "GET") return odpoved(200, [{ hodnota: JSON.stringify(zaklad) }]);
        if (jeZapisDeniku(u, o)) zapisy.push({ metoda, url: u });
        return odpoved(200, [{ hodnota: "{}" }]);
      };
      const a = await otevriAZmen({ obsluha, zapisy });
      t.ok(zapisy.length > 0, "uložení proběhlo");
      t.ok(zapisy[0].metoda === "POST", "starým způsobem, bez podmínky");
      t.ok(!/Někdo byl rychlejší/.test(a.text()), "žádné varování");
    }
  },
};
