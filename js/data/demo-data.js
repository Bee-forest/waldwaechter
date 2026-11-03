// DEMO-DATEN – frei erfunden, nur für Entwicklung und Vorführung.
// Lage: Raum Manebach/Kammerberg (Ilmenau, Thüringer Wald). Die Geometrien
// sind NICHT die echten ALKIS-Flurstücke. Für den Echtbetrieb wird diese Datei
// durch einen Datenadapter (WFS/ALKIS, Rettungspunkte, Baumartenkarte) ersetzt.

import { makeProjector } from '../geo.js';

const ORIGIN = [50.6745, 10.8585];
const P = makeProjector(ORIGIN);

// deterministischer Zufall, damit die Demo bei jedem Start gleich aussieht
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const jitter = (m) => (rnd() - 0.5) * 2 * m;

const COLS = 5, ROWS = 3, CW = 230, CH = 170;
const V = [];
for (let r = 0; r <= ROWS; r++) {
  V[r] = [];
  for (let c = 0; c <= COLS; c++) {
    const edge = r === 0 || r === ROWS || c === 0 || c === COLS;
    const x = (c - COLS / 2) * CW + jitter(edge ? 12 : 30);
    const y = (ROWS / 2 - r) * CH + jitter(edge ? 12 : 30);
    V[r][c] = P.toLatLng([x, y]);
  }
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Nutzung, Gemarkung und Besonderheiten je Zelle
const LAYOUT = [
  ['Wald', 'Wald', 'Wald', 'Landwirtschaft', 'Landwirtschaft'],
  ['Wald', 'Wald', 'Gewässer', 'Landwirtschaft', 'Gebäude'],
  ['Wald', 'Wald', 'Wald', 'Wald', 'Gebäude'],
];

const STANDORTE = [
  'Mittelgebirge, Hanglage NO, ziemlich frisch, mittlere Nährkraft (M2)',
  'Mittelgebirge, Oberhang S, mäßig frisch, ziemlich arm (Z2)',
  'Bachaue, grundfeucht, kräftig (K1)',
  'Hochfläche, frisch, mittlere Nährkraft (M2)',
];

const STAND_TYPES = [
  { species: 'Fichte', mix: 'Buche', mixShare: 15, age: 45, dg: 24, n: 1100, label: 'Fichten-Stangenholz mit Buche' },
  { species: 'Buche', mix: 'Bergahorn', mixShare: 20, age: 60, dg: 28, n: 650, label: 'Buchen-Baumholz' },
  { species: 'Kiefer', mix: 'Birke', mixShare: 10, age: 38, dg: 19, n: 1300, label: 'Kiefern-Stangenholz' },
  { species: 'Fichte', mix: 'Lärche', mixShare: 20, age: 32, dg: 17, n: 1600, label: 'Fichte/Lärche, Jungbestand' },
  { species: 'Douglasie', mix: null, mixShare: 0, age: 40, dg: 27, n: 800, label: 'Douglasien-Baumholz' },
];

export const parcels = [];
export const stands = [];
let nr = 101;

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const nw = V[r][c], ne = V[r][c + 1], se = V[r + 1][c + 1], sw = V[r + 1][c];
    const ring = [nw, ne, se, sw];
    const gemarkung = c < 3 ? 'Manebach' : 'Kammerberg';
    const flur = c < 3 ? (r < 2 ? 4 : 5) : 2;
    const num = c === 1 && r === 1 ? `${nr}/2` : String(nr);
    const id = `${gemarkung.slice(0, 2).toLowerCase()}-${flur}-${num.replace('/', '_')}`;
    nr += 1 + Math.floor(rnd() * 3);
    const nutzung = LAYOUT[r][c];
    const center = mid(mid(nw, se), mid(ne, sw));
    const features = [];

    if (r === 0 && c <= 1) {
      features.push({ type: 'nsg', title: 'Naturschutzgebiet „Mittlerer Thüringer Wald“ (Demo)', at: mid(center, nw),
        text: 'Hier gelten besondere Regeln: Holzernte nur außerhalb der Brut- und Setzzeit (1. März bis 31. August) und nach Abstimmung mit der Unteren Naturschutzbehörde.' });
    }
    if (r === 1 && c === 2) {
      features.push({ type: 'biotop', title: 'Gesetzlich geschütztes Biotop: Quellbereich', at: center,
        text: 'Quellen und Quellbäche sind nach § 30 BNatSchG geschützt. Nicht befahren, keine Ablagerung von Kronenmaterial.' });
    }
    if (nutzung === 'Wald' && (c + r) % 2 === 0) {
      features.push({ type: 'waldfunktion', title: r === 2 ? 'Erholungswald' : 'Bodenschutzwald', at: mid(center, se),
        text: r === 2
          ? 'Der Wald dient der Erholung. Wege freihalten und Arbeiten gut sichtbar absperren.'
          : 'Der Wald schützt den Boden am Hang vor Erosion. Kahlschläge vermeiden, Rückegassen hangparallel anlegen.' });
    }
    if (r === 2 && nutzung === 'Wald') {
      // Straßenabschnitt am Südrand → Verkehrssicherungspflicht
      features.push({ type: 'vsp', title: 'Verkehrssicherungspflicht: Kreisstraße', at: mid(sw, se), line: [sw, se],
        text: 'Am markierten Abschnitt grenzt der Wald an eine öffentliche Straße. Bäume entlang der Straße regelmäßig auf Bruchgefahr kontrollieren und die Kontrolle dokumentieren.' });
    }

    parcels.push({
      id, gemarkung, flur, nr: num, gemeinde: 'Ilmenau',
      ortsteil: gemarkung, nutzung, ring,
      standort: nutzung === 'Wald' ? STANDORTE[(r + c) % STANDORTE.length] : nutzung === 'Gewässer' ? STANDORTE[2] : '–',
      features,
    });

    if (nutzung === 'Wald') {
      const mW = mid(nw, sw), mE = mid(ne, se);
      [[nw, ne, mE, mW], [mW, mE, se, sw]].forEach((sring, i) => {
        const t = STAND_TYPES[(r * 2 + c + i) % STAND_TYPES.length];
        stands.push({ id: `${id}-b${i + 1}`, parcelId: id, name: `Abt. ${10 + r * 5 + c}${'ab'[i]}`, ring: sring, ...t });
      });
    }
  }
}

// Rettungspunkte (Demo). Echte Daten: KWF-Rettungspunkte / ThüringenForst.
export const rescuePoints = [
  { id: 'TH-DEMO-101', at: P.toLatLng([-640, 300]), access: 'Waldparkplatz an der L3004, Einfahrt gegenüber Bushaltestelle Manebach Nord. Befestigter Schotterweg.' },
  { id: 'TH-DEMO-102', at: P.toLatLng([-120, 330]), access: 'Kreuzung Forstweg „Hohe Tanne“ / Wanderweg. Von Manebach über Forststraße, 1,2 km bergauf.' },
  { id: 'TH-DEMO-103', at: P.toLatLng([420, 280]), access: 'Feldwegeinmündung an der K21 Richtung Kammerberg, Schranke (Feuerwehrschlüssel).' },
  { id: 'TH-DEMO-104', at: P.toLatLng([-560, -330]), access: 'Holzlagerplatz am Talweg, für LKW befahrbar. Zufahrt über Ortsausgang Manebach Süd.' },
  { id: 'TH-DEMO-105', at: P.toLatLng([150, -320]), access: 'Brücke über den Mühlbach, Forstweg 7. Allradfahrzeug empfohlen.' },
  { id: 'TH-DEMO-106', at: P.toLatLng([660, -260]), access: 'Wendeplatz am Ende der Gemeindestraße „Am Hang“, Kammerberg.' },
];

export const gemarkungen = [...new Set(parcels.map((p) => p.gemarkung))];
export const DEMO_CENTER = ORIGIN;
