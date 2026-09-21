// Automatická denní záloha. Historie se nikde nevede a uloz() přepíše
// celý řádek, takže omyl z minulého týdne se bez ní nedá vzít zpět.
// Ukládá se do téže tabulky pod klíč zaloha:RRRR-MM-DD, aby na ni platilo
// stejné RLS pravidlo a nebylo potřeba nic měnit v databázi.

const {
  spustAplikaci, odpoved, zaloha, maZalohu, RELACE_PLATNA,
  jeZapis, klicZapisu, jeZapisDeniku, jeZapisZalohy,
} = require("./_pomocnici.cjs");

const DNES = new Date().toISOString().slice(0, 10);

// Databáze, která si pamatuje, co v ní leží.
function databaze(data, { existujiciZalohy = [] } = {}) {
  const radky = new Map([["rekonstrukce-v3", JSON.stringify(data)]]);
  existujiciZalohy.forEach((d, i) => radky.set("zaloha:" + d, JSON.stringify({ poradi: i })));
  const zapisy = [];
  const smazane = [];

  const obsluha = (u, o) => {
    if (!u.includes("/rest/v1/denik")) return odpoved(200, []);
    const metoda = (o && o.method) || "GET";

    if (metoda === "DELETE") {
      const k = klicZapisu(u, o);
      smazane.push(k);
      radky.delete(k);
      return odpoved(204, []);
    }

    if (jeZapis(o)) {
      const telo = JSON.parse(o.body);
      const k = klicZapisu(u, o);
      zapisy.push({ klic: k, metoda, hodnota: telo.hodnota });
      radky.set(k, telo.hodnota);
      return odpoved(200, [{ klic: k, hodnota: telo.hodnota, zmeneno: telo.zmeneno }]);
    }

    // Výpis klíčů podle předpony
    if (u.includes("klic=like.")) {
      const m = u.match(/klic=like\.([^&]*)/);
      const predpona = decodeURIComponent(m[1]).replace(/%$/, "");
      return odpoved(200, [...radky.keys()].filter((k) => k.startsWith(predpona)).map((k) => ({ klic: k })));
    }

    const k = klicZapisu(u, o) || "rekonstrukce-v3";
    return radky.has(k)
      ? odpoved(200, [{ klic: k, hodnota: radky.get(k), zmeneno: "2026-09-21T08:00:00+00:00" }])
      : odpoved(200, []);
  };
  return { obsluha, zapisy, smazane, radky };
}

async function otevriAZmen(db, w0) {
  const a = await spustAplikaci({ relace: RELACE_PLATNA, fetchStub: db.obsluha, cekat: 1000 });
  try { a.w.localStorage.removeItem("sd:zalohovanoDne"); } catch (e) {}
  a.klik(/Deník|Majitel|Rozpočet/);
  await a.pockej(300);
  a.klik(/Ke schválení/);
  await a.pockej(500);
  a.klik(/^Smazat$/);
  await a.pockej(250);
  a.klik(/Ano, smazat/);
  await a.pockej(800);
  return a;
}

module.exports = {
  nazev: "Automatická denní záloha",
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

    t.sekce("Při první změně dne vznikne kopie");
    {
      const db = databaze(zaklad);
      const a = await otevriAZmen(db);
      const zalohy = db.zapisy.filter((z) => jeZapisZalohy("klic=eq." + z.klic, { method: z.metoda }));
      t.ok(zalohy.length >= 1, "zapsala se záloha (" + zalohy.length + ")");
      t.ok(zalohy[0].klic === "zaloha:" + DNES, "pod klíčem s dnešním datem: " + zalohy[0].klic);
      t.ok(db.zapisy.some((z) => z.klic === "rekonstrukce-v3"), "deník se uložil taky");

      const obsah = JSON.parse(zalohy[0].hodnota);
      t.ok(Array.isArray(obsah.polozky) && obsah.polozky.length === zaklad.polozky.length,
        "záloha obsahuje celý stav (" + obsah.polozky.length + " položek)");
      t.ok(a.pady.length === 0, "žádná chyba za běhu" + (a.pady.length ? ": " + a.pady.join(" | ") : ""));
    }

    t.sekce("Podruhé týž den se už nezálohuje");
    {
      const db = databaze(zaklad);
      const a = await spustAplikaci({ relace: RELACE_PLATNA, fetchStub: db.obsluha, cekat: 1000 });
      a.klik(/Deník|Majitel|Rozpočet/);
      await a.pockej(300);
      a.klik(/Ke schválení/);
      await a.pockej(500);
      // dvě změny za sebou
      a.klik(/^Nechat nerozdělený$/);
      await a.pockej(700);
      a.klik(/^Nechat nerozdělený$/);
      await a.pockej(700);
      const zalohy = db.zapisy.filter((z) => String(z.klic).startsWith("zaloha:"));
      const deniky = db.zapisy.filter((z) => z.klic === "rekonstrukce-v3");
      t.ok(deniky.length >= 2, "deník se uložil vícekrát (" + deniky.length + ")");
      t.ok(zalohy.length === 1, "záloha vznikla jen jednou (" + zalohy.length + ")");
    }

    t.sekce("Starší kopie než posledních 14 se uklidí");
    {
      const stare = [];
      for (let i = 1; i <= 20; i++) stare.push("2026-08-" + String(i).padStart(2, "0"));
      const db = databaze(zaklad, { existujiciZalohy: stare });
      await otevriAZmen(db);
      const zbyva = [...db.radky.keys()].filter((k) => k.startsWith("zaloha:"));
      t.ok(db.smazane.length > 0, "něco se smazalo (" + db.smazane.length + ")");
      t.ok(zbyva.length === 14, "zůstalo posledních 14 (" + zbyva.length + ")");
      t.ok(zbyva.includes("zaloha:" + DNES), "dnešní záloha zůstala");
      t.ok(!zbyva.includes("zaloha:2026-08-01"), "nejstarší je pryč");
      t.ok(db.smazane.every((k) => k.startsWith("zaloha:")), "mazaly se jen zálohy, nic jiného");
    }

    t.sekce("Nastavení nabídne obnovu z konkrétního dne");
    {
      const db = databaze(zaklad, { existujiciZalohy: ["2026-09-18", "2026-09-19"] });
      const a = await spustAplikaci({ relace: RELACE_PLATNA, fetchStub: db.obsluha, cekat: 1000 });
      a.klik(/Deník|Majitel|Rozpočet/);
      await a.pockej(300);
      t.ok(a.klik(/Nastaven/), "Nastavení otevřena");
      await a.pockej(700);
      const txt = a.text();
      t.ok(/Automatické zálohy/.test(txt), "sekce „Automatické zálohy“");
      t.ok(/19\.9\.26/.test(txt) && /18\.9\.26/.test(txt), "vypíše dostupné dny");
      t.ok(a.tlacitka().some((b) => /^Obnovit$/.test(b.textContent)), "nabízí tlačítko Obnovit");

      const pred = db.zapisy.filter((z) => z.klic === "rekonstrukce-v3").length;
      a.klik(/^Obnovit$/);
      await a.pockej(300);
      t.ok(/Opravdu přepsat/.test(a.text()), "obnova chce potvrzení");
      t.ok(db.zapisy.filter((z) => z.klic === "rekonstrukce-v3").length === pred,
        "bez potvrzení se nic nepřepsalo");
    }

    t.sekce("Selhání zálohy nesmí shodit ukládání deníku");
    {
      const db = databaze(zaklad);
      const puvodni = db.obsluha;
      const obsluha = (u, o) => {
        // Záloha vždy selže, deník musí projít.
        if (jeZapis(o) && String(klicZapisu(u, o) || "").startsWith("zaloha:")) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return puvodni(u, o);
      };
      const a = await otevriAZmen({ ...db, obsluha });
      t.ok(db.zapisy.some((z) => z.klic === "rekonstrukce-v3"), "deník se uložil");
      t.ok(!/nepodařilo uložit/.test(a.text()), "uživateli se nic nehlásí");
      t.ok(!/Data se nenačetla/.test(a.text()), "žádná chybová obrazovka");
      t.ok(a.pady.length === 0, "žádná chyba za běhu" + (a.pady.length ? ": " + a.pady.join(" | ") : ""));
    }
  },
};
