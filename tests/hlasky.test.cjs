// Chybové hlášky přihlášení. Dřív se každý stav 400 překládal na
// „E-mail nebo heslo nesedí", takže nepotvrzený účet nebo výpadek sítě
// vypadaly jako špatné heslo a uživatel marně zkoušel jiná.

const { nactiZeZdroje } = require("./_pomocnici.cjs");

module.exports = {
  nazev: "Hlášky při přihlášení",
  async spust(t) {
    const { prihlasSe } = nactiZeZdroje(["prihlasSe", "jeSitovaChyba"]);
    globalThis.window.NASTAVENI = {
      supabaseUrl: "https://test.supabase.co",
      supabaseKlic: "sb_publishable_test",
    };

    const chyba = (status, telo) => Promise.resolve({
      ok: false, status, json: () => Promise.resolve(telo),
    });

    async function zprava(stub) {
      globalThis.fetch = stub;
      try {
        await prihlasSe("a@b.cz", "heslo123");
        return "(přihlášení prošlo)";
      } catch (e) {
        return e.message;
      }
    }

    t.sekce("Každý důvod má vlastní hlášku");
    let m = await zprava(() => chyba(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" }));
    t.ok(m === "E-mail nebo heslo nesedí.", "špatné heslo → " + JSON.stringify(m));

    m = await zprava(() => chyba(400, { error_code: "email_not_confirmed", msg: "Email not confirmed" }));
    t.ok(/není potvrzený/.test(m), "nepotvrzený účet se nevydává za špatné heslo → " + JSON.stringify(m));

    m = await zprava(() => chyba(429, { error_code: "over_request_rate_limit" }));
    t.ok(/Moc pokusů/.test(m), "příliš mnoho pokusů → " + JSON.stringify(m));

    m = await zprava(() => chyba(400, { error_code: "validation_failed" }));
    t.ok(/Vyplň/.test(m), "chybějící údaje → " + JSON.stringify(m));

    t.sekce("Síťová chyba se nesmí vydávat za špatné heslo");
    m = await zprava(() => Promise.reject(new TypeError("Failed to fetch")));
    t.ok(/Nepodařilo se spojit/.test(m), "pozná výpadek spojení");
    t.ok(/test\.supabase\.co/.test(m), "pojmenuje host");
    t.ok(!/heslo nesedí/.test(m), "netvrdí, že je chyba v hesle");

    t.sekce("Neznámou chybu neschová");
    m = await zprava(() => chyba(500, { msg: "internal error" }));
    t.ok(/500/.test(m), "ukáže stav → " + JSON.stringify(m));

    t.sekce("Úspěšné přihlášení uloží relaci");
    globalThis.fetch = () => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ access_token: "a", refresh_token: "b", expires_in: 3600 }),
    });
    const r = await prihlasSe("  a@b.cz  ", "heslo123");
    t.ok(r && r.access_token === "a", "token uložen");
    t.ok(r.email === "a@b.cz", "e-mail se ořízne od mezer");
    t.ok(r.platiDo > Date.now(), "platnost nastavena do budoucna");
  },
};
