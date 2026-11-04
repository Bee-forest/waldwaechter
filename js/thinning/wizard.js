// Durchforstungs-Workflow: Bestandsauswahl → Angaben → Raster → Navigation im Bestand.
/* global L */
import { h, fill, icon, dialog, confirmDialog, toast } from '../ui.js';
import { store, uid } from '../store.js';
import { source } from '../data/source.js';
import { createBaseMap, tileUrls, BASEMAP_LABELS } from '../map/basemap.js';
import { areaHa, formatHa, formatDist, distance, bearing, compassLabel, destination, bbox, polysOf, areaM2Polys, generateGrid, inPolys } from '../geo.js';
import { parcelExact, amtlicheFlaecheHa } from '../map/thueringen.js';
import { computePlanMethode, pointRemaining, pointTotal, zufallsLage } from './plan.js';
import { GRUPPEN, DIMENSION, KRONENSCHLUSS, SZENARIO, HOEHENKLASSEN, RASTER_M, KREIS_M, AUSWEICHEN_M, hoeheKlasse, bLabel, AUSWEICH_TEXT, MAX_FM_EINGRIFF, EIN_EINGRIFF_BIS, anteilSatz, anteilText, oberhoeheAusAlter, gruppeVon, fmt } from './methode.js';
import { bestandInFlaeche, oberhoeheFlaeche } from '../map/bestand.js';
import { lrtInFlaeche } from '../map/besonderheiten.js';
import { natura2000InFlaeche, inBrutzeit, nachBrutzeit, BRUTZEIT } from '../schutzgebiete.js';
import { openVertraeglichkeit, protokoll } from '../vertraeglichkeit.js';
import { createPositionSource } from './gps.js';
import { buzz, unlockAudio, keepAwake } from './feedback.js';
import { say, WANZE_SVG } from '../mascot.js';

const STEPS = ['Fläche', 'Angaben', 'Raster', 'Im Bestand'];
const COLORS = { open: '#D7263D', done: '#2E9E4F', skipped: '#8A948C', target: '#D7263D' };

export async function openThinningWizard({ parcelId, measureId } = {}) {
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
      pc.lage ? h('div', {}, h('dt', {}, 'Lage'), h('dd', {}, pc.lage)) : null,
      teile || loecher ? h('div', {}, h('dt', {}, 'Form'), h('dd', {}, [teile, loecher ? `${loecher} ausgesparte Fläche${loecher > 1 ? 'n' : ''}` : null].filter(Boolean).join(', '))) : null,
    );
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
    ctxLayer.clearLayers(); gridLayer.clearLayers(); navLayer.clearLayers();
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
    return { v: 3, art, gruppe: art ? gruppeVon(art) : null, dim, b: null, hoKlasse: null, alter: null, spacing: null, q: 0 };
  }

  const QUESTIONS = ['art', 'dim', 'b', 'hoehe', 'ergebnis'];

  function renderParams() {
    drawSelection();
    if (!st.params || st.params.main || st.params.v !== 3) st.params = defaultParams(); // alte Angaben (vorherige Version) verwerfen
    const f = st.params;
    // Baumart, Alter (Waldverzeichnis) und Oberhöhe (LiDAR) einmal je Fläche laden
    if (!st.auto || st.auto.ring !== st.sel.ring) {
      st.auto = { ring: st.sel.ring, loading: true };
      Promise.all([bestandInFlaeche(st.sel.ring, selPolys()).catch(() => null), oberhoeheFlaeche(st.sel.ring, selPolys()).catch(() => null), lrtInFlaeche(st.sel).catch(() => []), natura2000InFlaeche(st.sel).catch(() => [])]).then(([bestand, oberhoehe, lrt, natura]) => {
        st.auto = { ring: st.sel.ring, loading: false, bestand, oberhoehe, lrt, natura };
        if (bestand?.art && !f.art) { f.art = bestand.art; f.gruppe = gruppeVon(bestand.art); f.artQuelle = 'waldverzeichnis'; }
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

    if (q === 'art') {
      title = 'Welche Baumart prägt den Bestand?';
      const b = st.auto?.bestand;
      help = b?.art
        ? `Laut Waldverzeichnis von ThüringenForst: ${b.text}${b.alter != null ? `, heute etwa ${b.alter} Jahre` : ''}. Passt das nicht, wähle die Hauptbaumart.`
        : st.auto?.loading ? 'Suche Baumart im Waldverzeichnis …' : 'Wähle die Hauptbaumart. Daraus ergibt sich die Baumartengruppe der Methode.';
      content = Object.entries(GRUPPEN).map(([g, grp]) => h('div', { class: 'q-group' },
        h('p', { class: 'sheet-label' }, grp.label),
        h('div', { class: 'q-chips' }, grp.arten.map((a) => choice(f.art === a, () => { f.art = a; f.gruppe = gruppeVon(a); renderParams(); }, a))),
      ));
      canNext = !!f.art;
    } else if (q === 'dim') {
      title = 'Welche Stärkeklasse stellt die meisten Bäume?';
      help = 'Zähle grob die Stämme: Die Klasse mit mindestens 40 % der Bäume und 10 Prozentpunkten Vorsprung bestimmt das Szenario. Durchmesser in 1,3 m Höhe; ohne Kluppe den Umfang messen.';
      content = h('div', { class: 'q-cards' }, Object.entries(DIMENSION).map(([k, d]) => choice(f.dim === k, () => { f.dim = k; renderParams(); },
        [h('span', { class: `stem stem-${k}`, 'aria-hidden': 'true' }), h('span', { class: 'q-text' }, h('strong', {}, `${d.viele} – Szenario ${SZENARIO[k]}`), h('span', {}, `Durchmesser ${d.bhd}`), h('small', {}, d.umfang))])));
      canNext = !!f.dim;
    } else if (q === 'b') {
      title = 'Wie dicht stehen die Kronen?';
      help = 'Schau im Bestand nach oben: Wie viel Himmel siehst du zwischen den Kronen? Das entspricht dem Bestockungsgrad B° (in Stufen von 0,1).';
      content = h('div', { class: 'q-cards two' }, KRONENSCHLUSS.map((k) => choice(f.b === k.b, () => { f.b = k.b; renderParams(); },
        [crownSvg(Math.min(k.b, 1.15)), h('span', { class: 'q-text' }, h('strong', {}, `B° ${bLabel(k.b)} – ${k.label}`), h('small', {}, k.text))])));
      canNext = f.b != null;
    } else if (q === 'hoehe') {
      const a = st.auto || {};
      const loading = a.loading;
      const alter = f.alter ?? a.bestand?.alter ?? null;
      const lidar = a.oberhoehe?.oberhoehe ?? null;
      const geschaetzt = lidar == null && alter ? oberhoeheAusAlter(f.art, alter) : null;
      const ho = lidar ?? geschaetzt;
      if (!f.hoKlasseManuell) f.hoKlasse = ho != null ? hoeheKlasse(ho) : null;
      f.ho = ho != null && f.hoKlasse === hoeheKlasse(ho) ? ho : null; // sonst Klassenmitte
      title = 'Wie hoch ist der Bestand?';
      help = 'Gemeint ist die Oberhöhe, die Höhe der höchsten Bäume. Die App ermittelt sie für dich.';
      content = [
        h('div', { class: 'auto-grid' },
          h('div', { class: 'auto-card' }, h('span', {}, 'Oberhöhe'),
            h('strong', {}, loading ? '…' : ho != null ? `${lidar != null ? '' : 'ca. '}${fmt(ho, 0)} m` : 'unbekannt'),
            h('small', {}, lidar != null ? `gemessen: Laserscanning (${a.oberhoehe.zellen} Höhenzellen)` : geschaetzt != null ? `geschätzt aus dem Alter (${alter} J.) mit der Ertragstafel, mittlere Bonität` : loading ? 'wird ermittelt' : 'kein Höhenmodell und kein Alter')),
          h('div', { class: 'auto-card' }, h('span', {}, 'Alter'),
            h('strong', {}, alter != null ? `${alter} Jahre` : loading ? '…' : 'unbekannt'),
            h('small', {}, f.alter != null ? 'von dir angegeben' : a.bestand?.alter != null ? `Waldverzeichnis, Stand ${a.bestand.stichtag}, hochgerechnet` : 'nicht im Waldverzeichnis')),
        ),
        lidar == null && !loading ? h('label', { class: 'q-own' }, alter == null ? 'Kein Alter hinterlegt. Wie alt ist der Bestand ungefähr? (Jahre)' : 'Alter weicht ab? Hier anpassen (Jahre)',
          h('input', { type: 'number', inputmode: 'numeric', min: 5, max: 250, value: alter ?? '', onchange: (e) => { const v = Number(e.target.value); f.alter = v > 0 ? v : null; f.hoKlasseManuell = false; renderParams(); } })) : null,
        loading ? null : h('p', { class: 'sheet-label' }, ho != null ? 'Höhenklasse (bei Bedarf korrigieren)' : 'Höhenklasse wählen'),
        loading ? null : h('div', { class: 'q-cards' }, HOEHENKLASSEN.map((k) => choice(f.hoKlasse === k.key, () => { f.hoKlasse = k.key; f.hoKlasseManuell = true; renderParams(); },
          h('span', { class: 'q-text' }, h('strong', {}, `${k.label}${ho != null && hoeheKlasse(ho) === k.key ? ' (ermittelt)' : ''}`), h('small', {}, k.text))))),
      ];
      canNext = !loading && !!f.hoKlasse;
    } else {
      const plan = computePlanMethode(st.sel, f);
      st.plan = plan;
      const ei = plan.eingriffe;
      title = ei.anzahl > 1 ? `Dein Eingriff ${ei.nr} von ${ei.anzahl}` : 'Dein Eingriff';
      help = `${plan.gruppeLabel} · Szenario ${plan.szenario} · B° ${bLabel(f.b)} · Oberhöhe ${HOEHENKLASSEN.find((x) => x.key === f.hoKlasse).label}`;
      const zeilen = ['dick', 'mittel', 'duenn'].filter((k) => plan.jePunkt[k] > 0);
      content = [
        h('div', { class: 'preview' },
          h('div', {}, h('span', { class: 'pv-n' }, `ca. ${fmt(ei.vEingriff)}`), h('span', {}, 'Fm/ha bei diesem Eingriff')),
          h('div', {}, h('span', { class: 'pv-n' }, ei.anzahl), h('span', {}, ei.anzahl === 1 ? 'Eingriff im Jahrzehnt' : 'Eingriffe im Jahrzehnt')),
          h('div', {}, h('span', { class: 'pv-n' }, plan.points.length), h('span', {}, 'Rasterpunkte')),
          h('div', {}, h('span', { class: 'pv-n' }, plan.total), h('span', {}, 'Bäume bei diesem Eingriff')),
        ),
        h('div', { class: 'calc-box eingriffe-box' },
          h('strong', {}, ei.anzahl === 1 ? `Ein Eingriff im Jahrzehnt (ca. ${fmt(ei.vZehn)} Fm/ha)` : `${ei.anzahl} Eingriffe im Jahrzehnt, etwa alle ${ei.abstandJahre} Jahre`),
          h('small', {}, ei.anzahl === 1
            ? `Im Jahrzehnt werden ca. ${fmt(ei.vZehn)} Fm/ha entnommen (Simulation der Methode) – unter ${EIN_EINGRIFF_BIS} Fm/ha geht das in einem Eingriff. Beim Start trägt die App die nächste Durchforstung in ca. ${ei.abstandJahre} Jahren in den Maßnahmenkalender ein.`
            : `Im Jahrzehnt werden ca. ${fmt(ei.vZehn)} Fm/ha entnommen (Simulation der Methode). Ab ${EIN_EINGRIFF_BIS} Fm/ha wird die Menge auf mehrere Eingriffe verteilt (höchstens ${MAX_FM_EINGRIFF} Fm/ha je Eingriff): ${ei.anzahl} Eingriffe à ca. ${fmt(ei.vEingriff)} Fm/ha. Beim Start trägt die App den nächsten Eingriff in ca. ${ei.abstandJahre} Jahren in den Maßnahmenkalender ein.`),
          h('small', {}, 'Das Raster wird bei jedem Eingriff zufällig neu über den Bestand gelegt, damit nicht immer dieselben Stellen bearbeitet werden.')),
        h('div', { class: 'raster-rule' },
          h('strong', {}, `Je Rasterpunkt: ${plan.regel}`),
          zeilen.map((k) => h('small', {}, `${DIMENSION[k].label[0].toUpperCase()}${DIMENSION[k].label.slice(1)} (${DIMENSION[k].bhd}): ${anteilSatz(plan.jePunkt[k])}`)),
          h('small', {}, `Raster ${fmt(plan.raster || RASTER_M, 1)} m in Schlangenlinien, Lage zufällig, Entnahmekreis ca. ${plan.kreis || KREIS_M} m.${plan.eng ? ' Weil je 25-m-Punkt viele Bäume anfielen, ist das Raster auf 12,5 m verdichtet – so entstehen keine Lücken.' : ''} „An jedem n-ten Punkt“ zählt die App für dich mit.`)),
        parcelCard(),
        h('p', {}, `Auf ${formatHa(plan.areaHa)}${plan.areaAmtlich ? ' (amtliche Fläche)' : ''} liegen ${plan.points.length} Rasterpunkte. Du entnimmst bei diesem Eingriff ${plan.total} Bäume (ca. ${fmt(ei.vEingriff * plan.areaHa)} Fm bzw. ${fmt(ei.gEingriff * plan.areaHa, 1)} m² Grundfläche auf der ganzen Fläche).`),
        h('div', { class: 'calc-box' },
          h('strong', {}, 'So kommt die Baumzahl zustande'),
          zeilen.map((k) => { const n = plan.points.reduce((a, pt) => a + (pt.removals.find((x) => x.klasse === k)?.count || 0), 0);
            return h('small', {}, `${DIMENSION[k].baeume}: ${plan.points.length} Punkte × ${anteilText(plan.jePunkt[k])} je Punkt = ${n}`); }),
          h('small', {}, `Bei ${fmt(plan.raster || 25, 1)} m Raster sind das ${Math.round(10000 / ((plan.raster || 25) ** 2))} Punkte je Hektar, also ${fmt(plan.points.length / plan.areaHa, 1)} Punkte je ha auf dieser Fläche. Die Gesamtzahl ergibt sich aus den Punkten, die tatsächlich auf der Fläche liegen – nicht aus einem Hektarwert.`)),
        h('details', { class: 'calc' }, h('summary', {}, 'Was bedeutet die Ziel-Entnahme Grundfläche?'),
          h('p', {}, `Grundfläche ist die Summe der Stammquerschnitte in 1,3 m Höhe. Ein Baum mit 30 cm Durchmesser hat etwa 0,07 m², einer mit 50 cm etwa 0,20 m². ${fmt(plan.stufe, 1)} m²/ha entsprechen also zum Beispiel rund ${Math.round(plan.stufe / 0.0707)} Bäumen mit 30 cm je Hektar.`),
          h('p', {}, 'Der Wert ist die Eingriffsstufe aus Tabelle 1 der Methode: so viel Grundfläche soll im nächsten Jahrzehnt entnommen werden. Er ist nicht die Grundfläche deines Bestands.'),
          h('p', {}, 'Im Wald zählt die Baumzahl je Rasterpunkt. Wie viel Grundfläche dabei tatsächlich herauskommt, hängt von den Bäumen vor Ort ab und liegt meist etwas unter dem Zielwert.')),
        st.auto?.natura?.length ? h('div', { class: 'lrt-hinweis brutzeit' },
          h('strong', {}, `Natura 2000: ${st.auto.natura.map((g) => `${g.art} „${g.name || 'ohne Namen'}“`).join(', ')}`),
          h('ul', {}, h('li', {}, `Brut- und Setzzeit (${BRUTZEIT.text}) beachten: Lege den Einschlag am besten davor oder danach.`),
            h('li', {}, 'Lässt er sich nicht verschieben, ist eine Verträglichkeits-Vorprüfung nötig – die App führt dich beim Start durch das Formular.'))) : null,
        (st.auto?.lrt || []).map((l) => h('div', { class: 'lrt-hinweis' },
          h('strong', {}, `Lebensraumtyp auf der Fläche: ${l.titel}`),
          h('ul', {}, l.punkte.map((t) => h('li', {}, t))))),
        h('p', { class: 'hint' }, plan.auswahl),
        h('details', { class: 'calc' }, h('summary', {}, 'So wurde bestimmt'), h('ol', {}, plan.schritte.map((t) => h('li', {}, t)))),
      ];
      nextLabel = 'Raster auf die Karte legen';
    }

    const nextBtn = h('button', { class: 'btn btn-primary btn-large', disabled: !canNext, onclick: () => (q === 'ergebnis' ? go(2) : next()) }, nextLabel);
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
    gridLayer.addLayer(L.polyline(points.map((p) => p.at), { color: '#D7263D', weight: 1.5, opacity: 0.45, dashArray: '3 6', interactive: false }));
    points.forEach((p, i) => {
      const m = L.circleMarker(p.at, { radius: pointRadius(), color: '#fff', weight: 2, fillColor: COLORS[p.status], fillOpacity: 1 });
      if (numbers) m.bindTooltip(String(p.id), { permanent: points.length <= 150, direction: 'center', className: 'pt-tip', interactive: false });
      m.on('click', (e) => { L.DomEvent.stop(e); if (st.step === 3) chooseTarget(i); });
      gridLayer.addLayer(m);
      pointMarkers.push(m);
    });
    map.getPane('tooltipPane')?.classList.toggle('hide-numbers', pointRadius() < 9);
  }

  function renderGrid() {
    drawSelection();
    st.plan ??= computePlanMethode(st.sel, st.params);
    const plan = st.plan;
    drawGrid(plan.points, { numbers: true });
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

  function saveMeasure(patch = {}) {
    store.update((s) => {
      let m = s.measures.find((x) => x.id === st.measureId);
      if (!m) {
        st.measureId = uid();
        m = { id: st.measureId, type: 'durchforstung', parcelId: st.sel.parcelId, date: Date.now(), note: '', details: {}, status: 'arbeit', createdAt: Date.now() };
        s.measures.push(m);
      }
      m.thinning = { ...(m.thinning || {}), ...(st.auto?.natura ? { natura2000: st.auto.natura, lrt: st.auto.lrt } : {}), mode: st.mode, ring: st.sel.ring, polys: st.sel.polys, clip: st.sel.clip, flaecheHa: st.sel.flaecheHa, parcel: st.sel.parcel, label: st.sel.label, params: st.params, plan: st.plan };
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
    saveMeasure({ status: 'arbeit' });
    protokoll(st.measureId, warSchon ? 'Arbeit im Bestand fortgesetzt' : 'Durchforstung im Bestand begonnen');
    legeFolgeAn();
    go(3);
  }

  // Natura 2000 + Brut- und Setzzeit: verschieben oder Verträglichkeits-Vorprüfung
  async function pruefeBrutzeit() {
    const natura = st.auto?.natura || measure()?.thinning?.natura2000 || [];
    if (!natura.length || !inBrutzeit(Date.now())) return true;
    if (measure()?.anhaenge?.some((a) => a.typ === 'vertraeglichkeit')) return true;
    const v = await dialog({
      title: 'Brut- und Setzzeit im Natura 2000-Gebiet',
      body: h('div', {},
        h('p', {}, `Die Fläche liegt im ${natura.map((g) => `${g.art} „${g.name || 'ohne Namen'}“`).join(', ')}. Jetzt ist Brut- und Setzzeit (${BRUTZEIT.text}).`),
        h('p', {}, 'Lege den Einschlag am besten außerhalb dieser Zeit. Ist das nicht zu umgehen, fülle eine Verträglichkeits-Vorprüfung aus – sie wird an die Maßnahme angehängt.')),
      actions: [{ label: 'Abbrechen', value: null }, { label: 'Auf 1. Juli verschieben', value: 'verschieben' }, { label: 'Nicht vermeidbar – Vorprüfung ausfüllen', value: 'pruefung', primary: true }],
    });
    if (v === 'verschieben') {
      const d = nachBrutzeit();
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
    let when = new Date(); when.setFullYear(when.getFullYear() + abstand); when.setHours(9, 0, 0, 0);
    // im Natura 2000-Gebiet nicht in die Brut- und Setzzeit legen
    if ((cur.thinning?.natura2000 || st.auto?.natura || []).length && inBrutzeit(when.getTime())) when = new Date(nachBrutzeit(when.getTime()));
    const serie = cur.thinning?.serie || cur.id;
    const base = { natura2000: cur.thinning?.natura2000, lrt: cur.thinning?.lrt, mode: st.mode, ring: st.sel.ring, polys: st.sel.polys, clip: st.sel.clip, flaecheHa: st.sel.flaecheHa, parcel: st.sel.parcel, label: st.sel.label, vorgaenger: cur.id, serie };
    let thinning, note;
    if (ei.nr < ei.anzahl) {
      const params = { ...st.params, eingriffNr: ei.nr + 1, lage: zufallsLage(), q: 0 };
      thinning = { ...base, params, plan: computePlanMethode(st.sel, params) };
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

  function renderNav() {
    drawSelection(false);
    drawGrid(st.plan.points, { numbers: true });
    fill(panel, hud);
    const m = measure();
    if (m?.status === 'fertig') { renderFinished(); return; }
    targetIdx = nextOpenIndex(0);
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
    pointMarkers.forEach((mk, i) => { mk.setStyle({ fillColor: COLORS[st.plan.points[i].status] }); mk.setRadius(pointRadius(i === targetIdx)); });
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
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return;
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
      h('div', { class: 'hud-meta' },
        h('span', { class: `gps-chip ${acc == null ? '' : acc <= 10 ? 'good' : acc <= 25 ? 'ok' : 'bad'}` }, sim ? 'GPS simuliert' : acc != null ? `GPS ±${Math.round(acc)} m` : 'GPS: kein Signal'),
        h('span', {}, `${done} erledigt, ${pts.length - done} offen`),
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
      body: `Hier sind ${pointTotal(pt)} ${pointTotal(pt) === 1 ? 'Baum' : 'Bäume'} zu entnehmen.`,
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
    pt.status = 'skipped';
    saveMeasure();
    const nxt = nextOpenIndex(targetIdx + 1);
    if (nxt < 0) { finish(); return; }
    targetIdx = nxt;
    highlightTarget();
    renderHud();
    toast(`Punkt ${pt.id} übersprungen. Tippe ihn in der Karte an, um später zurückzukehren.`);
  }

  function finish() {
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
          h('button', { class: 'btn btn-primary', onclick: () => { saveMeasure({ status: 'fertig', finishedAt: Date.now() }); renderFinished(); } }, 'Maßnahme abschließen'),
        ),
      );
      return;
    }
    buzz('done');
    say('Geschafft! Alle Rasterpunkte sind erledigt. Die Maßnahme ist abgeschlossen.', { duration: 5000 });
    renderFinished();
  }

  function renderFinished() {
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
