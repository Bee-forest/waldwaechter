// Profimodus: Erschließung – Rückegassen (Linien) und Lagerplätze/Polterplätze (Punkte) als eigene Kartenebenen.
// Gassen per Hand, per GPS ablaufen oder als Vorschlag aus dem Luftbild; Lagerplätze mit Befahrbarkeit und Beschreibung.
import { h, fill, dialog, confirmDialog, toast, openPage } from '../ui.js';
import { store, uid } from '../store.js';
import { createBaseMap } from './basemap.js';
import { distance, formatDist, polysOf } from '../geo.js';
import { umlaufSteuerung, vereinfachen } from '../umlauf.js';
import { erkenneGassen } from './gassenerkennung.js';

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

async function gasseDialog(g) {
  let notiz = g.notiz || '';
  const w = await dialog({
    title: 'Rückegasse',
    body: h('div', { class: 'form' },
      h('p', {}, `Länge ca. ${formatDist(Math.round(laenge(g.line)))}${g.quelle === 'luftbild' ? ' · aus dem Luftbild erkannt' : g.quelle === 'gps' ? ' · per GPS abgelaufen' : ''}`),
      h('label', {}, 'Notiz', h('input', { value: notiz, placeholder: 'z. B. Gasse 3, Gassenabstand 20 m', oninput: (e) => { notiz = e.target.value; } }))),
    actions: [{ label: 'Löschen', value: 'weg' }, { label: 'Abbrechen', value: null }, { label: 'Speichern', value: 'ok', primary: true }],
  });
  if (w === 'weg') { if (await confirmDialog('Rückegasse löschen?', { ok: 'Löschen', danger: true })) { speichere((e) => { e.gassen = e.gassen.filter((x) => x.id !== g.id); }); toast('Rückegasse gelöscht'); } return; }
  if (w === 'ok') speichere((e) => { const x = e.gassen.find((y) => y.id === g.id); if (x) x.notiz = notiz.trim(); });
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
      pl.bindTooltip(`Rückegasse${g.notiz ? `: ${g.notiz}` : ''} · ${formatDist(Math.round(laenge(g.line)))}`, { sticky: true });
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
  });

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
    speichere((e) => { e.gassen.push({ id: uid(), line: draft.map(([a, b]) => [Number(a.toFixed(7)), Number(b.toFixed(7))]), quelle, erfasst: Date.now() }); });
    toast(`Rückegasse gespeichert (${formatDist(Math.round(laenge(draft)))})`);
    draft = []; quelle = 'hand'; zeichneDraft(); render();
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
      if (flaeche && !flaechen.some((p) => p.id === flaeche.id)) flaechen.unshift(flaeche);
      let wahl = flaeche?.id || flaechen[0]?.id || '';
      const an = vorschlaege.filter((v) => v.an).length;
      fill(leiste, kopf,
        flaechen.length ? h('div', { class: 'form' },
          h('label', {}, 'Flurstück', h('select', { onchange: (e) => { wahl = e.target.value; } }, flaechen.map((p) => h('option', { value: p.id, selected: p.id === wahl }, `${p.gemarkung}, Flur ${p.flur}, Flurstück ${p.nr}`)))),
          h('button', { class: 'btn btn-primary', disabled: erkennt, onclick: () => { const p = flaechen.find((x) => x.id === wahl); if (p) erkennen(p); } }, erkennt ? 'Luftbild wird ausgewertet …' : 'Rückegassen im Luftbild suchen'))
          : h('p', { class: 'muted' }, 'Leg zuerst Flurstücke als deine Flächen an – die Suche läuft je Flurstück.'),
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
  if (modus === 'erkennen') { if (base.basemap !== 'dop') base.setBasemap('dop'); if (flaeche) erkennen(flaeche); }
  const abo = store.subscribe(() => { if (modus !== 'gasse' || !draft.length) render(); });
  return page;
}
