// Neue Durchforstungsmethode (Raster-Verfahren für den Privatwald)
// ------------------------------------------------------------------
// Festgelegt (Masterarbeit, Stand 02.11.2026):
//  • Höchstmenge je Jahrzehnt: Laubholz 55, Nadelholz 80 Fm/ha
//    – gilt ab Bestockungsgrad B° ≥ 0,8, darunter linear mit B° sinkend
//  • Nutzungsanteil am Zehnjahreszuwachs: dünn 40 %, mittel 70 %, dick 110 %
//    (starke Bestände bauen Vorrat ab, schwächere bauen Vorrat auf – aber immer Nutzung)
//  • Stärkeklassen für alle Baumarten gleich: dünn 7–25 cm, mittel 25–50 cm, dick > 50 cm
//  • Korrektur über die Grundflächenleitkurve in beide Richtungen
//
// VORLÄUFIG (bitte durch Werte aus der Arbeit ersetzen): Richtwerte für den
// Zuwachs und das mittlere Volumen eines entnommenen Baums. Sie sind hier nur
// gesetzt, damit die App rechnen kann, und in der Oberfläche als Richtwert markiert.

export const BAUMARTEN = {
  nadel: { label: 'Nadelholz', arten: ['Fichte', 'Kiefer', 'Lärche', 'Douglasie', 'Tanne'] },
  laub: { label: 'Laubholz', arten: ['Buche', 'Eiche', 'Ahorn', 'Esche', 'Birke', 'Erle', 'Hainbuche'] },
};

export const HOECHSTMENGE = { nadel: 80, laub: 55 };          // Fm/ha/Jahrzehnt
export const B_GRENZE = 0.8;
export const NUTZUNGSANTEIL = { duenn: 0.4, mittel: 0.7, dick: 1.1 };

export const DIMENSION = {
  duenn: { label: 'dünn', bhd: '7–25 cm', dmin: 7, dmax: 25, umfang: 'Umfang bis ca. 80 cm',
    hint: 'Entnimm vor allem Bedränger der besten Bäume sowie kranke und schlecht geformte Stämme. Die vitalsten, gerade gewachsenen Bäume bleiben stehen.' },
  mittel: { label: 'mittel', bhd: '25–50 cm', dmin: 25, dmax: 50, umfang: 'Umfang ca. 80–160 cm',
    hint: 'Löse die Kronen der besten Bäume frei: Entnimm die ein bis zwei stärksten Bedränger. Unterstand bleibt als Bodenschutz.' },
  dick: { label: 'dick', bhd: 'über 50 cm', dmin: 50, dmax: null, umfang: 'Umfang über 160 cm',
    hint: 'Nutze hiebsreife Bäume einzeln oder in kleinen Gruppen und fördere die Verjüngung. Biotop- und Höhlenbäume erhalten.' },
};

export const KRONENSCHLUSS = [
  { b: 1.1, label: 'gedrängt', text: 'Kronen greifen ineinander, kaum Himmel zu sehen' },
  { b: 1.0, label: 'geschlossen', text: 'Kronen berühren sich überall' },
  { b: 0.9, label: 'fast geschlossen', text: 'vereinzelt kleine Lücken' },
  { b: 0.8, label: 'locker', text: 'Kronen berühren sich nur teilweise' },
  { b: 0.7, label: 'licht', text: 'viele Lücken, Himmel gut sichtbar' },
  { b: 0.6, label: 'räumig', text: 'große Lücken zwischen den Kronen' },
  { b: 0.5, label: 'sehr räumig', text: 'Bäume stehen weitgehend frei' },
];

// Rückfall, wenn kein Alter bekannt ist (sonst Ertragstafel, siehe wuechsigkeit): laufender Zuwachs in Vfm/ha/Jahr
export const ZUWACHS_RICHTWERT = {
  nadel: { schwach: 8, mittel: 11, stark: 15 },
  laub: { schwach: 5, mittel: 7, stark: 9 },
};
// VORLÄUFIGE Richtwerte: mittleres Volumen eines entnommenen Baums (Vfm)
export const BAUMVOLUMEN = {
  nadel: { duenn: 0.25, mittel: 1.0, dick: 2.6 },
  laub: { duenn: 0.2, mittel: 1.0, dick: 2.8 },
};

// Raster: Die Lage der Punkte folgt aus der Methode. Jeder Rasterpunkt steht für eine
// quadratische Zelle; in ihr wird eine feste Zahl Bäume entnommen. Damit gilt
//   Abstand = √(10 000 m² × Bäume je Punkt ÷ Bäume je ha).
// Grundregel ist 1 Baum je Punkt. Würde der Abstand dadurch kürzer als MIN_ABSTAND
// (GPS-Genauigkeit, im Bestand abschreitbar), werden je Punkt mehr Bäume entnommen.
export const MIN_ABSTAND = 10;   // m
export function raster(baeumeHa) {
  if (!(baeumeHa > 0)) return null;
  let jePunkt = 1;
  while (Math.sqrt((10000 * jePunkt) / baeumeHa) < MIN_ABSTAND) jePunkt++;
  const exakt = Math.sqrt((10000 * jePunkt) / baeumeHa);
  const abstand = Math.max(MIN_ABSTAND, Math.round(exakt));   // auf ganze Meter (Schrittmaß)
  return { jePunkt, abstand, exakt, zelleM2: abstand * abstand };
}

export const gruppeVon = (art) => (BAUMARTEN.nadel.arten.includes(art) ? 'nadel' : 'laub');

/**
 * Berechnet den Eingriff nach der neuen Methode.
 * @param {object} p  { art, gruppe, dim, b, zuwachs (Vfm/ha/a), gIst?, gSoll? }
 */
export function berechne(p) {
  const bFaktor = Math.min(1, p.b / B_GRENZE);
  const hoechst = HOECHSTMENGE[p.gruppe] * bFaktor;                   // Fm/ha/Jahrzehnt
  const zuwachs10 = p.zuwachs * 10;                                   // Vfm/ha/Jahrzehnt
  const ausZuwachs = NUTZUNGSANTEIL[p.dim] * zuwachs10;
  let kG = 1;
  if (p.gIst > 0 && p.gSoll > 0) kG = Math.min(1.3, Math.max(0.7, p.gIst / p.gSoll));
  const roh = ausZuwachs * kG;
  const entnahme = Math.min(hoechst, roh);                            // Fm/ha/Jahrzehnt
  const vol = BAUMVOLUMEN[p.gruppe][p.dim];
  const baeumeHa = entnahme / vol;
  const ra = raster(baeumeHa);
  return {
    bFaktor, hoechst, zuwachs10, ausZuwachs, kG, roh, entnahme, vol, baeumeHa, raster: ra,
    begrenzt: roh > hoechst,
    schritte: [
      `Zehnjahreszuwachs: ${fmt(p.zuwachs, 1)} Vfm/ha/Jahr${p.bonitaet ? ` (Ertragstafel, ${p.bonitaet})` : ''} × 10 = ${fmt(zuwachs10)} Vfm/ha`,
      `Nutzungsanteil „${DIMENSION[p.dim].label}“: ${Math.round(NUTZUNGSANTEIL[p.dim] * 100)} % → ${fmt(ausZuwachs)} Fm/ha`,
      kG !== 1 ? `Korrektur Grundflächenleitkurve: × ${fmt(kG, 2)} → ${fmt(roh)} Fm/ha` : null,
      `Höchstmenge ${BAUMARTEN[p.gruppe].label}: ${HOECHSTMENGE[p.gruppe]} Fm/ha${bFaktor < 1 ? ` × ${fmt(bFaktor, 2)} (B° ${fmt(p.b, 1)} < 0,8) = ${fmt(hoechst)} Fm/ha` : ''}`,
      `Eingriff: ${fmt(entnahme)} Fm/ha${roh > hoechst ? ' (durch Höchstmenge begrenzt)' : ''}`,
      `÷ ${fmt(vol, 2)} Fm je Baum (Richtwert ${DIMENSION[p.dim].label}) ≈ ${Math.round(baeumeHa)} Bäume/ha`,
      ra ? `Raster: √(10 000 m² × ${ra.jePunkt} ${ra.jePunkt > 1 ? 'Bäume' : 'Baum'} je Punkt ÷ ${Math.round(baeumeHa)} Bäume/ha) = ${fmt(ra.exakt, 1)} m → ${ra.abstand} × ${ra.abstand} m${ra.jePunkt > 1 ? ` (mindestens ${MIN_ABSTAND} m Abstand, daher ${ra.jePunkt} Bäume je Punkt)` : ''}` : null,
    ].filter(Boolean),
  };
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
