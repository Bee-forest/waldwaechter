// Neue Durchforstungsmethode (Raster-Verfahren für den Privatwald, Stand 03.11.2026)
// ------------------------------------------------------------------------------
// Quelle: Herleitung_NEU.xlsx / „Neue Durchforstungsmethode – alle Werte und ihre Herleitung“.
// Im Gelände entscheiden vier Größen:
//   Baumartengruppe der Hauptbaumart · Oberhöhe hₒ · Bestockungsgrad B° · Szenario
// Tabelle 1 (Gruppe × Oberhöhe × B°) → Eingriffsstufe (Ziel-Entnahme Grundfläche, m²/ha)
// Tabelle 2 (Szenario × Stufe)       → Bäume je Entnahmepunkt nach Stärkeklasse
// Feste Parameter: Raster 25 m (16 Punkte/ha), Entnahmekreis ca. 10 m, Ausweichen bis 15 m,
// Schlangenlinien mit Start 10–15 m vom Rand, „in jedem n-ten Punkt“ fortlaufend mitzählen.
// Hinter den Tabellen steht die Zielregel (Ertragstafel-Zuwachs, Nutzungsanteile 1,1/0,7/0,4,
// Grundflächenleitkurve FA_035 in beide Richtungen, Höchstmenge 80/55 m³/ha × min(1; B°/0,8)).

export const BAUMARTEN = {
  nadel: { label: 'Nadelholz', arten: ['Fichte', 'Kiefer', 'Lärche', 'Douglasie', 'Tanne'] },
  laub: { label: 'Laubholz', arten: ['Buche', 'Eiche', 'Ahorn', 'Esche', 'Birke', 'Erle', 'Hainbuche'] },
};
export const HOECHSTMENGE = { nadel: 80, laub: 55 };          // m³/ha/Jahrzehnt (in die Tabellen eingerechnet)
export const gruppeVon = (art) => (BAUMARTEN.nadel.arten.includes(art) ? 'nadel' : 'laub');

// Baumartengruppen der Methode (nach Leitkurve und Höchstmenge)
export const GRUPPEN = {
  fichte: { label: 'Fichte, Tanne, Douglasie', arten: ['Fichte', 'Tanne', 'Douglasie'] },
  kiefer: { label: 'Kiefer, Lärche', arten: ['Kiefer', 'Lärche'] },
  buche: { label: 'Buche, Edel- und sonstiges Laubholz', arten: ['Buche', 'Ahorn', 'Esche', 'Birke', 'Erle', 'Hainbuche'] },
  eiche: { label: 'Eiche', arten: ['Eiche'] },
};
export const gruppe4 = (art) => Object.keys(GRUPPEN).find((g) => GRUPPEN[g].arten.includes(art)) || 'buche';

// Stärkeklassen (BHD), für alle Baumarten gleich
export const DIMENSION = {
  dick: { label: 'dick', bhd: 'über 50 cm', dmin: 50, dmax: null, umfang: 'Umfang über 160 cm' },
  mittel: { label: 'mittel', bhd: '25–50 cm', dmin: 25, dmax: 50, umfang: 'Umfang ca. 80–160 cm' },
  duenn: { label: 'dünn', bhd: '7–25 cm', dmin: 7, dmax: 25, umfang: 'Umfang bis ca. 80 cm' },
};
// Szenario = Schwerpunkt der Stammzahl (≥ 40 % der Stämme und ≥ 10 Prozentpunkte Vorsprung)
export const SZENARIO = { dick: 1, mittel: 2, duenn: 3 };
export const SZENARIO_TEXT = { 1: 'viele dicke (Entnahme dick + mittel)', 2: 'viele mittlere (Entnahme mittel + dick)', 3: 'viele dünne (Entnahme dünn + mittel)' };

// Bestockungsgrad in Stufen von 0,1; unter 0,5 und ab 1,2 zusammengefasst
export const KRONENSCHLUSS = [
  { b: 1.2, label: 'sehr gedrängt', text: 'Kronen bedrängen sich stark, kein Himmel zu sehen (B° ab 1,2)' },
  { b: 1.1, label: 'gedrängt', text: 'Kronen greifen ineinander, kaum Himmel zu sehen' },
  { b: 1.0, label: 'geschlossen', text: 'Kronen berühren sich überall' },
  { b: 0.9, label: 'fast geschlossen', text: 'vereinzelt kleine Lücken' },
  { b: 0.8, label: 'locker', text: 'Kronen berühren sich nur teilweise' },
  { b: 0.7, label: 'licht', text: 'viele Lücken, Himmel gut sichtbar' },
  { b: 0.6, label: 'räumig', text: 'große Lücken zwischen den Kronen' },
  { b: 0.5, label: 'sehr räumig', text: 'Bäume stehen weitgehend frei' },
  { b: 0.4, label: 'lückig', text: 'mehr Lücke als Krone (B° unter 0,5)' },
];
export const bStufe = (b) => (b < 0.5 ? 'u05' : b >= 1.2 ? 'ab12' : (Math.floor(b * 10 + 1e-6) / 10).toFixed(1));
export const bLabel = (b) => (b < 0.5 ? 'unter 0,5' : b >= 1.2 ? 'ab 1,2' : fmt(b, 1));

// Oberhöhe in drei Klassen
export const HOEHENKLASSEN = [
  { key: 'u25', label: 'unter 25 m', text: 'jüngere oder schwächer wüchsige Bestände' },
  { key: '25_30', label: '25–30 m', text: 'mittelalte Bestände' },
  { key: 'ab30', label: 'ab 30 m', text: 'hohe, ältere Bestände' },
];
export const hoeheKlasse = (ho) => (ho < 25 ? 'u25' : ho < 30 ? '25_30' : 'ab30');

// Tabelle 1 – Eingriffsstufe (Ziel-Entnahme Grundfläche in m²/ha je Jahrzehnt)
export const TABELLE1 = {"fichte":{"u25":{"u05":1,"0.5":1,"0.6":3,"0.7":3,"0.8":5,"0.9":7,"1.0":7,"1.1":7,"ab12":7},"25_30":{"u05":1,"0.5":1,"0.6":2.5,"0.7":2.5,"0.8":4,"0.9":4,"1.0":5,"1.1":5,"ab12":6},"ab30":{"u05":1,"0.5":2,"0.6":2.5,"0.7":3,"0.8":4,"0.9":4,"1.0":5,"1.1":5,"ab12":5}},"kiefer":{"u25":{"u05":0.5,"0.5":1,"0.6":1,"0.7":1.5,"0.8":2,"0.9":3,"1.0":4,"1.1":5,"ab12":5},"25_30":{"u05":0.5,"0.5":1,"0.6":2,"0.7":2,"0.8":2,"0.9":3,"1.0":3,"1.1":5,"ab12":7},"ab30":{"u05":0.5,"0.5":1,"0.6":1.5,"0.7":2,"0.8":2,"0.9":3,"1.0":5,"1.1":5,"ab12":5}},"buche":{"u25":{"u05":0.5,"0.5":1,"0.6":2,"0.7":2,"0.8":3,"0.9":3,"1.0":5,"1.1":5,"ab12":5},"25_30":{"u05":0.5,"0.5":1,"0.6":1.5,"0.7":1.5,"0.8":3,"0.9":3,"1.0":4,"1.1":4,"ab12":4},"ab30":{"u05":1,"0.5":2,"0.6":2,"0.7":2.5,"0.8":3,"0.9":3,"1.0":3,"1.1":3,"ab12":3}},"eiche":{"u25":{"u05":0.5,"0.5":0.5,"0.6":1,"0.7":1.5,"0.8":1.5,"0.9":2,"1.0":3,"1.1":4,"ab12":4},"25_30":{"u05":0.5,"0.5":1,"0.6":1,"0.7":1.5,"0.8":2.5,"0.9":2.5,"1.0":3,"1.1":4,"ab12":4},"ab30":{"u05":0.5,"0.5":0.5,"0.6":1,"0.7":1,"0.8":2,"0.9":2,"1.0":2,"1.1":2.5,"ab12":2.5}}};
// Tabelle 2 – Bäume je Entnahmepunkt [dick, mittel, dünn]; Bruchteile = „in jedem n-ten Punkt“
export const TABELLE2 = {"1":{"0.5":[0.125,0,0],"1":[0.125,0.25,0],"1.5":[0.125,0.5,0],"2":[0.25,0.5,0],"2.5":[0.125,1.0,0],"3":[0.25,1.0,0],"4":[0.5,1.0,0],"5":[1.0,0,0],"6":[1.0,0.5,0],"7":[1.0,1.0,0],"8":[1.5,0.5,0]},"2":{"0.5":[0,0.25,0],"1":[0,0.5,0],"1.5":[0,1.0,0],"2":[0,1.0,0],"2.5":[0,1.5,0],"3":[0.125,1.5,0],"4":[0,2.5,0],"5":[0,3.0,0],"6":[0.125,3.0,0],"7":[0,4.0,0],"8":[0.25,4.0,0]},"3":{"0.5":[0,0,1.0],"1":[0,0,3.0],"1.5":[0,0,4.0],"2":[0,0,6.0],"2.5":[0,0.25,6.0],"3":[0,0,8.0],"4":[0,1.0,8.0],"5":[0,2.0,8.0],"6":[0,2.0,8.0],"7":[0,3.0,8.0],"8":[0,3.0,8.0]}};

// Feste Verfahrensparameter
export const RASTER_M = 25;          // m, 16 Punkte/ha
export const RAND_M = 12.5;          // Start 10–15 m vom Rand
export const KREIS_M = 10;           // Entnahmekreis
export const AUSWEICHEN_M = 15;      // höchstens so weit ausweichen
export const RANG = ['Fichte', 'Lärche', 'Buche', 'Kiefer', 'Eiche'];
export const AUSWAHL_TEXT = 'Im Kreis zuerst Fichte nehmen, dann Lärche, Buche, Kiefer, zuletzt Eiche (andere Arten wie Buche). Einen Baum über wertvollem Unterstand bevorzugen, sonst den nächststehenden. Steht kein passender Baum im Kreis, bis 15 m ausweichen. Gibt es auch dort keinen Baum der verlangten Stärkeklasse, den Baum entnehmen, der ihr am ähnlichsten ist (Durchmesser am nächsten an der Klasse).';
export const AUSWEICH_TEXT = 'Kein Baum der verlangten Stärke bis 15 m? Dann den Baum nehmen, der ihr am ähnlichsten ist – also den mit dem Durchmesser, der am nächsten an der Klasse liegt.';
export const QUALITAET_TEXT = 'Vitale, gut geformte Zukunftsbäume stehen lassen; kranke, beschädigte und schlecht geformte Bäume bevorzugt entnehmen. Biotop- und Höhlenbäume erhalten.';

/** Bruchteil als Geländeregel: 0,125 → „⅛“, 1,5 → „1½“ */
export function anteilText(v) {
  if (!v) return '0';
  const g = Math.floor(v + 1e-9), r = v - g;
  const fr = Math.abs(r - 0.125) < 1e-6 ? '⅛' : Math.abs(r - 0.25) < 1e-6 ? '¼' : Math.abs(r - 0.5) < 1e-6 ? '½' : Math.abs(r - 0.75) < 1e-6 ? '¾' : r > 1e-6 ? fmt(r, 2) : '';
  return `${g || ''}${fr}` || '0';
}
/** Bruchteil als Satz: 0,125 → „1 Baum an jedem 8. Punkt“, 1,5 → „1 Baum, an jedem 2. Punkt 2“ */
export function anteilSatz(v) {
  if (!v) return null;
  const g = Math.floor(v + 1e-9), r = v - g;
  const baum = (n) => (n === 1 ? '1 Baum' : `${n} Bäume`);
  if (r < 1e-6) return `${baum(g)} an jedem Punkt`;
  const n = Math.round(1 / r);
  return g ? `${baum(g)} an jedem Punkt, an jedem ${n}. Punkt ${g + 1}` : `1 Baum an jedem ${n}. Punkt`;
}
/** Bäume am i-ten Punkt (1-basiert, fortlaufend gezählt) bei durchschnittlich v je Punkt */
export const amPunkt = (v, i) => Math.floor(i * v + 1e-9) - Math.floor((i - 1) * v + 1e-9);

/** Eingriff nach der Methode */
export function bestimme({ art, dim, b, hoKlasse }) {
  const g = gruppe4(art);
  const bs = bStufe(b);
  const stufe = TABELLE1[g]?.[hoKlasse]?.[bs];
  const sz = SZENARIO[dim];
  const key = String(stufe);
  const [dick, mittel, duenn] = TABELLE2[sz]?.[key] || [0, 0, 0];
  const jePunkt = { dick, mittel, duenn };
  const sum = dick + mittel + duenn;
  const hl = HOEHENKLASSEN.find((x) => x.key === hoKlasse)?.label;
  return {
    gruppe: g, gruppeLabel: GRUPPEN[g].label, szenario: sz, stufe, jePunkt, baeumeJePunkt: sum,
    baeumeHa: sum * 10000 / (RASTER_M * RASTER_M),
    regel: ['dick', 'mittel', 'duenn'].filter((k) => jePunkt[k] > 0).map((k) => `${anteilText(jePunkt[k])} ${DIMENSION[k].label}`).join(' + '),
    schritte: [
      `Baumartengruppe: ${GRUPPEN[g].label} (Hauptbaumart ${art})`,
      `Oberhöhe ${hl}, Bestockungsgrad B° ${bLabel(b)}`,
      `Tabelle 1 → Eingriffsstufe: Ziel-Entnahme ${fmt(stufe, 1)} m²/ha Grundfläche im Jahrzehnt`,
      `Szenario ${sz}: ${SZENARIO_TEXT[sz]}`,
      `Tabelle 2 → je Punkt: ${['dick', 'mittel', 'duenn'].filter((k) => jePunkt[k] > 0).map((k) => `${DIMENSION[k].label} ${anteilText(jePunkt[k])}`).join(', ')}`,
      `Raster ${RASTER_M} m (16 Punkte/ha) → ca. ${Math.round(sum * 16)} Bäume/ha`,
    ],
  };
}

/** Oberhöhe aus dem Alter schätzen (mittlere Bonität der Ertragstafel), falls keine LiDAR-Höhe vorliegt */
export function oberhoeheAusAlter(art, alter) {
  const w = wuechsigkeit(art, alter, null);
  if (!w) return null;
  const mid = w.werte[Math.floor((w.werte.length - 1) / 2)];
  const h = w.werte.length % 2 ? mid.h : (mid.h + w.werte[w.werte.length / 2].h) / 2;
  return w.tafel.hoehe === 'hm' ? h + 1.5 : h;
}

export const fmt = (v, d = 0) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });

// ---------- Wüchsigkeit und Zuwachs aus der Ertragstafel ----------
// Oberhöhe (LiDAR) und Alter → Lage im Bonitätsfächer der Thüringer Ertragstafel → laufender Zuwachs.
import { ERTRAGSTAFELN } from './ertragstafeln.js';

// Baumarten ohne eigene Tafel in der Auswahl: Thüringer Zuordnung (FE-Vorgabe)
const TAFEL_FUER = { Tanne: 'Fichte', Hainbuche: 'Buche', Ahorn: 'Esche' };
// Tafeln ohne Oberhöhe: Mittelhöhe ≈ Oberhöhe − 1,5 m (Näherung, vgl. ho/hg in Kiefern- und Buchentafel)
const HO_MINUS_HM = 1.5;

export function tafelFuer(art) {
  const key = ERTRAGSTAFELN[art] ? art : TAFEL_FUER[art];
  return key ? { art: key, ...ERTRAGSTAFELN[key] } : null;
}

/** Höhe und Zuwachs einer Tafel im Alter t (linear interpoliert, außerhalb der Tafel fortgeschrieben bzw. gehalten) */
function zeile(rows, t) {
  if (t <= rows[0][0]) {
    const [a0, h0, z0] = rows[0], [a1, h1] = rows[1];
    return { h: Math.max(0.5, h0 - ((h1 - h0) / (a1 - a0)) * (a0 - t)), z: z0 };
  }
  const n = rows.length - 1;
  if (t >= rows[n][0]) {
    const [a0, h0] = rows[n - 1], [a1, h1, z1] = rows[n];
    return { h: h1 + ((h1 - h0) / (a1 - a0)) * Math.min(t - a1, 20), z: z1 };
  }
  for (let i = 0; i < n; i++) {
    const [a0, h0, z0] = rows[i], [a1, h1, z1] = rows[i + 1];
    if (t >= a0 && t <= a1) { const f = (t - a0) / (a1 - a0); return { h: h0 + f * (h1 - h0), z: z0 + f * (z1 - z0) }; }
  }
}

/**
 * Wüchsigkeit eines Bestands aus Alter und gemessener Oberhöhe.
 * → { klasse, zuwachs (Vfm/ha/a), bonitaet (Text), lage (0 = beste Tafel … n−1 = schwächste), hTafel, quelle, … }
 */
export function wuechsigkeit(art, alter, oberhoehe) {
  const tafel = tafelFuer(art);
  if (!tafel || !(alter > 0)) return null;
  const werte = tafel.t.map((x) => ({ n: x.n, ...zeile(x.r, alter) })).sort((a, b) => b.h - a.h);
  const mitte = werte[Math.floor((werte.length - 1) / 2)];
  const mitteH = werte.length % 2 ? mitte.h : (mitte.h + werte[werte.length / 2].h) / 2;
  const basis = { tafel, werte, quelle: tafel.quelle, zuwachsArt: tafel.zuwachs, bonName: tafel.bon };
  if (!(oberhoehe > 0)) {
    // ohne Höhenmessung: mittlere Bonität der Tafel
    const z = werte.length % 2 ? mitte.z : (mitte.z + werte[werte.length / 2].z) / 2;
    return { ...basis, klasse: 'mittel', zuwachs: z, bonitaet: `mittlere ${tafel.bon} (angenommen)`, gemessen: false };
  }
  const H = tafel.hoehe === 'hm' ? oberhoehe - HO_MINUS_HM : oberhoehe;
  let lage, z, bonitaet;
  if (H >= werte[0].h) {
    lage = 0; z = werte[0].z; bonitaet = `besser als ${werte[0].n}`;
  } else if (H <= werte[werte.length - 1].h) {
    const w = werte[werte.length - 1];
    lage = werte.length - 1; z = w.z * Math.max(0.3, H / w.h); bonitaet = `schwächer als ${w.n}`;
  } else {
    const i = werte.findIndex((w, k) => w.h >= H && werte[k + 1].h <= H);
    const a = werte[i], b = werte[i + 1], f = (a.h - H) / (a.h - b.h);
    lage = i + f; z = a.z + f * (b.z - a.z);
    const na = Number(a.n.replace(/\D/g, '')), nb = Number(b.n.replace(/\D/g, ''));
    bonitaet = /^\D?\d+$/.test(a.n) && /^\D?\d+$/.test(b.n)
      ? `${a.n.replace(/\d+/, '')}${Math.round(na + f * (nb - na))}`
      : f < 0.25 ? a.n : f > 0.75 ? b.n : `zwischen ${a.n} und ${b.n}`;
  }
  // Klasse nach Lage im Bonitätsfächer: oberes, mittleres, unteres Drittel
  const verhaeltnis = H / mitteH;
  const pos = H > werte[0].h ? -1 : H < werte[werte.length - 1].h ? 2 : lage / (werte.length - 1);
  const klasse = pos < 1 / 3 ? 'stark' : pos > 2 / 3 ? 'schwach' : 'mittel';
  return { ...basis, klasse, zuwachs: z, bonitaet, lage, hTafel: H, hMitte: mitteH, verhaeltnis, gemessen: true, mittelhoehe: tafel.hoehe === 'hm' };
}
