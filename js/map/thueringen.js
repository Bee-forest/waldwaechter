// Amtliche Geodienste des Freistaats Thüringen (Geoproxy, GDI-Th).
// Lizenz: Datenlizenz Deutschland – Namensnennung 2.0 bzw. CC BY 4.0, Quelle „© GDI-Th“.
/* global L */
import { pointInPolygon, inPolys, polysOf, areaHa, areaM2Polys, toUTM32, fromUTM32, generateGrid } from '../geo.js';

export const GP = 'https://www.geoproxy.geoportal-th.de/geoproxy/services';
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
      NAMESPACES: `xmlns(ave,${w.ns})`, SRSNAME: 'urn:ogc:def:crs:EPSG::25832', COUNT: '30',
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
  // Der Geoproxy beantwortet BBOX-Abfragen zuverlässig nur im Landessystem UTM 32 (EPSG:25832)
  const [x, y] = toUTM32([lat, lng]);
  const d = 4; // m
  const list = await wfsGet(() => ({ BBOX: `${x - d},${y - d},${x + d},${y + d},urn:ogc:def:crs:EPSG::25832` }));
  return list.find((p) => inPolys([lat, lng], polysOf(p))) || list[0] || null;
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

function ringFrom(e) {
  const pl = e.getElementsByTagNameNS('*', 'posList')[0];
  let nums = [];
  if (pl) nums = pl.textContent.trim().split(/\s+/).map(Number);
  else nums = [...e.getElementsByTagNameNS('*', 'pos')].flatMap((p) => p.textContent.trim().split(/\s+/).map(Number));
  if (nums.length < 6) return null;
  let ring = [];
  for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i], nums[i + 1]]);
  if (ring[0][0] > 1000) ring = ring.map(([a, b]) => (a < 1e6 ? fromUTM32([a, b]) : fromUTM32([b, a]))); // UTM 32 → lat/lon
  // Achsreihenfolge prüfen: Thüringen liegt bei ca. 50–52° N und 9,8–13° O
  else if (ring[0][0] < 30 && ring[0][1] > 30) ring = ring.map(([a, b]) => [b, a]);
  if (ring.length > 3 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
  return ring;
}

function parseOne(el) {
  // Alle Teilflächen mit Löchern (exterior beginnt ein Polygon, interior = Loch)
  const polys = [];
  for (const e of el.getElementsByTagNameNS('*', '*')) {
    if (e.localName !== 'exterior' && e.localName !== 'interior') continue;
    const r = ringFrom(e);
    if (!r) continue;
    if (e.localName === 'exterior' || !polys.length) polys.push([r]); else polys.at(-1).push(r);
  }
  if (!polys.length) { const r = ringFrom(el); if (r) polys.push([r]); }
  if (!polys.length) return null;
  const ring = polys[0][0];

  const kennz = val(el, 'flstkennz');
  let zae = val(el, 'flstnrzae'), nen = val(el, 'flstnrnen');
  if (!zae && /^\d{14}/.test(kennz)) { // LL GGGG FFF ZZZZZ NNNN|____ __
    zae = String(Number(kennz.slice(9, 14)));
    nen = /^\d{4}$/.test(kennz.slice(14, 18)) && Number(kennz.slice(14, 18)) ? String(Number(kennz.slice(14, 18))) : '';
  }
  const flurRaw = val(el, 'flur').match(/\d+/)?.[0] || (/^\d{9}/.test(kennz) ? kennz.slice(6, 9) : '');
  const flaeche = Number(val(el, 'flaeche')) || null;
  const nutzung = nutzungText(val(el, 'tntxt'));
  const gemarkung = val(el, 'gemarkung');
  const gemeinde = val(el, 'gemeinde');
  return {
    id: val(el, 'flstkennz') || el.getAttributeNS('http://www.opengis.net/gml/3.2', 'id') || `${gemarkung}-${zae}-${nen}`,
    source: 'alkis',
    gemarkung: gemarkung || '–',
    flur: flurRaw ? String(Number(flurRaw)) : '–',
    nr: nen ? `${zae}/${nen}` : zae,
    gemeinde: gemeinde || '–',
    ortsteil: gemarkung || '',
    lage: val(el, 'lagebeztxt'),
    nutzungText: umlaute(nutzung),
    nutzung: categorize(nutzung),
    flaecheAmtlich: flaeche,
    ring,
    polys: polys.length > 1 || polys[0].length > 1 ? polys : undefined,
    standort: null,
    features: [],
  };
}

/** 'Wald; 3200|Grünland; 400' → 'Wald 0,32 ha, Grünland 400 m²' */
export function nutzungText(raw = '') {
  if (!raw.includes(';')) return raw;
  const sums = new Map();
  for (const seg of raw.split('|')) {
    const [n, a] = seg.split(';');
    const k = (n || '').trim().replace('Strassen', 'Straßen');
    if (k) sums.set(k, (sums.get(k) || 0) + (Number(a) || 0));
  }
  return [...sums].map(([n, a]) => [a, n]).sort((a, b) => b[0] - a[0])
    .map(([a, n]) => (a ? `${n} ${a >= 10000 ? `${(a / 10000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} ha` : `${Math.round(a).toLocaleString('de-DE')} m²`}` : n))
    .join(', ');
}

/** ALKIS schreibt ohne Umlaute (z. B. „Wohnbauflaeche“) – für die Anzeige korrigieren */
export const umlaute = (t = '') => t.replace(/flaeche/gi, 'fläche').replace(/Gewaesser/g, 'Gewässer').replace(/Gehoelz/g, 'Gehölz')
  .replace(/Gruen/g, 'Grün').replace(/gruen/g, 'grün').replace(/Strasse/g, 'Straße').replace(/strasse/g, 'straße').replace(/Fliess/g, 'Fließ')
  .replace(/Sumpf/g, 'Sumpf').replace(/Oedland/g, 'Ödland').replace(/Unlandflaeche/g, 'Unlandfläche');

export function categorize(t = '') {
  t = String(t).split(',')[0]; // größte Nutzung zuerst
  if (/wald|gehölz|forst/i.test(t)) return 'Wald';
  if (/fließ|stehend|gewässer|see|teich|bach|graben|fluss/i.test(t)) return 'Gewässer';
  if (/wohn|gebäude|industrie|gewerbe|hof|siedlung|bau/i.test(t)) return 'Gebäude';
  if (/acker|grünland|landwirtschaft|wiese|weide|garten|obst/i.test(t)) return 'Landwirtschaft';
  return 'Wald';
}

export const amtlicheFlaecheHa = (p) => (p.flaecheAmtlich ? p.flaecheAmtlich / 10000 : areaM2Polys(polysOf(p)) / 10000);

// Nutzungsart → Kategorie für die Flächenbilanz (Wege, Straßen usw. getrennt als „Sonstiges“)
function kategorieTeil(name = '') {
  if (/wald|gehölz|forst/i.test(name)) return 'Wald';
  if (/fließ|stehend|gewässer|see|teich|bach|graben|fluss|hafen/i.test(name)) return 'Gewässer';
  if (/wohn|gebäude|industrie|gewerbe|hof|siedlung|bau|sport|freizeit|friedhof|öffentlich|mischnutzung/i.test(name)) return 'Gebäude';
  if (/acker|grünland|landwirtschaft|wiese|weide|garten|obst|gartenland|brach/i.test(name)) return 'Landwirtschaft';
  return 'Sonstiges';
}
/**
 * Flächenanteile eines Flurstücks nach tatsächlicher Nutzung (ALKIS), in ha.
 * Die gerundeten Teilwerte aus dem Nutzungstext werden auf die amtliche Fläche abgeglichen,
 * damit die Summe exakt der amtlichen Fläche entspricht.
 */
export function nutzungAnteile(p) {
  const total = amtlicheFlaecheHa(p);
  const teile = {};
  for (const seg of String(p.nutzungText || '').split(/,\s+/)) {
    const m = seg.trim().match(/^(.*?)\s+([\d.]+(?:,\d+)?)\s*(ha|m²)$/);
    if (!m) continue;
    const v = Number(m[2].replace(/\./g, '').replace(',', '.')) / (m[3] === 'ha' ? 1 : 10000);
    const k = kategorieTeil(m[1]);
    teile[k] = (teile[k] || 0) + v;
  }
  const summe = Object.values(teile).reduce((a, b) => a + b, 0);
  if (!summe) return null;
  for (const k of Object.keys(teile)) teile[k] = (teile[k] / summe) * total;
  return teile;
}

// ---------- Lokale ALKIS-Kacheln (data/alkis, erzeugt von tools/alkis_tiles.py) ----------

const LZ = 14;
const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** LZ);
const tileY = (lat) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** LZ);
const tileCache = new Map();
let localIndex;

function decodeQ(q) {
  const ring = []; let la = 0, lo = 0; // Mikrograd, ab dem 2. Punkt als Differenz
  for (let i = 0; i + 1 < q.length; i += 2) { la += q[i]; lo += q[i + 1]; ring.push([la / 1e6, lo / 1e6]); }
  return ring;
}

function fromCompact(c) {
  let ring = [];
  const polys = c.x ? c.x.map((poly) => poly.map(decodeQ)) : undefined;
  if (c.q) {
    ring = decodeQ(c.q);
  } else {
    for (let i = 0; i + 1 < c.r.length; i += 2) ring.push([c.r[i], c.r[i + 1]]);
  }
  return {
    id: c.i, source: 'alkis', gemarkung: c.g || '–', flur: c.f || '–', nr: c.n, gemeinde: c.m || '–', ortsteil: c.g || '',
    lage: c.l, nutzungText: umlaute(c.t), nutzung: categorize(c.t), flaecheAmtlich: c.a || null, ring, polys, standort: null, features: [],
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

/** Alle mitgelieferten Flurstücke im Umkreis eines Rahmens {s, w, n, e} (Grad), inkl. Nachbarkacheln */
export async function parcelsNear({ s: so, w, n, e }) {
  const x0 = tileX(w) - 1, x1 = tileX(e) + 1, y0 = tileY(n) - 1, y1 = tileY(so) + 1;
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(loadTile(x, y));
  const seen = new Map();
  for (const list of await Promise.all(jobs)) for (const p of list) seen.set(p.id, p);
  return [...seen.values()];
}

export async function localIndexInfo() {
  localIndex ??= fetch('data/alkis/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return localIndex;
}

/** Flurstück aus den mitgelieferten Daten; null, wenn für diese Stelle keine Daten vorliegen */
export async function localParcelAt([lat, lng]) {
  const list = await loadTile(tileX(lng), tileY(lat));
  if (!list.length) return null;
  return list.find((p) => inPolys([lat, lng], polysOf(p))) || null;
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

// ---------- Fachebenen (WMS) für „Weitere Layer“ ----------
// minZoom grob nach den Maßstabsgrenzen der Dienste. Ebenen ohne bestätigte
// Adresse sind mit pending markiert und erscheinen noch nicht in der Auswahl.
export const FORST = `${GP}/forst/FORST`; // ThüringenForst (Maßstab bis 1:150.000 → ab Zoom 12)
export const OVERLAYS = [
  { key: 'rettung', label: 'Rettungspunkte', group: 'Sicherheit', url: FORST, layers: 'rettungspunkte', minZoom: 11 },
  { key: 'standort', label: 'Standortkarte (Forst)', group: 'Wald', url: FORST, layers: 'standort_fl', opacity: 0.6, minZoom: 12 },
  { key: 'waldfunktionen', label: 'Waldfunktionen', group: 'Wald', url: FORST, layers: 'bodenschutzfunktion,erholungswald,erholungsfunktion,klimaschutzfunktion,immissionsschutzfunktion,laermschutzfunktion,sichtschutzfunktion', opacity: 0.55, minZoom: 12 },
  { key: 'schaden', label: 'Waldschadflächen', group: 'Wald', url: FORST, layers: 'waldschaeden', opacity: 0.65, minZoom: 12 },
  { key: 'schutz', label: 'Schutzgebiete (NSG, LSG)', group: 'Naturschutz', url: `${GP}/SCHUTZGEB`, layers: 'lsg,nsg', opacity: 0.55, minZoom: 8 },
  { key: 'natura', label: 'Natura 2000 (FFH, Vogelschutz)', group: 'Naturschutz', url: `${GP}/SCHUTZGEB`, layers: 'spa,ffh_geb', opacity: 0.55, minZoom: 8 },
  { key: 'lrt', label: 'Waldlebensraumtypen (LRT)', group: 'Naturschutz', url: FORST, layers: 'waldlebensraumtypen', opacity: 0.65, minZoom: 12 },
  { key: 'waldbiotope', label: 'Waldbiotope', group: 'Naturschutz', url: FORST, layers: 'waldbiotope', opacity: 0.65, minZoom: 12 },
  { key: 'biotope', label: 'Offenlandbiotope', group: 'Naturschutz', url: GP, layers: 'obk1_flaechen,obk1_linien,obk1_punkte', opacity: 0.7, minZoom: 13 },
];

/**
 * GetFeatureInfo-URL für eine Anzeige im iframe (kein CORS nötig).
 * spanM: Kantenlänge des Abfragefensters in Metern. Mit pixels = 1 gilt das
 * ganze Fenster als ein Pixel → liefert alle Objekte im Umkreis (z. B. Rettungspunkte).
 */
export function infoUrl(url, layers, [lat, lng], { spanM = 60, pixels = 101, count = 5 } = {}) {
  const R = 6378137;
  const x = (lng * Math.PI / 180) * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
  const k = 1 / Math.cos(lat * Math.PI / 180); // Web-Mercator-Streckung
  const half = (spanM / 2) * k;
  const c = Math.floor(pixels / 2);
  const q = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: layers, QUERY_LAYERS: layers, STYLES: '',
    CRS: 'EPSG:3857', BBOX: [x - half, y - half, x + half, y + half].join(','), WIDTH: String(pixels), HEIGHT: String(pixels),
    I: String(c), J: String(c), INFO_FORMAT: 'text/html', FEATURE_COUNT: String(count),
  });
  return `${url}?${q}`;
}

export const INFO_SOURCES = {
  forst: (ll) => infoUrl(FORST, 'standort_fl,bodenschutzfunktion,erholungswald,erholungsfunktion,klimaschutzfunktion,waldbiotope,waldlebensraumtypen', ll, { count: 10 }),
  schutz: (ll) => infoUrl(`${GP}/SCHUTZGEB`, 'nsg,lsg,ffh_geb,spa,naturpark', ll, { count: 10 }),
  rettung: (ll) => infoUrl(FORST, 'rettungspunkte', ll, { spanM: 4000, pixels: 1, count: 3 }),
};

/** Erklärungen für die Legenden-„i“ in „Weitere Layer“ */
export const LAYER_INFO = {
  alkis: { title: 'Flurstücksgrenzen (ALKIS)', text: 'Amtliche Flurstücksgrenzen mit Flurstücksnummern aus dem Liegenschaftskataster Thüringen. Gut zur Orientierung, aber keine rechtsverbindliche Grenzfeststellung – die macht nur ein Vermesser.', legend: [[`${GP}/adv_alkis_wms_th`, 'adv_alkis_flurstuecke']] },
  rettung: { title: 'Rettungspunkte', text: 'Forstliche Rettungspunkte von ThüringenForst und Bundesforst. Hier treffen sich Rettungsdienst und Hilfesuchende. Im Notfall 112 anrufen und die Nummer des Rettungspunkts nennen (z. B. SOK-6456). Die Schilder hängen meist an Wegkreuzungen.' },
  standort: { title: 'Standortkarte (Forst)', text: 'Ergebnis der forstlichen Standortskartierung: Wie gut ist der Boden mit Nährstoffen (Nährkraft) und Wasser versorgt, in welcher Klimastufe liegt die Fläche? Das ist die wichtigste Grundlage dafür, welche Baumarten hier dauerhaft gut wachsen.' },
  waldfunktionen: { title: 'Waldfunktionen', text: 'Besondere Aufgaben des Waldes neben der Holzerzeugung: Bodenschutz an steilen Hängen, Erholung, Klima-, Immissions-, Lärm- und Sichtschutz. Bei Maßnahmen sollen diese Funktionen erhalten bleiben – z. B. keine Kahlschläge im Bodenschutzwald.' },
  schaden: { title: 'Waldschadflächen', text: 'Flächen, auf denen der Wald nach Dürre, Sturm oder Borkenkäferbefall abgestorben oder bereits geräumt ist. Sie müssen wieder bewaldet werden; dafür gibt es Fördermittel.' },
  schutz: { title: 'Schutzgebiete (NSG, LSG)', text: 'Naturschutzgebiete (NSG) haben strenge Regeln, oft mit Einschränkungen für Holzernte und Wegebau. Landschaftsschutzgebiete (LSG) schützen das Landschaftsbild, ordnungsgemäße Forstwirtschaft ist meist erlaubt. Vor größeren Maßnahmen die Schutzgebietsverordnung prüfen oder die Untere Naturschutzbehörde fragen.' },
  natura: { title: 'Natura 2000', text: 'Europäisches Schutzgebietsnetz aus FFH-Gebieten (seltene Lebensräume und Arten) und Vogelschutzgebieten. Es gilt ein Verschlechterungsverbot: Der Zustand von Lebensräumen und Arten darf sich durch Maßnahmen nicht verschlechtern. Für viele Gebiete gibt es Managementpläne.' },
  lrt: { title: 'Waldlebensraumtypen (LRT)', text: 'Nach der FFH-Richtlinie geschützte Waldgesellschaften innerhalb von FFH-Gebieten, z. B. Hainsimsen-Buchenwald (9110) oder Schlucht- und Hangmischwald (9180). Die typischen Baumarten sollen erhalten bleiben – also z. B. keine Umwandlung in Nadelholz.' },
  waldbiotope: { title: 'Waldbiotope', text: 'Besonders wertvolle Bereiche im Wald aus der Waldbiotopkartierung, z. B. Quellbereiche, Blockschutthalden, naturnahe Bachläufe oder alte Eichenwälder. Viele sind gesetzlich geschützt (§ 30 BNatSchG) und dürfen nicht beeinträchtigt werden.' },
  biotope: { title: 'Offenlandbiotope', text: 'Kartierte wertvolle Flächen außerhalb des Waldes, z. B. Magerrasen, Feuchtwiesen, Hecken und Streuobstwiesen. Gesetzlich geschützte Biotope dürfen nicht zerstört oder erheblich beeinträchtigt werden.' },
};

export function legendUrls(key) {
  const info = LAYER_INFO[key];
  const pairs = info?.legend || (() => { const o = OVERLAYS.find((x) => x.key === key); return o ? o.layers.split(',').map((l) => [o.url, l]) : []; })();
  return pairs.map(([url, layer]) => ({ layer, src: `${url}?${new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetLegendGraphic', FORMAT: 'image/png', LAYER: layer, SLD_VERSION: '1.1.0' })}` }));
}

export function overlayLayer(o) {
  return wms(o.url, o.layers, { opacity: o.opacity ?? 0.85, minZoom: o.minZoom ?? 10 });
}

// ---------- Nächste Rettungspunkte (live, ohne Speicherung) ----------
// Der Dienst bietet keinen Download und keine Umkreissuche. Deshalb: Kartenbild
// der Ebene laden, Symbole finden, je Symbol die Objektinformation abfragen
// (Punktnummer, WGS-Koordinaten, Anfahrtsbeschreibung). Ergebnisse nur im Speicher.
const rescueCache = new Map();

function mercBBox([lat, lng], spanM) {
  const R = 6378137;
  const x = (lng * Math.PI / 180) * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
  const half = (spanM / 2) / Math.cos(lat * Math.PI / 180);
  return [x - half, y - half, x + half, y + half];
}

function findBlobs(alpha, w, h, minN = 20) {
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let i = 0; i < alpha.length; i++) {
    if (seen[i] || alpha[i] < 60) continue;
    const stack = [i]; seen[i] = 1;
    let sx = 0, sy = 0, n = 0;
    while (stack.length) {
      const j = stack.pop(); const x = j % w, y = (j / w) | 0;
      sx += x; sy += y; n++;
      for (const k of [j + 1, j - 1, j + w, j - w]) {
        if (k < 0 || k >= alpha.length || seen[k] || alpha[k] < 60) continue;
        if ((k === j + 1 && x === w - 1) || (k === j - 1 && x === 0)) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    if (n >= minN) out.push({ x: sx / n, y: sy / n, n });
  }
  return out;
}

async function scanRescue(latlng, spanM, px) {
  const bb = mercBBox(latlng, spanM);
  const common = { SERVICE: 'WMS', VERSION: '1.3.0', LAYERS: 'rettungspunkte', STYLES: '', CRS: 'EPSG:3857', BBOX: bb.join(','), WIDTH: String(px), HEIGHT: String(px) };
  const res = await fetch(`${FORST}?${new URLSearchParams({ ...common, REQUEST: 'GetMap', FORMAT: 'image/png', TRANSPARENT: 'true' })}`, { mode: 'cors' });
  if (!res.ok || !/png/.test(res.headers.get('content-type') || '')) throw new Error('Kartenbild der Rettungspunkte nicht verfügbar');
  const bmp = await createImageBitmap(await res.blob());
  const cv = document.createElement('canvas'); cv.width = px; cv.height = px;
  const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, px, px).data;
  const alpha = new Uint8Array(px * px);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  const blobs = findBlobs(alpha, px, px)
    .map((b) => ({ ...b, d: Math.hypot(b.x - px / 2, b.y - px / 2) }))
    .sort((a, b) => a.d - b.d).slice(0, 8);

  const points = new Map();
  await Promise.all(blobs.map(async (b) => {
    const q = new URLSearchParams({ ...common, REQUEST: 'GetFeatureInfo', QUERY_LAYERS: 'rettungspunkte', INFO_FORMAT: 'application/vnd.ogc.gml',
      I: String(Math.round(b.x)), J: String(Math.round(b.y)), FEATURE_COUNT: '3' });
    try {
      const xml = await (await fetch(`${FORST}?${q}`, { mode: 'cors' })).text();
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      for (const f of doc.getElementsByTagNameNS('*', 'featureMember').length ? doc.getElementsByTagNameNS('*', 'featureMember') : [doc.documentElement]) {
        const get = (n) => f.getElementsByTagNameNS('*', n)[0]?.textContent.trim() || '';
        const nr = get('Punktnummer');
        const lat = Number(get('WGS_Breite').replace(',', '.')), lng = Number(get('WGS_Laenge').replace(',', '.'));
        if (!nr || !Number.isFinite(lat) || !Number.isFinite(lng) || !lat) continue;
        points.set(nr, { id: nr, at: [lat, lng], access: get('Anfahrtsbeschreibung'), signed: get('beschildert'), source: get('Urheber') });
      }
    } catch { /* einzelner Punkt nicht abfragbar */ }
  }));
  return [...points.values()];
}

/**
 * Sucht in einem WMS-Layer alle dargestellten Objekte innerhalb eines Rahmens (Kartenbild → Flecken)
 * und fragt zu jedem Fleck die Sachdaten ab (GetFeatureInfo). Gibt [{ at, props }] zurück.
 */
export async function scanWmsLayer(url, layer, { s: so, w, n, e }, { maxPx = 1024, max = 12 } = {}) {
  const R = 6378137;
  const mx = (lng) => (lng * Math.PI / 180) * R;
  const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
  const pad = 30 / Math.cos(((so + n) / 2) * Math.PI / 180);
  const bb = [mx(w) - pad, my(so) - pad, mx(e) + pad, my(n) + pad];
  const mpp = Math.max((bb[2] - bb[0]) / maxPx, (bb[3] - bb[1]) / maxPx, 1);
  const W = Math.max(64, Math.round((bb[2] - bb[0]) / mpp)), H = Math.max(64, Math.round((bb[3] - bb[1]) / mpp));
  const common = { SERVICE: 'WMS', VERSION: '1.3.0', LAYERS: layer, STYLES: '', CRS: 'EPSG:3857', BBOX: bb.join(','), WIDTH: String(W), HEIGHT: String(H) };
  const res = await fetch(`${url}?${new URLSearchParams({ ...common, REQUEST: 'GetMap', FORMAT: 'image/png', TRANSPARENT: 'true' })}`, { mode: 'cors' });
  if (!res.ok || !/png/.test(res.headers.get('content-type') || '')) throw new Error(`Kartenbild ${layer} nicht verfügbar`);
  const bmp = await createImageBitmap(await res.blob());
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const alpha = new Uint8Array(W * H);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  const toLL = (px, py) => {
    const x = bb[0] + (px + 0.5) * (bb[2] - bb[0]) / W, y = bb[3] - (py + 0.5) * (bb[3] - bb[1]) / H;
    return [(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI, x / R * 180 / Math.PI];
  };
  const blobs = findBlobs(alpha, W, H, 6).sort((a, b) => b.n - a.n).slice(0, max);
  return Promise.all(blobs.map(async (b) => {
    const at = toLL(b.x, b.y);
    let props = {};
    try {
      const q = new URLSearchParams({ ...common, REQUEST: 'GetFeatureInfo', QUERY_LAYERS: layer, INFO_FORMAT: 'application/vnd.ogc.gml', I: String(Math.round(b.x)), J: String(Math.round(b.y)), FEATURE_COUNT: '1' });
      const xml = await (await fetch(`${url}?${q}`, { mode: 'cors' })).text();
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      for (const el of doc.getElementsByTagName('*')) {
        if (el.children.length) continue;
        const k = el.localName, v = el.textContent.trim();
        if (v && v !== 'missing' && !/^(coordinates|pos|posList|null|boundedBy|Box|gml_id|OBJECTID|FID|Shape_.*)$/.test(k) && !(k in props)) props[k] = v;
      }
    } catch { /* Sachdaten nicht abrufbar */ }
    return { at, px: b.n * mpp * mpp, props };
  }));
}

/** Nächste Rettungspunkte zum Punkt [lat, lng], sortiert nach Luftlinie */
export async function nearestRescue(latlng, n = 2) {
  const key = latlng.map((v) => v.toFixed(3)).join(',');
  if (rescueCache.has(key)) return rescueCache.get(key);
  const job = (async () => {
    let pts = await scanRescue(latlng, 6000, 512);
    if (pts.length < n) pts = [...new Map([...pts, ...(await scanRescue(latlng, 16000, 768))].map((p) => [p.id, p])).values()];
    const { distance, bearing } = await import('../geo.js');
    return pts.map((p) => ({ ...p, dist: distance(latlng, p.at), brg: bearing(latlng, p.at) }))
      .sort((a, b) => a.dist - b.dist).slice(0, n);
  })();
  rescueCache.set(key, job);
  job.catch(() => rescueCache.delete(key));
  return job;
}


/** Amtliche Daten eines Flurstücks frisch holen (vollständige Geometrie mit Teilflächen und Löchern,
 *  amtliche Fläche, Nutzung) – für gespeicherte Flurstücke aus älteren App-Versionen */
export async function parcelExact(p) {
  if (!p || p.source !== 'alkis') return p;
  const probe = generateGrid(p.ring, 4, { polys: polysOf(p) })[0];
  try {
    const loc = await localParcelAt(probe);
    if (loc && loc.id === p.id) return { ...p, ...loc };
  } catch { /* weiter mit WFS */ }
  try {
    const w = await wfsParcelAt(probe);
    if (w && w.id === p.id) return { ...p, ...w };
  } catch { /* offline: gespeicherte Daten */ }
  return p;
}
