// Obrazovka Ke schválení. Mazání tu chybělo u dokladů k rozdělení —
// nešly z ní dostat jinak než úplným rozepsáním do kategorií.
// Mazání musí vždycky chtít potvrzení a bez něj nesmí nic uložit.

const { spustAplikaci, odpoved, zaloha, maZalohu, RELACE_PLATNA, jeZapis, jeZapisDeniku } = require("./_pomocnici.cjs");

module.exports = {
  nazev: "Obrazovka Ke schválení",
  async spust(t) {
    if (!maZalohu()) {
      t.sekce("data/zaloha-dat.json chybí — přeskočeno");
      return;
    }

    const data = zaloha();
    data.cekajici = [{
      id: "c1", druh: "faktura", datum: "2026-09-01", dodavatel: "Testovací",
      castka: 1000, stav: "ceka", mafoto: false, vytvoreno: "2026-09-01",
    }];
    const kRozpaduPuvodne = data.polozky.filter((p) => p.kRozpadu).length;
    const soucet = (d) => Math.round(d.polozky.reduce((a, p) => a + (Number(p.castka) || 0), 0));

    // První uložení jde POSTem, další PATCHem s kontrolou verze.
    // Denní záloha se do počtu nepočítá, je to zápis pod jiným klíčem.
    const zapsano = [];
    const stub = (u, o) => {
      if (!u.includes("/rest/v1/denik")) return odpoved(200, []);
      if (jeZapis(o)) {
        const telo = JSON.parse(o.body);
        if (jeZapisDeniku(u, o)) zapsano.push(JSON.parse(telo.hodnota));
        return odpoved(200, [{ hodnota: telo.hodnota, zmeneno: telo.zmeneno }]);
      }
      return odpoved(200, [{ hodnota: JSON.stringify(data), zmeneno: "2026-09-21T08:00:00+00:00" }]);
    };

    const a = await spustAplikaci({ relace: RELACE_PLATNA, fetchStub: stub, cekat: 1000 });

    t.sekce("Otevření obrazovky");
    a.klik(/Deník|Majitel|Rozpočet/);
    await a.pockej(300);
    t.ok(a.klik(/Ke schválení/), "záložka nalezena");
    await a.pockej(500);
    t.ok(/K rozdělení do kategorií/.test(a.text()), "doklady k rozdělení jsou vidět (" + kRozpaduPuvodne + ")");

    t.sekce("Obě možnosti odstranění jsou dostupné");
    t.ok(a.tlacitka().some((b) => /^Nechat nerozdělený$/.test(b.textContent)), "„Nechat nerozdělený“");
    t.ok(a.tlacitka().some((b) => /^Smazat doklad$/.test(b.textContent)), "„Smazat doklad“");
    t.ok(a.tlacitka().some((b) => /^Smazat$/.test(b.textContent)), "u položky ke schválení je popisek, ne jen ×");

    t.sekce("„Nechat nerozdělený“ odebere ze seznamu, částku nechá");
    const pred = zapsano.length;
    a.klik(/^Nechat nerozdělený$/);
    await a.pockej(600);
    t.ok(zapsano.length === pred + 1, "uložilo se");
    const po = zapsano[zapsano.length - 1];
    t.ok(po.polozky.length === data.polozky.length, "počet položek beze změny: " + po.polozky.length);
    t.ok(po.polozky.filter((p) => p.kRozpadu).length === kRozpaduPuvodne - 1, "o jeden doklad k rozdělení míň");
    t.ok(soucet(po) === soucet(data), "součet výdajů beze změny: " + soucet(po).toLocaleString("cs-CZ") + " Kč");
    t.ok(!po.polozky.some((p) => /čeká na rozpad/i.test(p.popis || "")), "z popisu zmizelo „(čeká na rozpad)“");

    t.sekce("Mazání vyžaduje potvrzení");
    const pred2 = zapsano.length;
    a.klik(/^Smazat doklad$/);
    await a.pockej(300);
    t.ok(/Opravdu smazat/.test(a.text()), "zeptá se na potvrzení");
    t.ok(zapsano.length === pred2, "bez potvrzení se nic neuloží");
    a.klik(/Ano, smazat/);
    await a.pockej(600);
    const po2 = zapsano[zapsano.length - 1];
    t.ok(zapsano.length === pred2 + 1, "po potvrzení uloženo");
    t.ok(po2.polozky.length === po.polozky.length - 1, "o jednu položku míň: " + po2.polozky.length);

    t.ok(a.pady.length === 0, "žádná chyba za běhu" + (a.pady.length ? ": " + a.pady.join(" | ") : ""));
  },
};
