// Zaunbau: Zaunverlauf in der Karte zeichnen → Länge, Material (Knotengeflecht, Z-Profile, Streben …) und Kosten.
// Bauregeln: Pfostenabstand je nach Gelände 4–7 m, Eck- und Endpfosten mit Strebe, Mittelabstrebung alle 30–50 m,
// je waagerechtem Draht ein Drahtspanner am Zaunanfang, -ende und an jeder Rollenverbindung (Grube / Drahtwaren Driller).
import { h, fill, openPage, toast, dialog } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { distance, bearing, formatDist, formatHa, areaHa } from './geo.js';
import { miniKarte } from './flaeche.js';

const STAND = 'Stand 11/2026, inkl. MwSt., ohne Versand';
const Q = {
  siepmann: { shop: 'Siepmann', url: 'https://www.siepmann.net/Landwirtschaftliche_Z%C3%A4une/Knotengeflecht.html' },
  hornbach: { shop: 'Hornbach (online)', url: 'https://www.hornbach.de/s/Knotengeflecht' },
  wbv: { shop: 'WBV Fränkische Schweiz (Sammelbestellung)', url: 'https://www.wbvfs.de/images/pdf/Maschinensaetze-21.07.2022-Geschaeftsstelle.pdf' },
  aquagartStrebe: { shop: 'Aquagart (über Kaufland)', url: 'https://www.kaufland.de/product/400248373/' },
  aquagartAnker: { shop: 'Aquagart (über Kaufland)', url: 'https://www.kaufland.de/product/400248373/' },
  alberts: { shop: 'Alberts (über Kaufland)', url: 'https://www.kaufland.de/product/530362892/' },
};
// Zaunhöhen: Knotengeflecht (Höhe/Anzahl waagerechter Drähte/Abstand senkrechter Drähte), passende Z-Profil-Länge
export const HOEHEN = [
  { cm: 130, typ: '130/18/15', draehte: 18, pfahl: 180, text: 'Hase, Kaninchen, niedrige Kulturen', preise: [{ ...Q.siepmann, preis: 79.90 }] },
  { cm: 150, typ: '150/19/15', draehte: 19, pfahl: 210, text: 'Rehwild bei geringem Druck', preise: [{ ...Q.siepmann, preis: 84.90 }] },
  { cm: 160, typ: '160/23/15', draehte: 23, pfahl: 210, text: 'Rehwild – im Wald am häufigsten', preise: [{ ...Q.wbv, preis: 94.96, hinweis: '1,60 m, 50 m (Stand 2022)' }, { ...Q.hornbach, preis: 119.00 }] },
  { cm: 200, typ: '200/22/15', draehte: 22, pfahl: 250, text: 'Rot- und Damwild', preise: [{ ...Q.siepmann, preis: 99.90 }] },
];
const PFAHL_PREISE = { 180: [{ ...Q.hornbach, preis: 9.99 }], 210: [{ ...Q.hornbach, preis: 10.99 }], 250: [{ ...Q.hornbach, preis: 13.99 }] };
const PREISE = {
  strebe: [{ ...Q.aquagartStrebe, preis: 34.66, hinweis: 'Eck-Strebenset, 5 Stück 173,30 €' }],
  spanndraht: [{ ...Q.hornbach, preis: 0.26, hinweis: '3,0 mm, 125 m für 32,30 €' }],
  erdanker: [{ ...Q.alberts, preis: 0.52, hinweis: '25 × 250 mm für 12,99 €' }, { ...Q.aquagartAnker, preis: 1.79, hinweis: 'W-Profil 50 cm, 50 Stück 89,30 €' }],
  drahtspanner: [], tor: [],
};
export const SHOPS = [
  { name: 'Waldbesitzer Service GmbH (WBS), Schleiz', url: 'https://www.waldbesitzer-service.de/', text: 'Sammelbestellung von Zaunmaterial über die FBG, zweimal im Jahr (Frühjahr/Herbst). Preise laut aktuellem Bestellformular.' },
  { name: 'Siepmann', url: Q.siepmann.url, text: 'Knotengeflecht in vielen Höhen, günstige Rollenpreise.' },
  { name: 'Aquagart', url: 'https://www.aquagart.de/forst-weidezaun/wildzaun-knotengeflecht/', text: 'Wildzaun, Z-Profile, Strebensets, Erdanker – auch als Komplettset.' },
  { name: 'Hornbach', url: Q.hornbach.url, text: 'Knotengeflecht, Z-Profile 1,80–2,50 m, Spanndraht.' },
  { name: 'Drahtwaren Driller', url: 'https://www.draht-driller.de/zaeune/wildschutzzaun', text: 'Fachhändler für Wildschutzzaun und Zubehör.' },
];

const euro = (v) => (v == null ? '–' : `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const zahl = (v) => { const s = String(v ?? '').trim().replace(',', '.'); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
const guenstigster = (liste) => (liste?.length ? liste.reduce((a, b) => (b.preis < a.preis ? b : a)) : null);

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
export function materialListe({ pts, geschlossen, hoehe, abstand = 5, spanndraht = false, erdanker = false, ankerAbstand = 3, tore = 0, mittelStrebeAlle = 40 }) {
  const g = zaunGeometrie(pts, geschlossen);
  const H = HOEHEN.find((x) => x.cm === hoehe) || HOEHEN[2];
  const L = g.laenge;
  const pfosten = g.segs.reduce((s, seg) => s + Math.max(1, Math.ceil(seg / abstand - 0.01)), 0) + (geschlossen ? 0 : 1);
  const enden = geschlossen ? 0 : 2;
  const mittel = g.segs.reduce((s, seg) => s + Math.max(0, Math.ceil(seg / mittelStrebeAlle - 0.01) - 1), 0);
  const rollen = Math.ceil((L * 1.02) / 50); // 2 % Zugabe für Überlappung und Verbindung
  // Spannstellen: Zaunanfang und -ende (beim Gatter beidseits der Tore, sonst am Startpfosten) und jede Rollenverbindung
  const spannStellen = (geschlossen ? Math.max(2, tore * 2) : 2 + tore * 2) + Math.max(0, rollen - 1);
  return {
    geo: g, H,
    posten: [
      { key: 'geflecht', name: `Knotengeflecht ${H.typ}, Rolle 50 m`, menge: rollen, einheit: 'Rollen', preise: H.preise, info: `${Math.round(L)} m Zaun + 2 % Zugabe` },
      { key: 'pfahl', name: `Z-Profil-Pfahl ${(H.pfahl / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} m`, menge: pfosten, einheit: 'Stück', preise: PFAHL_PREISE[H.pfahl], info: `alle ${String(abstand).replace('.', ',')} m, Ecken eingeschlossen; ca. 10 cm höher als das Geflecht, 40–60 cm im Boden` },
      { key: 'strebe', name: 'Strebenset (2 Streben) für Ecken, Enden und Mittelabstrebung', menge: g.ecken + enden + mittel + tore * 2, einheit: 'Sets', preise: PREISE.strebe, info: `${g.ecken} Ecken${enden ? `, ${enden} Enden` : ''}${mittel ? `, ${mittel} Mittelabstrebungen (alle ${mittelStrebeAlle} m)` : ''}${tore ? `, ${tore * 2} am Tor` : ''}` },
      { key: 'drahtspanner', name: 'Drahtspanner', menge: H.draehte * spannStellen, einheit: 'Stück', preise: PREISE.drahtspanner, info: `je waagerechtem Draht (${H.draehte}) an ${spannStellen} Spannstellen (Anfang, Ende, Rollenverbindungen${tore ? ', Tore' : ''})` },
      spanndraht ? { key: 'spanndraht', name: 'Spanndraht oben und unten', menge: Math.ceil(L * 2 * 1.05), einheit: 'm', preise: PREISE.spanndraht, info: '2 × Zaunlänge + 5 %' } : null,
      erdanker ? { key: 'erdanker', name: 'Erdanker gegen Untergraben', menge: Math.ceil(L / ankerAbstand), einheit: 'Stück', preise: PREISE.erdanker, info: `alle ${String(ankerAbstand).replace('.', ',')} m` } : null,
      tore ? { key: 'tor', name: 'Tor / Durchlass', menge: tore, einheit: 'Stück', preise: PREISE.tor, info: 'mit Torpfosten' } : null,
    ].filter(Boolean),
  };
}

export async function openZaunPlanung({ parcelId = null, onSaved } = {}) {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id]);
  const s = { parcelId: parcelId || mine[0]?.id || null, pts: [], geschlossen: true, hoehe: 160, abstand: 5, spanndraht: false, erdanker: false, ankerAbstand: 3, tore: 1, eigen: {}, quelle: {}, date: '', note: '' };
  const body = h('div', { class: 'zaun' });
  const page = openPage('Zaunbau', body, { onClose: () => karte?.remove() });
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
    zeichne();
  }
  function zeichne() {
    lyr.clearLayers();
    if (s.pts.length >= 2) (s.geschlossen && s.pts.length >= 3 ? L.polygon(s.pts, { color: '#F26B1D', weight: 4, fillOpacity: 0.12, interactive: false }) : L.polyline(s.pts, { color: '#F26B1D', weight: 4, interactive: false })).addTo(lyr);
    s.pts.forEach((ll) => L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: '#F26B1D', fillOpacity: 1, interactive: false }).addTo(lyr));
    const min = s.geschlossen ? 3 : 2;
    if (s.pts.length < min) status.textContent = `${s.pts.length} von mindestens ${min} Punkten – tippe den Zaunverlauf Punkt für Punkt in die Karte.`;
    else { const g = zaunGeometrie(s.pts, s.geschlossen); status.textContent = `Zaunlänge ${formatDist(g.laenge)}${s.geschlossen ? `, eingezäunte Fläche ${formatHa(areaHa(s.pts))}` : ''} · ${s.pts.length} Punkte, ${g.ecken} Ecken`; }
  }

  fill(body,
    h('h2', { class: 'step-title' }, 'Wo soll der Zaun stehen?'),
    h('label', {}, 'Fläche', h('select', { onchange: (e) => { s.parcelId = e.target.value || null; s.pts = []; karteNeu(); renderRest(); } },
      h('option', { value: '' }, 'ohne Flächenzuordnung'), mine.map((p) => h('option', { value: p.id, selected: p.id === s.parcelId }, `Flurstück ${p.nr}, ${p.gemarkung}`)))),
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Zaunform' },
      [[true, 'Gatter (geschlossen)'], [false, 'Zaunlinie (offen)']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.geschlossen === k),
        onclick: (e) => { s.geschlossen = k; e.currentTarget.parentElement.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-checked', String(i === (k ? 0 : 1)))); zeichne(); renderRest(); } }, l))),
    mapEl, status,
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.pts.pop(); zeichne(); renderRest(); } }, 'Letzten Punkt entfernen'),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.pts = []; zeichne(); renderRest(); } }, 'Neu beginnen')),
    rest);
  karteNeu();

  function preisVon(p) {
    if (s.eigen[p.key] != null) return { preis: s.eigen[p.key], quelle: 'eigener Preis' };
    const q = (s.quelle[p.key] && p.preise?.find((x) => x.shop === s.quelle[p.key])) || guenstigster(p.preise);
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
          h('small', { class: 'hint' }, 'Je nach Gelände 4–7 m; in unebenem Gelände enger.')),
        h('label', {}, 'Tore / Durchlässe', h('input', { type: 'number', min: 0, max: 10, value: s.tore, onchange: (e) => { s.tore = Math.max(0, Math.round(Number(e.target.value) || 0)); renderRest(); } })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.spanndraht, onchange: (e) => { s.spanndraht = e.target.checked; renderRest(); } }), 'Spanndraht oben und unten'),
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
      h('p', { class: 'hint' }, 'Die Preise der Waldbesitzer Service GmbH stehen im aktuellen Bestellformular der Sammelbestellung (über deine FBG). Trage sie hier als eigene Preise ein.'),
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
    store.update((st) => st.measures.push({
      id: uid(), type: 'zaunbau', parcelId: s.parcelId, date: s.date ? new Date(s.date).getTime() : null, status: 'geplant', createdAt: Date.now(),
      note: s.note.trim(),
      details: { length: String(Math.round(g.laenge)), zaun: `Knotengeflecht ${ml.H.typ}, ${(ml.H.cm / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} m, Z-Profil-Pfähle alle ${String(s.abstand).replace('.', ',')} m`, tore: String(s.tore) },
      ...(s.geschlossen ? { flaeche: { ring: [...s.pts], ha: areaHa(s.pts) } } : {}),
      zaun: { pts: s.pts, geschlossen: s.geschlossen, hoehe: s.hoehe, abstand: s.abstand, ecken: g.ecken,
        material: zeilen.map((z) => ({ name: z.p.name, menge: z.p.menge, einheit: z.p.einheit, preis: z.preis, quelle: z.quelle })) },
      kosten: Math.round(summe * 100) / 100,
    }));
    toast(`Zaunbau gebucht: ${formatDist(g.laenge)}, ${euro(summe)}`);
    page.close();
    onSaved?.();
  }
  renderRest();
  return page;
}
