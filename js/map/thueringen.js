// Amtliche Geodienste des Freistaats Thüringen (Geoproxy, GDI-Th).
// Lizenz: Datenlizenz Deutschland – Namensnennung 2.0 bzw. CC BY 4.0, Quelle „© GDI-Th“.
/* global L */
import { pointInPolygon, areaHa } from '../geo.js';

const GP = 'https://www.geoproxy.geoportal-th.de/geoproxy/services';
export const TH_ATTR = '© <a href="https://www.geoportal-th.de" target="_blank" rel="noopener">GDI-Th</a>, dl-de/by-2-0';

export const TH = {
  dop: `${GP}/DOP`,                         // Luftbilder: th_dop (20 cm), th_dop200rgb (2 m)
  alkis: `${GP}/adv_alkis_wms_th`,          // ALKIS farbig: adv_alkis_flurstuecke, adv_alkis_gebaeude …
  alkisGelb: `${GP}/adv_alkis_wms_th_gelb`, // ALKIS nur Konturen in Gelb (für Luftbild)
  wfs: [                                    // ALKIS vereinfacht (Flurstücke als Vektor)
    { url: `${GP}/adv_alkis_wfs`, ns: 'http://repository.gdi-de.org/schemas/adv/produkt/alkis-vereinfacht/1.0' },
    { url: `${GP}/adv_alkis_v2_wfs`, ns: 'http://repository.gdi-de.org/schemas/adv/produkt/alkis-vereinfacht/2.0' },
  ],
};

const wms = (url, layers, opts = {}) => L.tileLayer.wms(url, {
  layers, format: 'image/png', transparent: true, version: '1.3.0', attribution: TH_ATTR, maxZoom: 21, ...opts,
});

/** Thüringer Luftbild: 2-m-Bild für die Übersicht, 20-cm-Bild ab Zoom 14. */
export function dopLayer() {
  return L.layerGroup([
    wms(TH.dop, 'th_dop200rgb', { format: 'image/jpeg', transparent: false, maxZoom: 13 }),
    wms(TH.dop, 'th_dop', { format: 'image/jpeg', transparent: false, minZoom: 14 }),
  ]);
}

// Der Dienst zeichnet Flurstücke nur bis Maßstab 1:10.000. In Web-Mercator
// entspricht das in Thüringen erst Zoomstufe 16 (Zoom 15 ≈ 1:17.000).
export const ALKIS_MIN_ZOOM = 16;

/** ALKIS-Flurstücksgrenzen mit Nummern; auf dem Luftbild in Gelb. */
export function alkisLayer(onAerial) {
  return onAerial
    ? wms(TH.alkisGelb, 'adv_alkis_flurstuecke', { minZoom: ALKIS_MIN_ZOOM, opacity: 0.95 })
    : wms(TH.alkis, 'adv_alkis_flurstuecke', { minZoom: ALKIS_MIN_ZOOM, opacity: 0.85 });
}

// ---------- WFS: Flurstücke abfragen ----------

// Der Geoproxy erlaubt Browser-Abfragen von fremden Seiten evtl. nicht (CORS).
// Dann wird über denselben Server umgeleitet: <App>/geoproxy/… → Geoproxy
// (siehe netlify.toml). Auf GitHub Pages gibt es diese Umleitung nicht.
const PROXY_BASE = new URL('geoproxy/services', location.href).href;
const viaProxy = (url) => url.replace(GP, PROXY_BASE);

let workingWfs = null; // zuletzt erfolgreicher Weg { url, ns }
export const wfsDiagnose = { last: '' };

async function wfsGet(params) {
  const routes = TH.wfs.flatMap((w) => [w, { ...w, url: viaProxy(w.url), proxy: true }]);
  const candidates = workingWfs ? [workingWfs, ...routes.filter((w) => w.url !== workingWfs.url)] : routes;
  let lastErr;
  const notes = [];
  for (const w of candidates) {
    const q = new URLSearchParams({
      SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: 'ave:Flurstueck',
      NAMESPACES: `xmlns(ave,${w.ns})`, SRSNAME: 'urn:ogc:def:crs:EPSG::4326', COUNT: '30',
      ...params(w),
    });
    try {
      const res = await fetch(`${w.url}?${q}`, { mode: 'cors' });
      const text = await res.text();
      if (!res.ok || /ExceptionReport/.test(text.slice(0, 600))) {
        notes.push(`${w.proxy ? 'Proxy' : 'direkt'} ${w.url.split('/').pop()}: HTTP ${res.status} ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)}`);
        lastErr = new Error(text.slice(0, 300));
        continue;
      }
      workingWfs = w;
      wfsDiagnose.last = `OK über ${w.proxy ? 'Proxy' : 'direkte Verbindung'} (${w.url.split('/').pop()})`;
      return parseFlurstuecke(text);
    } catch (e) {
      notes.push(`${w.proxy ? 'Proxy' : 'direkt'} ${w.url.split('/').pop()}: ${e.name === 'TypeError' ? 'blockiert (CORS) oder offline' : e.message}`);
      lastErr = e;
    }
  }
  wfsDiagnose.last = notes.join(' | ');
  console.warn('ALKIS-WFS fehlgeschlagen:', notes);
  const err = new Error('ALKIS-Abfrage nicht erreichbar');
  err.cause = lastErr;
  throw err;
}

/** Flurstück am Punkt [lat, lng] */
export async function wfsParcelAt([lat, lng]) {
  const d = 0.00004; // ca. 4 m
  const list = await wfsGet(() => ({ BBOX: `${lat - d},${lng - d},${lat + d},${lng + d},urn:ogc:def:crs:EPSG::4326` }));
  return list.find((p) => pointInPolygon([lat, lng], p.ring)) || list[0] || null;
}

/** Suche nach Gemarkung, Flur, Flurstücksnummer (Zähler[/Nenner]) */
export async function wfsSearch({ gemarkung, flur, nr }) {
  const esc = (s) => String(s).replace(/[<>&'"]/g, '');
  const cond = [];
  if (gemarkung) cond.push(`<fes:PropertyIsLike wildCard="*" singleChar="." escapeChar="!" matchCase="false"><fes:ValueReference>ave:gemarkung</fes:ValueReference><fes:Literal>${esc(gemarkung)}*</fes:Literal></fes:PropertyIsLike>`);
  if (flur) cond.push(`<fes:PropertyIsEqualTo><fes:ValueReference>ave:flur</fes:ValueReference><fes:Literal>${esc(flur)}</fes:Literal></fes:PropertyIsEqualTo>`);
  if (nr) {
    const [z, n] = String(nr).split('/').map((s) => s.trim());
    cond.push(`<fes:PropertyIsEqualTo><fes:ValueReference>ave:flstnrzae</fes:ValueReference><fes:Literal>${esc(z)}</fes:Literal></fes:PropertyIsEqualTo>`);
    if (n) cond.push(`<fes:PropertyIsEqualTo><fes:ValueReference>ave:flstnrnen</fes:ValueReference><fes:Literal>${esc(n)}</fes:Literal></fes:PropertyIsEqualTo>`);
  }
  if (!cond.length) return [];
  return wfsGet((w) => ({
    FILTER: `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:ave="${w.ns}">${cond.length > 1 ? `<fes:And>${cond.join('')}</fes:And>` : cond[0]}</fes:Filter>`,
  }));
}

function parseFlurstuecke(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const feats = [...doc.getElementsByTagNameNS('*', 'Flurstueck')];
  return feats.map(parseOne).filter(Boolean);
}

function val(el, name) {
  const n = el.getElementsByTagNameNS('*', name)[0];
  return n ? n.textContent.trim() : '';
}

function parseOne(el) {
  // Äußerer Ring des (ersten) Polygons
  const ext = el.getElementsByTagNameNS('*', 'exterior')[0] || el;
  const pl = ext.getElementsByTagNameNS('*', 'posList')[0];
  let nums = [];
  if (pl) nums = pl.textContent.trim().split(/\s+/).map(Number);
  else nums = [...ext.getElementsByTagNameNS('*', 'pos')].flatMap((p) => p.textContent.trim().split(/\s+/).map(Number));
  if (nums.length < 6) return null;
  let ring = [];
  for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i], nums[i + 1]]);
  // Achsreihenfolge prüfen: Thüringen liegt bei ca. 50–52° N und 9,8–13° O
  if (ring[0][0] < 30 && ring[0][1] > 30) ring = ring.map(([a, b]) => [b, a]);
  if (ring.length > 3 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();

  const zae = val(el, 'flstnrzae'), nen = val(el, 'flstnrnen');
  const flaeche = Number(val(el, 'flaeche')) || null;
  const nutzung = val(el, 'tntxt');
  const gemarkung = val(el, 'gemarkung');
  const gemeinde = val(el, 'gemeinde');
  return {
    id: val(el, 'flstkennz') || el.getAttributeNS('http://www.opengis.net/gml/3.2', 'id') || `${gemarkung}-${zae}-${nen}`,
    source: 'alkis',
    gemarkung: gemarkung || '–',
    flur: String(Number(val(el, 'flur')) || val(el, 'flur') || '–'),
    nr: nen ? `${zae}/${nen}` : zae,
    gemeinde: gemeinde || '–',
    ortsteil: gemarkung || '',
    lage: val(el, 'lagebeztxt'),
    nutzungText: nutzung,
    nutzung: categorize(nutzung),
    flaecheAmtlich: flaeche,
    ring,
    standort: null,
    features: [],
  };
}

export function categorize(t = '') {
  if (/wald|gehölz|forst/i.test(t)) return 'Wald';
  if (/fließ|stehend|gewässer|see|teich|bach|graben|fluss/i.test(t)) return 'Gewässer';
  if (/wohn|gebäude|industrie|gewerbe|hof|siedlung|bau/i.test(t)) return 'Gebäude';
  if (/acker|grünland|landwirtschaft|wiese|weide|garten|obst/i.test(t)) return 'Landwirtschaft';
  return 'Wald';
}

export const amtlicheFlaecheHa = (p) => (p.flaecheAmtlich ? p.flaecheAmtlich / 10000 : areaHa(p.ring));

// ---------- Lokale ALKIS-Kacheln (data/alkis, erzeugt von tools/alkis_tiles.py) ----------

const LZ = 14;
const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** LZ);
const tileY = (lat) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** LZ);
const tileCache = new Map();
let localIndex;

function fromCompact(c) {
  const ring = [];
  for (let i = 0; i + 1 < c.r.length; i += 2) ring.push([c.r[i], c.r[i + 1]]);
  return {
    id: c.i, source: 'alkis', gemarkung: c.g || '–', flur: c.f || '–', nr: c.n, gemeinde: c.m || '–', ortsteil: c.g || '',
    lage: c.l, nutzungText: c.t, nutzung: categorize(c.t), flaecheAmtlich: c.a || null, ring, standort: null, features: [],
  };
}

async function loadTile(x, y) {
  const key = `${x}/${y}`;
  if (!tileCache.has(key)) {
    tileCache.set(key, fetch(`data/alkis/${LZ}/${x}/${y}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => list.map(fromCompact))
      .catch(() => []));
  }
  return tileCache.get(key);
}

export async function localIndexInfo() {
  localIndex ??= fetch('data/alkis/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return localIndex;
}

/** Flurstück aus den mitgelieferten Daten; null, wenn für diese Stelle keine Daten vorliegen */
export async function localParcelAt([lat, lng]) {
  const list = await loadTile(tileX(lng), tileY(lat));
  if (!list.length) return null;
  return list.find((p) => pointInPolygon([lat, lng], p.ring)) || null;
}

export async function localSearch({ gemarkung, flur, nr }) {
  const idx = await localIndexInfo();
  if (!idx?.gemarkungen) return null; // keine lokalen Daten
  const norm = (s) => String(s || '').trim().toLowerCase();
  const gems = Object.entries(idx.gemarkungen).filter(([g]) => norm(g).startsWith(norm(gemarkung)));
  const out = [];
  for (const [, file] of gems) {
    const entries = await fetch(`data/alkis/gem/${file}`).then((r) => r.json()).catch(() => ({}));
    for (const [k, [x, y]] of Object.entries(entries)) {
      const [f, ...rest] = k.split('/');
      const n = rest.join('/');
      if (flur && String(Number(flur)) !== f) continue;
      if (nr && norm(n) !== norm(nr) && norm(n.split('/')[0]) !== norm(nr)) continue;
      const tile = await loadTile(x, y);
      const p = tile.find((t) => t.flur === f && t.nr === n);
      if (p) out.push(p);
      if (out.length >= 30) return out;
    }
  }
  return out;
}

// ---------- WMS-Auskunft (GetFeatureInfo) – wird im iframe angezeigt, daher ohne CORS ----------

export function featureInfoUrl([lat, lng]) {
  const R = 6378137;
  const x = (lng * Math.PI / 180) * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
  const half = 50 * 0.6; // 101 × 101 Pixel à 0,6 m (≈ Maßstab 1:2.000)
  const q = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: 'adv_alkis_flurstuecke', QUERY_LAYERS: 'adv_alkis_flurstuecke',
    STYLES: '', CRS: 'EPSG:3857', BBOX: [x - half, y - half, x + half, y + half].join(','), WIDTH: '101', HEIGHT: '101',
    I: '50', J: '50', INFO_FORMAT: 'text/html', FEATURE_COUNT: '1',
  });
  return `${TH.alkis}?${q}`;
}
