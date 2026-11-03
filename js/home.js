// Reiter 1: Startseite mit Karte, Flurstücksauswahl und Infobox.
/* global L */
import { h, fill, icon, dialog, confirmDialog, toast } from './ui.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { createBaseMap, createOsmFeatureLayer, CATEGORIES, BASEMAP_LABELS } from './map/basemap.js';
import { areaHa, formatHa, formatDist, centroid } from './geo.js';
import { WANZE_SVG, say } from './mascot.js';
import { wfsDiagnose, ALKIS_MIN_ZOOM, featureInfoUrl, OVERLAYS, overlayLayer, TH_ATTR } from './map/thueringen.js';
import { openProfile } from './profile.js';

export const FEATURE_TYPES = {
  nsg: 'Naturschutz',
  biotop: 'Geschütztes Biotop',
  waldfunktion: 'Waldfunktion',
  vsp: 'Verkehrssicherungspflicht',
};

let base, map, osmLayer;
const catGroups = {};
let allParcelsLayer, infoLayer, rescueLayer, selectionLayer, posMarker;
const overlays = {};
let selected = null; // { parcel, latlng }
let ALL = [];

const mine = (id) => store.get().parcels.find((p) => p.id === id);
export const parcelTitle = (p) => `${p.gemarkung}, Flur ${p.flur}, Flurstück ${p.nr}`;

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
  const renderHead = () => {
    const pr = store.get().profile;
    const initials = (pr.name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
    fill(head,
      h('img', { class: 'app-logo', src: 'img/logo.png', alt: 'WaldWächter-Logo' }),
      h('div', { class: 'app-title' },
        h('h1', {}, 'WaldWächter'),
        h('p', {}, 'Digitale Wald- und Flächenbewirtschaftung für morgen.'),
      ),
      h('button', { class: 'profile-chip', id: 'btn-profile', 'aria-label': 'Mein Profil öffnen', onclick: () => openProfile() },
        h('span', { class: 'avatar' }, initials),
        h('span', { class: 'who' },
          h('strong', {}, pr.name || 'Profil anlegen'),
          h('span', {}, pr.fbg || 'Flächen, Konto, Einstellungen'),
        ),
        h('span', { class: 'chev', html: icon.chevron }),
      ),
    );
  };
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
      catGroups[m.category]?.addLayer(L.polygon(p.ring, { color: c.color, weight: 2, fillColor: c.color, fillOpacity: 0.38, interactive: false }));
    } else if (p.source !== 'alkis') { // ALKIS-Grenzen zeigt bereits der WMS
      allParcelsLayer.addLayer(L.polygon(p.ring, { color: '#3B4A40', weight: 1, dashArray: '4 4', fillOpacity: 0, interactive: false, className: 'parcel-outline' }));
    }
    if (m || selected?.parcel.id === p.id) addInfoPoints(p);
  }
  selectionLayer.eachLayer((l) => l.bringToFront?.());
}

function addInfoPoints(p) {
  for (const f of p.features || []) {
    if (f.line) infoLayer.addLayer(L.polyline(f.line, { color: '#F26B1D', weight: 6, opacity: 0.9, dashArray: '10 8', interactive: false }));
    const marker = L.marker(f.at, {
      icon: L.divIcon({ className: 'fpoint', html: '<span aria-hidden="true">!</span>', iconSize: [26, 26], iconAnchor: [13, 13] }),
      keyboard: true, title: f.title, alt: f.title,
    });
    marker.bindPopup(() => h('div', { class: 'ipop' },
      h('div', { class: 'ipop-bug', html: WANZE_SVG }),
      h('div', {}, h('strong', {}, f.title), h('p', {}, f.text)),
    ), { maxWidth: 290, className: 'ipop-wrap' });
    infoLayer.addLayer(marker);
  }
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
  selectionLayer.clearLayers();
  selectionLayer.addLayer(L.polygon(parcel.ring, { color: '#FFFFFF', weight: 3.5, fillColor: '#1F4A2C', fillOpacity: 0.35, interactive: false }));
  selectionLayer.addLayer(infoPin(latlng));
  drawParcels();
  await renderInfo();
}

function clearSelection() {
  selected = null;
  selectionLayer.clearLayers();
  const box = document.getElementById('infobox');
  box.hidden = true;
  drawParcels();
  requestAnimationFrame(invalidateMap);
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
  selectionLayer.clearLayers();
  selectionLayer.addLayer(infoPin(latlng));
  const box = document.getElementById('infobox');
  fill(box,
    h('div', { class: 'info-head' },
      h('div', {}, h('p', { class: 'info-kicker' }, 'Auskunft Geoportal Thüringen'), h('h2', {}, 'Flurstück am angetippten Punkt')),
      h('button', { class: 'icon-btn', 'aria-label': 'Infobox schließen', html: icon.close, onclick: clearSelection }),
    ),
    h('iframe', { class: 'wms-info', src: featureInfoUrl(latlng), title: 'Flurstücksauskunft ALKIS', loading: 'lazy', referrerpolicy: 'no-referrer' }),
    h('p', { class: 'hint' }, 'Für diese Stelle liegen in der App noch keine Flurstücksdaten vor. Deshalb kann die Fläche noch nicht zu deinen Flächen hinzugefügt werden. Die Auskunft oben kommt direkt vom Geoportal.'),
    h('div', { class: 'info-block' },
      h('h3', {}, 'Nächste Rettungspunkte'),
      h('div', { class: 'rescue-actions' }, h('a', { class: 'btn btn-small', href: 'https://www.rettungspunkte-forst.de', target: '_blank', rel: 'noopener' }, 'Rettungspunkte-Karte (KWF)')),
      h('p', { class: 'hint' }, 'Im Notfall immer 112 wählen.'),
    ),
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
  const ha = p.flaecheAmtlich ? p.flaecheAmtlich / 10000 : areaHa(p.ring);
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
    h('div', { class: 'info-block' },
      h('h3', {}, 'Nächste Rettungspunkte'),
      !rescue.length ? h('div', { class: 'rescue' },
        h('p', {}, 'Die Rettungspunkte sind für echte Flurstücke noch nicht angebunden. Schau vor dem Waldgang auf der offiziellen Karte nach dem nächsten Rettungspunkt.'),
        h('div', { class: 'rescue-actions' },
          h('a', { class: 'btn btn-small', href: 'https://www.rettungspunkte-forst.de', target: '_blank', rel: 'noopener' }, 'Rettungspunkte-Karte (KWF)'),
        ),
        h('p', { class: 'hint' }, 'Im Notfall immer 112 wählen.'),
      ) : null,
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
    h('div', { class: 'info-block' },
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
              h('strong', {}, `Flurstück ${p.nr}`), h('span', {}, `${p.gemarkung}, Flur ${p.flur}, ${formatHa(p.flaecheAmtlich ? p.flaecheAmtlich / 10000 : areaHa(p.ring))}${p.lage ? `, ${p.lage}` : ''}`))))
          : [h('li', { class: 'muted' }, 'Kein Flurstück gefunden. Prüfe Gemarkung, Flur und Nummer.')]));
      } },
        h('label', {}, 'Gemarkung', h('input', { name: 'gemarkung', list: 'gemarkungen', autocomplete: 'off', placeholder: 'z. B. Manebach', required: true })),
        h('datalist', { id: 'gemarkungen' }, source.gemarkungen().map((g) => h('option', { value: g }))),
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

function openLayerSheet() {
  const s = store.get().settings;
  const sw = (key, label, { color, disabled, note, onchange } = {}) => h('label', { class: `switch-row ${disabled ? 'disabled' : ''}` },
    color ? h('span', { class: 'swatch', style: `background:${color}` }) : null,
    h('span', { class: 'switch-label' }, label, note ? h('small', {}, note) : null),
    h('input', { type: 'checkbox', role: 'switch', disabled, checked: !disabled && !!s.layers[key], onchange: onchange || ((e) => {
      store.update((st) => { st.settings.layers[key] = e.target.checked; });
    }) }),
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
