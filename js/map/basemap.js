// Kartengrundlagen: Basiskarten, Kategoriefarben, OSM-Objektlayer (Overpass).
/* global L */
import { dopLayer, alkisLayer, TH } from './thueringen.js';

export const CATEGORIES = {
  Wald:           { color: '#2F7D3A', label: 'Wald' },
  Landwirtschaft: { color: '#C99212', label: 'Landwirtschaft' },
  Gewässer:       { color: '#1F74B8', label: 'Gewässer' },
  Gebäude:        { color: '#9A4F3A', label: 'Gebäude' },
};

export const BASEMAP_LABELS = { dop: 'Luftbild TH', osm: 'Karte', topo: 'Topo' };

export const BASEMAPS = {
  // Amtliches Thüringer Luftbild (DOP 20 cm), GDI-Th
  dop: () => dopLayer(),
  osm: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 21, maxNativeZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
  }),
  // TopPlusOpen des Bundesamts für Kartographie und Geodäsie (amtliche Topokarte)
  topo: () => L.tileLayer('https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png', {
    maxZoom: 21, maxNativeZoom: 18,
    attribution: '© <a href="https://www.bkg.bund.de" target="_blank" rel="noopener">BKG</a> (2026), dl-de/by-2-0',
  }),
};

/** Kachel-URL für das Offline-Speichern (WMS: GetMap mit BBOX in EPSG:3857). */
export function tileUrls(key, z, x, y, { alkis = true } = {}) {
  const out = [];
  if (key === 'osm') out.push(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`);
  if (key === 'topo') out.push(`https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/${z}/${y}/${x}.png`);
  if (key === 'dop') out.push(wmsTileUrl(TH.dop, z >= 14 ? 'th_dop' : 'th_dop200rgb', 'image/jpeg', false, z, x, y));
  if (alkis && z >= 16) out.push(wmsTileUrl(key === 'dop' ? TH.alkisGelb : TH.alkis, 'adv_alkis_flurstuecke', 'image/png', true, z, x, y));
  return out;
}

export function wmsTileUrl(base, layers, format, transparent, z, x, y) {
  const R = 6378137, W = 2 * Math.PI * R, res = W / (256 * 2 ** z);
  const minx = -Math.PI * R + x * 256 * res, maxy = Math.PI * R - y * 256 * res;
  const q = new URLSearchParams({ service: 'WMS', request: 'GetMap', layers, styles: '', format, transparent: String(transparent), version: '1.3.0', width: '256', height: '256', crs: 'EPSG:3857', bbox: [minx, maxy - 256 * res, minx + 256 * res, maxy].join(',') });
  return `${base}?${q}`;
}

export function createBaseMap(el, { center, zoom = 15, basemap = 'dop', alkis = true } = {}) {
  if (!BASEMAPS[basemap]) basemap = 'dop';
  const map = L.map(el, { zoomControl: false, attributionControl: true, tap: true, maxZoom: 21 })
    .setView(center, zoom);
  map.attributionControl.setPrefix(false);
  let base = BASEMAPS[basemap]().addTo(map);
  let current = basemap;
  let alkisOn = alkis, alkisLyr = null;
  el.dataset.basemap = basemap;

  function refreshAlkis() {
    if (alkisLyr) { map.removeLayer(alkisLyr); alkisLyr = null; }
    if (alkisOn) { alkisLyr = alkisLayer(current === 'dop').addTo(map); alkisLyr.bringToFront?.(); }
  }
  refreshAlkis();

  return {
    map,
    get basemap() { return current; },
    setBasemap(key) {
      if (key === current || !BASEMAPS[key]) return;
      map.removeLayer(base);
      base = BASEMAPS[key]().addTo(map);
      base.bringToBack?.();
      if (base.eachLayer) base.eachLayer((l) => l.bringToBack());
      current = key;
      el.dataset.basemap = key;
      refreshAlkis();
    },
    setAlkis(on) { alkisOn = on; refreshAlkis(); },
  };
}

/**
 * Zeigt OSM-Objekte (Gebäude, Wasser, Wald, Landwirtschaft) ab Zoom 15
 * halbtransparent an. Datenquelle: Overpass API (Fair-Use beachten; für den
 * Echtbetrieb eigene Instanz oder vorberechnete Vektorkacheln nutzen).
 */
export function createOsmFeatureLayer(map, getEnabled) {
  const group = L.layerGroup().addTo(map);
  const renderer = L.canvas({ padding: 0.3 });
  const cache = new Map();
  let timer, lastKey = '', controller;

  const classify = (t = {}) => {
    if (t.building) return 'Gebäude';
    if (t.natural === 'water' || t.waterway) return 'Gewässer';
    if (t.landuse === 'forest' || t.natural === 'wood') return 'Wald';
    if (/farmland|meadow|orchard|grass/.test(t.landuse || '')) return 'Landwirtschaft';
    return null;
  };

  function draw(elements) {
    group.clearLayers();
    const enabled = getEnabled();
    for (const e of elements) {
      const cat = classify(e.tags);
      if (!cat || !enabled[cat] || !e.geometry) continue;
      const pts = e.geometry.map((g) => [g.lat, g.lon]);
      const closed = pts.length > 3 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1];
      const color = CATEGORIES[cat].color;
      const opts = { renderer, interactive: false, color, weight: cat === 'Gewässer' && !closed ? 3 : 1, opacity: 0.7 };
      group.addLayer(closed ? L.polygon(pts, { ...opts, fillColor: color, fillOpacity: 0.18 }) : L.polyline(pts, opts));
    }
  }

  async function refresh() {
    if (map.getZoom() < 15) { group.clearLayers(); return; }
    const b = map.getBounds().pad(0.15);
    const r = (v) => v.toFixed(3);
    const key = [r(b.getSouth()), r(b.getWest()), r(b.getNorth()), r(b.getEast())].join(',');
    if (cache.has(key)) { draw(cache.get(key)); lastKey = key; return; }
    if (key === lastKey) return;
    lastKey = key;
    controller?.abort();
    controller = new AbortController();
    const q = `[out:json][timeout:20];(
      way["building"](${key});
      way["natural"="water"](${key});way["waterway"~"river|stream|canal|ditch"](${key});
      way["landuse"="forest"](${key});way["natural"="wood"](${key});
      way["landuse"~"farmland|meadow|orchard|grass"](${key});
    );out geom;`;
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: controller.signal });
      if (!res.ok) return;
      const json = await res.json();
      cache.set(key, json.elements || []);
      draw(json.elements || []);
    } catch { /* offline oder abgebrochen – Layer bleibt leer */ }
  }

  map.on('moveend', () => { clearTimeout(timer); timer = setTimeout(refresh, 700); });
  refresh();
  return { refresh: () => { lastKey = ''; refresh(); }, group };
}
