// Profimodus: Erschließung – Rückegassen (Linien) und Lagerplätze/Polterplätze (Punkte) als eigene Kartenebenen.
// Gassen per Hand, per GPS ablaufen oder als Vorschlag aus dem Luftbild; Lagerplätze mit Befahrbarkeit und Beschreibung.
import { h, fill, dialog, confirmDialog, toast, openPage } from '../ui.js';
import { store, uid } from '../store.js';
import { createBaseMap } from './basemap.js';
import { distance, formatDist, polysOf } from '../geo.js';
import { umlaufSteuerung, vereinfachen } from '../umlauf.js';
import { erkenneGassen } from './gassenerkennung.js';
import { source } from '../data/source.js';

export const GASSE_FARBE = '#8D5A2B';
export const LAGER_FARBE = '#B5651D';
export const BEFAHRBAR = [
  ['ganzjaehrig', 'ganzjährig mit LKW befahrbar'],
  ['trocken', 'nur bei trockenem Wetter'],
  ['frost', 'nur bei Frost'],
  ['traktor', 'nur Traktor / Forwarder, kein LKW'],
];
const befahrbarText = (k) => BEFAHRBAR.find(([x]) => x === k)?.[1] || 'nicht angegeben';

const daten = () => store.get().erschliessung || { gassen: [], lager: [] };
const laenge = (line) => line.reduce((s, p, i) => (i ? s + distance(line[i - 1], p) : 0), 0);
function speichere(fn) {
  store.update((s) => { s.erschliessung = s.erschliessung || { gassen: [], lager: [] }; s.erschliessung.gassen ||= []; s.erschliessung.lager ||= []; fn(s.erschliessung); });
}

const lagerIcon = () => L.divIcon({ className: 'lagerpunkt', html: '<span aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="7" cy="16" r="4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="17" cy="16" r="4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="12" cy="8" r="4" fill="none" stroke="#fff" stroke-width="2"/></svg></span>', iconSize: [32, 32], iconAnchor: [16, 16] });

// ---------- Dialoge ----------
export async function lagerDialog(alt = {}) {
  const w = { name: '', befahrbar: 'ganzjaehrig', lkw: true, menge: '', text: '', ...alt };
  const ok = await dialog({
    title: alt.id ? 'Lagerplatz bearbeiten' : 'Neuer Lagerplatz',
    body: h('div', { class: 'form' },
      h('label', {}, 'Name', h('input', { value: w.name, placeholder: 'z. B. Polterplatz Waldweg Nord', oninput: (e) => { w.name = e.target.value; } })),
      h('label', {}, 'Befahrbarkeit', h('select', { onchange: (e) => { w.befahrbar = e.target.value; } }, BEFAHRBAR.map(([k, l]) => h('option', { value: k, selected: k === w.befahrbar }, l)))),
      h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: !!w.lkw, onchange: (e) => { w.lkw = e.target.checked; } }), 'Wendemöglichkeit für LKW'),
      h('label', {}, 'Platz für ca. (Fm, optional)', h('input', { type: 'number', min: 0, step: 10, inputmode: 'numeric', value: w.menge, oninput: (e) => { w.menge = e.target.value; } })),
      h('label', {}, 'Beschreibung', h('textarea', { rows: 3, placeholder: 'Zufahrt, Untergrund, Hindernisse, Ansprechpartner …', oninput: (e) => { w.text = e.target.value; } }, w.text))),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'Speichern', value: true, primary: true }],
  });
  if (!ok) return null;
  const eintrag = { id: alt.id || uid(), at: alt.at, name: w.name.trim(), befahrbar: w.befahrbar, lkw: !!w.lkw, menge: Number(w.menge) || null, text: w.text.trim(), erfasst: alt.erfasst || Date.now() };
  speichere((e) => { const i = e.lager.findIndex((x) => x.id === eintrag.id); if (i >= 0) e.lager[i] = eintrag; else e.lager.push(eintrag); });
  return eintrag;
}

export const GASSE_BEFAHRBAR = [
  ['', 'nicht angegeben'],
  ['gut', 'jederzeit befahrbar'],
  ['trocken', 'nur bei Trockenheit'],
  ['frost', 'nur bei Frost'],
  ['schonend', 'nur mit Bändern / leichter Technik'],
  ['nicht', 'derzeit nicht befahrbar (nass, Hindernis)'],
];
const gasseBefahrbarText = (k) => GASSE_BEFAHRBAR.find(([x]) => x === k)?.[1] || '';
const HIMMEL = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const himmelsrichtung = (g) => HIMMEL[Math.round((((g % 360) + 360) % 360) / 22.5) % 16];

/** Richtung der Gasse vom ersten zum letzten Punkt (Grad, 0 = Nord, im Uhrzeigersinn) */
export function richtungAusLinie(line) {
  if (!line || line.length < 2) return null;
  const [a, b] = [line[0], line[line.length - 1]];
  const f1 = (a[0] * Math.PI) / 180, f2 = (b[0] * Math.PI) / 180, dl = ((b[1] - a[1]) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/** Kompass des Handys ca. 2 Sekunden lesen und mitteln */
async function kompassMessen() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    const r = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
    if (r !== 'granted') throw new Error('Kompass nicht freigegeben.');
  }
  return new Promise((res, rej) => {
    let sx = 0, sy = 0, n = 0;
    const lesen = (e) => {
      let hd = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null);
      if (hd == null) return;
      hd = (hd + (screen.orientation?.angle ?? 0) + 360) % 360;
      sx += Math.cos((hd * Math.PI) / 180); sy += Math.sin((hd * Math.PI) / 180); n++;
    };
    window.addEventListener('deviceorientationabsolute', lesen); window.addEventListener('deviceorientation', lesen);
    setTimeout(() => {
      window.removeEventListener('deviceorientationabsolute', lesen); window.removeEventListener('deviceorientation', lesen);
      if (!n) rej(new Error('Dieses Gerät liefert keine Kompassrichtung.'));
      else res(Math.round(((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360));
    }, 2000);
  });
}

export async function gasseDialog(g, { neu = false } = {}) {
  const w = { name: g.name || '', grad: g.grad ?? '', befahrbar: g.befahrbar || '', breite: g.breite ?? '', abstand: g.abstand ?? '', notiz: g.notiz || '' };
  const ausLinie = richtungAusLinie(g.line);
  const gradFeld = h('input', { type: 'number', min: 0, max: 359, step: 1, inputmode: 'numeric', value: w.grad, placeholder: ausLinie != null ? `laut Karte ${ausLinie}°` : '', oninput: (e) => { w.grad = e.target.value; zeigeRichtung(); } });
  const richtungText = h('small', { class: 'muted' });
  const zeigeRichtung = () => { const v = Number(w.grad); richtungText.textContent = w.grad !== '' && Number.isFinite(v) ? `= ${himmelsrichtung(v)} (Gegenrichtung ${(v + 180) % 360}°)` : ''; };
  zeigeRichtung();
  const setze = (v) => { w.grad = String(v); gradFeld.value = w.grad; zeigeRichtung(); };
  const knopf = h('button', { type: 'button', class: 'btn btn-small', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Handy in Gassenrichtung halten …';
    try { setze(await kompassMessen()); toast('Richtung übernommen'); } catch (err) { toast(err.message); }
    b.disabled = false; b.textContent = 'Mit Kompass messen';
  } }, 'Mit Kompass messen');
  const r = await dialog({
    title: neu ? 'Angaben zur neuen Rückegasse' : 'Rückegasse',
    body: h('div', { class: 'form' },
      h('p', {}, `Länge ca. ${formatDist(Math.round(laenge(g.line)))}${g.quelle === 'luftbild' ? ' · aus dem Luftbild erkannt' : g.quelle === 'gps' ? ' · per GPS abgelaufen' : ''}`),
      h('label', {}, 'Name oder Nummer', h('input', { value: w.name, placeholder: 'z. B. Gasse 3', oninput: (e) => { w.name = e.target.value; } })),
      h('label', {}, 'Richtung (Grad, Kompass)', gradFeld, richtungText),
      h('div', { class: 'btn-row' }, knopf,
        ausLinie != null ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => setze(ausLinie) }, `Aus Karte: ${ausLinie}°`) : null),
      h('label', {}, 'Befahrbarkeit', h('select', { onchange: (e) => { w.befahrbar = e.target.value; } }, GASSE_BEFAHRBAR.map(([k, l]) => h('option', { value: k, selected: k === w.befahrbar }, l)))),
      h('div', { class: 'form-row' },
        h('label', {}, 'Breite (m)', h('input', { type: 'number', min: 1, max: 10, step: 0.5, inputmode: 'decimal', value: w.breite, placeholder: '4', oninput: (e) => { w.breite = e.target.value; } })),
        h('label', {}, 'Gassenabstand (m)', h('input', { type: 'number', min: 10, max: 80, step: 1, inputmode: 'numeric', value: w.abstand, placeholder: '20', oninput: (e) => { w.abstand = e.target.value; } }))),
      h('label', {}, 'Notiz', h('textarea', { rows: 2, placeholder: 'z. B. Graben am Anfang, Bäume markiert, Steigung', oninput: (e) => { w.notiz = e.target.value; } }, w.notiz))),
    actions: [{ label: 'Löschen', value: 'weg' }, { label: neu ? 'Später' : 'Abbrechen', value: null }, { label: 'Speichern', value: 'ok', primary: true }],
  });
  if (r === 'weg') { if (await confirmDialog('Rückegasse löschen?', { ok: 'Löschen', danger: true })) { speichere((e) => { e.gassen = e.gassen.filter((x) => x.id !== g.id); }); toast('Rückegasse gelöscht'); } return; }
  if (r !== 'ok') return;
  const zahl = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  speichere((e) => {
    const x = e.gassen.find((y) => y.id === g.id); if (!x) return;
    Object.assign(x, { name: w.name.trim(), grad: zahl(w.grad) == null ? null : ((Math.round(zahl(w.grad)) % 360) + 360) % 360, befahrbar: w.befahrbar, breite: zahl(w.breite), abstand: zahl(w.abstand), notiz: w.notiz.trim() });
  });
  toast('Angaben zur Gasse gespeichert');
}

/** Kurzbeschreibung für Tooltip und Listen */
export function gasseText(g) {
  return [g.name || 'Rückegasse', g.grad != null ? `${g.grad}° (${himmelsrichtung(g.grad)})` : null, formatDist(Math.round(laenge(g.line))),
    gasseBefahrbarText(g.befahrbar) || null, g.breite ? `${String(g.breite).replace('.', ',')} m breit` : null, g.notiz || null].filter(Boolean).join(' · ');
}

function lagerPopup(l, { aufBearbeiten } = {}) {
  return h('div', { class: 'lager-popup' },
    h('strong', {}, l.name || 'Lagerplatz'),
    h('p', {}, befahrbarText(l.befahrbar), l.lkw ? ' · LKW kann wenden' : ''),
    l.menge ? h('p', {}, `Platz für ca. ${l.menge} Fm`) : null,
    l.text ? h('p', { class: 'muted' }, l.text) : null,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-small', onclick: () => { aufBearbeiten?.(); lagerDialog(l); } }, 'Bearbeiten'),
      h('button', { class: 'btn btn-small btn-danger-ghost', onclick: async () => { aufBearbeiten?.(); if (await confirmDialog('Lagerplatz löschen?', { ok: 'Löschen', danger: true })) speichere((e) => { e.lager = e.lager.filter((x) => x.id !== l.id); }); } }, 'Löschen'),
      h('a', { class: 'btn btn-small', href: `https://www.google.com/maps/dir/?api=1&destination=${l.at[0]},${l.at[1]}`, target: '_blank', rel: 'noopener' }, 'Navigation')));
}

// ---------- Kartenebenen ----------
/** Ebenen für eine Karte; zeichnen sich bei Änderungen selbst neu */
export function createErschliessungLayers(map, { klickbar = () => true } = {}) {
  const gassen = L.layerGroup(), lager = L.layerGroup();
  function zeichne() {
    gassen.clearLayers(); lager.clearLayers();
    const d = daten();
    for (const g of d.gassen || []) {
      if (!g.line || g.line.length < 2) continue;
      const pl = L.polyline(g.line, { color: GASSE_FARBE, weight: 5, opacity: 0.9, dashArray: '10 6', lineCap: 'butt' });
      pl.bindTooltip(gasseText(g), { sticky: true });
      pl.on('click', (e) => { if (!klickbar()) return; L.DomEvent.stop(e); gasseDialog(g); });
      gassen.addLayer(pl);
    }
    for (const l of d.lager || []) {
      if (!l.at) continue;
      const m = L.marker(l.at, { icon: lagerIcon(), title: l.name || 'Lagerplatz', zIndexOffset: 400 });
      m.bindPopup(() => lagerPopup(l, { aufBearbeiten: () => map.closePopup() }));
      m.on('click', (e) => { if (!klickbar()) { L.DomEvent.stop(e); m.closePopup(); } });
      lager.addLayer(m);
    }
  }
  zeichne();
  const ab = store.subscribe(zeichne);
  return { gassen, lager, entfernen: ab };
}

// ---------- Bearbeiten ----------
export function openErschliessungEditor({ center, zoom = 17, modus = 'gasse', flaeche = null } = {}) {
  const s0 = store.get();
  const mapEl = h('div', { class: 'ersch-map' });
  const leiste = h('div', { class: 'ersch-leiste' });
  const umlaufHost = h('div');
  let draft = [], quelle = 'hand', vorschlaege = [], erkennt = false;
  const inhalt = h('div', { class: 'ersch' }, h('div', { class: 'segmented ersch-modus', role: 'radiogroup', 'aria-label': 'Werkzeug' }), mapEl, leiste, umlaufHost);
  const page = openPage('Erschließung bearbeiten', inhalt, { onClose: () => { umlauf?.stop(); lyr.entfernen(); abo(); map.remove(); } });
  const base = createBaseMap(mapEl, { center, zoom, basemap: s0.settings.basemap, alkis: true });
  const map = base.map;
  L.control.zoom({ position: 'topleft' }).addTo(map);
  const lyr = createErschliessungLayers(map, { klickbar: () => modus === 'ansehen' });
  lyr.gassen.addTo(map); lyr.lager.addTo(map);
  const draftLyr = L.layerGroup().addTo(map), vorLyr = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 250);

  const umlauf = umlaufSteuerung({ map, text: 'Gasse ablaufen', minAbstand: 5, onPunkt: (ll) => { quelle = 'gps'; draft.push(ll); zeichneDraft(); render(); },
    onEnde: () => { draft = vereinfachen(draft, 1.5); zeichneDraft(); render(); } });

  map.on('click', async (e) => {
    const ll = [e.latlng.lat, e.latlng.lng];
    if (modus === 'gasse') { draft.push(ll); zeichneDraft(); render(); }
    else if (modus === 'lager') { const l = await lagerDialog({ at: ll }); if (l) toast('Lagerplatz gespeichert'); }
    else if (modus === 'erkennen' && !erkennt) {
      const p = await source.parcelAt(ll).catch(() => null);
      if (!p) { toast(map.getZoom() < 16 ? 'Zoom näher heran und tippe ein Flurstück an.' : 'An dieser Stelle wurde kein Flurstück gefunden.'); return; }
      waehle(p, false);
    }
  });

  // Gewähltes Flurstück für die Luftbild-Suche: gelb umrandet; aus der Liste gewählt → Karte springt hin
  let wahlP = flaeche;
  const wahlLyr = L.layerGroup().addTo(map);
  function waehle(p, zoomen = true) {
    wahlP = p; vorschlaege = []; zeichneVorschlaege();
    wahlLyr.clearLayers();
    if (p) {
      const pl = L.polygon(polysOf(p), { color: '#FFD400', weight: 4, fillOpacity: 0.08, interactive: false }).addTo(wahlLyr);
      if (zoomen) map.fitBounds(pl.getBounds(), { padding: [20, 20], maxZoom: 18 });
    }
    render();
  }

  function zeichneDraft() {
    draftLyr.clearLayers();
    if (draft.length > 1) draftLyr.addLayer(L.polyline(draft, { color: '#F26B1D', weight: 5, dashArray: '6 6', interactive: false }));
    draft.forEach((p) => draftLyr.addLayer(L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#F26B1D', fillOpacity: 1, interactive: false })));
  }
  function zeichneVorschlaege() {
    vorLyr.clearLayers();
    vorschlaege.forEach((v) => {
      const pl = L.polyline(v.line, { color: v.an ? '#2E7D32' : '#F26B1D', weight: 6, opacity: v.an ? 0.95 : 0.6, dashArray: v.an ? null : '4 8' });
      pl.on('click', (e) => { L.DomEvent.stop(e); v.an = !v.an; zeichneVorschlaege(); render(); });
      vorLyr.addLayer(pl);
    });
  }
  function gasseSpeichern() {
    if (draft.length < 2) return;
    const g = { id: uid(), line: draft.map(([a, b]) => [Number(a.toFixed(7)), Number(b.toFixed(7))]), quelle, erfasst: Date.now() };
    g.grad = richtungAusLinie(g.line);
    speichere((e) => { e.gassen.push(g); });
    draft = []; quelle = 'hand'; zeichneDraft(); render();
    gasseDialog(g, { neu: true });
  }
  async function erkennen(p) {
    erkennt = true; render();
    try {
      const r = await erkenneGassen(p);
      vorschlaege = r.linien.map((line) => ({ line, an: true }));
      zeichneVorschlaege();
      if (vorschlaege.length) map.fitBounds(L.latLngBounds(polysOf(p).flat(2)), { padding: [20, 20] });
      toast(vorschlaege.length ? `${vorschlaege.length} mögliche Gassen gefunden – bitte prüfen` : 'Keine deutlichen Gassen im Luftbild gefunden.');
    } catch (err) { toast(err.message || 'Erkennung fehlgeschlagen'); }
    erkennt = false; render();
  }
  function uebernehmen() {
    const an = vorschlaege.filter((v) => v.an);
    if (!an.length) return;
    speichere((e) => { for (const v of an) e.gassen.push({ id: uid(), line: v.line.map(([a, b]) => [Number(a.toFixed(7)), Number(b.toFixed(7))]), quelle: 'luftbild', erfasst: Date.now() }); });
    toast(`${an.length} Rückegassen übernommen`);
    vorschlaege = []; zeichneVorschlaege(); render();
  }

  function render() {
    const MODI = [['gasse', 'Gasse zeichnen'], ['erkennen', 'Aus Luftbild'], ['lager', 'Lagerplatz'], ['ansehen', 'Ansehen']];
    fill(inhalt.querySelector('.ersch-modus'), MODI.map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(modus === k), onclick: () => {
      modus = k; if (k !== 'gasse') { umlauf.stop?.(); } if (k === 'erkennen' && base.basemap !== 'dop') base.setBasemap('dop'); render();
    } }, l)));
    mapEl.classList.toggle('malt', modus === 'gasse' || modus === 'lager');
    const d = daten();
    const kopf = h('p', { class: 'muted' }, `${d.gassen.length} Rückegassen (${formatDist(Math.round(d.gassen.reduce((s, g) => s + laenge(g.line || []), 0)))}), ${d.lager.length} Lagerplätze gespeichert.`);
    if (modus === 'gasse') {
      fill(leiste, kopf,
        h('p', { class: 'draw-status' }, draft.length ? `${draft.length} Punkte, ${formatDist(Math.round(laenge(draft)))}` : 'Tippe den Verlauf der Gasse Punkt für Punkt in die Karte – oder lauf sie mit dem GPS ab.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-small', disabled: !draft.length, onclick: () => { draft.pop(); zeichneDraft(); render(); } }, 'Letzten Punkt zurück'),
          h('button', { class: 'btn btn-small', disabled: !draft.length, onclick: () => { draft = []; quelle = 'hand'; zeichneDraft(); render(); } }, 'Verwerfen'),
          h('button', { class: 'btn btn-small btn-primary', disabled: draft.length < 2, onclick: gasseSpeichern }, 'Gasse speichern')));
      umlaufHost.hidden = false; fill(umlaufHost, umlauf.el);
    } else {
      umlaufHost.hidden = true;
    }
    if (modus === 'erkennen') {
      const flaechen = (store.get().parcels || []).filter((p) => polysOf(p).length).sort((a, b) => (a.category === 'Wald' ? -1 : 0) - (b.category === 'Wald' ? -1 : 0));
      if (wahlP && !flaechen.some((p) => p.id === wahlP.id)) flaechen.unshift(wahlP);
      const an = vorschlaege.filter((v) => v.an).length;
      fill(leiste, kopf,
        h('p', { class: 'draw-status' }, 'Tippe ein Flurstück in der Karte an oder wähle eine deiner Flächen aus der Liste.'),
        h('div', { class: 'form' },
          flaechen.length ? h('label', {}, 'Flurstück', h('select', { onchange: (e) => { waehle(flaechen.find((x) => x.id === e.target.value) || null); } },
            wahlP ? null : h('option', { value: '', selected: true }, '– bitte wählen –'),
            flaechen.map((p) => h('option', { value: p.id, selected: p.id === wahlP?.id }, `${p.gemarkung}, Flur ${p.flur}, Flurstück ${p.nr}${store.get().parcels.some((x) => x.id === p.id) ? '' : ' (angetippt)'}`)))) : null,
          h('button', { class: 'btn btn-primary', disabled: erkennt || !wahlP, onclick: () => { if (wahlP) erkennen(wahlP); } }, erkennt ? 'Luftbild wird ausgewertet …' : wahlP ? `Rückegassen in Flurstück ${wahlP.nr} suchen` : 'Erst ein Flurstück wählen')),
        vorschlaege.length ? h('div', {},
          h('p', {}, `${vorschlaege.length} Vorschläge – grün wird übernommen. Tippe eine Linie an, um sie ab- oder anzuwählen.`),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-small', onclick: () => { vorschlaege = []; zeichneVorschlaege(); render(); } }, 'Verwerfen'),
            h('button', { class: 'btn btn-small btn-primary', disabled: !an, onclick: uebernehmen }, `${an} übernehmen`))) : null,
        h('p', { class: 'hint' }, 'Die Suche wertet das aktuelle Luftbild (DOP, © GDI-Th) aus: gerade, parallele Lücken im Kronendach. Das ist ein Vorschlag – unter dichtem Kronendach, in Laubholz ohne Laub oder bei Schatten kann sie Gassen übersehen oder Wege und Schneisen für Gassen halten. Bitte vor Ort prüfen.'));
    }
    if (modus === 'lager') fill(leiste, kopf, h('p', { class: 'draw-status' }, 'Tippe in die Karte, wo der Lagerplatz liegt. Danach trägst du Befahrbarkeit und Beschreibung ein.'));
    if (modus === 'ansehen') fill(leiste, kopf, h('p', { class: 'draw-status' }, 'Tippe eine Gasse oder einen Lagerplatz an, um ihn zu bearbeiten oder zu löschen.'));
  }
  render();
  if (modus === 'erkennen') { if (base.basemap !== 'dop') base.setBasemap('dop'); if (flaeche) { waehle(flaeche); erkennen(flaeche); } }
  const abo = store.subscribe(() => { if (modus !== 'gasse' || !draft.length) render(); });
  return page;
}
