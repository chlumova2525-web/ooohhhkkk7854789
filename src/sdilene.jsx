// Drobné komponenty, které používá víc obrazovek.

import { useState, useEffect } from "react";
import { kc } from "./vypocty.js";
import { DOKLADY_NA_WEBU } from "./uloziste.js";

export function VyberKategorie({ ukoly, hodnota, onZmena, onNova, placeholder = "začni psát…" }) {
  const nazevZ = (id) => (ukoly.find((u) => u.id === id) || {}).nazev || "";
  const [text, setText] = useState(() => nazevZ(hodnota));
  const [otevreno, setOtevreno] = useState(false);

  useEffect(() => {
    setText(nazevZ(hodnota));
  }, [hodnota]);

  const dotaz = text.trim().toLowerCase();
  const presnaShoda = ukoly.find((u) => u.nazev.toLowerCase() === dotaz);
  const navrhy = dotaz
    ? ukoly.filter((u) => u.nazev.toLowerCase().includes(dotaz))
    : ukoly;

  const vyber = (u) => {
    onZmena(u.id);
    setText(u.nazev);
    setOtevreno(false);
  };

  return (
    <div className="combo">
      <input
        className="mini"
        value={text}
        placeholder={placeholder}
        style={{ borderColor: hodnota ? undefined : "#B03A2E" }}
        onFocus={() => setOtevreno(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOtevreno(true);
          if (hodnota) onZmena("");
        }}
        onBlur={() =>
          setTimeout(() => {
            setOtevreno(false);
            if (presnaShoda) vyber(presnaShoda);
            else setText(nazevZ(hodnota));
          }, 160)
        }
      />
      {otevreno && (
        <div className="combolist">
          {navrhy.length === 0 && !onNova && (
            <div className="comboprazdno">Nic takového tu není.</div>
          )}
          {navrhy.slice(0, 40).map((u) => (
            <button
              key={u.id}
              type="button"
              className="comboitem"
              onMouseDown={(e) => {
                e.preventDefault();
                vyber(u);
              }}
            >
              {u.nazev}
              {u.odhad ? (
                <span className="comboodhad n"> {kc(u.odhad)}</span>
              ) : null}
            </button>
          ))}
          {onNova && dotaz && !presnaShoda && (
            <button
              type="button"
              className="comboitem nova"
              onMouseDown={(e) => {
                e.preventDefault();
                setOtevreno(false);
                onNova(text.trim());
              }}
            >
              + založit „{text.trim()}" jako novou kategorii
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Doklad({ p, zaklad }) {
  const odkaz = odkazDokladu(p, zaklad);
  if (!p.dodavatel && !p.cisloDokladu && !p.poznamka && !odkaz) return null;
  return (
    <span className="dokladR">
      {p.dodavatel && <b>{p.dodavatel}</b>}
      {p.cisloDokladu && <span className="n"> · doklad {p.cisloDokladu}</span>}
      {odkaz && (
        <>
          {" · "}
          <a
            className="origOdkaz"
            href={odkaz}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            otevřít originál
          </a>
        </>
      )}
      {p.poznamka && <em> · {p.poznamka}</em>}
    </span>
  );
}

// Běžně stačí nenápadné ×. Tam, kde stojí vedle velkých tlačítek a dalo by
// se přehlédnout, se dá zapnout tlacitko a vykreslí se s popiskem.
export function Smazat({ onSmaz, co = "tento záznam", popisek = "Smazat", tlacitko = false }) {
  const [ptam, setPtam] = useState(false);
  if (!ptam)
    return tlacitko ? (
      <button className="btn2" onClick={() => setPtam(true)}>
        {popisek}
      </button>
    ) : (
      <button className="x" onClick={() => setPtam(true)} aria-label={popisek}>
        ×
      </button>
    );
  return (
    <span className="potvrz">
      <span className="potvrzT">Opravdu smazat {co}?</span>
      <button className="potvrzAno" onClick={onSmaz}>
        Ano, smazat
      </button>
      <button className="potvrzNe" onClick={() => setPtam(false)}>
        Ne
      </button>
    </span>
  );
}

// Návrh zařazení podle kategorie rozpočtu; ruční volba (p.opatreni) má přednost.
// Když je nastavený základ odkazů, poskládá se cesta z čísla dokladu.
export function odkazDokladu(p, zaklad) {
  if (p.odkaz) return p.odkaz;
  // Jednosouborová verze si nese plnou adresu složky s doklady, aby odkazy
  // fungovaly i když se soubor otevře odkudkoli.
  const nast = (typeof window !== "undefined" && window.NASTAVENI) || {};
  if (nast.zakladOdkazu) zaklad = nast.zakladOdkazu;
  if (!zaklad || !p.cisloDokladu) return "";
  const soubor = DOKLADY_NA_WEBU[String(p.cisloDokladu)];
  if (!soubor) return "";
  return zaklad + soubor;
}
