// Zaunbau: Zaunverlauf in der Karte zeichnen → Länge, Material (Knotengeflecht, Z-Profile, Streben …) und Kosten.
// Bauregeln: Pfostenabstand 2,5–4 m (Standard 3,5 m), Eck- und Endpfosten mit Strebe, Mittelabstrebung alle 30–50 m,
// je waagerechtem Draht ein Drahtspanner am Zaunanfang, -ende und an jeder Rollenverbindung (Grube / Drahtwaren Driller).
import { h, fill, openPage, toast, dialog } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { distance, bearing, formatDist, formatHa, areaHa } from './geo.js';
import { miniKarte } from './flaeche.js';
import { umlaufSteuerung, vereinfachen } from './umlauf.js';

const STAND = 'Stand 11/2026, brutto inkl. 19 % MwSt., ohne Versand; ab-Preise je nach Menge';
const MWST = 1.19;
// WBS Waldbesitzer Service GmbH, Materialsortiment Herbst 2026 (Preise zzgl. MwSt. → hier brutto)
const WBS = { shop: 'Waldbesitzer Service GmbH (WBS)', url: 'https://www.waldbesitzer-service.de/seite/883737/materialsortiment-herbst-2026', wbs: true };
const wbs = (netto, extra = {}) => ({ ...WBS, preis: Math.round(netto * MWST * 100) / 100, netto, hinweis: `${netto.toLocaleString('de-DE', { minimumFractionDigits: 2 })} € zzgl. MwSt.`, ...extra });
const Q = {
  grube: { shop: 'GRUBE Forstbedarf', url: 'https://www.grube.de/p/arcelormittal-wildgatter-knotengeflecht-1602015l/P73-721A/' },
  grubePfahl: { shop: 'GRUBE Forstbedarf', url: 'https://www.grube.de/eckpfahl-cw-60-73-277/' },
  driller: { shop: 'Drahtwaren Driller', url: 'https://www.draht-driller.de/knotengeflecht-verzinkt-2-00-x-1-60/11609/knotengeflecht-l-160-23-15-2-0-1-6-mm-starkverzinkt' },
  drillerPfahl: { shop: 'Drahtwaren Driller', url: 'https://draht-driller.de/detail/index/sArticle/5492' },
  latef: { shop: 'LATEF Land- und Gartentechnik', url: 'https://www.latef.de/onlineshop/wildzaun-stabmattenzaun/wildschutzzaunknotengeflecht/normalverzinkt/180/knotengeflecht-160/20/15-l' },
  siepmann: { shop: 'Siepmann', url: 'https://www.siepmann.net/Landwirtschaftliche_Z%C3%A4une/Knotengeflecht.html' },
};
// Zaunhöhen: Knotengeflecht (Höhe/Anzahl waagerechter Drähte/Abstand senkrechter Drähte), passende Z-Profil-Länge
export const HOEHEN = [
  { cm: 160, typ: '160/20/15L', draehte: 20, pfahl: 210, text: 'Rehwild – im Wald am häufigsten', preise: [
    wbs(60.37, { hinweis: 'WBS-Nr. 3, 60,37 € zzgl. MwSt.' }),
    { ...Q.latef, preis: 75.58, hinweis: '160/20/15 L, normalverzinkt' },
    { ...Q.grube, preis: 122.00, hinweis: 'ArcelorMittal 160/20/15L' },
    { ...Q.driller, preis: 128.98, hinweis: 'L 160/20/15, starkverzinkt, ab-Preis' }] },
  { cm: 200, typ: '200/22/15L', draehte: 22, pfahl: 250, text: 'Rot- und Damwild', preise: [
    wbs(65.09, { hinweis: 'WBS-Nr. 90, 65,09 € zzgl. MwSt.' }),
    { ...Q.siepmann, preis: 99.90, hinweis: '200/22/15' }] },
];
const PFAHL_PREISE = {
  210: [wbs(4.77, { hinweis: 'WBS-Nr. 4, 4,77 € zzgl. MwSt.' }), { ...Q.drillerPfahl, preis: 7.08, hinweis: 'Z-Profil 2100 mm, ab-Preis (Mengenrabatt)' }, { ...Q.grubePfahl, preis: 10.50, hinweis: 'Z-Profil-Stahlpfahl, ab-Preis' }],
  250: [wbs(5.40, { hinweis: 'WBS-Nr. 89, 5,40 € zzgl. MwSt.' }), { ...Q.drillerPfahl, preis: 8.60, hinweis: 'Z-Profil 2500 mm, ab-Preis (Mengenrabatt)' }],
};
const PREISE = {
  strebePfahl: [wbs(4.77, { hinweis: 'Z-Profil 2100 mm als Strebe, WBS-Nr. 4' }), { ...Q.drillerPfahl, preis: 7.08, hinweis: 'Z-Profil 2100 mm, ab-Preis' }],
  eckverbinder: [wbs(7.07, { hinweis: 'WBS-Nr. 8, 7,07 € zzgl. MwSt.' })],
  einschlaghilfe: [wbs(31.85, { hinweis: 'WBS-Nr. 133, 31,85 € zzgl. MwSt.' }), { ...Q.grubePfahl, preis: 26.90, hinweis: 'Einschlaghilfe für Z-Profilpfosten' }],
  spanndraht: [], erdanker: [], drahtspanner: [], tor: [],
};
export const SHOPS = [
  { name: 'Waldbesitzer Service GmbH (WBS), Schleiz', url: WBS.url, text: 'Sammelbestellung von Zaunmaterial über die FBG, zweimal im Jahr (Frühjahr/Herbst).' },
  { name: 'GRUBE Forstbedarf', url: 'https://www.grube.de/', text: 'Forstversand mit Knotengeflecht, Z-Profil-Pfählen, Verstrebungssets, Einschlaghilfen und Werkzeug.' },
  { name: 'Drahtwaren Driller', url: 'https://www.draht-driller.de/zaeune/wildschutzzaun', text: 'Fachhändler für Wildschutzzaun: Knotengeflecht, Z-Profile, Eck- und Anfangssets, Mengenrabatt.' },
  { name: 'LATEF Land- und Gartentechnik', url: 'https://www.latef.de/onlineshop/wildzaun-stabmattenzaun/wildschutzzaunknotengeflecht/normalverzinkt/180/knotengeflecht-160/20/15-l', text: 'Fachhändler (Bad Lausick) mit Knotengeflecht in leichter und mittlerer Ausführung.' },
  { name: 'Siepmann', url: 'https://www.siepmann.net/Landwirtschaftliche_Z%C3%A4une/Knotengeflecht.html', text: 'Fachhändler für landwirtschaftliche Zäune und Knotengeflecht.' },
];

const euro = (v) => (v == null ? '–' : `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const zahl = (v) => { const s = String(v ?? '').trim().replace(',', '.'); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
const guenstigster = (liste) => (liste?.length ? liste.reduce((a, b) => (b.preis < a.preis ? b : a)) : null);
// Standard: WBS-Preis, wenn vorhanden, sonst der günstigste Richtpreis
const standardPreis = (liste) => liste?.find((x) => x.wbs) || guenstigster(liste);

/** Abschnitte, Ecken und Länge eines Zaunverlaufs */
export function zaunGeometrie(pts, geschlossen) {
  const segs = [];
  const n = pts.length;
  const anz = geschlossen ? n : n - 1;
  for (let i = 0; i < anz; i++) segs.push(distance(pts[i], pts[(i + 1) % n]));
  // Ecke = Richtungswechsel über 15°
  let ecken = 0;
  for (let i = 0; i < n; i++) {
    if (!geschlossen && (i === 0 || i === n - 1)) continue;
    const a = bearing(pts[(i - 1 + n) % n], pts[i]), b = bearing(pts[i], pts[(i + 1) % n]);
    const d = Math.abs(((b - a + 540) % 360) - 180);
    if (d > 15) ecken++;
  }
  return { segs, laenge: segs.reduce((a, b) => a + b, 0), ecken };
}

/** Materialliste nach den Bauregeln */
export function materialListe({ pts, geschlossen, hoehe, abstand = 3.5, spanndraht = false, erdanker = false, ankerAbstand = 3, tore = 0, mittelStrebeAlle = 40, einschlaghilfe = false }) {
  const g = zaunGeometrie(pts, geschlossen);
  const H = HOEHEN.find((x) => x.cm === hoehe) || HOEHEN[0];
  const L = g.laenge;
  const pfosten = g.segs.reduce((s, seg) => s + Math.max(1, Math.ceil(seg / abstand - 0.01)), 0) + (geschlossen ? 0 : 1);
  const enden = geschlossen ? 0 : 2;
  const mittel = g.segs.reduce((s, seg) => s + Math.max(0, Math.ceil(seg / mittelStrebeAlle - 0.01) - 1), 0);
  const rollen = Math.ceil((L * 1.02) / 50); // 2 % Zugabe für Überlappung und Verbindung
  // Spannstellen: Zaunanfang und -ende (beim Gatter beidseits der Tore, sonst am Startpfosten) und jede Rollenverbindung
  const streben = g.ecken * 2 + enden + mittel * 2 + tore * 2;
  const strebenInfo = `${g.ecken} Ecken × 2${enden ? `, ${enden} Zaunenden × 1` : ''}${mittel ? `, ${mittel} Mittelabstrebungen × 2 (alle ${mittelStrebeAlle} m)` : ''}${tore ? `, ${tore * 2} Torpfosten × 1` : ''}`;
  const spannStellen = (geschlossen ? Math.max(2, tore * 2) : 2 + tore * 2) + Math.max(0, rollen - 1);
  return {
    geo: g, H,
    posten: [
      { key: 'geflecht', name: `Knotengeflecht ${H.typ}, Rolle 50 m`, menge: rollen, einheit: 'Rollen', preise: H.preise, info: `${Math.round(L)} m Zaun + 2 % Zugabe` },
      { key: 'pfahl', name: `Z-Profil-Pfahl ${(H.pfahl / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} m`, menge: pfosten, einheit: 'Stück', preise: PFAHL_PREISE[H.pfahl], info: `alle ${String(abstand).replace('.', ',')} m, Ecken eingeschlossen; ca. 10 cm höher als das Geflecht, 40–60 cm im Boden` },
      // Streben aus Z-Profil mit Eckverbinder: Ecke 2 (Zug aus beiden Richtungen), Zaunende 1, Mittelabstrebung 2, je Torpfosten 1
      { key: 'strebePfahl', name: 'Z-Profil 2,10 m als Strebe', menge: streben, einheit: 'Stück', preise: PREISE.strebePfahl, info: strebenInfo },
      { key: 'eckverbinder', name: 'Eckverbinder 3 mm für Z-Profil', menge: streben, einheit: 'Stück', preise: PREISE.eckverbinder, info: 'je Strebe einer' },
      einschlaghilfe ? { key: 'einschlaghilfe', name: 'Einschlaghilfe für Z-Profile (Werkzeug)', menge: 1, einheit: 'Stück', preise: PREISE.einschlaghilfe, info: 'einmalig' } : null,
      { key: 'drahtspanner', name: 'Drahtspanner', menge: H.draehte * spannStellen, einheit: 'Stück', preise: PREISE.drahtspanner, info: `je waagerechtem Draht (${H.draehte}) an ${spannStellen} Spannstellen (Anfang, Ende, Rollenverbindungen${tore ? ', Tore' : ''})` },
      spanndraht ? { key: 'spanndraht', name: 'Spanndraht oben und unten', menge: Math.ceil(L * 2 * 1.05), einheit: 'm', preise: PREISE.spanndraht, info: '2 × Zaunlänge + 5 %' } : null,
      erdanker ? { key: 'erdanker', name: 'Erdanker gegen Untergraben', menge: Math.ceil(L / ankerAbstand), einheit: 'Stück', preise: PREISE.erdanker, info: `alle ${String(ankerAbstand).replace('.', ',')} m` } : null,
      tore ? { key: 'tor', name: 'Tor / Durchlass', menge: tore, einheit: 'Stück', preise: PREISE.tor, info: 'mit Torpfosten' } : null,
    ].filter(Boolean),
  };
}

export async function openZaunPlanung({ parcelId = null, onSaved, onAbbruch = null, foerdern = false, pts = null, quelle = null } = {}) {
  let gespeichert = false;
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id]);
  const s = { parcelId: parcelId || mine[0]?.id || null, pts: pts ? [...pts] : [], geschlossen: true, hoehe: 160, einschlaghilfe: false, abstand: 3.5, spanndraht: false, erdanker: false, ankerAbstand: 3, tore: 1, eigen: {}, quelle: {}, date: '', note: '' };
  const body = h('div', { class: 'zaun' });
  const page = openPage('Zaunbau', body, { onClose: () => { umlauf?.stop(); karte?.remove(); if (!gespeichert) onAbbruch?.(); } });
  let umlauf = null;
  const umlaufHost = h('div');
  const mapEl = h('div', { class: 'mini-map zaun-map' });
  const status = h('p', { class: 'draw-status', 'aria-live': 'polite' });
  const rest = h('div', { class: 'zaun-rest' });
  let karte = null;
  const lyr = L.layerGroup();

  function karteNeu() {
    karte?.remove();
    karte = miniKarte(mapEl, byId[s.parcelId] || null, { zoom: 17 });
    karte.map.doubleClickZoom.disable();
    lyr.addTo(karte.map);
    karte.map.on('click', (e) => { s.pts.push([e.latlng.lat, e.latlng.lng]); zeichne(); renderRest(); });
    umlauf?.stop();
    umlauf = umlaufSteuerung({ map: karte.map, text: 'Zaunverlauf ablaufen',
      onPunkt: (ll) => { s.pts.push(ll); zeichne(); },
      onEnde: () => { s.pts = vereinfachen(s.pts, 1.5); zeichne(); renderRest(); } });
    fill(umlaufHost, umlauf.el);
    if (s.pts.length >= 3) setTimeout(() => { const b = L.latLngBounds(s.pts); karte.map.fitBounds(b, { padding: [20, 20], maxZoom: 18 }); }, 120);
    zeichne();
  }
  function zeichne() {
    lyr.clearLayers();
    if (s.pts.length >= 2) (s.geschlossen && s.pts.length >= 3 ? L.polygon(s.pts, { color: '#F26B1D', weight: 4, fillOpacity: 0.12, interactive: false }) : L.polyline(s.pts, { color: '#F26B1D', weight: 4, interactive: false })).addTo(lyr);
    s.pts.forEach((ll) => L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: '#F26B1D', fillOpacity: 1, interactive: false }).addTo(lyr));
    const min = s.geschlossen ? 3 : 2;
    if (s.pts.length < min) status.textContent = `${s.pts.length} von mindestens ${min} Punkten – tippe den Zaunverlauf Punkt für Punkt in die Karte oder lauf ihn mit dem GPS ab.`;
    else { const g = zaunGeometrie(s.pts, s.geschlossen); status.textContent = `Zaunlänge ${formatDist(g.laenge)}${s.geschlossen ? `, eingezäunte Fläche ${formatHa(areaHa(s.pts))}` : ''} · ${s.pts.length} Punkte, ${g.ecken} Ecken`; }
  }

  fill(body,
    foerdern ? h('div', { class: 'lrt-hinweis ok' }, h('strong', {}, 'Mit Förderantrag'), h('p', {}, 'Nach dem Buchen geht es direkt mit dem Förderantrag weiter.')) : null,
    h('h2', { class: 'step-title' }, 'Wo soll der Zaun stehen?'),
    h('label', {}, 'Fläche', h('select', { onchange: (e) => { s.parcelId = e.target.value || null; s.pts = []; karteNeu(); renderRest(); } },
      h('option', { value: '' }, 'ohne Flächenzuordnung'), mine.map((p) => h('option', { value: p.id, selected: p.id === s.parcelId }, `Flurstück ${p.nr}, ${p.gemarkung}`)))),
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Zaunform' },
      [[true, 'Gatter (geschlossen)'], [false, 'Zaunlinie (offen)']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.geschlossen === k),
        onclick: (e) => { s.geschlossen = k; e.currentTarget.parentElement.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-checked', String(i === (k ? 0 : 1)))); zeichne(); renderRest(); } }, l))),
    quelle ? h('p', { class: 'hint' }, quelle) : null,
    mapEl, status, umlaufHost,
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.pts.pop(); zeichne(); renderRest(); } }, 'Letzten Punkt entfernen'),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.pts = []; zeichne(); renderRest(); } }, 'Neu beginnen')),
    rest);
  karteNeu();

  function preisVon(p) {
    if (s.eigen[p.key] != null) return { preis: s.eigen[p.key], quelle: 'eigener Preis' };
    const q = (s.quelle[p.key] && p.preise?.find((x) => x.shop === s.quelle[p.key])) || standardPreis(p.preise);
    return q ? { preis: q.preis, quelle: q.shop, url: q.url, hinweis: q.hinweis } : { preis: null, quelle: 'kein Richtpreis – bitte eintragen' };
  }

  function renderRest() {
    const min = s.geschlossen ? 3 : 2;
    if (s.pts.length < min) { fill(rest); return; }
    const ml = materialListe(s);
    const zeilen = ml.posten.map((p) => ({ p, ...preisVon(p) }));
    const summe = zeilen.reduce((a, z) => a + (z.preis != null ? z.preis * z.p.menge : 0), 0);
    const offen = zeilen.filter((z) => z.preis == null);
    fill(rest,
      h('h2', { class: 'step-title' }, 'Welche Höhe soll der Zaun haben?'),
      h('div', { class: 'q-cards' }, HOEHEN.map((x) => h('button', { type: 'button', class: `q-option ${s.hoehe === x.cm ? 'on' : ''}`, onclick: () => { s.hoehe = x.cm; renderRest(); } },
        h('span', { class: 'q-text' }, h('strong', {}, `${(x.cm / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} m – Knotengeflecht ${x.typ}`), h('small', {}, `${x.text}; Z-Profil ${(x.pfahl / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} m`))))),
      h('h2', { class: 'step-title' }, 'Bauweise'),
      h('div', { class: 'zaun-optionen' },
        h('label', {}, 'Pfostenabstand (m)', h('input', { type: 'text', inputmode: 'decimal', value: String(s.abstand).replace('.', ','), onchange: (e) => { const v = zahl(e.target.value); if (v >= 2 && v <= 10) s.abstand = v; else toast('Pfostenabstand zwischen 2 und 10 m'); renderRest(); } }),
          h('small', { class: 'hint' }, 'Empfohlen 2,5–4 m (voreingestellt 3,5 m); in unebenem Gelände und an Senken enger.')),
        h('label', {}, 'Tore / Durchlässe', h('input', { type: 'number', min: 0, max: 10, value: s.tore, onchange: (e) => { s.tore = Math.max(0, Math.round(Number(e.target.value) || 0)); renderRest(); } })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.spanndraht, onchange: (e) => { s.spanndraht = e.target.checked; renderRest(); } }), 'Spanndraht oben und unten'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.einschlaghilfe, onchange: (e) => { s.einschlaghilfe = e.target.checked; renderRest(); } }), 'Einschlaghilfe für Z-Profile mitbestellen'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.erdanker, onchange: (e) => { s.erdanker = e.target.checked; renderRest(); } }), 'Erdanker gegen Untergraben (z. B. bei Schwarzwild)')),
      h('h2', { class: 'step-title' }, 'Material und Kosten'),
      h('p', { class: 'muted' }, `Zaunlänge ${formatDist(ml.geo.laenge)}, ${ml.geo.ecken} Ecken. Richtpreise ${STAND}. Tippe auf einen Preis, um einen eigenen einzutragen.`),
      h('ul', { class: 'material-liste' }, zeilen.map((z) => h('li', {},
        h('div', { class: 'mat-kopf' }, h('strong', {}, z.p.name), h('span', { class: 'mat-menge' }, `${z.p.menge.toLocaleString('de-DE')} ${z.p.einheit}`)),
        h('small', { class: 'muted' }, z.p.info),
        h('div', { class: 'mat-preis' },
          h('label', {}, 'Einzelpreis', h('span', { class: 'mit-einheit' },
            h('input', { type: 'text', inputmode: 'decimal', value: z.preis != null ? String(z.preis.toFixed(2)).replace('.', ',') : '', placeholder: 'Preis',
              onchange: (e) => { const v = zahl(e.target.value); if (v == null) delete s.eigen[z.p.key]; else s.eigen[z.p.key] = v; renderRest(); } }), h('span', {}, '€'))),
          h('strong', { class: 'mat-summe' }, z.preis != null ? euro(z.preis * z.p.menge) : '–')),
        h('small', { class: `mat-quelle ${z.preis == null ? 'warn' : ''}` }, z.url ? h('a', { href: z.url, target: '_blank', rel: 'noopener' }, z.quelle) : z.quelle, z.hinweis ? ` · ${z.hinweis}` : '',
          z.p.preise?.length ? h('button', { type: 'button', class: 'link-btn', 'aria-label': `Anbieter für ${z.p.name}`, onclick: () => preisWahl(z.p) }, z.p.preise.length > 1 ? 'Anbieter vergleichen' : 'Richtpreis') : null)))),
      h('div', { class: 'zaun-summe' }, h('span', {}, 'Materialkosten gesamt'), h('strong', {}, euro(summe))),
      offen.length ? h('p', { class: 'warn-line' }, `Ohne Preis: ${offen.map((z) => z.p.name).join(', ')} – bitte eigenen Preis eintragen, sonst fehlt er in der Summe.`) : null,
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: shopsZeigen }, 'Günstige Shops anzeigen')),
      h('p', { class: 'hint' }, 'Standard sind die Preise der Waldbesitzer Service GmbH (Materialsortiment Herbst 2026, netto zzgl. 19 % MwSt., hier brutto gerechnet). Bestellung über die Sammelbestellung deiner FBG.'),
      h('h2', { class: 'step-title' }, 'Termin und Notiz'),
      h('label', {}, 'Geplanter Termin', h('input', { type: 'date', value: s.date, onchange: (e) => { s.date = e.target.value; } })),
      h('label', {}, 'Notiz', h('textarea', { rows: 3, value: s.note, oninput: (e) => { s.note = e.target.value; } })),
      h('button', { type: 'button', class: 'btn btn-primary btn-block btn-large', onclick: () => speichern(ml, zeilen, summe) }, 'Zaunbau buchen'));
  }

  function preisWahl(p) {
    dialog({ title: 'Anbieter wählen', actions: [{ label: 'Schließen', value: null }], body: (close) => h('div', { class: 'preis-wahl' },
      h('p', { class: 'muted' }, `${p.name} – Richtpreise ${STAND}:`),
      h('ul', { class: 'shop-liste' }, [...p.preise].sort((a, b) => a.preis - b.preis).map((q) => h('li', {},
        h('div', {}, h('strong', {}, q.shop), q.hinweis ? h('small', {}, q.hinweis) : null, h('a', { href: q.url, target: '_blank', rel: 'noopener' }, 'Zum Shop')),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { delete s.eigen[p.key]; s.quelle[p.key] = q.shop; close(null); renderRest(); } }, euro(q.preis)))))) });
  }

  function shopsZeigen() {
    dialog({ title: 'Günstige Shops für Zaunmaterial', body: h('div', {},
      h('p', { class: 'muted' }, 'Vergleiche vor dem Kauf die aktuellen Preise. Bei großen Mengen lohnt sich die Sammelbestellung über die FBG oder ein Angebot beim Fachhändler.'),
      h('ul', { class: 'shop-liste' }, SHOPS.map((x) => h('li', {}, h('div', {}, h('strong', {}, x.name), h('small', {}, x.text)), h('a', { class: 'btn btn-small', href: x.url, target: '_blank', rel: 'noopener' }, 'Öffnen'))))),
      actions: [{ label: 'Schließen', value: null }] });
  }

  function speichern(ml, zeilen, summe) {
    const g = ml.geo;
    const neuId = uid();
    store.update((st) => st.measures.push({
      id: neuId, type: 'zaunbau', parcelId: s.parcelId, date: s.date ? new Date(s.date).getTime() : null, status: 'geplant', createdAt: Date.now(),
      note: s.note.trim(),
      details: { length: String(Math.round(g.laenge)), zaun: `Knotengeflecht ${ml.H.typ}, ${(ml.H.cm / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} m, Z-Profil-Pfähle alle ${String(s.abstand).replace('.', ',')} m`, tore: String(s.tore) },
      ...(s.geschlossen ? { flaeche: { ring: [...s.pts], ha: areaHa(s.pts) } } : {}),
      zaun: { pts: s.pts, geschlossen: s.geschlossen, hoehe: s.hoehe, abstand: s.abstand, ecken: g.ecken,
        material: zeilen.map((z) => ({ name: z.p.name, menge: z.p.menge, einheit: z.p.einheit, preis: z.preis, quelle: z.quelle })) },
      kosten: Math.round(summe * 100) / 100,
    }));
    toast(`Zaunbau gebucht: ${formatDist(g.laenge)}, ${euro(summe)}`);
    gespeichert = true;
    page.close();
    onSaved?.(neuId);
  }
  renderRest();
  return page;
}
