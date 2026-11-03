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

// VORLÄUFIGE Richtwerte: laufender Zuwachs in Vfm/ha/Jahr nach Wuchskraft
export const ZUWACHS_RICHTWERT = {
  nadel: { schwach: 8, mittel: 11, stark: 15 },
  laub: { schwach: 5, mittel: 7, stark: 9 },
};
// VORLÄUFIGE Richtwerte: mittleres Volumen eines entnommenen Baums (Vfm)
export const BAUMVOLUMEN = {
  nadel: { duenn: 0.25, mittel: 1.0, dick: 2.6 },
  laub: { duenn: 0.2, mittel: 1.0, dick: 2.8 },
};

export const RASTER = [
  { m: 15, text: 'enges Raster – für dünne, stammzahlreiche Bestände' },
  { m: 20, text: 'Standard – für die meisten Bestände' },
  { m: 25, text: 'weites Raster – für mittelstarke Bestände' },
  { m: 30, text: 'sehr weit – für starke, stammzahlarme Bestände' },
];
export const rasterVorschlag = (dim) => ({ duenn: 15, mittel: 20, dick: 30 }[dim] || 20);

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
  return {
    bFaktor, hoechst, zuwachs10, ausZuwachs, kG, roh, entnahme, vol, baeumeHa,
    begrenzt: roh > hoechst,
    schritte: [
      `Zehnjahreszuwachs: ${fmt(p.zuwachs)} Vfm/ha/Jahr × 10 = ${fmt(zuwachs10)} Vfm/ha`,
      `Nutzungsanteil „${DIMENSION[p.dim].label}“: ${Math.round(NUTZUNGSANTEIL[p.dim] * 100)} % → ${fmt(ausZuwachs)} Fm/ha`,
      kG !== 1 ? `Korrektur Grundflächenleitkurve: × ${fmt(kG, 2)} → ${fmt(roh)} Fm/ha` : null,
      `Höchstmenge ${BAUMARTEN[p.gruppe].label}: ${HOECHSTMENGE[p.gruppe]} Fm/ha${bFaktor < 1 ? ` × ${fmt(bFaktor, 2)} (B° ${fmt(p.b, 1)} < 0,8) = ${fmt(hoechst)} Fm/ha` : ''}`,
      `Eingriff: ${fmt(entnahme)} Fm/ha${roh > hoechst ? ' (durch Höchstmenge begrenzt)' : ''}`,
      `÷ ${fmt(vol, 2)} Fm je Baum (Richtwert ${DIMENSION[p.dim].label}) ≈ ${Math.round(baeumeHa)} Bäume/ha`,
    ].filter(Boolean),
  };
}

export const fmt = (v, d = 0) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
