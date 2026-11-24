// Reiter 1: Startseite mit Karte, Flurstücksauswahl und Infobox.
/* global L */
import { h, fill, icon, dialog, openPage, confirmDialog, toast, alleSeitenSchliessen } from './ui.js';
import { createFotopunktLayer, FOTOPUNKT_FARBE } from './map/fotopunkte.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { createBaseMap, createOsmFeatureLayer, CATEGORIES, BASEMAP_LABELS } from './map/basemap.js';
import { areaHa, formatHa, formatDist, centroid, compassLabel, polysOf } from './geo.js';
import { WANZE_SVG, say } from './mascot.js';
import { grenzpunkteFinden, wfsDiagnose, ALKIS_MIN_ZOOM, featureInfoUrl, OVERLAYS, overlayLayer, INFO_SOURCES, nearestRescue, LAYER_INFO, legendUrls, amtlicheFlaecheHa, localIndexInfo } from './map/thueringen.js';
import { openProfile } from './profile.js';
import { besonderheiten } from './map/besonderheiten.js';
import { lrtCode, lrtHinweis, lrtWichtig, biotopWichtig } from './map/lrt.js';
import { zeigeVerordnung } from './schutzgebiete.js';
import { BAUMARTEN_FARBEN } from './map/baumartenkarte.js';
import { erinnereVerkehrssicherung, hatVerkehrssicherung, MEASURE_TYPES } from './measures.js';
import { bestandAt, bestandInFlaeche, oberhoeheFlaeche, KORREKTUR_ARTEN, SCHICHTEN, korrAlter, pflanzungAm } from './map/bestand.js';
import { bestandsprofil, phaseVon, durchforstungStatus, PHASEN as ENTW_PHASEN } from './empfehlung.js';
import { empfehlung, empfehlungMitErsatz, bztName, GRUPPEN, BAUMARTEN_KURZ, eichenHinweis } from './bzt.js';
import { wanderwege } from './map/wanderwege.js';
import { createFlurnummernLayer } from './map/flurnummern.js';
import { createErschliessungLayers, openErschliessungEditor } from './map/erschliessung.js';
import { createHangneigungLayer, analysiereFlaeche, befahrbarkeit, KLASSEN as NEIGUNG, grad as neigGrad } from './map/hangneigung.js';
import { createPunktLayers, openPunktEditor, HABITAT_FARBE, JAGD_FARBE } from './map/punkte.js';
import { ordnerEigentuemerAnwenden, ordnerLeiste, passtFlurstueck, ordnerAuswahl, ordnerFuerNeu, ordnerListe, ladeRevierleiter, revierleiterVon, istProfi, eigentuemerInhalt, eigentuemerVon, etName, revierKontakt, revierKontaktBearbeiten, kontaktLinks, eigentuemerAbo, ordnerName } from './profi.js';
import { queryPoint, naechsterStandort, explainStandort, NAEHRKRAFT, WASSER_SKALA, umlaut } from './map/geoinfo.js';

export const FEATURE_TYPES = {
  nsg: 'Naturschutz',
  biotop: 'Geschütztes Biotop',
  waldfunktion: 'Waldfunktion',
  vsp: 'Verkehrssicherungspflicht',
  punktbiotop: 'Punktbiotop',
  lrt: 'FFH-Wald-Lebensraumtyp',
};

let base, map, osmLayer;
const catGroups = {};
let allParcelsLayer, infoLayer, rescueLayer, selectionLayer, posMarker;
const overlays = {};
let selected = null; // { parcel, latlng }
let zoomHintGezeigt = false; // Zoom-Hinweis in dieser Suche schon gezeigt?
let rescueMarkers = null;
/** Entfernt alles, was zur vorherigen Auswahl gehört (Umriss, „i“, Rettungspunkt-Linie) */
function clearMarks() { selectionLayer?.clearLayers(); rescueMarkers?.remove(); rescueMarkers = null; }
let ALL = [];
const FEAT = new Map(); // Besonderheiten je Flurstück (Sitzung)
const featuresOf = (p) => FEAT.get(p.id) || p.features || [];

const mine = (id) => store.get().parcels.find((p) => p.id === id);
export const parcelTitle = (p) => `${p.gemarkung}, Flur ${p.flur}, Flurstück ${p.nr}`;

/** Inhalt des WaldWächter-Kopfs (Logo, Titel, Profil) – auch auf der Maßnahmen-Seite */
const AUFGABEN_AN = false;

export function kopfInhalt() {
  const pr = store.get().profile;
  const initials = (pr.name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  return [
    // Logo = Eingang zur Wanzen-Ecke (ein Symbol statt zwei Wanzen)
    h('button', { class: 'logo-knopf', 'aria-label': 'Wanzen-Ecke öffnen: Aufgabe der Woche, Quiz, Saisonkalender', title: 'Wanzen-Ecke', onclick: () => import('./wanzenecke.js').then((x) => x.openWanzenEcke()) },
      h('img', { class: 'app-logo', src: 'img/logo.svg', alt: 'WaldWächter' })),
    h('div', { class: 'app-title' },
      h('h1', {}, 'WaldWächter'),
      h('p', {}, 'Digitale Wald- und Flächenbewirtschaftung für morgen.'),
    ),
    h('button', { class: 'profile-chip', 'aria-label': 'Mein Profil öffnen', onclick: () => openProfile() },
      h('span', { class: 'avatar' }, initials),
      h('span', { class: 'who' },
        h('strong', {}, pr.name || 'Profil anlegen'),
        h('span', {}, pr.fbg || 'Flächen, Konto, Einstellungen'),
      ),
      h('span', { class: 'chev', html: icon.chevron }),
    ),
    ordnerLeiste(),
  ];
}

export async function initHome(root) {
  const s = store.get().settings;
  const mapEl = h('div', { id: 'map', class: 'map', 'aria-label': 'Karte' });
  const info = h('section', { id: 'infobox', class: 'infobox', 'aria-live': 'polite', hidden: true });

  const head = h('header', { class: 'card app-head' });
  const chips = h('div', { class: 'cat-chips', role: 'group', 'aria-label': 'Kategorien ein- und ausblenden' });
  const baseSwitch = h('div', { class: 'segmented compact', role: 'radiogroup', 'aria-label': 'Basiskarte' });
  const streifen = h('div', { class: 'aufgaben-host' });
  // „Das steht an“ vorerst ausgeblendet – zum Einschalten AUFGABEN_AN auf true setzen
  if (AUFGABEN_AN) import('./aufgaben.js').then((x) => streifen.append(x.aufgabenStreifen()));
  root.append(
    head,
    streifen,
    h('section', { class: 'card map-card', 'aria-label': 'Karte Thüringen' },
      h('div', { class: 'map-card-head' },
        h('h2', {}, 'Karte Thüringen'),
        baseSwitch,
      ),
      h('div', { class: 'map-wrap' },
        mapEl,
        h('div', { class: 'map-side' },
          h('button', { class: 'fab small', 'aria-label': 'Flurstück suchen', html: icon.search, onclick: openSearch }),
          h('button', { class: `fab small ortung-btn ortung-${ortung}`, 'aria-label': ORTUNG_LABEL[ortung], title: ORTUNG_LABEL[ortung], 'aria-pressed': String(ortung !== 'aus'), html: icon.locate, onclick: ortungKlick }),
        ),
      ),
      h('div', { class: 'map-actions' },
        h('button', { class: 'pill-btn', onclick: openLayerSheet }, h('span', { html: icon.layers }), 'Ebenen'),
        h('button', { class: 'pill-btn', onclick: openSearch }, h('span', { html: icon.search }), 'Flurstück suchen'),
      ),
      chips,
    ),
    info,
  );

  // Kopf: Logo, Titel, Profil
  const renderHead = () => fill(head, ...kopfInhalt());
  // Kategorie-Chips wie im Entwurf: gefüllt = sichtbar
  const renderChips = () => {
    const { layers } = store.get().settings;
    fill(chips, ...Object.entries(CATEGORIES).map(([k, c]) => h('button', {
      class: 'cat-chip', style: `--c:${c.color}`, 'aria-pressed': String(!!layers[k]),
      onclick: () => { store.update((st) => { st.settings.layers[k] = !st.settings.layers[k]; }); osmLayer.refresh(); },
    }, h('span', { class: 'dot' }), c.label)));
  };
  const renderBaseSwitch = () => fill(baseSwitch, ...Object.entries(BASEMAP_LABELS).map(([k, l]) => h('button', {
    role: 'radio', 'aria-checked': String(base?.basemap === k),
    onclick: () => { base.setBasemap(k); store.update((st) => { st.settings.basemap = k; }); },
  }, l)));
  renderHead();
  renderChips();
  store.subscribe(() => { renderHead(); renderChips(); renderBaseSwitch(); });

  const zoomHint = h('div', { class: 'zoom-hint', role: 'status' }, 'Für Flurstücke näher heranzoomen');
  mapEl.parentElement.append(zoomHint);
  // Letzten Kartenausschnitt merken; Start sonst über Landkreis Greiz / Saale-Orla-Kreis
  let view = { c: [50.64, 11.86], z: 11 };
  try { view = JSON.parse(localStorage.getItem('waldwaechter.view')) || view; } catch { /* egal */ }
  base = createBaseMap(mapEl, { center: view.c, zoom: view.z, basemap: s.basemap, alkis: s.layers.alkis !== false, schalter: false });
  map = base.map;
  // Karte so hoch, dass beim Start Kopf, Karte und Knöpfe darunter ohne Scrollen zu sehen sind
  const kartenHoehe = () => {
    const wrap = root.querySelector('.map-wrap'), card = root.querySelector('.map-card');
    if (!wrap || !card || !wrap.offsetParent) return;
    if (matchMedia('(orientation: landscape) and (max-height: 540px)').matches) { document.documentElement.style.removeProperty('--map-h'); return; }
    const tab = document.querySelector('.tabbar')?.getBoundingClientRect();
    const unterkante = tab && tab.top > innerHeight / 2 ? tab.top : innerHeight; // Tab-Leiste unten (nicht als Seitenleiste)
    const sy = (root.scrollTop || 0) + scrollY; // Messung so, als wäre ganz oben
    const freiraum = unterkante - 12 - (card.getBoundingClientRect().bottom + sy);
    const neu = Math.max(220, Math.min(720, Math.round(wrap.getBoundingClientRect().height + freiraum)));
    document.documentElement.style.setProperty('--map-h', `${neu}px`);
    map?.invalidateSize();
  };
  requestAnimationFrame(() => requestAnimationFrame(kartenHoehe));
  setTimeout(kartenHoehe, 700); document.fonts?.ready.then(kartenHoehe);
  addEventListener('resize', () => setTimeout(kartenHoehe, 150));
  addEventListener('orientationchange', () => setTimeout(kartenHoehe, 300));
  setTimeout(kartenHoehe, 2000);
  addEventListener('ww:navigate', (e) => { if (e.detail === 'home') setTimeout(kartenHoehe, 120); });
  visualViewport?.addEventListener('resize', () => setTimeout(kartenHoehe, 150));
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Hineinzoomen', zoomOutTitle: 'Herauszoomen' }).addTo(map);
  renderBaseSwitch();
  // Fachebenen (Standortkarte, Schutzgebiete, …)
  for (const o of OVERLAYS) if (!o.pending) overlays[o.key] = overlayLayer(o);
  overlays.flurnummern = createFlurnummernLayer(map, () => ALL);
  const ersch = createErschliessungLayers(map, { nurAnsehen: true });
  overlays.gassen = ersch.gassen; overlays.lager = ersch.lager;
  const punkte = createPunktLayers(map, { nurAnsehen: true });
  overlays.habitat = punkte.habitat; overlays.jagd = punkte.jagd;
  overlays.hangneigung = createHangneigungLayer();
  overlays.fotopunkte = createFotopunktLayer(map, {
    fotos: async (f) => { const { fotopunktFotos } = await import('./tagebuch.js'); fotopunktFotos(f); },
    hinfuehren: async (f) => { const { openNavigation } = await import('./grenzfinder.js'); const p = (await source.allParcels()).find((x) => x.id === f.parcelId); openNavigation({ titel: f.name || 'Fotopunkt', ziel: f.at, zielName: f.name || 'Fotopunkt', blick: f.blick, parcel: p }); },
    verschieben: async (f) => { const { openHistorieFlurstueck } = await import('./historie.js'); openHistorieFlurstueck(f.parcelId, { fotopunkt: f.id }); },
  });
  window.addEventListener('ww:karte-punkt', (e) => {
    alleSeitenSchliessen();
    window.dispatchEvent(new CustomEvent('ww:navigate', { detail: 'home' }));
    const { at, ebene } = e.detail || {};
    if (ebene && !store.get().settings.layers[ebene]) store.update((st) => { st.settings.layers[ebene] = true; });
    setTimeout(() => { map.invalidateSize(); if (at) map.flyTo(at, Math.max(map.getZoom(), 18), { duration: 0.8 }); }, 300);
  });
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  // Verschiebt man die Karte von Hand, läuft sie nicht mehr mit (Verfolgung bleibt an)
  map.on('dragstart', () => { if (ortung === 'folgen') { ortung = 'an'; ortBtn(); } });
  map.on('moveend', () => {
    try { const c = map.getCenter(); localStorage.setItem('waldwaechter.view', JSON.stringify({ c: [c.lat, c.lng], z: map.getZoom() })); } catch { /* egal */ }
  });
  // Hinweis „näher heranzoomen“: einmal pro Suche, kurz eingeblendet. Nach dem Antippen eines Flurstücks
  // ist er wieder „scharf“ für die nächste Suche.
  zoomHint.hidden = true;
  let hintTimer = 0;
  const updateZoomHint = () => {
    const zuWeit = map.getZoom() < ALKIS_MIN_ZOOM && store.get().settings.layers.alkis !== false;
    if (!zuWeit) { zoomHint.hidden = true; clearTimeout(hintTimer); return; }
    if (zoomHintGezeigt) return;
    zoomHintGezeigt = true;
    zoomHint.hidden = false;
    clearTimeout(hintTimer); hintTimer = setTimeout(() => { zoomHint.hidden = true; }, 3500);
  };
  map.on('zoomend', updateZoomHint);

  osmLayer = createOsmFeatureLayer(map, () => store.get().settings.layers);
  allParcelsLayer = L.layerGroup().addTo(map);
  for (const k of Object.keys(CATEGORIES)) catGroups[k] = L.layerGroup().addTo(map);
  infoLayer = L.layerGroup().addTo(map);
  rescueLayer = L.layerGroup();
  selectionLayer = L.layerGroup().addTo(map);

  let busy = 0;
  map.on('click', async (e) => {
    const latlng = [e.latlng.lat, e.latlng.lng];
    const ticket = ++busy;
    const marker = L.circleMarker(latlng, { radius: 9, color: '#fff', weight: 3, fillColor: '#888', fillOpacity: 1, interactive: false, className: 'probing' }).addTo(map);
    try {
      const p = await source.parcelAt(latlng);
      marker.remove();
      if (ticket !== busy) return; // inzwischen erneut getippt
      if (p) { ALL = await source.allParcels(); await select(p, latlng); return; }
      clearSelection();
      if (source.lastError && map.getZoom() >= ALKIS_MIN_ZOOM - 1) {
        renderWmsInfo(latlng);
      } else if (map.getZoom() < ALKIS_MIN_ZOOM) toast('Zoom näher heran, um ein Flurstück anzutippen.');
      else toast('An dieser Stelle wurde kein Flurstück gefunden.');
    } catch (err) {
      // nie stumm bleiben: Ursache anzeigen, damit sich der Fehler finden lässt
      marker.remove();
      console.error(err);
      toast(`Flurstück konnte nicht angezeigt werden: ${err?.message || err}`);
    }
  });

  ALL = await source.allParcels();
  drawParcels();
  applyLayerVisibility();
  store.subscribe(async () => { ALL = await source.allParcels(); drawParcels(); applyLayerVisibility(); });
}

export function invalidateMap() { map?.invalidateSize(); }

function drawParcels() {
  allParcelsLayer.clearLayers();
  Object.values(catGroups).forEach((g) => g.clearLayers());
  infoLayer.clearLayers();
  const myList = store.get().parcels;
  for (const p of ALL) {
    const m = myList.find((x) => x.id === p.id);
    if (m && !passtFlurstueck(m)) { // Fläche aus einem anderen Ordner: im Profimodus dünn umrandet, sonst gar nicht
      if (istProfi()) allParcelsLayer.addLayer(L.polygon(polysOf(p), { color: '#6B7A70', weight: 1.5, dashArray: '2 5', fillOpacity: 0, interactive: false }));
    } else if (m) {
      const c = CATEGORIES[m.category] || CATEGORIES.Wald;
      catGroups[m.category]?.addLayer(L.polygon(polysOf(p), { color: c.color, weight: 2, fillColor: c.color, fillOpacity: 0.38, interactive: false }));
    } else if (p.source !== 'alkis') { // ALKIS-Grenzen zeigt bereits der WMS
      allParcelsLayer.addLayer(L.polygon(polysOf(p), { color: '#3B4A40', weight: 1, dashArray: '4 4', fillOpacity: 0, interactive: false, className: 'parcel-outline' }));
    }
    if (selected?.parcel.id === p.id) addInfoPoints(p); // „i“-Punkte nur am angetippten Flurstück
  }
  selectionLayer.eachLayer((l) => l.bringToFront?.());
}

function addInfoPoints(p) {
  for (const f of featuresOf(p)) {
    if (f.line) infoLayer.addLayer(L.polyline(f.line, { color: '#F26B1D', weight: 6, opacity: 0.9, dashArray: '10 8', interactive: false }));
    const marker = L.marker(f.at, {
      icon: L.divIcon({ className: `fpoint fpoint-i fpoint-${f.type}`, html: '<span aria-hidden="true">i</span>', iconSize: [30, 30], iconAnchor: [15, 15] }),
      keyboard: true, title: f.title, alt: f.title, zIndexOffset: 500,
    });
    marker.on('click', (e) => { L.DomEvent.stop(e); zeigeBesonderheit(f, p); });
    infoLayer.addLayer(marker);
  }
}

/** Der WaldWächter erklärt in der Sprechblase, was das „i“ bedeutet */
function zeigeBesonderheit(f, p) {
  const actions = [];
  if (f.type === 'vsp') {
    const schon = hatVerkehrssicherung(p.id);
    actions.push(h('button', { class: 'btn btn-small btn-primary', disabled: schon, onclick: (e) => {
      erinnereVerkehrssicherung(p);
      e.currentTarget.disabled = true; e.currentTarget.textContent = 'Im Maßnahmenplan';
      toast('Verkehrssicherung im Maßnahmenplan – zweimal im Jahr');
    } }, schon ? 'Bereits im Maßnahmenplan' : 'An Verkehrssicherung erinnern'));
  }
  const extra = f.type === 'vsp' && f.laenge ? ` (an ${f.art || 'Straße'} entlang, ca. ${Math.round(f.laenge / 10) * 10} m Waldrand)` : '';
  const kartiert = f.type !== 'vsp' ? (f.name ? ` Kartiert als: ${f.name}.` : ' Die Art ist in der Kartierung nicht angegeben.') : '';
  const angaben = (f.angaben || []).filter(([, v]) => !f.name || !f.name.includes(v)).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ');
  say(`${f.title}${extra}:${kartiert} ${f.text}${angaben ? ` (${angaben})` : ''}`, { duration: 0, actions: actions.length ? actions : undefined });
}

const PROFI_LAYER = new Set([]); // Rückegassen und Lagerplätze gibt es für alle
let grenzGeprueft = false, grenzLaeuft = false, grenzHinweis = false, grenzWartet = false;
/** Grenzpunkte: passende Ebene des Geoportals einmal suchen und melden, was der Dienst liefert.
 *  Hinweise erscheinen höchstens einmal je Sitzung (die Funktion läuft bei jeder Änderung der App-Daten). */
async function grenzpunktePruefen() {
  if (grenzGeprueft || grenzLaeuft) return;
  if (map.getZoom() < 16) {
    if (!grenzHinweis) { grenzHinweis = true; toast('Grenzsteine erscheinen ab Zoomstufe 16 – näher heranzoomen.'); }
    if (!grenzWartet) { grenzWartet = true; map.on('zoomend', function warte() { if (map.getZoom() >= 16) { map.off('zoomend', warte); grenzWartet = false; if (store.get().settings.layers.grenzpunkte) grenzpunktePruefen(); } }); }
    return;
  }
  grenzLaeuft = true;
  const r = await grenzpunkteFinden(map.getBounds()).catch((e) => ({ fehler: [e.message] }));
  grenzLaeuft = false;
  grenzGeprueft = true; // auch bei Fehler nicht ständig neu versuchen
  if (r.fehler) { toast('Grenzsteine: Der Dienst des Geoportals liefert gerade keine Grenzpunkte.'); return; }
  overlays.grenzpunkte.setUrl(r.url, true); overlays.grenzpunkte.setParams({ layers: r.layer });
  if (!r.punkte) toast('Grenzsteine: In diesem Kartenausschnitt sind keine Grenzpunkte verzeichnet.');
}

export function applyLayerVisibility() {
  const { layers } = store.get().settings;
  if (layers.grenzpunkte && map) grenzpunktePruefen();
  for (const [k, g] of Object.entries(catGroups)) {
    if (layers[k]) { if (!map.hasLayer(g)) g.addTo(map); } else map.removeLayer(g);
  }
  if (layers.info) { if (!map.hasLayer(infoLayer)) infoLayer.addTo(map); } else map.removeLayer(infoLayer);
  for (const [k, l] of Object.entries(overlays)) {
    const an = layers[k] && (!PROFI_LAYER.has(k) || istProfi());
    if (an) { if (!map.hasLayer(l)) l.addTo(map); } else map.removeLayer(l);
  }
  if (layers.rescue) { if (!map.hasLayer(rescueLayer)) { drawRescue(); rescueLayer.addTo(map); } } else map.removeLayer(rescueLayer);
}

async function drawRescue() {
  rescueLayer.clearLayers();
  for (const rp of await source.allRescuePoints()) {
    rescueLayer.addLayer(L.marker(rp.at, { icon: L.divIcon({ className: 'rpoint', html: '<span>+</span>', iconSize: [28, 28], iconAnchor: [14, 14] }), title: rp.id })
      .bindPopup(() => h('div', {}, h('strong', {}, `Rettungspunkt ${rp.id}`), h('p', {}, rp.access))));
  }
}

async function select(parcel, latlng) {
  selected = { parcel, latlng };
  zoomHintGezeigt = false; // nächste Suche darf den Hinweis wieder einmal zeigen
  clearMarks();
  selectionLayer.addLayer(L.polygon(polysOf(parcel), { color: '#FFFFFF', weight: 3.5, fillColor: '#1F4A2C', fillOpacity: 0.35, interactive: false }));
  selectionLayer.addLayer(infoPin(latlng));
  drawParcels();
  ladeBesonderheiten(parcel);
  await renderInfo();
}

function ladeBesonderheiten(parcel) {
  if (parcel.source !== 'alkis') return;
  besonderheiten(parcel).then((f) => {
    FEAT.set(parcel.id, f);
    drawParcels();
    const host = document.getElementById('besonderheiten');
    if (host && selected?.parcel.id === parcel.id) fill(host, ...besonderheitenListe(parcel));
    if (aktAchten?.id === parcel.id) aktAchten.a.update?.();
  });
}

function besonderheitenListe(p) {
  const f = featuresOf(p);
  if (!f.length) return [h('p', { class: 'muted' }, 'Keine Verkehrssicherungspflicht, keine kartierten Biotope und keine Wald-Lebensraumtypen auf diesem Flurstück gefunden.')];
  const gruppen = {};
  for (const x of f) (gruppen[x.type] ||= []).push(x);
  return [h('ul', { class: 'feature-list' }, Object.entries(gruppen).map(([t, list]) => h('li', { class: `feature feature-${t}` },
    h('span', { class: 'feature-type' }, FEATURE_TYPES[t] || list[0].title),
    t === 'vsp' ? h('strong', {}, list.length > 1 ? `${list.length} Stellen auf der Karte` : list[0].title)
      : h('ul', { class: 'feature-namen' }, [...new Map(list.map((x) => [x.name || '', x])).values()].map((x) => h('li', {}, h('strong', {}, x.name || 'Art nicht angegeben'),
        (x.angaben || []).filter(([, v]) => !x.name || !x.name.includes(v)).length ? h('small', { class: 'muted' }, ` · ${(x.angaben || []).filter(([, v]) => !x.name || !x.name.includes(v)).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')}`) : null))),
    h('p', {}, list[0].text),
    t === 'vsp' ? h('button', { class: 'btn btn-small', disabled: hatVerkehrssicherung(p.id), onclick: (e) => { erinnereVerkehrssicherung(p); e.currentTarget.disabled = true; e.currentTarget.textContent = 'Im Maßnahmenplan'; toast('Verkehrssicherung im Maßnahmenplan'); } },
      hatVerkehrssicherung(p.id) ? 'Bereits im Maßnahmenplan' : 'An Verkehrssicherung erinnern') : null,
  ))), h('p', { class: 'hint' }, 'Tippe auf ein „i“ in der Karte, dann erklärt dir der WaldWächter die Besonderheit. Biotope: © GDI-Th / TLUBN / ThüringenForst, live abgefragt.')];
}

function clearSelection() {
  selected = null;
  clearMarks();
  const box = document.getElementById('infobox');
  box.hidden = true;
  drawParcels();
  requestAnimationFrame(invalidateMap);
}

/** Amtliche Auskunft des Geoportals als iframe (zeigt Daten an, ohne dass die App sie speichert) */
const geoFrame = (title, src, height = 200) => h('iframe', { class: 'wms-info', src, title, loading: 'lazy', referrerpolicy: 'no-referrer', style: `height:${height}px` });

/** Aufklappbare Themen-Kachel in der Infobox; die Kurzinfo steht auch im zugeklappten Zustand da */
const KLAPP = new Set(); // aufgeklappte Kacheln bleiben beim Wechsel des Flurstücks offen
let aktAchten = null;
/** „Schutz und Auflagen“: alle Hinweise zur Fläche als kurze, klare Liste – wichtigstes zuerst */
function achtenZeichnen(p, achten, host) {
  const geo = achten.geo;
  const featBereit = FEAT.has(p.id);
  const punkte = [];
  if (geo && !geo.fehler) {
    const gesehen = new Set();
    for (const x of geo.schutz) {
      if (gesehen.has(x.short)) continue; gesehen.add(x.short);
      punkte.push({ stufe: x.level, marke: x.short, kurz: x.label, titel: x.props?.siteName ? `${x.label} „${umlaut(x.props.siteName)}“` : x.label, text: x.text,
        aktion: h('button', { type: 'button', class: 'link-btn', onclick: () => zeigeVerordnung(x) }, 'Verordnung ansehen') });
    }
    for (const x of geo.funktion) punkte.push({ stufe: 1, marke: x.icon || '•', kurz: x.label, titel: x.label, text: x.text });
  }
  const typen = {};
  for (const f of featuresOf(p)) (typen[f.type] ||= []).push(f);
  for (const [t, list] of Object.entries(typen)) {
    if (t === 'nsg' || t === 'waldfunktion') continue; // schon oben aus dem Geoportal
    const namen = [...new Set(list.map((x) => x.name).filter(Boolean))].slice(0, 3);
    punkte.push({ stufe: t === 'vsp' ? 2 : 2, marke: t === 'vsp' ? '⚠' : t === 'lrt' ? 'LRT' : '◆', kurz: t === 'vsp' ? 'Verkehrssicherung' : FEATURE_TYPES[t] || list[0].title,
      titel: `${FEATURE_TYPES[t] || list[0].title}${namen.length ? `: ${namen.join(', ')}` : list.length > 1 ? ` (${list.length} Stellen)` : ''}`, text: list[0].text,
      aktion: t === 'vsp' ? h('button', { type: 'button', class: 'link-btn', disabled: hatVerkehrssicherung(p.id), onclick: (e) => { erinnereVerkehrssicherung(p); e.currentTarget.disabled = true; e.currentTarget.textContent = 'Im Maßnahmenplan'; toast('Verkehrssicherung im Maßnahmenplan'); } },
        hatVerkehrssicherung(p.id) ? 'Bereits im Maßnahmenplan' : 'An Kontrollen erinnern') : null });
  }
  punkte.sort((x, y) => y.stufe - x.stufe);
  const laedt = !geo || !featBereit;
  const relevant = punkte.filter((x) => x.stufe > 0);
  fill(host,
    punkte.length ? h('ul', { class: 'achten-punkte' }, punkte.map((x) => h('li', { class: `achten-stufe-${x.stufe}` },
      h('span', { class: 'achten-marke', 'aria-hidden': 'true' }, x.marke),
      h('div', {}, h('strong', {}, x.titel), h('p', {}, x.text), x.aktion || null))))
      : laedt || geo?.fehler ? null
      : h('p', { class: 'ok-line' }, h('span', { html: icon.check }), 'Kein Schutzgebiet, kein kartiertes Biotop und keine Verkehrssicherungspflicht – hier gilt die normale, ordnungsgemäße Forstwirtschaft.'),
    laedt ? h('p', { class: 'muted' }, 'Weitere Angaben werden noch geladen …') : null,
    geo?.fehler ? h('p', { class: 'muted' }, 'Schutzgebiete und Waldfunktionen sind gerade nicht abrufbar – unten unter „Einzelheiten“ steht die Rohauskunft.') : null,
    h('div', { class: 'achten-immer' }, h('strong', {}, 'Gilt überall: '),
      'Zwischen März und August brüten Vögel – Holzernte möglichst im Herbst und Winter, Horst- und Höhlenbäume stehen lassen. Bei Unsicherheit vorher den Revierförster fragen.'));
  achten.block.setKurz(laedt && !punkte.length ? 'Wird geprüft …'
    : geo?.fehler && !punkte.length ? 'Geoportal gerade nicht erreichbar'
    : relevant.length ? `${relevant.length} ${relevant.length === 1 ? 'Punkt' : 'Punkte'}: ${relevant.slice(0, 3).map((x) => x.kurz).join(', ')}${relevant.length > 3 ? ' …' : ''}`
    : 'Nichts Besonderes – normale Bewirtschaftung');
}

function klapp(key, titel, inhalt, vorschau = null) {
  const kurz = h('span', { class: 'klapp-kurz' }, vorschau || '');
  const el = h('details', { class: 'info-block klapp', open: KLAPP.has(key) || undefined, ontoggle: (e) => { if (e.target.open) KLAPP.add(key); else KLAPP.delete(key); } },
    h('summary', {}, h('span', { class: 'klapp-titel' }, h('strong', {}, titel), kurz), h('span', { class: 'klapp-pfeil', 'aria-hidden': 'true', html: icon.chevron })),
    h('div', { class: 'klapp-inhalt' }, inhalt));
  el.setKurz = (t) => { kurz.textContent = t || ''; };
  return el;
}

function rescueBlock(latlng) {
  const list = h('div', { class: 'rescue-live', 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Suche die nächsten Rettungspunkte …'));
  nearestRescue(latlng, 2).then((pts) => {
    if (!pts.length) { fill(list, h('p', { class: 'muted' }, 'Im Umkreis von 8 km ist kein Rettungspunkt verzeichnet.')); block.setKurz('keiner im Umkreis von 8 km'); return; }
    block.setKurz(`${pts[0].id} · ${formatDist(pts[0].dist)} ${compassLabel(pts[0].brg)}`);
    fill(list, h('ul', { class: 'rescue-list' }, pts.map((rp) => h('li', { class: 'rescue' },
      h('div', { class: 'rescue-head' },
        h('span', { class: 'rescue-badge', 'aria-hidden': 'true' }, '+'),
        h('strong', {}, rp.id),
        h('span', { class: 'rescue-dist' }, `${formatDist(rp.dist)} ${compassLabel(rp.brg)}`),
      ),
      rp.access ? h('p', { class: 'rescue-access' }, h('span', { class: 'label' }, 'Anfahrt: '), rp.access) : null,
      h('p', { class: 'hint' }, [rp.signed ? `beschildert: ${rp.signed}` : null, rp.source ? `Quelle: ${rp.source}` : null].filter(Boolean).join(', ')),
      h('div', { class: 'rescue-actions' },
        h('a', { class: 'btn btn-small', href: `https://www.google.com/maps/dir/?api=1&destination=${rp.at[0]},${rp.at[1]}`, target: '_blank', rel: 'noopener' }, h('span', { html: icon.nav }), 'Google Maps'),
        h('a', { class: 'btn btn-small', href: `https://maps.apple.com/?daddr=${rp.at[0]},${rp.at[1]}&dirflg=d`, target: '_blank', rel: 'noopener' }, h('span', { html: icon.nav }), 'Apple Karten'),
        h('button', { class: 'btn btn-small', onclick: () => showRescueOnMap(rp, latlng) }, 'Auf Karte zeigen'),
      ),
    ))));
  }).catch(() => {
    block.setKurz('nicht erreichbar');
    fill(list,
      h('p', { class: 'hint' }, 'Die Rettungspunkte konnten gerade nicht abgefragt werden (keine Verbindung zum Geoportal). Blende die Ebene „Rettungspunkte“ ein oder nutze den ThüringenViewer.'),
      h('a', { class: 'btn btn-small', href: 'https://www.thueringenforst.de/aktuelles-service/info-karten/rettungspunkte', target: '_blank', rel: 'noopener' }, 'Rettungspunkte bei ThüringenForst'));
  });
  const block = klapp('rettung', 'Rettungspunkte', [list,
    h('p', { class: 'hint' }, 'Entfernung in Luftlinie vom angetippten Punkt. Im Notfall: 112 wählen und die Rettungspunkt-Nummer nennen. Daten: © GDI-Th / ThüringenForst.')], 'Suche …');
  return block;
}

function eigentuemerBlock(p) {
  const host = h('div');
  const e0 = eigentuemerVon(p);
  const block = klapp('eigentuemer', 'Eigentümer', host, e0 ? etName(e0) || 'hinterlegt' : 'nicht hinterlegt');
  const zeichne = () => { const e = eigentuemerVon(p); block.setKurz(e ? etName(e) || 'hinterlegt' : 'nicht hinterlegt'); fill(host, eigentuemerInhalt(p, zeichne)); };
  zeichne();
  return block;
}

const WEG_FARBE = '#7B3FA0';
function wanderwegeTeil(p) {
  const host = h('div', { 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Suche Wanderwege …'));
  const block = h('div', { class: 'besonder-wege' }, h('span', { class: 'feature-type' }, 'Wanderwege'), host);
  block.setKurz = () => {};
  wanderwege(p).then((wege) => {
    if (selected?.parcel.id !== p.id) return;
    if (!wege.length) { block.setKurz('keine'); fill(host, h('p', { class: 'muted' }, 'Durch dieses Flurstück führt kein in OpenStreetMap erfasster Wanderweg.')); return; }
    block.setKurz(wege.map((w) => w.name).slice(0, 2).join(', ') + (wege.length > 2 ? ` +${wege.length - 2}` : ''));
    for (const w of wege) for (const l of w.linien) selectionLayer.addLayer(L.polyline(l, { color: WEG_FARBE, weight: 5, opacity: 0.85, dashArray: '2 8', lineCap: 'round', interactive: false }));
    fill(host,
      h('ul', { class: 'wege-liste' }, wege.map((w) => h('li', {},
        h('span', { class: 'weg-strich', style: `--weg:${WEG_FARBE}`, 'aria-hidden': 'true' }),
        h('div', {}, h('strong', {}, w.name, w.ref ? ` (${w.ref})` : ''),
          h('small', { class: 'muted' }, [`ca. ${formatDist(Math.round(w.laengeM / 10) * 10)} im Flurstück`, w.netz ? `${w.netz}er Wanderweg` : null, w.betreiber].filter(Boolean).join(' · ')))))),
      h('p', { class: 'hint' }, 'Lila gepunktet in der Karte. Bei Holzernte und Wegebau: Wanderwege sichern oder sperren, Beschilderung erhalten, Verkehrssicherung beachten. Quelle: © OpenStreetMap-Mitwirkende, live abgefragt.'));
  }).catch(() => { block.setKurz('nicht erreichbar'); fill(host, h('p', { class: 'muted' }, 'Die Wanderwege konnten gerade nicht abgefragt werden (keine Verbindung zu OpenStreetMap).')); });
  return block;
}

function showRescueOnMap(rp, from) {
  rescueMarkers?.remove(); // immer nur ein Rettungspunkt gleichzeitig
  rescueMarkers = L.layerGroup([
    L.polyline([from, rp.at], { color: '#C62828', weight: 3, dashArray: '6 8', interactive: false }),
    L.marker(rp.at, { icon: L.divIcon({ className: 'rpoint', html: '<span>+</span>', iconSize: [28, 28], iconAnchor: [14, 14] }), title: rp.id })
      .bindTooltip(rp.id, { permanent: true, direction: 'top', offset: [0, -12], className: 'rp-tip' }),
  ]).addTo(map);
  map.fitBounds(L.latLngBounds([from, rp.at]), { padding: [50, 50], maxZoom: 16 });
  document.querySelector('.map-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function meter(steps, active, label, colors) {
  return h('div', { class: 'meter', role: 'img', 'aria-label': `${label}: ${active >= 0 ? steps[active] : 'unbekannt'}` },
    h('div', { class: 'meter-head' }, h('span', {}, label), h('strong', {}, active >= 0 ? steps[active] : 'k. A.')),
    h('div', { class: 'meter-bar' }, steps.map((st, i) => h('span', { class: i === active ? 'on' : '', style: `--m:${colors[i]}`, title: st }))),
    h('div', { class: 'meter-ends' }, h('span', {}, steps[0]), h('span', {}, steps[steps.length - 1])),
  );
}

function renderGeoInfo(info) {
  const g = { standort: [], schutz: [], zust: [], vorschau: {} };
  // Standort
  if (info.standort) {
    const st = explainStandort(info.standort);
    const d = st.d;
    const decoded = [d.stufe, d.nk >= 0 ? NAEHRKRAFT[d.nk].label : null, d.carbonat ? 'carbonatisch (kalkhaltig)' : null].filter(Boolean).join(', ');
    g.standort.push(h('div', { class: 'geo-card' },
      h('p', { class: 'geo-kicker' }, 'Standort'),
      h('h4', {}, st.desc ? st.desc[0].toUpperCase() + st.desc.slice(1) : decoded || `Standortsgruppe ${st.gruppe}`),
      st.gruppe ? h('p', { class: 'code-line' }, h('span', { class: 'code' }, st.gruppe), decoded ? ` = ${decoded}` : '', h('small', {}, d.bereichLabel)) : null,
      meter(NAEHRKRAFT.map((n) => n.label), d.nk, 'Nährstoffe', ['#C9B98A', '#B9C27A', '#8FAF4E', '#5E9A3A', '#2F7D3A']),
      meter(WASSER_SKALA, d.wasser, d.wechsel ? 'Wasserversorgung (wechselnd)' : 'Wasserversorgung', ['#D9B36A', '#CFC07C', '#A9C48A', '#7FB59A', '#5A9EB5', '#3F7FB0']),
      h('p', { class: 'geo-facts' }, [st.einheit && `Standortseinheit ${st.einheit}`, st.bodenform && `Bodenform ${st.bodenform}`, st.wasserStufe && `Wasserhaushaltsstufe ${st.wasserStufe}`].filter(Boolean).join(' · ')),
    ));
  } else {
    g.standort.push(h('div', { class: 'geo-card muted-card' }, h('p', { class: 'geo-kicker' }, 'Standort'), h('p', {}, 'Für diesen Punkt ist keine forstliche Standortskartierung hinterlegt (meist außerhalb des Waldes).')));
  }
  // Schutzstatus
  const LEVEL = ['Hinweis', 'geschützt', 'europäisch geschützt', 'streng geschützt'];
  g.schutz.push(h('div', { class: 'geo-card' },
    h('p', { class: 'geo-kicker' }, 'Schutzstatus'),
    info.schutz.length
      ? h('ul', { class: 'geo-list' }, info.schutz.map((x) => h('li', { class: `prot prot-${x.level}` },
          h('span', { class: 'prot-badge' }, x.short),
          h('div', {},
            h('strong', {}, x.props.siteName ? umlaut(x.props.siteName) : x.label),
            h('span', { class: 'prot-type' }, `${x.label} – ${LEVEL[x.level]}`),
            h('p', {}, x.text),
          ),
          h('button', { class: 'legend-i', type: 'button', 'aria-label': `Schutzgebietsverordnung: ${x.label}`, title: 'Schutzgebietsverordnung', onclick: () => zeigeVerordnung(x) }, 'i'),
        )))
      : h('p', { class: 'ok-line' }, h('span', { html: icon.check }), 'Kein Schutzgebiet am angetippten Punkt.'),
  ));
  // Waldfunktionen
  g.schutz.push(h('div', { class: 'geo-card' },
    h('p', { class: 'geo-kicker' }, 'Waldfunktionen'),
    info.funktion.length
      ? h('ul', { class: 'geo-list' }, info.funktion.map((x) => h('li', { class: 'func' },
          h('span', { class: 'func-icon', 'aria-hidden': 'true' }, x.icon),
          h('div', {}, h('strong', {}, x.label), h('p', {}, x.text), x.props.Bemerkung ? h('span', { class: 'prot-type' }, `Rechtsgrundlage: ${x.props.Bemerkung}`) : null),
        )))
      : h('p', { class: 'muted' }, 'Keine besonderen Waldfunktionen ausgewiesen – normale Bewirtschaftung.'),
  ));
  // Biotope, LRT, Schäden
  // Nadelholz-LRT (z. B. 9410) und reine Nadelholz-Biotope sind für die Bewirtschaftung unwichtig → nicht anzeigen
  const waldWichtig = info.wald.filter((x) => x.layer === 'waldlebensraumtypen' ? (lrtCode(x.props) ? lrtWichtig(lrtCode(x.props)) : true)
    : x.layer === 'waldbiotope' ? biotopWichtig('', x.props) : true);
  if (waldWichtig.length) {
    g.schutz.push(h('div', { class: 'geo-card' },
      h('p', { class: 'geo-kicker' }, 'Biotope und Besonderheiten'),
      h('ul', { class: 'geo-list' }, waldWichtig.map((x) => {
        const details = Object.entries(x.props).filter(([k]) => !/datum|flaeche|urheber|stand/i.test(k)).map(([k, v]) => `${umlaut(k)}: ${umlaut(v)}`).slice(0, 4);
        const lh = x.layer === 'waldlebensraumtypen' ? lrtHinweis(lrtCode(x.props)) : null;
        if (lh) return h('li', { class: 'func lrt' }, h('span', { class: 'func-icon', 'aria-hidden': 'true' }, lh.nadel ? '🌲' : '🌳'),
          h('div', {}, h('strong', {}, lh.titel), h('span', { class: 'prot-type' }, `FFH-Lebensraumtyp · ${lh.p18}`),
            h('ul', { class: 'lrt-punkte' }, lh.punkte.map((t) => h('li', {}, t))),
            h('details', {}, h('summary', {}, 'Typische Baumarten laut Steckbrief'),
              h('p', {}, `Hauptbaumarten: ${lh.haupt}`), h('p', {}, `Mischbaumarten: ${lh.misch}`), h('p', {}, `Begleitbaumarten: ${lh.begleit}`),
              h('p', { class: 'hint' }, 'Quelle: Steckbriefe für die Wald-Lebensraumtypen in Thüringen, TLWJF 2003.'))));
        return h('li', { class: 'func' }, h('span', { class: 'func-icon', 'aria-hidden': 'true' }, '◆'),
          h('div', {}, h('strong', {}, x.label), h('p', {}, x.text), details.length ? h('span', { class: 'prot-type' }, details.join(' · ')) : null));
      })),
    ));
  }
  // Zuständigkeit: Forstamt/Revier mit Revierförster und die eigene FBG – jeweils mit Telefon und E-Mail
  const pr = store.get().profile;
  const fbg = pr.fbg;
  const z = info.zustaendig;
  // Kontaktangaben, falls der Dienst sie mitliefert (Feldnamen je nach Stand des Dienstes)
  const dienst = { name: '', tel: '', mail: '' };
  if (z) for (const [k, v] of Object.entries(z)) {
    if (/mail/i.test(k)) dienst.mail ||= v;
    else if (/tel|fon/i.test(k)) dienst.tel ||= v;
    else if (/leiter|f(oe|ö)rster|ansprech/i.test(k)) dienst.name ||= v;
  }
  const eigen = revierKontakt(z) || {};
  const tf = info.rl?.revier || {};
  const rf = { name: eigen.name || tf.name || dienst.name, tel: eigen.tel || tf.tel || dienst.tel, mobil: eigen.tel ? '' : tf.mobil, mail: eigen.mail || tf.mail || dienst.mail };
  const amt = info.rl?.amt;
  g.zust.push(h('div', { class: 'geo-card' },
    h('p', { class: 'geo-kicker' }, 'Hoheitsförster (ThüringenForst)'),
    z ? h('p', {}, h('strong', {}, `Forstamt ${z.Forstamt || '–'}`), z.Revier ? `, Revier ${z.Revier}` : '') : h('p', { class: 'muted' }, 'Zuständigkeit gerade nicht abrufbar.'),
    z ? h('div', { class: 'kontakt-karte' },
      h('span', { class: 'muted' }, 'Revierleiter/in'),
      h('strong', {}, rf.name || 'Name nicht hinterlegt'),
      kontaktLinks({ tel: rf.tel, mail: rf.mail }),
      rf.mobil ? h('div', { class: 'kontakt-links' }, h('a', { class: 'btn btn-small', href: `tel:${String(rf.mobil).replace(/[^\d+]/g, '')}` }, `📱 ${rf.mobil}`)) : null,
      h('button', { class: 'link-btn', onclick: async () => { if (await revierKontaktBearbeiten(z)) { toast('Kontakt gespeichert'); renderInfo(); } } }, eigen.name || eigen.tel || eigen.mail ? 'Eigenen Kontakt bearbeiten' : rf.name ? 'Kontakt korrigieren' : 'Name, Telefon und E-Mail eintragen')) : null,
    amt ? h('div', { class: 'kontakt-karte' },
      h('span', { class: 'muted' }, `Forstamt ${info.rl.forstamt}${amt.leiter ? ` · Leitung: ${amt.leiter}` : ''}`),
      kontaktLinks({ tel: amt.tel, mail: amt.mail })) : null,
    z ? h('p', { class: 'hint' }, info.rl?.revier && !eigen.name
      ? h('span', {}, `Kontakt laut ThüringenForst (Stand ${new Date(info.rl.stand).toLocaleDateString('de-DE')}). `, h('a', { href: amt.url, target: '_blank', rel: 'noopener' }, 'Mitarbeiterseite des Forstamts'))
      : 'Der Revierförster berät kostenlos zu Waldbau, Förderung, Waldschutz und Holzverkauf. Eingetragene Kontakte gelten für alle Flurstücke im Revier.') : null,
  ));
  g.zust.push(h('div', { class: 'geo-card' },
    h('p', { class: 'geo-kicker' }, 'Forstbetriebsgemeinschaft'),
    fbg
      ? h('div', { class: 'kontakt-karte' },
          h('strong', {}, fbg),
          pr.fbgAnsprech ? h('span', {}, `Ansprechpartner: ${pr.fbgAnsprech}`) : null,
          kontaktLinks({ tel: pr.fbgTel, mail: pr.fbgMail }),
          !pr.fbgAnsprech && !pr.fbgTel && !pr.fbgMail ? h('button', { class: 'link-btn', onclick: () => openProfile() }, 'Ansprechpartner, Telefon und E-Mail im Profil eintragen') : null)
      : h('p', { class: 'hint' }, 'Bist du Mitglied einer Forstbetriebsgemeinschaft? ',
          h('button', { class: 'link-btn', onclick: () => openProfile() }, 'Im Profil eintragen')),
  ));
  // Kurzinfo für die zugeklappten Kacheln
  const st0 = info.standort ? explainStandort(info.standort) : null;
  g.vorschau.standort = st0 ? (st0.desc ? st0.desc[0].toUpperCase() + st0.desc.slice(1) : `Standortsgruppe ${st0.gruppe}`) : 'keine Standortskartierung';
  g.vorschau.schutz = [info.schutz.length ? info.schutz.map((x) => x.short).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') : 'kein Schutzgebiet',
    info.funktion.length ? `${info.funktion.length} Waldfunktion${info.funktion.length > 1 ? 'en' : ''}` : null].filter(Boolean).join(' · ');
  g.vorschau.zust = [z?.Revier ? `Revier ${z.Revier}${rf.name ? ` (${rf.name})` : ''}` : z?.Forstamt ? `Forstamt ${z.Forstamt}` : null, fbg || null].filter(Boolean).join(' · ');
  return g;
}

function bestandCard(b, parcelId = null, pf = null) {
  const k = parcelId ? store.get().bestandKorrektur?.[parcelId] : null;
  if (pf && !(k?.haupt?.art && (k.erfasst || 0) > pf.ts)) {
    return h('div', { class: 'geo-card' },
      h('p', { class: 'geo-kicker' }, `Bestand – deine Pflanzung ${pf.jahr}`),
      h('h4', {}, `${pf.text}${pf.alter != null ? `, etwa ${pf.alter} Jahre` : ''}`),
      h('dl', { class: 'bestand-schichten' }, pf.arten.map((a) => h('div', {}, h('dt', {}, `${a.name}${a.anteil ? ` (${Math.round(a.anteil)} %)` : ''}`), h('dd', {}, `etwa ${a.alter} Jahre${a.sortiment ? ` · ${a.sortiment}` : ''}`)))),
      h('p', { class: 'muted' }, `Aus der abgeschlossenen Pflanzung (Pflanzjahr ${pf.jahr}). Alter = Jahre seit der Pflanzung + Alter des Sortiments${pf.arten.some((a) => !a.sortiment) ? ' (ohne Sortimentsangabe: + 2 Jahre)' : ''}.${b ? ` Waldverzeichnis (Stand ${b.stichtag || '?'}): „${b.text}“.` : ''}`),
      parcelId ? h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-small', onclick: () => bestandKorrigieren(parcelId, b) }, 'Angaben falsch? Korrigieren')) : null);
  }
  const korrBtn = parcelId ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => bestandKorrigieren(parcelId, b) }, k ? 'Angaben ändern' : 'Angaben falsch? Korrigieren') : null;
  if (k?.haupt?.art) {
    return h('div', { class: 'geo-card' },
      h('p', { class: 'geo-kicker' }, 'Bestand – deine Angaben'),
      h('dl', { class: 'bestand-schichten' }, SCHICHTEN.filter(([key]) => k[key]?.art).map(([key, label]) => h('div', {},
        h('dt', {}, label), h('dd', {}, `${k[key].art}${korrAlter(k[key], k.jahr) != null ? `, etwa ${korrAlter(k[key], k.jahr)} Jahre` : ''}`)))),
      h('p', { class: 'muted' }, `Von dir erfasst ${k.jahr}${k.jahr !== new Date().getFullYear() ? ', Alter auf heute hochgerechnet' : ''}.${b ? ` Waldverzeichnis (Stand ${b.stichtag || '?'}): „${b.text}“${b.alterStichtag != null ? `, ${b.alterStichtag} Jahre` : ''}.` : ''}`),
      h('div', { class: 'btn-row' }, korrBtn,
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { store.update((s) => { delete s.bestandKorrektur[parcelId]; }); toast('Wieder Angaben aus dem Waldverzeichnis'); if (selected?.parcel.id === parcelId) renderInfo(); } }, 'Zurücksetzen')));
  }
  if (!b) return parcelId ? h('div', { class: 'geo-card muted-card' }, h('p', { class: 'geo-kicker' }, 'Bestand'), h('p', {}, 'Im Waldverzeichnis ist hier kein Bestand verzeichnet.'), h('div', { class: 'btn-row' }, korrBtn)) : null;
  return h('div', { class: 'geo-card' },
    h('p', { class: 'geo-kicker' }, `Bestand${b.stichtag ? ` · Stand ${b.stichtag}` : ''}`),
    h('h4', {}, `${b.art || b.text}${b.alter != null ? `, etwa ${b.alter} Jahre` : ''}`),
    h('p', { class: 'muted' }, `Waldverzeichnis ThüringenForst: „${b.text}“${b.alterStichtag != null ? `, ${b.alterStichtag} Jahre zum Stand ${b.stichtag}, auf heute hochgerechnet` : ''}.${b.stichtag ? ` Seit ${b.stichtag} kann sich viel geändert haben (Käfer, Sturm, Einschlag).` : ''}`),
    korrBtn ? h('div', { class: 'btn-row' }, korrBtn) : null);
}

/** Eigene Angaben zum Bestand: Haupt-, Misch- und Nebenbaumart mit Alter */
function bestandKorrigieren(parcelId, b) {
  const alt = store.get().bestandKorrektur?.[parcelId];
  const jahr = new Date().getFullYear();
  const w = {};
  for (const [key] of SCHICHTEN) w[key] = { art: alt?.[key]?.art || (key === 'haupt' && b?.art ? b.art : ''), alter: alt?.[key] ? korrAlter(alt[key], alt.jahr) ?? '' : key === 'haupt' && b?.alter != null ? b.alter : '' };
  const zeile = (key, label) => h('div', { class: 'korr-zeile' },
    h('label', {}, label, h('select', { onchange: (e) => { w[key].art = e.target.value; } },
      h('option', { value: '' }, key === 'haupt' ? 'bitte wählen' : 'keine'),
      KORREKTUR_ARTEN.map((a) => h('option', { value: a, selected: w[key].art === a }, a)))),
    h('label', {}, 'Alter (Jahre)', h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 300, value: w[key].alter, oninput: (e) => { w[key].alter = e.target.value; } })));
  dialog({
    title: 'Bestand korrigieren',
    body: h('div', { class: 'form korr-form' },
      h('p', { class: 'muted' }, b ? `Waldverzeichnis (Stand ${b.stichtag || '?'}): „${b.text}“${b.alter != null ? `, heute etwa ${b.alter} Jahre` : ''}. Trage ein, was heute tatsächlich auf der Fläche steht.` : 'Trage ein, was auf der Fläche steht.'),
      SCHICHTEN.map(([key, label]) => zeile(key, label)),
      h('p', { class: 'hint' }, 'Hauptbaumart = häufigste Baumart, Mischbaumart = zweithäufigste, Nebenbaumart = weitere Baumart (z. B. im Unter- oder Zwischenstand). Deine Angaben gelten für dieses Flurstück und werden auch bei der Durchforstung verwendet.')),
    actions: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', value: true, primary: true }],
  }).then((ok) => {
    if (!ok) return;
    if (!w.haupt.art) { toast('Bitte mindestens die Hauptbaumart angeben'); return; }
    const k = { jahr, erfasst: Date.now() };
    for (const [key] of SCHICHTEN) if (w[key].art) k[key] = { art: w[key].art, alter: w[key].alter === '' ? null : Math.round(Number(w[key].alter)) };
    store.update((s) => { (s.bestandKorrektur ||= {})[parcelId] = k; });
    toast('Bestand gespeichert');
    if (selected?.parcel.id === parcelId) renderInfo();
  });
}

function bztKurz(r) {
  if (r.status !== 'ok') return r.status === 'ausserhalb' ? 'außerhalb Thüringens' : 'kein Eintrag im Tabellenwerk';
  return `Hauptbaumarten: ${r.eintrag.B.join(', ') || '–'}`;
}
/** Baumartenempfehlung und Bestandeszieltypen aus dem Tabellenwerk */
export function bztKarte(r) {
  if (r.status === 'ausserhalb') return h('p', { class: 'muted' }, 'Der Punkt liegt außerhalb der Thüringer Wuchseinheiten.');
  if (r.status !== 'ok') return h('div', {}, h('p', { class: 'muted' }, `Für die Standortseinheit ${r.einheit || r.gruppe} enthält das Tabellenwerk in der Wuchseinheit ${r.wuchseinheitName} keinen Eintrag (aufgeführt sind nur Standorte ab 1 % Flächenanteil).`),
    h('p', { class: 'hint' }, 'Frag beim Forstamt nach einer Empfehlung für diesen Standort.'));
  const e = r.eintrag;
  const arten = (liste) => (liste.length ? liste.map((k) => h('span', { class: 'ba-chip', title: BAUMARTEN_KURZ[k] || k }, h('strong', {}, k), ` ${BAUMARTEN_KURZ[k] || ''}`)) : h('span', { class: 'muted' }, '–'));
  const trefferText = r.treffer === 'genau' ? '' : r.treffer === 'zusatz'
    ? ` Für ${r.einheit} gilt der Eintrag ${r.code} (gleiche Standortseinheit mit Zusatzkennzeichen).`
    : ` Die Standortseinheit ${r.einheit || r.gruppe} steht nicht im Tabellenwerk; gezeigt wird die ähnlichste Einheit ${r.code} derselben Standortsgruppe ${r.gruppe || ''}.`;
  // Einfache Ansicht: passende Baumarten mit Namen; Standort, Bestandeszieltypen und Hinweise aufklappbar
  const namen = (liste) => (liste.length ? liste.map((k) => h('span', { class: 'ba-chip ba-chip-name', title: k }, BAUMARTEN_KURZ[k] || k)) : h('span', { class: 'muted' }, '–'));
  return h('div', { class: 'bzt' },
    h('div', { class: 'geo-card bzt-einfach' },
      h('p', { class: 'geo-kicker' }, 'Diese Baumarten passen hier'),
      h('div', { class: 'ba-gruppe' }, h('p', {}, h('strong', {}, 'Als Hauptbaumart'), h('small', {}, ' prägt den Bestand')), h('div', { class: 'ba-chips' }, namen(e.B))),
      h('div', { class: 'ba-gruppe' }, h('p', {}, h('strong', {}, 'Zum Mischen'), h('small', {}, ' gut beigemischt')), h('div', { class: 'ba-chips' }, namen(e.C))),
      e.D.length ? h('div', { class: 'ba-gruppe' }, h('p', {}, h('strong', {}, 'Am Rand / einzeln'), h('small', {}, ' Nebenbaumarten')), h('div', { class: 'ba-chips' }, namen(e.D))) : null,
      h('p', { class: 'hint' }, `Standort ${r.code}: ${e.name}. Reinbestände werden nicht empfohlen – am besten mehrere Arten mischen.`)),
    h('details', { class: 'bzt-mehr' }, h('summary', {}, 'Mehr anzeigen: Anteile, Bestandeszieltypen, Standort'),
    h('div', { class: 'geo-card' },
      h('p', { class: 'geo-kicker' }, 'Anteile laut Tabellenwerk'),
      h('div', { class: 'ba-gruppe' }, h('p', {}, h('strong', {}, 'Hauptbaumarten'), h('small', {}, ' 5/10 bis 8/10 der Fläche')), h('div', { class: 'ba-chips' }, arten(e.B))),
      h('div', { class: 'ba-gruppe' }, h('p', {}, h('strong', {}, 'Mischbaumarten'), h('small', {}, ' 2/10 bis 5/10')), h('div', { class: 'ba-chips' }, arten(e.C))),
      h('div', { class: 'ba-gruppe' }, h('p', {}, h('strong', {}, 'Nebenbaumarten'), h('small', {}, ' bis 2/10')), h('div', { class: 'ba-chips' }, arten(e.D))),
      h('p', { class: 'hint' }, 'Die Reihenfolge ist keine Rangfolge – die genannten Arten sind gleichwertig. Reinbestände werden nicht mehr empfohlen.'),
      [...e.B, ...e.C].includes('EI') ? h('p', { class: 'hint' }, eichenHinweis(r.gruppe || r.code)) : null),
    h('div', { class: 'geo-card' },
      h('p', { class: 'geo-kicker' }, 'Mögliche Bestandeszieltypen'),
      h('ul', { class: 'bzt-liste' }, GRUPPEN.map(([k, l]) => h('li', { class: e.bzt[k]?.length ? '' : 'leer' },
        h('strong', {}, l),
        e.bzt[k]?.length ? h('span', {}, e.bzt[k].map((c) => h('span', { class: 'bzt-code', title: bztName(c) }, c)), h('small', {}, e.bzt[k].map(bztName).join(' · ')))
          : h('span', { class: 'muted' }, `keine ${l}-BZT empfohlen`)))),
      e.wald ? h('p', { class: 'muted' }, `Natürliche Waldgesellschaft: ${e.wald}`) : null,
      h('p', { class: 'hint' }, 'Die Wahl des Bestandeszieltyps richtet sich nach deinen Zielen und der Lage vor Ort; die Untergliederung ist keine Rangfolge.')),
    r.andereWE ? h('details', { class: 'bzt-nachbar', open: true }, h('summary', {}, `Klimabereich ${r.klimabereich} am Punkt: Empfehlung aus der Nachbar-Wuchseinheit`),
      h('p', {}, `Das Tabellenwerk führt ${r.klimabereichName} (${r.klimabereich}) für ${r.wuchseinheitName} nicht. In ${r.andereWE.name} (${r.andereWE.wuchseinheit}, ca. ${r.andereWE.abstand.toLocaleString('de-DE')} m entfernt) gilt dafür für ${r.andereWE.code}:`),
      h('p', {}, h('strong', {}, 'Hauptbaumarten: '), r.andereWE.eintrag.B.join(', ') || '–', h('br'), h('strong', {}, 'Mischbaumarten: '), r.andereWE.eintrag.C.join(', ') || '–', h('br'),
        h('strong', {}, 'BZT: '), Object.values(r.andereWE.eintrag.bzt).flat().join(', ') || '–')) : null,
    r.nachbarn?.length ? h('details', { class: 'bzt-nachbar' }, h('summary', {}, `Nahe Grenze zu Klimabereich ${r.nachbarn.map((n) => n.klimabereich).join(', ')} – auch diese Empfehlung prüfen`),
      r.nachbarn.map((n) => h('p', {}, h('strong', {}, `${n.name} (${n.klimabereich}), ca. ${n.abstand.toLocaleString('de-DE')} m entfernt: `), `Hauptbaumarten ${n.eintrag.B.join(', ') || '–'}; Mischbaumarten ${n.eintrag.C.join(', ') || '–'}`))) : null,
    h('div', { class: 'geo-card' },
      h('p', { class: 'geo-kicker' }, 'Standort im Tabellenwerk'),
      h('h4', {}, `${r.code}: ${e.name}`),
      h('dl', { class: 'bestand-schichten' },
        h('div', {}, h('dt', {}, 'Wuchseinheit'), h('dd', {}, r.ersatzWE ? `${r.ersatzWE.name} (${r.ersatzWE.wuchseinheit}), nächstgelegene mit Eintrag` : `${r.wuchseinheitName} (${r.wuchseinheit})`)),
        h('div', {}, h('dt', {}, 'Klimabereich 2041–2070'), h('dd', {}, `${r.klimabereichTabelleName} (${r.klimabereichTabelle})`)),
        e.boden ? h('div', {}, h('dt', {}, 'Häufiger Bodentyp'), h('dd', {}, e.boden)) : null),
      r.ersatzWE ? h('p', { class: 'hint' }, `Die Wuchseinheit ${r.wuchseinheitName} hat für diesen Standort keinen Eintrag. Verwendet wird die nächstgelegene Wuchseinheit mit Eintrag: ${r.ersatzWE.name} (${r.ersatzWE.wuchseinheit}), ca. ${r.ersatzWE.abstand.toLocaleString('de-DE')} m entfernt.`) : null,
      h('p', { class: 'muted' }, `Nährkraft und Wasserhaushalt werden über die Standortseinheit gemeinsam bewertet, dazu das künftige Klima.${trefferText}${r.klimabereichTabelle !== r.klimabereich && r.klimabereich !== '0' ? ` Am Punkt selbst liegt laut Karte Klimabereich ${r.klimabereich}; dafür enthält das Tabellenwerk hier keinen Eintrag.` : ''}`)),
      h('p', { class: 'info-quellen' }, 'Quelle: ThüringenForst, Standortgerechte Baumarten- und Bestandeszieltypenwahl, Tabellenwerk (Anlage 6 DO Waldbau, Juni 2015). Klimabereiche aus der Karte im Anhang A, auf ca. 150 m genau verortet; Wuchseinheiten: Open Data ThüringenForst.')));
}

let standortP = Promise.resolve(null);
/** Wann ist die Fläche befahrbar? Hangneigung × Wasserhaushalt (Standortskarte) × Regen der letzten 30 Tage */
async function wannBefahrbar(a, latlng) {
  const st = await Promise.race([standortP, new Promise((ok) => setTimeout(() => ok(null), 8000))]);
  const e = st ? explainStandort(st) : null;
  const w = e?.d?.wasser ?? null, wechsel = !!e?.d?.wechsel;
  let regen = null;
  try { const { ladeRisiko, bewerte } = await import('./risiko.js'); regen = bewerte(await ladeRisiko([latlng.lat ?? latlng[0], latlng.lng ?? latlng[1]])).regen30; } catch { /* ohne Regen */ }
  const steil = a.anteile[2] + a.anteile[3] + a.anteile[4];
  const nass = w != null && (w >= 4 || wechsel);
  const zeilen = [];
  if (w == null) zeilen.push('Wasserhaushalt unbekannt (keine Standortskartierung erreichbar).');
  else zeilen.push(`Wasserhaushalt laut Standortskarte: ${WASSER_SKALA[Math.max(0, Math.min(5, w))]}${wechsel ? ', wechselfeucht' : ''}.`);
  if (regen != null) zeilen.push(`Regen der letzten 30 Tage: ${Math.round(regen)} mm.`);
  let urteil;
  if (nass) urteil = 'Nur bei Frost oder nach längerer Trockenheit befahren – und nur auf Rückegassen.';
  else if (regen != null && regen > 80) urteil = 'Gerade sehr nass: Befahren möglichst verschieben, bis der Boden abgetrocknet ist.';
  else if (steil > 0.3) urteil = 'Bei trockenem Boden befahrbar; steile Teile nur mit Traktionshilfswinde oder Seil.';
  else urteil = regen != null && regen < 40 ? 'Jetzt gut befahrbar (trocken) – Rückegassen nutzen.' : 'Bei normaler Witterung befahrbar – Rückegassen nutzen, nach Starkregen warten.';
  return h('div', { class: 'geo-card' }, h('p', { class: 'geo-kicker' }, 'Wann befahren?'), h('h4', {}, urteil), zeilen.map((z) => h('p', { class: 'muted' }, z)));
}

/** Hangneigung der Fläche (oder ca. 80 × 80 m um den Punkt) mit Einschätzung der Befahrbarkeit */
function gelaendeBlock(latlng, polys) {
  const lat = latlng.lat ?? latlng[0], lng = latlng.lng ?? latlng[1];
  const flaeche = polys?.length ? polys : (() => { const dl = 40 / 111320, dg = dl / Math.cos(lat * Math.PI / 180); return [[[[lat - dl, lng - dg], [lat - dl, lng + dg], [lat + dl, lng + dg], [lat + dl, lng - dg], [lat - dl, lng - dg]]]]; })();
  const inhalt = h('div', { 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Berechne die Hangneigung …'));
  const block = klapp('gelaende', 'Hangneigung und Befahrbarkeit', inhalt, 'Lädt …');
  analysiereFlaeche(flaeche).then((a) => {
    if (!a) { fill(inhalt, h('p', { class: 'muted' }, 'Die Fläche ist zu klein für eine Auswertung der Hangneigung.')); block.setKurz('Fläche zu klein'); return; }
    const b = befahrbarkeit(a);
    const pct = (x) => `${Math.round(x)} %`;
  const kurzWert = (a) => `Ø ${pct(a.mittel)}, max. ${pct(a.p98)}`;
    fill(inhalt, h('div', { class: 'geo-card' },
      h('p', { class: 'geo-kicker' }, polys?.length ? 'Neigung im Flurstück' : 'Neigung um den angetippten Punkt'),
      h('h4', {}, h('span', { class: `neig-ampel neig-${b.stufe}` }), b.titel),
      h('p', {}, b.text),
      h('div', { class: 'neig-balken', role: 'img', 'aria-label': NEIGUNG.map((k, i) => `${k.name}: ${Math.round(a.anteile[i] * 100)} %`).join(', ') },
        NEIGUNG.map((k, i) => (a.anteile[i] > 0.005 ? h('span', { style: `width:${a.anteile[i] * 100}%;background:${k.hex}`, title: `${k.name}: ${Math.round(a.anteile[i] * 100)} %` }) : null))),
      h('ul', { class: 'neig-liste' }, NEIGUNG.map((k, i) => {
        if (a.anteile[i] < 0.01) return null;
        const gradText = k.bis === Infinity ? `über ${neigGrad(70)}°` : `bis ${neigGrad(k.bis)}°`;
        return h('li', {},
          h('span', { class: 'swatch', style: `background:${k.hex}` }),
          h('span', {}, h('strong', {}, `${k.name} (${gradText})`), ` – ${k.kurz}`),
          h('strong', { class: 'neig-anteil' }, `${Math.round(a.anteile[i] * 100)} %`));
      })),
      h('p', { class: 'geo-facts' }, [`Ø ${pct(a.mittel)} (${neigGrad(a.mittel)}°)`, `max. ${pct(a.p98)} (${neigGrad(a.p98)}°)`, `90 % der Fläche flacher als ${pct(a.p90)}`, a.exposition ? `Hang nach ${a.exposition}` : 'keine deutliche Hangrichtung'].join(' · ')),
      h('details', { class: 'bzt-nachbar' }, h('summary', {}, 'Was bedeuten die Klassen?'),
        h('ul', { class: 'neig-erkl' }, NEIGUNG.map((k) => h('li', {}, h('strong', {}, `${k.name}: `), k.text)))),
      h('p', { class: 'hint' }, 'Berechnet aus einem Geländemodell mit ca. 30 m Auflösung (Terrain Tiles, SRTM/EU-DEM). Kleine Böschungen, Gräben und Felsen erfasst es nicht. Die Klassen sind Faustwerte: Ob und womit befahren werden kann, hängt auch von Boden, Nässe, Hindernissen und der Maschine ab – vor Ort prüfen.')));
    wannBefahrbar(a, latlng).then((el) => inhalt.firstChild?.after(el)).catch(() => {});
    block.setKurz(`${kurzWert(a)} · ${b.titel}${a.exposition ? ` · ${a.exposition}hang` : ''}`);
  }).catch(() => { fill(inhalt, h('p', { class: 'muted' }, 'Die Höhendaten sind gerade nicht erreichbar.')); block.setKurz('nicht erreichbar'); });
  return block;
}

function geoInfoBlock(latlng, parcelId = null, polys = null, achten = null) {
  const lade = (t) => h('p', { class: 'muted' }, t);
  const B = { standort: h('div', { class: 'geo-grid', 'aria-live': 'polite' }, lade('Lade Standort und Bestand …')),
    bzt: h('div', { class: 'geo-grid', 'aria-live': 'polite' }, lade('Lade Baumartenempfehlung …')),
    schutz: h('div', { class: 'geo-grid', 'aria-live': 'polite' }, lade('Lade Schutzstatus und Waldfunktionen …')),
    zust: h('div', { class: 'geo-grid', 'aria-live': 'polite' }, lade('Lade Zuständigkeit …')) };
  if (achten) B.schutz = achten.host;
  const quelle = h('p', { class: 'hint' }, 'Am angetippten Punkt laut Geoportal Thüringen (© GDI-Th / ThüringenForst / TLUBN). Ohne Gewähr – vor Maßnahmen im Zweifel beim Forstamt nachfragen.');
  const K = {
    standort: klapp('standort', 'Standort und Bestand', [B.standort, quelle.cloneNode(true)], 'Lädt …'),
    bzt: klapp('bzt', 'Baumartenempfehlung', B.bzt, 'Lädt …'),
    schutz: achten ? achten.block : klapp('schutz', 'Schutzstatus und Waldfunktionen', [B.schutz, quelle.cloneNode(true)], 'Lädt …'),
    zust: klapp('zust', 'Ansprechpartner', B.zust, 'Lädt …'),
    gelaende: gelaendeBlock(latlng, polys),
  };
  let bztFertig; const bztP = new Promise((ok) => { bztFertig = ok; });
  let standortFertig; standortP = new Promise((ok) => { standortFertig = ok; });
  K.empfehlung = polys?.length && parcelId ? empfehlungBlock(parcelId, polys, latlng, bztP) : null;
  const bestandP = bestandAt([latlng.lat ?? latlng[0], latlng.lng ?? latlng[1]]).catch(() => null);
  queryPoint(latlng).then(async (info) => {
    if (info.failed) throw new Error('offline');
    const b = await bestandP;
    info.rl = revierleiterVon(await ladeRevierleiter(), info.zustaendig);
    const g = renderGeoInfo(info);
    const pf = pflanzungAm([latlng.lat ?? latlng[0], latlng.lng ?? latlng[1]]);
    fill(B.standort, bestandCard(b, parcelId, pf), ...g.standort);
    fill(B.schutz, ...g.schutz);
    fill(B.zust, ...g.zust);
    const kb = (pf ? pf.text : null) || (parcelId ? store.get().bestandKorrektur?.[parcelId]?.haupt?.art : null);
    K.standort.setKurz(`${kb || b ? `${kb || b.art || b.text} · ` : ''}${g.vorschau.standort}`);
    if (achten) { achten.geo = { schutz: info.schutz, funktion: info.funktion }; achten.update?.(); } else K.schutz.setKurz(g.vorschau.schutz);
    K.zust.setKurz(g.vorschau.zust);
    const sp = info.standort || {};
    standortFertig(info.standort || null);
    const einheit = String(sp.Standortseinheiten || '').trim(), gruppe = String(sp.Standortsguppe || sp.Standortsgruppe || '').trim();
    const pt = [latlng.lat ?? latlng[0], latlng.lng ?? latlng[1]];
    if (!einheit && !gruppe) { fill(B.bzt, lade('Am Punkt ist keine Standortskartierung hinterlegt – suche den nächstgelegenen kartierten Standort …')); K.bzt.setKurz('suche nächsten Standort …'); }
    empfehlungMitErsatz(pt, { einheit, gruppe }).then(({ r, ersatz }) => {
      if (!ersatz) {
        if (r.status === 'keinStandort') { bztFertig(null); fill(B.bzt, h('p', { class: 'muted' }, 'Weder am Punkt noch im Umkreis von 2,5 km gibt es einen kartierten Standort mit Eintrag im Tabellenwerk. Frag beim Forstamt nach einer Empfehlung.')); K.bzt.setKurz('keine Empfehlung'); return; }
        fill(B.bzt, bztKarte(r)); K.bzt.setKurz(bztKurz(r)); bztFertig(r); return;
      }
      const st = explainStandort(ersatz.standort);
      const notiz = h('div', { class: 'lrt-hinweis brutzeit' }, h('strong', {}, 'Empfehlung vom nächstgelegenen Standort'),
        h('p', {}, `${ersatz.grund === 'keineKartierung' ? 'Am angetippten Punkt ist keine Standortskartierung hinterlegt.' : `Für die Standortseinheit ${einheit || gruppe} am Punkt enthält das Tabellenwerk keine Empfehlung.`} Verwendet wird der nächste kartierte Standort mit Empfehlung, ca. ${ersatz.abstand.toLocaleString('de-DE')} m in Richtung ${ersatz.richtung}: ${ersatz.einheit || ersatz.gruppe}${st?.desc ? ` (${st.desc})` : ''}. Klimabereich und Wuchseinheit gelten für den angetippten Punkt.`),
        h('p', { class: 'muted' }, 'Ob der Standort vor Ort passt, im Zweifel mit dem Forstamt abstimmen.'));
      bztFertig(r); fill(B.bzt, notiz, bztKarte(r)); K.bzt.setKurz(`nächster Standort (${ersatz.abstand.toLocaleString('de-DE')} m): ${bztKurz(r)}`);
    }).catch(() => { bztFertig(null); fill(B.bzt, h('p', { class: 'muted' }, 'Die Baumartenempfehlung konnte nicht geladen werden.')); K.bzt.setKurz('nicht verfügbar'); });
  }).catch(() => {
    fill(B.standort, h('p', { class: 'hint' }, 'Das Geoportal ist gerade nicht erreichbar. Hier die Rohdaten-Auskunft:'), geoFrame('Forstliche Angaben am Punkt', INFO_SOURCES.forst(latlng), 220));
    fill(B.schutz, h('p', { class: 'hint' }, 'Das Geoportal ist gerade nicht erreichbar. Hier die Rohdaten-Auskunft:'), geoFrame('Schutzgebiete am Punkt', INFO_SOURCES.schutz(latlng), 160));
    fill(B.zust, h('p', { class: 'muted' }, 'Das Geoportal ist gerade nicht erreichbar.'));
    fill(B.bzt, h('p', { class: 'muted' }, 'Ohne Standortskarte (Geoportal nicht erreichbar) ist keine Baumartenempfehlung möglich.'));
    [K.standort, K.bzt, K.zust, ...(achten ? [] : [K.schutz])].forEach((k) => k.setKurz('nicht erreichbar'));
    if (achten) { achten.geo = { fehler: true }; achten.update?.(); }
    bztFertig(null); standortFertig(null);
  });
  return [K.schutz, K.empfehlung, K.standort, K.gelaende, K.bzt, K.zust];
}

/** Bestandsprofil und Handlungsempfehlung für ein Flurstück */
function empfehlungBlock(parcelId, polys, latlng, bztP) {
  const inhalt = h('div', { 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Ermittle Entwicklungsphase und Empfehlungen …'));
  const block = klapp('empfehlung', 'Bestandsprofil und Empfehlung', inhalt, 'Lädt …');
  const pt = [latlng.lat ?? latlng[0], latlng.lng ?? latlng[1]];
  const ring = polys[0][0];
  const daten = Promise.all([bestandInFlaeche(ring, polys).catch(() => null), oberhoeheFlaeche(ring, polys).catch(() => null), bztP]);
  const zeichne = async () => {
    const [b, oh, bzt] = await daten;
    const k = store.get().bestandKorrektur?.[parcelId];
    const pf = pflanzungAm(pt);
    const art = pf?.arten?.[0]?.name || k?.haupt?.art || b?.art || b?.text || '';
    const alter = pf?.alter ?? (k?.haupt ? korrAlter(k.haupt, k.jahr) : null) ?? b?.alter ?? null;
    const einartig = pf ? pf.arten.length === 1 : k?.haupt?.art ? !(k.misch?.art || k.neben?.art)
      : b ? b.anteil >= 0.8 && !(b.weitere || []).some((w) => w.anteil >= 0.1) && !/ mit | und |,/i.test(b.text || '') : false;
    const gewaehlt = store.get().bestandPhase?.[parcelId];
    const ph = gewaehlt ? { phase: gewaehlt, quelle: 'eigen' } : phaseVon({ oberhoehe: oh?.oberhoehe ?? null, alter });
    const df = durchforstungStatus(parcelId, ph.phase, oh?.oberhoehe ?? null);
    fill(inhalt, bestandsprofil({
      phase: ph.phase, quelle: ph.quelle, oberhoehe: oh?.oberhoehe ?? null, alter, art, einartig, bzt, durchforstung: df,
      onPhase: (key) => { store.update((s) => { s.bestandPhase ||= {}; if (key === ph.phase && gewaehlt) delete s.bestandPhase[parcelId]; else s.bestandPhase[parcelId] = key; }); zeichne(); },
      onZiele: zeichne,
      onDurchforstung: async () => { const { openThinningWizard } = await import('./thinning/wizard.js'); window.dispatchEvent(new CustomEvent('ww:navigate', { detail: 'massnahmen' })); openThinningWizard(df?.measureId ? { measureId: df.measureId } : { parcelId }); },
      onMassnahme: (typ, k) => window.dispatchEvent(new CustomEvent('ww:new-measure', { detail: { parcelId, typ, pflegeArt: { kulturpflege: 'sicherung', laeuterung: 'dickung', mischung_dickung: 'dickung' }[k] || null } })),
      onAktion: (a) => { const c = map.getCenter(); if (a === 'gassen') openErschliessungEditor({ center: [c.lat, c.lng], zoom: Math.max(16, map.getZoom()) }); else openPunktEditor({ center: [c.lat, c.lng], zoom: Math.max(16, map.getZoom()), art: a }); },
    }));
    block.setKurz(ph.phase ? `${ENTW_PHASEN[ph.phase].name}${oh ? ` · Oberhöhe ${Math.round(oh.oberhoehe)} m` : ''}${df?.faellig ? ' · Durchforstung fällig' : ''}` : 'Phase wählen');
  };
  zeichne().catch(() => { fill(inhalt, h('p', { class: 'muted' }, 'Das Bestandsprofil konnte nicht ermittelt werden.')); block.setKurz('nicht verfügbar'); });
  return block;
}

/** Das braune „i“: markiert die angetippte Stelle; Antippen springt zur Infobox */
function infoPin(latlng) {
  return L.marker(latlng, {
    icon: L.divIcon({ className: 'info-pin', html: '<span>i</span>', iconSize: [40, 40], iconAnchor: [20, 20] }),
    title: 'Flurstücksinformationen', keyboard: true, zIndexOffset: 1000,
  }).on('click', (e) => { L.DomEvent.stop(e); document.getElementById('infobox')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}

/** Rückfall ohne Vektordaten: amtliche Auskunft des WMS im iframe (braucht kein CORS) */
function renderWmsInfo(latlng) {
  selected = null;
  clearMarks();
  selectionLayer.addLayer(infoPin(latlng));
  const box = document.getElementById('infobox');
  fill(box,
    h('div', { class: 'info-head' },
      h('div', {}, h('p', { class: 'info-kicker' }, 'Auskunft Geoportal Thüringen'), h('h2', {}, 'Flurstück am angetippten Punkt')),
      h('button', { class: 'icon-btn', 'aria-label': 'Infobox schließen', html: icon.close, onclick: clearSelection }),
    ),
    h('iframe', { class: 'wms-info', src: featureInfoUrl(latlng), title: 'Flurstücksauskunft ALKIS', loading: 'lazy', referrerpolicy: 'no-referrer' }),
    h('p', { class: 'hint' }, 'Für diese Stelle liegen in der App noch keine Flurstücksdaten vor. Deshalb kann die Fläche noch nicht zu deinen Flächen hinzugefügt werden. Die Auskunft oben kommt direkt vom Geoportal.'),
    rescueBlock(latlng),
    geoInfoBlock(latlng),
    h('details', { class: 'diag-wrap' }, h('summary', {}, 'Technische Details'), h('pre', { class: 'diag' }, wfsDiagnose.last || String(source.lastError || ''))),
  );
  const wasHidden = box.hidden;
  box.hidden = false;
  box.scrollTop = 0;
  // nicht automatisch zur Infobox scrollen – die Karte bleibt im Blick; das „i“ in der Karte springt hin
}

/** Von außen (Profil-Liste, Suche): zum Flurstück springen und auswählen. */
export async function focusParcel(id) {
  const p = await source.parcelById(id);
  if (!p) return;
  window.dispatchEvent(new CustomEvent('ww:navigate', { detail: 'home' }));
  ALL = await source.allParcels();
  map.fitBounds(L.polygon(p.ring).getBounds(), { padding: [40, 40], maxZoom: 18 });
  await select(p, centroid(p.ring));
}

/** Nächste offene Maßnahme dieser Fläche – ein Tipp öffnet sie */
function naechsteMassnahme(parcelId) {
  const offen = (store.get().measures || []).filter((x) => x.parcelId === parcelId && x.status !== 'fertig' && !x.serie)
    .sort((a, b) => (a.date || 9e15) - (b.date || 9e15));
  if (!offen.length) return null;
  const x = offen[0];
  return h('button', { type: 'button', class: 'naechste-massnahme', onclick: () => window.dispatchEvent(new CustomEvent('ww:massnahme-oeffnen', { detail: x.id })) },
    h('span', { class: 'eyebrow' }, offen.length > 1 ? `Nächste von ${offen.length} offenen Maßnahmen` : 'Offene Maßnahme'),
    h('strong', {}, x.type === 'pflege' && x.details?.art ? x.details.art : MEASURE_TYPES[x.type]?.label || 'Maßnahme'),
    h('small', {}, x.date ? new Date(x.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' }) : 'ohne Termin'),
    h('span', { class: 'chev', html: icon.chevron }));
}

async function renderInfo() {
  const { parcel: p, latlng } = selected;
  const box = document.getElementById('infobox');
  const m = mine(p.id);
  const rescue = await source.nearestRescuePoints(latlng, 2, p);
  const ha = amtlicheFlaecheHa(p);
  const isAlkis = p.source === 'alkis';

  const catChips = (current, onPick) => h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Kategorie' },
    Object.entries(CATEGORIES).map(([k, c]) => h('button', {
      class: 'chip', role: 'radio', 'aria-checked': String(current === k), style: `--chip:${c.color}`,
      onclick: () => onPick(k),
    }, h('span', { class: 'chip-dot' }), c.label)),
  );

  let pick = m?.category || p.nutzung;
  const catSection = m
    ? klapp('kategorie', 'Kategorie ändern', catChips(m.category, (k) => { store.update((s) => { s.parcels.find((x) => x.id === p.id).category = k; }); renderInfo(); }), CATEGORIES[m.category]?.label || '')
    : h('div', { class: 'info-block add-block' },
        h('h3', {}, 'Zu meinen Flächen hinzufügen'),
        (() => {
          const chips = catChips(pick, (k) => { pick = k; chips.querySelectorAll('.chip').forEach((c, i) => c.setAttribute('aria-checked', String(Object.keys(CATEGORIES)[i] === k))); });
          return chips;
        })(),
        h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
          // Geometrie und Sachdaten mitspeichern, damit die Fläche auch offline verfügbar ist
          const e = istProfi() ? eigentuemerVon(p) : null;
          const passend = e && etName(e) ? ordnerListe().find((o) => o.name.toLowerCase() === etName(e).toLowerCase()) : null;
          let ordnerId = istProfi() ? (passend?.id || ordnerFuerNeu()) : null;
          // Rückfrage, wenn die Fläche in einem fremden Ordner landen würde
          if (ordnerId) {
            const w = await dialog({
              title: 'Wohin speichern?',
              body: h('p', {}, `Du arbeitest gerade im Ordner „${ordnerName(ordnerId)}“. Gehört Flurstück ${p.nr} zu diesem Waldbesitzer oder ist es deine eigene Fläche?`),
              actions: [{ label: 'Eigene Fläche', value: 'eigen' }, { label: `In „${ordnerName(ordnerId)}“`, value: 'ordner', primary: true }],
            });
            if (!w) return;
            if (w === 'eigen') ordnerId = null;
          }
          store.update((s) => { s.parcels.push({ ...p, category: pick, addedAt: Date.now(), ordnerId }); });
          if (ordnerId) ordnerEigentuemerAnwenden(ordnerId, [p.id]);
          say(`Flurstück ${p.nr} ist jetzt eine deiner Flächen. Du findest sie in deinem Profil.`);
          renderInfo();
        } }, h('span', { html: icon.plus }), 'Fläche hinzufügen'),
      );

  // Schutzgebiete, Waldfunktionen, Biotope, Verkehrssicherung (und Wanderwege) in einem Reiter:
  // oben eine klare Liste „Das musst du hier beachten“, die Einzelheiten aufklappbar darunter
  const schutzHost = h('div', { class: 'geo-grid', 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Lade Schutzgebiete und Waldfunktionen …'));
  const achtenListe = h('div', { class: 'achten-liste', 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Prüfe Schutzgebiete, Biotope und Pflichten …'));
  const achten = isAlkis ? { host: schutzHost, geo: null, block: klapp('achten', 'Schutz und Auflagen', [
    achtenListe,
    h('details', { class: 'bzt-mehr' }, h('summary', {}, 'Einzelheiten und Quellen'),
      h('h4', { class: 'achten-titel' }, 'Schutzgebiete und Waldfunktionen'), schutzHost,
      h('h4', { class: 'achten-titel' }, istProfi() ? 'Verkehrssicherung, Biotope, Wanderwege' : 'Verkehrssicherung und Biotope'),
      h('div', { id: 'besonderheiten' }, FEAT.has(p.id) ? besonderheitenListe(p) : h('p', { class: 'muted' }, 'Suche Verkehrssicherungspflicht und Biotope …')),
      istProfi() ? wanderwegeTeil(p) : null,
      h('p', { class: 'hint' }, 'Am angetippten Punkt bzw. auf dem Flurstück laut Geoportal Thüringen (© GDI-Th / ThüringenForst / TLUBN). Ohne Gewähr – im Zweifel beim Forstamt nachfragen.'))], 'Wird geprüft …') } : null;
  if (achten) { achten.update = () => achtenZeichnen(p, achten, achtenListe); aktAchten = { id: p.id, a: achten }; }
  fill(box, 
    h('div', { class: 'info-head' },
      h('div', {},
        h('p', { class: 'info-kicker' }, m ? 'Deine Fläche' : 'Flurstück'),
        h('h2', {}, parcelTitle(p)),
      ),
      h('button', { class: 'icon-btn', 'aria-label': 'Infobox schließen', html: icon.close, onclick: clearSelection }),
    ),
    h('dl', { class: 'facts facts-kurz' },
      h('div', {}, h('dt', {}, p.flaecheAmtlich ? 'Größe (amtlich)' : 'Größe'), h('dd', { class: 'big' }, formatHa(ha))),
      h('div', {}, h('dt', {}, 'Gemeinde'), h('dd', {}, isAlkis ? p.gemeinde : `${p.gemeinde}, OT ${p.ortsteil}`)),
      m ? h('div', {}, h('dt', {}, 'Kategorie'), h('dd', {}, h('span', { class: 'kat-punkt', style: `--c:${CATEGORIES[m.category]?.color || '#888'}` }), CATEGORIES[m.category]?.label || '–')) : null,
      p.lage ? h('div', { class: 'wide' }, h('dt', {}, 'Lage'), h('dd', {}, p.lage)) : null,
      p.nutzungText ? h('div', { class: 'wide' }, h('dt', {}, 'Nutzung (ALKIS)'), h('dd', {}, p.nutzungText)) : null,
      p.standort ? h('div', { class: 'wide' }, h('dt', {}, 'Standort'), h('dd', {}, p.standort)) : null,
    ),
    m ? h('div', { class: 'info-actions info-actions-oben' },
      h('button', { class: 'btn btn-primary', onclick: () => window.dispatchEvent(new CustomEvent('ww:new-measure', { detail: { parcelId: p.id } })) }, 'Maßnahme planen'),
      h('div', { class: 'info-mehr' },
        h('button', { class: 'btn btn-small', onclick: () => import('./historie.js').then((x) => x.openHistorieFlurstueck(p.id)) }, 'Flurstückhistorie'),
        h('button', { class: 'btn btn-small', onclick: () => import('./grenzfinder.js').then((x) => x.openNavigation({ titel: `Grenzfinder · Flst. ${p.nr}`, parcel: p })) }, 'Grenze finden'),
        h('button', { class: 'btn btn-small', onclick: () => import('./schaden.js').then((x) => x.openSchadensmeldung({ parcelId: p.id })) }, 'Schaden melden'),
        h('button', { class: 'btn btn-small', onclick: () => import('./schaden.js').then((x) => x.openHolzVerkaufen({ parcelId: p.id })) }, 'Holz verkaufen')),
      h('button', { class: 'btn btn-danger-ghost', onclick: () => removeParcel(p.id) }, h('span', { html: icon.trash }), 'Entfernen'),
    ) : null,
    naechsteMassnahme(p.id),
    catSection,
    istProfi() && m ? ordnerAuswahl(m, { beiAenderung: () => renderInfo() }) : null,
    // Ohne Profimodus: Fläche liegt noch in einem Ordner (aus dem Profimodus) → mit einem Tipp zu den eigenen Flächen
    !istProfi() && m?.ordnerId ? h('div', { class: 'lrt-hinweis' }, h('p', {}, `Diese Fläche liegt im Ordner „${ordnerName(m.ordnerId)}“ und wird deshalb außerhalb des Profimodus in der Karte nicht angezeigt.`),
      h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => { store.update((st) => { const x = st.parcels.find((y) => y.id === m.id); if (x) x.ordnerId = null; }); toast('Zu deinen eigenen Flächen verschoben'); renderInfo(); } }, 'Zu meinen eigenen Flächen')) : null,
    istProfi() ? eigentuemerBlock(p) : null,
    isAlkis ? rescueBlock(latlng) : null,
    isAlkis ? geoInfoBlock(latlng, p.id, polysOf(p), achten) : null,
    isAlkis ? null : h('div', { class: 'info-block' },
      h('h3', {}, 'Nächste Rettungspunkte'),
      h('ul', { class: 'rescue-list' }, rescue.map((rp) => h('li', { class: 'rescue' },
        h('div', { class: 'rescue-head' }, h('span', { class: 'rescue-badge', 'aria-hidden': 'true' }, '+'), h('strong', {}, rp.id), h('span', { class: 'rescue-dist' }, formatDist(rp.dist))),
        h('p', {}, rp.access),
        h('div', { class: 'rescue-actions' },
          h('a', { class: 'btn btn-small', href: `https://www.google.com/maps/dir/?api=1&destination=${rp.at[0]},${rp.at[1]}`, target: '_blank', rel: 'noopener' }, h('span', { html: icon.nav }), 'Google Maps'),
          h('a', { class: 'btn btn-small', href: `https://maps.apple.com/?daddr=${rp.at[0]},${rp.at[1]}&dirflg=d`, target: '_blank', rel: 'noopener' }, h('span', { html: icon.nav }), 'Apple Karten'),
        ),
      ))),
      rescue.length ? h('p', { class: 'hint' }, 'Demo-Rettungspunkte. Im Notfall immer 112 wählen und die Rettungspunkt-Nummer nennen.') : null,
    ),
    isAlkis ? null : h('div', { class: 'info-block' },
      h('h3', {}, 'Besonderheiten'),
      p.features?.length
        ? h('ul', { class: 'feature-list' }, p.features.map((f) => h('li', { class: `feature feature-${f.type}` },
            h('span', { class: 'feature-type' }, FEATURE_TYPES[f.type]),
            h('strong', {}, f.title),
            h('p', {}, f.text),
          )))
        : h('p', { class: 'muted' }, isAlkis
          ? 'Schutzgebiete, Biotope, Waldfunktionen und Verkehrssicherung sind für echte Flurstücke noch nicht angebunden.'
          : 'Für dieses Flurstück sind keine Schutzgebiete, Biotope oder Pflichten hinterlegt.'),
      isAlkis ? h('p', { class: 'hint' }, 'Flurstücksdaten: ALKIS, © GDI-Th. Keine amtliche Auskunft.') : null,
    ),
    h('p', { class: 'info-quellen' }, isAlkis
      ? 'Flurstücksdaten: ALKIS, © GDI-Th. Standort, Bestand, Waldfunktionen, Rettungspunkte: © GDI-Th / ThüringenForst. Keine amtliche Auskunft.'
      : 'Demo-Daten. Keine amtliche Auskunft.'),
  );
  const wasHidden = box.hidden;
  box.hidden = false;
  box.scrollTop = 0;
  // nicht automatisch zur Infobox scrollen – die Karte bleibt im Blick; das „i“ in der Karte springt hin
}

export async function removeParcel(id) {
  const ok = await confirmDialog('Möchtest du diese Fläche wirklich löschen?', { ok: 'Löschen', danger: true, body: 'Die Fläche wird aus deiner Liste entfernt. Geplante Maßnahmen bleiben erhalten.' });
  if (!ok) return false;
  store.update((s) => { s.parcels = s.parcels.filter((p) => p.id !== id); });
  toast('Fläche gelöscht');
  if (selected?.parcel.id === id) renderInfo();
  return true;
}

// Gemarkungsnamen aus den mitgelieferten ALKIS-Daten (data/alkis/index.json) für Vorschläge
let GEMARKUNGEN = null;
const gemNorm = (t) => String(t || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
async function gemarkungsListe() {
  if (!GEMARKUNGEN) {
    const idx = await localIndexInfo().catch(() => null);
    GEMARKUNGEN = [...new Set([...Object.keys(idx?.gemarkungen || {}), ...source.gemarkungen()])].sort((a, b) => a.localeCompare(b, 'de'));
  }
  return GEMARKUNGEN;
}
export function gemarkungVorschlaege(eingabe, alle, max = 8) {
  const q = gemNorm(eingabe);
  if (!q) return [];
  const rang = (g) => { const n = gemNorm(g); if (n === q) return 0; if (n.startsWith(q)) return 1; if (n.split(' ').some((w) => w.startsWith(q))) return 2; if (n.includes(q)) return 3; return 9; };
  return alle.map((g) => [rang(g), g]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1], 'de')).slice(0, max).map(([, g]) => g);
}
/** Eingabefeld Gemarkung mit Vorschlagsliste */
function gemarkungFeld() {
  const liste = h('ul', { class: 'vorschlaege', role: 'listbox', hidden: true });
  let aktiv = -1, treffer = [];
  const waehle = (g) => { input.value = g; liste.hidden = true; input.setAttribute('aria-expanded', 'false'); input.closest('form')?.querySelector('[name=flur]')?.focus(); };
  const zeige = async () => {
    treffer = gemarkungVorschlaege(input.value, await gemarkungsListe());
    aktiv = -1;
    const exakt = treffer.length === 1 && gemNorm(treffer[0]) === gemNorm(input.value);
    liste.hidden = !treffer.length || exakt;
    input.setAttribute('aria-expanded', String(!liste.hidden));
    fill(liste, treffer.map((g, i) => h('li', { role: 'option', id: `gem-v-${i}` },
      h('button', { type: 'button', tabindex: -1, onmousedown: (e) => e.preventDefault(), onclick: () => waehle(g) }, g))));
  };
  const input = h('input', { name: 'gemarkung', autocomplete: 'off', placeholder: 'z. B. Manebach', required: true, role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false',
    oninput: zeige, onfocus: () => { if (input.value) zeige(); }, onblur: () => setTimeout(() => { liste.hidden = true; }, 150),
    onkeydown: (e) => {
      if (liste.hidden || !treffer.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); aktiv = (aktiv + (e.key === 'ArrowDown' ? 1 : -1) + treffer.length) % treffer.length; [...liste.children].forEach((li, i) => li.classList.toggle('aktiv', i === aktiv)); input.setAttribute('aria-activedescendant', `gem-v-${aktiv}`); }
      else if (e.key === 'Enter' && aktiv >= 0) { e.preventDefault(); waehle(treffer[aktiv]); }
      else if (e.key === 'Escape') { liste.hidden = true; }
    } });
  gemarkungsListe();
  return h('label', { class: 'gem-feld' }, 'Gemarkung', h('div', { class: 'vorschlag-wrap' }, input, liste));
}

function openSearch() {
  // Direkt die Kataster-Suche; eigene Flächen werden farbig hervorgehoben.
  // Als ganze Seite: die Felder stehen oben und werden von der Tastatur nicht verdeckt.
  let seite = null;
  const meine = () => new Map(store.get().parcels.filter(passtFlurstueck).map((x) => [x.id, x]));
  const zeile = (p, eigen) => {
    const kat = eigen ? CATEGORIES[eigen.category] : null;
    return h('li', {}, h('button', { class: `result ${eigen ? 'result-eigen' : ''}`, type: 'button', style: kat ? `--kat:${kat.color}` : null,
      onclick: () => { seite?.close(); focusParcel(p.id); } },
      h('span', { class: 'result-kopf' }, h('strong', {}, `Flurstück ${p.nr}`), eigen ? h('span', { class: 'result-marke' }, h('span', { class: 'kat-punkt', style: `--c:${kat?.color || '#888'}` }), `Meine Fläche · ${kat?.label || ''}`) : null),
      h('span', {}, `${p.gemarkung}, Flur ${p.flur}${amtlicheFlaecheHa(p) ? `, ${formatHa(amtlicheFlaecheHa(p))}` : ''}${p.lage ? `, ${p.lage}` : ''}`)));
  };
  const eigeneListe = h('ul', { class: 'search-results' });
  const results = h('ul', { class: 'search-results', 'aria-live': 'polite' });
  // Eigene Flächen, die zur Eingabe passen – sofort, ohne Netz
  const eigeneZeigen = (ohne = new Set()) => {
    const fd = new FormData(form);
    const g = gemNorm(String(fd.get('gemarkung') || '')), fl = String(fd.get('flur') || '').trim().replace(/^0+(?=\d)/, ''), nr = String(fd.get('nr') || '').trim();
    if (!g && !nr) { fill(eigeneListe); return; }
    const m = meine();
    const t = [...m.values()].filter((x) => !ohne.has(x.id) && (!g || gemNorm(x.gemarkung || '').startsWith(g)) && (!fl || String(x.flur || '').replace(/^0+(?=\d)/, '') === fl) && (!nr || String(x.nr || '').startsWith(nr))).slice(0, 20);
    fill(eigeneListe, t.length ? [h('li', { class: 'such-zwischen' }, 'Deine Flächen'), ...t.map((x) => zeile(x, x))] : []);
  };
  const form = h('form', { class: 'form', oninput: () => eigeneZeigen(), onsubmit: async (e) => {
    e.preventDefault();
    document.activeElement?.blur?.(); // Tastatur zu, damit die Treffer zu sehen sind
    const fd = new FormData(form);
    const q = { gemarkung: String(fd.get('gemarkung') || '').trim(), flur: String(fd.get('flur') || '').trim(), nr: String(fd.get('nr') || '').trim() };
    if (!q.gemarkung || !q.nr) { fill(results, h('li', { class: 'muted' }, 'Gib mindestens Gemarkung und Flurstücksnummer an.')); return; }
    fill(results, h('li', { class: 'muted' }, 'Suche im Liegenschaftskataster …'));
    let list;
    try { list = await source.search(q); } catch {
      fill(results, h('li', { class: 'muted' }, 'Das Geoportal Thüringen ist gerade nicht erreichbar. Deine eigenen Flächen siehst du oben; andere Flurstücke kannst du in der Karte antippen.'));
      return;
    }
    const m = meine();
    // eigene Flächen zuerst und farbig
    list = [...list].sort((x, y) => (m.has(y.id) - m.has(x.id)));
    eigeneZeigen(new Set(list.map((x) => x.id)));
    fill(results, ...(list.length
      ? [h('li', { class: 'such-zwischen' }, `${list.length} ${list.length === 1 ? 'Treffer' : 'Treffer'} im Kataster`), ...list.slice(0, 30).map((p) => zeile(p, m.get(p.id)))]
      : [h('li', { class: 'muted' }, 'Kein Flurstück gefunden. Prüfe Gemarkung, Flur und Nummer.')]));
  } },
    gemarkungFeld(),
    h('div', { class: 'form-row' },
      h('label', {}, 'Flur', h('input', { name: 'flur', inputmode: 'numeric', placeholder: 'z. B. 4' })),
      h('label', {}, 'Flurstück', h('input', { name: 'nr', placeholder: '112 oder 112/2', enterkeyhint: 'search' })),
    ),
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, h('span', { html: icon.search }), 'Im Kataster suchen'),
  );
  seite = openPage('Flurstück suchen', h('div', { class: 'such-seite' }, form, eigeneListe, results,
    h('p', { class: 'hint' }, 'Daten aus dem Liegenschaftskataster Thüringen (ALKIS, © GDI-Th). Deine eigenen Flächen sind farbig markiert.')));
  setTimeout(() => seite.el.querySelector('input[name=gemarkung]')?.focus(), 250);
  seite.el.addEventListener('focusin', (e) => { if (e.target.matches('input')) setTimeout(() => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300); });
}

function openLegend(key) {
  const info = LAYER_INFO[key];
  const legends = legendUrls(key);
  dialog({
    title: info.title,
    body: h('div', { class: 'legend-box' },
      h('p', {}, info.text),
      legends.length ? h('p', { class: 'sheet-label' }, 'Legende') : null,
      info.neigung ? h('ul', { class: 'legend-swatches neig-legende' }, NEIGUNG.map((k) => h('li', {}, h('span', { class: 'swatch', style: `background:${k.hex}` }), h('span', {}, h('strong', {}, `${k.name} (${k.bis === Infinity ? `über ${neigGrad(70)}°` : `bis ${neigGrad(k.bis)}°`}) – ${k.kurz}`), h('br'), h('small', {}, k.text))))) : null,
      info.farben ? h('ul', { class: 'legend-swatches' }, Object.entries(BAUMARTEN_FARBEN).map(([t, c]) => h('li', {}, h('span', { class: 'swatch', style: `background:${c}` }), t))) : null,
      info.farben ? h('p', { class: 'hint' }, 'Farben nach dem QGIS-Stil von ThüringenForst. Quelle: Thüringer Waldverzeichnis, © GDI-Th, dl-de/by-2-0.') : null,
      legends.map((l) => h('img', { class: 'legend-img', src: l.src, alt: `Legende ${l.layer}`, loading: 'lazy',
        onerror: (e) => { e.target.replaceWith(h('p', { class: 'hint' }, 'Legende gerade nicht abrufbar.')); } })),
    ),
    actions: [{ label: 'Schließen', value: true, primary: true }],
  });
}

function openLayerSheet() {
  const s = store.get().settings;
  const sw = (key, label, { color, disabled, note, onchange } = {}) => h('div', { class: `layer-row ${disabled ? 'disabled' : ''}` },
    LAYER_INFO[key] ? h('button', { class: 'legend-i', type: 'button', 'aria-label': `Legende und Erklärung: ${label}`, onclick: () => openLegend(key) }, 'i') : h('span', { class: 'legend-i-space' }),
    h('label', { class: 'switch-row' },
      color ? h('span', { class: 'swatch', style: `background:${color}` }) : null,
      h('span', { class: 'switch-label' }, label, note ? h('small', {}, note) : null),
      h('input', { type: 'checkbox', role: 'switch', disabled, checked: !disabled && !!s.layers[key], onchange: onchange || ((e) => {
        store.update((st) => { st.settings.layers[key] = e.target.checked; });
      }) }),
    ),
  );
  const groups = [...new Set(OVERLAYS.map((o) => o.group))];
  const box = (titel, ...inhalt) => h('section', { class: 'layer-box' }, h('h3', { class: 'layer-box-titel' }, titel), inhalt);
  const punktBearbeiten = (art, label) => h('button', { class: 'btn btn-block', onclick: () => { document.querySelector('.scrim:not(.closing)')?.click(); const c = map.getCenter(); openPunktEditor({ center: [c.lat, c.lng], zoom: Math.max(16, map.getZoom()), art }); } }, label);
  // Voreinstellungen: ein Tipp schaltet passende Ebenen an und die übrigen Fachebenen aus
  const FACH = ['flurnummern', 'grenzpunkte', 'rettung', 'baumarten', 'standort', 'waldfunktionen', 'schaden', 'schutz', 'natura', 'lrt', 'waldbiotope', 'biotope', 'gassen', 'lager', 'hangneigung', 'habitat', 'jagd', 'fotopunkte', 'wegeAmtlich'];
  const SETS = [
    ['einfach', 'Einfach', 'Flurstücke und eigene Flächen', ['fotopunkte']],
    ['natur', 'Naturschutz', 'Schutzgebiete, Biotope, Habitatbäume', ['schutz', 'natura', 'lrt', 'waldbiotope', 'biotope', 'habitat']],
    ['holz', 'Holzernte', 'Wege, Gassen, Lager, Hangneigung, Rettung', ['wegeAmtlich', 'gassen', 'lager', 'hangneigung', 'rettung']],
    ['wald', 'Waldinfo', 'Baumarten, Standort, Waldfunktionen', ['baumarten', 'standort', 'waldfunktionen', 'schaden']],
  ];
  const aktivSet = () => SETS.find(([, , , an]) => FACH.every((k) => !!s.layers[k] === an.includes(k)))?.[0];
  const setWahl = h('div', { class: 'layer-sets', role: 'radiogroup', 'aria-label': 'Voreinstellung' }, SETS.map(([k, l, t, an]) => h('button', { type: 'button', role: 'radio', class: 'layer-set', 'aria-checked': String(aktivSet() === k),
    onclick: () => {
      store.update((st) => { for (const f of FACH) st.settings.layers[f] = an.includes(f); st.settings.layers.alkis = true; });
      base.setAlkis(true);
      document.querySelector('.scrim:not(.closing)')?.click();
      toast(`Ansicht „${l}“`);
    } }, h('strong', {}, l), h('small', {}, t))));
  dialog({
    title: 'Ebenen',
    body: h('div', { class: 'layer-sheet' },
      setWahl,
      h('p', { class: 'sheet-label' }, 'Oder einzeln wählen'),
      box('Flurstücke',
        sw('alkis', 'Flurstücksgrenzen (ALKIS)', { color: '#F6D32D', note: 'ab Zoomstufe 14', onchange: (e) => {
          store.update((st) => { st.settings.layers.alkis = e.target.checked; });
          base.setAlkis(e.target.checked);
        } }),
        sw('flurnummern', 'Flurstücksnummern', { note: 'ab Zoomstufe 16' }),
        OVERLAYS.filter((o) => o.group === 'Flurstücke').map((o) => sw(o.key, o.label, { note: o.note }))),
      box('Erschließung',
        sw('wegeAmtlich', 'Wege (Geoportal Thüringen)', { color: '#C0392B', note: 'Straßen und Fahrwege aus ATKIS, Erholungswege von ThüringenForst' }),
        sw('gassen', 'Rückegassen', { color: '#8D5A2B' }),
        sw('lager', 'Lagerplätze (Polterplätze)', { color: '#B5651D' }),
        h('button', { class: 'btn btn-block', onclick: () => { document.querySelector('.scrim:not(.closing)')?.click(); const c = map.getCenter(); openErschliessungEditor({ center: [c.lat, c.lng], zoom: Math.max(16, map.getZoom()) }); } }, 'Rückegassen und Lagerplätze bearbeiten')),
      box('Fotopunkte',
        sw('fotopunkte', 'Fotopunkte (aus der Flurstückhistorie)', { color: FOTOPUNKT_FARBE, note: 'mit Blickrichtung' })),
      box('Gelände',
        sw('hangneigung', 'Hangneigung und Befahrbarkeit', { note: 'ab Zoomstufe 12' })),
      groups.filter((g) => g !== 'Flurstücke').map((g) => box(g,
        OVERLAYS.filter((o) => o.group === g).map((o) => sw(o.key, o.label, { disabled: o.pending, note: o.pending ? 'wird gerade angebunden' : null })),
        g === 'Naturschutz' ? [
          sw('habitat', 'Habitatbäume (stehend / liegend)', { color: HABITAT_FARBE }),
          punktBearbeiten('habitat', 'Habitatbäume bearbeiten'),
        ] : null)),
      box('Jagd',
        sw('jagd', 'Jagdliche Einrichtungen', { color: JAGD_FARBE, note: 'Kanzel, Drückjagdbock, Erdsitz' }),
        punktBearbeiten('jagd', 'Jagdliche Einrichtungen bearbeiten')),
      h('p', { class: 'hint' }, 'Quellen: Geoportal Thüringen (© GDI-Th, dl-de/by-2-0), ThüringenForst, TLUBN, OpenStreetMap. Fachebenen erscheinen je nach Dienst erst ab einer bestimmten Zoomstufe.'),
    ),
    actions: [{ label: 'Fertig', value: true, primary: true }],
  });
}

// ---------- Live-Standort mit Blickrichtung ----------
// Zustände: aus → folgen (Karte läuft mit) → an (verfolgt, Karte frei verschiebbar) → Tipp: wieder folgen; Tipp beim Folgen: aus
let ortung = 'aus', ortWatch = null, ortLetzte = null, ortKreis = null, kompass = false, blickRaf = 0, blickGrad = null, ortFehlerGemeldet = false;
const ORTUNG_LABEL = { aus: 'Mein Standort live verfolgen', folgen: 'Standortverfolgung beenden', an: 'Karte wieder auf meinen Standort ausrichten' };
function ortBtn() {
  document.querySelectorAll('.ortung-btn').forEach((b) => {
    b.classList.remove('ortung-aus', 'ortung-folgen', 'ortung-an'); b.classList.add(`ortung-${ortung}`);
    b.setAttribute('aria-pressed', String(ortung !== 'aus')); b.setAttribute('aria-label', ORTUNG_LABEL[ortung]); b.title = ORTUNG_LABEL[ortung];
  });
}
function ortungKlick() {
  if (!('geolocation' in navigator)) { toast('Dein Browser kann keinen Standort bestimmen.'); return; }
  if (ortung === 'aus') { ortung = 'folgen'; ortStart(); kompassStart(); toast('Standort wird live verfolgt – erneut tippen beendet.'); }
  else if (ortung === 'an') { ortung = 'folgen'; if (ortLetzte) map.flyTo(ortLetzte, Math.max(map.getZoom(), 17)); }
  else { ortung = 'aus'; ortStop(); }
  ortBtn();
}
function ortStart() {
  ortFehlerGemeldet = false;
    ortWatch = navigator.geolocation.watchPosition(ortPos, (err) => {
    if (err.code === 1) { toast('Standort freigeben: in den Browser-Einstellungen für diese Seite erlauben.'); ortung = 'aus'; ortStop(); ortBtn(); return; }
    if (!ortFehlerGemeldet) { ortFehlerGemeldet = true; toast('Standort gerade ungenau oder nicht verfügbar – es wird weiter gesucht.'); }
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
function ortStop() {
  if (ortWatch != null) navigator.geolocation.clearWatch(ortWatch);
  ortWatch = null; ortLetzte = null;
  posMarker?.remove(); posMarker = null; ortKreis?.remove(); ortKreis = null;
  window.removeEventListener('deviceorientationabsolute', ortKompass); window.removeEventListener('deviceorientation', ortKompass);
  kompass = false; blickGrad = null;
}
function ortPos(pos) {
  const ll = [pos.coords.latitude, pos.coords.longitude];
  const erstes = !ortLetzte;
  ortLetzte = ll;
  const acc = pos.coords.accuracy || 0;
  if (!posMarker || !map.hasLayer(posMarker)) {
    posMarker = L.marker(ll, { interactive: false, zIndexOffset: 1000, keyboard: false,
      icon: L.divIcon({ className: 'me', html: '<span class="me-dot"></span><span class="me-cone"></span>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(map);
    ortKreis = L.circle(ll, { radius: acc, color: '#1F74B8', weight: 1, opacity: 0.5, fillColor: '#1F74B8', fillOpacity: 0.08, interactive: false }).addTo(map);
    if (blickGrad != null) blickZeigen(blickGrad);
  } else { posMarker.setLatLng(ll); ortKreis.setLatLng(ll).setRadius(acc); }
  // ohne Kompass: Bewegungsrichtung aus dem GPS, wenn man geht
  if (!kompass && pos.coords.heading != null && !Number.isNaN(pos.coords.heading) && (pos.coords.speed || 0) > 0.7) blickZeigen(pos.coords.heading);
  if (ortung === 'folgen') {
    if (erstes) map.flyTo(ll, Math.max(map.getZoom(), 17));
    else if (!map.getBounds().pad(-0.25).contains(ll)) map.panTo(ll, { animate: true });
  }
}
function blickZeigen(grad) {
  blickGrad = grad;
  if (blickRaf) return;
  blickRaf = requestAnimationFrame(() => {
    blickRaf = 0;
    const cone = posMarker?.getElement()?.querySelector('.me-cone');
    if (cone) { cone.style.transform = `rotate(${blickGrad}deg)`; cone.style.opacity = 1; }
  });
}
async function kompassStart() {
  try {
    // iPhone: Erlaubnis muss im Tipp erfragt werden
    // iPhone und neuere Chrome-Versionen fragen um Erlaubnis; ohne Zusage kommen einfach keine Kompassdaten
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
      if (r !== 'granted') toast('Ohne Kompass-Freigabe zeigt der Pfeil die Laufrichtung (beim Gehen).');
    }
    window.addEventListener('deviceorientationabsolute', ortKompass);
    window.addEventListener('deviceorientation', ortKompass);
  } catch { /* kein Kompass */ }
}
function ortKompass(e) {
  let hd = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null);
  if (hd == null) return;
  kompass = true;
  // Querformat: Bildschirmdrehung ausgleichen
  hd = (hd + (screen.orientation?.angle ?? window.orientation ?? 0) + 360) % 360;
  blickZeigen(hd);
}
