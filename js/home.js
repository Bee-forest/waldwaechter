// Reiter 1: Startseite mit Karte, Flurstücksauswahl und Infobox.
/* global L */
import { h, fill, icon, dialog, confirmDialog, toast } from './ui.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { createBaseMap, createOsmFeatureLayer, CATEGORIES, BASEMAP_LABELS } from './map/basemap.js';
import { areaHa, formatHa, formatDist, centroid, compassLabel, polysOf } from './geo.js';
import { WANZE_SVG, say } from './mascot.js';
import { wfsDiagnose, ALKIS_MIN_ZOOM, featureInfoUrl, OVERLAYS, overlayLayer, INFO_SOURCES, nearestRescue, LAYER_INFO, legendUrls, amtlicheFlaecheHa, localIndexInfo } from './map/thueringen.js';
import { openProfile } from './profile.js';
import { besonderheiten } from './map/besonderheiten.js';
import { lrtCode, lrtHinweis, lrtWichtig, biotopWichtig } from './map/lrt.js';
import { zeigeVerordnung } from './schutzgebiete.js';
import { BAUMARTEN_FARBEN } from './map/baumartenkarte.js';
import { erinnereVerkehrssicherung, hatVerkehrssicherung } from './measures.js';
import { bestandAt } from './map/bestand.js';
import { queryPoint, explainStandort, NAEHRKRAFT, WASSER_SKALA, umlaut } from './map/geoinfo.js';

export const FEATURE_TYPES = {
  nsg: 'Naturschutz',
  biotop: 'Geschütztes Biotop',
  waldfunktion: 'Waldfunktion',
  vsp: 'Verkehrssicherungspflicht',
  punktbiotop: 'Punktbiotop',
};

let base, map, osmLayer;
const catGroups = {};
let allParcelsLayer, infoLayer, rescueLayer, selectionLayer, posMarker;
const overlays = {};
let selected = null; // { parcel, latlng }
let rescueMarkers = null;
/** Entfernt alles, was zur vorherigen Auswahl gehört (Umriss, „i“, Rettungspunkt-Linie) */
function clearMarks() { selectionLayer?.clearLayers(); rescueMarkers?.remove(); rescueMarkers = null; }
let ALL = [];
const FEAT = new Map(); // Besonderheiten je Flurstück (Sitzung)
const featuresOf = (p) => FEAT.get(p.id) || p.features || [];

const mine = (id) => store.get().parcels.find((p) => p.id === id);
export const parcelTitle = (p) => `${p.gemarkung}, Flur ${p.flur}, Flurstück ${p.nr}`;

/** Inhalt des WaldWächter-Kopfs (Logo, Titel, Profil) – auch auf der Maßnahmen-Seite */
export function kopfInhalt() {
  const pr = store.get().profile;
  const initials = (pr.name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  return [
    h('img', { class: 'app-logo', src: 'img/logo.svg', alt: 'WaldWächter-Logo' }),
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
  ];
}

export async function initHome(root) {
  const s = store.get().settings;
  const mapEl = h('div', { id: 'map', class: 'map', 'aria-label': 'Karte' });
  const info = h('section', { id: 'infobox', class: 'infobox', 'aria-live': 'polite', hidden: true });

  const head = h('header', { class: 'card app-head' });
  const chips = h('div', { class: 'cat-chips', role: 'group', 'aria-label': 'Kategorien ein- und ausblenden' });
  const baseSwitch = h('div', { class: 'segmented compact', role: 'radiogroup', 'aria-label': 'Basiskarte' });
  root.append(
    head,
    h('section', { class: 'card map-card', 'aria-label': 'Karte Thüringen' },
      h('div', { class: 'map-card-head' },
        h('h2', {}, 'Karte Thüringen'),
        baseSwitch,
        h('p', { class: 'muted' }, 'ALKIS-Flurstücke, Standortkarte, Rettungspunkte, Schutzgebiete, Natura 2000 und Biotope/LRT'),
      ),
      h('div', { class: 'map-wrap' },
        mapEl,
        h('div', { class: 'map-side' },
          h('button', { class: 'fab small', 'aria-label': 'Flurstück suchen', html: icon.search, onclick: openSearch }),
          h('button', { class: 'fab small', 'aria-label': 'Mein Standort', html: icon.locate, onclick: locateMe }),
        ),
      ),
      h('div', { class: 'map-actions' },
        h('button', { class: 'pill-btn', onclick: openLayerSheet }, 'Weitere Layer', h('span', { class: 'plus' }, '+')),
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
  base = createBaseMap(mapEl, { center: view.c, zoom: view.z, basemap: s.basemap, alkis: s.layers.alkis !== false });
  map = base.map;
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Hineinzoomen', zoomOutTitle: 'Herauszoomen' }).addTo(map);
  renderBaseSwitch();
  // Fachebenen (Standortkarte, Schutzgebiete, …)
  for (const o of OVERLAYS) if (!o.pending) overlays[o.key] = overlayLayer(o);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  map.on('moveend', () => {
    try { const c = map.getCenter(); localStorage.setItem('waldwaechter.view', JSON.stringify({ c: [c.lat, c.lng], z: map.getZoom() })); } catch { /* egal */ }
  });
  const updateZoomHint = () => { zoomHint.hidden = map.getZoom() >= ALKIS_MIN_ZOOM || store.get().settings.layers.alkis === false; };
  map.on('zoomend', updateZoomHint);
  store.subscribe(updateZoomHint);
  updateZoomHint();

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
    const p = await source.parcelAt(latlng);
    marker.remove();
    if (ticket !== busy) return; // inzwischen erneut getippt
    if (p) { ALL = await source.allParcels(); select(p, latlng); return; }
    clearSelection();
    if (source.lastError && map.getZoom() >= ALKIS_MIN_ZOOM - 1) {
      renderWmsInfo(latlng);
    } else if (map.getZoom() < ALKIS_MIN_ZOOM) toast('Zoom näher heran, um ein Flurstück anzutippen.');
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
    if (m) {
      const c = CATEGORIES[m.category] || CATEGORIES.Wald;
      catGroups[m.category]?.addLayer(L.polygon(polysOf(p), { color: c.color, weight: 2, fillColor: c.color, fillOpacity: 0.38, interactive: false }));
    } else if (p.source !== 'alkis') { // ALKIS-Grenzen zeigt bereits der WMS
      allParcelsLayer.addLayer(L.polygon(polysOf(p), { color: '#3B4A40', weight: 1, dashArray: '4 4', fillOpacity: 0, interactive: false, className: 'parcel-outline' }));
    }
    if (m || selected?.parcel.id === p.id) addInfoPoints(p);
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
  say(`${f.title}${extra}: ${f.text}`, { duration: 0, actions: actions.length ? actions : undefined });
}

export function applyLayerVisibility() {
  const { layers } = store.get().settings;
  for (const [k, g] of Object.entries(catGroups)) {
    if (layers[k]) { if (!map.hasLayer(g)) g.addTo(map); } else map.removeLayer(g);
  }
  if (layers.info) { if (!map.hasLayer(infoLayer)) infoLayer.addTo(map); } else map.removeLayer(infoLayer);
  for (const [k, l] of Object.entries(overlays)) {
    if (layers[k]) { if (!map.hasLayer(l)) l.addTo(map); } else map.removeLayer(l);
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
  });
}

function besonderheitenListe(p) {
  const f = featuresOf(p);
  if (!f.length) return [h('p', { class: 'muted' }, 'Keine Verkehrssicherungspflicht und keine kartierten Biotope auf diesem Flurstück gefunden.')];
  const gruppen = {};
  for (const x of f) (gruppen[x.type] ||= []).push(x);
  return [h('ul', { class: 'feature-list' }, Object.entries(gruppen).map(([t, list]) => h('li', { class: `feature feature-${t}` },
    h('span', { class: 'feature-type' }, FEATURE_TYPES[t] || list[0].title),
    h('strong', {}, list.length > 1 ? `${list.length} Stellen auf der Karte` : list[0].title),
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
      st.tips.length ? h('div', { class: 'geo-tips' }, h('strong', {}, 'Was heißt das für dich?'), h('ul', {}, st.tips.map((t) => h('li', {}, t)))) : null,
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
  // Zuständigkeit: Forstamt/Revier und die eigene FBG
  const fbg = store.get().profile.fbg;
  g.zust.push(h('div', { class: 'geo-card' },
    h('p', { class: 'geo-kicker' }, 'Zuständig'),
    info.zustaendig ? h('p', {}, h('strong', {}, `Forstamt ${info.zustaendig.Forstamt || '–'}`), info.zustaendig.Revier ? `, Revier ${info.zustaendig.Revier}` : '') : null,
    info.zustaendig ? h('p', { class: 'hint' }, 'ThüringenForst berät zu Waldbau, Förderung und Waldschutz.') : null,
    fbg
      ? h('p', {}, h('strong', {}, 'Deine FBG: '), fbg)
      : h('p', { class: 'hint' }, 'Bist du Mitglied einer Forstbetriebsgemeinschaft? ',
          h('button', { class: 'link-btn', onclick: () => openProfile() }, 'Im Profil eintragen')),
  ));
  // Kurzinfo für die zugeklappten Kacheln
  const st0 = info.standort ? explainStandort(info.standort) : null;
  g.vorschau.standort = st0 ? (st0.desc ? st0.desc[0].toUpperCase() + st0.desc.slice(1) : `Standortsgruppe ${st0.gruppe}`) : 'keine Standortskartierung';
  g.vorschau.schutz = [info.schutz.length ? info.schutz.map((x) => x.short).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') : 'kein Schutzgebiet',
    info.funktion.length ? `${info.funktion.length} Waldfunktion${info.funktion.length > 1 ? 'en' : ''}` : null].filter(Boolean).join(' · ');
  g.vorschau.zust = info.zustaendig?.Forstamt ? `Forstamt ${info.zustaendig.Forstamt}${info.zustaendig.Revier ? `, Revier ${info.zustaendig.Revier}` : ''}` : (fbg || '');
  return g;
}

function bestandCard(b) {
  return h('div', { class: 'geo-card' },
    h('p', { class: 'geo-kicker' }, 'Bestand'),
    h('h4', {}, `${b.art || b.text}${b.alter != null ? `, etwa ${b.alter} Jahre` : ''}`),
    h('p', { class: 'muted' }, `Waldverzeichnis ThüringenForst: „${b.text}“${b.alterStichtag != null ? `, ${b.alterStichtag} Jahre zum Stand ${b.stichtag}, auf heute hochgerechnet` : ''}.`),
  );
}

function geoInfoBlock(latlng) {
  const lade = (t) => h('p', { class: 'muted' }, t);
  const B = { standort: h('div', { class: 'geo-grid', 'aria-live': 'polite' }, lade('Lade Standort und Bestand …')),
    schutz: h('div', { class: 'geo-grid', 'aria-live': 'polite' }, lade('Lade Schutzstatus und Waldfunktionen …')),
    zust: h('div', { class: 'geo-grid', 'aria-live': 'polite' }, lade('Lade Zuständigkeit …')) };
  const quelle = h('p', { class: 'hint' }, 'Am angetippten Punkt laut Geoportal Thüringen (© GDI-Th / ThüringenForst / TLUBN). Ohne Gewähr – vor Maßnahmen im Zweifel beim Forstamt nachfragen.');
  const K = {
    standort: klapp('standort', 'Standort und Empfehlungen', [B.standort, quelle.cloneNode(true)], 'Lädt …'),
    schutz: klapp('schutz', 'Schutzstatus und Waldfunktionen', [B.schutz, quelle.cloneNode(true)], 'Lädt …'),
    zust: klapp('zust', 'Zuständigkeiten', B.zust, 'Lädt …'),
  };
  const bestandP = bestandAt([latlng.lat ?? latlng[0], latlng.lng ?? latlng[1]]).catch(() => null);
  queryPoint(latlng).then(async (info) => {
    if (info.failed) throw new Error('offline');
    const b = await bestandP;
    const g = renderGeoInfo(info);
    fill(B.standort, b ? bestandCard(b) : null, ...g.standort);
    fill(B.schutz, ...g.schutz);
    fill(B.zust, ...g.zust);
    K.standort.setKurz(`${b ? `${b.art || b.text} · ` : ''}${g.vorschau.standort}`);
    K.schutz.setKurz(g.vorschau.schutz);
    K.zust.setKurz(g.vorschau.zust);
  }).catch(() => {
    fill(B.standort, h('p', { class: 'hint' }, 'Das Geoportal ist gerade nicht erreichbar. Hier die Rohdaten-Auskunft:'), geoFrame('Forstliche Angaben am Punkt', INFO_SOURCES.forst(latlng), 220));
    fill(B.schutz, h('p', { class: 'hint' }, 'Das Geoportal ist gerade nicht erreichbar. Hier die Rohdaten-Auskunft:'), geoFrame('Schutzgebiete am Punkt', INFO_SOURCES.schutz(latlng), 160));
    fill(B.zust, h('p', { class: 'muted' }, 'Das Geoportal ist gerade nicht erreichbar.'));
    Object.values(K).forEach((k) => k.setKurz('nicht erreichbar'));
  });
  return [K.standort, K.schutz, K.zust];
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
  requestAnimationFrame(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
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
    ? h('div', { class: 'info-block' }, h('h3', {}, 'Kategorie'),
        catChips(m.category, (k) => { store.update((s) => { s.parcels.find((x) => x.id === p.id).category = k; }); renderInfo(); }))
    : h('div', { class: 'info-block add-block' },
        h('h3', {}, 'Zu meinen Flächen hinzufügen'),
        (() => {
          const chips = catChips(pick, (k) => { pick = k; chips.querySelectorAll('.chip').forEach((c, i) => c.setAttribute('aria-checked', String(Object.keys(CATEGORIES)[i] === k))); });
          return chips;
        })(),
        h('button', { class: 'btn btn-primary btn-block', onclick: () => {
          // Geometrie und Sachdaten mitspeichern, damit die Fläche auch offline verfügbar ist
          store.update((s) => { s.parcels.push({ ...p, category: pick, addedAt: Date.now() }); });
          say(`Flurstück ${p.nr} ist jetzt eine deiner Flächen. Du findest sie in deinem Profil.`);
          renderInfo();
        } }, h('span', { html: icon.plus }), 'Fläche hinzufügen'),
      );

  fill(box, 
    h('div', { class: 'info-head' },
      h('div', {},
        h('p', { class: 'info-kicker' }, m ? 'Deine Fläche' : 'Flurstück'),
        h('h2', {}, parcelTitle(p)),
      ),
      h('button', { class: 'icon-btn', 'aria-label': 'Infobox schließen', html: icon.close, onclick: clearSelection }),
    ),
    h('dl', { class: 'facts' },
      h('div', {}, h('dt', {}, p.flaecheAmtlich ? 'Größe (amtlich)' : 'Größe'), h('dd', { class: 'big' }, formatHa(ha))),
      h('div', {}, h('dt', {}, 'Gemeinde'), h('dd', {}, isAlkis ? p.gemeinde : `${p.gemeinde}, OT ${p.ortsteil}`)),
      p.lage ? h('div', { class: 'wide' }, h('dt', {}, 'Lage'), h('dd', {}, p.lage)) : null,
      p.nutzungText ? h('div', { class: 'wide' }, h('dt', {}, 'Tatsächliche Nutzung (ALKIS)'), h('dd', {}, p.nutzungText)) : null,
      p.standort ? h('div', { class: 'wide' }, h('dt', {}, 'Standort'), h('dd', {}, p.standort)) : null,
      h('div', { class: 'wide' }, h('dt', {}, 'Angetippter Punkt'), h('dd', { class: 'mono' }, `${latlng[0].toFixed(5)} N, ${latlng[1].toFixed(5)} O`)),
    ),
    catSection,
    isAlkis ? rescueBlock(latlng) : null,
    isAlkis ? geoInfoBlock(latlng) : null,
    isAlkis ? h('p', { class: 'hint' }, 'Flurstücksdaten: ALKIS, © GDI-Th. Standort, Waldfunktionen, Rettungspunkte: © GDI-Th / ThüringenForst. Keine amtliche Auskunft.') : null,
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
    isAlkis ? klapp('besonder', 'Besonderheiten', h('div', { id: 'besonderheiten' }, FEAT.has(p.id) ? besonderheitenListe(p) : h('p', { class: 'muted' }, 'Suche Verkehrssicherungspflicht und Biotope …')), 'Verkehrssicherung, Biotope') : null,
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
    m ? h('div', { class: 'info-actions' },
      h('button', { class: 'btn btn-primary', onclick: () => window.dispatchEvent(new CustomEvent('ww:new-measure', { detail: { parcelId: p.id } })) }, 'Maßnahme planen'),
      h('button', { class: 'btn btn-danger-ghost', onclick: () => removeParcel(p.id) }, h('span', { html: icon.trash }), 'Entfernen'),
    ) : null,
  );
  const wasHidden = box.hidden;
  box.hidden = false;
  box.scrollTop = 0;
  requestAnimationFrame(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
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
  dialog({
    title: 'Flurstück suchen',
    body: (close) => {
      const results = h('ul', { class: 'search-results', 'aria-live': 'polite' });
      const form = h('form', { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const q = { gemarkung: String(fd.get('gemarkung') || '').trim(), flur: String(fd.get('flur') || '').trim(), nr: String(fd.get('nr') || '').trim() };
        if (!q.gemarkung || !q.nr) { fill(results, h('li', { class: 'muted' }, 'Gib mindestens Gemarkung und Flurstücksnummer an.')); return; }
        fill(results, h('li', { class: 'muted' }, 'Suche im Liegenschaftskataster …'));
        let list;
        try { list = await source.search(q); } catch {
          fill(results, h('li', { class: 'muted' }, 'Das Geoportal Thüringen ist gerade nicht erreichbar. Versuch es später erneut oder tippe das Flurstück in der Karte an.'));
          return;
        }
        fill(results, ...(list.length
          ? list.slice(0, 30).map((p) => h('li', {}, h('button', { class: 'result', type: 'button', onclick: () => { close(null); focusParcel(p.id); } },
              h('strong', {}, `Flurstück ${p.nr}`), h('span', {}, `${p.gemarkung}, Flur ${p.flur}, ${formatHa(amtlicheFlaecheHa(p))}${p.lage ? `, ${p.lage}` : ''}`))))
          : [h('li', { class: 'muted' }, 'Kein Flurstück gefunden. Prüfe Gemarkung, Flur und Nummer.')]));
      } },
        gemarkungFeld(),
        h('div', { class: 'form-row' },
          h('label', {}, 'Flur', h('input', { name: 'flur', inputmode: 'numeric', placeholder: '4' })),
          h('label', {}, 'Flurstück', h('input', { name: 'nr', placeholder: '112 oder 112/2' })),
        ),
        h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, h('span', { html: icon.search }), 'Suchen'),
      );
      return h('div', {}, form, results, h('p', { class: 'hint' }, 'Daten aus dem Liegenschaftskataster Thüringen (ALKIS, © GDI-Th).'));
    },
    actions: [{ label: 'Schließen', value: null }],
  });
}

function openLegend(key) {
  const info = LAYER_INFO[key];
  const legends = legendUrls(key);
  dialog({
    title: info.title,
    body: h('div', { class: 'legend-box' },
      h('p', {}, info.text),
      legends.length ? h('p', { class: 'sheet-label' }, 'Legende') : null,
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
  dialog({
    title: 'Weitere Layer',
    body: h('div', { class: 'layer-sheet' },
      h('p', { class: 'sheet-label' }, 'Flurstücke'),
      sw('alkis', 'Flurstücksgrenzen (ALKIS)', { color: '#F6D32D', note: 'ab Zoomstufe 16', onchange: (e) => {
        store.update((st) => { st.settings.layers.alkis = e.target.checked; });
        base.setAlkis(e.target.checked);
      } }),
      groups.map((g) => [
        h('p', { class: 'sheet-label' }, g),
        OVERLAYS.filter((o) => o.group === g).map((o) => sw(o.key, o.label, { disabled: o.pending, note: o.pending ? 'wird gerade angebunden' : null })),
      ]),
      h('p', { class: 'sheet-label' }, 'Zum Ausprobieren'),
      sw('demo', 'Demo-Flächen (Raum Ilmenau)', { onchange: (e) => store.update((st) => { st.settings.demo = e.target.checked; st.settings.layers.demo = e.target.checked; }) }),
      h('p', { class: 'hint' }, 'Quellen: Geoportal Thüringen (© GDI-Th, dl-de/by-2-0), ThüringenForst, TLUBN, OpenStreetMap. Fachebenen erscheinen je nach Dienst erst ab einer bestimmten Zoomstufe.'),
    ),
    actions: [{ label: 'Fertig', value: true, primary: true }],
  });
}

function locateMe() {
  if (!('geolocation' in navigator)) { toast('Dein Browser kann keinen Standort bestimmen.'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      posMarker?.remove();
      posMarker = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#1F74B8', fillOpacity: 1 }).addTo(map);
      map.flyTo(ll, Math.max(map.getZoom(), 16));
    },
    (err) => toast(err.code === 1 ? 'Standort freigeben: in den Browser-Einstellungen für diese Seite erlauben.' : 'Standort nicht verfügbar. Versuch es unter freiem Himmel erneut.'),
    { enableHighAccuracy: true, timeout: 15000 },
  );
}
