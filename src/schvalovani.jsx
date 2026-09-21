import { useState, useEffect } from "react";
import { kc, datumCz, cislo, uid, sazbaPracanta, castkaZaHodiny, hodinyCelkem } from "./vypocty.js";
import { ZDROJ } from "./data.js";
import { ULOZISTE } from "./uloziste.js";
import { IKO, Ik } from "./ikony.jsx";
import { VyberKategorie, Doklad, Smazat } from "./sdilene.jsx";

export function RozpadPolozky({ data, uloz, polozka }) {
  const [rady, setRady] = useState([
    { id: "r1", ukol: "", castka: String(polozka.castka) },
  ]);
  const [oznacene, setOznacene] = useState({});
  const [novaR, setNovaR] = useState({ popis: "", castka: "" });
  const [rozepsat, setRozepsat] = useState(false);

  const radky = polozka.radky || [];
  const suma = rady.reduce((a, r) => a + cislo(r.castka), 0);
  const zbytek = polozka.castka - suma;
  const sedi = Math.abs(zbytek) < 1;
  const hotovo = rady.every((r) => r.ukol && cislo(r.castka) > 0) && sedi;

  const ulozRadky = (nove) =>
    uloz({
      ...data,
      polozky: data.polozky.map((p) =>
        p.id === polozka.id ? { ...p, radky: nove } : p
      ),
    });

  const pridejFakturniRadek = () => {
    const c = cislo(novaR.castka);
    if (!c) return;
    ulozRadky([
      ...radky,
      { id: uid(), popis: novaR.popis.trim() || "položka", castka: c },
    ]);
    setNovaR({ popis: "", castka: "" });
  };

  const volne = radky.filter((r) => !r.prirazeno);
  const oznacenoSuma = volne
    .filter((r) => oznacene[r.id])
    .reduce((a, r) => a + r.castka, 0);

  const vytvorZOznacenych = () => {
    const vybrane = volne.filter((r) => oznacene[r.id]);
    if (vybrane.length === 0) return;
    const idRadku = uid();
    const prazdny = rady.find((r) => !r.ukol && cislo(r.castka) === 0);
    const novy = { id: idRadku, ukol: "", castka: String(Math.round(oznacenoSuma * 100) / 100) };
    setRady(prazdny ? rady.map((r) => (r.id === prazdny.id ? novy : r)) : [...rady, novy]);
    ulozRadky(
      radky.map((r) => (oznacene[r.id] && !r.prirazeno ? { ...r, prirazeno: idRadku } : r))
    );
    setOznacene({});
  };

  const zmen = (id, pole, hod) =>
    setRady(rady.map((r) => (r.id === id ? { ...r, [pole]: hod } : r)));
  const pridej = () =>
    setRady([
      ...rady,
      { id: uid(), ukol: "", castka: zbytek > 0 ? String(Math.round(zbytek * 100) / 100) : "" },
    ]);
  const smaz = (id) => {
    setRady(rady.filter((r) => r.id !== id));
    if (radky.some((r) => r.prirazeno === id))
      ulozRadky(radky.map((r) => (r.prirazeno === id ? { ...r, prirazeno: null } : r)));
  };

  // Doklad nejde ze seznamu ke schválení dostat jinak než úplným rozepsáním.
  // Tohle ho z něj odebere a nechá jako běžný výdaj — částka zůstane,
  // jen nebude rozepsaná do kategorií.
  const nechatVcelku = () =>
    uloz({
      ...data,
      polozky: data.polozky.map((p) =>
        p.id === polozka.id
          ? {
              ...p,
              kRozpadu: false,
              popis: p.popis.replace(/\s*\(čeká na rozpad\)\s*$/i, ""),
            }
          : p
      ),
    });

  const zapis = () => {
    if (!hotovo) return;
    const zaklad = polozka.popis.replace(/\s*\(čeká na rozpad\)\s*$/i, "");
    const nove = rady.map((r) => {
      const k = data.ukoly.find((u) => u.id === r.ukol);
      const patrici = radky.filter((x) => x.prirazeno === r.id);
      return {
        ...polozka,
        id: uid(),
        kRozpadu: false,
        radky: patrici.length ? patrici.map(({ prirazeno, ...z }) => z) : undefined,
        ukol: r.ukol,
        castka: cislo(r.castka),
        popis: patrici.length
          ? patrici.map((x) => x.popis).join(", ")
          : rady.length > 1 && k
          ? `${zaklad} — ${k.nazev}`
          : zaklad,
      };
    });
    uloz({
      ...data,
      polozky: [...data.polozky.filter((x) => x.id !== polozka.id), ...nove],
    });
  };

  return (
    <div className="box" style={{ borderLeft: "5px solid #B46617" }}>
      <h2 className="boxh">
        <span className="hi">
          <i style={{ background: "#F7E7D6" }}>
            <Ik d={IKO.ucet} c="#B46617" s={16} />
          </i>
          K rozdělení do kategorií
        </span>
        <span className="n">
          {datumCz(polozka.datum)} · {kc(polozka.castka)}
        </span>
      </h2>

      <p style={{ fontSize: 14, margin: "0 0 4px", fontWeight: 650 }}>
        {polozka.popis.replace(/\s*\(čeká na rozpad\)\s*$/i, "")}
      </p>
      <Doklad p={polozka} zaklad={data.zakladOdkazu} />

      <div className="rada" style={{ marginTop: 14 }}>
        <button className="btn2" onClick={() => setRozepsat(!rozepsat)}>
          {rozepsat ? "Skrýt položky z faktury ⌃" : "Rozepsat položky z faktury ⌄"}
        </button>
        {radky.length > 0 && (
          <span style={{ fontSize: 12.5, color: "#5E7268" }}>
            {radky.length} rozepsaných · {volne.length} nezařazených
          </span>
        )}
      </div>

      {rozepsat && (
        <div className="fakturniRadky">
          {radky.length > 0 && (
            <div className="upominkySeznam" style={{ marginBottom: 12 }}>
              {radky.map((r) => {
                const kat = r.prirazeno
                  ? data.ukoly.find(
                      (u) => u.id === (rady.find((x) => x.id === r.prirazeno) || {}).ukol
                    )
                  : null;
                return (
                  <label className="fakturniR" key={r.id} data-prirazeno={r.prirazeno ? "1" : "0"}>
                    <input
                      type="checkbox"
                      disabled={!!r.prirazeno}
                      checked={!!oznacene[r.id] && !r.prirazeno}
                      onChange={() => setOznacene({ ...oznacene, [r.id]: !oznacene[r.id] })}
                    />
                    <span className="fakturniText">
                      <b>{r.popis}</b>
                      {r.prirazeno && (
                        <small>zařazeno {kat ? "· " + kat.nazev : ""}</small>
                      )}
                    </span>
                    <span className="n" style={{ fontWeight: 700 }}>
                      {kc(r.castka)}
                    </span>
                    <Smazat
                      co="tuto položku faktury"
                      onSmaz={() => ulozRadky(radky.filter((x) => x.id !== r.id))}
                    />
                  </label>
                );
              })}
            </div>
          )}

          {oznacenoSuma > 0 && (
            <div className="soucet" style={{ marginTop: 0, marginBottom: 12 }}>
              <span>označeno {volne.filter((r) => oznacene[r.id]).length} položek</span>
              <b className="n">{kc(oznacenoSuma)}</b>
              <button
                className="btn"
                style={{ background: "#FFBA00", color: "#0C3B2E", marginLeft: 14 }}
                onClick={vytvorZOznacenych}
              >
                Vytvořit řádek
              </button>
            </div>
          )}

          <div className="form">
            <div className="pole" style={{ gridColumn: "span 2" }}>
              <label>Položka z faktury</label>
              <input
                value={novaR.popis}
                placeholder="např. omítka CEMIX 25 kg"
                onChange={(e) => setNovaR({ ...novaR, popis: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && pridejFakturniRadek()}
              />
            </div>
            <div className="pole">
              <label>Částka</label>
              <input
                className="n"
                inputMode="decimal"
                value={novaR.castka}
                onChange={(e) => setNovaR({ ...novaR, castka: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && pridejFakturniRadek()}
              />
            </div>
            <button className="btn2" onClick={pridejFakturniRadek}>
              Přidat
            </button>
          </div>
          <p className="pozn">
            Opiš položky z faktury, zaškrtni ty, které patří k sobě, a nech je
            sečíst. Nemusíš rozepisovat všechno — zbytek dorovnáš ručně.
          </p>
        </div>
      )}

      <h3 className="eyebrow" style={{ marginTop: 18, marginBottom: 9 }}>
        Rozdělení do kategorií
      </h3>
      <table className="t">
        <tbody>
          {rady.map((r) => (
            <tr key={r.id}>
              <td>
                <VyberKategorie
                  ukoly={data.ukoly.filter((u) => u.nazev !== "Čeká na rozpad faktury")}
                  hodnota={r.ukol}
                  onZmena={(id) => zmen(r.id, "ukol", id)}
                />
              </td>
              <td style={{ width: 120 }}>
                <input
                  className="mini n"
                  inputMode="decimal"
                  style={{ textAlign: "right" }}
                  value={r.castka}
                  onChange={(e) => zmen(r.id, "castka", e.target.value)}
                />
              </td>
              <td style={{ width: 28 }}>
                {rady.length > 1 && (
                  <button className="x" onClick={() => smaz(r.id)} aria-label="Odebrat">
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rada" style={{ marginTop: 10 }}>
        <button className="btn2" onClick={pridej}>
          + další kategorie
        </button>
        <span
          style={{ fontSize: 12.5, fontWeight: 700, color: sedi ? "#3E6B4C" : "#B03A2E" }}
        >
          {sedi
            ? `Sedí na ${kc(polozka.castka)}`
            : zbytek > 0
            ? `Nerozdělených ${kc(zbytek)}`
            : `Rozděleno o ${kc(-zbytek)} víc, než je na dokladu`}
        </span>
      </div>

      <div className="rada">
        <button className="btn" onClick={zapis} disabled={!hotovo}>
          Rozdělit a zapsat
        </button>
        <button className="btn2" onClick={nechatVcelku}>
          Nechat nerozdělený
        </button>
        <Smazat
          tlacitko
          popisek="Smazat doklad"
          co="tenhle doklad i s jeho částkou"
          onSmaz={() =>
            uloz({
              ...data,
              polozky: data.polozky.filter((p) => p.id !== polozka.id),
            })
          }
        />
      </div>
      <p className="pozn">
        <b>Nechat nerozdělený</b> doklad z tohoto seznamu odebere, ale částka
        zůstane ve výdajích — jen nebude rozepsaná do kategorií.{" "}
        <b>Smazat</b> ho odstraní i s částkou.
      </p>
    </div>
  );
}

export function Schvalovani({ data, uloz }) {
  const [fotky, setFotky] = useState({});
  const [zdroje, setZdroje] = useState({});
  const [kategorie, setKategorie] = useState({});
  const [zalohaK, setZalohaK] = useState({});
  const [vraceni, setVraceni] = useState({});
  const [upravy, setUpravy] = useState({});
  const [rozpady, setRozpady] = useState({});
  const [lupa, setLupa] = useState(null);

  const cekajici = (data.cekajici || []).filter((z) => z.stav === "ceka");
  const kRozpadu = (data.polozky || []).filter((p) => p.kRozpadu);
  const vyrizene = (data.cekajici || [])
    .filter((z) => z.stav !== "ceka")
    .sort((a, b) => (a.vytvoreno < b.vytvoreno ? 1 : -1))
    .slice(0, 12);
  const sazba = data.sazba || 250;
  const volneZalohy = (data.zalohy || []).filter(
    (z) => !(data.polozky || []).some((p) => p.zalohaId === z.id)
  );

  useEffect(() => {
    let zivy = true;
    (async () => {
      const sbirka = {};
      for (const z of cekajici.filter((x) => x.druh === "faktura" && x.mafoto)) {
        try {
          const r = await ULOZISTE.get("fa:" + z.id, true);
          if (r) sbirka[z.id] = r.value;
        } catch (e) {}
      }
      if (zivy) setFotky(sbirka);
    })();
    return () => {
      zivy = false;
    };
  }, [cekajici.length]);

  const jmenoPracanta = (id) => {
    const p = (data.pracanti || []).find((x) => x.id === id);
    return p ? p.jmeno : id;
  };

  const uprava = (z) => ({
    dodavatel: z.dodavatel || "",
    cisloDokladu: z.cisloDokladu || "",
    castka: z.castka || "",
    popis: z.popis || "",
    ...(upravy[z.id] || {}),
  });
  const zmenUpravu = (z, pole, hod) =>
    setUpravy({ ...upravy, [z.id]: { ...uprava(z), [pole]: hod } });

  const vybranaKat = (z) =>
    kategorie[z.id] !== undefined ? kategorie[z.id] : z.ukol || "";
  const vybranaZaloha = (z) =>
    zalohaK[z.id] !== undefined ? zalohaK[z.id] : z.zalohaId || "";

  const zalozKategorii = (z) => {
    const nazev = (z.ukolText || z.popis || "").trim();
    if (!nazev) return;
    const id = uid();
    uloz({
      ...data,
      ukoly: [...data.ukoly, { id, nazev, odhad: 0, stav: "probiha", typ: "pridano" }],
    });
    setKategorie({ ...kategorie, [z.id]: id });
  };

  // ── rozpad faktury do více kategorií ──
  const rozpad = (z) =>
    rozpady[z.id] || [{ id: "r1", ukol: z.ukol || "", castka: uprava(z).castka || "" }];
  const setRozpad = (z, rady) => setRozpady({ ...rozpady, [z.id]: rady });
  const sumaRozpadu = (z) => rozpad(z).reduce((a, r) => a + cislo(r.castka), 0);
  const zbytek = (z) => cislo(uprava(z).castka) - sumaRozpadu(z);
  const rozpadOk = (z) => {
    const rady = rozpad(z);
    return (
      rady.length > 0 &&
      rady.every((r) => r.ukol && cislo(r.castka) > 0) &&
      Math.abs(zbytek(z)) < 1
    );
  };
  const pridejRadek = (z) =>
    setRozpad(z, [
      ...rozpad(z),
      { id: uid(), ukol: "", castka: zbytek(z) > 0 ? String(Math.round(zbytek(z))) : "" },
    ]);
  const zmenRadek = (z, id, pole, hod) =>
    setRozpad(z, rozpad(z).map((r) => (r.id === id ? { ...r, [pole]: hod } : r)));
  const smazRadek = (z, id) =>
    setRozpad(z, rozpad(z).filter((r) => r.id !== id));

  const schval = (z) => {
    const oznac = (data.cekajici || []).map((x) =>
      x.id === z.id ? { ...x, stav: "schvaleno" } : x
    );

    if (z.druh === "dochazka") {
      const h = hodinyCelkem(z.hodiny);
      uloz({
        ...data,
        zaznamy: [
          ...data.zaznamy,
          {
            id: uid(),
            datum: z.datum,
            typ: "prace",
            popis: z.popis || z.ukolText || "práce",
            stavPrace: z.stavPrace || "",
            ukol: vybranaKat(z) || null,
            castka: castkaZaHodiny(data, z.hodiny),
            hodiny: z.hodiny,
            zdroj: "hypoteka",
          },
        ],
        cekajici: oznac,
      });
      return;
    }

    const u = uprava(z);
    const zdroj = zdroje[z.id] || "hypoteka";
    const naZalohu = vybranaZaloha(z) || null;
    const celkem = cislo(u.castka);
    const rady = rozpad(z);
    const zaklad = u.popis && u.popis !== "Materiál" ? u.popis : "Materiál";

    const nove = rady.map((r, i) => ({
      id: uid(),
      datum: z.datum,
      popis:
        (rady.length > 1
          ? `${zaklad} (${
              (data.ukoly.find((k) => k.id === r.ukol) || {}).nazev || "část"
            })`
          : zaklad) + (u.dodavatel ? " — " + u.dodavatel : ""),
      tema: data.temata[0],
      ukol: r.ukol,
      castka: cislo(r.castka),
      zdroj,
      pres: true,
      dolozeno: !!z.mafoto,
      proplaceno: naZalohu ? true : false,
      zalohaId: i === 0 ? naZalohu : null,
      faktura: z.mafoto ? z.id : null,
    }));

    uloz({
      ...data,
      polozky: [...data.polozky, ...nove],
      faktury: z.mafoto
        ? [
            ...(data.faktury || []),
            {
              id: z.id,
              datum: z.datum,
              dodavatel: u.dodavatel || "Bez názvu",
              celkem,
              mafoto: true,
              pocet: nove.length,
            },
          ]
        : data.faktury || [],
      cekajici: oznac,
    });
  };

  const vrat = (z) => {
    const duvod = (vraceni[z.id] || "").trim();
    if (!duvod) return;
    uloz({
      ...data,
      cekajici: (data.cekajici || []).map((x) =>
        x.id === z.id ? { ...x, stav: "vraceno", poznamka: duvod, videno: false } : x
      ),
    });
  };

  const lzeSchvalit = (z) =>
    z.druh === "dochazka" ? !!vybranaKat(z) : cislo(uprava(z).castka) > 0 && rozpadOk(z);

  return (
    <>
      {kRozpadu.length > 0 && (
        <>
          <div className="hlaska" style={{ marginTop: 0 }}>
            <b>
              {kRozpadu.length}{" "}
              {kRozpadu.length === 1 ? "doklad čeká" : "dokladů čeká"} na
              rozdělení do kategorií — celkem{" "}
              <span className="n">
                {kc(kRozpadu.reduce((a, p) => a + p.castka, 0))}
              </span>
              .
            </b>{" "}
            Částka se už počítá do rozpočtu, jen zatím visí na jedné hromádce.
          </div>
          {kRozpadu
            .sort((a, b) => b.castka - a.castka)
            .map((p) => (
              <RozpadPolozky key={p.id} data={data} uloz={uloz} polozka={p} />
            ))}
        </>
      )}

      {cekajici.length === 0 && kRozpadu.length === 0 ? (
        <div className="box" style={{ marginTop: 0 }}>
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.fajfka} c="#0C3B2E" s={16} />
              </i>
              Ke schválení
            </span>
          </h2>
          <p className="prazdno">Nic nečeká. Vše je vyřízené.</p>
        </div>
      ) : (
        cekajici.map((z) => {
          const h = hodinyCelkem(z.hodiny);
          const u = uprava(z);
          return (
            <div className="box" key={z.id} style={{ borderLeft: "5px solid #FFBA00" }}>
              <h2 className="boxh">
                <span className="hi">
                  <i>
                    <Ik d={z.druh === "dochazka" ? IKO.hodiny : IKO.ucet} c="#0C3B2E" s={16} />
                  </i>
                  {z.druh === "dochazka" ? "Docházka" : "Faktura za materiál"}
                </span>
                <span className="n">{datumCz(z.datum)}</span>
              </h2>

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {z.druh === "faktura" && (
                  <div className="fotoblok">
                    {z.mafoto ? (
                      fotky[z.id] ? (
                        <>
                          <button
                            className="fotoTlac"
                            onClick={() => setLupa(fotky[z.id])}
                            aria-label="Zvětšit fakturu"
                          >
                            <img src={fotky[z.id]} alt="Faktura od dělníka" />
                          </button>
                          <span className="fotoPopis">Klikni pro zvětšení</span>
                        </>
                      ) : (
                        <div className="fotoCeka">
                          <i className="spin" />
                          Načítám fotku…
                        </div>
                      )
                    ) : (
                      <div className="fotoCeka">Bez fotky</div>
                    )}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 250 }}>
                  <table className="t">
                    <tbody>
                      {z.druh === "dochazka" ? (
                        <>
                          <tr>
                            <td>
                              Zařadit do kategorie
                              {z.ukolText && (
                                <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                                  napsal: „{z.ukolText}"
                                </span>
                              )}
                            </td>
                            <td className="r">
                              <VyberKategorie
                                ukoly={data.ukoly}
                                hodnota={vybranaKat(z)}
                                onZmena={(id) =>
                                  setKategorie({ ...kategorie, [z.id]: id })
                                }
                              />
                              {!vybranaKat(z) && (z.ukolText || z.popis) && (
                                <button
                                  className="odkaz"
                                  style={{ display: "block", marginTop: 6, marginLeft: "auto" }}
                                  onClick={() => zalozKategorii(z)}
                                >
                                  + založit „{z.ukolText || z.popis}" jako kategorii
                                </button>
                              )}
                            </td>
                          </tr>
                          {Object.entries(z.hodiny || {}).map(([pid, hod]) => (
                            <tr key={pid}>
                              <td>{jmenoPracanta(pid)}</td>
                              <td className="r n">
                                {hod} h × {sazbaPracanta(data, pid)} ={" "}
                                {kc(hod * sazbaPracanta(data, pid))}
                              </td>
                            </tr>
                          ))}
                          <tr>
                            <td>
                              {z.popis || "bez poznámky"}
                              {z.stavPrace && (
                                <span
                                  className="stitek"
                                  style={{ marginLeft: 6, color: "#8A6100", background: "#FFF2D0" }}
                                >
                                  {z.stavPrace}
                                </span>
                              )}
                            </td>
                            <td className="r n" style={{ fontWeight: 800 }}>
                              {h} h = {kc(castkaZaHodiny(data, z.hodiny))}
                            </td>
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr>
                            <td>
                              Popis
                              {z.ukolText && (
                                <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                                  napsal: „{z.ukolText}"
                                </span>
                              )}
                            </td>
                            <td className="r">
                              <input
                                className="mini"
                                value={u.popis}
                                placeholder="co to je"
                                onChange={(e) => zmenUpravu(z, "popis", e.target.value)}
                              />
                            </td>
                          </tr>
                          <tr>
                            <td>Dodavatel</td>
                            <td className="r">
                              <input
                                className="mini"
                                value={u.dodavatel}
                                placeholder="kde nakoupil"
                                onChange={(e) => zmenUpravu(z, "dodavatel", e.target.value)}
                              />
                            </td>
                          </tr>
                          <tr>
                            <td>Číslo dokladu</td>
                            <td className="r">
                              <input
                                className="mini n"
                                value={u.cisloDokladu}
                                placeholder="z faktury"
                                onChange={(e) => zmenUpravu(z, "cisloDokladu", e.target.value)}
                              />
                            </td>
                          </tr>
                          <tr>
                            <td>Částka celkem</td>
                            <td className="r">
                              <input
                                className="mini n"
                                inputMode="decimal"
                                style={{
                                  textAlign: "right",
                                  fontWeight: 800,
                                  borderColor: cislo(u.castka) ? undefined : "#B03A2E",
                                }}
                                value={u.castka}
                                onChange={(e) => zmenUpravu(z, "castka", e.target.value)}
                              />
                            </td>
                          </tr>
                          {volneZalohy.length > 0 && (
                            <tr>
                              <td>
                                Hradí se ze zálohy?
                                <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                                  peníze už jste poslali dopředu
                                </span>
                              </td>
                              <td className="r">
                                <select
                                  className="mini"
                                  style={{ width: "auto" }}
                                  value={vybranaZaloha(z)}
                                  onChange={(e) => setZalohaK({ ...zalohaK, [z.id]: e.target.value })}
                                >
                                  <option value="">ne, platíme zvlášť</option>
                                  {volneZalohy.map((zl) => (
                                    <option key={zl.id} value={zl.id}>
                                      {datumCz(zl.datum)} · {zl.popis} · {kc(zl.castka)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          )}
                          <tr style={{ display: vybranaZaloha(z) ? "none" : undefined }}>
                            <td>Zaplatit z</td>
                            <td className="r">
                              <select
                                className="mini"
                                style={{ width: "auto" }}
                                value={zdroje[z.id] || "hypoteka"}
                                onChange={(e) => setZdroje({ ...zdroje, [z.id]: e.target.value })}
                              >
                                {Object.entries(ZDROJ).map(([k, zz]) => (
                                  <option key={k} value={k}>
                                    {zz.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {z.druh === "faktura" && (
                <>
                  <h3 className="eyebrow" style={{ marginTop: 18, marginBottom: 9 }}>
                    Rozdělit do kategorií
                  </h3>
                  <table className="t">
                    <tbody>
                      {rozpad(z).map((r) => (
                        <tr key={r.id}>
                          <td>
                            <VyberKategorie
                              ukoly={data.ukoly}
                              hodnota={r.ukol}
                              onZmena={(id) => zmenRadek(z, r.id, "ukol", id)}
                            />
                          </td>
                          <td style={{ width: 120 }}>
                            <input
                              className="mini n"
                              inputMode="decimal"
                              style={{ textAlign: "right" }}
                              value={r.castka}
                              onChange={(e) => zmenRadek(z, r.id, "castka", e.target.value)}
                            />
                          </td>
                          <td style={{ width: 28 }}>
                            {rozpad(z).length > 1 && (
                              <button
                                className="x"
                                onClick={() => smazRadek(z, r.id)}
                                aria-label="Odebrat řádek"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="rada" style={{ marginTop: 10 }}>
                    <button className="btn2" onClick={() => pridejRadek(z)}>
                      + další kategorie
                    </button>
                    {Math.abs(zbytek(z)) >= 1 && cislo(u.castka) > 0 && (
                      <span style={{ fontSize: 12.5, color: "#B03A2E", fontWeight: 700 }}>
                        {zbytek(z) > 0
                          ? `Nerozdělených ${kc(zbytek(z))}`
                          : `Rozděleno o ${kc(-zbytek(z))} víc, než je na faktuře`}
                      </span>
                    )}
                    {Math.abs(zbytek(z)) < 1 && cislo(u.castka) > 0 && (
                      <span style={{ fontSize: 12.5, color: "#3E6B4C", fontWeight: 700 }}>
                        Sedí na {kc(cislo(u.castka))}
                      </span>
                    )}
                  </div>
                </>
              )}

              <div className="form" style={{ marginTop: 16 }}>
                <div className="pole" style={{ gridColumn: "span 2" }}>
                  <label>Důvod vrácení</label>
                  <input
                    value={vraceni[z.id] || ""}
                    placeholder="např. chybí účtenka, sedí to na jiný den…"
                    onChange={(e) => setVraceni({ ...vraceni, [z.id]: e.target.value })}
                  />
                </div>
              </div>
              <div className="rada">
                <button className="btn" onClick={() => schval(z)} disabled={!lzeSchvalit(z)}>
                  Schválit a zapsat
                </button>
                <Smazat
                  tlacitko
                  popisek="Smazat"
                  co="tento zápis úplně"
                  onSmaz={() =>
                    uloz({
                      ...data,
                      cekajici: (data.cekajici || []).filter((x) => x.id !== z.id),
                    })
                  }
                />
                <button
                  className="btn2"
                  onClick={() => vrat(z)}
                  disabled={!(vraceni[z.id] || "").trim()}
                  style={{ opacity: (vraceni[z.id] || "").trim() ? 1 : 0.45 }}
                >
                  Vrátit s důvodem
                </button>
                {z.druh === "dochazka" && !vybranaKat(z) && (
                  <span style={{ fontSize: 12.5, color: "#B03A2E" }}>
                    Nejdřív vyber kategorii.
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}

      {lupa && (
        <div className="lupa" onClick={() => setLupa(null)} role="dialog">
          <img src={lupa} alt="Faktura" />
          <button className="lupax" onClick={() => setLupa(null)}>
            Zavřít
          </button>
        </div>
      )}

      {vyrizene.length > 0 && (
        <div className="box">
          <h2 className="boxh">
            <span className="hi">
              <i>
                <Ik d={IKO.graf} c="#0C3B2E" s={16} />
              </i>
              Vyřízené
            </span>
          </h2>
          <table className="t">
            <tbody>
              {vyrizene.map((z) => (
                <tr key={z.id}>
                  <td className="n nowrap" style={{ color: "#5E7268" }}>
                    {datumCz(z.datum)}
                  </td>
                  <td>
                    {z.druh === "dochazka"
                      ? `${hodinyCelkem(z.hodiny)} h — ${z.popis || z.ukolText || "práce"}`
                      : `Faktura ${z.dodavatel || ""}`}
                    {z.stav === "vraceno" && z.poznamka && (
                      <span style={{ display: "block", fontSize: 11.5, color: "#5E7268" }}>
                        {z.poznamka}
                      </span>
                    )}
                  </td>
                  <td className="r">
                    <span
                      className="stitek"
                      style={
                        z.stav === "schvaleno"
                          ? { color: "#3E6B4C", background: "#E4EDE5" }
                          : { color: "#B03A2E", background: "#F7DED9" }
                      }
                    >
                      {z.stav === "schvaleno" ? "Schváleno" : "Vráceno"}
                    </span>
                  </td>
                  <td style={{ width: 30 }}>
                    <Smazat
                      co="tento zápis z historie"
                      onSmaz={() =>
                        uloz({
                          ...data,
                          cekajici: (data.cekajici || []).filter((x) => x.id !== z.id),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
