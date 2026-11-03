// Durchforstungs-Workflow: Bestandsauswahl → Angaben → Raster → Navigation im Bestand.
/* global L */
import { h, fill, icon, dialog, confirmDialog, toast } from '../ui.js';
import { store, uid } from '../store.js';
import { source } from '../data/source.js';
import { createBaseMap, tileUrls, BASEMAP_LABELS } from '../map/basemap.js';
import { areaHa, formatHa, formatDist, distance, bearing, compassLabel, destination, bbox } from '../geo.js';
import { computePlanMethode, pointRemaining, pointTotal } from './plan.js';
import { BAUMARTEN, HOECHSTMENGE, DIMENSION, KRONENSCHLUSS, ZUWACHS_RICHTWERT, RASTER, rasterVorschlag, gruppeVon, fmt, wuechsigkeit } from './methode.js';
import { bestandInFlaeche, oberhoeheFlaeche } from '../map/bestand.js';
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
    st.sel = { ring: t.ring, label: t.label, parcelId: existing.parcelId };
    st.mode = t.mode || 'parcel';
    st.params = t.params || null;
    st.plan = t.plan || null;
    st.step = st.plan ? 3 : st.params ? 1 : 0;
  } else if (parcelId && byId[parcelId]) {
    const p = byId[parcelId];
    st.sel = { ring: p.ring, label: `Flurstück ${p.nr}, ${p.gemarkung}`, parcelId };
  }

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
      if (step !== 3 && st.sel?.ring?.length >= 3) map.fitBounds(L.polygon(st.sel.ring).getBounds(), { paddingTopLeft: [24, 76], paddingBottomRight: [24, 24], maxZoom: 18 });
    }, 60);
  }

  function drawSelection(fit = true) {
    selLayer.clearLayers();
    const ring = st.mode === 'draw' && st.step === 0 ? st.draft : st.sel?.ring;
    if (!ring?.length) return;
    if (ring.length >= 3) selLayer.addLayer(L.polygon(ring, { color: '#F26B1D', weight: 4, fillColor: '#F26B1D', fillOpacity: 0.12, interactive: false }));
    else selLayer.addLayer(L.polyline(ring, { color: '#F26B1D', weight: 4, interactive: false }));
    if (st.mode === 'draw' && st.step === 0) ring.forEach((ll) => selLayer.addLayer(L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: '#F26B1D', fillOpacity: 1, interactive: false })));
    if (fit && ring.length >= 3) map.fitBounds(L.polygon(ring).getBounds(), { padding: [30, 30], maxZoom: 18 });
  }

  // ---------- Schritt 1: Fläche ----------
  function renderSelect() {
    const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Art der Flächenauswahl' },
      [['parcel', 'Flurstück'], ['stand', 'Bestand'], ['draw', 'Einzeichnen']].map(([k, l]) => h('button', {
        role: 'tab', 'aria-selected': String(st.mode === k), onclick: () => { if (k === st.mode) return; st.mode = k; st.draft = []; if (k === 'draw') st.sel = null; renderSelect(); },
      }, l)));
    const content = h('div', { class: 'select-content' });
    const next = h('button', { class: 'btn btn-primary btn-block btn-large', disabled: !st.sel, onclick: () => go(1) }, 'Weiter zu den Angaben');

    ctxLayer.clearLayers();
    if (st.mode === 'parcel') {
      const list = myIds.map((id) => byId[id]);
      list.forEach((p) => ctxLayer.addLayer(L.polygon(p.ring, { color: '#23573A', weight: 2, fillOpacity: 0.15 }).on('click', (e) => { L.DomEvent.stop(e); pickParcel(p); })));
      content.append(list.length
        ? h('ul', { class: 'pick-list' }, list.map((p) => h('li', {}, h('button', {
            class: 'pick', 'aria-pressed': String(st.sel?.parcelId === p.id && !st.sel?.stand), onclick: () => pickParcel(p),
          }, h('strong', {}, `Flurstück ${p.nr}`), h('span', {}, `${p.gemarkung}, Flur ${p.flur}, ${formatHa(areaHa(p.ring))}`)))))
        : h('p', { class: 'muted' }, 'Du hast noch keine eigenen Flächen. Füge sie auf der Startseite hinzu oder zeichne den Bestand ein.'));
    } else if (st.mode === 'stand') {
      const stands = myStands.length ? myStands : [];
      stands.forEach((s) => ctxLayer.addLayer(L.polygon(s.ring, { color: '#2F7D3A', weight: 2, fillColor: '#2F7D3A', fillOpacity: 0.22 })
        .bindTooltip(`${s.name}: ${s.species}`, { direction: 'center', className: 'stand-tip' })
        .on('click', (e) => { L.DomEvent.stop(e); pickStand(s); })));
      content.append(stands.length
        ? h('ul', { class: 'pick-list' }, stands.map((s) => h('li', {}, h('button', {
            class: 'pick', 'aria-pressed': String(st.sel?.stand?.id === s.id), onclick: () => pickStand(s),
          }, h('strong', {}, `${s.name}: ${s.label}`), h('span', {}, `${s.species}${s.mix ? ` mit ${s.mix}` : ''}, ${s.age} Jahre, ${formatHa(areaHa(s.ring))}`)))))
        : h('p', { class: 'muted' }, 'Für deine Flächen ist keine Baumartenkarte hinterlegt. Wähle das ganze Flurstück oder zeichne den Bestand ein.'));
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
      st.sel ? h('p', { class: 'selected-label' }, h('span', { html: icon.check }), st.sel.label) : null, next);
    drawSelection(st.mode !== 'draw');
  }

  function updateDraft() {
    st.sel = st.draft.length >= 3 ? { ring: [...st.draft], label: `Eingezeichneter Bestand (${formatHa(areaHa(st.draft))})`, parcelId: null } : null;
    renderSelect();
  }

  function pickParcel(p) {
    st.sel = { ring: p.ring, label: `Flurstück ${p.nr}, ${p.gemarkung}`, parcelId: p.id };
    st.params = null;
    renderSelect();
  }

  function pickStand(s) {
    st.sel = { ring: s.ring, label: `${s.name}: ${s.label}`, parcelId: s.parcelId, stand: s };
    st.params = null;
    renderSelect();
  }

  function onMapClick(e) {
    const ll = [e.latlng.lat, e.latlng.lng];
    if (st.step === 0 && st.mode === 'draw') { st.draft.push(ll); updateDraft(); return; }
    if (st.step === 3 && gps?.simulated && !working) gps.setPosition(ll);
  }

  // ---------- Schritt 2: Angaben – eine Frage nach der anderen (neue Methode) ----------
  function defaultParams() {
    const s = st.sel?.stand;
    const art = s?.species || '';
    const dim = s ? (s.dg < 25 ? 'duenn' : s.dg < 50 ? 'mittel' : 'dick') : null;
    return { art, gruppe: art ? gruppeVon(art) : null, dim, b: null, wuchs: null, zuwachs: null, gIst: null, gSoll: null, spacing: null, q: 0 };
  }

  const QUESTIONS = ['art', 'dim', 'b', 'zuwachs', 'grundflaeche', 'raster', 'ergebnis'];

  function renderParams() {
    drawSelection();
    if (!st.params || st.params.main) st.params = defaultParams(); // alte Angaben (vorherige Version) verwerfen
    const f = st.params;
    // Baumart, Alter (Waldverzeichnis) und Oberhöhe (LiDAR) einmal je Fläche laden
    if (!st.auto || st.auto.ring !== st.sel.ring) {
      st.auto = { ring: st.sel.ring, loading: true };
      Promise.all([bestandInFlaeche(st.sel.ring).catch(() => null), oberhoeheFlaeche(st.sel.ring).catch(() => null)]).then(([bestand, oberhoehe]) => {
        st.auto = { ring: st.sel.ring, loading: false, bestand, oberhoehe };
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
        ? `Laut Waldverzeichnis von ThüringenForst: ${b.text}${b.alter != null ? `, heute etwa ${b.alter} Jahre` : ''}. Passt das nicht, wähle die Baumart, die die meisten Bäume stellt.`
        : st.auto?.loading ? 'Suche Baumart im Waldverzeichnis …' : 'Wähle die Baumart, die die meisten Bäume stellt. Daraus ergibt sich die Baumartengruppe und damit die Höchstmenge.';
      content = Object.entries(BAUMARTEN).map(([g, grp]) => h('div', { class: 'q-group' },
        h('p', { class: 'sheet-label' }, grp.label, ` – höchstens ${HOECHSTMENGE[g]} Fm/ha im Jahrzehnt`),
        h('div', { class: 'q-chips' }, grp.arten.map((a) => choice(f.art === a, () => { f.art = a; f.gruppe = g; renderParams(); }, a))),
      ));
      canNext = !!f.art;
    } else if (q === 'dim') {
      title = 'Wie dick sind die meisten Bäume?';
      help = 'Gemessen in 1,3 m Höhe (Brusthöhe). Ohne Kluppe: Umfang mit dem Maßband messen.';
      content = h('div', { class: 'q-cards' }, Object.entries(DIMENSION).map(([k, d]) => choice(f.dim === k, () => { f.dim = k; f.spacing = null; renderParams(); },
        [h('span', { class: `stem stem-${k}`, 'aria-hidden': 'true' }), h('span', { class: 'q-text' }, h('strong', {}, d.label[0].toUpperCase() + d.label.slice(1)), h('span', {}, `Durchmesser ${d.bhd}`), h('small', {}, d.umfang))])));
      canNext = !!f.dim;
    } else if (q === 'b') {
      title = 'Wie dicht stehen die Kronen?';
      help = 'Schau im Bestand nach oben: Wie viel Himmel siehst du zwischen den Kronen? Das entspricht dem Bestockungsgrad B°. Unter B° 0,8 sinkt die erlaubte Höchstmenge.';
      content = h('div', { class: 'q-cards two' }, KRONENSCHLUSS.map((k) => choice(f.b === k.b, () => { f.b = k.b; renderParams(); },
        [crownSvg(k.b), h('span', { class: 'q-text' }, h('strong', {}, `B° ${fmt(k.b, 1)} – ${k.label}`), h('small', {}, k.text))])));
      canNext = f.b != null;
    } else if (q === 'zuwachs') {
      const a = st.auto || {};
      const alter = f.alter ?? a.bestand?.alter ?? null;
      const oh = a.oberhoehe?.oberhoehe ?? null;
      const w = wuechsigkeit(f.art, alter, oh);
      const klasse = w?.klasse || 'mittel';
      f.wuchs = klasse; f.zuwachs = ZUWACHS_RICHTWERT[f.gruppe][klasse]; f.wuchsQuelle = w ? 'lidar' : 'annahme';
      title = 'Wie wüchsig ist der Bestand?';
      help = 'Das berechnet die App für dich: aus der Oberhöhe (Laserscanning-Höhenmodell des Landes) und dem Alter (Waldverzeichnis von ThüringenForst).';
      const loading = a.loading;
      content = [
        h('div', { class: 'auto-grid' },
          h('div', { class: 'auto-card' }, h('span', {}, 'Alter'),
            alter != null ? h('strong', {}, `${alter} Jahre`) : h('strong', {}, loading ? '…' : 'unbekannt'),
            a.bestand?.alter != null && f.alter == null ? h('small', {}, `Waldverzeichnis, Stand ${a.bestand.stichtag}: ${a.bestand.alterStichtag} J., hochgerechnet`) : h('small', {}, f.alter != null ? 'von dir geschätzt' : loading ? 'wird geladen' : 'nicht im Waldverzeichnis')),
          h('div', { class: 'auto-card' }, h('span', {}, 'Oberhöhe'),
            h('strong', {}, oh != null ? `${fmt(oh, 1)} m` : loading ? '…' : 'folgt'),
            h('small', {}, oh != null ? `aus ${a.oberhoehe.zellen} Höhenzellen (LiDAR)` : 'Höhenmodell für diese Fläche noch nicht aufbereitet')),
        ),
        alter == null && !loading ? h('label', { class: 'q-own' }, 'Für diese Fläche ist kein Alter hinterlegt. Wie alt ist der Bestand ungefähr? (Jahre)',
          h('input', { type: 'number', inputmode: 'numeric', min: 5, max: 250, value: f.alter ?? '', onchange: (e) => { const v = Number(e.target.value); f.alter = v > 0 ? v : null; renderParams(); } })) : null,
        alter != null && !loading ? h('label', { class: 'q-own' }, 'Alter weicht ab? Hier anpassen (Jahre)',
          h('input', { type: 'number', inputmode: 'numeric', min: 5, max: 250, value: alter, onchange: (e) => { const v = Number(e.target.value); f.alter = v > 0 ? v : null; renderParams(); } })) : null,
        h('div', { class: `wuchs-result wuchs-${klasse}` },
          h('span', {}, 'Wüchsigkeit'),
          h('strong', {}, `${klasse[0].toUpperCase()}${klasse.slice(1)}wüchsig`),
          h('small', {}, w ? `Oberhöhe ${fmt(oh, 1)} m statt ${fmt(w.ref, 1)} m bei mittlerem Wuchs im Alter ${alter} → ${fmt(w.verhaeltnis * 100)} %` : 'Vorläufig mittlerer Wuchs angenommen, bis die Oberhöhe aus dem Höhenmodell vorliegt.'),
          h('small', {}, `Zuwachs ca. ${f.zuwachs} Vfm/ha/Jahr (Richtwert)`),
        ),
        h('p', { class: 'hint' }, 'Höhenkurven und Zuwachswerte sind vorläufig und werden durch die Ertragstafeln (Nicke) der Methode ersetzt.'),
      ];
      canNext = !loading && f.zuwachs > 0;
    } else if (q === 'grundflaeche') {
      title = 'Hast du die Grundfläche gemessen?';
      help = 'Optional. Mit einer Winkelzählprobe vergleichst du deinen Bestand mit der Grundflächenleitkurve. Liegt er darüber, wird etwas mehr entnommen, liegt er darunter, etwas weniger.';
      content = h('div', { class: 'form' },
        h('div', { class: 'form-row' },
          h('label', {}, 'Gemessene Grundfläche (m²/ha)', h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 0.5, value: f.gIst ?? '', oninput: (e) => { f.gIst = Number(e.target.value) || null; } })),
          h('label', {}, 'Sollwert laut Leitkurve (m²/ha)', h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 0.5, value: f.gSoll ?? '', oninput: (e) => { f.gSoll = Number(e.target.value) || null; } })),
        ),
      );
      nextLabel = 'Weiter (oder ohne Messung)';
    } else if (q === 'raster') {
      f.spacing ??= rasterVorschlag(f.dim);
      title = 'Wie weit sollen die Rasterpunkte auseinander liegen?';
      help = 'An jedem Rasterpunkt entnimmst du die angezeigte Anzahl Bäume im Umkreis. Engere Raster bedeuten mehr Punkte mit weniger Bäumen.';
      content = h('div', { class: 'q-cards' }, RASTER.map((r) => choice(f.spacing === r.m, () => { f.spacing = r.m; renderParams(); },
        h('span', { class: 'q-text' }, h('strong', {}, `${r.m} × ${r.m} m${r.m === rasterVorschlag(f.dim) ? ' (empfohlen)' : ''}`), h('small', {}, r.text)))));
    } else {
      const plan = computePlanMethode(st.sel.ring, f);
      st.plan = plan;
      const perPoint = plan.total / plan.points.length;
      title = 'Dein Eingriff';
      help = `${BAUMARTEN[f.gruppe].label} (${f.art}), ${DIMENSION[f.dim].label}, B° ${fmt(f.b, 1)}, Raster ${f.spacing} m`;
      content = [
        h('div', { class: 'preview' },
          h('div', {}, h('span', { class: 'pv-n' }, fmt(plan.entnahmeFmHa)), h('span', {}, 'Fm/ha')),
          h('div', {}, h('span', { class: 'pv-n' }, plan.perHa), h('span', {}, 'Bäume/ha')),
          h('div', {}, h('span', { class: 'pv-n' }, plan.points.length), h('span', {}, 'Rasterpunkte')),
          h('div', {}, h('span', { class: 'pv-n' }, fmt(perPoint, 1)), h('span', {}, 'Bäume je Punkt')),
        ),
        h('p', {}, `Auf ${formatHa(plan.areaHa)} entnimmst du insgesamt etwa ${plan.total} Bäume (${fmt(plan.entnahmeFm)} Fm) mit einem Durchmesser von ${DIMENSION[f.dim].bhd}. Das entspricht der Nutzung für ein Jahrzehnt.`),
        h('details', { class: 'calc' }, h('summary', {}, 'So wurde gerechnet'), h('ol', {}, plan.schritte.map((t) => h('li', {}, t)))),
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
    st.plan ??= computePlanMethode(st.sel.ring, st.params);
    const plan = st.plan;
    drawGrid(plan.points, { numbers: true });
    const radius = Math.round(st.params.spacing / Math.sqrt(Math.PI));
    const offline = h('button', { class: 'btn', onclick: (e) => prefetchTiles(st.sel.ring, base.basemap, e.currentTarget) }, h('span', { html: icon.download }), 'Karte für offline speichern');

    fill(panel, 
      h('h2', { class: 'step-title' }, 'Dein Raster'),
      h('div', { class: 'preview' },
        h('div', {}, h('span', { class: 'pv-n' }, plan.points.length), h('span', {}, 'Rasterpunkte')),
        h('div', {}, h('span', { class: 'pv-n' }, plan.total), h('span', {}, 'Bäume gesamt')),
        h('div', {}, h('span', { class: 'pv-n' }, plan.perHa), h('span', {}, 'Bäume je ha')),
        h('div', {}, h('span', { class: 'pv-n' }, `${radius} m`), h('span', {}, 'Arbeitsradius je Punkt')),
      ),
      h('p', {}, `Jeder rote Punkt steht für eine Rasterzelle von ${st.params.spacing} × ${st.params.spacing} m. Die gestrichelte Linie zeigt die Laufreihenfolge.`),
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
      m.thinning = { ...(m.thinning || {}), mode: st.mode, ring: st.sel.ring, label: st.sel.label, params: st.params, plan: st.plan };
      Object.assign(m, patch);
    });
  }

  async function startThinning() {
    unlockAudio(); // Nutzergeste → Audio für iOS-Fallback freischalten
    await requestCompass();
    saveMeasure({ status: 'arbeit' });
    go(3);
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
    navLayer.addLayer(L.circle(pt.at, { radius: st.params.spacing / Math.sqrt(Math.PI), color: '#D7263D', weight: 1.5, dashArray: '4 4', fillOpacity: 0.05, interactive: false }));
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
    const r = store.get().settings.arrivalRadius;
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
    const radius = Math.round(st.params.spacing / Math.sqrt(Math.PI));
    const remaining = pointRemaining(pt);
    const persist = () => saveMeasure();

    fill(hud, 
      h('div', { class: 'work-head' },
        h('p', { class: 'hud-label' }, `Rasterpunkt ${pt.id}: Entnahme`),
        h('p', { class: 'muted' }, `Arbeite im Umkreis von etwa ${radius} m um den Punkt.`),
      ),
      pt.removals.length
        ? h('ul', { class: 'removals' }, pt.removals.map((r) => h('li', { class: `removal ${r.marked >= r.count ? 'complete' : ''}` },
            h('div', { class: 'removal-text' },
              h('strong', {}, r.species),
              h('span', {}, `Ziel-BHD ${r.dmin} bis ${r.dmax} cm`),
            ),
            h('div', { class: 'counter' },
              h('button', { class: 'count-btn', 'aria-label': `Einen ${r.species} weniger`, disabled: r.marked <= 0, onclick: () => { r.marked--; persist(); renderWork(); } }, '−'),
              h('span', { class: 'count', 'aria-live': 'polite' }, h('b', {}, r.marked), ` / ${r.count}`),
              h('button', { class: 'count-btn plus', 'aria-label': `${r.species} entnommen`, disabled: r.marked >= r.count, onclick: () => { r.marked++; buzz('tick'); persist(); renderWork(); } }, '+'),
            ),
          )))
        : h('p', {}, 'An diesem Punkt ist keine Entnahme vorgesehen. Prüfe den Bestand und schließe den Punkt ab.'),
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
      h('button', { class: 'btn btn-primary btn-block', onclick: close }, 'Zur Maßnahmenübersicht'),
    );
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
