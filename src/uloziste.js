import { dnes } from "./vypocty.js";

// ── Zámek na vstupu ──────────────────────────────────────────────
// true  = při otevření se ptá na heslo (ostrý provoz)
// false = appka se otevře rovnou (vývoj)
// Kdybyste se zamkli ven, přepněte zpátky na false.
export const HESLO_ZAPNUTO = false;

// ── Úložiště ────────────────────────────────────────────────────
// Aplikace umí běžet ve třech režimech a sama pozná, který platí:
//   1. uvnitř Claude        → sdílené úložiště artefaktu
//   2. vlastní web + Supabase → sdílené mezi všemi (vyplň dva údaje níž)
//   3. vlastní web bez ničeho → jen tento prohlížeč, data se nesdílí
// Připojení k databázi se nastavuje v souboru config.js vedle aplikace,
// ne tady — aby přežilo zmenšení souboru při sestavení.
// Doklady, které opravdu leží ve složce na webu. Odkaz „otevřít originál"
// se nabídne jen u nich — jinak by vedl na neexistující stránku.
// Soubory ve složce na webu. Klíčem je číslo dokladu, hodnotou název souboru
// ve tvaru téma_dodavatel_číslo_datum_částka. Odkaz „otevřít originál" se
// nabídne jen u dokladů, které tu jsou.
export const DOKLADY_NA_WEBU = {};

// Když je vyplněná databáze, používá se i uvnitř Claude — aby artefakt
// i web pracovaly nad stejnými daty.
export const VESTAVENA_DB = { url: "", klic: "" };

// ── Přihlášení k databázi ───────────────────────────────────────
// Token drží prohlížeč, ne databáze. Platí hodinu a sám se obnovuje.
export const RELACE_KLIC = "sd:relace";

export let RELACE = null;
try {
  RELACE = JSON.parse(localStorage.getItem(RELACE_KLIC) || "null");
} catch (e) {}

export function dbAdresa() {
  const nast = (typeof window !== "undefined" && window.NASTAVENI) || {};
  return {
    url: (nast.supabaseUrl || "").replace(/\/$/, ""),
    klic: nast.supabaseKlic || "",
  };
}

export function ulozRelaci(d, email) {
  RELACE = {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    platiDo: Date.now() + (d.expires_in || 3600) * 1000,
    email: email || (d.user && d.user.email) || (RELACE && RELACE.email) || "",
  };
  try {
    localStorage.setItem(RELACE_KLIC, JSON.stringify(RELACE));
  } catch (e) {}
}

export function zrusRelaci() {
  RELACE = null;
  try {
    localStorage.removeItem(RELACE_KLIC);
  } catch (e) {}
}

// Supabase vrací pod stavem 400 spoustu různých důvodů. Házet na všechny
// „heslo nesedí" je zavádějící — hlavně u nepotvrzeného účtu, kdy je heslo
// správně a uživatel marně zkouší jiná.
export const DUVODY_PRIHLASENI = {
  invalid_credentials: "E-mail nebo heslo nesedí.",
  email_not_confirmed:
    "Účet zatím není potvrzený. Otevři odkaz v e-mailu, který přišel po jeho založení.",
  user_banned: "Tenhle účet je zablokovaný.",
  over_request_rate_limit: "Moc pokusů za sebou. Zkus to prosím za chvíli.",
  over_email_send_rate_limit: "Moc e-mailů za sebou. Zkus to prosím za chvíli.",
  validation_failed: "Vyplň prosím e-mail i heslo.",
};

// Když fetch vůbec neodejde, prohlížeč řekne jen „Failed to fetch". Příčina
// bývá mimo aplikaci — DNS, blokace, výpadek — a bez nápovědy se to hledá těžko.
export function jeSitovaChyba(e) {
  return e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(e && e.message));
}

export function popisSitoveChyby() {
  const { url } = dbAdresa();
  const host = url.replace(/^https?:\/\//, "") || "databázi";
  return (
    "Nepodařilo se spojit s databází (" + host + "). " +
    "Požadavek vůbec neodešel, takže to není heslem. Bývá to síť, DNS nebo " +
    "blokující rozšíření prohlížeče — zkus jinou síť nebo anonymní okno."
  );
}

export async function prihlasSe(email, heslo) {
  const { url, klic } = dbAdresa();
  let r;
  try {
    r = await fetch(url + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: klic, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password: heslo }),
    });
  } catch (e) {
    if (jeSitovaChyba(e)) throw new Error(popisSitoveChyby());
    throw e;
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const kod = (d && (d.error_code || d.error)) || "";
    if (DUVODY_PRIHLASENI[kod]) throw new Error(DUVODY_PRIHLASENI[kod]);
    const zprava = (d && (d.error_description || d.msg || d.message)) || "";
    if (/invalid login/i.test(zprava)) throw new Error(DUVODY_PRIHLASENI.invalid_credentials);
    if (/not confirmed/i.test(zprava)) throw new Error(DUVODY_PRIHLASENI.email_not_confirmed);
    throw new Error("Přihlášení se nepovedlo (" + r.status + "). " + (zprava || ""));
  }
  ulozRelaci(d, email.trim());
  return RELACE;
}

// Změna hesla přihlášeného uživatele.
export async function zmenHeslo(nove) {
  const { url, klic } = dbAdresa();
  const token = await platnyToken();
  if (!token) throw new Error("Nejsi přihlášená.");
  const r = await fetch(url + "/auth/v1/user", {
    method: "PUT",
    headers: {
      apikey: klic,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: nove }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      (d && (d.msg || d.error_description || d.message)) || "Heslo se nepodařilo změnit."
    );
  return true;
}

// Odeslání odkazu na obnovu zapomenutého hesla.
export async function posliObnovu(email) {
  const { url, klic } = dbAdresa();
  const kam = window.location.origin + window.location.pathname;
  const r = await fetch(url + "/auth/v1/recover", {
    method: "POST",
    headers: { apikey: klic, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), redirect_to: kam }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(
      (d && (d.msg || d.error_description)) ||
        "Odkaz se nepodařilo odeslat. Zkus to za chvíli, nebo heslo změň přímo v Supabase."
    );
  }
  return true;
}

// Návrat z e-mailu s odkazem na obnovu — token přijde v adrese za mřížkou.
export function zachytObnovu() {
  try {
    const h = window.location.hash || "";
    if (!h.includes("access_token")) return false;
    const p = new URLSearchParams(h.slice(1));
    if (p.get("type") !== "recovery") return false;
    ulozRelaci({
      access_token: p.get("access_token"),
      refresh_token: p.get("refresh_token"),
      expires_in: Number(p.get("expires_in")) || 3600,
    });
    history.replaceState(null, "", window.location.pathname);
    return true;
  } catch (e) {
    return false;
  }
}

// Vrací token, nebo null když databáze relaci odmítla — to je tvrdé
// odhlášení. Výpadek sítě je něco jiného: relace může být pořád platná,
// jen se na ni teď nedá zeptat. Proto se síťová chyba vyhodí ven a volající
// ji odliší od odhlášení.
export async function obnovToken() {
  if (!RELACE || !RELACE.refresh_token) return null;
  const { url, klic } = dbAdresa();
  let r;
  try {
    r = await fetch(url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: klic, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: RELACE.refresh_token }),
    });
  } catch (e) {
    if (jeSitovaChyba(e)) throw new Error(popisSitoveChyby());
    throw e;
  }
  if (!r.ok) {
    zrusRelaci();
    return null;
  }
  ulozRelaci(await r.json());
  return RELACE.access_token;
}

export async function platnyToken() {
  if (!RELACE) return null;
  if (RELACE.platiDo - 60000 < Date.now()) return await obnovToken();
  return RELACE.access_token;
}

export const ULOZISTE = (() => {
  const nast = (typeof window !== "undefined" && window.NASTAVENI) || {};
  const SUPABASE_URL = nast.supabaseUrl || VESTAVENA_DB.url || "";
  const SUPABASE_KLIC = nast.supabaseKlic || VESTAVENA_DB.klic || "";

  if (!SUPABASE_URL && typeof window !== "undefined" && window.storage) {
    return { ...window.storage, rezim: "claude" };
  }

  if (SUPABASE_URL && SUPABASE_KLIC) {
    const zaklad = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/denik";
    // Bez tokenu se dotaz neposílá vůbec. Dřív se místo něj podstrčil
    // veřejný klíč — jenže RLS pouští jen přihlášené a PostgREST na
    // zamítnuté čtení neodpoví chybou, ale prázdným seznamem se stavem 200.
    // Aplikace to brala jako „v databázi nic není" a otevřela prázdný deník.
    const hlavicky = async () => {
      const token = await platnyToken();
      if (!token) throw new Error("Nejsi přihlášená — přihlas se prosím znovu.");
      return {
        apikey: SUPABASE_KLIC,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      };
    };
    const popisChyby = async (r, co) => {
      if (r.status === 401 || r.status === 403)
        return new Error("Nejsi přihlášená — přihlas se prosím znovu.");
      let d = "";
      try {
        d = (await r.text()).slice(0, 200);
      } catch (e) {}
      return new Error(`${co} selhalo (${r.status}) ${d}`);
    };
    return {
      rezim: "supabase",
      // Vrací i `zmeneno` z databáze. Slouží jako otisk verze: při ukládání
      // se ověří, že se řádek mezitím nezměnil pod rukama. Když sloupec
      // v tabulce není, zůstane undefined a ochrana se prostě nepoužije.
      async get(klic) {
        const hlav = await hlavicky();
        let r;
        try {
          r = await fetch(
            `${zaklad}?klic=eq.${encodeURIComponent(klic)}&select=*`,
            { headers: hlav }
          );
        } catch (e) {
          throw jeSitovaChyba(e) ? new Error(popisSitoveChyby()) : e;
        }
        if (!r.ok) throw await popisChyby(r, "Čtení z databáze");
        const d = await r.json();
        return d.length ? { key: klic, value: d[0].hodnota, zmeneno: d[0].zmeneno } : null;
      },

      // `ocekavane` je otisk verze, nad kterou uživatel pracoval.
      // Když sedí, zápis projde. Když ne, někdo mezitím uložil něco jiného
      // a přepsat by znamenalo jeho práci zahodit — proto se to ohlásí.
      // `prepis: true` tu pojistku vědomě obejde.
      async set(klic, hodnota, { ocekavane, prepis } = {}) {
        const hlav = await hlavicky();
        const ted = new Date().toISOString();
        const podminene = ocekavane && !prepis;

        let r;
        try {
          r = podminene
            ? await fetch(
                `${zaklad}?klic=eq.${encodeURIComponent(klic)}` +
                  `&zmeneno=eq.${encodeURIComponent(ocekavane)}`,
                {
                  method: "PATCH",
                  headers: { ...hlav, Prefer: "return=representation" },
                  body: JSON.stringify({ hodnota, zmeneno: ted }),
                }
              )
            : await fetch(zaklad, {
                method: "POST",
                headers: {
                  ...hlav,
                  Prefer: "resolution=merge-duplicates,return=representation",
                },
                body: JSON.stringify({ klic, hodnota, zmeneno: ted }),
              });
        } catch (e) {
          throw jeSitovaChyba(e) ? new Error(popisSitoveChyby()) : e;
        }
        if (!r.ok) throw await popisChyby(r, "Zápis do databáze");

        let radky = [];
        try {
          radky = await r.json();
        } catch (e) {}

        if (podminene && (!Array.isArray(radky) || radky.length === 0)) {
          // Podmínka nic netrefila. Ještě to nemusí být konflikt — mohlo
          // selhat porovnání časového otisku. Kdyby se to nerozlišilo,
          // hlásila by aplikace konflikt při každém uložení a ukládat by
          // v podstatě nešlo. Rozhodne až skutečný stav řádku.
          let skutecna;
          try {
            const k = await fetch(
              `${zaklad}?klic=eq.${encodeURIComponent(klic)}&select=*`,
              { headers: hlav }
            );
            if (k.ok) {
              const d = await k.json();
              skutecna = d.length ? d[0].zmeneno : null;
            }
          } catch (e) {}

          if (skutecna !== undefined && skutecna === ocekavane) {
            // Verze v databázi je pořád ta naše, takže o konflikt nešlo.
            return await this.set(klic, hodnota, { prepis: true });
          }

          const chyba = new Error(
            "Někdo jiný mezitím uložil změnu. Tvoje úprava se zatím nezapsala."
          );
          chyba.konflikt = true;
          throw chyba;
        }

        const novy = Array.isArray(radky) && radky[0] ? radky[0] : null;
        return { key: klic, value: hodnota, zmeneno: (novy && novy.zmeneno) || ted };
      },
      async delete(klic) {
        await fetch(`${zaklad}?klic=eq.${encodeURIComponent(klic)}`, {
          method: "DELETE",
          headers: await hlavicky(),
        });
        return { key: klic, deleted: true };
      },
      // Klíče začínající na `predpona`, bez hodnot — seznam záloh
      // nemá proč tahat i jejich obsah.
      async seznam(predpona) {
        const hlav = await hlavicky();
        let r;
        try {
          r = await fetch(
            `${zaklad}?klic=like.${encodeURIComponent(predpona + "%")}&select=klic`,
            { headers: hlav }
          );
        } catch (e) {
          throw jeSitovaChyba(e) ? new Error(popisSitoveChyby()) : e;
        }
        if (!r.ok) throw await popisChyby(r, "Čtení seznamu z databáze");
        const d = await r.json();
        return (Array.isArray(d) ? d : []).map((x) => x.klic).sort();
      },
    };
  }

  if (typeof window !== "undefined" && window.storage) {
    return { ...window.storage, rezim: "claude" };
  }

  return {
    rezim: "prohlizec",
    async get(klic) {
      const v = localStorage.getItem("sd:" + klic);
      return v === null ? null : { key: klic, value: v };
    },
    async set(klic, hodnota) {
      localStorage.setItem("sd:" + klic, hodnota);
      return { key: klic, value: hodnota };
    },
    async delete(klic) {
      localStorage.removeItem("sd:" + klic);
      return { key: klic, deleted: true };
    },
    async seznam(predpona) {
      const nalezene = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || "";
        if (k.startsWith("sd:" + predpona)) nalezene.push(k.slice(3));
      }
      return nalezene.sort();
    },
  };
})();

// Přihlášení ověřuje databáze, ne aplikace. Když žádná nastavená není,
// není se koho ptát — data leží jen v tomhle prohlížeči a přihlašovací
// obrazovka by byla slepá ulička: odeslala by dotaz na adresu, která
// neexistuje, a dál by se nikdo nedostal.
export const VYZADUJE_PRIHLASENI = ULOZISTE.rezim === "supabase";

// ── Automatická záloha ──────────────────────────────────────────
// Historie se nikde nevede a uloz() přepíše celý řádek, takže omyl
// z minulého týdne se nedá vzít zpět. Jednou denně se proto odloží
// kopie stavu do téže tabulky pod klíč zaloha:RRRR-MM-DD. Je to řádek
// jako každý jiný, takže se na něj vztahuje stejné RLS pravidlo
// a nepotřebuje to žádný zásah v databázi.
//
// Fotky faktur (klíče fa:<id>) se nekopírují — stejně jako u ruční zálohy.
export const ZALOHA_PREDPONA = "zaloha:";

export const ZALOH_NECHAT = 14;

export const ZALOHA_ZNACKA = "sd:zalohovanoDne";

export async function zalohujDenne(json) {
  if (!ULOZISTE.seznam) return;
  const den = dnes();
  try {
    if (localStorage.getItem(ZALOHA_ZNACKA) === den) return;
  } catch (e) {}

  await ULOZISTE.set(ZALOHA_PREDPONA + den, json);
  try {
    localStorage.setItem(ZALOHA_ZNACKA, den);
  } catch (e) {}

  // Staré kopie se uklidí hned, ať jich nepřibývá donekonečna.
  try {
    const vsechny = await ULOZISTE.seznam(ZALOHA_PREDPONA);
    const stare = vsechny.sort().slice(0, Math.max(0, vsechny.length - ZALOH_NECHAT));
    for (const k of stare) await ULOZISTE.delete(k);
  } catch (e) {}
}

export const KEY = "rekonstrukce-v3";

export const SESSION_KLIC = "sd:prihlasenido";

// Přihlášení se pamatuje jen v tomhle prohlížeči, ne v databázi —
// jinak by přihlášení na mobilu odemklo appku i ostatním.
export function ulozPrihlaseni(rezim) {
  try {
    localStorage.setItem(
      SESSION_KLIC,
      JSON.stringify({ rezim, platiDo: Date.now() + 30 * 24 * 3600 * 1000 })
    );
  } catch (e) {}
}

export function nactiPrihlaseni() {
  try {
    const r = JSON.parse(localStorage.getItem(SESSION_KLIC) || "null");
    if (r && r.platiDo > Date.now()) return r.rezim;
  } catch (e) {}
  return null;
}

export function zapomenPrihlaseni() {
  try {
    localStorage.removeItem(SESSION_KLIC);
  } catch (e) {}
}

export const KEY_V2 = "rekonstrukce-v2";

export const KEY_STARY = "rekonstrukce-v1";
