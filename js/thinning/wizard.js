// Durchforstungs-Workflow: Bestandsauswahl → Angaben → Raster → Navigation im Bestand.
/* global L */
import { h, fill, icon, dialog, confirmDialog, toast } from '../ui.js';
import { store, uid } from '../store.js';
import { source } from '../data/source.js';
import { createBaseMap, tileUrls, BASEMAP_LABELS } from '../map/basemap.js';
import { areaHa, formatHa, formatDist, distance, bearing, compassLabel, destination, bbox, polysOf, areaM2Polys, generateGrid, inPolys, centroid } from '../geo.js';
import { parcelExact, amtlicheFlaecheHa, nutzungAnteile } from '../map/thueringen.js';
import { computePlanMethode, pointRemaining, pointTotal, zufallsLage } from './plan.js';
import { waldbereich } from './wald.js';
import { GRUPPEN, DIMENSION, KRONENSCHLUSS, SZENARIO, HOEHENKLASSEN, RASTER_M, KREIS_M, AUSWEICHEN_M, hoeheKlasse, bLabel, AUSWEICH_TEXT, MAX_FM_EINGRIFF, EIN_EINGRIFF_BIS, anteilSatz, anteilText, oberhoeheAusAlter, gruppeVon, fmt } from './methode.js';
import { bestandInFlaeche, oberhoeheFlaeche, mitKorrektur, pflanzungAm } from '../map/bestand.js';
import { lrtInFlaeche } from '../map/besonderheiten.js';
import { natura2000InFlaeche, inBrutzeit, nachBrutzeit, BRUTZEIT_GESETZ, schutzzeitText, datumText, zeigeVerordnung } from '../schutzgebiete.js';
import { openVertraeglichkeit, protokoll } from '../vertraeglichkeit.js';
import { createPositionSource } from './gps.js';
import { buzz, unlockAudio, keepAwake } from './feedback.js';
import { say, WANZE_SVG } from '../mascot.js';
import * as F4 from './f4.js';
import { computePlanF4 } from './plan.js';
import { standSpeichern, standLaden } from './speicher.js';
import { dateiSpeichern, dateiLaden } from '../dateien.js';
import { Pdf, herunterladen } from '../pdf.js';

const STEPS = ['Fläche', 'Angaben', 'Raster', 'Im Bestand'];
const COLORS = { open: '#D7263D', done: '#2E9E4F', skipped: '#8A948C', target: '#D7263D', leer: '#8A948C' };

export async function openThinningWizard({ parcelId, measureId } = {}) {
  await F4.ladeParameter(); // Durchforstungshilfe Fassung 4: alle Werte aus data/durchforstung_parameter_f4.json
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const myIds = store.get().parcels.map((p) => p.id).filter((id) => byId[id]);
  const myStands = await source.standsForParcels(myIds);

  const st = {
    step: 0,
    mode: 'parcel', // parcel | stand | draw
    sel: null,      // { ring, label, parcelId, stand }
    draft: [],      // Eckpunkte beim Zeichnen
    params: null,
    plan: null,
    measureId: measureId || null,
    zaehler: null,   // Mengenzähler (Fassung 4)
    spur: [],        // GPS-Spur im Bestand
    auffuellen: null, // Rückweg nach dem letzten Punkt
    mindest: false,  // Mindestnutzung aktiv
  };

  const existing = measureId ? store.get().measures.find((m) => m.id === measureId) : null;
  if (existing?.thinning) {
    const t = existing.thinning;
    st.sel = { ring: t.ring, polys: t.polys, clip: t.clip, flaecheHa: t.flaecheHa, parcel: t.parcel, label: t.label, parcelId: existing.parcelId };
    st.mode = t.mode || 'parcel';
    st.params = t.params || null;
    st.plan = t.plan || null;
    st.step = st.plan ? 3 : st.params ? 1 : 0;
  } else if (parcelId && byId[parcelId]) {
    st.sel = selFromParcel(byId[parcelId]);
    queueMicrotask(() => refreshExact());
  }

  // Exakte Flurstücksdaten: amtliche Fläche, vollständige Geometrie (Teilflächen, Löcher), Nutzung
  function selFromParcel(p) {
    const ha = p.flaecheAmtlich ? p.flaecheAmtlich / 10000 : null;
    return {
      ring: p.ring, polys: p.polys, flaecheHa: ha, parcelId: p.id,
      parcel: { gemarkung: p.gemarkung, flur: p.flur, nr: p.nr, gemeinde: p.gemeinde, lage: p.lage, nutzungText: p.nutzungText, id: p.id },
      label: `Flurstück ${p.nr}, Gemarkung ${p.gemarkung}, Flur ${p.flur}`,
    };
  }
  // Gespeicherte Flurstücke aus älteren Versionen haben nur den äußeren Ring → amtliche Daten nachladen
  async function refreshExact() {
    const id = st.sel?.parcelId;
    const p = id && byId[id];
    if (!p || p.source !== 'alkis') return;
    const fresh = await parcelExact(p);
    if (fresh === p || st.sel?.parcelId !== id) return;
    byId[id] = fresh;
    store.update((s) => { const i = s.parcels.findIndex((x) => x.id === id); if (i >= 0) s.parcels[i] = { ...s.parcels[i], ...fresh, category: s.parcels[i].category, addedAt: s.parcels[i].addedAt }; });
    if (st.step <= 1 && !st.plan) { st.sel = selFromParcel(fresh); st.auto = null; if (st.step === 0) renderSelect(); else renderParams(); }
  }
  function parcelCard() {
    const pc = st.sel?.parcel;
    if (!pc) return null;
    const teile = st.sel.polys?.length > 1 ? `${st.sel.polys.length} Teilflächen` : null;
    const loecher = st.sel.polys?.reduce((n, poly) => n + poly.length - 1, 0) || 0;
    return h('dl', { class: 'parcel-facts' },
      h('div', {}, h('dt', {}, 'Flurstück'), h('dd', {}, `${pc.nr}`)),
      h('div', {}, h('dt', {}, 'Gemarkung / Flur'), h('dd', {}, `${pc.gemarkung}, Flur ${pc.flur}`)),
      h('div', {}, h('dt', {}, st.sel.flaecheHa != null ? 'Fläche (amtlich)' : 'Fläche (berechnet)'), h('dd', {}, st.sel.flaecheHa != null ? `${selHa().toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ha (${Math.round(selHa() * 10000).toLocaleString('de-DE')} m²)` : formatHa(selHa()))),
      pc.nutzungText ? h('div', {}, h('dt', {}, 'Nutzung laut ALKIS'), h('dd', {}, pc.nutzungText)) : null,
      waldAnteilZeile(),
      pc.lage ? h('div', {}, h('dt', {}, 'Lage'), h('dd', {}, pc.lage)) : null,
      teile || loecher ? h('div', {}, h('dt', {}, 'Form'), h('dd', {}, [teile, loecher ? `${loecher} ausgesparte Fläche${loecher > 1 ? 'n' : ''}` : null].filter(Boolean).join(', '))) : null,
    );
  }
  // Bekannte Daten passen nicht (z. B. Wald fehlt im ALKIS)? → Fläche selbst einzeichnen, Raster ohne Waldabgleich
  function selbstEinzeichnen() {
    const ring = st.sel?.ring;
    st.mode = 'draw'; st.draft = []; st.sel = null; st.plan = null; st.auto = null; st.params = null;
    go(0);
    if (ring?.length >= 3) setTimeout(() => map.fitBounds(L.polygon(ring).getBounds(), { padding: [24, 24], maxZoom: 18 }), 120);
  }
  function waldHinweis(plan) {
    const w = plan.wald;
    if (!w || w.status === 'ganz') return null;
    const btn = h('button', { type: 'button', class: 'btn btn-small', onclick: selbstEinzeichnen }, 'Fläche selbst einzeichnen');
    if (w.status === 'frei') return h('div', { class: 'lrt-hinweis wald-hinweis ok' },
      h('strong', {}, 'Selbst eingezeichnete Fläche'),
      h('p', {}, 'Das Raster liegt auf der ganzen eingezeichneten Fläche – ohne Abgleich mit den amtlichen Waldflächen. Achte darauf, nur Wald einzuzeichnen.'));
    if (w.status === 'teil') return h('div', { class: 'lrt-hinweis wald-hinweis ok' },
      h('strong', {}, `Raster nur auf der Waldfläche: ca. ${formatHa(w.waldHa)} von ${formatHa(w.gesamtHa)}`),
      h('p', {}, `Außerhalb der Waldfläche liegen keine Rasterpunkte (Quelle: ${w.quelle || 'Waldfläche'}). Stimmt das vor Ort nicht, kannst du die Fläche selbst einzeichnen.`), btn);
    if (w.status === 'kein') return h('div', { class: 'lrt-hinweis wald-hinweis' },
      h('strong', {}, `Hier ist keine Waldfläche verzeichnet (${w.quelle || 'Waldfläche'})`),
      h('p', {}, 'Deshalb legt die App kein automatisches Raster. Ist die Fläche vor Ort trotzdem Wald (z. B. aufgeforstet oder Daten nicht aktuell), zeichne sie selbst ein – dann wird das Raster auf deine Fläche gelegt.'), btn);
    return h('div', { class: 'lrt-hinweis wald-hinweis' },
      h('strong', {}, 'Waldflächen konnten nicht geprüft werden'),
      h('p', {}, 'Die Waldflächen-Karte war nicht erreichbar. Das Raster liegt deshalb auf der ganzen Fläche – prüfe vor Ort, ob alle Punkte im Wald liegen, oder zeichne den Waldteil selbst ein.'), btn);
  }
  function waldAnteilZeile() {
    const w = st.auto?.ring === st.sel?.ring ? st.auto?.wald : null;
    if (!w || w.status === 'frei') return null;
    const txt = { ganz: `${formatHa(w.gesamtHa)} – die ganze Fläche`, teil: `ca. ${formatHa(w.waldHa)} – nur hier liegt das Raster`, kein: 'keine – Raster nur über „Einzeichnen“', fehler: 'nicht abrufbar – Raster über die ganze Fläche' }[w.status];
    return h('div', {}, h('dt', {}, 'Waldfläche'), h('dd', {}, txt));
  }
  const selPolys = () => polysOf(st.sel);
  const selHa = () => st.sel?.stand?.anteilHa ?? st.sel?.flaecheHa ?? areaM2Polys(selPolys()) / 10000;

  // ---------- Grundgerüst ----------
  const stepper = h('ol', { class: 'stepper', 'aria-label': 'Fortschritt' });
  const mapEl = h('div', { class: 'thin-map' });
  // Kartenleiste wie auf der Startseite: OSM/Luftbild und Standortkarte (ohne weitere Layer)
  const baseSwitch = h('div', { class: 'segmented compact', role: 'radiogroup', 'aria-label': 'Basiskarte' });
  const locateBtn = h('button', { class: 'fab small', 'aria-label': 'Mein Standort', title: 'Mein Standort', html: icon.locate, onclick: () => locateMe() });
  const mapTools = h('div', { class: 'thin-map-tools' }, baseSwitch, locateBtn);
  const panel = h('div', { class: 'thin-panel' });
  const page = h('section', { class: 'page thin', role: 'dialog', 'aria-label': 'Durchforstung' },
    h('header', { class: 'page-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Schließen', html: icon.close, onclick: () => close() }),
      h('h1', {}, 'Durchforstung'),
      stepper,
    ),
    h('div', { class: 'thin-map-wrap' }, mapEl, mapTools),
    panel,
  );
  document.getElementById('app').append(page);

  const settings = store.get().settings;
  const base = createBaseMap(mapEl, { center: st.sel ? st.sel.ring[0] : source.center, zoom: 16, basemap: settings.basemap, alkis: settings.layers.alkis !== false });
  const map = base.map;
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Hineinzoomen', zoomOutTitle: 'Herauszoomen' }).addTo(map);
  const renderBaseSwitch = () => fill(baseSwitch, ...Object.entries(BASEMAP_LABELS).map(([k, l]) => h('button', {
    role: 'radio', 'aria-checked': String(base.basemap === k),
    onclick: () => { base.setBasemap(k); store.update((x) => { x.settings.basemap = k; }); renderBaseSwitch(); },
  }, l)));
  renderBaseSwitch();
  // Ortung: eigenen Standort anzeigen (im Bestand folgt die Karte dann wieder dem GPS)
  let meMarker = null, meAcc = null;
  function locateMe() {
    if (st.step === 3 && lastPos) { follow = true; map.panTo(lastPos.latlng); renderHud(); return; }
    if (!('geolocation' in navigator)) { toast('Dein Gerät kann keinen Standort bestimmen.'); return; }
    locateBtn.classList.add('busy');
    navigator.geolocation.getCurrentPosition((pos) => {
      locateBtn.classList.remove('busy');
      const ll = [pos.coords.latitude, pos.coords.longitude];
      meMarker?.remove(); meAcc?.remove();
      meAcc = L.circle(ll, { radius: pos.coords.accuracy, color: '#1F74B8', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { interactive: false, zIndexOffset: 1000, icon: L.divIcon({ className: 'me', html: '<span class="me-dot"></span>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(map);
      map.flyTo(ll, Math.max(map.getZoom(), 17));
    }, (err) => {
      locateBtn.classList.remove('busy');
      toast(err.code === 1 ? 'Standort freigeben: in den Browser-Einstellungen für diese Seite erlauben.' : 'Standort gerade nicht verfügbar. Versuch es unter freiem Himmel erneut.');
    }, { enableHighAccuracy: true, timeout: 15000 });
  }
  const ctxLayer = L.layerGroup().addTo(map);
  const selLayer = L.layerGroup().addTo(map);
  const gridLayer = L.layerGroup().addTo(map);
  const navLayer = L.layerGroup().addTo(map);
  const userLayer = L.layerGroup().addTo(map);
  const probeLayer = L.layerGroup().addTo(map);
  map.on('click', onMapClick);

  let gps = null, follow = true, heading = null, prompted = new Set(), working = null, lastPos = null;
  let pointMarkers = [], targetIdx = -1;

  function close() {
    stopNav();
    map.remove();
    page.classList.add('closing');
    setTimeout(() => page.remove(), 200);
  }

  function renderStepper() {
    fill(stepper, ...STEPS.map((s, i) => h('li', { class: i === st.step ? 'current' : i < st.step ? 'done' : '', 'aria-current': i === st.step ? 'step' : null },
      h('span', { class: 'step-n' }, i + 1), h('span', { class: 'step-l' }, s))));
  }

  function go(step) {
    st.step = step;
    page.classList.toggle('q-mode', step === 1); // bei den Fragen: Karte klein, Fragen groß
    renderStepper();
    ctxLayer.clearLayers(); gridLayer.clearLayers(); navLayer.clearLayers(); probeLayer.clearLayers();
    if (step !== 3) stopNav();
    [renderSelect, renderParams, renderGrid, renderNav][step]();
    // Kartengröße ändert sich je Schritt → Größe neu messen und Fläche wieder einpassen
    setTimeout(() => {
      map.invalidateSize();
      if (step !== 3 && st.sel?.ring?.length >= 3) map.fitBounds(L.polygon(selPolys()).getBounds(), { paddingTopLeft: [24, 76], paddingBottomRight: [24, 24], maxZoom: 18 });
    }, 60);
  }

  function drawSelection(fit = true) {
    selLayer.clearLayers();
    const ring = st.mode === 'draw' && st.step === 0 ? st.draft : st.sel?.ring;
    if (!ring?.length) return;
    const shape = st.mode === 'draw' && st.step === 0 ? ring : selPolys();
    if (ring.length >= 3) selLayer.addLayer(L.polygon(shape, { color: '#F26B1D', weight: 4, fillColor: '#F26B1D', fillOpacity: 0.12, interactive: false }));
    else selLayer.addLayer(L.polyline(ring, { color: '#F26B1D', weight: 4, interactive: false }));
    if (st.mode === 'draw' && st.step === 0) ring.forEach((ll) => selLayer.addLayer(L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: '#F26B1D', fillOpacity: 1, interactive: false })));
    if (fit && ring.length >= 3) map.fitBounds(L.polygon(shape).getBounds(), { padding: [30, 30], maxZoom: 18 });
  }

  // ---------- Schritt 1: Fläche ----------
  function renderSelect() {
    const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Art der Flächenauswahl' },
      [['parcel', 'Flurstück'], ['stand', 'Bestand'], ['draw', 'Einzeichnen']].map(([k, l]) => h('button', {
        role: 'tab', 'aria-selected': String(st.mode === k), onclick: () => { if (k === st.mode) return; st.mode = k; st.draft = []; if (k === 'draw') st.sel = null; renderSelect(); },
      }, l)));
    const content = h('div', { class: 'select-content' });
    const next = h('button', { class: 'btn btn-primary btn-block btn-large', disabled: !st.sel, onclick: async () => { if (await pruefeKonflikt()) go(1); } }, 'Weiter zu den Angaben');

    ctxLayer.clearLayers();
    if (st.mode === 'parcel') {
      const list = myIds.map((id) => byId[id]);
      list.forEach((p) => ctxLayer.addLayer(L.polygon(polysOf(p), { color: '#23573A', weight: 2, fillOpacity: 0.15 }).on('click', (e) => { L.DomEvent.stop(e); pickParcel(p); })));
      content.append(h('p', { class: 'hint tap-hint' }, 'Tippe in der Karte auf ein beliebiges Flurstück oder wähle eines deiner Flächen.'));
      const fremd = st.sel?.parcelId && !st.sel?.stand && !istMeins(st.sel.parcelId);
      if (fremd) content.append(h('button', { class: 'btn btn-small', onclick: addToMine }, h('span', { html: icon.plus || '' }), 'Zu meinen Flächen hinzufügen'));
      content.append(list.length
        ? h('ul', { class: 'pick-list' }, list.map((p) => h('li', {}, h('button', {
            class: 'pick', 'aria-pressed': String(st.sel?.parcelId === p.id && !st.sel?.stand), onclick: () => pickParcel(p),
          }, h('strong', {}, `Flurstück ${p.nr}`), h('span', {}, `${p.gemarkung}, Flur ${p.flur}, ${formatHa(amtlicheFlaecheHa(p))}${p.flaecheAmtlich ? ' (amtlich)' : ''}`)))))
        : h('p', { class: 'muted' }, 'Du hast noch keine eigenen Flächen gespeichert.'));
    } else if (st.mode === 'stand') {
      const stands = myStands.length ? myStands : [];
      stands.forEach((s) => ctxLayer.addLayer(L.polygon(s.polys || s.ring, { color: '#2F7D3A', weight: 2, fillColor: '#2F7D3A', fillOpacity: 0.22 })
        .bindTooltip(`${s.name}: ${s.species}`, { direction: 'center', className: 'stand-tip' })
        .on('click', (e) => { L.DomEvent.stop(e); pickStand(s); })));
      content.append(stands.length
        ? h('ul', { class: 'pick-list' }, stands.map((s) => h('li', {}, h('button', {
            class: 'pick', 'aria-pressed': String(st.sel?.stand?.id === s.id), onclick: () => pickStand(s),
          }, h('strong', {}, `${s.name}: ${s.label}`), h('span', {}, `${s.species}${s.mix ? ` mit ${s.mix}` : ''}${s.age != null ? `, heute ca. ${s.age} Jahre` : ''}, ${s.anteilHa != null ? `ca. ${formatHa(s.anteilHa)} im Flurstück` : formatHa(areaHa(s.ring))}`)))))
        : h('p', { class: 'muted' }, 'Für deine Flächen ist im Waldverzeichnis kein Bestand hinterlegt. Wähle das ganze Flurstück oder zeichne den Bestand ein.'));
    } else {
      content.append(
        h('p', {}, 'Tippe in der Karte nacheinander auf die Eckpunkte des Bestands.'),
        h('p', { class: 'hint' }, 'Eine eingezeichnete Fläche wird nicht mit den amtlichen Waldflächen abgeglichen – das Raster liegt auf der ganzen Fläche. So kannst du auch durchforsten, wenn die bekannten Daten nicht passen.'),
        h('p', { class: 'draw-status', 'aria-live': 'polite' }, st.draft.length >= 3 ? `${st.draft.length} Eckpunkte, ${formatHa(areaHa(st.draft))}` : `${st.draft.length} von mindestens 3 Eckpunkten`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', disabled: !st.draft.length, onclick: () => { st.draft.pop(); updateDraft(); } }, 'Letzten Punkt entfernen'),
          h('button', { class: 'btn', disabled: !st.draft.length, onclick: () => { st.draft = []; updateDraft(); } }, 'Neu beginnen'),
        ),
      );
      if (st.draft.length >= 3) st.sel = { ring: [...st.draft], label: `Eingezeichneter Bestand (${formatHa(areaHa(st.draft))})`, parcelId: null };
    }
    fill(panel, h('h2', { class: 'step-title' }, 'Welche Fläche willst du durchforsten?'), tabs, content,
      st.sel ? h('p', { class: 'selected-label' }, h('span', { html: icon.check }), st.sel.label) : null, parcelCard(), next);
    drawSelection(st.mode !== 'draw');
  }

  function updateDraft() {
    st.sel = st.draft.length >= 3 ? { ring: [...st.draft], label: `Eingezeichneter Bestand (${formatHa(areaHa(st.draft))})`, parcelId: null } : null;
    renderSelect();
  }

  function pickParcel(p) {
    st.sel = selFromParcel(p);
    st.params = null;
    renderSelect();
    refreshExact();
  }

  // Flurstück direkt in der Karte antippen (auch Flurstücke, die noch nicht in „Meine Flächen“ sind)
  let picking = 0;
  async function pickParcelAt(ll) {
    const nr = ++picking;
    toast('Suche Flurstück …');
    let p = null;
    try { p = await source.parcelAt(ll); } catch { p = null; }
    if (nr !== picking || st.step !== 0 || st.mode !== 'parcel') return;
    if (!p) { toast(source.lastError ? 'Flurstücksdienst nicht erreichbar.' : 'Hier wurde kein Flurstück gefunden.'); return; }
    byId[p.id] = byId[p.id] || p;
    pickParcel(byId[p.id]);
  }
  const istMeins = (id) => store.get().parcels.some((x) => x.id === id);
  function addToMine() {
    const p = byId[st.sel?.parcelId];
    if (!p || istMeins(p.id)) return;
    store.update((s) => { s.parcels.push({ ...p, category: p.nutzung || 'Wald', addedAt: Date.now() }); });
    if (!myIds.includes(p.id)) myIds.push(p.id);
    toast('Zu deinen Flächen hinzugefügt');
    renderSelect();
  }

  function pickStand(s) {
    const pc = byId[s.parcelId];
    st.sel = { ring: s.ring, polys: s.polys, clip: s.clip, label: `${s.name}: ${s.label}${pc ? ` (Flurstück ${pc.nr}, ${pc.gemarkung})` : ''}`, parcelId: s.parcelId, stand: s,
      parcel: pc ? { gemarkung: pc.gemarkung, flur: pc.flur, nr: pc.nr, gemeinde: pc.gemeinde, lage: pc.lage, nutzungText: pc.nutzungText, id: pc.id } : null };
    st.params = null;
    renderSelect();
  }

  function onMapClick(e) {
    const ll = [e.latlng.lat, e.latlng.lng];
    if (st.step === 0 && st.mode === 'draw') { st.draft.push(ll); updateDraft(); return; }
    if (st.step === 0 && st.mode === 'parcel') { pickParcelAt(ll); return; }
    if (st.step === 3 && gps?.simulated && !working) gps.setPosition(ll);
  }

  // ---------- Schritt 2: Angaben – eine Frage nach der anderen (neue Methode) ----------
  function defaultParams() {
    const s = st.sel?.stand;
    const art = s?.info?.art || s?.species || '';
    const dim = s ? (s.dg < 25 ? 'duenn' : s.dg < 50 ? 'mittel' : 'dick') : null;
    return { v: 5, art, nadel: null, ho: null, hoQuelle: null, b: null, probe: [{ duenn: 0, mittel: 0, dick: 0 }, { duenn: 0, mittel: 0, dick: 0 }, { duenn: 0, mittel: 0, dick: 0 }], sz: null, szManuell: false, alter: null, eingriffNr: 1, bisherGezaehltHa: 0, q: 0 };
  }

  const QUESTIONS = ['termin', 'art', 'hoehe', 'b', 'probe', 'ergebnis'];

  function renderParams() {
    drawSelection();
    if (!st.params || st.params.main || st.params.v !== 5) st.params = defaultParams(); // alte Angaben (vorherige Version) verwerfen
    if (QUESTIONS[st.params.q] !== 'probe') probeLayer.clearLayers();
    const f = st.params;
    // Baumart, Alter (Waldverzeichnis) und Oberhöhe (LiDAR) einmal je Fläche laden
    if (!st.auto || st.auto.ring !== st.sel.ring) {
      st.auto = { ring: st.sel.ring, loading: true };
      Promise.all([bestandInFlaeche(st.sel.ring, selPolys()).catch(() => null), oberhoeheFlaeche(st.sel.ring, selPolys()).catch(() => null), lrtInFlaeche(st.sel).catch(() => []), natura2000InFlaeche(st.sel).catch(() => []), waldbereich(st.sel, st.mode).catch(() => ({ status: 'fehler' }))]).then(([bestand, oberhoehe, lrt, natura, wald]) => {
        const korr = st.sel.parcelId ? store.get().bestandKorrektur?.[st.sel.parcelId] : null;
        const pf = pflanzungAm(centroid(st.sel.ring));
        if (pf && !(korr?.haupt?.art && (korr.erfasst || 0) > pf.ts)) bestand = { ...(bestand || {}), art: pf.art, text: pf.text, alter: pf.alter, alterStichtag: pf.alterStichtag, stichtag: pf.jahr, quelle: 'eigen' };
        else if (korr?.haupt?.art) bestand = mitKorrektur(bestand, korr);
        st.auto = { ring: st.sel.ring, loading: false, bestand, oberhoehe, lrt, natura, wald };
        if (bestand?.art && !f.art) { f.art = bestand.art; f.artQuelle = bestand.quelle === 'eigen' ? 'eigen' : 'waldverzeichnis'; }
        if (f.ho == null && oberhoehe?.oberhoehe != null) { f.ho = Math.round(oberhoehe.oberhoehe * 10) / 10; f.hoQuelle = 'lidar'; }
        if (st.step === 1) renderParams();
      });
    }
    const qi = Math.min(f.q || 0, QUESTIONS.length - 1);
    const q = QUESTIONS[qi];
    const next = () => { f.q = qi + 1; renderParams(); panel.scrollTop = 0; };
    const back = () => { if (qi === 0) go(0); else { f.q = qi - 1; renderParams(); } };
    const choice = (active, onPick, inner, extra = {}) => h('button', { type: 'button', class: `q-option ${active ? 'on' : ''}`, 'aria-pressed': String(!!active), onclick: onPick, ...extra }, inner);
    const progress = h('div', { class: 'q-progress', 'aria-label': `Frage ${qi + 1} von ${QUESTIONS.length}` },
      QUESTIONS.map((_, i) => h('span', { class: i < qi ? 'done' : i === qi ? 'now' : '' })));
    let title, help, content, canNext = true, nextLabel = 'Weiter';

    const sz = f.schutzzeit || BRUTZEIT_GESETZ;
    const ymd = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    if (q === 'termin') {
      f.termin ??= measure()?.date || Date.now();
      const a = st.auto || {};
      const natura = a.natura || [];
      const drin = natura.length && inBrutzeit(f.termin, sz);
      title = 'Wann soll die Durchforstung stattfinden?';
      help = 'Der Termin wird mit der Brut- und Setzzeit abgeglichen, falls die Fläche in einem Schutzgebiet liegt.';
      const md = (arr) => ymd(new Date(new Date().getFullYear(), arr[0] - 1, arr[1]));
      content = [
        a.wald?.status === 'kein' ? waldHinweis({ wald: a.wald }) : null,
        h('label', { class: 'date-field' }, 'Geplanter Termin',
          h('input', { type: 'date', value: ymd(f.termin), onchange: (e) => { if (e.target.value) { f.termin = new Date(`${e.target.value}T09:00`).getTime(); renderParams(); } } })),
        a.loading ? h('p', { class: 'muted' }, 'Prüfe Schutzgebiete auf der Fläche …')
        : natura.length ? h('div', { class: `lrt-hinweis brutzeit ${drin ? '' : 'ok'}` },
            h('strong', {}, `Die Fläche liegt im ${natura.map((g) => `${g.art} „${g.name || 'ohne Namen'}“`).join(', ')}.`),
            h('p', {}, `Brut- und Setzzeit: ${schutzzeitText(sz)} (${sz.quelle || 'laut Schutzgebietsverordnung'}).`),
            h('div', { class: 'btn-row' }, natura.map((g) => h('button', { type: 'button', class: 'btn btn-small', onclick: () => zeigeVerordnung({ label: g.art, layer: g.layer, props: g.props, text: '' }) }, `Verordnung: ${g.name || g.art}`))),
            h('details', {}, h('summary', {}, 'Die Verordnung nennt einen anderen Zeitraum?'),
              h('div', { class: 'form-row' },
                h('label', { class: 'date-field' }, 'Schutzzeit von', h('input', { type: 'date', value: md(sz.von), onchange: (e) => { const [, mo, d] = e.target.value.split('-').map(Number); if (mo) { f.schutzzeit = { ...sz, von: [mo, d], quelle: 'laut Schutzgebietsverordnung' }; renderParams(); } } })),
                h('label', { class: 'date-field' }, 'bis', h('input', { type: 'date', value: md(sz.bis), onchange: (e) => { const [, mo, d] = e.target.value.split('-').map(Number); if (mo) { f.schutzzeit = { ...sz, bis: [mo, d], quelle: 'laut Schutzgebietsverordnung' }; renderParams(); } } }))),
              f.schutzzeit ? h('button', { type: 'button', class: 'link-btn', onclick: () => { f.schutzzeit = null; renderParams(); } }, 'Zurück zum gesetzlichen Zeitraum (1. März – 30. September)') : null),
            drin
              ? [h('p', {}, h('strong', {}, `Der Termin ${datumText(f.termin)} liegt in der Brut- und Setzzeit.`), ' Lege den Einschlag am besten außerhalb. Geht das nicht, ist vor dem Start eine Verträglichkeits-Vorprüfung nötig.'),
                 h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { f.termin = nachBrutzeit(f.termin, sz); renderParams(); } }, `Auf ${datumText(nachBrutzeit(f.termin, sz))} verschieben`)]
              : h('p', { class: 'ok-line' }, h('span', { html: icon.check }), `Der Termin liegt außerhalb der Brut- und Setzzeit.`))
        : h('p', { class: 'ok-line' }, h('span', { html: icon.check }), 'Kein FFH-, Vogelschutz- oder Naturschutzgebiet auf der Fläche gefunden – der Termin ist frei wählbar.'),
      ];
      canNext = !a.loading && !!f.termin;
    } else if (q === 'art') {
      // Schritt 1: Bestand – Fläche und Hauptbaumart (daraus die Baumartengruppe)
      title = 'Welche Hauptbaumart hat der Bestand?';
      const b = st.auto?.bestand;
      help = b?.art
        ? (b.quelle === 'eigen' ? `Laut deinen Angaben zum Flurstück: ${b.text}${b.alter != null ? `, heute etwa ${b.alter} Jahre` : ''}. Passt das nicht, wähle die Hauptbaumart.` : `Laut Baumartenkarte (Waldverzeichnis ThüringenForst, Stand ${b.stichtag || '?'}): ${b.text}${b.alter != null ? `, heute etwa ${b.alter} Jahre` : ''}. Passt das nicht, wähle die Hauptbaumart.`)
        : st.auto?.loading ? 'Suche die Baumart in der Baumartenkarte …' : `Wähle die Hauptbaumart – ${F4.parameter().hauptbaumart || 'die Baumart mit der größten Grundfläche in der Oberschicht'}. Daraus ergibt sich die Baumartengruppe.`;
      const gruppen = F4.parameter().baumartengruppen;
      const gelistet = Object.values(gruppen).flat();
      const ha = st.auto?.wald?.status === 'teil' ? st.auto.wald.waldHa : selHa();
      content = [
        h('div', { class: 'auto-grid' }, h('div', { class: 'auto-card' }, h('span', {}, 'Fläche'), h('strong', {}, formatHa(ha)), h('small', {}, st.auto?.wald?.status === 'teil' ? 'Waldfläche im Bestand' : 'aus dem Flurstücks- bzw. Bestandspolygon')),
          f.art ? h('div', { class: 'auto-card' }, h('span', {}, 'Baumartengruppe'), h('strong', {}, F4.gruppe(f.art, { nadel: f.nadel })), h('small', {}, f.art)) : null),
        // FESTLEGUNG: Flächen über 5 ha – die Rechnung stammt aus Beständen von 0,5 ha, deshalb Aufteilung empfehlen
        ha > 5 ? h('div', { class: 'lrt-hinweis brutzeit' }, h('strong', {}, `Große Fläche (${formatHa(ha)})`), h('p', {}, 'Die Methode ist an Beständen von etwa 0,5 ha geprüft. Teile die Fläche am besten in mehrere Bestände auf (Fläche selbst einzeichnen) und plane sie einzeln.'),
          h('button', { type: 'button', class: 'btn btn-small', onclick: selbstEinzeichnen }, 'Teilfläche einzeichnen')) : null,
        f.art && !gelistet.includes(f.art) && !f.nadel ? h('p', { class: 'hint' }, `„${f.art}“ steht so nicht in der Liste – zugeordnet zur Gruppe ${F4.gruppe(f.art)}. Wähle sonst die passende Art.`) : null,
        // FESTLEGUNG: Mischbestände – die Hauptbaumart (größter Flächen- oder Grundflächenanteil) bestimmt die Gruppe
        h('p', { class: 'muted' }, 'Mischbestand? Dann zählt die Art mit der größten Grundfläche in der Oberschicht – sie gilt für den ganzen Bestand.'),
        Object.entries(gruppen).map(([g, arten]) => h('div', { class: 'q-group' },
          h('p', { class: 'sheet-label' }, g),
          h('div', { class: 'q-chips' }, arten.map((a) => choice(f.art === a, () => { f.art = a; f.nadel = null; renderParams(); }, a))))),
        h('div', { class: 'q-group' }, h('p', { class: 'sheet-label' }, 'Andere Nadelbaumart'),
          h('label', { class: 'q-own' }, 'Name der Nadelbaumart (z. B. Strobe, Küstentanne)',
            h('input', { value: f.nadel ? f.art : '', placeholder: 'Nadelbaumart', onchange: (e) => { const v = e.target.value.trim(); if (v) { f.art = v; f.nadel = true; } renderParams(); } })),
          h('small', { class: 'muted' }, 'Wird der Gruppe Fi/Ta/Dgl zugeordnet, Kiefernarten der Gruppe Ki/Lä.')),
      ];
      canNext = !!f.art;
    } else if (q === 'hoehe') {
      // Oberhöhe aus LiDAR (korrigierbar, plausibel 5–45 m), Alter nur zur Anzeige
      const a = st.auto || {};
      const loading = a.loading;
      const alter = f.alter ?? a.bestand?.alter ?? null;
      const lidar = a.oberhoehe?.oberhoehe ?? null;
      if (f.ho == null && !loading) {
        if (lidar != null) { f.ho = Math.round(lidar * 10) / 10; f.hoQuelle = 'lidar'; }
        else if (alter) { const est = oberhoeheAusAlter(f.art, alter); if (est) { f.ho = Math.round(est * 10) / 10; f.hoQuelle = 'alter'; } }
      }
      title = 'Wie hoch ist der Bestand (Oberhöhe)?';
      help = 'Gemeint ist die Oberhöhe ho, die Höhe der höchsten Bäume. Sie kommt aus den Laserscan-Daten (LiDAR) Thüringens und lässt sich korrigieren. Das Alter wird nur angezeigt und gespeichert.';
      content = [
        h('div', { class: 'auto-grid' },
          h('div', { class: 'auto-card' }, h('span', {}, 'Oberhöhe ho'),
            h('strong', {}, loading ? '…' : f.ho != null ? `${fmt(f.ho, 1)} m` : 'unbekannt'),
            h('small', {}, f.hoQuelle === 'lidar' ? `LiDAR Thüringen (${a.oberhoehe?.zellen || '?'} Höhenzellen)` : f.hoQuelle === 'alter' ? `geschätzt aus dem Alter (${alter} J.) – bitte prüfen` : f.hoQuelle === 'eigen' ? 'von dir angegeben' : loading ? 'wird ermittelt' : 'bitte eingeben')),
          h('div', { class: 'auto-card' }, h('span', {}, 'Höhenklasse'), h('strong', {}, f.ho != null ? F4.hoehenklasse(f.ho) : '–'), h('small', {}, 'ergibt sich aus ho')),
          h('div', { class: 'auto-card' }, h('span', {}, 'Alter'),
            h('strong', {}, alter != null ? `${alter} Jahre` : loading ? '…' : 'unbekannt'),
            h('small', {}, f.alter != null ? 'von dir geschätzt' : a.bestand?.alter != null ? `Baumartenkarte, Stand ${a.bestand.stichtag}, hochgerechnet` : 'nur zur Dokumentation'))),
        loading ? null : h('label', { class: 'q-own' }, 'Oberhöhe korrigieren (m)',
          h('input', { type: 'number', inputmode: 'decimal', step: 0.1, min: 1, max: 60, value: f.ho ?? '', onchange: (e) => { const v = Number(String(e.target.value).replace(',', '.')); f.ho = v > 0 ? v : null; f.hoQuelle = 'eigen'; renderParams(); } })),
        loading ? null : h('label', { class: 'q-own' }, alter == null ? 'Alter schätzen (Jahre, nur zur Dokumentation)' : 'Alter weicht ab? (Jahre)',
          h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 300, value: f.alter ?? '', onchange: (e) => { const v = Number(e.target.value); f.alter = v > 0 ? v : null; renderParams(); } })),
        f.ho != null && (f.ho < 5 || f.ho > 45) ? h('p', { class: 'warn-line' }, `Eine Oberhöhe von ${fmt(f.ho, 1)} m ist ungewöhnlich (plausibel 5–45 m). Bitte prüfen.`) : null,
      ];
      canNext = !loading && f.ho > 0;
    } else if (q === 'b') {
      // Schritt 2: Bestockungsgrad – Stufe wählen oder Dezimalwert eingeben (abgerundet nach bstufe_regel)
      title = 'Wie dicht ist der Bestand bestockt?';
      help = 'Bestockungsgrad B°: 1,0 = voll bestockt, die Kronen schließen; 0,5 = halb so dicht, deutliche Lücken. Wähle die Stufe oder gib einen genauen Wert ein.';
      content = [
        f.b != null ? h('p', { class: 'ok-line' }, h('span', { html: icon.check }), `B° ${fmt(f.b, 2)} → Stufe „${F4.bstufe(f.b)}“`) : null,
        h('div', { class: 'q-cards two' }, KRONENSCHLUSS.map((k) => choice(f.b != null && F4.bstufe(f.b) === F4.bstufe(k.b), () => { f.b = k.b; renderParams(); },
          [crownSvg(Math.min(k.b, 1.15)), h('span', { class: 'q-text' }, h('strong', {}, `B° ${bLabel(k.b)} – ${k.label}`), h('small', {}, k.text))]))),
        h('label', { class: 'q-own' }, 'Genauer Wert (z. B. 0,62)',
          h('input', { type: 'number', inputmode: 'decimal', step: 0.01, min: 0.3, max: 1.4, value: f.b ?? '', onchange: (e) => { const v = Number(String(e.target.value).replace(',', '.')); f.b = v > 0 ? v : null; renderParams(); } })),
        h('div', { class: 'q-group' }, h('p', { class: 'sheet-label' }, 'Kronenfoto (optional, nur zur Dokumentation)'),
          h('label', { class: 'btn btn-small' }, f.fotoId ? 'Anderes Foto aufnehmen' : 'Foto senkrecht nach oben aufnehmen',
            h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: async (e) => { const datei = e.target.files?.[0]; if (!datei) return; const id = `kronenfoto-${uid()}`; await dateiSpeichern(id, datei).catch(() => null); f.fotoId = id; toast('Kronenfoto gespeichert'); renderParams(); } })),
          f.fotoId ? h('small', { class: 'muted' }, 'Foto gespeichert – daraus wird nichts berechnet.') : null),
      ];
      canNext = f.b != null && f.b > 0;
    } else if (q === 'probe') {
      // Schritt 3: Szenario – vor Ort eingeschätzt, welche Stärke die meisten Bäume stellt (ohne Probezählung)
      probeLayer.clearLayers();
      const opt = [[3, 'duenn', 'Vor allem dünne Bäume', 'BHD 7–25 cm – Stangenholz, viele schlanke Stämme'], [2, 'mittel', 'Vor allem mittlere Bäume', 'BHD über 25 bis 50 cm'], [1, 'dick', 'Vor allem dicke Bäume', 'BHD über 50 cm – starkes Baumholz']];
      title = 'Welche Stärke stellt die meisten Bäume?';
      help = 'Schau dich beim Gang durch den Bestand um und wähle die Stärke, die du am häufigsten siehst. Der BHD wird in 1,30 m Höhe gemessen. Bei einer Mischung zählt die Stärke, die deutlich überwiegt.';
      content = [
        h('div', { class: 'q-cards' }, opt.map(([z, k, t, u]) => choice(f.sz === z, () => { f.sz = z; f.szManuell = true; renderParams(); },
          h('span', { class: 'q-text' }, h('strong', {}, t), h('small', {}, u))))),
      ];
      canNext = f.sz != null;
    } else {
      // Schritt 4: Planung – wird nur angezeigt
      // Folgeeingriff: bisher gezählte Menge aller früheren Eingriffe der Serie (m³/ha)
      if (f.eingriffNr > 1) f.bisherGezaehltHa = bisherGezaehltHa(f.eingriffNr);
      const plan = computePlanF4(st.sel, f, st.auto?.wald);
      st.plan = plan;
      const pl = plan.planung;
      const kein = plan.wald?.status === 'kein';
      if (!pl.feld) {
        title = 'Keine passende Zeile in der Feldtabelle';
        content = h('p', {}, `Für ${pl.gruppe}, Höhe ${pl.hoehenklasse}, B° ${pl.bstufe}, Szenario ${pl.szenario} gibt es keinen Eintrag. Bitte prüfe die Angaben.`);
        canNext = false;
      } else {
        const E = pl.eingriffe, nr = plan.eingriffe.nr;
        const folge = new Date(f.termin || Date.now()); folge.setMonth(folge.getMonth() + Math.round(pl.abstandJahre * 12));
        title = E > 1 ? `Dein Eingriff ${nr} von ${E}` : 'Dein Eingriff';
        help = `Feld: ${pl.gruppe} · Höhe ${pl.hoehenklasse} · B° ${pl.bstufe} · Szenario ${pl.szenario}`;
        const K = (k) => F4.KLASSE_NAME[k];
        content = [
          waldHinweis(plan),
          h('div', { class: 'preview' },
            h('div', {}, h('span', { class: 'pv-n' }, fmt(pl.zielmenge, 1)), h('span', {}, 'm³/ha Zielmenge im Jahrzehnt')),
            h('div', {}, h('span', { class: 'pv-n' }, E), h('span', {}, E === 1 ? 'Eingriff im Jahrzehnt' : 'Eingriffe im Jahrzehnt')),
            h('div', {}, h('span', { class: 'pv-n' }, fmt(pl.mengeHa, 1)), h('span', {}, 'm³/ha bei diesem Eingriff')),
            h('div', {}, h('span', { class: 'pv-n' }, fmt(pl.budget, 2)), h('span', {}, `m³ im Bestand (${formatHa(plan.areaHa)})`))),
          h('div', { class: 'calc-box eingriffe-box' },
            h('strong', {}, E === 1 ? 'Ein Eingriff im Jahrzehnt' : `${E} Eingriffe im Jahrzehnt, Abstand ${fmt(pl.abstandJahre, 1)} Jahre`),
            h('small', {}, `Zielmenge ${fmt(pl.zielmenge, 1)} m³/ha → ${E} Eingriff${E > 1 ? 'e' : ''} (unter 40 m³/ha einer, 40 bis unter 100 zwei, ab 100 drei).`),
            nr === 1
              ? h('small', {}, `Menge dieses Eingriffs: min(${F4.parameter().obergrenze_je_eingriff_m3ha}; ${fmt(pl.zielmenge, 1)} ÷ ${E}) = ${fmt(pl.mengeHa, 2)} m³/ha, im Bestand ${fmt(pl.mengeHa, 2)} × ${fmt(plan.areaHa, 2)} ha = ${fmt(pl.budget, 2)} m³.`)
              : h('small', {}, `Menge dieses Eingriffs: min(${F4.parameter().obergrenze_je_eingriff_m3ha}; (${fmt(pl.zielmenge, 1)} − ${fmt(f.bisherGezaehltHa, 1)} bisher gezählt) ÷ ${E - nr + 1}) = ${fmt(pl.mengeHa, 2)} m³/ha, im Bestand ${fmt(pl.budget, 2)} m³.`),
            E > 1 && nr < E ? h('small', {}, `Folgeeingriff: etwa ${folge.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })} – die App trägt ihn beim Start in den Maßnahmenkalender ein.`) : null,
            h('small', {}, `Mehr als ${F4.parameter().obergrenze_je_eingriff_m3ha} m³/ha je Eingriff lassen sich nicht auszeichnen – der Zähler sperrt.`)),
          h('div', { class: 'raster-rule' },
            h('strong', {}, `Hauptklasse ${K(pl.hauptklasse)} (${Math.round(pl.anteilHaupt * 100)} %), Nebenklasse ${K(pl.nebenklasse)} (${Math.round((1 - pl.anteilHaupt) * 100)} %)`),
            h('small', {}, 'Am Punkt schlägt die App vor, wie viele Bäume welcher Klasse passen. Feste Baumzahlen je Punkt gibt es nicht – verbindlich ist nur die Menge.'),
            h('small', {}, `Raster ${rasterM(plan.raster)} m mit zufälligem Versatz, ${plan.points.length} Punkte in Schlangenlinie, Prüfkreis ${plan.kreis} m, Ausweichen bis ${plan.ausweichen} m.${plan.rasterVerkleinert ? ` Wegen der kleinen Fläche auf ${rasterM(plan.raster)} m verkleinert, damit mindestens 8 Punkte im Bestand liegen.` : ''}`)),
          h('details', { class: 'calc' }, h('summary', {}, 'Zählvolumen je Baum'),
            h('ul', {}, pl.stufen.map((x) => h('li', {}, `${x.name} (${K(x.klasse)}): ${fmt(x.v, 3)} m³`)),
              h('li', {}, 'über 50 cm: BHD messen, Zählvolumen nach Tarif'))),
          parcelCard(),
          st.auto?.natura?.length ? h('div', { class: `lrt-hinweis brutzeit ${inBrutzeit(f.termin, sz) ? '' : 'ok'}` },
            h('strong', {}, `Schutzgebiet: ${st.auto.natura.map((g) => `${g.art} „${g.name || 'ohne Namen'}“`).join(', ')}`),
            h('ul', {}, h('li', {}, `Geplanter Termin: ${datumText(f.termin)}${inBrutzeit(f.termin, sz) ? ` – in der Brut- und Setzzeit (${schutzzeitText(sz)})` : ' – außerhalb der Brut- und Setzzeit'}.`),
              inBrutzeit(f.termin, sz) ? h('li', {}, 'Lässt er sich nicht verschieben, ist eine Verträglichkeits-Vorprüfung nötig – die App führt dich beim Start durch das Formular.') : null)) : null,
          (st.auto?.lrt || []).map((l) => h('div', { class: 'lrt-hinweis' }, h('strong', {}, `Lebensraumtyp auf der Fläche: ${l.titel}`), h('ul', {}, l.punkte.map((t) => h('li', {}, t))))),
          h('p', { class: 'hint' }, `Auswahl: ${plan.auswahl}.`),
          h('p', { class: 'muted' }, `Methode: Durchforstungshilfe ${plan.version}.`),
        ];
        nextLabel = 'Raster auf die Karte legen';
        canNext = !kein && plan.points.length > 0;
      }
    }

    const nextBtn = h('button', { class: 'btn btn-primary btn-large', disabled: !canNext, onclick: async () => {
      if (q === 'hoehe' && (f.ho < 5 || f.ho > 45) && !(await confirmDialog(`Oberhöhe ${fmt(f.ho, 1)} m – stimmt das?`, { ok: 'Ja, stimmt', body: 'Plausibel sind 5 bis 45 m. Prüfe den Wert, bevor du weitergehst.' }))) return;
      if (q === 'ergebnis') go(2); else next();
    } }, nextLabel);
    fill(panel,
      progress,
      h('h2', { class: 'step-title' }, title),
      help ? h('p', { class: 'muted' }, help) : null,
      content,
      h('div', { class: 'btn-row q-nav' }, h('button', { class: 'btn', onclick: back }, 'Zurück'), nextBtn),
    );
  }

  /** Draufsicht auf Kronen: Bedeckungsgrad ~ B° */
  function crownSvg(b) {
    const r = 4 + b * 9.5; // Kronenradius wächst mit B°
    const pts = [[14, 14], [36, 12], [58, 15], [12, 36], [35, 35], [58, 37], [15, 58], [37, 58], [59, 57]];
    return h('span', { class: 'crown', 'aria-hidden': 'true', html: `<svg viewBox="0 0 72 72"><rect width="72" height="72" rx="10" fill="#DCEBF5"/>${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#2F6B3A" opacity=".9"/>`).join('')}</svg>` });
  }

  // ---------- Schritt 3: Raster ----------
  // Punktgröße an den Bildschirmabstand der Rasterpunkte anpassen (keine Überlappung)
  function pointRadius(big = false) {
    const spacing = st.params?.spacing || 20;
    const c = map.getCenter();
    const mpp = 40075016.686 * Math.cos(c.lat * Math.PI / 180) / 2 ** (map.getZoom() + 8);
    const px = spacing / mpp;
    return Math.max(3, Math.min(big ? 14 : 11, px * (big ? 0.5 : 0.38)));
  }
  map.on('zoomend', () => {
    pointMarkers.forEach((mk, i) => mk.setRadius(pointRadius(i === targetIdx)));
    map.getPane('tooltipPane')?.classList.toggle('hide-numbers', pointRadius() < 9);
  });

  function drawGrid(points, { numbers = false } = {}) {
    gridLayer.clearLayers();
    pointMarkers = [];
    gridLayer.addLayer(L.polyline(points.filter((p) => !ausgeblendet(p)).map((p) => p.at), { color: '#D7263D', weight: 1.5, opacity: 0.45, dashArray: '3 6', interactive: false }));
    points.forEach((p, i) => {
      const weg = ausgeblendet(p);
      const m = L.circleMarker(p.at, { radius: pointRadius(), color: '#fff', weight: 2, fillColor: COLORS[p.status], fillOpacity: 1, ...(weg ? { opacity: 0, fillOpacity: 0, interactive: false } : {}) });
      if (numbers && !weg) m.bindTooltip(String(p.id), { permanent: points.length <= 150, direction: 'center', className: 'pt-tip', interactive: false });
      m.on('click', (e) => { L.DomEvent.stop(e); if (st.step === 3) chooseTarget(i); });
      gridLayer.addLayer(m);
      pointMarkers.push(m);
    });
    map.getPane('tooltipPane')?.classList.toggle('hide-numbers', pointRadius() < 9);
  }

  function renderGrid() {
    drawSelection();
    st.plan ??= st.params?.v === 5 ? computePlanF4(st.sel, st.params, st.auto?.wald) : computePlanMethode(st.sel, st.params, st.auto?.wald);
    const plan = st.plan;
    drawGrid(plan.points, { numbers: true });
    if (plan.methode === 'f4') { renderGridF4(plan); return; }
    const radius = st.plan?.kreis || KREIS_M;
    const offline = h('button', { class: 'btn', onclick: (e) => prefetchTiles(st.sel.ring, base.basemap, e.currentTarget) }, h('span', { html: icon.download }), 'Karte für offline speichern');

    fill(panel, 
      h('h2', { class: 'step-title' }, 'Dein Raster'),
      h('div', { class: 'preview' },
        h('div', {}, h('span', { class: 'pv-n' }, plan.points.length), h('span', {}, 'Rasterpunkte')),
        h('div', {}, h('span', { class: 'pv-n' }, plan.total), h('span', {}, 'Bäume gesamt')),
        h('div', {}, h('span', { class: 'pv-n' }, plan.perHa), h('span', {}, 'Bäume je ha')),
        h('div', {}, h('span', { class: 'pv-n' }, fmt(plan.stufe, 1)), h('span', {}, 'Ziel-Entnahme Grundfläche (m²/ha)')),
      ),
      h('p', {}, `Die Punkte liegen im Abstand von ${fmt(plan.raster || RASTER_M, 1)} m${plan.eng ? ' (verdichtet, damit an einem Punkt nicht zu viele Bäume fallen)' : ''}; die Lage ist für diesen Eingriff zufällig gewählt. Je Punkt: ${plan.regel}, im Umkreis von etwa ${plan.kreis || KREIS_M} m. Die gestrichelte Linie zeigt die Laufreihenfolge (Schlangenlinien).`),
      h('p', { class: 'hint' }, 'Im Wald ist oft kein Netz. Speichere die Karte vorher, solange du noch Empfang hast.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { st.plan = null; go(1); } }, 'Angaben ändern'),
        offline,
      ),
      h('button', { class: 'btn btn-primary btn-block btn-large', onclick: startThinning }, h('span', { html: icon.nav }), 'Durchforstung starten'),
    );
  }

  // Schritt 5 (Fassung 4): Rasterpunkte – Lage gibt die Methode vor, sie ist nicht veränderbar
  function renderGridF4(plan) {
    const pl = plan.planung;
    // Punkte ohne Baum (nach der Vorausrechnung) gar nicht erst anzeigen
    st.leerVorhersage = zaehlerNeu().leerePunkte(plan.points.map((p) => p.id));
    drawGrid(plan.points, { numbers: true });
    const sichtbar = plan.points.length - st.leerVorhersage.size;
    const offline = h('button', { class: 'btn', onclick: (e) => prefetchTiles(st.sel.ring, base.basemap, e.currentTarget) }, h('span', { html: icon.download }), 'Karte für offline speichern');
    fill(panel,
      h('h2', { class: 'step-title' }, 'Dein Raster'),
      h('div', { class: 'preview' },
        h('div', {}, h('span', { class: 'pv-n' }, sichtbar), h('span', {}, 'Rasterpunkte anzulaufen')),
        h('div', {}, h('span', { class: 'pv-n' }, fmt(pl.budget, 2)), h('span', {}, 'm³ Menge dieses Eingriffs')),
        h('div', {}, h('span', { class: 'pv-n' }, fmt(pl.mengeHa, 1)), h('span', {}, 'm³/ha')),
        h('div', {}, h('span', { class: 'pv-n' }, rasterM(plan.raster)), h('span', {}, 'm Rasterabstand'))),
      h('p', {}, `Die Punkte liegen im Abstand von ${rasterM(plan.raster)} m mit zufälligem Versatz; die Methode gibt ihre Lage vor. Die gestrichelte Linie zeigt die Laufreihenfolge in Schlangenlinie. Am Punkt zeichnest du im Umkreis von ${plan.kreis} m aus, notfalls bis ${plan.ausweichen} m – höchstens ${F4.maxBaeumeJePunkt()} Bäume je Punkt, damit keine Löcher entstehen.${plan.planung.szenario === 3 ? ' Bei vielen dünnen Bäumen liegen die Punkte enger.' : ''}`),
      st.leerVorhersage.size ? h('p', { class: 'hint' }, `${st.leerVorhersage.size} von ${plan.points.length} Rasterpunkten bekommen nach der Menge voraussichtlich keinen Baum und sind ausgeblendet – dort musst du nicht hin. Die Auswahl wird nach jedem Punkt neu gerechnet.`) : null,
      h('p', { class: 'hint' }, 'Im Wald ist oft kein Netz. Speichere die Karte vorher, solange du noch Empfang hast. Der Zählerstand wird ohne Netz im Gerät gespeichert.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { st.plan = null; go(1); } }, 'Angaben ändern'),
        offline),
      h('button', { class: 'btn btn-primary btn-block btn-large', onclick: startThinning }, h('span', { html: icon.nav }), 'Durchforstung starten'),
    );
  }

  // ---------- Fassung 4: Mengenzähler ----------
  const istF4 = () => st.plan?.methode === 'f4';
  const rasterM = (v) => (Number(v) % 1 ? fmt(v, 1) : fmt(v, 0));
  /** Rasterpunkt ohne Baum: nicht anzeigen, nicht anlaufen */
  const ausgeblendet = (p) => {
    if (st.auffuellen?.art === 'mindest' && !st.auffuellen.fertig && st.auffuellen.liste.includes(p.id)) return false;
    return p.status === 'leer' || (p.status === 'open' && !!st.leerVorhersage?.has(p.id));
  };
  /** Offene Punkte in Laufreihenfolge ab Index from */
  function offeneAb(from = 0) {
    const pts = st.plan.points, out = [];
    for (let k = 0; k < pts.length; k++) { const i = (Math.max(0, from) + k) % pts.length; if (pts[i].status === 'open') out.push(i); }
    return out;
  }
  /**
   * Nächster anzulaufender Punkt: Punkte, an denen nach der Menge kein Baum fällt, werden übergangen
   * (ihre Zuteilung geht wie beim Eintreffen in den Vorrat für die nächsten Punkte) und ausgeblendet.
   */
  function naechsterF4(from) {
    const z = st.zaehler;
    let idx = -1;
    for (const i of offeneAb(from)) {
      const pt = st.plan.points[i];
      if (z.angekommen.includes(pt.id) || z.kopie().ankunft(pt.id, z.angekommen.length + 1).length) { idx = i; break; }
      z.ankunft(pt.id, z.angekommen.length + 1);
      pt.status = 'leer';
    }
    st.leerVorhersage = idx < 0 ? new Set() : z.leerePunkte(offeneAb(idx).map((i) => st.plan.points[i].id));
    saveMeasure(); zaehlerSpeichern();
    drawGrid(st.plan.points, { numbers: true });
    return idx;
  }
  function zaehlerNeu() {
    const pl = st.plan.planung;
    return new F4.Zaehler({ budget: pl.budget, obergrenze: obergrenzeBestand(), punkte: st.plan.points.length, hauptklasse: pl.hauptklasse, nebenklasse: pl.nebenklasse, anteilHaupt: pl.anteilHaupt, vKlasse: pl.vKlasse });
  }
  /** 50 m³/ha × Fläche – die Mindestnutzung darf das Budget überschreiten, diese Grenze nie */
  const obergrenzeBestand = () => F4.parameter().obergrenze_je_eingriff_m3ha * (st.plan.planung.flaecheHa ?? st.plan.areaHa);
  /** 0,5 m²/ha × Fläche */
  const mindestG = () => F4.parameter().mindestnutzung.grundflaeche_m2ha_je_jahrzehnt * (st.plan.planung.flaecheHa ?? st.plan.areaHa);
  /** Gezählte Grundfläche im Jahrzehnt: frühere Eingriffe der Serie + dieser Eingriff */
  const gJahrzehnt = () => bisherGezaehltG(st.plan.eingriffe?.nr || 1) + st.zaehler.grundflaecheGezaehlt();
  const MAX_JE_PUNKT = () => F4.maxBaeumeJePunkt();
  /** Gespeicherten Zählerstand laden – jeder Baum läuft erneut durch die Sperre, das Budget kommt aus dem Plan */
  async function zaehlerLaden() {
    if (!istF4()) return;
    const ausIdb = st.measureId ? await standLaden(st.measureId).catch(() => null) : null;
    const quelle = ausIdb?.zaehler || measure()?.thinning?.zaehler || null;
    if (quelle && st.plan.planung.letzterEingriff == null) st.plan.planung.letzterEingriff = (st.plan.eingriffe?.nr || 1) >= (st.plan.eingriffe?.anzahl || 1);
    st.zaehler = quelle ? F4.Zaehler.ausJSON(quelle, st.plan.planung.budget, obergrenzeBestand()) : zaehlerNeu();
    st.spur = ausIdb?.spur || measure()?.thinning?.spur || [];
    st.auffuellen = ausIdb?.auffuellen ?? measure()?.thinning?.auffuellen ?? null;
    st.mindest = false; // Mindestnutzung läuft jetzt als Rundgang (st.auffuellen.art === 'mindest')
  }
  let speicherTimer = null;
  /** Nach jedem Tippen lokal speichern (IndexedDB) */
  function zaehlerSpeichern() {
    if (!st.zaehler || !st.measureId) return;
    standSpeichern(st.measureId, { zaehler: st.zaehler.toJSON(), spur: st.spur, auffuellen: st.auffuellen, mindest: st.mindest, gespeichert: Date.now() }).catch(() => toast('Zählerstand konnte nicht gespeichert werden.'));
  }
  function spurSpaeter() { clearTimeout(speicherTimer); speicherTimer = setTimeout(zaehlerSpeichern, 8000); }
  /** Bisher gezählte Menge (m³/ha) aller früheren Eingriffe derselben Serie */
  /** Bisher gezählte Grundfläche (m²) aller früheren Eingriffe derselben Serie (für die Mindestnutzung je Jahrzehnt) */
  function bisherGezaehltG(eingriffNr) {
    const serie = measure()?.thinning?.serie;
    if (!serie || eingriffNr <= 1) return 0;
    return store.get().measures.filter((m) => m.type === 'durchforstung' && m.id !== st.measureId && (m.thinning?.serie === serie || m.id === serie) && (m.thinning?.params?.eingriffNr || 1) < eingriffNr && m.thinning?.plan?.methode === 'f4')
      .reduce((a, m) => a + (m.thinning.f4?.gezaehltG ?? (m.thinning.zaehler?.baeume || []).reduce((x, b) => x + F4.grundflaecheBaum(b), 0)), 0);
  }
  function bisherGezaehltHa(eingriffNr) {
    const serie = measure()?.thinning?.serie;
    if (!serie) return 0;
    return store.get().measures.filter((m) => m.type === 'durchforstung' && m.id !== st.measureId && (m.thinning?.serie === serie || m.id === serie) && (m.thinning?.params?.eingriffNr || 1) < eingriffNr && m.thinning?.plan?.methode === 'f4')
      .reduce((a, m) => a + (m.thinning.f4?.gezaehltHa ?? (m.thinning.zaehler ? F4.Zaehler.ausJSON(m.thinning.zaehler, m.thinning.plan.planung.budget).gezaehlt / (m.thinning.plan.areaHa || 1) : 0)), 0);
  }

  function saveMeasure(patch = {}) {
    store.update((s) => {
      let m = s.measures.find((x) => x.id === st.measureId);
      if (!m) {
        st.measureId = uid();
        m = { id: st.measureId, type: 'durchforstung', parcelId: st.sel.parcelId, date: Date.now(), note: '', details: {}, status: 'arbeit', createdAt: Date.now() };
        s.measures.push(m);
      }
      if (st.params?.termin && !patch.date) m.date = st.params.termin;
      m.thinning = { ...(m.thinning || {}), ...(st.zaehler ? { zaehler: st.zaehler.toJSON(), spur: st.spur, auffuellen: st.auffuellen } : {}), ...(st.auto?.natura ? { natura2000: st.auto.natura, lrt: st.auto.lrt } : {}), schutzzeit: st.params?.schutzzeit || m.thinning?.schutzzeit || null, mode: st.mode, ring: st.sel.ring, polys: st.sel.polys, clip: st.sel.clip, flaecheHa: st.sel.flaecheHa, parcel: st.sel.parcel, label: st.sel.label, params: st.params, plan: st.plan };
      Object.assign(m, patch);
    });
  }

  // Nur eine laufende oder geplante Durchforstung je Fläche
  function konflikt() {
    if (!st.sel) return null;
    const meine = polysOf(st.sel);
    const proben = generateGrid(st.sel.ring, 10, { polys: meine }).filter((_, i) => i % 3 === 0).slice(0, 300);
    const meineSerie = measure()?.thinning?.serie || st.measureId;
    return store.get().measures.find((m) => {
      if (m.id === st.measureId || m.type !== 'durchforstung' || m.status === 'fertig' || !m.thinning) return false;
      if (meineSerie && (m.thinning.serie === meineSerie || m.thinning.vorgaenger === st.measureId)) return false;
      if (st.sel.parcelId && m.parcelId === st.sel.parcelId) return true;
      const andere = polysOf(m.thinning);
      if (!andere?.length || !andere[0]?.[0]?.length) return false;
      return proben.some((pt) => inPolys(pt, andere)) || generateGrid(m.thinning.ring, 10, { polys: andere }).filter((_, i) => i % 3 === 0).slice(0, 300).some((pt) => inPolys(pt, meine));
    }) || null;
  }
  async function pruefeKonflikt() {
    const m = konflikt();
    if (!m) return true;
    const pts = m.thinning.plan?.points || [];
    const erledigt = pts.filter((x) => x.status === 'done').length;
    const ei = m.thinning.plan?.eingriffe;
    const wann = m.status === 'geplant' ? `vorgemerkt für ${new Date(m.date).getFullYear()}` : `begonnen, ${erledigt} von ${pts.length} Rasterpunkten erledigt`;
    const v = await dialog({
      title: 'Auf dieser Fläche läuft schon eine Durchforstung',
      body: h('div', {},
        h('p', {}, `${m.thinning.label}${ei?.anzahl > 1 ? ` – Eingriff ${ei.nr} von ${ei.anzahl}` : ''}: ${wann}.`),
        h('p', {}, 'Auf einer Fläche kann immer nur eine Durchforstung zur Zeit geplant oder durchgeführt werden. Schließe die bestehende zuerst ab oder lösche sie in der Maßnahmenübersicht.')),
      actions: [{ label: 'Abbrechen', value: false }, { label: 'Bestehende öffnen', value: true, primary: true }],
    });
    if (v) { close(); openThinningWizard({ measureId: m.id }); }
    return false;
  }

  async function startThinning() {
    if (!(await pruefeKonflikt())) return;
    if (!(await pruefeBrutzeit())) return;
    unlockAudio(); // Nutzergeste → Audio für iOS-Fallback freischalten
    await requestCompass();
    const warSchon = measure()?.status === 'arbeit';
    if (istF4() && !st.zaehler) await zaehlerLaden();
    saveMeasure({ status: 'arbeit' });
    if (istF4()) store.update((x) => { const m = x.measures.find((y) => y.id === st.measureId); m.thinning.ersterEingriff ??= (st.plan.eingriffe.nr === 1 ? Date.now() : null); });
    zaehlerSpeichern();
    protokoll(st.measureId, warSchon ? 'Arbeit im Bestand fortgesetzt' : 'Durchforstung im Bestand begonnen');
    legeFolgeAn();
    go(3);
  }

  // Natura 2000 + Brut- und Setzzeit: verschieben oder Verträglichkeits-Vorprüfung
  async function pruefeBrutzeit() {
    const natura = st.auto?.natura || measure()?.thinning?.natura2000 || [];
    const szm = st.params?.schutzzeit || measure()?.thinning?.schutzzeit || BRUTZEIT_GESETZ;
    if (!natura.length || !inBrutzeit(Date.now(), szm)) return true;
    if (measure()?.anhaenge?.some((a) => a.typ === 'vertraeglichkeit')) return true;
    const v = await dialog({
      title: 'Brut- und Setzzeit im Schutzgebiet',
      body: h('div', {},
        h('p', {}, `Die Fläche liegt im ${natura.map((g) => `${g.art} „${g.name || 'ohne Namen'}“`).join(', ')}. Jetzt ist Brut- und Setzzeit (${schutzzeitText(szm)}).`),
        h('p', {}, 'Lege den Einschlag am besten außerhalb dieser Zeit. Ist das nicht zu umgehen, fülle eine Verträglichkeits-Vorprüfung aus – sie wird an die Maßnahme angehängt.')),
      actions: [{ label: 'Abbrechen', value: null }, { label: `Auf ${datumText(nachBrutzeit(Date.now(), szm))} verschieben`, value: 'verschieben' }, { label: 'Nicht vermeidbar – Vorprüfung ausfüllen', value: 'pruefung', primary: true }],
    });
    if (v === 'verschieben') {
      const d = nachBrutzeit(Date.now(), szm);
      if (st.params) st.params.termin = d;
      saveMeasure({ status: 'geplant', date: d });
      protokoll(st.measureId, `Wegen Brut- und Setzzeit auf ${new Date(d).toLocaleDateString('de-DE')} verschoben`);
      toast(`Einschlag auf ${new Date(d).toLocaleDateString('de-DE')} verschoben – steht im Maßnahmenkalender`);
      close();
      return false;
    }
    if (v === 'pruefung') {
      saveMeasure({ status: 'geplant' });
      openVertraeglichkeit(st.measureId, { kontext: { natura2000: natura, lrt: st.auto?.lrt }, onSaved: () => startThinning() });
      return false;
    }
    return false;
  }

  // Nächste Durchforstung automatisch in den Kalender: innerhalb des Jahrzehnts der nächste Eingriff
  // (Abstand je nach Zahl der Eingriffe, z. B. 5 Jahre bei zwei, 3 Jahre bei drei Eingriffen), danach die
  // nächste Durchforstung im selben Rhythmus – dann mit neu zu erhebenden Angaben.
  function legeFolgeAn() {
    const ei = st.plan?.eingriffe;
    const cur = measure();
    if (!ei || !cur || store.get().measures.some((m) => m.thinning?.vorgaenger === cur.id)) return null;
    const abstand = Math.max(1, ei.abstandJahre || Math.round(10 / (ei.anzahl || 1)));
    let when = new Date(Math.max(Date.now(), st.params?.termin || 0)); when.setFullYear(when.getFullYear() + abstand); when.setHours(9, 0, 0, 0);
    // im Schutzgebiet nicht in die Brut- und Setzzeit legen
    const szF = cur.thinning?.schutzzeit || BRUTZEIT_GESETZ;
    if ((cur.thinning?.natura2000 || st.auto?.natura || []).length && inBrutzeit(when.getTime(), szF)) when = new Date(nachBrutzeit(when.getTime(), szF));
    const serie = cur.thinning?.serie || cur.id;
    const base = { natura2000: cur.thinning?.natura2000, lrt: cur.thinning?.lrt, schutzzeit: cur.thinning?.schutzzeit || null, mode: st.mode, ring: st.sel.ring, polys: st.sel.polys, clip: st.sel.clip, flaecheHa: st.sel.flaecheHa, parcel: st.sel.parcel, label: st.sel.label, vorgaenger: cur.id, serie };
    let thinning, note;
    if (istF4()) {
      // Fassung 4, Schritt 8: Erinnerung zum Datum des 1. Eingriffs + nr · 10/E Jahre
      const erster = cur.thinning?.ersterEingriff || Date.now();
      if (ei.nr < ei.anzahl) {
        when = new Date(erster); when.setFullYear(when.getFullYear() + Math.round(ei.nr * (10 / ei.anzahl))); when.setHours(9, 0, 0, 0);
        if (when.getTime() < Date.now()) { when = new Date(); when.setDate(when.getDate() + 1); when.setHours(9, 0, 0, 0); }
        const params = { ...st.params, eingriffNr: ei.nr + 1, offset: null, q: QUESTIONS.indexOf('ergebnis'), termin: when.getTime() };
        thinning = { ...base, ersterEingriff: erster, params, plan: null };
        note = `Eingriff ${ei.nr + 1} von ${ei.anzahl} – Menge aus dem Rest der Zielmenge, neues zufällig gelegtes Raster.`;
      } else {
        when = new Date(erster); when.setFullYear(when.getFullYear() + 10); when.setHours(9, 0, 0, 0);
        thinning = { ...base, params: null, plan: null };
        note = 'Nächste Durchforstung – Bestand neu ansprechen (Höhe, B°, überwiegende Stärke).';
      }
    } else if (ei.nr < ei.anzahl) {
      const params = { ...st.params, eingriffNr: ei.nr + 1, lage: zufallsLage(), q: 0, termin: when.getTime() };
      thinning = { ...base, params, plan: computePlanMethode(st.sel, params, st.auto?.wald) };
      note = `Eingriff ${ei.nr + 1} von ${ei.anzahl} – neues, zufällig gelegtes Raster.`;
    } else {
      thinning = { ...base, params: null, plan: null };
      note = 'Nächste Durchforstung – Angaben (Kronenschluss, Stärkeklasse, Höhe) vor Ort neu erheben.';
    }
    store.update((s) => s.measures.push({ id: uid(), type: 'durchforstung', parcelId: st.sel.parcelId, date: when.getTime(), note, details: {}, status: 'geplant', createdAt: Date.now(), thinning }));
    cur.thinning && store.update((s) => { const x = s.measures.find((m) => m.id === cur.id); x.thinning.serie = serie; });
    toast(`Nächste Durchforstung für ${when.getFullYear()} im Kalender eingetragen`);
    return when;
  }

  // ---------- Schritt 4: Navigation im Bestand ----------
  function measure() { return store.get().measures.find((m) => m.id === st.measureId); }
  function nextOpenIndex(from = 0) {
    const pts = st.plan.points;
    for (let k = 0; k < pts.length; k++) { const i = (from + k) % pts.length; if (pts[i].status === 'open') return i; }
    return -1;
  }

  const hud = h('div', { class: 'hud' });

  async function renderNav() {
    if (istF4() && !st.zaehler) await zaehlerLaden();
    drawSelection(false);
    drawGrid(st.plan.points, { numbers: true });
    fill(panel, hud);
    const m = measure();
    if (m?.status === 'fertig') { renderFinished(); return; }
    if (st.auffuellen?.fertig) st.auffuellen = null;
    targetIdx = st.auffuellen ? st.plan.points.findIndex((p) => p.id === st.auffuellen.liste[st.auffuellen.pos]) : istF4() ? naechsterF4(0) : nextOpenIndex(0);
    if (targetIdx < 0) { finish(); return; }
    highlightTarget();
    startNav();
    renderHud();
    say(store.get().settings.simulateGps
      ? 'GPS-Simulation ist an. Tippe in die Karte, um deinen Standort zu setzen, oder nutze „Zum Punkt gehen“.'
      : 'Lauf zum markierten Rasterpunkt. Sobald du da bist, vibriert dein Handy.', { duration: 6000 });
  }

  function startNav() {
    if (gps) return;
    const first = st.plan.points[Math.max(0, targetIdx)].at;
    gps = createPositionSource({ simulate: store.get().settings.simulateGps, start: destination(first, 190, 45) });
    gps.start(onPos, (e) => { toast(e.message); renderHud(e.message); });
    keepAwake(true);
    map.on('dragstart', () => { follow = false; renderHud(); });
  }

  function stopNav() {
    gps?.stop(); gps = null;
    keepAwake(false);
    window.removeEventListener('deviceorientationabsolute', onOrient);
    window.removeEventListener('deviceorientation', onOrient);
  }

  function highlightTarget() {
    navLayer.clearLayers();
    pointMarkers.forEach((mk, i) => { const p = st.plan.points[i]; mk.setStyle(ausgeblendet(p) ? { opacity: 0, fillOpacity: 0 } : { opacity: 1, fillOpacity: 1, fillColor: COLORS[p.status] }); mk.setRadius(pointRadius(i === targetIdx)); });
    if (targetIdx < 0) return;
    const pt = st.plan.points[targetIdx];
    navLayer.addLayer(L.marker(pt.at, { interactive: false, icon: L.divIcon({ className: 'target-pulse', html: '<span></span>', iconSize: [44, 44], iconAnchor: [22, 22] }) }));
    navLayer.addLayer(L.circle(pt.at, { radius: st.plan?.ausweichen || AUSWEICHEN_M, color: '#D7263D', weight: 1, dashArray: '2 6', fillOpacity: 0, interactive: false }));
    navLayer.addLayer(L.circle(pt.at, { radius: st.plan?.kreis || KREIS_M, color: '#D7263D', weight: 1.5, dashArray: '4 4', fillOpacity: 0.05, interactive: false }));
  }

  function chooseTarget(i) {
    const pt = st.plan.points[i];
    if (working) return;
    if (pt.status === 'done') { toast(`Rasterpunkt ${pt.id} ist schon erledigt.`); return; }
    if (ausgeblendet(pt)) return;
    if (pt.status === 'skipped') pt.status = 'open';
    targetIdx = i;
    prompted.delete(pt.id);
    highlightTarget();
    renderHud();
    toast(`Neues Ziel: Rasterpunkt ${pt.id}`);
  }

  let userDot, accCircle;
  function onPos(pos) {
    lastPos = pos;
    // GPS-Spur für das Protokoll (alle ≥ 5 m ein Punkt)
    if (istF4() && st.step === 3 && pos.accuracy <= 30) {
      const l = st.spur[st.spur.length - 1];
      if (!l || distance([l[0], l[1]], pos.latlng) >= 5) { st.spur.push([Math.round(pos.latlng[0] * 1e6) / 1e6, Math.round(pos.latlng[1] * 1e6) / 1e6, Date.now()]); spurSpaeter(); }
    }
    if (!userDot) {
      userDot = L.marker(pos.latlng, { interactive: false, zIndexOffset: 1000, icon: L.divIcon({ className: 'me', html: '<span class="me-dot"></span><span class="me-cone"></span>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(userLayer);
      accCircle = L.circle(pos.latlng, { radius: pos.accuracy, color: '#1F74B8', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(userLayer);
    } else { userDot.setLatLng(pos.latlng); accCircle.setLatLng(pos.latlng).setRadius(pos.accuracy); }
    if (pos.heading != null && !Number.isNaN(pos.heading) && heading == null) setCone(pos.heading);
    if (follow) map.panTo(pos.latlng, { animate: true, duration: 0.5 });
    if (working || targetIdx < 0) return;

    const pt = st.plan.points[targetIdx];
    const d = distance(pos.latlng, pt.at);
    const r = Math.min(store.get().settings.arrivalRadius, Math.max(4, (st.plan?.raster || 25) * 0.4)); // im engen Raster kleiner
    if (d <= r && !prompted.has(pt.id)) { prompted.add(pt.id); arrive(targetIdx); }
    else if (d > r * 2) prompted.delete(pt.id);
    renderHud();
  }

  function setCone(deg) {
    const cone = userDot?.getElement()?.querySelector('.me-cone');
    if (cone) { cone.style.transform = `rotate(${deg}deg)`; cone.style.opacity = 1; }
  }

  async function requestCompass() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        await DeviceOrientationEvent.requestPermission().catch(() => 'denied'); // ohne Zusage kommen einfach keine Daten
      }
      window.addEventListener('deviceorientationabsolute', onOrient);
      window.addEventListener('deviceorientation', onOrient);
    } catch { /* kein Kompass */ }
  }
  function onOrient(e) {
    const hd = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null);
    if (hd == null) return;
    heading = hd;
    setCone(hd);
    const arrow = hud.querySelector('.hud-arrow');
    if (arrow && lastPos && targetIdx >= 0) arrow.style.transform = `rotate(${bearing(lastPos.latlng, st.plan.points[targetIdx].at) - heading}deg)`;
  }

  function renderHud(errorMsg) {
    if (working) return;
    if (!st.plan.points[targetIdx]) return;
    if (page.classList.contains('w-mode')) { page.classList.remove('w-mode'); setTimeout(() => map.invalidateSize(), 50); }
    const pts = st.plan.points;
    const done = pts.filter((p) => p.status === 'done').length;
    const pt = pts[targetIdx];
    const sim = gps?.simulated;
    let dist = null, brg = null;
    if (lastPos && pt) { dist = distance(lastPos.latlng, pt.at); brg = bearing(lastPos.latlng, pt.at); }
    const rel = heading != null && brg != null ? brg - heading : brg;
    const acc = lastPos?.accuracy;

    fill(hud, 
      h('div', { class: 'hud-main' },
        h('div', { class: 'hud-arrow-wrap', 'aria-hidden': 'true' },
          h('div', { class: 'hud-arrow', style: rel != null ? `transform:rotate(${rel}deg)` : 'opacity:.25', html: '<svg viewBox="0 0 40 40"><path d="M20 3 33 35 20 27 7 35Z" fill="currentColor"/></svg>' })),
        h('div', { class: 'hud-text' },
          h('p', { class: 'hud-label' }, `Rasterpunkt ${pt.id} von ${pts.length}`),
          h('p', { class: 'hud-dist' }, dist != null ? formatDist(dist) : 'Suche GPS …'),
          h('p', { class: 'hud-sub' }, brg != null ? `Richtung ${compassLabel(brg)}${heading != null ? ', Pfeil zeigt in Laufrichtung' : ', Pfeil mit Norden oben'}` : (errorMsg || 'Warte auf Standort')),
        ),
      ),
      istF4() && st.zaehler ? zaehlerLeiste() : null,
      st.auffuellen ? h('p', { class: 'hint' }, st.auffuellen.art === 'mindest'
        ? `Mindestnutzung: Punkt ${st.auffuellen.pos + 1} von ${st.auffuellen.liste.length} – Grundfläche ${fmt(gJahrzehnt(), 3)} von ${fmt(mindestG(), 3)} m²`
        : `Auffüllen auf dem Rückweg: Punkt ${st.auffuellen.pos + 1} von ${st.auffuellen.liste.length}.`) : null,
      h('div', { class: 'hud-meta' },
        h('span', { class: `gps-chip ${acc == null ? '' : acc <= 10 ? 'good' : acc <= 25 ? 'ok' : 'bad'}` }, sim ? 'GPS simuliert' : acc != null ? `GPS ±${Math.round(acc)} m` : 'GPS: kein Signal'),
        h('span', {}, `${done} erledigt, ${pts.filter((p) => p.status !== 'done' && !ausgeblendet(p)).length} offen`),
      ),
      acc > 25 ? h('p', { class: 'hint warn' }, 'GPS ist gerade ungenau. Bleib kurz stehen oder geh auf eine Lichtung.') : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', onclick: () => startWork(targetIdx) }, 'Ich bin am Punkt'),
        h('button', { class: 'btn', onclick: skipPoint }, 'Überspringen'),
        !follow ? h('button', { class: 'btn', onclick: () => { follow = true; if (lastPos) map.panTo(lastPos.latlng); renderHud(); } }, h('span', { html: icon.locate }), 'Zentrieren') : null,
        sim ? h('button', { class: 'btn btn-ghost', onclick: () => gps.walkTo(pt.at) }, 'Zum Punkt gehen (Simulation)') : null,
      ),
    );
  }

  async function arrive(i) {
    buzz('arrive');
    const pt = st.plan.points[i];
    const isFirst = !st.plan.points.some((p) => p.status !== 'open');
    const ok = await dialog({
      mascot: true,
      title: isFirst ? 'Befindest du dich am ersten Rasterpunkt und möchtest starten?' : `Befindest du dich am Rasterpunkt ${pt.id} und möchtest starten?`,
      body: istF4() ? (st.auffuellen?.art === 'mindest' ? 'Mindestnutzung: Hier den schwächsten passenden Baum auszeichnen – dünn vor mittel vor dick.' : st.auffuellen ? 'Rückweg zum Auffüllen: Hier zuerst die Hauptklasse, dann die Nebenklasse auszeichnen, solange etwas passt.' : 'Am Punkt schlägt dir die App vor, wie viele Bäume welcher Stärke passen.') : `Hier sind ${pointTotal(pt)} ${pointTotal(pt) === 1 ? 'Baum' : 'Bäume'} zu entnehmen.`,
      actions: [{ label: 'Noch nicht', value: false }, { label: 'Starten', value: true, primary: true }],
    });
    if (ok && st.step === 3) startWork(i);
  }

  function startWork(i) {
    if (i < 0) return;
    targetIdx = i;
    working = st.plan.points[i];
    highlightTarget();
    map.flyTo(working.at, Math.max(map.getZoom(), 18), { duration: 0.6 });
    if (istF4()) {
      if (!st.auffuellen) { const vs = st.zaehler.ankunft(working.id, st.zaehler.angekommen.length + 1); working.vorschlag ??= vs; saveMeasure(); }
      zuletzt = null;
      zaehlerSpeichern();
      renderWorkF4();
      return;
    }
    renderWork();
  }

  function renderWork() {
    const pt = working;
    const radius = st.plan?.kreis || KREIS_M;
    const remaining = pointRemaining(pt);
    const persist = () => saveMeasure();

    fill(hud, 
      h('div', { class: 'work-head' },
        h('p', { class: 'hud-label' }, `Rasterpunkt ${pt.id}: Entnahme`),
        h('p', { class: 'muted' }, `Arbeite im Umkreis von etwa ${radius} m um den Punkt; steht dort kein passender Baum, bis ${st.plan?.ausweichen || AUSWEICHEN_M} m ausweichen.`),
        h('p', { class: 'ausweich-hint' }, h('strong', {}, 'Ausweichen: '), AUSWEICH_TEXT.replace('bis 15 m', `bis ${st.plan?.ausweichen || AUSWEICHEN_M} m`)),
      ),
      pt.removals.length
        ? h('ul', { class: 'removals' }, pt.removals.map((r) => h('li', { class: `removal ${r.marked >= r.count ? 'complete' : ''}` },
            h('div', { class: 'removal-text' },
              h('strong', {}, r.species),
              h('span', {}, r.dmax >= 99 ? `BHD über ${r.dmin} cm` : `BHD ${r.dmin} bis ${r.dmax} cm`),
            ),
            h('div', { class: 'counter' },
              h('button', { class: 'count-btn', 'aria-label': `Einen ${r.species} weniger`, disabled: r.marked <= 0, onclick: () => { r.marked--; persist(); renderWork(); } }, '−'),
              h('span', { class: 'count', 'aria-live': 'polite' }, h('b', {}, r.marked), ` / ${r.count}`),
              h('button', { class: 'count-btn plus', 'aria-label': `${r.species} entnommen`, disabled: r.marked >= r.count, onclick: () => { r.marked++; buzz('tick'); persist(); renderWork(); } }, '+'),
            ),
          )))
        : h('p', {}, 'An diesem Punkt ist keine Entnahme vorgesehen. Prüfe den Bestand und schließe den Punkt ab.'),
      h('p', { class: 'hint' }, st.plan.auswahl || ''),
      h('p', { class: 'hint' }, st.plan.hint),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { working = null; highlightTarget(); renderHud(); } }, 'Zurück zur Navigation'),
        h('button', { class: `btn ${remaining === 0 ? 'btn-primary' : ''} btn-large`, onclick: completePoint },
          h('span', { html: icon.check }), remaining === 0 ? 'Punkt abschließen' : `Abschließen (${remaining} offen)`),
      ),
    );
  }

  async function completePoint() {
    if (istF4()) return punktFertigF4();
    const pt = working;
    const remaining = pointRemaining(pt);
    if (remaining > 0 && !(await confirmDialog(`Noch ${remaining} ${remaining === 1 ? 'Baum' : 'Bäume'} offen. Punkt trotzdem abschließen?`, { ok: 'Abschließen', body: 'Das ist sinnvoll, wenn hier weniger passende Bäume stehen als geplant.' }))) return;
    pt.status = 'done';
    pt.doneAt = Date.now();
    working = null;
    buzz('done');
    saveMeasure();
    pointMarkers[targetIdx]?.setStyle({ fillColor: COLORS.done });
    const nxt = nextOpenIndex(targetIdx + 1);
    if (nxt < 0) { finish(); return; }
    const from = pt.at;
    targetIdx = nxt;
    highlightTarget();
    renderHud();
    const n = st.plan.points[nxt];
    say(`Prima, Punkt ${pt.id} ist erledigt! Weiter zu Punkt ${n.id}: ${formatDist(distance(from, n.at))} Richtung ${compassLabel(bearing(from, n.at))}.`, { duration: 4500 });
  }

  function skipPoint() {
    const pt = st.plan.points[targetIdx];
    if (istF4() && st.auffuellen) { working = pt; punktFertigF4(); return; } // im Rundgang: einfach weiter
    pt.status = 'skipped';
    saveMeasure();
    const nxt = istF4() ? naechsterF4(targetIdx + 1) : nextOpenIndex(targetIdx + 1);
    if (nxt < 0) { finish(); return; }
    targetIdx = nxt;
    highlightTarget();
    renderHud();
    toast(`Punkt ${pt.id} übersprungen. Tippe ihn in der Karte an, um später zurückzukehren.`);
  }

  function finish() {
    if (istF4() && !st.plan.points.some((p) => p.status === 'skipped')) { endeF4(); return; }
    stopNav();
    const skipped = st.plan.points.filter((p) => p.status === 'skipped').length;
    saveMeasure(skipped ? {} : { status: 'fertig', finishedAt: Date.now() });
    if (!skipped) protokoll(st.measureId, 'Durchforstung abgeschlossen');
    if (skipped) {
      targetIdx = -1;
      highlightTarget();
      fill(hud, 
        h('p', { class: 'hud-label' }, `Alle offenen Punkte bearbeitet. ${skipped} ${skipped === 1 ? 'Punkt ist' : 'Punkte sind'} übersprungen.`),
        h('p', {}, 'Tippe einen grauen Punkt in der Karte an, um ihn nachzuholen, oder schließe die Maßnahme so ab.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => { st.plan.points.forEach((p) => { if (p.status === 'skipped') p.status = 'open'; }); saveMeasure(); renderNav(); } }, 'Übersprungene nachholen'),
          h('button', { class: 'btn btn-primary', onclick: () => { if (istF4()) { endeF4(); return; } saveMeasure({ status: 'fertig', finishedAt: Date.now() }); renderFinished(); } }, 'Maßnahme abschließen'),
        ),
      );
      return;
    }
    buzz('done');
    say('Geschafft! Alle Rasterpunkte sind erledigt. Die Maßnahme ist abgeschlossen.', { duration: 5000 });
    renderFinished();
  }

  function renderFinished() {
    if (istF4()) { renderFertigF4(); return; }
    const pts = st.plan.points;
    targetIdx = -1;
    navLayer.clearLayers();
    const removed = pts.reduce((s, p) => s + p.removals.reduce((a, r) => a + r.marked, 0), 0);
    fill(hud, 
      h('div', { class: 'finished' },
        h('div', { class: 'finished-bug', html: WANZE_SVG }),
        h('div', {},
          h('h2', {}, 'Durchforstung abgeschlossen'),
          h('p', {}, `${pts.filter((p) => p.status === 'done').length} von ${pts.length} Rasterpunkten erledigt, ${removed} von ${st.plan.total} geplanten Bäumen dokumentiert.`),
        ),
      ),
      naechsterEingriffButton(),
      h('button', { class: 'btn btn-primary btn-block', onclick: close }, 'Zur Maßnahmenübersicht'),
    );
  }

  // Nächster Eingriff im Jahrzehnt: neue Maßnahme mit gleichen Angaben und neuer, zufälliger Rasterlage
  function naechsterEingriffButton() {
    const f = store.get().measures.find((m) => m.thinning?.vorgaenger === st.measureId);
    if (!f) { const when = legeFolgeAn(); if (!when) return null; }
    const x = store.get().measures.find((m) => m.thinning?.vorgaenger === st.measureId);
    return x ? h('p', { class: 'hint' }, `Die nächste Durchforstung ist für ${new Date(x.date).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })} im Maßnahmenkalender eingetragen. Das Datum kannst du dort ändern.`) : null;
  }


  // ---------- Fassung 4: Auszeichnen mit Mengenzähler ----------
  const MELDUNG_PASST_NICHT = 'Dieser Baum passt nicht mehr in die Menge.';
  const MELDUNG_PUNKT_VOLL = `An diesem Punkt sind schon ${F4.maxBaeumeJePunkt()} Bäume ausgezeichnet – bitte zum nächsten Punkt.`;
  const offenePunkte = () => st.plan.points.filter((p) => (p.status === 'open' || p.status === 'skipped') && !ausgeblendet(p)).length;
  /** Ständig sichtbar: gezählt, Rest (m³ und %), Rest je Punkt, Fortschritt */
  function zaehlerLeiste() {
    const z = st.zaehler, pts = st.plan.points;
    const done = pts.filter((p) => p.status === 'done').length;
    const anzulaufen = done + offenePunkte();
    const proz = z.budget > 0 ? Math.round((z.rest / z.budget) * 100) : 0;
    const jePunkt = z.rest / Math.max(1, offenePunkte());
    if (st.auffuellen?.art === 'mindest' && !st.auffuellen.fertig) {
      const g = gJahrzehnt(), gs = mindestG(), og = obergrenzeBestand();
      return h('div', { class: 'zaehler-leiste', role: 'status', 'aria-live': 'polite' },
        h('div', { class: 'zaehler-balken' }, h('span', { style: `width:${gs > 0 ? Math.min(100, (g / gs) * 100) : 0}%` })),
        h('div', { class: 'zaehler-werte' },
          h('span', {}, h('b', {}, `${fmt(g, 3)} m²`), ` Grundfläche von ${fmt(gs, 3)} m²`),
          h('span', {}, h('b', {}, `${fmt(z.gezaehlt, 2)} m³`), ` gezählt, Grenze ${fmt(og, 2)} m³ (${fmt(F4.parameter().obergrenze_je_eingriff_m3ha, 0)} m³/ha)`),
          h('span', {}, `Rundgang Punkt ${st.auffuellen.pos + 1} / ${st.auffuellen.liste.length}`)));
    }
    return h('div', { class: 'zaehler-leiste', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'zaehler-balken' }, h('span', { style: `width:${z.budget > 0 ? Math.min(100, (z.gezaehlt / z.budget) * 100) : 0}%` })),
      h('div', { class: 'zaehler-werte' },
        h('span', {}, h('b', {}, `${fmt(z.gezaehlt, 2)} m³`), ` gezählt von ${fmt(z.budget, 2)}`),
        h('span', {}, h('b', {}, `${fmt(z.rest, 2)} m³`), ` Rest (${proz} %)`),
        h('span', {}, `Rest je Punkt ${fmt(jePunkt, 2)} m³`),
        h('span', {}, `Punkte ${done} / ${anzulaufen}`)));
  }
  function auszeichnen(baum) {
    const punkt = working?.id ?? null;
    const grund = st.zaehler.sperre(Number(baum.v), punkt);
    const b = grund ? null : st.zaehler.auszeichnen({ ...baum, punkt });
    if (!b) { const msg = grund === 'punkt' ? MELDUNG_PUNKT_VOLL : MELDUNG_PASST_NICHT; buzz('arrive'); toast(msg); fehlerMeldung = msg; zuletzt = null; renderWorkF4(); return; }
    fehlerMeldung = null;
    buzz('tick');
    zaehlerSpeichern();
    renderWorkF4();
  }
  let fehlerMeldung = null, bhdEingabe = '', zuletzt = null;
  function renderWorkF4() {
    page.classList.add('w-mode'); // beim Auszeichnen: Karte klein, Zähltasten groß
    const pt = working;
    const z = st.zaehler, pl = st.plan.planung;
    const K = (k) => F4.KLASSE_NAME[k];
    const modus = st.auffuellen?.art === 'mindest' ? 'mindest' : st.auffuellen ? 'auffuellen' : 'punkt';
    const max = MAX_JE_PUNKT();
    const hier = z.baeume.filter((b) => b.punkt === pt.id);
    const hierK = (k) => hier.filter((b) => b.klasse === k).length;
    const hierS = (id) => hier.filter((b) => b.stufe === id && b.klasse !== 'dick').length;
    const punktVoll = hier.length >= max;
    // Soll je Klasse = Vorschlag beim Eintreffen am Punkt (bleibt stehen, damit „1 / 2“ hochzählt)
    const soll = {};
    if (modus === 'punkt') {
      const vs = pt.vorschlag || z.vorschlag(pt.id).map((x) => ({ ...x, anzahl: x.anzahl + hierK(x.klasse) }));
      for (const x of vs) soll[x.klasse] = x.anzahl;
    }
    const passtNichts = !z.darfAuszeichnen(pl.kleinstesStufenVolumen);
    const stufeBtn = (x) => {
      const n = hierS(x.id), passt = z.darfAuszeichnen(x.v, pt.id);
      return h('button', { type: 'button', class: `stufe-btn ${passt ? '' : 'passt-nicht'} ${zuletzt === `s${x.id}` ? 'getippt' : ''}`, 'aria-label': `Baum ${x.name} BHD auszeichnen, ${fmt(x.v, 3)} m³${n ? `, hier schon ${n}` : ''}`,
        onclick: () => { zuletzt = `s${x.id}`; auszeichnen({ v: x.v, klasse: x.klasse, stufe: x.id }); } },
        h('strong', {}, x.name), h('small', {}, `${fmt(x.v, 3)} m³`), n ? h('span', { class: 'stufe-n' }, `${n}×`) : null);
    };
    const bhdFeld = h('input', { type: 'text', inputmode: 'decimal', enterkeyhint: 'done', autocomplete: 'off', placeholder: 'BHD', 'aria-label': 'Gemessener BHD in cm', value: bhdEingabe,
      oninput: (e) => { bhdEingabe = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); bhdZaehlen(); } } });
    const bhdZaehlen = () => {
      const bhd = Number(String(bhdFeld.value).trim().replace(',', '.'));
      if (!bhdFeld.value.trim() || !Number.isFinite(bhd)) { toast('Bitte den gemessenen BHD in cm eingeben.'); bhdFeld.focus(); return; }
      if (bhd <= 50) { toast('Dick heißt über 50 cm BHD. Dünnere Bäume bitte über die Stufen zählen.'); return; }
      if (bhd > 250) { toast('Bitte den BHD in Zentimetern eingeben.'); return; }
      bhdEingabe = ''; zuletzt = 'dick';
      auszeichnen({ v: F4.zaehlvolumenDick(pl.gruppe, bhd, st.params.ho), klasse: 'dick', bhd });
    };
    let ausweichK = null;
    const karte = (k) => {
      const n = hierK(k), s = soll[k] || 0, fertig = s > 0 && n >= s;
      const inhalt = k === 'dick'
        ? h('div', { class: 'dick-zeile' }, h('div', { class: 'mit-einheit' }, bhdFeld, h('span', {}, 'cm')), h('button', { type: 'button', class: `btn btn-primary ${zuletzt === 'dick' ? 'getippt' : ''}`, disabled: punktVoll, onclick: bhdZaehlen }, 'Zählen'))
        : h('div', { class: 'stufen-grid' }, pl.stufen.filter((x) => x.klasse === k).map(stufeBtn));
      const zahl = modus === 'punkt' && s > 0 ? `${n} / ${s}` : n ? `${n} gezählt` : '';
      return h('section', { class: `klasse-karte ${fertig ? 'fertig' : ''} ${s > 0 ? 'soll' : ''}` },
        h('div', { class: 'klasse-kopf' },
          h('strong', {}, `${K(k)}`, h('small', {}, k === 'duenn' ? ' 7–25 cm' : k === 'mittel' ? ' über 25–50 cm' : ' über 50 cm, BHD messen')),
          zahl ? h('span', { class: 'klasse-zahl' }, fertig ? h('span', { html: icon.check }) : null, zahl) : null),
        inhalt,
        // Ausweichregel: kein Baum der verlangten Klasse bis 15 m → ähnlichster Baum
        s > 0 && !fertig && !punktVoll ? h('button', { type: 'button', class: 'link-btn', onclick: () => { ausweichHinweis = k; renderWorkF4(); } }, `Kein Baum der Klasse ${K(k)} bis ${st.plan.ausweichen} m?`) : null);
    };
    if (ausweichHinweis && soll[ausweichHinweis]) ausweichK = ausweichHinweis;
    const klassen = ['duenn', 'mittel', 'dick'];
    let oben = klassen, unten = [];
    if (modus === 'punkt' && Object.keys(soll).length) { oben = klassen.filter((k) => soll[k]); unten = klassen.filter((k) => !soll[k]); }
    if (modus === 'auffuellen') oben = [pl.hauptklasse, pl.nebenklasse, ...klassen.filter((k) => k !== pl.hauptklasse && k !== pl.nebenklasse)];
    const alleFertig = modus === 'punkt' && Object.keys(soll).length > 0 && Object.entries(soll).every(([k, a]) => hierK(k) >= a);
    const gIst = gJahrzehnt(), gSoll = mindestG();
    const kopf = modus === 'mindest' ? [`Mindestnutzung an Punkt ${pt.id}`, `Hier den schwächsten passenden Baum auszeichnen – dünn vor mittel vor dick. Grundfläche bisher ${fmt(gIst, 3)} von ${fmt(gSoll, 3)} m².`]
      : modus === 'auffuellen' ? [`Auffüllen an Punkt ${pt.id}`, `Rückweg: zuerst ${K(pl.hauptklasse)}, dann ${K(pl.nebenklasse)} auszeichnen, solange etwas passt.`]
        : [`Rasterpunkt ${pt.id}`, Object.keys(soll).length
          ? `Hier etwa ${Object.entries(soll).map(([k, a]) => `${a} ${a === 1 ? 'Baum' : 'Bäume'} ${K(k)}`).join(' und ')} auszeichnen – im Umkreis von ${st.plan.kreis} m, notfalls bis ${st.plan.ausweichen} m.`
          : 'Hier ist nach der Menge kein Baum nötig.'];
    const letzter = hier[hier.length - 1];
    const mindestHierFertig = modus === 'mindest' && hier.length > (st.auffuellen.vorher?.[pt.id] ?? 0);
    fill(hud,
      h('div', { class: 'work-head' }, h('p', { class: 'hud-label' }, kopf[0]), h('p', {}, kopf[1])),
      zaehlerLeiste(),
      h('p', { class: `punkt-zahl ${punktVoll ? 'voll' : ''}` }, `${hier.length} von höchstens ${max} Bäumen an diesem Punkt`),
      fehlerMeldung ? h('p', { class: 'warn-line', role: 'alert' }, fehlerMeldung) : null,
      punktVoll ? h('p', { class: 'ok-line' }, h('span', { html: icon.check }), MELDUNG_PUNKT_VOLL) : null,
      passtNichts && modus !== 'mindest' ? h('p', { class: 'warn-line' }, 'Die Menge ist ausgeschöpft – es passt kein Baum mehr.') : null,
      alleFertig && !punktVoll ? h('p', { class: 'ok-line' }, h('span', { html: icon.check }), 'Vorschlag erfüllt – du kannst den Punkt abschließen.') : null,
      mindestHierFertig ? h('p', { class: 'ok-line' }, h('span', { html: icon.check }), F4.mindestnutzungErfuellt(gIst, (st.plan.planung.flaecheHa ?? st.plan.areaHa)) ? 'Mindestnutzung erreicht.' : 'Baum gezählt – weiter zum nächsten Punkt.') : null,
      ausweichK ? h('p', { class: 'hint warn', role: 'note' }, `Kein Baum der Klasse ${K(ausweichK)} bis ${st.plan.ausweichen} m – bitte den ähnlichsten Baum auszeichnen (Durchmesser am nächsten an der Klasse ${K(ausweichK)}).`) : null,
      punktVoll ? null : oben.map(karte),
      !punktVoll && unten.length ? h('details', { class: 'andere-staerke', open: !!ausweichK }, h('summary', {}, `Anderen Baum auszeichnen (${unten.map(K).join(', ')})`),
        h('p', { class: 'muted' }, 'Nicht vorgeschlagen, aber erlaubt, wenn hier kein passender Baum der vorgeschlagenen Stärke steht – die Menge gleicht sich an den nächsten Punkten aus.'),
        unten.map(karte)) : null,
      letzter ? h('div', { class: 'letzter' },
        h('span', {}, `Zuletzt: ${letzter.klasse === 'dick' ? `dick, BHD ${fmt(letzter.bhd, 0)} cm` : `${pl.stufen[letzter.stufe]?.name} (${K(letzter.klasse)})`} · ${fmt(letzter.v, 3)} m³`),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { st.zaehler.rueckgaengig(letzter.id); zuletzt = null; fehlerMeldung = null; zaehlerSpeichern(); renderWorkF4(); } }, 'Rückgängig')) : null,
      hier.length > 1 ? h('details', { class: 'calc' }, h('summary', {}, `Alle ${hier.length} Bäume an diesem Punkt`),
        h('ul', { class: 'baum-liste' }, hier.slice().reverse().map((b) => h('li', {},
          h('span', {}, b.klasse === 'dick' ? `dick, BHD ${fmt(b.bhd, 0)} cm` : `${pl.stufen[b.stufe]?.name} (${K(b.klasse)})`, h('small', {}, ` · ${fmt(b.v, 3)} m³`)),
          h('button', { type: 'button', class: 'btn btn-small', 'aria-label': 'Baum rückgängig machen', onclick: () => { st.zaehler.rueckgaengig(b.id); fehlerMeldung = null; zaehlerSpeichern(); renderWorkF4(); } }, 'Rückgängig'))))) : null,
      h('p', { class: 'hint warn' }, 'Stufe sorgfältig ansprechen, im Zweifel die höhere Stufe wählen; dicke Bäume immer messen.'),
      h('details', { class: 'calc' }, h('summary', {}, 'Welche Bäume bevorzugt?'), h('p', {}, `${st.plan.auswahl[0].toUpperCase()}${st.plan.auswahl.slice(1)}.`)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { working = null; fehlerMeldung = null; ausweichHinweis = null; page.classList.remove('w-mode'); highlightTarget(); renderHud(); } }, 'Zurück zur Navigation'),
        modus === 'auffuellen' ? h('button', { class: 'btn', onclick: () => { st.auffuellen.fertig = true; nachAuffuellen(); } }, 'Auffüllen beenden') : null,
        h('button', { class: `btn btn-primary btn-large ${alleFertig || punktVoll || mindestHierFertig ? 'puls' : ''}`, onclick: completePoint }, h('span', { html: icon.check }),
          modus === 'auffuellen' ? 'Weiter auf dem Rückweg' : modus === 'mindest' ? (mindestHierFertig ? 'Weiter' : 'Hier kein passender Baum – weiter') : 'Punkt abschließen')),
    );
    if (zuletzt) setTimeout(() => hud.querySelectorAll('.getippt').forEach((e) => e.classList.remove('getippt')), 700);
    setTimeout(() => map.invalidateSize(), 50);
  }
  let ausweichHinweis = null;
  /** Nächster Punkt eines Rundgangs (Auffüllen bzw. Mindestnutzung) */
  function rundgangWeiter() {
    const r = st.auffuellen;
    r.pos++;
    if (r.pos >= r.liste.length && r.art === 'mindest') {
      // reihum: neue Runde, solange in der letzten Runde etwas dazukam und Punkte mit weniger als 3 Bäumen bleiben
      const frei = st.plan.points.filter((p) => st.zaehler.amPunkt(p.id) < MAX_JE_PUNKT()).map((p) => p.id);
      if (r.neuInRunde && frei.length) { r.liste = frei; r.pos = 0; r.runde = (r.runde || 1) + 1; r.neuInRunde = 0; }
    }
    zaehlerSpeichern(); saveMeasure();
    return r.pos < r.liste.length;
  }
  function punktFertigF4() {
    const pt = working;
    page.classList.remove('w-mode');
    fehlerMeldung = null; ausweichHinweis = null;
    if (st.auffuellen) {
      const r = st.auffuellen;
      working = null;
      if (r.art === 'mindest') {
        if (st.zaehler.amPunkt(pt.id) > (r.vorher?.[pt.id] ?? 0)) r.neuInRunde = (r.neuInRunde || 0) + 1;
        if (F4.mindestnutzungErfuellt(gJahrzehnt(), st.plan.planung.flaecheHa ?? st.plan.areaHa)) { r.fertig = true; abschlussF4(); return; }
        if (!rundgangWeiter()) { r.fertig = true; r.nichtErreicht = true; abschlussF4(); return; }
      } else {
        // Auffüllen endet, sobald kein Baum mehr passt oder der Rückweg zu Ende ist
        if (!st.zaehler.darfAuszeichnen(st.plan.planung.kleinstesStufenVolumen) || !rundgangWeiter()) { r.fertig = true; nachAuffuellen(); return; }
      }
      targetIdx = st.plan.points.findIndex((p) => p.id === r.liste[r.pos]);
      if (r.art === 'mindest') (r.vorher ||= {})[r.liste[r.pos]] = st.zaehler.amPunkt(r.liste[r.pos]);
      prompted.delete(st.plan.points[targetIdx].id);
      drawGrid(st.plan.points, { numbers: true });
      highlightTarget(); renderHud();
      return;
    }
    pt.status = 'done'; pt.doneAt = Date.now();
    working = null;
    buzz('done');
    saveMeasure(); zaehlerSpeichern();
    pointMarkers[targetIdx]?.setStyle({ fillColor: COLORS.done });
    const nxt = naechsterF4(targetIdx + 1);
    if (nxt < 0) { finish(); return; }
    targetIdx = nxt;
    highlightTarget(); renderHud();
    const n = st.plan.points[nxt];
    say(`Punkt ${pt.id} erledigt. Weiter zu Punkt ${n.id}: ${formatDist(distance(pt.at, n.at))} Richtung ${compassLabel(bearing(pt.at, n.at))}.`, { duration: 4500 });
  }
  /** Nach dem letzten Punkt: Auffüllen anbieten, danach Mindestnutzung prüfen, dann Abschluss */
  async function endeF4() {
    const z = st.zaehler, klein = st.plan.planung.kleinstesStufenVolumen;
    const freiePunkte = st.plan.points.filter((p) => p.status === 'done' && z.amPunkt(p.id) < MAX_JE_PUNKT());
    if (!st.auffuellen && z.darfAuszeichnen(klein) && freiePunkte.length) {
      const ja = await dialog({ title: 'Noch Menge übrig – auffüllen?',
        body: h('div', {}, h('p', {}, `Es sind noch ${fmt(z.rest, 2)} m³ übrig. Die App führt dich auf dem Rückweg über die Punkte in umgekehrter Reihenfolge – nur über Punkte mit weniger als ${MAX_JE_PUNKT()} Bäumen.`),
          h('p', {}, `Dort zuerst ${F4.KLASSE_NAME[st.plan.planung.hauptklasse]}, dann ${F4.KLASSE_NAME[st.plan.planung.nebenklasse]} auszeichnen. Der Rückweg endet, sobald kein Baum mehr passt.`)),
        actions: [{ label: 'Nein, weiter', value: false }, { label: 'Rückweg starten', value: true, primary: true }] });
      if (ja) {
        st.auffuellen = { art: 'auffuellen', liste: freiePunkte.map((p) => p.id).reverse(), pos: 0 };
        zaehlerSpeichern(); saveMeasure();
        targetIdx = st.plan.points.findIndex((p) => p.id === st.auffuellen.liste[0]);
        prompted.clear(); highlightTarget(); renderHud();
        return;
      }
    }
    nachAuffuellen();
  }
  /**
   * Mindestnutzung 0,5 m²/ha je Jahrzehnt: Nach dem letzten Eingriff des Jahrzehnts reihum über die Rasterpunkte,
   * je Punkt (mit weniger als 3 Bäumen) den schwächsten passenden Baum – bis die Grundfläche erreicht ist.
   * Das Budget darf dabei überschritten werden, 50 m³/ha × Fläche nie.
   * FESTLEGUNG: Gezählt wird die Grundfläche aller Eingriffe des Jahrzehnts (frühere Eingriffe der Serie + dieser).
   */
  async function nachAuffuellen() {
    const ha = st.plan.planung.flaecheHa ?? st.plan.areaHa;
    const letzter = st.plan.planung.letzterEingriff ?? ((st.plan.eingriffe?.nr || 1) >= (st.plan.eingriffe?.anzahl || 1));
    const frei = st.plan.points.filter((p) => st.zaehler.amPunkt(p.id) < MAX_JE_PUNKT()).map((p) => p.id);
    if (letzter && st.auffuellen?.art !== 'mindest' && !F4.mindestnutzungErfuellt(gJahrzehnt(), ha) && frei.length) {
      await dialog({ title: 'Mindestnutzung',
        body: h('div', {}, h('p', {}, `Im Jahrzehnt soll mindestens ${fmt(F4.parameter().mindestnutzung.grundflaeche_m2ha_je_jahrzehnt, 1)} m²/ha Grundfläche genutzt werden – hier ${fmt(mindestG(), 3)} m². Bisher gezählt: ${fmt(gJahrzehnt(), 3)} m².`),
          h('p', {}, 'Die App führt dich reihum über die Rasterpunkte. Zeichne je Punkt den schwächsten passenden Baum aus – dünn vor mittel vor dick. Dabei darf die Menge dieses Eingriffs überschritten werden, aber nie 50 m³/ha.')),
        actions: [{ label: 'Los geht’s', value: true, primary: true }] });
      st.zaehler.mindest = true;
      st.auffuellen = { art: 'mindest', liste: frei, pos: 0, runde: 1, neuInRunde: 0, vorher: { [frei[0]]: st.zaehler.amPunkt(frei[0]) } };
      zaehlerSpeichern(); saveMeasure();
      targetIdx = st.plan.points.findIndex((p) => p.id === frei[0]);
      prompted.clear(); drawGrid(st.plan.points, { numbers: true }); highlightTarget(); startNav(); renderHud();
      return;
    }
    if (letzter && st.auffuellen?.art !== 'mindest' && !F4.mindestnutzungErfuellt(gJahrzehnt(), ha)) st.auffuellen = { art: 'mindest', liste: [], pos: 0, fertig: true, nichtErreicht: true };
    abschlussF4();
  }
  /** Schritt 7: Abschluss – Ergebnis speichern, Protokoll als Anhang */
  async function abschlussF4() {
    stopNav();
    page.classList.remove('w-mode');
    working = null; st.auffuellen = st.auffuellen ? { ...st.auffuellen, fertig: true } : null; st.mindest = false;
    const z = st.zaehler, pl = st.plan.planung;
    const ergebnis = auswertungF4();
    if (st.auffuellen?.art === 'mindest') { ergebnis.mindestnutzung = F4.mindestnutzungErfuellt(gJahrzehnt(), pl.flaecheHa ?? st.plan.areaHa) ? 'erreicht' : 'nicht ganz erreicht'; }
    saveMeasure({ status: 'fertig', finishedAt: Date.now() });
    store.update((x) => { const m = x.measures.find((y) => y.id === st.measureId); m.thinning.f4 = ergebnis; });
    zaehlerSpeichern();
    protokoll(st.measureId, `Durchforstung abgeschlossen: ${fmt(z.gezaehlt, 2)} m³ gezählt (${fmt(ergebnis.gezaehltHa, 1)} m³/ha von ${fmt(pl.mengeHa, 1)} m³/ha)`);
    legeFolgeAn();
    buzz('done');
    renderFertigF4();
    // Protokoll als PDF an die Maßnahme hängen
    try {
      const blob = await protokollPdf();
      const id = uid(), name = protokollName('pdf');
      await dateiSpeichern(id, blob);
      store.update((x) => { const m = x.measures.find((y) => y.id === st.measureId); (m.anhaenge ||= []).push({ id, typ: 'durchforstungsprotokoll', titel: 'Durchforstungsprotokoll (PDF)', erstellt: Date.now(), datei: id, name }); });
    } catch (e) { console.error(e); }
  }
  function auswertungF4() {
    const z = st.zaehler, pl = st.plan.planung;
    const jeStufe = pl.stufen.map((x) => { const bs = z.baeume.filter((b) => b.stufe === x.id && b.klasse !== 'dick'); return { stufe: x.name, klasse: x.klasse, anzahl: bs.length, m3: bs.reduce((a, b) => a + b.v, 0) }; });
    const dicke = z.baeume.filter((b) => b.klasse === 'dick');
    const jeKlasse = ['duenn', 'mittel', 'dick'].map((k) => { const bs = z.baeume.filter((b) => b.klasse === k); return { klasse: k, anzahl: bs.length, m3: bs.reduce((a, b) => a + b.v, 0) }; });
    return { gezaehlt: z.gezaehlt, gezaehltHa: z.gezaehlt / (st.plan.areaHa || 1), gezaehltG: z.grundflaecheGezaehlt(), gJahrzehnt: gJahrzehnt(), mindestG: mindestG(), budget: z.budget, mengeHa: pl.mengeHa, baeume: z.baeume.length, jeStufe, jeKlasse, bhd: dicke.map((b) => b.bhd), abgeschlossen: Date.now() };
  }
  function renderFertigF4() {
    const pts = st.plan.points;
    targetIdx = -1; navLayer.clearLayers();
    const e = measure()?.thinning?.f4 || auswertungF4();
    fill(hud,
      h('div', { class: 'finished' },
        h('div', { class: 'finished-bug', html: WANZE_SVG }),
        h('div', {}, h('h2', {}, 'Eingriff abgeschlossen'),
          h('p', {}, `${fmt(e.gezaehlt, 2)} m³ gezählt (${fmt(e.gezaehltHa, 1)} m³/ha) von ${fmt(e.budget, 2)} m³ · ${e.baeume} ${e.baeume === 1 ? 'Baum' : 'Bäume'} · ${pts.filter((p) => p.status === 'done').length} Punkte angelaufen${pts.some((p) => p.status === 'leer') ? `, ${pts.filter((p) => p.status === 'leer').length} ohne Baum ausgelassen` : ''}`))),
      h('ul', { class: 'mat-kurz' }, e.jeKlasse.filter((x) => x.anzahl).map((x) => h('li', {}, `${F4.KLASSE_NAME[x.klasse]}: ${x.anzahl} ${x.anzahl === 1 ? 'Baum' : 'Bäume'}, ${fmt(x.m3, 2)} m³`))),
      h('p', { class: 'hint' }, 'Gezählt ist eine vorsichtige Schätzung. Das tatsächlich geerntete Volumen liegt meist etwas darunter.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: async () => herunterladen(await protokollPdf(), protokollName('pdf'), { titel: 'Durchforstungsprotokoll' }) }, 'Protokoll als PDF'),
        h('button', { class: 'btn', onclick: () => herunterladen(new Blob(['﻿' + protokollCsv()], { type: 'text/csv;charset=utf-8' }), protokollName('csv')) }, 'Protokoll als CSV')),
      naechsterEingriffButton(),
      h('button', { class: 'btn btn-primary btn-block', onclick: close }, 'Zur Maßnahmenübersicht'),
    );
  }
  const protokollName = (endung) => `Durchforstung_${(st.sel?.label || 'Bestand').replace(/[^\wäöüÄÖÜß-]+/g, '_').slice(0, 60)}_${new Date().toISOString().slice(0, 10)}.${endung}`;
  const zahl = (v, d = 3) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
  function protokollCsv() {
    const z = st.zaehler, pl = st.plan.planung, f = st.params;
    const e = auswertungF4();
    const zeilen = [
      ['Durchforstungsprotokoll', `Durchforstungshilfe ${st.plan.version}`],
      ['Datum', new Date().toLocaleString('de-DE')], ['Bestand', st.sel?.label || ''], ['Fläche (ha)', zahl(st.plan.areaHa, 4)],
      ['Hauptbaumart', f.art], ['Baumartengruppe', pl.gruppe], ['Oberhöhe ho (m)', zahl(f.ho, 1)], ['Alter (Jahre)', f.alter ?? st.auto?.bestand?.alter ?? ''], ['B°', zahl(f.b, 2)],
      ['Überwiegende Stärke', { 1: 'dick', 2: 'mittel', 3: 'dünn' }[f.sz] || ''],
      ['Feld', `${pl.gruppe} | ${pl.hoehenklasse} | ${pl.bstufe} | ${pl.szenario}`], ['Zielmenge (m³/ha)', zahl(pl.zielmenge, 1)], ['Eingriff', `${st.plan.eingriffe.nr} von ${pl.eingriffe}`],
      ['Menge (m³/ha)', zahl(pl.mengeHa, 3)], ['Budget (m³)', zahl(z.budget, 3)], ['Gezählt (m³)', zahl(z.gezaehlt, 3)], ['Grundfläche gezählt (m²)', zahl(z.grundflaecheGezaehlt(), 4)], ['Grundfläche im Jahrzehnt (m²) / Mindestnutzung', `${zahl(gJahrzehnt(), 4)} / ${zahl(mindestG(), 4)}${measure()?.thinning?.f4?.mindestnutzung ? ` (${measure().thinning.f4.mindestnutzung})` : ''}`], ['Gezählt (m³/ha)', zahl(e.gezaehltHa, 3)],
      ['Hinweis', 'Gezählt ist eine vorsichtige Schätzung. Das tatsächlich geerntete Volumen liegt meist etwas darunter.'],
      [],
      ['Nr', 'Rasterpunkt', 'Stufe bzw. BHD (cm)', 'Klasse', 'Zählvolumen (m³)', 'Zeit'],
      ...z.baeume.map((b, i) => [i + 1, b.punkt ?? 'Mindestnutzung', b.klasse === 'dick' ? zahl(b.bhd, 0) : `${pl.stufen[b.stufe]?.name}${b.bhd ? ` (gemessen ${zahl(b.bhd, 0)})` : ''}`, F4.KLASSE_NAME[b.klasse], zahl(b.v), new Date(b.t).toLocaleString('de-DE')]),
      [],
      ['Rasterpunkt', 'Breite', 'Länge', 'Status', 'Bäume', 'm³'],
      ...st.plan.points.map((p) => { const bs = z.baeume.filter((b) => b.punkt === p.id); return [p.id, p.at[0].toFixed(6), p.at[1].toFixed(6), { done: 'erledigt', skipped: 'übersprungen', open: 'offen', leer: 'ohne Baum, nicht angelaufen' }[p.status], bs.length, zahl(bs.reduce((a, b) => a + b.v, 0))]; }),
      [],
      ['GPS-Spur Breite', 'Länge', 'Zeit'],
      ...st.spur.map(([la, lo, t]) => [la.toFixed(6), lo.toFixed(6), new Date(t).toLocaleString('de-DE')]),
    ];
    return zeilen.map((r) => r.map((c) => { const t = String(c ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(';')).join('\r\n');
  }
  async function protokollPdf() {
    const z = st.zaehler, pl = st.plan.planung, f = st.params, e = auswertungF4();
    const doc = new Pdf();
    const L0 = 50, R = 545;
    let y = 50;
    const zeile = (a, b) => { if (y > 790) { doc.neueSeite(); y = 50; } doc.text(L0, y, a, { size: 9, farbe: [90, 100, 90] }); doc.text(L0 + 165, y, String(b ?? '–'), { size: 9 }); y += 13; };
    doc.text(L0, y, 'Durchforstungsprotokoll', { bold: true, size: 18, farbe: [27, 77, 46] }); y += 18;
    doc.text(L0, y, `${st.sel?.label || 'Bestand'} · ${new Date().toLocaleDateString('de-DE')} · Durchforstungshilfe ${st.plan.version}`, { size: 9.5 }); y += 18;
    doc.text(L0, y, 'Eingaben', { bold: true, size: 11 }); y += 14;
    zeile('Fläche', `${formatHa(st.plan.areaHa)}`); zeile('Hauptbaumart / Gruppe', `${f.art} / ${pl.gruppe}`);
    zeile('Oberhöhe ho', `${fmt(f.ho, 1)} m (${f.hoQuelle === 'lidar' ? 'LiDAR' : f.hoQuelle === 'alter' ? 'aus dem Alter geschätzt' : 'eigene Angabe'})`);
    zeile('Alter', f.alter ?? st.auto?.bestand?.alter ?? 'unbekannt'); zeile('Bestockungsgrad B°', `${fmt(f.b, 2)} (Stufe ${pl.bstufe})`);
    zeile('Überwiegende Stärke', `${{ 1: 'dick', 2: 'mittel', 3: 'dünn' }[f.sz] || '–'} (vor Ort eingeschätzt)`);
    zeile('Szenario', `${pl.szenario}`);
    y += 6; doc.text(L0, y, 'Feld und Menge', { bold: true, size: 11 }); y += 14;
    zeile('Feld', `${pl.gruppe} · ${pl.hoehenklasse} · ${pl.bstufe} · Szenario ${pl.szenario}`);
    zeile('Zielmenge im Jahrzehnt', `${fmt(pl.zielmenge, 1)} m³/ha, ${pl.eingriffe} Eingriff${pl.eingriffe > 1 ? 'e' : ''}`);
    zeile('Dieser Eingriff', `${st.plan.eingriffe.nr} von ${pl.eingriffe}: ${fmt(pl.mengeHa, 2)} m³/ha = ${fmt(z.budget, 2)} m³ im Bestand`);
    zeile('Gezählt', `${fmt(z.gezaehlt, 2)} m³ = ${fmt(e.gezaehltHa, 2)} m³/ha (${z.budget > 0 ? Math.round((z.gezaehlt / z.budget) * 100) : 0} % der Menge)`);
    zeile('Grundfläche', `${fmt(z.grundflaecheGezaehlt(), 3)} m² in diesem Eingriff, ${fmt(gJahrzehnt(), 3)} m² im Jahrzehnt (Mindestnutzung ${fmt(mindestG(), 3)} m²)${e.mindestnutzung || measure()?.thinning?.f4?.mindestnutzung ? ` – ${e.mindestnutzung || measure().thinning.f4.mindestnutzung}` : ''}`);
    zeile('Rasterpunkte', `${st.plan.points.filter((p) => p.status === 'done').length} erledigt, ${st.plan.points.filter((p) => p.status === 'leer').length} ohne Baum ausgelassen, ${st.plan.points.length} gesamt, Raster ${rasterM(st.plan.raster)} m`);
    zeile('GPS-Spur', `${st.spur.length} Punkte`);
    y += 6; doc.text(L0, y, 'Bäume je Stufe bzw. Klasse', { bold: true, size: 11 }); y += 14;
    e.jeStufe.forEach((x) => zeile(`${x.stufe} (${F4.KLASSE_NAME[x.klasse]})`, `${x.anzahl} Bäume, ${fmt(x.m3, 3)} m³`));
    zeile('über 50 cm (gemessen)', `${e.bhd.length} Bäume${e.bhd.length ? `, BHD ${e.bhd.map((b) => fmt(b, 0)).join(', ')} cm` : ''}, ${fmt(e.jeKlasse.find((x) => x.klasse === 'dick').m3, 3)} m³`);
    y += 4;
    doc.text(L0, y, 'Gezählt ist eine vorsichtige Schätzung. Das tatsächlich geerntete Volumen liegt meist etwas darunter.', { size: 8.5, bold: true }); y += 16;
    // Karte: Fläche, Rasterpunkte, GPS-Spur
    if (y > 520) { doc.neueSeite(); y = 50; }
    const alle = [...st.sel.ring, ...st.spur.map((q) => [q[0], q[1]])];
    const la0 = alle.reduce((a, q) => a + q[0], 0) / alle.length, lo0 = alle.reduce((a, q) => a + q[1], 0) / alle.length;
    const kx = 111320 * Math.cos((la0 * Math.PI) / 180), ky = 110540;
    const xy = ([la, lo]) => [(lo - lo0) * kx, (la - la0) * ky];
    const P = alle.map(xy), minX = Math.min(...P.map((q) => q[0])), maxX = Math.max(...P.map((q) => q[0])), minY = Math.min(...P.map((q) => q[1])), maxY = Math.max(...P.map((q) => q[1]));
    const BW = R - L0, BH = 250, sk = Math.min((BW - 30) / Math.max(1, maxX - minX), (BH - 30) / Math.max(1, maxY - minY));
    const ox = L0 + (BW - (maxX - minX) * sk) / 2, oy = y + (BH - (maxY - minY) * sk) / 2;
    const tr = (ll) => { const [a, c] = xy(ll); return [ox + (a - minX) * sk, oy + (maxY - c) * sk]; };
    doc.rechteck(L0, y, BW, BH, { fill: [248, 250, 246], stroke: [170, 180, 170] });
    doc.polygon([st.sel.ring.map(tr)], { fill: [236, 242, 232], stroke: [242, 107, 29], w: 1.5 });
    for (let i = 1; i < st.spur.length; i++) { const [x1, y1] = tr(st.spur[i - 1]), [x2, y2] = tr(st.spur[i]); doc.linie(x1, y1, x2, y2, { w: 0.8, farbe: [31, 116, 184] }); }
    st.plan.points.filter((p) => p.status !== 'leer').forEach((p) => { const [u, v] = tr(p.at); doc.rechteck(u - 2.5, v - 2.5, 5, 5, { fill: p.status === 'done' ? [46, 158, 79] : p.status === 'skipped' ? [138, 148, 140] : [215, 38, 61] }); doc.text(u + 4, v - 3, String(p.id), { size: 6 }); });
    y += BH + 10;
    doc.text(L0, y, 'Grün: erledigte Rasterpunkte · Grau: übersprungen · Rot: offen · Blau: GPS-Spur', { size: 7.5, farbe: [90, 100, 90] }); y += 16;
    // Kronenfoto (optional)
    if (f.fotoId) {
      const foto = await dateiLaden(f.fotoId).catch(() => null);
      const bild = foto ? await alsJpeg(foto).catch(() => null) : null;
      if (bild) { if (y > 560) { doc.neueSeite(); y = 50; } const b = 220, hh = (b * bild.h) / bild.w; doc.text(L0, y, 'Kronenfoto', { bold: true, size: 10 }); y += 8; doc.bild(L0, y, b, Math.min(hh, 300), bild); y += Math.min(hh, 300) + 10; }
    }
    // Bäume
    doc.neueSeite(); y = 50;
    doc.text(L0, y, 'Ausgezeichnete Bäume', { bold: true, size: 11 }); y += 16;
    z.baeume.forEach((b, i) => { if (y > 800) { doc.neueSeite(); y = 50; } doc.text(L0, y, `${i + 1}. Punkt ${b.punkt ?? '–'} · ${b.klasse === 'dick' ? `dick, BHD ${fmt(b.bhd, 0)} cm` : `${pl.stufen[b.stufe]?.name}${b.bhd ? `, gemessen ${fmt(b.bhd, 0)} cm` : ''} (${F4.KLASSE_NAME[b.klasse]})`} · ${fmt(b.v, 3)} m³ · ${new Date(b.t).toLocaleString('de-DE')}`, { size: 8.5 }); y += 11; });
    return doc.blob();
  }
  function alsJpeg(blob) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(blob);
      img.onload = () => { const s = Math.min(1, 900 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(async (b) => (b ? res({ jpeg: new Uint8Array(await b.arrayBuffer()), w: c.width, h: c.height }) : rej(new Error('Bild'))), 'image/jpeg', 0.8); };
      img.onerror = rej; img.src = url;
    });
  }

  go(st.step);
}

/** Kacheln des Bestands (Zoom 15–18) vorab laden; der Service Worker legt sie in den Cache. */
async function prefetchTiles(ring, basemapKey, btn) {
  const { s, w, n, e } = bbox(ring);

  const x = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
  const y = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
  const urls = [];
  for (let z = 15; z <= 19; z++) {
    for (let tx = x(w, z) - 1; tx <= x(e, z) + 1; tx++)
      for (let ty = y(n, z) - 1; ty <= y(s, z) + 1; ty++) urls.push(...tileUrls(basemapKey, z, tx, ty, { alkis: store.get().settings.layers.alkis !== false }));
  }
  const MAX = 600; // Fair-Use der Kachelserver respektieren
  const list = urls.slice(0, MAX);
  btn.disabled = true;
  let done = 0, failed = 0;
  const label = btn.lastChild;
  const worker = async () => {
    while (list.length) {
      const u = list.shift();
      // erst mit CORS (spart Speicher), sonst „no-cors“ (Dienste ohne CORS-Freigabe)
      try { const r = await fetch(u, { mode: 'cors' }); if (!r.ok) failed++; } catch {
        try { await fetch(u, { mode: 'no-cors' }); } catch { failed++; }
      }
      done++;
      label.textContent = `Speichere Karte … ${Math.round((done / Math.min(urls.length, MAX)) * 100)} %`;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  label.textContent = failed ? `Gespeichert, ${failed} Kacheln fehlen` : 'Karte offline gespeichert';
  if (!navigator.serviceWorker?.controller) toast('Hinweis: Offline-Speicher wirkt erst, wenn die App installiert bzw. neu geladen wurde.');
}
