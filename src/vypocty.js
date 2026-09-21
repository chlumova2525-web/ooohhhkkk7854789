// Formátování a drobné výpočty. Čisté funkce — nesahají na stav
// aplikace ani na síť, takže se dají testovat samostatně.
//
// kc() na peníze, datumCz() na data, cislo() na vstupy z formulářů
// (zvládne „12 500“ i „12,5“). Nikdy nepoužívej toLocaleString přímo.
export const kc = (n) =>
  new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(
    Math.round(n || 0)
  ) + " Kč";

export const kcKratce = (n) =>
  new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(
    Math.round(n || 0)
  );

export const dnes = () => new Date().toISOString().slice(0, 10);

// Dny v období od–do včetně obou konců, jako "2026-03-01".
// `jenVsedni` vynechá soboty a neděle. Počítá se v UTC, aby letní čas
// nikde nepřeskočil ani nezdvojil den.
export function dnyObdobi(od, doD, jenVsedni) {
  if (!od || !doD) return [];
  const a = new Date(od + "T12:00:00Z");
  const b = new Date(doD + "T12:00:00Z");
  if (isNaN(a) || isNaN(b) || a > b) return [];
  const dny = [];
  for (let d = a; d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    const den = d.getUTCDay();
    if (jenVsedni && (den === 0 || den === 6)) continue;
    dny.push(d.toISOString().slice(0, 10));
    if (dny.length > 2000) break;
  }
  return dny;
}

export const datumCz = (d) => {
  if (!d) return "";
  const [r, m, den] = d.split("-");
  return `${Number(den)}.${Number(m)}.${r.slice(2)}`;
};

export const cislo = (v) => parseFloat(String(v).replace(/\s/g, "").replace(",", ".")) || 0;

export const uid = () => Math.random().toString(36).slice(2, 9);

// Faktura přes dělníka se počítá jako čerpání až ve chvíli proplacení.
export const jeProplaceno = (p) => !p.pres || p.proplaceno !== false;

export function sazbaPracanta(data, id) {
  const p = (data.pracanti || []).find((x) => x.id === id);
  return Number(p && p.sazba) || Number(data.sazba) || 250;
}

export function castkaZaHodiny(data, hodiny) {
  return Object.entries(hodiny || {}).reduce(
    (a, [pid, h]) => a + (Number(h) || 0) * sazbaPracanta(data, pid),
    0
  );
}

// Popis účtu si uživatel vyplní v Nastavení. Když ho nevyplní, ukáže se
// obecný název — v kódu žádná konkrétní jména nejsou.
export function popisUctu(k, ktery) {
  const p = k && (ktery === "A" ? k.popisA : k.popisB);
  return (p && String(p).trim()) || (ktery === "A" ? "účet 1" : "účet 2");
}

export function zustatekCelkem(k) {
  if (!k) return 0;
  const soucet = cislo(k.ucetA) + cislo(k.ucetB);
  return soucet || cislo(k.zustatek);
}

export const MESICE_CZ = [
  "leden", "únor", "březen", "duben", "květen", "červen",
  "červenec", "srpen", "září", "říjen", "listopad", "prosinec",
];

export function mesicNazev(klic) {
  if (!klic) return "";
  const [r, m] = klic.split("-");
  return MESICE_CZ[Number(m) - 1] + " " + r;
}

export function hodinyCelkem(h) {
  return Object.values(h || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}
