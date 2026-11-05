// Pflanzplanung: Pflanzfläche in der Karte zeichnen oder mit dem GPS umlaufen → Baumarten nach Standort
// (BZT-Tabellenwerk) wählen → Pflanzenzahl nach den Rahmenpflanzverbänden (Richtlinie 2025, Anlage 3) unter
// Abzug der Rückegassen → Pflanzverband je Baumart → Baumarten in der Karte verteilen → Pflanzplanungskarte
// mit Kosten. Danach optional Zaun um die Fläche und Förderantrag.
import { h, fill, openPage, toast, dialog } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { areaHa, formatHa, centroid, pointInPolygon } from './geo.js';
import { miniKarte } from './flaeche.js';
import { umlaufSteuerung, vereinfachen } from './umlauf.js';
import { Pdf, herunterladen } from './pdf.js';

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
const A = (name, code, verband, licht, gruppeHa, farbe, hinweis, codes = []) => ({ name, code, codes: [code, ...codes], verband, licht, gruppeHa, farbe, hinweis });
export const PFLANZ_ARTEN = [
  A('Traubeneiche', 'EI', 'eiche', 'licht', 0.3, '#C9A227', 'Lichtbaumart, in der Jugend langsamer als Buche: in Gruppen oder Horsten ab ca. 0,3 ha pflanzen, nicht einzeln zwischen Buche. Dienende Baumarten (Hainbuche, Linde) halten die Stämme astrein. Trockene, mittlere bis reiche Standorte.'),
  A('Stieleiche', 'EI', 'eiche', 'licht', 0.3, '#B08A1E', 'Lichtbaumart für frische bis feuchte, auch wechselfeuchte Standorte. In Gruppen ab ca. 0,3 ha mit dienender Hainbuche oder Linde.'),
  A('Roteiche', 'EI', 'roteiche', 'licht', 0.1, '#B5532E', 'Nicht heimisch, wüchsig und trockenheitstolerant auf armen, trockenen oder wechselfeuchten Standorten. Gruppenweise; ausschließlich standortheimische Pflanzung (85 % Förderung) ist dann nicht erfüllt.'),
  A('Rotbuche', 'BU', 'buche', 'schatten', 0, '#2E8B57', 'Schattbaumart, sehr konkurrenzstark – überwächst Lichtbaumarten. Spätfrost- und hitzeempfindlich: am besten unter Schirm oder mit Seitenschutz. Lichtbaumarten daneben in eigenen Gruppen.'),
  A('Bergahorn', 'ELB', 'elb', 'halb', 0.05, '#7FB069', 'Raschwüchsig, braucht frische, nährstoffreiche Böden. Trupp- bis gruppenweise beimischen; wächst der Buche in der Jugend davon.'),
  A('Spitzahorn', 'ELB', 'elb', 'halb', 0.05, '#9BC37E', 'Trockenheitstoleranter als Bergahorn, für mittlere bis reiche Standorte. Trupp- bis gruppenweise.'),
  A('Feldahorn', 'ELB', 'elb', 'halb', 0, '#B5D49A', 'Kleinbleibend, wärme- und trockenheitsliebend; gut für Waldränder und als dienende Baumart.'),
  A('Esche', 'ELB', 'elb', 'licht', 0.05, '#5E9A3A', 'Wegen des Eschentriebsterbens nur gering beimischen. Braucht frische bis feuchte, reiche Böden.'),
  A('Bergulme', 'ELB', 'elb', 'halb', 0, '#6B8E23', 'Für frische, reiche Standorte; wegen Ulmensterben nur als Beimischung.'),
  A('Flatterulme', 'ELB', 'elb', 'halb', 0, '#8DA75A', 'Für feuchte Auen- und Bachstandorte; als Beimischung.'),
  A('Hainbuche', 'HBU', 'elb', 'schatten', 0, '#4C7A5B', 'Schattenverträglich, dienende Baumart unter und neben Eiche. Auch für Waldränder.'),
  A('Winterlinde', 'LI', 'linde', 'schatten', 0, '#86A86B', 'Schattenverträglich, verbessert den Boden; dienende Baumart zur Eiche, in Gruppen mit Eiche, Kirsche oder Edellaubholz.', ['WLI', 'WLB']),
  A('Sommerlinde', 'LI', 'linde', 'schatten', 0, '#A1BE88', 'Wie Winterlinde, etwas anspruchsvoller an Boden und Wasser.', ['WLI']),
  A('Vogelkirsche', 'KB', 'kirsche', 'licht', 0, '#C2185B', 'Lichtbaumart, Wertholz: einzeln bis truppweise mit Abstand, z. B. in Lücken oder am Rand, damit die Krone frei bleibt.'),
  A('Elsbeere', 'EL', 'sorbus', 'licht', 0, '#AD5D2E', 'Wärmeliebend, trockenheitstolerant; einzeln bis truppweise auf mittleren bis reichen, warmen Standorten.'),
  A('Speierling', 'EL', 'sorbus', 'licht', 0, '#C47A47', 'Seltene Wertholzart warmer, trockener Lagen; einzeln oder truppweise.'),
  A('Wildbirne', 'WO', 'kirsche', 'licht', 0, '#9C8AA5', 'Lichtbaumart; einzeln am Rand oder in Lücken.'),
  A('Wildapfel', 'WO', 'kirsche', 'licht', 0, '#B7A3C1', 'Lichtbaumart; einzeln am Rand oder in Lücken.'),
  A('Eberesche', 'EB', 'sorbus', 'licht', 0, '#E07A5F', 'Pionierbaumart, schnell und anspruchslos; als Vorwald oder Beimischung, besonders in kühlen, feuchten Lagen.', ['WLB']),
  A('Sandbirke', 'BI', 'erle', 'licht', 0, '#E6D3A3', 'Pionierbaumart: schnell, anspruchslos, kurzlebig. Als Vorwald oder am Rand; kann Hauptbaumarten bedrängen – rechtzeitig entnehmen.', ['WLB']),
  A('Aspe', 'AS', 'pappel', 'licht', 0, '#D8C99B', 'Pionierbaumart, wüchsig; als Vorwald oder truppweise.', ['WLB']),
  A('Schwarzerle', 'ER', 'erle', 'licht', 0, '#5B7F95', 'Für nasse und quellige Standorte, Bachränder; dort gruppen- bis flächenweise.'),
  A('Weißtanne', 'WTA', 'nadel', 'schatten', 0, '#2F4F4F', 'Schattbaumart, frost- und wildverbissempfindlich: nur unter Schirm oder mit Seitenschutz pflanzen, schützen. Tiefwurzler, stabilisiert Mischbestände.'),
  A('Gemeine Fichte', 'FI', 'fichte', 'halb', 0, '#5F6B73', 'Flachwurzler, anfällig für Sturm, Trockenheit und Borkenkäfer; in Thüringen nur noch beimischen.'),
  A('Gemeine Kiefer', 'KI', 'kiefer', 'licht', 0.1, '#BF8034', 'Lichtbaumart, anspruchslos und trockenheitstolerant; für arme und trockene Standorte, gruppen- bis flächenweise.'),
  A('Europäische Lärche', 'LA', 'nadel', 'licht', 0, '#E57399', 'Extreme Lichtbaumart, in der Jugend vorwüchsig: einzeln bis truppweise oder am Rand, nicht unter Schirm.'),
  A('Douglasie', 'DGL', 'nadel', 'halb', 0.1, '#4B6E8A', 'Wüchsig und trockenheitstoleranter als Fichte; gruppenweise beimischen, nicht auf Kalk- oder vernässten Böden.'),
];
export const artInfo = (name) => PFLANZ_ARTEN.find((a) => a.name === name);
const zahl = (v) => { const s = String(v ?? '').trim().replace(/\./g, '').replace(',', '.'); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
const euro = (v) => `${Number(v || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dez = (v, d = 1) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const verbandText = (nHa) => `${dez(REIHE)} × ${dez(10000 / (nHa * REIHE), 2)} m`;
const PREIS_KEY = 'waldwaechter.pflanzpreise';
const preiseLaden = () => { try { return JSON.parse(localStorage.getItem(PREIS_KEY) || '{}'); } catch { return {}; } };

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
/** Rückegassen als Linien (Mittelachsen) innerhalb der Fläche */
export function gassenLinien(ring, abstand, winkel) {
  if (!abstand) return [];
  const { xy, ll } = lokal(ring);
  const t = (-winkel * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const rot = ([x, y]) => [x * c - y * s, x * s + y * c];
  const back = ([x, y]) => [x * c + y * s, -x * s + y * c];
  const P = ring.map((p) => rot(xy(p)));
  const ys = P.map((p) => p[1]);
  const out = [];
  for (let y = Math.min(...ys) + abstand / 2; y < Math.max(...ys); y += abstand) {
    const xs = [];
    for (let i = 0; i < P.length; i++) {
      const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) out.push([ll(back([xs[k], y])), ll(back([xs[k + 1], y]))]);
  }
  return out;
}
/** Flächenanteile je Baumart aus den eingezeichneten Mischungsgruppen (Rasterpunkte); Rest = Grundbestand */
export function zonenFlaechen(ring, zonen, grund) {
  const ha = areaHa(ring);
  const schritt = Math.max(2, Math.sqrt((ha * 10000) / 15000));
  const { xy, ll } = lokal(ring);
  const P = ring.map(xy);
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  const zaehl = {};
  let n = 0;
  for (let x = Math.min(...xs) + schritt / 2; x < Math.max(...xs); x += schritt) {
    for (let y = Math.min(...ys) + schritt / 2; y < Math.max(...ys); y += schritt) {
      const pt = ll([x, y]);
      if (!pointInPolygon(pt, ring)) continue;
      n++;
      let art = grund;
      for (const z of zonen) if (pointInPolygon(pt, z.ring)) art = z.name; // später gezeichnete Gruppen liegen oben
      zaehl[art] = (zaehl[art] || 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(zaehl).map(([k, v]) => [k, (v / Math.max(1, n)) * ha]));
}

export async function openPflanzPlanung({ parcelId = null, foerdern = false, onSaved, vorgabe = null } = {}) {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id]);
  const preise = preiseLaden();
  const s = vorgabe || {
    parcelId: parcelId || mine[0]?.id || null, ring: [], art: 'wiederaufforstung', arten: [], zonen: [], grund: null,
    gassen: { abstand: 20, breite: 4, winkel: null }, date: '', note: '', bzt: null, standort: null,
  };
  let schritt = 0;
  const SCHRITTE = ['Pflanzfläche', 'Baumarten', 'Pflanzenzahl und Verband', 'Baumarten verteilen', 'Pflanzplan und Kosten'];
  const body = h('div', { class: 'pflanzung' });
  let karte = null, umlauf = null, zeichnenModus = 'flaeche', zone = null;
  const page = openPage('Pflanzung planen', body, { onClose: () => { umlauf?.stop(); karte?.remove(); } });
  const mapEl = h('div', { class: 'mini-map zaun-map' });
  const status = h('p', { class: 'draw-status', 'aria-live': 'polite' });
  const umlaufHost = h('div');
  const lyr = L.layerGroup();

  // ---------- Karte ----------
  function karteNeu() {
    umlauf?.stop(); karte?.remove();
    karte = miniKarte(mapEl, byId[s.parcelId] || null, { zoom: 17 });
    karte.map.doubleClickZoom.disable();
    lyr.addTo(karte.map);
    karte.map.on('click', (e) => klick([e.latlng.lat, e.latlng.lng]));
    umlauf = umlaufSteuerung({ map: karte.map, text: 'Fläche umlaufen',
      onPunkt: (ll) => klick(ll),
      onEnde: () => { if (zeichnenModus === 'flaeche') s.ring = vereinfachen(s.ring, 1.5); else if (zone) zone.ring = vereinfachen(zone.ring, 1.5); zeichne(); render(); } });
    fill(umlaufHost, umlauf.el);
    if (s.ring.length >= 3) setTimeout(() => karte.map.fitBounds(L.latLngBounds(s.ring), { padding: [20, 20], maxZoom: 18 }), 120);
  }
  function klick(ll) {
    if (zeichnenModus === 'flaeche' && schritt === 0) { s.ring.push(ll); s.standort = null; s.bzt = null; zeichne(); renderStatus(); return; }
    if (zeichnenModus === 'zone' && zone) { zone.ring.push(ll); zeichne(); renderStatus(); }
  }
  function zeichne() {
    lyr.clearLayers();
    if (s.ring.length >= 2) L.polygon(s.ring, { color: '#2E7D32', weight: 3, fillColor: farbe(s.grund), fillOpacity: s.grund && schritt >= 3 ? 0.35 : 0.12, interactive: false }).addTo(lyr);
    if (schritt === 0) s.ring.forEach((ll) => L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: '#2E7D32', fillOpacity: 1, interactive: false }).addTo(lyr));
    if (schritt >= 2 && s.ring.length >= 3) {
      if (s.gassen.winkel == null) s.gassen.winkel = Math.round(hauptRichtung(s.ring));
      gassenLinien(s.ring, s.gassen.abstand, s.gassen.winkel).forEach((l) => L.polyline(l, { color: '#8D6E63', weight: 4, opacity: 0.85, dashArray: '8 6', interactive: false }).addTo(lyr));
    }
    if (schritt >= 3) {
      for (const z of s.zonen) if (z.ring.length >= 2) L.polygon(z.ring, { color: '#fff', weight: 2, fillColor: farbe(z.name), fillOpacity: 0.7, interactive: false }).addTo(lyr);
      if (zone) zone.ring.forEach((ll) => L.circleMarker(ll, { radius: 5, color: '#fff', weight: 2, fillColor: farbe(zone.name), fillOpacity: 1, interactive: false }).addTo(lyr));
    }
  }
  const farbe = (name) => artInfo(name)?.farbe || '#2E7D32';
  function renderStatus() {
    if (schritt === 0) status.textContent = s.ring.length >= 3 ? `Pflanzfläche ${formatHa(areaHa(s.ring))} · ${s.ring.length} Eckpunkte` : `${s.ring.length} von mindestens 3 Eckpunkten – tippe die Ecken in die Karte oder lauf die Fläche mit dem GPS ab.`;
    else if (schritt === 3 && zone) status.textContent = `${zone.name}: ${zone.ring.length} Punkte${zone.ring.length >= 3 ? `, ${formatHa(areaHa(zone.ring))}` : ''} – tippe die Gruppe in die Karte.`;
    else if (s.ring.length >= 3) status.textContent = `Pflanzfläche ${formatHa(areaHa(s.ring))}`;
  }

  // ---------- Standort und Empfehlung ----------
  async function standortLaden() {
    if (s.bzt || s.ring.length < 3) return;
    const c = centroid(s.ring);
    try {
      const [{ queryPoint }, { empfehlung }] = await Promise.all([import('./map/geoinfo.js'), import('./bzt.js')]);
      const info = await queryPoint(c);
      const sp = info.standort || {};
      s.standort = { einheit: String(sp.Standortseinheiten || '').trim(), gruppe: String(sp.Standortsguppe || sp.Standortsgruppe || '').trim(), text: sp.Beschreibung || '' };
      s.bzt = (s.standort.einheit || s.standort.gruppe) ? await empfehlung(c, s.standort) : { status: 'keinStandort' };
    } catch { s.bzt = { status: 'fehler' }; }
    if (schritt === 1) render();
  }
  function kategorie(a) {
    const e = s.bzt?.status === 'ok' ? s.bzt.eintrag : null;
    if (!e) return null;
    if (a.codes.some((c) => e.B.includes(c))) return ['Hauptbaumart', 'ok'];
    if (a.codes.some((c) => e.C.includes(c))) return ['Mischbaumart', 'ok'];
    if (a.codes.some((c) => e.D.includes(c))) return ['Nebenbaumart', 'neben'];
    return ['für diesen Standort nicht empfohlen', 'warn'];
  }

  // ---------- Berechnung ----------
  const netto = () => (s.gassen.abstand ? Math.max(0, 1 - s.gassen.breite / s.gassen.abstand) : 1);
  function rechnen() {
    const ha = s.ring.length >= 3 ? areaHa(s.ring) : 0;
    const zonen = s.zonen.filter((z) => z.ring.length >= 3);
    const ausZonen = zonen.length > 0;
    // Gruppen: Fläche der eingezeichneten Gruppen je Baumart; übrige Fläche: Mischung der Baumarten ohne eigene Gruppe nach ihren Anteilen
    const fl = ausZonen ? zonenFlaechen(s.ring, zonen, '__rest') : null;
    const mitGruppe = new Set(zonen.map((z) => z.name));
    const rest = fl ? (fl.__rest || 0) : ha;
    const ohne = s.arten.filter((x) => !mitGruppe.has(x.name));
    const summeOhne = ohne.reduce((a, x) => a + (Number(x.anteil) || 0), 0) || 1;
    const summeAnteil = s.arten.reduce((a, x) => a + (Number(x.anteil) || 0), 0) || 1;
    const zeilen = s.arten.map((x) => {
      const info = artInfo(x.name); const V = VERBAND[info?.verband || 'elb'][s.art === 'voranbau' ? 'voranbau' : 'frei'];
      x.nHa ??= Math.round((V[0] + V[1]) / 2 / 100) * 100;
      const flaecheHa = !fl ? ha * ((Number(x.anteil) || 0) / summeAnteil)
        : mitGruppe.has(x.name) ? (fl[x.name] || 0) : rest * ((Number(x.anteil) || 0) / summeOhne);
      const stueck = Math.round(flaecheHa * netto() * x.nHa);
      const preis = zahl(x.preis);
      return { ...x, info, V, flaecheHa, anteilEcht: ha ? flaecheHa / ha : 0, stueck, verband: verbandText(x.nHa), preis, kosten: preis != null ? preis * stueck : null, gruppe: mitGruppe.has(x.name) };
    });
    // Farbe der übrigen Fläche: größte Baumart ohne eigene Gruppe
    s.grund = [...zeilen].filter((z) => !z.gruppe).sort((a, b) => b.flaecheHa - a.flaecheHa)[0]?.name || s.arten[0]?.name || null;
    return { ha, nettoHa: ha * netto(), zeilen, stueck: zeilen.reduce((a, z) => a + z.stueck, 0), kosten: zeilen.reduce((a, z) => a + (z.kosten || 0), 0), ausZonen, rest };
  }

  // ---------- Schritte ----------
  function render() {
    zeichnenModus = schritt === 3 && zone ? 'zone' : 'flaeche';
    if (s.arten.length) rechnen();
    const kopf = [h('div', { class: 'q-progress' }, SCHRITTE.map((_, k) => h('span', { class: k < schritt ? 'done' : k === schritt ? 'now' : '' }))),
      h('h2', { class: 'step-title' }, SCHRITTE[schritt])];
    const nav = (weiterOk = true, weiterText = 'Weiter') => h('div', { class: 'q-nav' },
      h('button', { type: 'button', class: 'btn', onclick: () => { if (schritt === 0) page.close(); else { schritt--; zone = null; render(); } } }, schritt === 0 ? 'Abbrechen' : 'Zurück'),
      h('button', { type: 'button', class: 'btn btn-primary btn-large', disabled: !weiterOk, onclick: () => { schritt++; zone = null; render(); } }, weiterText));
    let inhalt = [];
    if (schritt === 0) {
      inhalt = [
        foerdern ? h('div', { class: 'lrt-hinweis ok' }, h('strong', {}, 'Mit Förderantrag'), h('p', {}, 'Nach der Planung geht es direkt mit dem Förderantrag weiter.')) : null,
        h('label', {}, 'Flurstück', h('select', { onchange: (e) => { s.parcelId = e.target.value || null; s.ring = []; karteNeu(); zeichne(); render(); } },
          h('option', { value: '' }, 'ohne Flächenzuordnung'), mine.map((p) => h('option', { value: p.id, selected: p.id === s.parcelId }, `Flurstück ${p.nr}, ${p.gemarkung}`)))),
        h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Art der Pflanzung' },
          [['wiederaufforstung', 'Freifläche / Wiederaufforstung'], ['voranbau', 'Voranbau unter Schirm']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.art === k), onclick: () => { s.art = k; s.arten.forEach((x) => { x.nHa = null; }); render(); } }, l))),
        mapEl, status, umlaufHost,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.ring.pop(); zeichne(); renderStatus(); render(); } }, 'Letzten Punkt entfernen'),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.ring = []; zeichne(); renderStatus(); render(); } }, 'Neu beginnen'),
          byId[s.parcelId] ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.ring = [...byId[s.parcelId].ring]; zeichne(); renderStatus(); render(); } }, 'Ganzes Flurstück') : null),
        nav(s.ring.length >= 3)];
    } else if (schritt === 1) {
      standortLaden();
      const r = s.bzt;
      const gewaehlt = new Set(s.arten.map((x) => x.name));
      const empf = r?.status === 'ok' ? PFLANZ_ARTEN.filter((a) => kategorie(a)?.[1] !== 'warn') : [];
      const toggle = (a) => {
        if (gewaehlt.has(a.name)) s.arten = s.arten.filter((x) => x.name !== a.name);
        else s.arten.push({ name: a.name, anteil: s.arten.length ? 20 : 60, nHa: null, sortiment: '', preis: preise[a.name] ?? '' });
        if (!s.arten.some((x) => x.name === s.grund)) s.grund = s.arten[0]?.name || null;
        render();
      };
      const chip = (a) => { const k = kategorie(a); return h('button', { type: 'button', class: `art-chip ${gewaehlt.has(a.name) ? 'on' : ''} ${k?.[1] || ''}`, style: `--c:${a.farbe}`, onclick: () => toggle(a) },
        h('span', { class: 'dot' }), a.name, k ? h('small', {}, k[0]) : null); };
      inhalt = [
        h('div', { class: 'geo-card' },
          h('p', { class: 'geo-kicker' }, 'Standort der Pflanzfläche'),
          !r ? h('p', { class: 'muted' }, 'Standort und Baumartenempfehlung werden geladen …')
            : r.status === 'ok' ? [h('p', {}, h('strong', {}, `${r.code}: ${r.eintrag.name}`)), h('p', { class: 'muted' }, `${r.wuchseinheitName} · Klimabereich 2041–2070: ${r.klimabereichTabelleName} (${r.klimabereichTabelle})`),
              h('p', { class: 'muted' }, `Tabellenwerk: Hauptbaumarten ${r.eintrag.B.join(', ')} · Mischbaumarten ${r.eintrag.C.join(', ')} · Nebenbaumarten ${r.eintrag.D.join(', ')}`)]
            : h('p', { class: 'muted' }, r.status === 'keinStandort' ? 'Für die Fläche ist keine Standortskartierung hinterlegt – die Baumartenwahl bitte mit dem Forstamt abstimmen.' : 'Für diesen Standort liegt keine Empfehlung aus dem Tabellenwerk vor.')),
        h('p', { class: 'sheet-label' }, empf.length ? 'Für diesen Standort empfohlen' : 'Baumarten'),
        h('div', { class: 'art-chips' }, (empf.length ? empf : PFLANZ_ARTEN).map(chip)),
        empf.length ? h('details', { class: 'weitere-arten' }, h('summary', {}, 'Weitere Baumarten'), h('div', { class: 'art-chips' }, PFLANZ_ARTEN.filter((a) => !empf.includes(a)).map(chip))) : null,
        s.arten.length ? h('div', { class: 'anteile' }, h('p', { class: 'sheet-label' }, 'Anteile an der Fläche (%)'),
          s.arten.map((x) => { const a = artInfo(x.name); const k = kategorie(a); return h('div', { class: 'anteil-zeile' },
            h('span', { class: 'dot', style: `background:${a.farbe}` }), h('strong', {}, x.name),
            h('input', { type: 'number', min: 0, max: 100, step: 5, value: x.anteil, 'aria-label': `Anteil ${x.name} in Prozent`, onchange: (e) => { x.anteil = Math.max(0, Math.min(100, Number(e.target.value) || 0)); render(); } }),
            h('small', { class: 'muted' }, a.hinweis),
            k?.[1] === 'warn' ? h('small', { class: 'warn-line' }, `${x.name} ist laut Tabellenwerk für diesen Standort nicht empfohlen.`) : null); }),
          (() => { const sum = s.arten.reduce((a, x) => a + (Number(x.anteil) || 0), 0); return sum !== 100 ? h('p', { class: 'warn-line' }, `Summe der Anteile: ${sum} % – bitte auf 100 % bringen.`) : null; })(),
          mischHinweise()) : h('p', { class: 'muted' }, 'Wähle die Baumarten, die gepflanzt werden sollen.'),
        nav(s.arten.length > 0 && s.arten.reduce((a, x) => a + (Number(x.anteil) || 0), 0) === 100)];
    } else if (schritt === 2) {
      const b = rechnen();
      inhalt = [
        mapEl, h('p', { class: 'muted' }, 'Gestrichelt: Rückegassen. Auf ihnen wird nicht gepflanzt.'),
        h('div', { class: 'zaun-optionen' },
          h('label', {}, 'Rückegassen alle', h('select', { onchange: (e) => { s.gassen.abstand = Number(e.target.value); zeichne(); render(); } },
            [[0, 'keine Rückegassen'], [20, '20 m'], [30, '30 m'], [40, '40 m']].map(([v, l]) => h('option', { value: v, selected: s.gassen.abstand === v }, l)))),
          s.gassen.abstand ? h('label', {}, 'Gassenbreite (m)', h('input', { type: 'number', min: 2, max: 6, step: 0.5, value: s.gassen.breite, onchange: (e) => { s.gassen.breite = Math.max(2, Math.min(6, Number(e.target.value) || 4)); zeichne(); render(); } })) : null,
          s.gassen.abstand ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.gassen.winkel = ((s.gassen.winkel || 0) + 15) % 180; zeichne(); } }, 'Gassen drehen (15°)') : null),
        h('p', { class: 'hint' }, `Pflanzfläche ${formatHa(b.ha)}, davon bepflanzbar ohne Gassen ${formatHa(b.nettoHa)} (${Math.round(netto() * 100)} %).`),
        h('ul', { class: 'pflanz-liste' }, b.zeilen.map((z) => h('li', {},
          h('div', { class: 'mat-kopf' }, h('strong', {}, h('span', { class: 'dot', style: `background:${z.info.farbe}` }), ` ${z.name}`), h('span', { class: 'mat-menge' }, `${z.stueck.toLocaleString('de-DE')} Stück`)),
          h('label', {}, 'Pflanzen je Hektar', h('input', { type: 'number', min: 100, max: 12000, step: 100, value: z.nHa, onchange: (e) => { const x = s.arten.find((y) => y.name === z.name); x.nHa = Math.max(100, Number(e.target.value) || z.nHa); render(); } })),
          h('small', { class: 'muted' }, `Rahmenpflanzverband ${s.art === 'voranbau' ? 'Voranbau' : 'Freifläche'}: ${z.V[0].toLocaleString('de-DE')}–${z.V[1].toLocaleString('de-DE')} Stück/ha${z.V[2] ? ` (${z.V[2]})` : ''}`),
          h('small', {}, `Pflanzverband ${z.verband} (Reihenabstand × Abstand in der Reihe) auf ${formatHa(z.flaecheHa)}`),
          (z.nHa < z.V[0] || z.nHa > z.V[1]) ? h('small', { class: 'warn-line' }, 'Außerhalb des Rahmenpflanzverbands – für die Förderung mit dem Forstamt abstimmen.') : null))),
        h('div', { class: 'zaun-summe' }, h('span', {}, 'Pflanzen gesamt'), h('strong', {}, `${b.stueck.toLocaleString('de-DE')} Stück`)),
        h('p', { class: 'hint' }, 'Quelle der Pflanzenzahlen: Rahmenpflanzverbände, Anlage 3 der Thüringer Richtlinie zur Förderung forstwirtschaftlicher Maßnahmen 2025 (Pflanzen je Hektar Arbeitsfläche, Reihenabstand 2,5 m).'),
        nav(true)];
    } else if (schritt === 3) {
      const b = rechnen();
      inhalt = [
        h('p', { class: 'muted' }, 'Lege fest, wo welche Baumart steht: Wähle eine Baumart und tippe ihre Gruppe in die Karte (oder lauf sie ab). Auf der übrigen Fläche werden die Baumarten ohne eigene Gruppe nach ihren Anteilen gemischt.'),
        h('div', { class: 'art-chips' }, s.arten.map((x) => h('button', { type: 'button', class: `art-chip ${zone?.name === x.name ? 'on' : ''}`, style: `--c:${farbe(x.name)}`,
          onclick: () => { if (zone && zone.ring.length < 3) s.zonen = s.zonen.filter((z) => z !== zone); zone = { name: x.name, ring: [] }; s.zonen.push(zone); zeichne(); render(); } }, h('span', { class: 'dot' }), `Gruppe ${x.name}`))),
        mapEl, status, zone ? umlaufHost : null,
        zone ? h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { zone.ring.pop(); zeichne(); renderStatus(); } }, 'Letzten Punkt entfernen'),
          h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => { if (zone.ring.length < 3) s.zonen = s.zonen.filter((z) => z !== zone); zone = null; zeichne(); render(); } }, 'Gruppe fertig')) : null,
        s.zonen.filter((z) => z.ring.length >= 3).length ? h('ul', { class: 'zonen-liste' }, s.zonen.filter((z) => z.ring.length >= 3).map((z) => h('li', {},
          h('span', { class: 'dot', style: `background:${farbe(z.name)}` }), `${z.name}: ${formatHa(areaHa(z.ring))}`,
          h('button', { type: 'button', class: 'link-btn', onclick: () => { s.zonen = s.zonen.filter((y) => y !== z); zeichne(); render(); } }, 'entfernen')))) : null,
        verteilHinweise(b),
        h('div', { class: 'geo-card' }, h('p', { class: 'geo-kicker' }, 'Aufteilung'),
          h('ul', { class: 'mat-kurz' }, b.zeilen.map((z) => h('li', {}, `${z.name}: ${formatHa(z.flaecheHa)} (${Math.round(z.anteilEcht * 100)} %), ${z.stueck.toLocaleString('de-DE')} Stück`))),
          b.ausZonen ? h('p', { class: 'hint' }, `Übrige Fläche ${formatHa(b.rest)}: Mischung aus ${b.zeilen.filter((z) => !z.gruppe).map((z) => z.name).join(', ') || '–'}.`)
            : h('p', { class: 'hint' }, 'Ohne eingezeichnete Gruppen gelten die Anteile aus Schritt 2 (Mischung in der ganzen Fläche).')),
        nav(!zone)];
    } else {
      const b = rechnen();
      inhalt = [
        h('div', { class: 'pflanzplan-karte' }, mapEl, h('ul', { class: 'legende' },
          b.zeilen.map((z) => h('li', {}, h('span', { class: 'swatch', style: `background:${z.info.farbe}` }), `${z.name} ${Math.round(z.anteilEcht * 100)} %`)),
          s.gassen.abstand ? h('li', {}, h('span', { class: 'swatch gasse' }), `Rückegasse alle ${s.gassen.abstand} m`) : null)),
        h('ul', { class: 'pflanz-liste' }, b.zeilen.map((z) => h('li', {},
          h('div', { class: 'mat-kopf' }, h('strong', {}, z.name), h('span', { class: 'mat-menge' }, `${z.stueck.toLocaleString('de-DE')} Stück · ${z.verband}`)),
          h('div', { class: 'zwei-spalten' },
            h('label', {}, 'Sortiment', h('input', { value: z.sortiment || '', placeholder: 'z. B. 1+1, 50–80 cm', oninput: (e) => { s.arten.find((y) => y.name === z.name).sortiment = e.target.value; } })),
            h('label', {}, 'Preis je Stück (€)', h('input', { inputmode: 'decimal', value: z.preis != null ? String(z.preis).replace('.', ',') : '', placeholder: 'WBS-Preis',
              onchange: (e) => { const x = s.arten.find((y) => y.name === z.name); x.preis = e.target.value; const v = zahl(e.target.value); if (v != null) { preise[z.name] = v; try { localStorage.setItem(PREIS_KEY, JSON.stringify(preise)); } catch { /* egal */ } } render(); } }))),
          h('small', { class: 'mat-summe' }, z.kosten != null ? `Kosten ${euro(z.kosten)}` : 'Preis fehlt')))),
        h('div', { class: 'zaun-summe' }, h('span', {}, 'Pflanzenkosten gesamt'), h('strong', {}, euro(b.kosten))),
        b.zeilen.some((z) => z.preis == null) ? h('p', { class: 'warn-line' }, 'Trag die Stückpreise aus dem Pflanzenangebot der Waldbesitzer Service GmbH (oder deiner Baumschule) ein – die App merkt sie sich für die nächste Planung.') : null,
        h('label', {}, 'Geplanter Pflanztermin', h('input', { type: 'date', value: s.date, onchange: (e) => { s.date = e.target.value; } })),
        h('label', {}, 'Notiz', h('textarea', { rows: 2, oninput: (e) => { s.note = e.target.value; } }, s.note)),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: () => pdfPlan(rechnen()) }, 'Pflanzplanungskarte als PDF')),
        h('div', { class: 'q-nav' },
          h('button', { type: 'button', class: 'btn', onclick: () => { schritt--; render(); } }, 'Zurück'),
          h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => speichern(rechnen()) }, 'Pflanzung buchen'))];
    }
    fill(body, kopf, inhalt);
    // Karte in den aktuellen Schritt hängen
    if (!karte) karteNeu();
    setTimeout(() => { karte?.map.invalidateSize(); if (s.ring.length >= 3 && schritt > 0) karte.map.fitBounds(L.latLngBounds(s.ring), { padding: [16, 16], maxZoom: 18 }); }, 60);
    zeichne(); renderStatus();
    body.closest('.page-body')?.scrollTo?.(0, 0);
  }

  function mischHinweise() {
    const out = [];
    const namen = s.arten.map((x) => x.name);
    const licht = s.arten.filter((x) => artInfo(x.name)?.licht === 'licht').map((x) => x.name);
    if (namen.includes('Rotbuche') && licht.length) out.push(`Rotbuche überwächst Lichtbaumarten (${licht.join(', ')}): diese in eigenen Gruppen pflanzen, nicht einzeln in die Buche.`);
    if (s.art === 'wiederaufforstung' && namen.some((n) => ['Rotbuche', 'Weißtanne'].includes(n))) out.push('Rotbuche und Weißtanne vertragen die volle Freifläche schlecht (Spätfrost, Hitze): Seitenschutz nutzen oder einen Vorwald (z. B. Birke) mitpflanzen.');
    if (namen.some((n) => /eiche/i.test(n)) && !namen.some((n) => ['Hainbuche', 'Winterlinde', 'Sommerlinde'].includes(n))) out.push('Zur Eiche gehört eine dienende Baumart (Hainbuche oder Linde), die die Stämme beschattet.');
    const laub = s.arten.filter((x) => !['Weißtanne', 'Gemeine Fichte', 'Gemeine Kiefer', 'Europäische Lärche', 'Douglasie'].includes(x.name)).reduce((a, x) => a + (Number(x.anteil) || 0), 0);
    if (laub < 40) out.push(`Laubbaumanteil ${laub} % – für die Förderung nach der Richtlinie mindestens 40 % (Landesprogramm 30 %).`);
    if (s.arten.some((x) => Number(x.anteil) > 75) && s.ring.length >= 3 && areaHa(s.ring) > 1) out.push('Auf Flächen über 1 ha darf eine Baumart für die Förderung höchstens 75 % ausmachen.');
    return out.length ? h('div', { class: 'lrt-hinweis brutzeit' }, h('strong', {}, 'Hinweise zur Mischung'), h('ul', { class: 'lrt-punkte' }, out.map((t) => h('li', {}, t)))) : null;
  }
  function verteilHinweise(b) {
    const out = [];
    for (const z of s.zonen.filter((y) => y.ring.length >= 3)) {
      const a = artInfo(z.name); const zha = areaHa(z.ring);
      if (a?.gruppeHa && zha < a.gruppeHa) out.push(`${z.name}-Gruppe mit ${formatHa(zha)} ist klein – als ${a.licht === 'licht' ? 'Lichtbaumart' : 'Mischbaumart'} sollte sie mindestens ${formatHa(a.gruppeHa)} groß sein, damit sie nicht überwachsen wird.`);
    }
    if (zone) out.unshift(`${zone.name}: ${artInfo(zone.name)?.hinweis || ''}`);
    const k = s.bzt?.status === 'ok' ? s.bzt.eintrag : null;
    if (k) b.zeilen.forEach((z) => { const kat = kategorie(z.info); if (kat?.[1] === 'warn' && z.flaecheHa > 0) out.push(`${z.name} ist laut Tabellenwerk für ${s.bzt.code} nicht empfohlen.`); });
    return out.length ? h('div', { class: 'lrt-hinweis brutzeit' }, h('strong', {}, 'Hinweise'), h('ul', { class: 'lrt-punkte' }, out.map((t) => h('li', {}, t)))) : null;
  }

  // ---------- Pflanzplanungskarte (PDF) ----------
  function pdfPlan(b) {
    const doc = new Pdf();
    const L0 = 50, R = 545;
    let y = 50;
    doc.text(L0, y, 'Pflanzplanungskarte', { bold: true, size: 18, farbe: [27, 77, 46] }); y += 18;
    const p = byId[s.parcelId];
    doc.text(L0, y, `${p ? `Flurstück ${p.nr}, ${p.gemarkung}, Flur ${p.flur} · ` : ''}Pflanzfläche ${formatHa(b.ha)} · ${s.art === 'voranbau' ? 'Voranbau' : 'Freifläche'}`, { size: 10 }); y += 14;
    if (s.bzt?.status === 'ok') { doc.text(L0, y, `Standort ${s.bzt.code} · ${s.bzt.wuchseinheitName} · Klimabereich ${s.bzt.klimabereichTabelle}`, { size: 9, farbe: [90, 100, 90] }); y += 14; }
    // Karte
    const { xy } = lokal(s.ring);
    const P = s.ring.map(xy);
    const minX = Math.min(...P.map((q) => q[0])), maxX = Math.max(...P.map((q) => q[0])), minY = Math.min(...P.map((q) => q[1])), maxY = Math.max(...P.map((q) => q[1]));
    const BB = R - L0, BH = 330;
    const sk = Math.min((BB - 30) / Math.max(1, maxX - minX), (BH - 30) / Math.max(1, maxY - minY));
    const ox = L0 + (BB - (maxX - minX) * sk) / 2, oy = y + (BH - (maxY - minY) * sk) / 2;
    const tr = (ll) => { const [a, c] = xy(ll); return [ox + (a - minX) * sk, oy + (maxY - c) * sk]; };
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    doc.rechteck(L0, y, BB, BH, { stroke: [170, 180, 170], fill: [248, 250, 246] });
    doc.polygon([s.ring.map(tr)], { fill: rgb(farbe(s.grund)), stroke: [46, 125, 50], w: 1.5 });
    for (const z of s.zonen.filter((q) => q.ring.length >= 3)) doc.polygon([z.ring.map(tr)], { fill: rgb(farbe(z.name)), stroke: [255, 255, 255], w: 1 });
    gassenLinien(s.ring, s.gassen.abstand, s.gassen.winkel || 0).forEach(([a, c]) => { const [x1, y1] = tr(a), [x2, y2] = tr(c); doc.linie(x1, y1, x2, y2, { w: Math.max(1, s.gassen.breite * sk), farbe: [205, 180, 150] }); });
    doc.linie(R - 20, y + 40, R - 20, y + 16, { w: 1.4, farbe: [40, 50, 40] }); doc.text(R - 23, y + 12, 'N', { bold: true, size: 9 });
    const meter = [10, 20, 50, 100, 200, 500].find((m) => m * sk >= 50) || 500;
    doc.linie(L0 + 14, y + BH - 14, L0 + 14 + meter * sk, y + BH - 14, { w: 2, farbe: [40, 50, 40] }); doc.text(L0 + 14, y + BH - 20, `${meter} m`, { size: 8 });
    y += BH + 16;
    // Tabelle
    const sp = [L0, L0 + 130, L0 + 200, L0 + 270, L0 + 350, L0 + 420];
    ['Baumart', 'Anteil', 'Fläche', 'Stück', 'Verband', 'Kosten'].forEach((t, i) => doc.text(sp[i], y, t, { bold: true, size: 9 }));
    y += 6; doc.linie(L0, y, R, y); y += 12;
    for (const z of b.zeilen) {
      doc.rechteck(L0, y - 8, 8, 8, { fill: rgb(z.info.farbe) });
      doc.text(L0 + 12, y, z.name, { size: 9 }); doc.text(sp[1], y, `${Math.round(z.anteilEcht * 100)} %`, { size: 9 }); doc.text(sp[2], y, formatHa(z.flaecheHa), { size: 9 });
      doc.text(sp[3], y, z.stueck.toLocaleString('de-DE'), { size: 9 }); doc.text(sp[4], y, z.verband, { size: 9 }); doc.text(sp[5], y, z.kosten != null ? euro(z.kosten) : '–', { size: 9 });
      y += 13;
    }
    doc.linie(L0, y - 6, R, y - 6); y += 4;
    doc.text(L0, y, `Gesamt ${b.stueck.toLocaleString('de-DE')} Pflanzen · Pflanzenkosten ${euro(b.kosten)}${s.gassen.abstand ? ` · Rückegassen alle ${s.gassen.abstand} m, ${dez(s.gassen.breite)} m breit` : ''}`, { bold: true, size: 9.5 });
    y += 18;
    doc.text(L0, y, 'Pflanzenzahlen nach den Rahmenpflanzverbänden (Richtlinie 2025, Anlage 3); Baumartenempfehlung nach dem Tabellenwerk von ThüringenForst.', { size: 7.5, farbe: [90, 100, 90] });
    herunterladen(doc.blob(), `Pflanzplan_${p ? `${p.gemarkung}_${p.nr}`.replace(/[^\wäöüÄÖÜß-]+/g, '_') : 'Flaeche'}.pdf`);
  }

  // ---------- Speichern ----------
  async function speichern(b) {
    const neuId = uid();
    const haupt = [...b.zeilen].sort((x, y) => y.stueck - x.stueck)[0];
    store.update((st) => st.measures.push({
      id: neuId, type: 'pflanzung', parcelId: s.parcelId, date: s.date ? new Date(s.date).getTime() : null, status: 'geplant', createdAt: Date.now(), note: s.note.trim(),
      details: { species: haupt?.name || '', count: String(b.stueck), area: dez(b.ha, 2), verband: b.zeilen.map((z) => `${z.name} ${z.verband}`).join('; ') },
      flaeche: { ring: [...s.ring], ha: b.ha },
      pflanzplan: { art: s.art, gassen: { ...s.gassen }, netto: netto(), grund: s.grund,
        zonen: s.zonen.filter((z) => z.ring.length >= 3).map((z) => ({ name: z.name, ring: z.ring })),
        arten: b.zeilen.map((z) => ({ name: z.name, code: z.info.code, anteil: Math.round(z.anteilEcht * 1000) / 10, flaecheHa: Math.round(z.flaecheHa * 10000) / 10000, nHa: z.nHa, stueck: z.stueck, verband: z.verband, sortiment: z.sortiment || '', preis: z.preis, kosten: z.kosten })),
        standort: s.bzt?.status === 'ok' ? { einheit: s.standort?.einheit, code: s.bzt.code, wuchseinheit: s.bzt.wuchseinheit, klimabereich: s.bzt.klimabereichTabelle } : null },
      kosten: Math.round(b.kosten * 100) / 100,
    }));
    toast(`Pflanzung gebucht: ${b.stueck.toLocaleString('de-DE')} Pflanzen auf ${formatHa(b.ha)}`);
    umlauf?.stop();
    const zaun = await dialog({ title: 'Wird auch ein Zaun benötigt?',
      body: h('p', {}, 'Der Zaunverlauf kann direkt aus der Pflanzfläche übernommen werden. Länge, Material und Kosten rechnet die App dann aus.'),
      actions: [{ label: 'Nein', value: false }, { label: 'Ja, Zaun planen', value: true, primary: true }] });
    page.close();
    if (!zaun) { onSaved?.([neuId]); return; }
    const { openZaunPlanung } = await import('./zaun.js');
    openZaunPlanung({ parcelId: s.parcelId, pts: s.ring, foerdern, quelle: 'Zaunverlauf aus der Pflanzfläche übernommen – Punkte lassen sich anpassen.',
      onSaved: (zid) => onSaved?.([neuId, zid]), onAbbruch: () => onSaved?.([neuId]) });
  }

  render();
  return page;
}
