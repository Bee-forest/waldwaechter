// Pflanzplanung: Pflanzfläche in der Karte zeichnen oder mit dem GPS umlaufen → Baumarten nach Standort
// (BZT-Tabellenwerk) wählen → Pflanzenzahl nach den Rahmenpflanzverbänden (Richtlinie 2025, Anlage 3) unter
// Abzug der Rückegassen → Pflanzverband je Baumart → Baumarten in der Karte verteilen → Pflanzplanungskarte
// mit Kosten. Danach optional Zaun um die Fläche und Förderantrag.
import { h, fill, openPage, toast, dialog, confirmDialog } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { areaHa, formatHa, centroid, pointInPolygon, polysOf } from './geo.js';
import { miniKarte } from './flaeche.js';
import { umlaufSteuerung, vereinfachen } from './umlauf.js';
import { Pdf, herunterladen } from './pdf.js';
import { kartenBild, KARTEN_QUELLE } from './kartenbild.js';
import { dateiSpeichern } from './dateien.js';
import { pflanzLayout, gassenLinien, rahmen, FORMEN, punkteNahe, streifen, gruppenGroessen } from './pflanzlayout.js';
import { angebote, angebot, sortimentText, angebotText, eigenerPreis, eigenenPreisMerken, vorgabe as preisVorgabe, eigeneBaumarten, eigeneBaumartMerken, WBS_QUELLE } from './pflanzpreise.js';

// ---------- Rahmenpflanzverbände (Richtlinie forstwirtschaftliche Maßnahmen 2025, Anlage 3; Reihenabstand 2,5 m) ----------
export const VERBAND = {
  eiche: { frei: [6000, 10000, 'auf der Freifläche im Seitenschutz'], voranbau: [4000, 6000, 'Voranbau im Wesentlichen unter Kiefer'] },
  roteiche: { frei: [4000, 6000], voranbau: [3000, 4000, 'Voranbau'] },
  buche: { frei: [6000, 8000, 'künstliche Verjüngung auf Freiflächen nur in Ausnahmefällen'], voranbau: [6000, 8000, 'Voranbau unter langfristig stabilem Schirm'] },
  elb: { frei: [2500, 3500, 'Pflanzung auf Freifläche mit entsprechender Beimischung'], voranbau: [1500, 2500, 'bei Voranbau in Mischung'] },
  kirsche: { frei: [2000, 3500], voranbau: [2000, 3500] },
  pappel: { frei: [1100, 1600], voranbau: [1100, 1600] },
  linde: { frei: [3500, 4500, 'in gruppenweiser Mischung mit Eiche, Kirsche oder Edellaubholz'], voranbau: [3500, 4500] },
  erle: { frei: [2500, 3500], voranbau: [2500, 3500] },
  sorbus: { frei: [1500, 2000], voranbau: [1500, 2000] },
  fichte: { frei: [2500, 3500, 'Standard-/Normalverband'], voranbau: [2500, 3500] },
  kiefer: { frei: [7000, 10000, 'Hügellandkiefer'], voranbau: [7000, 10000] },
  nadel: { frei: [1500, 2500, 'Standard-/Normalverband; Weißtanne nur unter Schirm bzw. mit Seitenschutz'], voranbau: [1000, 1500, 'für Voranbau'] },
};
const REIHE = 2.5;
// Baumarten: Name (wie im Förderantrag), BZT-Kürzel, Verbandsgruppe, Licht, Mindestgröße einer Mischungsgruppe (ha), Farbe, Hinweis
// buche: Verhalten neben Rotbuche – 'unterlegen' = wird in der Jugend überwachsen, 'mit' = hält mit oder ist vorwüchsig
const A = (name, code, verband, licht, gruppeHa, farbe, hinweis, codes = [], extra = {}) => ({ name, code, codes: code ? [code, ...codes] : [], verband, licht, gruppeHa, farbe, hinweis, ...extra });
const NADEL = { nadel: true };
const FREMD = { fremd: true };
export const PFLANZ_ARTEN = [
  A('Traubeneiche', 'EI', 'eiche', 'licht', 0.3, '#C9A227', 'Lichtbaumart, in der Jugend langsamer als Buche: in Gruppen oder Horsten ab ca. 0,3 ha pflanzen, nicht einzeln zwischen Buche. Dienende Baumarten (Hainbuche, Linde) halten die Stämme astrein. Trockene, mittlere bis reiche Standorte.', [], { buche: 'unterlegen' }),
  A('Stieleiche', 'EI', 'eiche', 'licht', 0.3, '#B08A1E', 'Lichtbaumart für frische bis feuchte, auch wechselfeuchte Standorte. In Gruppen ab ca. 0,3 ha mit dienender Hainbuche oder Linde.', [], { buche: 'unterlegen' }),
  A('Roteiche', 'EI', 'roteiche', 'licht', 0.1, '#B5532E', 'Nicht heimisch, raschwüchsig und trockenheitstolerant; hält in der Jugend mit der Buche mit. Gruppenweise; ausschließlich standortheimische Pflanzung (85 % Förderung) ist dann nicht erfüllt.', [], { buche: 'mit', ...FREMD }),
  A('Rotbuche', 'BU', 'buche', 'schatten', 0, '#2E8B57', 'Schattbaumart, sehr konkurrenzstark – überwächst langsamer wachsende Lichtbaumarten wie Eiche, Elsbeere oder Wildobst. Spätfrost- und hitzeempfindlich: am besten unter Schirm oder mit Seitenschutz.'),
  A('Bergahorn', 'ELB', 'elb', 'halb', 0.05, '#7FB069', 'Raschwüchsig, braucht frische, nährstoffreiche Böden. Trupp- bis gruppenweise beimischen; wächst der Buche in der Jugend davon.', [], { buche: 'mit' }),
  A('Spitzahorn', 'ELB', 'elb', 'halb', 0.05, '#9BC37E', 'Trockenheitstoleranter als Bergahorn, für mittlere bis reiche Standorte. Trupp- bis gruppenweise.', [], { buche: 'mit' }),
  A('Feldahorn', 'ELB', 'elb', 'halb', 0, '#B5D49A', 'Kleinbleibend, wärme- und trockenheitsliebend; gut für Waldränder und als dienende Baumart.', [], { dienend: true }),
  A('Esche', 'ELB', 'elb', 'licht', 0.05, '#5E9A3A', 'Wegen des Eschentriebsterbens nur gering beimischen. Braucht frische bis feuchte, reiche Böden.', [], { buche: 'mit' }),
  A('Bergulme', 'ELB', 'elb', 'halb', 0, '#6B8E23', 'Für frische, reiche Standorte; wegen Ulmensterben nur als Beimischung.', [], { buche: 'mit' }),
  A('Flatterulme', 'ELB', 'elb', 'halb', 0, '#8DA75A', 'Für feuchte Auen- und Bachstandorte; als Beimischung.'),
  A('Hainbuche', 'HBU', 'elb', 'schatten', 0, '#8E5BB5', 'Schattenverträglich, dienende Baumart unter und neben Eiche. Auch für Waldränder.', [], { dienend: true }),
  A('Winterlinde', 'LI', 'linde', 'schatten', 0, '#86A86B', 'Schattenverträglich, verbessert den Boden; dienende Baumart zur Eiche, in Gruppen mit Eiche, Kirsche oder Edellaubholz.', ['WLI', 'WLB'], { dienend: true }),
  A('Sommerlinde', 'LI', 'linde', 'schatten', 0, '#A1BE88', 'Wie Winterlinde, etwas anspruchsvoller an Boden und Wasser.', ['WLI'], { dienend: true }),
  A('Vogelkirsche', 'KB', 'kirsche', 'licht', 0, '#C2185B', 'Lichtbaumart, in der Jugend vorwüchsig; Wertholz: einzeln bis truppweise mit Abstand, damit die Krone frei bleibt.', [], { buche: 'mit' }),
  A('Elsbeere', 'EL', 'sorbus', 'licht', 0, '#AD5D2E', 'Wärmeliebend, trockenheitstolerant, wächst langsam; einzeln bis truppweise auf mittleren bis reichen, warmen Standorten, nicht in dichter Buche.', [], { buche: 'unterlegen' }),
  A('Speierling', 'EL', 'sorbus', 'licht', 0, '#C47A47', 'Seltene Wertholzart warmer, trockener Lagen; einzeln oder truppweise, frei von bedrängender Buche.', [], { buche: 'unterlegen' }),
  A('Wildbirne', 'WO', 'kirsche', 'licht', 0, '#9C8AA5', 'Lichtbaumart; einzeln am Rand oder in Lücken.', [], { buche: 'unterlegen' }),
  A('Wildapfel', 'WO', 'kirsche', 'licht', 0, '#B7A3C1', 'Lichtbaumart; einzeln am Rand oder in Lücken.', [], { buche: 'unterlegen' }),
  A('Eberesche', 'EB', 'sorbus', 'licht', 0, '#E07A5F', 'Pionierbaumart, in der Jugend schnell und anspruchslos; als Vorwald oder Beimischung, besonders in kühlen, feuchten Lagen.', ['WLB'], { buche: 'mit' }),
  A('Sandbirke', 'BI', 'erle', 'licht', 0, '#E6D3A3', 'Pionierbaumart: schnell, anspruchslos, kurzlebig. Als Vorwald oder am Rand; kann Hauptbaumarten bedrängen – rechtzeitig entnehmen.', ['WLB'], { buche: 'mit' }),
  A('Aspe', 'AS', 'pappel', 'licht', 0, '#D8C99B', 'Pionierbaumart, wüchsig; als Vorwald oder truppweise.', ['WLB'], { buche: 'mit' }),
  A('Schwarzerle', 'ER', 'erle', 'licht', 0, '#5B7F95', 'Für nasse und quellige Standorte, Bachränder; dort gruppen- bis flächenweise.', [], { buche: 'mit' }),
  A('Esskastanie', '', 'elb', 'licht', 0.05, '#8D6E3F', 'Nicht heimisch, wärmeliebend und raschwüchsig; trupp- bis gruppenweise.', [], { buche: 'mit', ...FREMD }),
  A('Baumhasel', '', 'elb', 'licht', 0, '#A88B5A', 'Nicht heimisch, wärmeliebend und trockenheitstolerant; als Beimischung.', [], FREMD),
  A('Robinie', '', 'elb', 'licht', 0, '#C5B358', 'Nicht heimisch und ausbreitungsstark; nur mit Vorsicht und nicht in Schutzgebieten pflanzen.', [], { buche: 'mit', ...FREMD }),
  A('Weißtanne', 'WTA', 'nadel', 'schatten', 0, '#2F4F4F', 'Schattbaumart, frost- und wildverbissempfindlich: nur unter Schirm oder mit Seitenschutz pflanzen, schützen. Tiefwurzler, stabilisiert Mischbestände.', [], NADEL),
  A('Gemeine Fichte', 'FI', 'fichte', 'halb', 0, '#5F6B73', 'Flachwurzler, anfällig für Sturm, Trockenheit und Borkenkäfer; in Thüringen nur noch beimischen.', [], NADEL),
  A('Gemeine Kiefer', 'KI', 'kiefer', 'licht', 0.1, '#BF8034', 'Lichtbaumart, anspruchslos und trockenheitstolerant; für arme und trockene Standorte, gruppen- bis flächenweise.', [], NADEL),
  A('Europäische Lärche', 'LA', 'nadel', 'licht', 0, '#E57399', 'Extreme Lichtbaumart, in der Jugend vorwüchsig: einzeln bis truppweise oder am Rand, nicht unter Schirm.', [], { buche: 'mit', ...NADEL }),
  A('Douglasie', 'DGL', 'nadel', 'halb', 0.1, '#4B6E8A', 'Wüchsig und trockenheitstoleranter als Fichte; gruppenweise beimischen, nicht auf Kalk- oder vernässten Böden.', [], { buche: 'mit', ...NADEL, ...FREMD }),
  A('Küstentanne', '', 'nadel', 'halb', 0.1, '#3F6E6E', 'Nicht heimisch, sehr wüchsig; gruppenweise beimischen.', [], { buche: 'mit', ...NADEL, ...FREMD }),
  A('Nordmannstanne', '', 'nadel', 'schatten', 0, '#355E5E', 'Nicht heimisch, schattenverträglich; als Beimischung, auch im Voranbau.', [], { ...NADEL, ...FREMD }),
  A('Colorado-Tanne', '', 'nadel', 'halb', 0, '#6E8B8B', 'Nicht heimisch, Versuchsbaumart; als Beimischung.', [], { ...NADEL, ...FREMD }),
  A('Hemlocktanne', '', 'nadel', 'schatten', 0, '#4F6F5F', 'Nicht heimisch, schattenverträglich; als Beimischung.', [], { ...NADEL, ...FREMD }),
  A('Schwarzkiefer', '', 'kiefer', 'licht', 0.1, '#8B5A2B', 'Nicht heimisch; für flachgründige, trockene Standorte, gruppenweise.', [], { ...NADEL, ...FREMD }),
  A('Atlaszeder', '', 'nadel', 'licht', 0, '#7A8C6E', 'Nicht heimisch, Versuchsbaumart; einzeln bis truppweise.', [], { ...NADEL, ...FREMD }),
  A('Libanonzeder', '', 'nadel', 'licht', 0, '#8C9A7A', 'Nicht heimisch, Versuchsbaumart; einzeln bis truppweise.', [], { ...NADEL, ...FREMD }),
  A('Blaufichte', '', 'fichte', 'halb', 0, '#7C93A8', 'Nicht heimisch; forstlich ohne Bedeutung, eher für Schmuckreisig.', [], { ...NADEL, ...FREMD }),
  A('Mammutbaum', '', 'nadel', 'licht', 0, '#A0522D', 'Nicht heimisch, Versuchsbaumart; einzeln oder truppweise.', [], { buche: 'mit', ...NADEL, ...FREMD }),
];
export const VERBAND_NAMEN = { eiche: 'Eiche', roteiche: 'Roteiche', buche: 'Buche', elb: 'Edellaubholz', kirsche: 'Kirsche, Wildobst', pappel: 'Pappel, Aspe', linde: 'Linde', erle: 'Erle, Birke', sorbus: 'Elsbeere, Eberesche', fichte: 'Fichte', kiefer: 'Kiefer', nadel: 'sonstige Nadelbäume' };
const EIGEN_FARBEN = ['#6D4C41', '#00897B', '#7E57C2', '#F4511E', '#3949AB', '#C0CA33'];
function eigeneInfo(name) {
  const i = eigeneBaumarten().findIndex((e) => e.name === name);
  if (i < 0) return null;
  const e = eigeneBaumarten()[i];
  return { name, code: '', codes: [], verband: VERBAND[e.verband] ? e.verband : (e.nadel ? 'nadel' : 'elb'), licht: 'halb', gruppeHa: 0, farbe: EIGEN_FARBEN[i % EIGEN_FARBEN.length], hinweis: 'Eigene Baumart.', nadel: !!e.nadel, fremd: !e.heimisch, eigen: true };
}
export const artInfo = (name) => PFLANZ_ARTEN.find((a) => a.name === name) || eigeneInfo(name);
const zahl = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; const t = String(v ?? '').trim().replace(/\s|€/g, ''); const s = /,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t; const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
const euro = (v) => `${Number(v || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dez = (v, d = 1) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const verbandText = (nHa, reihe = REIHE) => `${dez(reihe)} × ${dez(10000 / (nHa * reihe), 2)} m`;
/** Alter einer Pflanze aus dem Sortiment („1+1“ → 2, „2/0“ → 2); unbekannt → 2 Jahre */
export function sortimentAlter(sortiment) {
  const m = /(\d)\s*[+/]\s*(\d)/.exec(String(sortiment || ''));
  return m ? Number(m[1]) + Number(m[2]) : 2;
}

// ---------- Geometrie in Metern (lokal) ----------
function lokal(ring) {
  const lat0 = ring.reduce((a, p) => a + p[0], 0) / ring.length, lon0 = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  return { xy: ([la, lo]) => [(lo - lon0) * kx, (la - lat0) * ky], ll: ([x, y]) => [lat0 + y / ky, lon0 + x / kx] };
}
/** Richtung der längsten Kante (Grad, 0 = Ost) – Rückegassen laufen parallel dazu */
function hauptRichtung(ring) {
  const { xy } = lokal(ring);
  let best = 0, w = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = xy(ring[i]), [x2, y2] = xy(ring[(i + 1) % ring.length]);
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L > best) { best = L; w = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI; }
  }
  return w;
}
export { gassenLinien };

const mod = (a, n) => ((a % n) + n) % n;
const nadelArt = (name) => !!artInfo(name)?.nadel;

export async function openPflanzPlanung({ parcelId = null, foerdern = false, onSaved, vorgabe = null } = {}) {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id]);
  const s = vorgabe || {
    parcelId: parcelId || mine[0]?.id || null, ring: [], art: 'wiederaufforstung', arten: [], grund: null,
    gassen: { abstand: 20, breite: 4, winkel: null, versatz: 0 }, vert: { form: 'einzeln', seed: 1, mal: {} }, date: '', note: '', bzt: null, standort: null,
  };
  s.vert ||= { form: 'einzeln', seed: 1, mal: {} };
  s.gassen.versatz ??= 0;
  s.reihe ??= REIHE;
  s.gassen.modus ??= 'raster'; s.gassen.linien ??= [];
  s.vert.frei ??= [];
  s.flaechen ??= [];
  // Pflanzfläche aus einer oder mehreren Einzelflächen: fertige Flächen + die gerade gezeichnete
  const alle = () => [...s.flaechen, s.ring].filter((r) => r.length >= 3);
  const allePunkte = () => alle().flat();
  const flHa = () => alle().reduce((a, r) => a + areaHa(r), 0);
  const inFlaeche = (pt) => alle().some((r) => pointInPolygon(pt, r));
  const groesste = () => [...alle()].sort((a, b) => areaHa(b) - areaHa(a))[0];
  let schritt = 0, letzterSchritt = -1, weitereOffen = false;
  const SCHRITTE = ['Pflanzfläche', 'Baumarten', 'Pflanzenzahl und Verband', 'Baumarten verteilen', 'Pflanzplan und Kosten'];
  const body = h('div', { class: 'pflanzung' });
  let karte = null, umlauf = null, weiterBtn = null, griff = null, pinsel = null, malt = false, geplant = false, marker = [], warteschlange = [], pinselGroesse = 'einzeln', gasseNeu = null, zieht = null, weitereBtn = null;
  // Zurück (Pfeil oben, Handy-Taste, Wischgeste): einen Schritt zurück; im ersten Schritt vor dem Verwerfen fragen
  let verwerfenOk = false;
  const page = openPage('Pflanzung planen', body, { onClose: () => { umlauf?.stop(); karte?.remove(); },
    onBack: () => {
      if (gasseNeu != null) { gasseFertig(); return true; }
      if (schritt > 0) { schritt--; pinselSetzen(null); render(); return true; }
      if (verwerfenOk || (!s.ring.length && !s.flaechen.length && !s.arten.length)) return false;
      confirmDialog('Planung verwerfen?', { ok: 'Verwerfen', danger: true, body: 'Die eingezeichnete Fläche und die Angaben gehen verloren.' }).then((ja) => { if (ja) { verwerfenOk = true; page.close(); } });
      return true;
    } });
  const mapEl = h('div', { class: 'mini-map zaun-map' });
  const status = h('p', { class: 'draw-status', 'aria-live': 'polite' });
  const umlaufHost = h('div');
  const summeHost = h('div');
  const hinweisHost = h('div');
  const PINSEL = { einzeln: ['Einzelne Pflanze', 1.8], klein: ['Klein (Ø 5 m)', 2.5], gross: ['Groß (Ø 10 m)', 5] };
  const lyr = L.layerGroup(), lyrGassen = L.layerGroup(), lyrPunkte = L.layerGroup();
  const canvas = L.canvas({ padding: 0.3 });

  // ---------- Pflanzplätze ----------
  const nHaVon = (x) => { if (x.nHa == null) { const V = verbandVon(x.name); x.nHa = Math.round((V[0] + V[1]) / 2 / 100) * 100; } return x.nHa; };
  const verbandVon = (name) => VERBAND[artInfo(name)?.verband || 'elb'][s.art === 'voranbau' ? 'voranbau' : 'frei'];
  // Übermalte Pflanzen gehören zu festen Pflanzplätzen; ändern sich Fläche, Baumarten, Verband, Gassen oder Mischung, gilt die Übermalung nicht mehr
  const basis = () => JSON.stringify([alle(), s.art, s.arten.map((x) => [x.name, x.anteil, x.nHa]), s.gassen, s.vert.form, s.vert.seed, s.reihe]);
  const layoutArten = () => s.arten.map((x) => ({ name: x.name, anteil: Number(x.anteil) || 0, nHa: nHaVon(x), gruppeHa: artInfo(x.name)?.gruppeHa || 0 }));
  function layout(mitPunkten = false) {
    if (s.gassen.winkel == null && alle().length) s.gassen.winkel = Math.round(hauptRichtung(groesste()));
    const b = basis();
    if (s.vert.basis && s.vert.basis !== b && Object.keys(s.vert.mal).length) { s.vert.mal = {}; toast('Übermalung zurückgesetzt, weil sich die Pflanzung geändert hat.'); }
    s.vert.basis = b;
    return pflanzLayout({ ring: alle(), arten: layoutArten(), gassen: s.gassen, form: s.vert.form, seed: s.vert.seed, mal: s.vert.mal, reihe: s.reihe, frei: s.vert.frei }, mitPunkten);
  }

  // ---------- Karte ----------
  function karteNeu() {
    umlauf?.stop(); karte?.remove();
    karte = miniKarte(mapEl, byId[s.parcelId] || null, { zoom: 17 });
    const map = karte.map;
    map.doubleClickZoom.disable();
    lyr.addTo(map); lyrGassen.addTo(map); lyrPunkte.addTo(map);
    map.on('click', (e) => klick([e.latlng.lat, e.latlng.lng]));
    map.on('zoomend', () => zeichnePunkte());
    umlauf = umlaufSteuerung({ map, text: 'Fläche umlaufen', onPunkt: (ll) => klick(ll), onEnde: () => { s.ring = vereinfachen(s.ring, 1.5); zeichne(); render(); } });
    fill(umlaufHost, umlauf.el);
    // Malen in Schritt 4: ein Finger bzw. Maus malt, zwei Finger zoomen weiter
    const el = map.getContainer(), aktiv = new Set();
    el.addEventListener('pointerdown', (e) => {
      aktiv.add(e.pointerId);
      const frei = s.vert.form === 'frei';
      malt = schritt === 3 && !!pinsel && aktiv.size === 1 && !frei;
      if (malt) { malen(e); e.preventDefault(); }
      // Einzeln setzen: Pflanze greifen und ziehen
      if (schritt === 3 && frei && pinsel === '__move' && aktiv.size === 1) {
        const ll = map.mouseEventToLatLng(e), lay = layout(true);
        const mProPx = 40075016 * Math.cos((ll.lat * Math.PI) / 180) / (256 * 2 ** map.getZoom());
        const q = punkteNahe(lay, lay.R.toXY([ll.lat, ll.lng]), Math.max(1, 22 * mProPx))[0];
        zieht = q ? { i: q.i, orig: lay.punkte[q.i][5] } : null;
        if (zieht) e.preventDefault();
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (zieht && aktiv.size === 1) {
        const ll = map.mouseEventToLatLng(e);
        if (inFlaeche([ll.lat, ll.lng])) { s.vert.frei[zieht.orig][0] = ll.lat; s.vert.frei[zieht.orig][1] = ll.lng; marker[zieht.i]?.setLatLng(ll); }
        return;
      }
      if (malt && aktiv.size === 1) malen(e); else if (aktiv.size > 1) { malt = false; zieht = null; }
    });
    const ende = (e) => { aktiv.delete(e.pointerId); if (zieht) { zieht = null; zeichnePunkte(); aktualisieren(); } if (malt) { malt = false; aktualisieren(); } };
    el.addEventListener('pointerup', ende); el.addEventListener('pointercancel', ende);
    if (alle().length) setTimeout(() => map.fitBounds(L.latLngBounds(allePunkte()), { padding: [20, 20], maxZoom: 18 }), 120);
  }
  function klick(ll) {
    if (schritt === 0) { s.ring.push(ll); s.standort = null; s.bzt = null; s.vert.mal = {}; zeichne(); renderStatus(); }
    else if (schritt === 2 && s.gassen.modus === 'frei' && gasseNeu != null) { s.gassen.linien[gasseNeu].push(ll); render(); }
    else if (schritt === 3 && s.vert.form === 'frei' && pinsel && pinsel !== '__move') freiTipp(ll);
  }
  /** Einzeln setzen: neue Pflanze, Baumart ändern oder entfernen */
  function freiTipp(ll) {
    if (!inFlaeche(ll)) { toast('Bitte innerhalb der Pflanzfläche tippen.'); return; }
    const lay = layout(true);
    const mProPx = 40075016 * Math.cos((ll[0] * Math.PI) / 180) / (256 * 2 ** karte.map.getZoom());
    const q = punkteNahe(lay, lay.R.toXY(ll), Math.max(0.5, 14 * mProPx))[0];
    if (pinsel === '__auto') { if (!q) return; s.vert.frei.splice(lay.punkte[q.i][5], 1); }
    else if (q) s.vert.frei[lay.punkte[q.i][5]][2] = pinsel;
    else s.vert.frei.push([ll[0], ll[1], pinsel]);
    zeichnePunkte(); aktualisieren();
  }
  const gassenLaenge = (l) => { const { xy } = lokal(l); let m = 0; for (let i = 1; i < l.length; i++) { const [a, b] = xy(l[i - 1]), [c, d] = xy(l[i]); m += Math.hypot(c - a, d - b); } return m; };
  function gasseFertig() {
    const l = s.gassen.linien[gasseNeu];
    if (!l || l.length < 2) s.gassen.linien.splice(gasseNeu, 1);
    else if (s.gassen.linien.length === 1) {
      // Reihen parallel zur ersten Gasse
      const { xy } = lokal(l); const [a, b] = xy(l[0]), [c, d] = xy(l[l.length - 1]);
      s.gassen.winkel = Math.round(mod((Math.atan2(d - b, c - a) * 180) / Math.PI, 180));
    }
    gasseNeu = null; render();
  }
  function zeichne() {
    lyr.clearLayers();
    s.flaechen.forEach((r) => L.polygon(r, { color: '#2E7D32', weight: 3, fillColor: '#2E7D32', fillOpacity: schritt >= 2 ? 0.05 : 0.12, interactive: false }).addTo(lyr));
    if (s.ring.length >= 2) L.polygon(s.ring, { color: schritt === 0 && s.flaechen.length ? '#E65100' : '#2E7D32', weight: 3, fillColor: '#2E7D32', fillOpacity: schritt >= 2 ? 0.05 : 0.12, interactive: false }).addTo(lyr);
    if (schritt === 0) s.ring.forEach((ll) => L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: '#2E7D32', fillOpacity: 1, interactive: false }).addTo(lyr));
    zeichneGassen(); griffSetzen(); zeichnePunkte();
  }
  function zeichneGassen() {
    lyrGassen.clearLayers();
    if (schritt < 2 || !alle().length) return;
    layout();
    const frei = s.gassen.modus === 'frei';
    const linien = frei ? s.gassen.linien : gassenLinien(alle(), s.gassen).map((l) => l.linie);
    linien.forEach((l, gi) => {
      if (!l.length) return;
      const pl = L.polyline(l, { color: gi === gasseNeu ? '#E65100' : '#8D6E63', weight: 4, opacity: 0.9, dashArray: '8 6', interactive: false }).addTo(lyrGassen);
      if (!frei || schritt !== 2) return;
      // jeden Punkt einzeln ziehen
      l.forEach((pt, pi) => {
        const mk = L.marker(pt, { draggable: true, keyboard: false, icon: L.divIcon({ className: 'gassen-punkt', iconSize: [16, 16] }) }).addTo(lyrGassen);
        mk.on('drag', (e) => { l[pi] = [e.latlng.lat, e.latlng.lng]; pl.setLatLngs(l); });
        mk.on('dragend', () => render());
      });
      // ganze Gasse verschieben
      if (l.length >= 2) {
        const mitte = (() => { const a = l[Math.floor((l.length - 1) / 2)], b = l[Math.ceil((l.length - 1) / 2)]; return a === b ? a : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; })();
        const g = L.marker(mitte, { draggable: true, title: `Gasse ${gi + 1} verschieben`, icon: L.divIcon({ className: 'gassen-griff', html: '<span aria-hidden="true">✥</span>', iconSize: [34, 34] }) }).addTo(lyrGassen);
        let start = null, orig = null;
        g.on('dragstart', (e) => { start = e.target.getLatLng(); orig = l.map((q) => [...q]); });
        g.on('drag', (e) => { const d = [e.latlng.lat - start.lat, e.latlng.lng - start.lng]; orig.forEach((q, i) => { l[i] = [q[0] + d[0], q[1] + d[1]]; }); pl.setLatLngs(l); });
        g.on('dragend', () => render());
      }
    });
  }
  function griffSetzen() {
    griff?.remove(); griff = null;
    if (schritt !== 2 || !s.gassen.abstand || s.gassen.modus === 'frei' || !karte) return;
    const R = rahmen(alle(), s.gassen.winkel || 0), mitte = (R.minY + R.maxY) / 2;
    const l = gassenLinien(alle(), s.gassen).sort((a, b) => Math.abs(a.y - mitte) - Math.abs(b.y - mitte))[0];
    if (!l) return;
    griff = L.marker(l.mitte, { draggable: true, keyboard: true, title: 'Rückegassen verschieben', icon: L.divIcon({ className: 'gassen-griff', html: '<span aria-hidden="true">⇅</span>', iconSize: [36, 36] }) }).addTo(karte.map);
    const v0 = s.gassen.versatz || 0;
    griff.on('drag', (e) => { const y = R.toXY([e.latlng.lat, e.latlng.lng])[1]; s.gassen.versatz = Math.round(mod(v0 + y - l.y, s.gassen.abstand) * 2) / 2; zeichneGassen(); });
    griff.on('dragend', () => render());
  }
  function zeichnePunkte() {
    lyrPunkte.clearLayers(); marker = [];
    if (!karte || schritt < 2 || !alle().length || !s.arten.length) return;
    const lay = layout(true);
    if (lay.punkte.length > 40000) {
      for (const st of streifen(lay)) L.polygon(st.ring, { renderer: canvas, stroke: false, fillColor: farbe(st.art === 'mix' ? s.grund : st.art), fillOpacity: 0.7, interactive: false }).addTo(lyrPunkte);
      return;
    }
    const z = karte.map.getZoom(), frei = s.vert.form === 'frei', rad = frei ? (z >= 19 ? 6 : z >= 17 ? 4.5 : 3) : z >= 19 ? 3.2 : z >= 18 ? 2.3 : z >= 17 ? 1.6 : 1.1;
    marker = lay.punkte.map(([x, y, art]) => L.circleMarker(lay.R.toLL([x, y]), { renderer: canvas, radius: rad, stroke: frei, color: '#fff', weight: 1.5, fillColor: farbe(art), fillOpacity: 1, interactive: false }).addTo(lyrPunkte));
  }
  function malen(e) {
    const ll = karte.map.mouseEventToLatLng(e);
    warteschlange.push([ll.lat, ll.lng]);
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(() => {
      geplant = false;
      const lay = layout(true), r = PINSEL[pinselGroesse][1];
      const geaendert = new Set();
      for (const pt of warteschlange.splice(0)) {
        const nahe = punkteNahe(lay, lay.R.toXY(pt), r);
        for (const { i } of pinselGroesse === 'einzeln' ? nahe.slice(0, 1) : nahe) {
          const key = lay.punkte[i][4];
          if (pinsel === '__auto') { if (key in s.vert.mal) { delete s.vert.mal[key]; geaendert.add(i); } }
          else if (lay.punkte[i][2] !== pinsel || s.vert.mal[key] !== pinsel) { s.vert.mal[key] = pinsel; geaendert.add(i); }
        }
      }
      if (!geaendert.size) return;
      const neu = layout(true);
      if (marker.length === neu.punkte.length) geaendert.forEach((i) => marker[i].setStyle({ fillColor: farbe(neu.punkte[i][2]) }));
      else zeichnePunkte();
      aktualisieren();
    });
  }
  /** Aufteilung und Hinweise nach dem Malen auffrischen, ohne die Seite neu aufzubauen */
  function aktualisieren() {
    const b = rechnen();
    fill(summeHost, aufteilung(b));
    fill(hinweisHost, verteilHinweise(b));
  }
  function pinselSetzen(p) {
    pinsel = p;
    if (!karte) return;
    if (p) karte.map.dragging.disable(); else karte.map.dragging.enable();
    karte.map.getContainer().style.touchAction = p ? 'none' : '';
    karte.map.getContainer().classList.toggle('malt', !!p);
  }
  const farbe = (name) => artInfo(name)?.farbe || '#2E7D32';
  function renderStatus() {
    // „Weiter“ freigeben, sobald die Fläche drei Punkte hat (ohne die Seite neu aufzubauen)
    if (schritt === 0 && weiterBtn) weiterBtn.disabled = !alle().length;
    if (schritt === 0 && weitereBtn) weitereBtn.disabled = s.ring.length < 3;
    const anzahl = alle().length, mehr = s.flaechen.length > 0;
    if (schritt === 0) status.textContent = (anzahl ? `Pflanzfläche ${formatHa(flHa())}${anzahl > 1 ? ` aus ${anzahl} Einzelflächen` : ''}` : '')
      + (s.ring.length >= 3 ? `${anzahl ? ' · ' : ''}${mehr ? `Einzelfläche ${s.flaechen.length + 1}: ` : ''}${s.ring.length} Eckpunkte` : `${anzahl ? ' · ' : ''}${mehr ? `Einzelfläche ${s.flaechen.length + 1}: ` : ''}${s.ring.length} von mindestens 3 Eckpunkten – tippe die Ecken in die Karte oder lauf die Fläche mit dem GPS ab.`);
    else if (anzahl) status.textContent = `Pflanzfläche ${formatHa(flHa())}${anzahl > 1 ? ` aus ${anzahl} Einzelflächen` : ''}`;
  }

  // ---------- Standort und Empfehlung ----------
  async function standortLaden() {
    if (s.bzt || !alle().length) return;
    const c = centroid(groesste());
    try {
      const [{ queryPoint, naechsterStandort }, { empfehlung }] = await Promise.all([import('./map/geoinfo.js'), import('./bzt.js')]);
      const info = await queryPoint(c);
      let sp = info.standort || {}, ersatz = null;
      if (!String(sp.Standortseinheiten || '').trim() && !String(sp.Standortsguppe || sp.Standortsgruppe || '').trim()) {
        // keine Kartierung in der Flächenmitte: nächstgelegenen kartierten Standort verwenden
        const n = await naechsterStandort(c).catch(() => null);
        if (n) { sp = n.standort; ersatz = { abstand: n.abstand, richtung: n.richtung }; }
      }
      s.standort = { einheit: String(sp.Standortseinheiten || '').trim(), gruppe: String(sp.Standortsguppe || sp.Standortsgruppe || '').trim(), text: sp.Beschreibung || '', ersatz };
      s.bzt = (s.standort.einheit || s.standort.gruppe) ? await empfehlung(c, s.standort) : { status: 'keinStandort' };
    } catch { s.bzt = { status: 'fehler' }; }
    if (schritt === 1) render();
  }
  function kategorie(a) {
    const e = s.bzt?.status === 'ok' ? s.bzt.eintrag : null;
    if (!e || !a?.codes?.length) return null;
    if (a.codes.some((c) => e.B.includes(c))) return ['Hauptbaumart', 'ok'];
    if (a.codes.some((c) => e.C.includes(c))) return ['Mischbaumart', 'ok'];
    if (a.codes.some((c) => e.D.includes(c))) return ['Nebenbaumart', 'neben'];
    return ['für diesen Standort nicht empfohlen', 'warn'];
  }

  // ---------- Berechnung ----------
  function rechnen() {
    const ha = flHa();
    const lay = layout(false);
    const zeilen = s.arten.map((x) => {
      const info = artInfo(x.name) || { name: x.name, farbe: '#777', hinweis: '', codes: [] };
      const V = verbandVon(x.name); nHaVon(x);
      const stueck = lay.stueck[x.name] || 0;
      const gesamt = Object.values(lay.stueck).reduce((a, v) => a + v, 0);
      // Einzeln gesetzt: Fläche = Platz nach Verband, Anteil nach Stückzahl
      const flaecheHa = s.vert.form === 'frei' ? ((lay.lenEff[x.name] || 0) * s.reihe) / 10000 : lay.gesamtLen ? (ha * (lay.lenEff[x.name] || 0)) / lay.gesamtLen : 0;
      const preis = zahl(x.preis);
      return { ...x, info, V, flaecheHa, anteilEcht: s.vert.form === 'frei' ? (gesamt ? stueck / gesamt : 0) : ha ? flaecheHa / ha : 0, stueck, verband: verbandText(x.nHa, s.reihe), lenEff: lay.lenEff[x.name] || 0, basisLen: lay.basisLen[x.name] || 0, gemalt: stueck - (lay.basisStk[x.name] || 0), preis, kosten: preis != null ? preis * stueck : null };
    });
    s.grund = [...zeilen].sort((a, b) => b.flaecheHa - a.flaecheHa)[0]?.name || null;
    return { ha, nettoHa: lay.nettoHa, zeilen, lay, stueck: zeilen.reduce((a, z) => a + z.stueck, 0), kosten: zeilen.reduce((a, z) => a + (z.kosten || 0), 0) };
  }
  const anteilSumme = () => s.arten.reduce((a, x) => a + (Number(x.anteil) || 0), 0);

  // ---------- Baumarten ----------
  function artHinzu(name) {
    const v = preisVorgabe(name);
    s.arten.push({ name, anteil: s.arten.length ? 20 : 60, nHa: null, ...v });
  }
  async function eigeneArtDialog() {
    const f = { name: h('input', { required: true, placeholder: 'z. B. Japanische Lärche' }), typ: h('select', {}, h('option', { value: 'laub' }, 'Laubbaum'), h('option', { value: 'nadel' }, 'Nadelbaum')),
      verband: h('select', {}, Object.entries(VERBAND_NAMEN).map(([k, l]) => h('option', { value: k, selected: k === 'elb' }, l))),
      sortiment: h('input', { placeholder: 'z. B. 1/1, 30–50 cm' }), preis: h('input', { inputmode: 'decimal', placeholder: '0,00' }), heimisch: h('input', { type: 'checkbox' }) };
    const ok = await dialog({ title: 'Eigene Baumart', body: h('div', { class: 'korr-form' },
      h('label', {}, 'Baumart', f.name), h('label', {}, 'Laub- oder Nadelbaum', f.typ),
      h('label', {}, 'Pflanzenzahl wie bei', f.verband), h('label', {}, 'Sortiment', f.sortiment), h('label', {}, 'Preis je Stück netto (€)', f.preis),
      h('label', { class: 'check-row' }, f.heimisch, ' standortheimisch')),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'Hinzufügen', value: true, primary: true }] });
    const name = f.name.value.trim();
    if (!ok || !name) return;
    if (PFLANZ_ARTEN.some((a) => a.name.toLowerCase() === name.toLowerCase())) { toast(`${name} gibt es schon in der Liste.`); return; }
    const preis = zahl(f.preis.value);
    eigeneBaumartMerken({ name, nadel: f.typ.value === 'nadel', verband: f.verband.value, sortiment: f.sortiment.value.trim(), preis, heimisch: f.heimisch.checked });
    if (preis != null) eigenenPreisMerken(name, f.sortiment.value.trim(), preis);
    if (!s.arten.some((x) => x.name === name)) artHinzu(name);
    render();
  }

  // ---------- Schritte ----------
  function render() {
    if (s.arten.length && alle().length) rechnen();
    const kopf = [h('div', { class: 'q-progress' }, SCHRITTE.map((_, k) => h('span', { class: k < schritt ? 'done' : k === schritt ? 'now' : '' }))),
      h('h2', { class: 'step-title' }, SCHRITTE[schritt])];
    const nav = (weiterOk = true, weiterText = 'Weiter') => h('div', { class: 'q-nav' },
      h('button', { type: 'button', class: 'btn', onclick: () => { if (schritt === 0) page.close(); else { schritt--; pinselSetzen(null); render(); } } }, schritt === 0 ? 'Abbrechen' : 'Zurück'),
      (weiterBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large', disabled: !weiterOk, onclick: () => { schritt++; pinselSetzen(null); render(); } }, weiterText)));
    let inhalt = [];
    if (schritt === 0) {
      inhalt = [
        foerdern ? h('div', { class: 'lrt-hinweis ok' }, h('strong', {}, 'Mit Förderantrag'), h('p', {}, 'Nach der Planung geht es direkt mit dem Förderantrag weiter.')) : null,
        h('label', {}, 'Flurstück', h('select', { onchange: (e) => { s.parcelId = e.target.value || null; s.ring = []; s.flaechen = []; karteNeu(); zeichne(); render(); } },
          h('option', { value: '' }, 'ohne Flächenzuordnung'), mine.map((p) => h('option', { value: p.id, selected: p.id === s.parcelId }, `Flurstück ${p.nr}, ${p.gemarkung}`)))),
        h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Art der Pflanzung' },
          [['wiederaufforstung', 'Freifläche / Wiederaufforstung'], ['voranbau', 'Voranbau unter Schirm']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.art === k), onclick: () => { s.art = k; s.arten.forEach((x) => { x.nHa = null; }); render(); } }, l))),
        mapEl, status, umlaufHost,
        h('div', { class: 'btn-row' },
          (weitereBtn = h('button', { type: 'button', class: 'btn btn-small btn-primary', disabled: s.ring.length < 3, onclick: () => { s.flaechen.push(s.ring); s.ring = []; s.vert.mal = {}; s.bzt = null; zeichne(); render(); } }, '+ Weitere Einzelfläche')),
          s.ring.length || s.flaechen.length ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => { if (s.ring.length) s.ring.pop(); else s.ring = s.flaechen.pop(); zeichne(); render(); } }, s.ring.length ? 'Letzten Punkt entfernen' : 'Letzte Einzelfläche bearbeiten') : null,
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.ring = []; s.flaechen = []; zeichne(); render(); } }, 'Neu beginnen'),
          byId[s.parcelId] ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => { const r = polysOf(byId[s.parcelId]).map((poly) => [...poly[0]]); s.ring = r.pop() || []; s.flaechen = r; s.vert.mal = {}; zeichne(); render(); } }, 'Ganzes Flurstück') : null),
        alle().length > 1 || s.flaechen.length ? h('ul', { class: 'mat-kurz' }, [...s.flaechen, ...(s.ring.length >= 3 ? [s.ring] : [])].map((r, i) => h('li', {}, `Einzelfläche ${i + 1}: ${formatHa(areaHa(r))} `,
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { if (i < s.flaechen.length) s.flaechen.splice(i, 1); else s.ring = []; s.vert.mal = {}; zeichne(); render(); } }, 'Löschen')))) : null,
        h('p', { class: 'hint' }, 'Mehrere getrennte Pflanzflächen? Erste Fläche einzeichnen, dann „+ Weitere Einzelfläche“ und die nächste einzeichnen.'),
        nav(alle().length > 0)];
    } else if (schritt === 1) {
      standortLaden();
      const r = s.bzt;
      const gewaehlt = new Set(s.arten.map((x) => x.name));
      const alle = [...PFLANZ_ARTEN, ...eigeneBaumarten().map((e) => artInfo(e.name)).filter(Boolean)];
      const empf = r?.status === 'ok' ? alle.filter((a) => ['ok', 'neben'].includes(kategorie(a)?.[1])) : [];
      const toggle = (a) => {
        if (gewaehlt.has(a.name)) s.arten = s.arten.filter((x) => x.name !== a.name); else artHinzu(a.name);
        s.vert.mal = Object.fromEntries(Object.entries(s.vert.mal).filter(([, v]) => s.arten.some((x) => x.name === v)));
        render();
      };
      const chip = (a) => { const k = kategorie(a); return h('button', { type: 'button', class: `art-chip ${gewaehlt.has(a.name) ? 'on' : ''} ${k?.[1] || ''}`, style: `--c:${a.farbe}`, 'aria-pressed': String(gewaehlt.has(a.name)), onclick: () => toggle(a) },
        h('span', { class: 'dot' }), a.name, k ? h('small', {}, k[0]) : a.eigen ? h('small', {}, 'eigene') : null); };
      const weitere = alle.filter((a) => !empf.includes(a));
      inhalt = [
        h('div', { class: 'geo-card' },
          h('p', { class: 'geo-kicker' }, 'Standort der Pflanzfläche'),
          !r ? h('p', { class: 'muted' }, 'Standort und Baumartenempfehlung werden geladen …')
            : r.status === 'ok' ? [s.standort?.ersatz ? h('p', { class: 'warn-line' }, `In der Flächenmitte ist keine Standortskartierung hinterlegt – verwendet wird der nächstgelegene kartierte Standort, ca. ${s.standort.ersatz.abstand.toLocaleString('de-DE')} m in Richtung ${s.standort.ersatz.richtung}.`) : null,
              h('p', {}, h('strong', {}, `${r.code}: ${r.eintrag.name}`)), h('p', { class: 'muted' }, `${r.wuchseinheitName} · Klimabereich 2041–2070: ${r.klimabereichTabelleName} (${r.klimabereichTabelle})`),
              h('p', { class: 'muted' }, `Tabellenwerk: Hauptbaumarten ${r.eintrag.B.join(', ')} · Mischbaumarten ${r.eintrag.C.join(', ')} · Nebenbaumarten ${r.eintrag.D.join(', ')}`)]
            : h('p', { class: 'muted' }, r.status === 'keinStandort' ? 'Für die Fläche und im Umkreis von 1,5 km ist keine Standortskartierung hinterlegt – die Baumartenwahl bitte mit dem Forstamt abstimmen.' : 'Für diesen Standort liegt keine Empfehlung aus dem Tabellenwerk vor.')),
        h('p', { class: 'sheet-label' }, empf.length ? 'Für diesen Standort empfohlen' : 'Baumarten'),
        h('div', { class: 'art-chips' }, (empf.length ? empf : alle).map(chip)),
        empf.length ? h('details', { class: 'weitere-arten', open: weitereOffen, ontoggle: (e) => { weitereOffen = e.target.open; } }, h('summary', {}, 'Weitere Baumarten'), h('div', { class: 'art-chips' }, weitere.map(chip))) : null,
        h('button', { type: 'button', class: 'btn btn-small', onclick: eigeneArtDialog }, '+ Eigene Baumart'),
        s.arten.length ? h('div', { class: 'anteile' }, h('p', { class: 'sheet-label' }, 'Anteile an der Fläche (%)'),
          s.arten.map((x) => { const a = artInfo(x.name) || {}; const k = kategorie(a); return h('div', { class: 'anteil-zeile' },
            h('span', { class: 'dot', style: `background:${a.farbe}` }), h('strong', {}, x.name),
            h('input', { type: 'number', min: 0, max: 100, step: 5, value: x.anteil, 'aria-label': `Anteil ${x.name} in Prozent`, onchange: (e) => { x.anteil = Math.max(0, Math.min(100, Number(e.target.value) || 0)); render(); } }),
            h('small', { class: 'muted' }, a.hinweis),
            k?.[1] === 'warn' ? h('small', { class: 'warn-line' }, `${x.name} ist laut Tabellenwerk für diesen Standort nicht empfohlen.`) : null); }),
          anteilSumme() !== 100 ? h('p', { class: 'warn-line' }, `Summe der Anteile: ${anteilSumme()} % – bitte auf 100 % bringen.`) : null,
          mischHinweise()) : h('p', { class: 'muted' }, 'Wähle die Baumarten, die gepflanzt werden sollen.'),
        nav(s.arten.length > 0 && anteilSumme() === 100)];
    } else if (schritt === 2) {
      const b = rechnen();
      inhalt = [
        mapEl, h('p', { class: 'muted' }, s.gassen.modus === 'frei' ? 'Gestrichelt: deine eingezeichneten Rückegassen, auf ihnen wird nicht gepflanzt. Am besten auf dem Luftbild einzeichnen (Schalter oben rechts).'
          : s.gassen.abstand ? 'Gestrichelt: Rückegassen, auf ihnen wird nicht gepflanzt. Den runden Griff ⇅ kannst du ziehen, um die Gassen an ihre tatsächliche Lage zu schieben.' : 'Ohne Rückegassen wird die ganze Fläche bepflanzt.'),
        h('div', { class: 'zaun-optionen' },
          h('label', {}, 'Rückegassen', h('select', { onchange: (e) => {
            const v = e.target.value;
            if (v === 'frei') {
              // vorhandene regelmäßige Gassen als Start übernehmen – jede lässt sich dann einzeln verschieben
              /* selbst einzeichnen beginnt ohne Gassen – Vorlage nur auf Wunsch */
              s.gassen.modus = 'frei'; if (!s.gassen.abstand) s.gassen.abstand = 20;
            } else { s.gassen.modus = 'raster'; s.gassen.abstand = Number(v); s.gassen.versatz = 0; gasseNeu = null; }
            render();
          } },
            [[0, 'keine Rückegassen'], [20, 'alle 20 m'], [30, 'alle 30 m'], [40, 'alle 40 m'], ['frei', 'selbst einzeichnen']].map(([v, l]) => h('option', { value: v, selected: s.gassen.modus === 'frei' ? v === 'frei' : s.gassen.abstand === v }, l)))),
          s.gassen.abstand || s.gassen.modus === 'frei' ? h('label', {}, 'Gassenbreite (m)', h('input', { type: 'number', min: 2, max: 6, step: 0.5, value: s.gassen.breite, onchange: (e) => { s.gassen.breite = Math.max(2, Math.min(6, Number(e.target.value) || 4)); render(); } })) : null),
        s.gassen.modus === 'frei' ? h('div', { class: 'gassen-steuer' },
          h('div', { class: 'btn-row' },
            gasseNeu == null ? h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => { s.gassen.linien.push([]); gasseNeu = s.gassen.linien.length - 1; render(); } }, '+ Rückegasse einzeichnen')
              : h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: gasseFertig }, 'Gasse fertig'),
            gasseNeu != null && s.gassen.linien[gasseNeu]?.length ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.gassen.linien[gasseNeu].pop(); render(); } }, 'Letzten Punkt entfernen') : null,
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.gassen.winkel = ((s.gassen.winkel || 0) + 15) % 180; render(); } }, 'Pflanzreihen drehen (15°)')),
          gasseNeu != null ? h('p', { class: 'hint' }, `Gasse ${gasseNeu + 1}: Tippe ihren Verlauf Punkt für Punkt in die Karte, dann „Gasse fertig“.`) : null,
          h('div', { class: 'btn-row' },
            !s.gassen.linien.length ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => {
              const abstand = s.gassen.abstand || 20;
              s.gassen.linien = gassenLinien(alle(), { ...s.gassen, abstand, modus: 'raster' }).map((l) => l.linie.map((q) => [...q]));
              render();
            } }, `Regelmäßige Gassen (alle ${s.gassen.abstand || 20} m) als Vorlage`) : null,
            s.gassen.linien.length ? h('button', { type: 'button', class: 'btn btn-small', onclick: async () => {
              if (await confirmDialog('Alle eingezeichneten Rückegassen löschen?', { ok: 'Löschen', danger: true })) { s.gassen.linien = []; gasseNeu = null; render(); }
            } }, 'Alle Gassen löschen') : null),
          s.gassen.linien.length ? h('ul', { class: 'mat-kurz' }, s.gassen.linien.map((l, i) => h('li', {}, `Gasse ${i + 1} · ${Math.round(gassenLaenge(l))} m `,
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.gassen.linien.splice(i, 1); if (gasseNeu === i) gasseNeu = null; else if (gasseNeu > i) gasseNeu--; render(); } }, 'Löschen')))) : null,
          h('p', { class: 'hint' }, 'Jeden Punkt einer Gasse kannst du ziehen; mit dem Griff ✥ verschiebst du die ganze Gasse.')) : null,
        s.gassen.abstand && s.gassen.modus !== 'frei' ? h('div', { class: 'gassen-steuer' },
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.gassen.winkel = ((s.gassen.winkel || 0) + 15) % 180; s.vert.mal = {}; render(); } }, 'Gassen drehen (15°)'),
          h('label', {}, `Gassen verschieben: ${dez(s.gassen.versatz || 0)} m`,
            h('input', { type: 'range', min: 0, max: s.gassen.abstand - 0.5, step: 0.5, value: s.gassen.versatz || 0, 'aria-label': 'Lage der Rückegassen in Metern',
              oninput: (e) => { s.gassen.versatz = Number(e.target.value); e.target.previousSibling.textContent = `Gassen verschieben: ${dez(s.gassen.versatz)} m`; zeichneGassen(); }, onchange: () => render() }))) : null,
        h('p', { class: 'hint' }, `Pflanzfläche ${formatHa(b.ha)}, davon bepflanzt ${formatHa(b.nettoHa)} (${Math.round((b.nettoHa / Math.max(b.ha, 1e-9)) * 100)} %) – ohne Gassen und 1 m Abstand zum Rand. Jeder Punkt in der Karte ist eine Pflanze.`),
        s.vert.form === 'frei' ? h('p', { class: 'warn-line' }, 'Mischungsform „Einzeln setzen“: Die Pflanzenzahl ergibt sich aus den Pflanzen, die du im nächsten Schritt setzt.') : null,
        h('p', { class: 'hint' }, 'Gib je Baumart entweder die Stückzahl, die Pflanzen je Hektar oder den Abstand in der Reihe an – die anderen Werte rechnet die App aus.'),
        h('label', {}, 'Reihenabstand (m) – gilt für alle Baumarten', h('input', { type: 'number', min: 1, max: 5, step: 0.1, value: s.reihe, inputmode: 'decimal',
          onchange: (e) => { const v = zahl(e.target.value); s.reihe = v >= 1 && v <= 5 ? Math.round(v * 10) / 10 : REIHE; render(); } })),
        h('ul', { class: 'pflanz-liste' }, b.zeilen.map((z) => {
          const x = s.arten.find((y) => y.name === z.name);
          const netto = (z.lenEff * s.reihe) / 10000; // bepflanzte Fläche dieser Baumart in ha
          const setze = (nHa) => { if (nHa > 0 && Number.isFinite(nHa)) { x.nHa = Math.max(50, Math.min(20000, nHa)); render(); } };
          const abstand = 10000 / (z.nHa * s.reihe);
          return h('li', {},
            h('div', { class: 'mat-kopf' }, h('strong', {}, h('span', { class: 'dot', style: `background:${z.info.farbe}` }), ` ${z.name}`), h('span', { class: 'mat-menge' }, `Verband ${z.verband}`)),
            h('div', { class: 'verband-felder' },
              h('label', {}, 'Stück gesamt', h('input', { type: 'number', min: 1, step: 1, value: z.stueck, onchange: (e) => { const n = Math.round(zahl(e.target.value)) - z.gemalt; if (n > 0 && z.basisLen > 0) setze((n * 10000) / (z.basisLen * s.reihe)); } })),
              h('label', {}, 'je Hektar', h('input', { type: 'number', min: 50, max: 20000, step: 50, value: Math.round(z.nHa), onchange: (e) => setze(Math.round(zahl(e.target.value))) })),
              h('label', {}, 'Abstand in der Reihe (m)', h('input', { type: 'number', min: 0.2, max: 10, step: 0.05, inputmode: 'decimal', value: Math.round(abstand * 100) / 100, onchange: (e) => { const d = zahl(e.target.value); if (d > 0) setze(10000 / (d * s.reihe)); } }))),
            h('small', { class: 'muted' }, `${formatHa(netto)} bepflanzt · Rahmenpflanzverband ${s.art === 'voranbau' ? 'Voranbau' : 'Freifläche'}: ${z.V[0].toLocaleString('de-DE')}–${z.V[1].toLocaleString('de-DE')} Stück/ha${z.V[2] ? ` (${z.V[2]})` : ''}`),
            (z.nHa < z.V[0] || z.nHa > z.V[1]) ? h('small', { class: 'warn-line' }, 'Außerhalb des Rahmenpflanzverbands – für die Förderung mit dem Forstamt abstimmen.') : null);
        })),
        h('div', { class: 'zaun-summe' }, h('span', {}, 'Pflanzen gesamt'),
          h('input', { class: 'summe-feld', type: 'number', min: 1, step: 1, value: b.stueck, 'aria-label': 'Pflanzen gesamt',
            onchange: (e) => {
              // Gesamtzahl im Verhältnis der Baumarten verteilen (größte Reste), dann Pflanzen je ha je Baumart daraus
              const ziel = Math.round(zahl(e.target.value));
              if (!(ziel > 0) || !b.stueck) return;
              const roh = b.zeilen.map((z) => (z.stueck / b.stueck) * ziel);
              const ganz = roh.map(Math.floor);
              let rest = ziel - ganz.reduce((a, v) => a + v, 0);
              roh.map((v, i) => [v - ganz[i], i]).sort((p, q) => q[0] - p[0]).forEach(([, i]) => { if (rest > 0) { ganz[i]++; rest--; } });
              b.zeilen.forEach((z, i) => { const x = s.arten.find((y) => y.name === z.name); if (z.basisLen > 0 && ganz[i] - z.gemalt > 0) x.nHa = ((ganz[i] - z.gemalt) * 10000) / (z.basisLen * s.reihe); });
              render();
            } })),
        h('p', { class: 'hint' }, `Quelle der Rahmenpflanzverbände: Anlage 3 der Thüringer Richtlinie zur Förderung forstwirtschaftlicher Maßnahmen 2025 (Pflanzen je Hektar Arbeitsfläche, bezogen auf 2,5 m Reihenabstand).${s.reihe !== REIHE ? ` Bei ${dez(s.reihe)} m Reihenabstand ändert sich die Stückzahl je Hektar entsprechend.` : ''}`),
        nav(true)];
    } else if (schritt === 3) {
      const b = rechnen();
      const F = FORMEN[s.vert.form];
      const pinselChip = (wert, text, c) => h('button', { type: 'button', class: `art-chip ${pinsel === wert ? 'on' : ''}`, style: `--c:${c}`, 'aria-pressed': String(pinsel === wert), onclick: () => { pinselSetzen(pinsel === wert ? null : wert); render(); } }, wert && wert !== '__auto' ? h('span', { class: 'dot' }) : null, text);
      fill(summeHost, aufteilung(b)); fill(hinweisHost, verteilHinweise(b));
      inhalt = [
        h('p', { class: 'muted' }, s.vert.form === 'frei' ? 'Setze jede Pflanze selbst auf die Fläche – z. B. für eine einzelstammweise Ergänzung oder Lückenbepflanzung.' : 'Die Fläche ist schon bepflanzt: Jeder Punkt ist eine Pflanze. Wähle die Mischungsform – danach kannst du einzelne Pflanzen oder ganze Bereiche mit einer anderen Baumart übermalen.'),
        h('p', { class: 'sheet-label' }, 'Mischungsform'),
        h('div', { class: 'art-chips', role: 'radiogroup', 'aria-label': 'Mischungsform' }, Object.entries(FORMEN).map(([k, f]) => h('button', { type: 'button', role: 'radio', class: `art-chip ${s.vert.form === k ? 'on' : ''}`, style: '--c:#2E7D32', 'aria-checked': String(s.vert.form === k),
          onclick: () => { if (s.vert.form === k) return; s.vert.form = k; s.vert.mal = {}; render(); } }, f.label))),
        h('p', { class: 'hint' }, `${F.text}${s.vert.form !== 'einzeln' && s.vert.form !== 'reihen' ? ' Baumarten mit Mindestgruppengröße (z. B. Eiche ab 0,3 ha) werden automatisch zu größeren Gruppen zusammengefasst.' : ''}`),
        mapEl,
        ...(s.vert.form === 'frei' ? freiWerkzeuge(pinselChip) : [
        h('p', { class: 'sheet-label' }, 'Übermalen'),
        h('div', { class: 'art-chips pinsel' }, pinselChip(null, 'Karte verschieben', '#2E7D32'), s.arten.map((x) => pinselChip(x.name, x.name, farbe(x.name))), pinselChip('__auto', 'Radierer (automatisch)', '#9E9E9E')),
        h('div', { class: 'art-chips', role: 'radiogroup', 'aria-label': 'Pinselgröße' }, Object.entries(PINSEL).map(([k, [l]]) => h('button', { type: 'button', role: 'radio', class: `art-chip ${pinselGroesse === k ? 'on' : ''}`, style: '--c:#6D4C41', 'aria-checked': String(pinselGroesse === k),
          onclick: () => { pinselGroesse = k; if (k === 'einzeln' && karte && karte.map.getZoom() < 19) karte.map.setZoom(19); render(); } }, l))),
        h('p', { class: 'hint' }, pinsel
          ? `Tippe oder wische über die Pflanzen, um sie ${pinsel === '__auto' ? 'wieder automatisch zu verteilen' : `zu ${pinsel} zu machen`}. Die Pflanzplätze bleiben stehen, nur die Baumart ändert sich.${pinselGroesse === 'einzeln' ? ' Für einzelne Pflanzen weit hineinzoomen (zwei Finger).' : ''} Zum Verschieben der Karte „Karte verschieben“ wählen.`
          : 'Wähle eine Baumart und übermale damit einzelne Pflanzen oder ganze Bereiche.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.vert.mal = {}; s.vert.seed = (s.vert.seed || 1) + 1; render(); } }, 'Neu mischen'),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.vert.mal = {}; render(); } }, 'Übermalung zurücksetzen')),
        ]),
        summeHost,
        hinweisHost,
        h('details', { class: 'weitere-arten' }, h('summary', {}, 'Hinweise zu den Baumarten'), h('ul', { class: 'lrt-punkte' }, b.zeilen.map((z) => h('li', {}, h('strong', {}, `${z.name}: `), z.info.hinweis)))),
        nav(true)];
    } else {
      const b = rechnen();
      const mwst = b.kosten * 0.07;
      inhalt = [
        h('div', { class: 'pflanzplan-karte' }, mapEl, h('ul', { class: 'legende' },
          b.zeilen.map((z) => h('li', {}, h('span', { class: 'swatch', style: `background:${z.info.farbe}` }), `${z.name} ${Math.round(z.anteilEcht * 100)} %`)),
          s.gassen.abstand ? h('li', {}, h('span', { class: 'swatch gasse' }), `Rückegasse alle ${s.gassen.abstand} m`) : null)),
        h('ul', { class: 'pflanz-liste' }, b.zeilen.map((z) => kostenZeile(z))),
        h('div', { class: 'zaun-summe' }, h('span', {}, 'Pflanzenkosten netto'), h('strong', {}, euro(b.kosten))),
        h('p', { class: 'hint' }, `zzgl. 7 % MwSt. ${euro(mwst)} = ${euro(b.kosten + mwst)} brutto · Preise nach der ${WBS_QUELLE}, eigene Preise werden im Gerät gespeichert.`),
        b.zeilen.some((z) => z.preis == null) ? h('p', { class: 'warn-line' }, 'Für einige Baumarten fehlt der Stückpreis – bitte eintragen.') : null,
        h('label', {}, 'Geplanter Pflanztermin', h('input', { type: 'date', value: s.date, onchange: (e) => { s.date = e.target.value; } })),
        h('label', {}, 'Notiz', h('textarea', { rows: 2, oninput: (e) => { s.note = e.target.value; } }, s.note)),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: () => pdfPlan(rechnen()) }, 'Pflanzplanungskarte als PDF')),
        h('div', { class: 'q-nav' },
          h('button', { type: 'button', class: 'btn', onclick: () => { schritt--; render(); } }, 'Zurück'),
          h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => speichern(rechnen()) }, 'Pflanzung buchen'))];
    }
    // Scrollposition merken: nur beim Schrittwechsel nach oben springen
    const pb = body.closest('.page-body'), oben = pb?.scrollTop || 0;
    fill(body, kopf, inhalt);
    const neu = schritt !== letzterSchritt; letzterSchritt = schritt;
    if (!karte) karteNeu();
    setTimeout(() => { karte?.map.invalidateSize(); if (neu && alle().length && schritt > 0) karte.map.fitBounds(L.latLngBounds(allePunkte()), { padding: [16, 16], maxZoom: 18 }); }, 60);
    zeichne(); renderStatus();
    if (pb) pb.scrollTop = neu ? 0 : oben;
  }

  function kostenZeile(z) {
    const x = s.arten.find((y) => y.name === z.name);
    const wbs = angebote(z.name);
    const a = angebot(x.wbsNr);
    const eigen = !a;
    const preisFeld = h('input', { inputmode: 'decimal', value: z.preis != null ? z.preis.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) : '', placeholder: '0,00', 'aria-label': `Preis je Stück ${z.name}`,
      onchange: (e) => { const v = zahl(e.target.value); x.preis = v; eigenenPreisMerken(z.name, x.sortiment, a && v === a.preis ? null : v); if (v == null && a) x.preis = a.preis; render(); } });
    return h('li', {},
      h('div', { class: 'mat-kopf' }, h('strong', {}, h('span', { class: 'dot', style: `background:${z.info.farbe}` }), ` ${z.name}`), h('span', { class: 'mat-menge' }, `${z.stueck.toLocaleString('de-DE')} Stück · ${z.verband}`)),
      h('label', {}, 'Sortiment', h('select', { onchange: (e) => {
        const nr = e.target.value;
        if (nr === 'eigen') { x.wbsNr = null; x.sortiment = ''; x.preis = null; } else { const o = angebot(nr); x.wbsNr = o.nr; x.sortiment = sortimentText(o); x.preis = eigenerPreis(z.name, x.sortiment) ?? o.preis; }
        render(); } },
        wbs.map((o) => h('option', { value: o.nr, selected: o.nr === x.wbsNr }, angebotText(o))),
        h('option', { value: 'eigen', selected: eigen }, 'Eigenes Sortiment / andere Baumschule'))),
      eigen ? h('label', {}, 'Sortiment (Alter, Höhe)', h('input', { value: x.sortiment || '', placeholder: 'z. B. 1/1, 30–50 cm', onchange: (e) => { x.sortiment = e.target.value.trim(); const p = eigenerPreis(z.name, x.sortiment); if (p != null) x.preis = p; render(); } })) : null,
      h('label', {}, 'Preis je Stück netto (€)', preisFeld),
      h('small', { class: 'muted' }, a ? (z.preis === a.preis ? `WBS-Preis${a.hkg ? ` · Herkunftsgebiet ${a.hkg}` : ''}` : `eigener Preis (WBS: ${euro(a.preis)})`) : 'eigener Preis – wird für die nächste Planung gemerkt'),
      h('small', { class: 'mat-summe' }, z.kosten != null ? `Kosten ${euro(z.kosten)}` : 'Preis fehlt'));
  }

  /** Werkzeuge für „Einzeln setzen“ */
  function freiWerkzeuge(pinselChip) {
    const anzahlRaster = () => pflanzLayout({ ring: alle(), arten: layoutArten(), gassen: s.gassen, form: 'einzeln', seed: s.vert.seed, mal: {}, reihe: s.reihe }).punkte;
    return [
      h('p', { class: 'sheet-label' }, 'Pflanzen setzen'),
      h('div', { class: 'art-chips pinsel' }, pinselChip(null, 'Karte verschieben', '#2E7D32'), s.arten.map((x) => pinselChip(x.name, x.name, farbe(x.name))),
        pinselChip('__move', 'Pflanze verschieben', '#1F74B8'), pinselChip('__auto', 'Entfernen', '#9E9E9E')),
      h('p', { class: 'hint' }, !pinsel ? 'Wähle eine Baumart und tippe auf die Fläche, um eine Pflanze zu setzen.'
        : pinsel === '__move' ? 'Pflanze antippen, festhalten und an die neue Stelle ziehen.'
          : pinsel === '__auto' ? 'Tippe auf eine Pflanze, um sie zu entfernen.'
            : `Tippe auf die Fläche, um eine ${pinsel} zu setzen. Tippst du auf eine vorhandene Pflanze, wird sie zur ${pinsel}. Für eine genaue Lage weit hineinzoomen.`),
      h('div', { class: 'btn-row' },
        !s.vert.frei.length ? h('button', { type: 'button', class: 'btn btn-small', onclick: async () => {
          const pk = anzahlRaster();
          if (pk.length > 5000 && !(await confirmDialog(`Das sind ${pk.length.toLocaleString('de-DE')} Pflanzen – trotzdem einzeln übernehmen?`, { ok: 'Übernehmen' }))) return;
          const lay = layout(true);
          s.vert.frei = pk.map(([x, y, art]) => [...lay.R.toLL([x, y]), art]);
          render();
        } }, 'Pflanzplätze aus dem Verband übernehmen') : null,
        s.vert.frei.length ? h('button', { type: 'button', class: 'btn btn-small', onclick: async () => { if (await confirmDialog('Alle gesetzten Pflanzen entfernen?', { ok: 'Entfernen', danger: true })) { s.vert.frei = []; render(); } } }, 'Alle entfernen') : null),
    ];
  }
  function aufteilung(b) {
    return h('div', { class: 'geo-card' }, h('p', { class: 'geo-kicker' }, 'Aufteilung'),
      h('ul', { class: 'mat-kurz' }, b.zeilen.map((z) => h('li', {}, h('span', { class: 'dot', style: `background:${z.info.farbe}` }), ` ${z.name}: ${z.stueck.toLocaleString('de-DE')} Stück${s.vert.form === 'frei' ? '' : ` auf ${formatHa(z.flaecheHa)}`} (${Math.round(z.anteilEcht * 100)} %)`))),
      h('p', {}, h('strong', {}, `${b.stueck.toLocaleString('de-DE')} Pflanzen auf ${formatHa(b.ha)}`)));
  }

  function mischHinweise() {
    const out = [];
    const namen = s.arten.map((x) => x.name);
    if (namen.includes('Rotbuche')) {
      const unter = namen.filter((n) => artInfo(n)?.buche === 'unterlegen');
      const mit = namen.filter((n) => artInfo(n)?.buche === 'mit');
      if (unter.length) out.push(`Rotbuche überwächst in der Jugend ${unter.join(', ')}: diese in eigenen Gruppen pflanzen (Eiche ab ca. 0,3 ha), nicht einzeln in die Buche.`);
      if (mit.length) out.push(`${mit.join(', ')} ${mit.length > 1 ? 'halten' : 'hält'} in der Jugend mit der Buche mit und ${mit.length > 1 ? 'können' : 'kann'} auch einzeln oder truppweise beigemischt werden.`);
    }
    const empfindlich = namen.filter((n) => ['Rotbuche', 'Weißtanne'].includes(n));
    if (s.art === 'wiederaufforstung' && empfindlich.length) out.push(`${empfindlich.join(' und ')} ${empfindlich.length > 1 ? 'vertragen' : 'verträgt'} die volle Freifläche schlecht (Spätfrost, Hitze): Seitenschutz nutzen oder einen Vorwald (z. B. Birke) mitpflanzen.`);
    if (namen.some((n) => ['Traubeneiche', 'Stieleiche'].includes(n)) && !namen.some((n) => artInfo(n)?.dienend)) out.push('Zur Eiche gehört eine dienende Baumart (Hainbuche oder Linde), die die Stämme beschattet.');
    const laub = s.arten.filter((x) => !nadelArt(x.name)).reduce((a, x) => a + (Number(x.anteil) || 0), 0);
    if (laub < 40) out.push(`Laubbaumanteil ${laub} % – für die Förderung nach der Richtlinie mindestens 40 % (Landesprogramm 30 %).`);
    if (s.arten.some((x) => Number(x.anteil) > 75) && flHa() > 1) out.push('Auf Flächen über 1 ha darf eine Baumart für die Förderung höchstens 75 % ausmachen.');
    return out.length ? h('div', { class: 'lrt-hinweis brutzeit' }, h('strong', {}, 'Hinweise zur Mischung'), h('ul', { class: 'lrt-punkte' }, out.map((t) => h('li', {}, t)))) : null;
  }
  function verteilHinweise(b) {
    const out = [];
    const namen = s.arten.map((x) => x.name);
    const form = s.vert.form, flaechig = form === 'einzeln' || form === 'reihen';
    const groessen = flaechig ? {} : gruppenGroessen(b.lay);
    for (const z of b.zeilen) {
      const a = z.info;
      // Konkurrenz: andere Baumarten, die nicht dienend sind und nicht zur selben Gruppe gehören
      const konkurrenz = namen.filter((n) => n !== z.name && !artInfo(n)?.dienend && artInfo(n)?.verband !== a.verband);
      if (a.buche === 'unterlegen' && namen.includes('Rotbuche') && flaechig) out.push(`${z.name} wird ${form === 'einzeln' ? 'einzeln' : 'reihenweise'} zwischen Rotbuche überwachsen – besser gruppen- oder horstweise mischen oder Gruppen übermalen.`);
      else if (a.gruppeHa >= 0.1 && konkurrenz.length && flaechig) out.push(`${z.name} sollte in Gruppen ab ca. ${dez(a.gruppeHa)} ha stehen, damit ${konkurrenz.join(', ')} ${konkurrenz.length > 1 ? 'sie' : 'sie'} nicht überwachsen.`);
      else if (a.gruppeHa > 0 && konkurrenz.length && !flaechig && groessen[z.name]?.length) {
        const max = Math.max(...groessen[z.name]);
        if (max < a.gruppeHa * 10000 * 0.8) out.push(`${z.name}-Gruppen sind höchstens ${formatHa(max / 10000)} groß – empfohlen sind mindestens ${formatHa(a.gruppeHa)}. Mit ${z.name} übermalen, um Gruppen zu vergrößern.`);
      }
      if (z.name === 'Vogelkirsche' && (form === 'gruppe' || form === 'horst')) out.push('Vogelkirsche steht besser einzeln bis truppweise, damit jede Krone frei wächst.');
      if (kategorie(a)?.[1] === 'warn' && z.flaecheHa > 0) out.push(`${z.name} ist laut Tabellenwerk für ${s.bzt.code} nicht empfohlen.`);
    }
    return out.length ? h('div', { class: 'lrt-hinweis brutzeit' }, h('strong', {}, 'Hinweise zur Verteilung'), h('ul', { class: 'lrt-punkte' }, out.map((t) => h('li', {}, t)))) : null;
  }

  // ---------- Pflanzplanungskarte (PDF) ----------
  /** Kartenrahmen ins PDF zeichnen: Ausschnitt passend zu den Ringen, Hintergrund wie in der App */
  async function pdfKarte(doc, { x, y, w, h, ringe, rand = 15, basemap }) {
    const alle = ringe.flat();
    const { xy, ll } = lokal(alle);
    const P = alle.map(xy);
    const minX = Math.min(...P.map((q) => q[0])), maxX = Math.max(...P.map((q) => q[0])), minY = Math.min(...P.map((q) => q[1])), maxY = Math.max(...P.map((q) => q[1]));
    const sk = Math.min((w - 2 * rand) / Math.max(1, maxX - minX), (h - 2 * rand) / Math.max(1, maxY - minY));
    const ox = x + (w - (maxX - minX) * sk) / 2, oy = y + (h - (maxY - minY) * sk) / 2;
    const tr = (p) => { const [a, c] = xy(p); return [ox + (a - minX) * sk, oy + (maxY - c) * sk]; };
    const ecke = (u, v) => ll([(u - ox) / sk + minX, maxY - (v - oy) / sk]);
    const [nord, west] = ecke(x, y), [sued, ost] = ecke(x + w, y + h);
    const hg = await kartenBild({ nord, sued, west, ost, basemap, breitePx: Math.round(w * 2.6) }).catch(() => null);
    doc.rechteck(x, y, w, h, { fill: [248, 250, 246] });
    if (hg) doc.bild(x, y, w, h, hg);
    doc.rechteck(x, y, w, h, { stroke: [170, 180, 170] });
    const nordpfeil = () => { doc.linie(x + w - 18, y + 38, x + w - 18, y + 16, { w: 1.4, farbe: [40, 50, 40] }); doc.text(x + w - 21, y + 12, 'N', { bold: true, size: 9 }); };
    const massstab = () => { const m = [5, 10, 20, 50, 100, 200, 500, 1000].find((v) => v * sk >= 45) || 1000; doc.linie(x + 12, y + h - 12, x + 12 + m * sk, y + h - 12, { w: 2, farbe: [40, 50, 40] }); doc.text(x + 12, y + h - 18, `${m.toLocaleString('de-DE')} m`, { size: 8 }); };
    return { tr, sk, hg, nordpfeil, massstab };
  }
  const linienZeichnen = (doc, tr, pts, stil) => { for (let i = 0; i + 1 < pts.length; i++) { const [x1, y1] = tr(pts[i]), [x2, y2] = tr(pts[i + 1]); doc.linie(x1, y1, x2, y2, stil); } };
  const pdfName = () => { const p = byId[s.parcelId]; return `Pflanzplan_${p ? `${p.gemarkung}_${p.nr}`.replace(/[^\wäöüÄÖÜß-]+/g, '_') : 'Flaeche'}.pdf`; };

  /** Pflanzplanungskarte als PDF erzeugen (für Ausgabe und Anhang) */
  async function planPdf(b) {
    const doc = new Pdf();
    const L0 = 50, R = 545;
    let y = 50;
    doc.text(L0, y, 'Pflanzplanungskarte', { bold: true, size: 18, farbe: [27, 77, 46] }); y += 18;
    const p = byId[s.parcelId];
    doc.text(L0, y, `${p ? `Flurstück ${p.nr}, ${p.gemarkung}, Flur ${p.flur} · ` : ''}Pflanzfläche ${formatHa(b.ha)} · ${s.art === 'voranbau' ? 'Voranbau' : 'Freifläche'} · ${FORMEN[s.vert.form].label}`, { size: 10 }); y += 14;
    if (s.bzt?.status === 'ok') { doc.text(L0, y, `Standort ${s.bzt.code} · ${s.bzt.wuchseinheitName} · Klimabereich ${s.bzt.klimabereichTabelle}`, { size: 9, farbe: [90, 100, 90] }); y += 14; }
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const basemap = store.get().settings?.basemap === 'dop' ? 'dop' : 'osm';
    toast('Pflanzplan wird erstellt …');
    // Hauptkarte: Pflanzfläche mit allen Pflanzplätzen
    const BH = 330;
    const K = await pdfKarte(doc, { x: L0, y, w: R - L0, h: BH, ringe: alle(), basemap });
    alle().forEach((r) => { doc.polygon([r.map(K.tr)], K.hg ? { stroke: [255, 255, 255], w: 3 } : { fill: [236, 242, 232], stroke: [46, 125, 50], w: 1.5 }); if (K.hg) doc.polygon([r.map(K.tr)], { stroke: [46, 125, 50], w: 1.5 }); });
    const lay = layout(true);
    if (lay.punkte.length <= 20000) {
      const d = s.vert.form === 'frei' ? Math.max(4, Math.min(8, K.sk * 2)) : Math.max(0.7, Math.min(3, K.sk * 1.2));
      for (const [px, py, art] of lay.punkte) { const [u, v] = K.tr(lay.R.toLL([px, py])); doc.rechteck(u - d / 2, v - d / 2, d, d, { fill: rgb(farbe(art)) }); }
    } else for (const st of streifen(lay)) doc.polygon([st.ring.map(K.tr)], { fill: rgb(farbe(st.art)), stroke: null });
    gassenLinien(alle(), s.gassen).forEach(({ linie }) => linienZeichnen(doc, K.tr, linie, { w: Math.max(1, s.gassen.breite * K.sk), farbe: [205, 180, 150] }));
    K.nordpfeil(); K.massstab();
    y += BH + 9;
    doc.text(L0, y, K.hg ? `Hintergrund: ${KARTEN_QUELLE[basemap]}` : 'Ohne Hintergrund: Die Karte konnte nicht geladen werden (keine Verbindung?).', { size: 7, farbe: [110, 120, 110] });
    y += 12;
    // Übersicht: ganzes Flurstück, Pflanzfläche markiert
    const UW = 245, UH = 170;
    const flRinge = p ? polysOf(p).map((poly) => poly[0]) : [];
    const U = await pdfKarte(doc, { x: L0, y, w: UW, h: UH, ringe: [...flRinge, ...alle()], rand: flRinge.length ? 14 : 60, basemap });
    flRinge.forEach((r) => { doc.polygon([r.map(U.tr)], { stroke: [255, 255, 255], w: 3.2 }); doc.polygon([r.map(U.tr)], { stroke: [230, 160, 0], w: 1.8 }); });
    alle().forEach((r) => doc.polygon([r.map(U.tr)], { fill: [46, 125, 50], stroke: [255, 255, 255], w: 1 }));
    U.nordpfeil(); U.massstab();
    const tx = L0 + UW + 16;
    let ty = y + 12;
    const zeile = (t, o = {}) => { doc.text(tx, ty, t, { size: 9, ...o }); ty += 13; };
    zeile('Lage der Pflanzfläche', { bold: true, size: 10 }); ty += 2;
    if (p) {
      zeile(`Flurstück ${p.nr} · Flur ${p.flur}`); zeile(`Gemarkung ${p.gemarkung}`);
      const flHa = areaHa(p.ring);
      zeile(`Flurstück ${formatHa(flHa)}, davon Pflanzfläche ${formatHa(b.ha)} (${Math.round((b.ha / Math.max(flHa, 1e-9)) * 100)} %)`);
    } else zeile(`Pflanzfläche ${formatHa(b.ha)} (ohne Flurstückszuordnung)`);
    const c = centroid(allePunkte());
    if (alle().length > 1) zeile(`${alle().length} Einzelflächen: ${alle().map((r) => formatHa(areaHa(r))).join(', ')}`);
    zeile(`Mittelpunkt ${c[0].toFixed(5)} N, ${c[1].toFixed(5)} O`);
    if (s.date) zeile(`Geplanter Pflanztermin ${new Date(s.date).toLocaleDateString('de-DE')}`);
    ty += 4;
    doc.rechteck(tx, ty - 8, 10, 8, { fill: [46, 125, 50] }); doc.text(tx + 15, ty, 'Pflanzfläche', { size: 8.5 }); ty += 13;
    if (flRinge.length) { doc.linie(tx, ty - 4, tx + 10, ty - 4, { w: 1.8, farbe: [230, 160, 0] }); doc.text(tx + 15, ty, 'Flurstücksgrenze', { size: 8.5 }); }
    y += UH + 18;
    // Tabelle
    const sp = [L0, L0 + 118, L0 + 160, L0 + 212, L0 + 262, L0 + 330, L0 + 420];
    const kopf = () => { ['Baumart', 'Anteil', 'Fläche', 'Stück', 'Verband', 'Sortiment', 'Kosten netto'].forEach((t, i) => doc.text(sp[i], y, t, { bold: true, size: 8.5 })); y += 6; doc.linie(L0, y, R, y); y += 12; };
    kopf();
    for (const z of b.zeilen) {
      if (y > 790) { doc.neueSeite(); y = 50; kopf(); }
      doc.rechteck(L0, y - 8, 8, 8, { fill: rgb(z.info.farbe) });
      doc.text(L0 + 12, y, z.name, { size: 8.5 }); doc.text(sp[1], y, `${Math.round(z.anteilEcht * 100)} %`, { size: 8.5 }); doc.text(sp[2], y, formatHa(z.flaecheHa), { size: 8.5 });
      doc.text(sp[3], y, z.stueck.toLocaleString('de-DE'), { size: 8.5 }); doc.text(sp[4], y, s.vert.form === 'frei' ? 'frei gesetzt' : z.verband, { size: 8.5 }); doc.text(sp[5], y, z.sortiment || '–', { size: 8.5 });
      doc.text(sp[6], y, z.kosten != null ? euro(z.kosten) : '–', { size: 8.5 });
      y += 13;
    }
    if (y > 770) { doc.neueSeite(); y = 50; }
    doc.linie(L0, y - 6, R, y - 6); y += 4;
    const gassenText = s.gassen.modus === 'frei' ? ` · ${(s.gassen.linien || []).length} Rückegassen eingezeichnet, ${dez(s.gassen.breite)} m breit` : s.gassen.abstand ? ` · Rückegassen alle ${s.gassen.abstand} m, ${dez(s.gassen.breite)} m breit` : '';
    doc.text(L0, y, `Gesamt ${b.stueck.toLocaleString('de-DE')} Pflanzen · Pflanzenkosten ${euro(b.kosten)} netto (${euro(b.kosten * 1.07)} brutto)${gassenText}`, { bold: true, size: 9 });
    y += 16;
    doc.text(L0, y, 'Jedes Kästchen in der Karte ist ein Pflanzplatz. Pflanzenzahlen nach den Rahmenpflanzverbänden (Richtlinie 2025, Anlage 3);', { size: 7.5, farbe: [90, 100, 90] }); y += 10;
    doc.text(L0, y, `Baumartenempfehlung nach dem Tabellenwerk von ThüringenForst; Preise nach der ${WBS_QUELLE} bzw. eigenen Angaben.`, { size: 7.5, farbe: [90, 100, 90] });
    return doc.blob();
  }
  async function pdfPlan(b) {
    try { herunterladen(await planPdf(b), pdfName(), { titel: 'Pflanzplanungskarte' }); }
    catch (e) { console.error(e); toast('Der Pflanzplan konnte nicht erstellt werden.'); }
  }

  // ---------- Speichern ----------
  async function speichern(b) {
    const neuId = uid();
    const haupt = [...b.zeilen].sort((x, y) => y.stueck - x.stueck)[0];
    store.update((st) => st.measures.push({
      id: neuId, type: 'pflanzung', parcelId: s.parcelId, date: s.date ? new Date(s.date).getTime() : null, status: 'geplant', createdAt: Date.now(), note: s.note.trim(),
      details: { species: haupt?.name || '', count: String(b.stueck), area: dez(b.ha, 2), verband: b.zeilen.map((z) => `${z.name} ${z.verband}`).join('; ') },
      flaeche: { ring: [...groesste()], ringe: alle().map((r) => [...r]), ha: b.ha },
      pflanzplan: { art: s.art, reihe: s.reihe, gassen: JSON.parse(JSON.stringify(s.gassen)), netto: b.ha ? b.nettoHa / b.ha : 1, grund: s.grund, zonen: [],
        vert: { form: s.vert.form, seed: s.vert.seed, mal: { ...s.vert.mal }, frei: s.vert.form === 'frei' ? s.vert.frei.map((q) => [...q]) : undefined },
        vorgabe: s.arten.map((x) => ({ name: x.name, anteil: Number(x.anteil) || 0, nHa: x.nHa, gruppeHa: artInfo(x.name)?.gruppeHa || 0 })),
        arten: b.zeilen.map((z) => ({ name: z.name, code: z.info.code, anteil: Math.round(z.anteilEcht * 1000) / 10, flaecheHa: Math.round(z.flaecheHa * 10000) / 10000, nHa: z.nHa, stueck: z.stueck, verband: z.verband, sortiment: z.sortiment || '', wbsNr: z.wbsNr ?? null, preis: z.preis, kosten: z.kosten })),
        standort: s.bzt?.status === 'ok' ? { einheit: s.standort?.einheit, code: s.bzt.code, wuchseinheit: s.bzt.wuchseinheit, klimabereich: s.bzt.klimabereichTabelle } : null },
      kosten: Math.round(b.kosten * 100) / 100,
    }));
    toast(`Pflanzung gebucht: ${b.stueck.toLocaleString('de-DE')} Pflanzen auf ${formatHa(b.ha)}`);
    // Pflanzplanungskarte als PDF an die Pflanzung hängen (im Hintergrund, die Karte wird dafür geladen)
    const anhangId = uid(), name = pdfName();
    planPdf(b).then(async (blob) => {
      await dateiSpeichern(anhangId, blob);
      store.update((st) => { const m = st.measures.find((x) => x.id === neuId); if (m) (m.anhaenge ||= []).push({ id: anhangId, typ: 'pflanzplan', titel: 'Pflanzplanungskarte (PDF)', erstellt: Date.now(), datei: anhangId, name }); });
      toast('Pflanzplan als Anhang an der Pflanzung gespeichert');
    }).catch((e) => { console.error(e); toast('Der Pflanzplan konnte nicht als Anhang gespeichert werden.'); });
    umlauf?.stop();
    const wahl = await dialog({ title: 'Wildschutz für die Pflanzung?', body: await schutzVergleich(b),
      actions: [{ label: 'Kein Wildschutz', value: null }, { label: 'Einzelschutz', value: 'einzel' }, { label: 'Zaun', value: 'zaun', primary: true }] });
    page.close();
    if (wahl === 'zaun') {
      const { openZaunPlanung } = await import('./zaun.js');
      openZaunPlanung({ parcelId: s.parcelId, pts: groesste(), foerdern, quelle: alle().length > 1 ? `Zaunverlauf der größten Einzelfläche übernommen (${alle().length} Einzelflächen) – für die übrigen bitte jeweils einen eigenen Zaun planen.` : 'Zaunverlauf aus der Pflanzfläche übernommen – Punkte lassen sich anpassen.',
        onSaved: (zid) => onSaved?.([neuId, zid]), onAbbruch: () => onSaved?.([neuId]) });
    } else if (wahl === 'einzel') {
      const { openEinzelschutzPlanung } = await import('./einzelschutz.js');
      openEinzelschutzPlanung({ pflanzung: store.get().measures.find((m) => m.id === neuId), foerdern,
        onSaved: (eid) => onSaved?.([neuId, eid]), onAbbruch: () => onSaved?.([neuId]) });
    } else onSaved?.([neuId]);
  }

  /** Grober Vergleich Zaun – Einzelschutz für diese Fläche (Material netto, Förderung nach der Richtlinie) */
  async function schutzVergleich(b) {
    const [{ materialListe }, { SAETZE }] = await Promise.all([import('./zaun.js'), import('./foerder-formular.js')]);
    let zaunMat = 0, lfm = 0;
    for (const r of alle()) {
      const ml = materialListe({ pts: r, geschlossen: true, hoehe: 160 });
      zaunMat += ml.posten.reduce((a, x) => a + (x.preise?.length ? Math.min(...x.preise.map((q) => q.preis)) * x.menge : 0), 0);
      lfm += ml.geo.laenge;
    }
    lfm = Math.round(lfm);
    const es = b.zeilen.filter((z) => !['Gemeine Fichte', 'Gemeine Kiefer', 'Schwarzkiefer', 'Schwarzerle', 'Sandbirke', 'Aspe', 'Robinie', 'Blaufichte'].includes(z.name)).reduce((a, z) => a + z.stueck, 0) || b.stueck;
    const proHa = b.ha ? Math.round(b.stueck / b.ha) : 0;
    return h('div', { class: 'dialog-body' },
      h('p', {}, 'Die Daten der Pflanzung werden übernommen – für den Zaun die Fläche als Zaunverlauf, für den Einzelschutz Baumarten und Stückzahlen.'),
      h('table', { class: 'vergleich' },
        h('tr', {}, h('th', {}, ''), h('th', {}, 'Zaun (Rehwild)'), h('th', {}, 'Einzelschutz')),
        h('tr', {}, h('td', {}, 'Umfang'), h('td', {}, `${lfm.toLocaleString('de-DE')} lfm`), h('td', {}, `ca. ${es.toLocaleString('de-DE')} Stück`)),
        h('tr', {}, h('td', {}, 'Material netto'), h('td', {}, `ca. ${euro(zaunMat)}`), h('td', {}, 'je nach Angebot')),
        h('tr', {}, h('td', {}, 'Förderung'), h('td', {}, `${euro(SAETZE.GANW.zaun.reh * lfm)}`), h('td', {}, `${euro(SAETZE.GANW.es.klein * es)} (ab 1,20 m)`))),
      h('p', { class: 'muted' }, proHa > 1500 ? `Bei ${proHa.toLocaleString('de-DE')} Pflanzen je ha ist ein Zaun meist günstiger. Einzelschutz lohnt sich eher für wenige, wertvolle Pflanzen (Eiche, Kirsche, Tanne) oder kleine Flächen.`
        : `Bei ${proHa.toLocaleString('de-DE')} Pflanzen je ha kann Einzelschutz günstiger sein als ein Zaun – vergleiche die Angebote.`),
      h('p', { class: 'muted' }, 'Förderung nach der Richtlinie (Teil A); im Landesprogramm sind die Sätze höher.'));
  }

  render();
  return page;
}

