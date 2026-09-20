// Načítání dat a stav relace. Tohle je nejcitlivější místo v aplikaci:
// když se selhané čtení splete s prázdnou databází, uživatel uvidí prázdný
// deník a první uložení mu přepíše skutečná data.

const {
  spustAplikaci, odpoved, sitovaChyba, zaloha, maZalohu,
  RELACE_PLATNA, RELACE_VYPRSELA,
} = require("./_pomocnici.cjs");

module.exports = {
  nazev: "Přihlášení a načítání dat",
  async spust(t) {
    t.sekce("Bez relace se do databáze vůbec nesahá");
    {
      const a = await spustAplikaci({ relace: null, fetchStub: () => odpoved(200, []) });
      t.ok(/Přihlášení/.test(a.text()), "ukáže přihlašovací obrazovku");
      t.ok(!/Data se nenačetla/.test(a.text()), "nehlásí chybu načtení");
      t.ok(a.volani.length === 0, "žádný dotaz do databáze (" + a.volani.length + ")");
    }

    t.sekce("Platná relace, ale síť nefunguje");
    {
      const a = await spustAplikaci({ relace: RELACE_PLATNA, fetchStub: sitovaChyba });
      t.ok(/Data se nenačetla/.test(a.text()), "ukáže chybovou obrazovku");
      t.ok(/Nepodařilo se spojit s databází/.test(a.text()), "vysvětlí, že šlo o spojení");
      t.ok(/test\.supabase\.co/.test(a.text()), "pojmenuje host, na kterém to padlo");
      t.ok(/DNS/.test(a.text()), "navede na DNS jako možnou příčinu");
      t.ok(!/Zbývá vyčerpat|Ke schválení/.test(a.text()), "NEotevře prázdný deník");
    }

    t.sekce("Vypršelá relace, kterou databáze odmítla");
    {
      const a = await spustAplikaci({
        relace: RELACE_VYPRSELA,
        fetchStub: (u) => (u.includes("refresh_token") ? odpoved(401, { error: "invalid_grant" }) : odpoved(200, [])),
      });
      t.ok(/Přihlášení/.test(a.text()), "vrátí na přihlášení");
      t.ok(!/Data se nenačetla/.test(a.text()), "netváří se to jako chyba čtení");
    }

    t.sekce("Vypršelá relace při výpadku sítě neodhlásí");
    {
      const a = await spustAplikaci({ relace: RELACE_VYPRSELA, fetchStub: sitovaChyba });
      t.ok(/Data se nenačetla/.test(a.text()), "ukáže chybu spojení");
      t.ok(!!a.w.localStorage.getItem("sd:relace"), "relace v prohlížeči zůstala");
    }

    t.sekce("Dotaz jde s tokenem uživatele, ne s veřejným klíčem");
    {
      const a = await spustAplikaci({
        relace: RELACE_PLATNA,
        fetchStub: (u) => (u.includes("/rest/v1/denik") ? odpoved(200, [{ hodnota: "{}" }]) : odpoved(200, [])),
      });
      const dotaz = a.volani.find((v) => v.u.includes("/rest/v1/denik"));
      const auth = dotaz && dotaz.o.headers.Authorization;
      t.ok(auth === "Bearer tok", "Authorization: Bearer tok (dostal: " + auth + ")");
    }

    t.sekce("Prázdná databáze při platné relaci je v pořádku");
    {
      const a = await spustAplikaci({ relace: RELACE_PLATNA, fetchStub: () => odpoved(200, []) });
      t.ok(!/Data se nenačetla/.test(a.text()), "prázdno se nehlásí jako chyba");
      t.ok(a.text().length > 300, "deník se otevřel");
    }

    if (!maZalohu()) return;

    t.sekce("Reálná data se načtou a vykreslí");
    {
      const z = JSON.stringify(zaloha());
      const a = await spustAplikaci({
        relace: RELACE_PLATNA,
        fetchStub: (u) => (u.includes("/rest/v1/denik") ? odpoved(200, [{ hodnota: z }]) : odpoved(200, [])),
      });
      t.ok(!/Data se nenačetla/.test(a.text()), "žádná chyba");
      t.ok(a.text().length > 5000, "vykreslil se obsah (" + a.text().length + " znaků)");
      t.ok(a.pady.length === 0, "žádná chyba za běhu" + (a.pady.length ? ": " + a.pady.join(" | ") : ""));
    }
  },
};
