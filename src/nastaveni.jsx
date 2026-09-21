// Obrazovka Nastavení. Zdaleka největší komponenta v projektu —
// stavba a zdroje financí, kategorie, odkazy na doklady, zálohy,
// změna hesla a úklid po testování.

import { useState, useEffect } from "react";
import { kc, dnes, datumCz, cislo, uid } from "./vypocty.js";
import { DEFAULT, ZDROJ, PLAN_HYPOTEKA, PLAN_SOUCET, planNaUkoly, migruj2 } from "./data.js";
import {
  HESLO_ZAPNUTO, RELACE, zmenHeslo, ULOZISTE, ZALOHA_PREDPONA, ZALOH_NECHAT,
} from "./uloziste.js";
import { Smazat } from "./sdilene.jsx";

// Seznam denních kopií, které si aplikace odkládá sama.
// Ruční záloha zůstává — tahle je pojistka pro případ, že si na ni
// někdo nevzpomene, což je většinou.
export function AutomatickeZalohy({ data, uloz }) {
  const [dny, setDny] = useState(null);
  const [chyba, setChyba] = useState("");
  const [potvrzuji, setPotvrzuji] = useState("");
  const [pracuji, setPracuji] = useState("");

  const nacti = () => {
    if (!ULOZISTE.seznam) return setDny([]);
    ULOZISTE.seznam(ZALOHA_PREDPONA)
      .then((k) => setDny(k.map((x) => x.slice(ZALOHA_PREDPONA.length)).sort().reverse()))
      .catch((e) => setChyba(e && e.message ? e.message : "Seznam záloh se nepodařilo načíst."));
  };
  useEffect(nacti, []);

  const obnov = async (den) => {
    setPracuji(den);
    setChyba("");
    try {
      const r = await ULOZISTE.get(ZALOHA_PREDPONA + den, true);
      if (!r) throw new Error("Záloha z " + datumCz(den) + " se nenašla.");
      const nove = JSON.parse(r.value);
      if (!nove || typeof nove !== "object") throw new Error("Záloha je poškozená.");
      uloz(migruj2({ ...nove, heslo: data.heslo }));
      setPotvrzuji("");
    } catch (e) {
      setChyba(e && e.message ? e.message : "Obnova se nepovedla.");
    }
    setPracuji("");
  };

  return (
    <>
      <h3 className="eyebrow" style={{ marginTop: 20, marginBottom: 8 }}>
        Automatické zálohy
      </h3>
      <p className="pozn" style={{ marginTop: 0 }}>
        Jednou denně si aplikace odloží kopii stavu. Drží se posledních{" "}
        {ZALOH_NECHAT} dní, starší se mažou samy. Fotky faktur v nich nejsou.
      </p>

      {dny === null && <p className="prazdno">Načítám…</p>}
      {dny !== null && dny.length === 0 && (
        <p className="prazdno">
          Zatím žádná. První vznikne při nejbližší změně v deníku.
        </p>
      )}

      {dny !== null && dny.length > 0 && (
        <table className="t">
          <tbody>
            {dny.map((den) => (
              <tr key={den}>
                <td className="n nowrap">{datumCz(den)}</td>
                <td style={{ color: "#5E7268" }}>
                  {den === dnes() ? "dnes" : ""}
                </td>
                <td className="r">
                  {potvrzuji === den ? (
                    <span className="rada" style={{ justifyContent: "flex-end" }}>
                      <button
                        className="btn2"
                        style={{ background: "#F7DED9", color: "#B03A2E" }}
                        disabled={!!pracuji}
                        onClick={() => obnov(den)}
                      >
                        {pracuji === den ? "Obnovuji…" : "Opravdu přepsat?"}
                      </button>
                      <button className="btn2" onClick={() => setPotvrzuji("")}>
                        Zrušit
                      </button>
                    </span>
                  ) : (
                    <button className="btn2" onClick={() => setPotvrzuji(den)}>
                      Obnovit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {chyba && <div className="hlaska zle">{chyba}</div>}
    </>
  );
}

export function Nastaveni({ data, uloz, odhlas }) {
  const [n, setN] = useState({
    nazev: data.nazev,
    misto: data.misto || "",
    popisA: (data.kontrola && data.kontrola.popisA) || "",
    popisB: (data.kontrola && data.kontrola.popisB) || "",
    cenaDomu: data.cenaDomu || "",
    provize: data.provize || "",
    jmeno: data.delnik.jmeno,
    dluh: data.delnik.dluh || "",
    sazba: data.sazba || 250,
    pracanti: (data.pracanti || []).map((p) => ({ ...p })),
    heslo: "",
    hesloDelnik: "",
  });
  const [zd, setZd] = useState(() => {
    const o = {};
    Object.keys(ZDROJ).forEach((k) => {
      const z = data.zdroje[k] || {};
      o[k] = {
        celkem: z.celkem || "",
        koupe: z.koupe || "",
        budouci: !!z.budouci,
      };
    });
    return o;
  });
  const zmenZd = (k, pole, hod) =>
    setZd((x) => ({ ...x, [k]: { ...x[k], [pole]: hod } }));
  const soucetKoupe = Object.keys(ZDROJ).reduce((a, k) => a + cislo(zd[k].koupe), 0);
  const soucetDost = Object.keys(ZDROJ).reduce(
    (a, k) => a + cislo(zd[k].celkem) - cislo(zd[k].koupe),
    0
  );
  const [noveTema, setNoveTema] = useState("");
  const [potvrzeno, setPotvrzeno] = useState("");
  const [zaloha, setZaloha] = useState("");
  const [obnova, setObnova] = useState("");
  const [zkopirovano, setZkopirovano] = useState(false);
  const [chybaObnovy, setChybaObnovy] = useState("");
  const [hromadne, setHromadne] = useState("");
  const [vysledek, setVysledek] = useState("");
  const [noveH, setNoveH] = useState({ a: "", b: "", stav: "" });
  const [novyDluh, setNovyDluh] = useState({ datum: dnes(), popis: "", castka: "" });
  const dluhy =
    (data.delnik.dluhPolozky && data.delnik.dluhPolozky.length
      ? data.delnik.dluhPolozky
      : data.delnik.dluh
      ? [{ id: "puv", datum: "", popis: "Původní dluh", castka: data.delnik.dluh }]
      : []) || [];
  const soucetDluhu = dluhy.reduce((a, d) => a + (d.castka || 0), 0);
  const [ok, setOk] = useState(false);

  const potvrd = () => {
    uloz({
      ...data,
      nazev: n.nazev || DEFAULT.nazev,
      misto: n.misto,
      kontrola: {
        ...(data.kontrola || DEFAULT.kontrola),
        popisA: n.popisA.trim(),
        popisB: n.popisB.trim(),
      },
      cenaDomu: cislo(n.cenaDomu),
      provize: cislo(n.provize),
      zdroje: Object.keys(ZDROJ).reduce((o, k) => {
        o[k] = {
          celkem: cislo(zd[k].celkem),
          koupe: cislo(zd[k].koupe),
          budouci: zd[k].budouci,
        };
        return o;
      }, {}),
      delnik: { ...data.delnik, jmeno: n.jmeno || DEFAULT.delnik.jmeno },
      sazba: cislo(n.sazba) || 250,
      pracanti: n.pracanti.map((p, i) => ({
        ...p,
        jmeno: p.jmeno.trim() || "Pracant " + (i + 1),
        sazba: cislo(p.sazba) || cislo(n.sazba) || 250,
        aktivni: p.aktivni !== false,
      })),
      heslo: n.heslo ? n.heslo : data.heslo,
      hesloDelnik: n.hesloDelnik ? n.hesloDelnik : data.hesloDelnik,
    });
    setOk(true);
    setTimeout(() => setOk(false), 2500);
  };
  const pridejTema = () => {
    const t = noveTema.trim();
    if (!t || data.temata.includes(t)) return;
    uloz({ ...data, temata: [...data.temata, t] });
    setNoveTema("");
  };
  const smazTema = (t) => {
    if (data.polozky.some((p) => p.tema === t)) return;
    uloz({ ...data, temata: data.temata.filter((x) => x !== t) });
  };

  return (
    <>
      <div className="box" style={{ marginTop: 0 }}>
        <h2 className="boxh">Stavba</h2>
        <div className="form">
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Název stavby</label>
            <input value={n.nazev} onChange={(e) => setN({ ...n, nazev: e.target.value })} />
          </div>
          <div className="pole">
            <label>Obec</label>
            <input value={n.misto} onChange={(e) => setN({ ...n, misto: e.target.value })} />
          </div>
          <div className="pole">
            <label>Název 1. účtu</label>
            <input
              value={n.popisA}
              placeholder="účet 1"
              onChange={(e) => setN({ ...n, popisA: e.target.value })}
            />
          </div>
          <div className="pole">
            <label>Název 2. účtu</label>
            <input
              value={n.popisB}
              placeholder="účet 2"
              onChange={(e) => setN({ ...n, popisB: e.target.value })}
            />
          </div>
          <div className="pole">
            <label>Kupní cena domu</label>
            <input
              className="n"
              inputMode="decimal"
              value={n.cenaDomu}
              onChange={(e) => setN({ ...n, cenaDomu: e.target.value })}
            />
          </div>
          <div className="pole">
            <label>Provize realitce a poplatky</label>
            <input
              className="n"
              inputMode="decimal"
              value={n.provize}
              onChange={(e) => setN({ ...n, provize: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="box">
        <h2 className="boxh">
          Zdroje peněz
          <span className="n">na rekonstrukci zbývá {kc(soucetDost)}</span>
        </h2>
        <table className="t tKarty">
          <thead>
            <tr>
              <th>Zdroj</th>
              <th style={{ width: "24%" }}>Celkem</th>
              <th style={{ width: "24%" }}>Z toho na koupi</th>
              <th className="r">Na rekonstrukci</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(ZDROJ).map(([k, z]) => (
              <tr key={k}>
                <td>
                  <span
                    className="stitek"
                    style={{ color: z.tmava, background: z.svetla }}
                  >
                    {z.label}
                  </span>
                  {zd[k].budouci && (
                    <span style={{ display: "block", fontSize: 11, color: "#5E7268", marginTop: 3 }}>
                      přijde až zpětně
                    </span>
                  )}
                </td>
                <td data-popis="Celkem">
                  <input
                    className="mini n"
                    inputMode="decimal"
                    value={zd[k].celkem}
                    placeholder="0"
                    onChange={(e) => zmenZd(k, "celkem", e.target.value)}
                  />
                </td>
                <td data-popis="Z toho na koupi">
                  <input
                    className="mini n"
                    inputMode="decimal"
                    value={zd[k].koupe}
                    placeholder="0"
                    onChange={(e) => zmenZd(k, "koupe", e.target.value)}
                  />
                </td>
                <td className="r n nowrap bunkaCastka" data-popis="Na rekonstrukci" style={{ fontWeight: 800 }}>
                  {kc(cislo(zd[k].celkem) - cislo(zd[k].koupe))}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid #C9AE85" }}>
              <td style={{ fontWeight: 800, paddingTop: 11 }}>Celkem</td>
              <td className="n" style={{ fontWeight: 800, paddingTop: 11 }}>
                {kc(Object.keys(ZDROJ).reduce((a, k) => a + cislo(zd[k].celkem), 0))}
              </td>
              <td className="n" style={{ fontWeight: 800, paddingTop: 11 }}>
                {kc(soucetKoupe)}
              </td>
              <td className="r n nowrap" style={{ fontWeight: 800, paddingTop: 11 }}>
                {kc(soucetDost)}
              </td>
            </tr>
          </tbody>
        </table>
        {cislo(n.cenaDomu) > 0 &&
          Math.abs(soucetKoupe - (cislo(n.cenaDomu) + cislo(n.provize))) > 1 && (
            <div className="hlaska zle">
              Součet částek na koupi ({kc(soucetKoupe)}) nesedí s kupní cenou plus
              provizí ({kc(cislo(n.cenaDomu) + cislo(n.provize))}) — rozdíl{" "}
              {kc(cislo(n.cenaDomu) + cislo(n.provize) - soucetKoupe)}.
            </div>
          )}
        {cislo(n.cenaDomu) > 0 &&
          Math.abs(soucetKoupe - (cislo(n.cenaDomu) + cislo(n.provize))) <= 1 && (
            <div className="hlaska dobre">
              Sedí: {kc(cislo(n.cenaDomu))} kupní cena + {kc(cislo(n.provize))}{" "}
              provize = {kc(soucetKoupe)}.
            </div>
          )}
        <p className="pozn">
          „Z toho na koupi" je část zdroje, která padla na pořízení domu. Zbytek
          je to, s čím se počítá na rekonstrukci.
        </p>
      </div>

      <div className="box">
        <h2 className="boxh">Dělník a parta</h2>
        <div className="form">
          <div className="pole">
            <label>Jméno</label>
            <input value={n.jmeno} onChange={(e) => setN({ ...n, jmeno: e.target.value })} />
          </div>
          <div className="pole">
            <label>Hodinová sazba</label>
            <input
              className="n"
              inputMode="decimal"
              value={n.sazba}
              onChange={(e) => setN({ ...n, sazba: e.target.value })}
            />
          </div>
        </div>
        <h3 className="eyebrow" style={{ marginTop: 18, marginBottom: 9 }}>
          Kdo se objeví v píchačce
        </h3>
        <div className="form">
          {(data.pracanti || []).map((p, i) => (
            <div className="pole" key={p.id}>
              <label>{i === 0 ? "Hlavní" : "Výpomoc " + i}</label>
              <input
                value={(n.pracanti[i] && n.pracanti[i].jmeno) || ""}
                onChange={(e) => {
                  const kopie = n.pracanti.map((x, j) =>
                    j === i ? { ...x, jmeno: e.target.value } : x
                  );
                  setN({ ...n, pracanti: kopie });
                }}
              />
              <input
                className="n"
                inputMode="decimal"
                style={{ marginTop: 6 }}
                placeholder="sazba Kč/h"
                value={(n.pracanti[i] && n.pracanti[i].sazba) || ""}
                onChange={(e) => {
                  const kopie = n.pracanti.map((x, j) =>
                    j === i ? { ...x, sazba: e.target.value } : x
                  );
                  setN({ ...n, pracanti: kopie });
                }}
              />
              <label className="chk" style={{ marginTop: 7, paddingBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={(n.pracanti[i] && n.pracanti[i].aktivni) !== false}
                  onChange={(e) => {
                    const kopie = n.pracanti.map((x, j) =>
                      j === i ? { ...x, aktivni: e.target.checked } : x
                    );
                    setN({ ...n, pracanti: kopie });
                  }}
                />
                <span style={{ fontSize: 12 }}>v píchačce</span>
              </label>
            </div>
          ))}
        </div>
        <p className="pozn">
          Každý může mít vlastní sazbu. Odškrtnutím „v píchačce" pracanta
          schováš — zůstane v nastavení, ale {n.jmeno} ho v zápisu hodin
          neuvidí.
        </p>
      </div>

      <div className="box">
        <h2 className="boxh">
          Z čeho se skládá {n.jmeno}ův dluh
          <span className="n">{kc(soucetDluhu)}</span>
        </h2>
        {dluhy.length > 0 && (
          <table className="t">
            <tbody>
              {dluhy.map((d) => (
                <tr key={d.id}>
                  <td className="n nowrap" style={{ color: "#5E7268", width: 90 }}>
                    {d.datum ? datumCz(d.datum) : "—"}
                  </td>
                  <td>{d.popis}</td>
                  <td className="r n nowrap" style={{ fontWeight: 700 }}>
                    {kc(d.castka)}
                  </td>
                  <td>
                    <Smazat
                      co="tuto položku dluhu"
                      onSmaz={() =>
                        uloz({
                          ...data,
                          delnik: {
                            ...data.delnik,
                            dluhPolozky: dluhy.filter((x) => x.id !== d.id),
                          },
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="form" style={{ marginTop: 12 }}>
          <div className="pole">
            <label>Datum</label>
            <input
              type="date"
              value={novyDluh.datum}
              onChange={(e) => setNovyDluh({ ...novyDluh, datum: e.target.value })}
            />
          </div>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Za co</label>
            <input
              value={novyDluh.popis}
              placeholder="např. půjčka na auto"
              onChange={(e) => setNovyDluh({ ...novyDluh, popis: e.target.value })}
            />
          </div>
          <div className="pole">
            <label>Částka</label>
            <input
              className="n"
              inputMode="decimal"
              value={novyDluh.castka}
              onChange={(e) => setNovyDluh({ ...novyDluh, castka: e.target.value })}
            />
          </div>
          <button
            className="btn2"
            onClick={() => {
              const c = cislo(novyDluh.castka);
              if (!c || !novyDluh.popis.trim()) return;
              uloz({
                ...data,
                delnik: {
                  ...data.delnik,
                  dluh: 0,
                  dluhPolozky: [
                    ...dluhy,
                    { id: uid(), datum: novyDluh.datum, popis: novyDluh.popis.trim(), castka: c },
                  ],
                },
              });
              setNovyDluh({ datum: dnes(), popis: "", castka: "" });
            }}
          >
            Přidat
          </button>
        </div>
        <p className="pozn">
          Tento rozpis {n.jmeno} uvidí ve svém přehledu pod tlačítkem „Za co
          všechno to je". Splátky prací se odečítají automaticky.
        </p>
      </div>

      <div className="box">
        <h2 className="boxh">Plán z hypotéky</h2>
        <p className="pozn" style={{ marginTop: 0 }}>
          Rozpočet o {PLAN_HYPOTEKA.length} položkách v celkové výši{" "}
          {kc(PLAN_SOUCET)}. Načtením se položky přidají ke stávajícím
          kategoriím — pokud už je tam máš, vzniknou dvojmo.
        </p>
        <div className="rada">
          <button
            className="btn2"
            onClick={() => {
              if (potvrzeno !== "plan") return setPotvrzeno("plan");
              uloz({ ...data, ukoly: [...data.ukoly, ...planNaUkoly()] });
              setPotvrzeno("");
            }}
          >
            {potvrzeno === "plan"
              ? "Opravdu načíst znovu?"
              : "Načíst plán z hypotéky"}
          </button>
          {potvrzeno === "plan" && (
            <button className="btn2" onClick={() => setPotvrzeno("")}>
              Zrušit
            </button>
          )}
        </div>
      </div>

      <div className="box">
        <h2 className="boxh">Druhy materiálu</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {data.temata.map((t) => {
            const pouzito = data.polozky.some((p) => p.tema === t);
            return (
              <span
                key={t}
                className="stitek"
                style={{
                  color: "#5E7268",
                  background: "#EFE8D6",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 5px",
                }}
              >
                {t}
                {!pouzito && (
                  <Smazat onSmaz={() => smazTema(t)} co={"téma " + t} />
                )}
              </span>
            );
          })}
        </div>
        <div className="form">
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Přidat téma</label>
            <input
              value={noveTema}
              placeholder="např. klempířina"
              onChange={(e) => setNoveTema(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pridejTema()}
            />
          </div>
          <button className="btn2" onClick={pridejTema}>
            Přidat
          </button>
        </div>
        <p className="pozn">Téma, na které je navázaný výdaj, smazat nejde.</p>
      </div>

      <div className="box">
        <h2 className="boxh">Fotky faktur a soukromí</h2>
        <label className="chk" style={{ paddingBottom: 12 }}>
          <input
            type="checkbox"
            checked={data.uklFotky !== false}
            onChange={(e) => uloz({ ...data, uklFotky: e.target.checked })}
          />
          Ukládat fotky faktur do archivu
        </label>
        <p className="pozn" style={{ marginTop: 0 }}>
          Heslo na vstupu je jednoduchý zámek, ne šifrování. Skutečná ochrana je
          odkaz na tuhle appku — ber ho jako klíč od domu a nikam ho nevkládej.
          Fotky jsou komprimované, na doložení dotace si nech originály jinde.
        </p>
        <div className="rada">
          <button
            className="btn2"
            onClick={async () => {
              if (potvrzeno !== "fotky") return setPotvrzeno("fotky");
              for (const f of data.faktury || []) {
                try {
                  await ULOZISTE.delete("fa:" + f.id, true);
                } catch (e) {}
              }
              uloz({
                ...data,
                faktury: (data.faktury || []).map((f) => ({ ...f, mafoto: false })),
              });
              setPotvrzeno("");
            }}
          >
            {potvrzeno === "fotky"
              ? "Opravdu smazat všechny fotky?"
              : "Smazat všechny uložené fotky"}
          </button>
          {potvrzeno === "fotky" && (
            <button className="btn2" onClick={() => setPotvrzeno("")}>
              Zrušit
            </button>
          )}
        </div>
      </div>

      <div className="box">
        <h2 className="boxh">
          Odkazy na originály dokladů
          <span className="n">
            {data.polozky.filter((p) => p.odkaz).length} z {data.polozky.length}
          </span>
        </h2>
        <div className="form" style={{ marginBottom: 14 }}>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Složka s doklady na webu</label>
            <input
              value={data.zakladOdkazu || ""}
              placeholder="doklady/"
              onChange={(e) => uloz({ ...data, zakladOdkazu: e.target.value })}
            />
          </div>
        </div>
        <p className="pozn" style={{ marginTop: 0 }}>
          Když sem zadáš složku, odkaz se poskládá sám z čísla dokladu — třeba
          <span className="n"> doklady/cislo-faktury.pdf</span>. Do políček níž
          vlož odkaz u každého dokladu, který máš uložený jinde — třeba na Disku.
        </p>
        <div className="hlaska" style={{ marginTop: 0 }}>
          <b>Hromadné vložení.</b> Zkopíruj z Disku odkazy a vlož sem — na každý
          řádek číslo dokladu, mezeru nebo tabulátor a odkaz. Přiřadí se samy.
          <textarea
            className="zalohaPole"
            placeholder={"cislo-dokladu https://drive.google.com/...\ndalsi-cislo https://drive.google.com/..."}
            value={hromadne}
            onChange={(e) => setHromadne(e.target.value)}
          />
          <div className="rada">
            <button
              className="btn"
              disabled={!hromadne.trim()}
              onClick={() => {
                const mapa = {};
                hromadne.split("\n").forEach((r) => {
                  const m = r.trim().match(/^(\S+)[\s\t]+(https?:\/\/\S+)$/);
                  if (m) mapa[m[1]] = m[2];
                });
                const pocet = Object.keys(mapa).length;
                if (!pocet) return setVysledek("Nenašel jsem žádný použitelný řádek.");
                let sedlo = 0;
                const nove = data.polozky.map((p) => {
                  const o = mapa[String(p.cisloDokladu)];
                  if (!o) return p;
                  sedlo++;
                  return { ...p, odkaz: o };
                });
                uloz({ ...data, polozky: nove });
                setHromadne("");
                setVysledek(
                  `Vloženo ${pocet} odkazů, přiřadilo se jich ${sedlo}.` +
                    (sedlo < pocet ? " Zbytek neodpovídá žádnému číslu dokladu." : "")
                );
              }}
            >
              Přiřadit odkazy
            </button>
            {vysledek && (
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#3E6B4C" }}>
                {vysledek}
              </span>
            )}
          </div>
        </div>

        <table className="t">
          <tbody>
            {[...data.polozky]
              .sort((a, b) => (a.datum < b.datum ? 1 : -1))
              .map((p) => (
                <tr key={p.id}>
                  <td className="n nowrap" style={{ color: "#5E7268", width: 74 }}>
                    {datumCz(p.datum)}
                  </td>
                  <td style={{ width: "34%" }}>
                    {p.dodavatel || p.popis}
                    {p.cisloDokladu && (
                      <span className="n" style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                        {p.cisloDokladu}
                      </span>
                    )}
                  </td>
                  <td>
                    <input
                      className="mini"
                      value={p.odkaz || ""}
                      placeholder="odkaz na PDF…"
                      onChange={(e) =>
                        uloz({
                          ...data,
                          polozky: data.polozky.map((x) =>
                            x.id === p.id ? { ...x, odkaz: e.target.value } : x
                          ),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="box">
        <h2 className="boxh">Kde se ukládají data</h2>
        {ULOZISTE.rezim === "supabase" && (
          <div className="hlaska dobre" style={{ marginTop: 0 }}>
            <b>Sdílená databáze.</b> Všichni, kdo znají adresu a heslo, vidí ta
            samá čísla — z mobilu i z počítače.
          </div>
        )}
        {ULOZISTE.rezim === "claude" && (
          <div className="hlaska dobre" style={{ marginTop: 0 }}>
            <b>Sdílené úložiště.</b> Aplikace běží uvnitř Claude, data se sdílí
            mezi zařízeními.
          </div>
        )}
        {ULOZISTE.rezim === "prohlizec" && (
          <div className="hlaska zle" style={{ marginTop: 0 }}>
            <b>Jen tenhle prohlížeč.</b> Ostatní zařízení data neuvidí. Chybí
            připojení k databázi — doplň ho v souboru <b>config.js</b>.
          </div>
        )}
      </div>

      <div className="box" style={{ borderLeft: "5px solid #6D9773" }}>
        <h2 className="boxh">Záloha dat</h2>
        <p className="pozn" style={{ marginTop: 0 }}>
          Vyexportuje všechno kromě fotek faktur. Text si ulož nebo pošli — dá
          se z něj kdykoli obnovit stav, i v jiné verzi aplikace.
        </p>
        <div className="rada">
          <button
            className="btn2"
            onClick={() => {
              const { heslo, ...bezHesla } = data;
              setZaloha(JSON.stringify(bezHesla));
            }}
          >
            Vytvořit zálohu
          </button>
          {zaloha && (
            <button
              className="btn2"
              onClick={() => {
                try {
                  navigator.clipboard.writeText(zaloha);
                  setZkopirovano(true);
                  setTimeout(() => setZkopirovano(false), 2500);
                } catch (e) {}
              }}
            >
              {zkopirovano ? "Zkopírováno" : "Zkopírovat"}
            </button>
          )}
        </div>
        {zaloha && (
          <textarea
            className="zalohaPole"
            readOnly
            value={zaloha}
            onClick={(e) => e.target.select()}
          />
        )}

        <AutomatickeZalohy data={data} uloz={uloz} />

        <h3 className="eyebrow" style={{ marginTop: 20, marginBottom: 8 }}>
          Obnovit ze zálohy
        </h3>
        <textarea
          className="zalohaPole"
          placeholder="Sem vlož text zálohy…"
          value={obnova}
          onChange={(e) => setObnova(e.target.value)}
        />
        <div className="rada">
          <button
            className="btn2"
            style={{ background: "#F7DED9", color: "#B03A2E" }}
            onClick={() => {
              if (potvrzeno !== "obnova") return setPotvrzeno("obnova");
              try {
                const nove = JSON.parse(obnova);
                if (!nove || typeof nove !== "object") throw new Error("x");
                // Záloha může být z libovolně staré verze — musí projít
                // stejnou migrací jako data načtená z databáze. Bez toho by
                // se do aplikace dostaly klíče pod původními názvy.
                uloz(migruj2({ ...nove, heslo: data.heslo }));
                setObnova("");
                setPotvrzeno("");
                setChybaObnovy("");
              } catch (e) {
                setChybaObnovy("Text zálohy se nepodařilo přečíst. Zkontroluj, že jsi vložila celý.");
                setPotvrzeno("");
              }
            }}
            disabled={!obnova.trim()}
          >
            {potvrzeno === "obnova"
              ? "Opravdu přepsat všechna data?"
              : "Obnovit ze zálohy"}
          </button>
          {potvrzeno === "obnova" && (
            <button className="btn2" onClick={() => setPotvrzeno("")}>
              Zrušit
            </button>
          )}
        </div>
        {chybaObnovy && <div className="hlaska zle">{chybaObnovy}</div>}
      </div>

      <div className="box" style={{ borderLeft: "5px solid #B03A2E" }}>
        <h2 className="boxh">Úklid po testování</h2>
        <p className="pozn" style={{ marginTop: 0 }}>
          Smaže všechny výdaje, faktury, zápisy práce, platby, zálohy i
          čekající zápisy. Kategorie, zdroje peněz a nastavení zůstanou.
        </p>
        <div className="rada">
          <button
            className="btn2"
            style={{ background: "#F7DED9", color: "#B03A2E" }}
            onClick={async () => {
              if (potvrzeno !== "reset") return setPotvrzeno("reset");
              for (const f of data.faktury || []) {
                try {
                  await ULOZISTE.delete("fa:" + f.id, true);
                } catch (e) {}
              }
              for (const z of data.cekajici || []) {
                try {
                  await ULOZISTE.delete("fa:" + z.id, true);
                } catch (e) {}
              }
              uloz({
                ...data,
                polozky: [],
                zaznamy: [],
                faktury: [],
                cekajici: [],
                zalohy: [],
                // Popisy účtů nejsou záznam, ty se mazáním testovacích dat neruší.
                kontrola: {
                  ...DEFAULT.kontrola,
                  popisA: (data.kontrola && data.kontrola.popisA) || "",
                  popisB: (data.kontrola && data.kontrola.popisB) || "",
                },
                delnik: { ...data.delnik, dluhPolozky: [], dluh: 0 },
                ukoly: data.ukoly.map((u) => ({ ...u, stav: "plan" })),
              });
              setPotvrzeno("");
            }}
          >
            {potvrzeno === "reset"
              ? "Opravdu smazat všechny záznamy?"
              : "Smazat všechna testovací data"}
          </button>
          {potvrzeno === "reset" && (
            <button className="btn2" onClick={() => setPotvrzeno("")}>
              Zrušit
            </button>
          )}
        </div>
      </div>

      <div className="box">
        <h2 className="boxh">
          Moje heslo
          {RELACE && RELACE.email && (
            <span className="n" style={{ fontSize: 12.5 }}>{RELACE.email}</span>
          )}
        </h2>
        <div className="form">
          <div className="pole">
            <label>Nové heslo</label>
            <input
              type="password"
              value={noveH.a}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setNoveH({ ...noveH, a: e.target.value, stav: "" })}
            />
          </div>
          <div className="pole">
            <label>Ještě jednou</label>
            <input
              type="password"
              value={noveH.b}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setNoveH({ ...noveH, b: e.target.value, stav: "" })}
            />
          </div>
          <button
            className="btn"
            disabled={!noveH.a || !noveH.b || noveH.stav === "pracuju"}
            onClick={async () => {
              if (noveH.a.length < 6)
                return setNoveH({ ...noveH, stav: "Heslo musí mít aspoň 6 znaků." });
              if (noveH.a !== noveH.b)
                return setNoveH({ ...noveH, stav: "Hesla se neshodují." });
              setNoveH({ ...noveH, stav: "pracuju" });
              try {
                await zmenHeslo(noveH.a);
                setNoveH({ a: "", b: "", stav: "Heslo je změněné." });
              } catch (e) {
                setNoveH({ ...noveH, stav: e.message });
              }
            }}
          >
            {noveH.stav === "pracuju" ? "Ukládám…" : "Změnit heslo"}
          </button>
        </div>
        {noveH.stav && noveH.stav !== "pracuju" && (
          <div className={"hlaska " + (noveH.stav === "Heslo je změněné." ? "dobre" : "zle")}>
            {noveH.stav}
          </div>
        )}
        <p className="pozn">
          Mění se heslo účtu {RELACE && RELACE.email ? RELACE.email : ", pod kterým jsi přihlášená"}.
          Hesla ostatních se mění v Supabase, nebo si je každý změní tady sám.
        </p>
      </div>

      <div className="box" style={{ display: "none" }}>
        <h2 className="boxh">
          Hesla
          {odhlas && (
            <button className="btn2" onClick={odhlas}>
              Odhlásit
            </button>
          )}
        </h2>
        {!HESLO_ZAPNUTO && (
          <div className="hlaska">
            Zámek je teď vypnutý, appka se otevírá rovnou. Až budete nasazovat
            naostro, přepni v kódu nahoře <b>HESLO_ZAPNUTO</b> na <b>true</b> —
            heslo nastavené tady se pak začne vyžadovat.
          </div>
        )}
        <div className="form" style={{ marginTop: 12 }}>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>Vaše heslo {data.heslo ? "(prázdné = ponechat)" : ""}</label>
            <input
              type="password"
              value={n.heslo}
              onChange={(e) => setN({ ...n, heslo: e.target.value })}
            />
          </div>
          <div className="pole" style={{ gridColumn: "span 2" }}>
            <label>
              Kód pro {n.jmeno} {data.hesloDelnik ? "(prázdné = ponechat)" : "(nepovinné)"}
            </label>
            <input
              type="text"
              value={n.hesloDelnik}
              placeholder="nechat prázdné = bez kódu"
              onChange={(e) => setN({ ...n, hesloDelnik: e.target.value })}
            />
          </div>
        </div>
        <p className="pozn">
          Vaše heslo chrání rozpočet a faktury. Kód pro {n.jmeno} chrání jeho
          pracovní deník — jeho hodiny, platby a rozpis dluhu. Když ho necháš
          prázdný, jeho stranu si otevře kdokoli s odkazem.
        </p>
      </div>

      <div className="rada">
        <button className="btn" onClick={potvrd}>
          Uložit nastavení
        </button>
        {ok && (
          <span style={{ fontSize: 13, color: "#3E6B4C", fontWeight: 650 }}>Uloženo.</span>
        )}
      </div>
    </>
  );
}
