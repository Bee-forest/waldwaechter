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
  dick: { label: 'dick', viele: 'Viele Dicke', baum: 'Dicker Baum', baeume: 'Dicke Bäume', bhd: 'über 50 cm', dmin: 50, dmax: null, umfang: 'Umfang über 160 cm' },
  mittel: { label: 'mittel', viele: 'Viele Mittlere', baum: 'Mittlerer Baum', baeume: 'Mittlere Bäume', bhd: '25–50 cm', dmin: 25, dmax: 50, umfang: 'Umfang ca. 80–160 cm' },
  duenn: { label: 'dünn', viele: 'Viele Dünne', baum: 'Dünner Baum', baeume: 'Dünne Bäume', bhd: '7–25 cm', dmin: 7, dmax: 25, umfang: 'Umfang bis ca. 80 cm' },
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

/** Bruchteil r als k/d mit kleinem Nenner (d ≤ 24) */
function bruch(r) {
  for (let d = 1; d <= 24; d++) { const k = Math.round(r * d); if (Math.abs(r * d - k) < 1e-6) return [k, d]; }
  return [Math.round(r * 24), 24];
}
const ZEICHEN = { '1/2': '½', '1/4': '¼', '3/4': '¾', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞', '1/3': '⅓', '2/3': '⅔' };
/** Bruchteil als Geländeregel: 0,125 → „⅛“, 1,5 → „1½“, 0,0625 → „1/16“ */
export function anteilText(v) {
  if (!v) return '0';
  const g = Math.floor(v + 1e-9), r = v - g;
  if (r < 1e-6) return String(g);
  const [k, d] = bruch(r);
  const fr = ZEICHEN[`${k}/${d}`] || `${k}/${d}`;
  return g ? `${g}${ZEICHEN[`${k}/${d}`] ? '' : ' '}${fr}` : fr;
}
/** Bruchteil als Satz: 0,125 → „1 Baum an jedem 8. Punkt“, 1,5 → „1 Baum an jedem Punkt, an jedem 2. Punkt 2“ */
export function anteilSatz(v) {
  if (!v) return null;
  const g = Math.floor(v + 1e-9), r = v - g;
  const baum = (n) => (n === 1 ? '1 Baum' : `${n} Bäume`);
  if (r < 1e-6) return `${baum(g)} an jedem Punkt`;
  const [k, d] = bruch(r);
  const rest = k === 1 ? `an jedem ${d}. Punkt ${g ? g + 1 : '1 Baum'}` : `zusammen ${baum(k)} zusätzlich je ${d} Punkte`;
  return g ? `${baum(g)} an jedem Punkt, ${rest}` : (k === 1 ? `1 Baum an jedem ${d}. Punkt` : `${baum(k)} je ${d} Punkte (die App sagt, an welchen)`);
}
/** Bäume am i-ten Punkt (1-basiert, fortlaufend gezählt) bei durchschnittlich v je Punkt */
export const amPunkt = (v, i) => Math.floor(i * v + 1e-9) - Math.floor((i - 1) * v + 1e-9);

// Höchstens 50 Fm/ha je Eingriff. Unter 40 Fm/ha Entnahme im Jahrzehnt ein Eingriff, sonst zwei
// (bzw. so viele, dass je Eingriff höchstens 50 Fm/ha anfallen).
export const MAX_FM_EINGRIFF = 50;
export const EIN_EINGRIFF_BIS = 40;
// Entnahmemenge im Jahrzehnt (Fm/ha) aus der Simulation der Methode an 3.500 Beständen
// (Entnahme_Baumzahlen_NEU.xlsx): je Gruppe × Oberhöhe × B° × Szenario [V, Bestände],
// bei wenigen Beständen Rückfall auf Gruppe × B° × Szenario.
export const ENTNAHME_V = {"buche":{"u25":{"u05":{"2":[6.5,2],"3":[4,39]},"0.5":{"1":[7.4,1],"2":[7.8,1],"3":[9.3,27]},"0.6":{"3":[18.6,43]},"0.7":{"3":[17.6,22]},"0.8":{"3":[21.4,18]},"0.9":{"2":[23.9,1],"3":[29.7,18]},"1.0":{"3":[25.7,13]},"1.1":{"2":[43.4,1],"3":[25.8,9]},"ab12":{"3":[35.5,7]}},"25_30":{"u05":{"1":[7.2,11],"2":[5.7,48],"3":[2.9,34]},"0.5":{"1":[11.2,13],"2":[11,25],"3":[8.5,24]},"0.6":{"1":[25.1,5],"2":[19.5,28],"3":[11.5,17]},"0.7":{"1":[14.7,7],"2":[20.5,24],"3":[11.8,39]},"0.8":{"1":[28.5,2],"2":[28.7,10],"3":[23.8,5]},"0.9":{"1":[34.2,1],"2":[31.5,7],"3":[26.2,12]},"1.0":{"1":[46,2],"2":[50.7,5],"3":[40.1,7]},"1.1":{"1":[49.8,2],"2":[51.2,7],"3":[47.2,14]},"ab12":{"1":[47.4,1],"2":[49,6],"3":[34.9,4]}},"ab30":{"u05":{"1":[16.1,87],"2":[11.9,33],"3":[9.3,3]},"0.5":{"1":[31.2,50],"2":[25.2,24],"3":[8.8,2]},"0.6":{"1":[42.3,47],"2":[27.3,35],"3":[17.1,3]},"0.7":{"1":[44.1,76],"2":[34.9,52],"3":[29.3,6]},"0.8":{"1":[52.5,13],"2":[42.8,20]},"0.9":{"1":[51.1,32],"2":[43.9,24],"3":[19.5,2]},"1.0":{"1":[59,31],"2":[46.3,20],"3":[14.5,3]},"1.1":{"1":[63.9,24],"2":[47.4,17],"3":[17.2,6]},"ab12":{"1":[58.5,34],"2":[47,13],"3":[10.4,4]}}},"eiche":{"u25":{"u05":{"2":[4.7,8],"3":[3,44]},"0.5":{"2":[4.8,6],"3":[2.7,14]},"0.6":{"1":[17.3,1],"2":[9.2,5],"3":[9.8,22]},"0.7":{"3":[9.6,20]},"0.8":{"2":[19.4,1],"3":[8.2,6]},"0.9":{"1":[22,2],"2":[5.4,1],"3":[19.7,12]},"1.0":{"3":[24.8,14]},"1.1":{"2":[41,2],"3":[29.4,7]},"ab12":{"3":[29.7,5]}},"25_30":{"u05":{"1":[9.5,29],"2":[7,28],"3":[3.1,11]},"0.5":{"1":[12.7,9],"2":[13.3,19],"3":[6.5,6]},"0.6":{"1":[14.8,17],"2":[11.7,31],"3":[7.6,6]},"0.7":{"1":[23.4,11],"2":[26.1,17],"3":[8.6,6]},"0.8":{"1":[49,3],"2":[34.3,11],"3":[11.4,2]},"0.9":{"1":[30.8,6],"2":[38.2,11],"3":[16.5,5]},"1.0":{"1":[46.5,7],"2":[43.7,11],"3":[16.4,3]},"1.1":{"1":[58.5,4],"2":[58.1,3],"3":[49,3]},"ab12":{"1":[65,1],"2":[83.5,1],"3":[34.4,1]}},"ab30":{"u05":{"1":[10.9,33],"2":[12.8,2]},"0.5":{"1":[10.5,15],"2":[9.8,2]},"0.6":{"1":[16.8,23],"2":[12.2,4],"3":[7,1]},"0.7":{"1":[22.6,33],"2":[18.4,4]},"0.8":{"1":[31.5,12],"2":[26.5,7]},"0.9":{"1":[42.7,23],"2":[32.1,4]},"1.0":{"1":[48.5,17],"2":[19.4,3],"3":[13.4,1]},"1.1":{"1":[64.9,11],"3":[25.9,1]},"ab12":{"1":[42.4,7],"2":[54.2,1]}}},"fichte":{"u25":{"u05":{"3":[10.6,86]},"0.5":{"3":[11.5,9]},"0.6":{"3":[27.1,51]},"0.7":{"3":[25.3,26]},"0.8":{"3":[25.7,24]},"0.9":{"3":[35.9,25]},"1.0":{"3":[36.4,10]},"1.1":{"3":[41.2,5]},"ab12":{"3":[35.2,5]}},"25_30":{"u05":{"1":[8.9,3],"2":[9.7,19],"3":[8.7,15]},"0.5":{"1":[10.5,1],"2":[11.2,9],"3":[9.6,7]},"0.6":{"2":[26.6,10],"3":[23.6,12]},"0.7":{"2":[26.2,12],"3":[25.7,19]},"0.8":{"2":[48.5,4],"3":[48.4,5]},"0.9":{"2":[44.9,4],"3":[44.7,6]},"1.0":{"2":[65,3],"3":[60.2,8]},"1.1":{"2":[67.5,1],"3":[63.5,5]},"ab12":{"2":[56,2],"3":[57.2,8]}},"ab30":{"u05":{"1":[14.8,27],"2":[13.2,58],"3":[8.1,5]},"0.5":{"1":[29.6,8],"2":[26.5,33],"3":[14.5,4]},"0.6":{"1":[35.1,18],"2":[35.3,47],"3":[21.7,10]},"0.7":{"1":[47.4,17],"2":[39.5,49],"3":[15.9,8]},"0.8":{"1":[77,14],"2":[64.3,29],"3":[30.5,3]},"0.9":{"1":[78.3,16],"2":[64.9,29],"3":[41.8,6]},"1.0":{"1":[79.4,5],"2":[70.7,13],"3":[71.1,4]},"1.1":{"1":[89,6],"2":[76.9,24],"3":[51.8,6]},"ab12":{"1":[89.1,2],"2":[79.7,16]}}},"kiefer":{"u25":{"u05":{"2":[4.2,21],"3":[2.3,34]},"0.5":{"1":[9.1,2],"2":[9.8,8],"3":[9.2,15]},"0.6":{"1":[11.6,4],"2":[6.5,10],"3":[8.3,37]},"0.7":{"1":[11.3,1],"2":[14.4,4],"3":[9.5,22]},"0.8":{"1":[9.4,1],"2":[17.8,4],"3":[14.3,4]},"0.9":{"1":[17.1,2],"2":[20.8,8],"3":[21,21]},"1.0":{"2":[39.7,5],"3":[23.3,15]},"1.1":{"2":[46.3,3],"3":[34.4,14]},"ab12":{"3":[21.9,8]}},"25_30":{"u05":{"1":[8.3,3],"2":[4.5,17],"3":[2.3,6]},"0.5":{"1":[8.9,5],"2":[8.1,17],"3":[6.5,4]},"0.6":{"1":[17.2,4],"2":[23,12],"3":[11.1,1]},"0.7":{"1":[21.5,3],"2":[19.3,19],"3":[12.8,13]},"0.8":{"1":[20.4,2],"2":[23.9,8],"3":[25.9,2]},"0.9":{"2":[32.1,8],"3":[17.8,5]},"1.0":{"1":[27.1,5],"2":[35.3,8],"3":[27,3]},"1.1":{"1":[77.3,2],"2":[48.6,6],"3":[60.1,4]},"ab12":{"2":[70.7,6],"3":[76.3,9]}},"ab30":{"u05":{"1":[6.8,46],"2":[5.6,5]},"0.5":{"1":[15.3,49],"2":[11.6,7]},"0.6":{"1":[28.3,38],"2":[22.3,5]},"0.7":{"1":[36,72],"2":[23.1,15]},"0.8":{"2":[24,2]},"0.9":{"1":[50.6,6],"2":[38.7,8]},"1.0":{"1":[59.8,29],"2":[79.2,2]},"1.1":{"1":[71.5,20],"2":[80.3,8],"3":[59,2]},"ab12":{"1":[62.8,56],"2":[65.2,5]}}}};
export const ENTNAHME_V_OHNE_HOEHE = {"buche":{"u05":{"1":[15.1,98],"2":[8.2,83],"3":[3.7,76]},"0.5":{"1":[26.8,64],"2":[17.7,50],"3":[9,53]},"0.6":{"1":[40.6,52],"2":[23.8,63],"3":[16.7,63]},"0.7":{"1":[41.6,83],"2":[30.3,76],"3":[15.3,67]},"0.8":{"1":[49.3,15],"2":[38.1,30],"3":[21.9,23]},"0.9":{"1":[50.5,33],"2":[40.6,32],"3":[27.7,32]},"1.0":{"1":[58.2,33],"2":[47.1,25],"3":[28.6,23]},"1.1":{"1":[62.8,26],"2":[48.3,25],"3":[34.4,29]},"ab12":{"1":[58.2,35],"2":[47.6,19],"3":[28.7,15]}},"eiche":{"u05":{"1":[10.3,62],"2":[6.9,38],"3":[3,55]},"0.5":{"1":[11.3,24],"2":[11.2,27],"3":[3.9,20]},"0.6":{"1":[16,41],"2":[11.5,40],"3":[9.3,29]},"0.7":{"1":[22.8,44],"2":[24.7,21],"3":[9.3,26]},"0.8":{"1":[35,15],"2":[30.6,19],"3":[9,8]},"0.9":{"1":[39.1,31],"2":[34.6,16],"3":[18.8,17]},"1.0":{"1":[47.9,24],"2":[38.5,14],"3":[22.8,18]},"1.1":{"1":[63.2,15],"2":[51.3,5],"3":[34.4,11]},"ab12":{"1":[45.2,8],"2":[68.9,2],"3":[30.5,6]}},"fichte":{"u05":{"1":[14.2,30],"2":[12.3,77],"3":[10.2,106]},"0.5":{"1":[27.5,9],"2":[23.2,42],"3":[11.4,20]},"0.6":{"1":[35.1,18],"2":[33.8,57],"3":[25.8,73]},"0.7":{"1":[47.4,17],"2":[36.9,61],"3":[24,53]},"0.8":{"1":[77,14],"2":[62.4,33],"3":[29.7,32]},"0.9":{"1":[78.3,16],"2":[62.4,33],"3":[38.3,37]},"1.0":{"1":[79.4,5],"2":[69.7,16],"3":[51.3,22]},"1.1":{"1":[89,6],"2":[76.5,25],"3":[52.1,16]},"ab12":{"1":[89.1,2],"2":[77.1,18],"3":[48.7,13]}},"kiefer":{"u05":{"1":[6.9,49],"2":[4.5,43],"3":[2.3,40]},"0.5":{"1":[14.5,56],"2":[9.3,32],"3":[8.6,19]},"0.6":{"1":[25.9,46],"2":[16.8,27],"3":[8.3,38]},"0.7":{"1":[35.1,76],"2":[20.3,38],"3":[10.8,35]},"0.8":{"1":[16.7,3],"2":[22.2,14],"3":[18.2,6]},"0.9":{"1":[42.2,8],"2":[30.5,24],"3":[20.4,26]},"1.0":{"1":[55,34],"2":[42.6,15],"3":[23.9,18]},"1.1":{"1":[72,22],"2":[63.1,17],"3":[42,20]},"ab12":{"1":[62.8,56],"2":[68.2,11],"3":[50.7,17]}}};
const B_STUFEN = ['u05', '0.5', '0.6', '0.7', '0.8', '0.9', '1.0', '1.1', 'ab12'];
export function entnahmeV(g, hoKlasse, bs, sz) {
  const z = String(sz);
  const mitH = ENTNAHME_V[g]?.[hoKlasse]?.[bs]?.[z];
  if (mitH && mitH[1] >= 5) return { v: mitH[0], n: mitH[1], quelle: 'Gruppe, Oberhöhe, B° und Szenario' };
  const ohne = ENTNAHME_V_OHNE_HOEHE[g]?.[bs]?.[z];
  if (ohne) return { v: ohne[0], n: ohne[1], quelle: 'Gruppe, B° und Szenario' };
  // nächstgelegene B°-Stufe
  const i = B_STUFEN.indexOf(bs);
  for (let d = 1; d < B_STUFEN.length; d++) for (const j of [i - d, i + d]) {
    const c = ENTNAHME_V_OHNE_HOEHE[g]?.[B_STUFEN[j]]?.[z];
    if (c) return { v: c[0], n: c[1], quelle: `Gruppe, B° ${B_STUFEN[j]} und Szenario (nächste Stufe)` };
  }
  return null;
}
export function eingriffsplan(vZehn, stufe) {
  const anzahl = vZehn < EIN_EINGRIFF_BIS ? 1 : Math.max(2, Math.ceil(vZehn / MAX_FM_EINGRIFF));
  return { anzahl, vZehn, vEingriff: vZehn / anzahl, gEingriff: stufe / anzahl, abstandJahre: Math.round(10 / anzahl) };
}

/** Eingriff nach der Methode */
export function bestimme({ art, dim, b, hoKlasse, ho }) {
  const g = gruppe4(art);
  const bs = bStufe(b);
  const stufe = TABELLE1[g]?.[hoKlasse]?.[bs];
  const sz = SZENARIO[dim];
  const key = String(stufe);
  const [dick10, mittel10, duenn10] = TABELLE2[sz]?.[key] || [0, 0, 0];
  const ev = entnahmeV(g, hoKlasse, bs, sz);
  const ep = eingriffsplan(ev ? ev.v : 0, stufe);
  // Tabelle 2 gilt für das Jahrzehnt; bei mehreren Eingriffen wird sie aufgeteilt
  const dick = dick10 / ep.anzahl, mittel = mittel10 / ep.anzahl, duenn = duenn10 / ep.anzahl;
  const jePunkt = { dick, mittel, duenn };
  const jePunktJahrzehnt = { dick: dick10, mittel: mittel10, duenn: duenn10 };
  const sum = dick + mittel + duenn;
  const hl = HOEHENKLASSEN.find((x) => x.key === hoKlasse)?.label;
  return {
    gruppe: g, gruppeLabel: GRUPPEN[g].label, szenario: sz, stufe, jePunkt, jePunktJahrzehnt, eingriffe: { ...ep, quelle: ev?.quelle, bestaende: ev?.n }, baeumeJePunkt: sum,
    baeumeHa: sum * 10000 / (RASTER_M * RASTER_M),
    regel: ['dick', 'mittel', 'duenn'].filter((k) => jePunkt[k] > 1e-9).map((k) => `${anteilText(jePunkt[k])} ${DIMENSION[k].label}`).join(' + '),
    schritte: [
      `Baumartengruppe: ${GRUPPEN[g].label} (Hauptbaumart ${art})`,
      `Oberhöhe ${hl}, Bestockungsgrad B° ${bLabel(b)}`,
      `Tabelle 1 → Eingriffsstufe: Ziel-Entnahme ${fmt(stufe, 1)} m²/ha Grundfläche im Jahrzehnt`,
      `Szenario ${sz}: ${SZENARIO_TEXT[sz]}`,
      `Tabelle 2 → je Punkt im Jahrzehnt: ${['dick', 'mittel', 'duenn'].filter((k) => jePunktJahrzehnt[k] > 0).map((k) => `${DIMENSION[k].label} ${anteilText(jePunktJahrzehnt[k])}`).join(', ')}`,
      ev ? `Entnahmemenge im Jahrzehnt: ca. ${fmt(ep.vZehn)} Fm/ha (Simulation der Methode, Mittel aus ${ev.n} Beständen nach ${ev.quelle})` : 'Entnahmemenge im Jahrzehnt: keine Simulationswerte für diese Kombination',
      ep.anzahl === 1
        ? `Unter ${EIN_EINGRIFF_BIS} Fm/ha Entnahme im Jahrzehnt → 1 Eingriff`
        : `${fmt(ep.vZehn)} Fm/ha im Jahrzehnt → ${ep.anzahl} Eingriffe à ca. ${fmt(ep.vEingriff)} Fm/ha (höchstens ${MAX_FM_EINGRIFF} Fm/ha je Eingriff), etwa alle ${ep.abstandJahre} Jahre`,
      ep.anzahl > 1 ? `Je Eingriff ein Teil der Bäume aus Tabelle 2: ${['dick', 'mittel', 'duenn'].filter((k) => jePunkt[k] > 0).map((k) => `${DIMENSION[k].label} ${anteilText(jePunktJahrzehnt[k])} ÷ ${ep.anzahl} = ${anteilText(jePunkt[k])}`).join(', ')}` : null,
      `Raster ${RASTER_M} m (16 Punkte/ha), jedes Mal zufällig neu über den Bestand gelegt → ca. ${Math.round(sum * 16)} Bäume/ha je Eingriff`,
    ].filter(Boolean),
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
