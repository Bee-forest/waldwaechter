// Ebene „Wege“: Waldwegenetz aus OpenStreetMap (live über Overpass, nichts gespeichert außer im Sitzungs-Cache),
// kräftig gezeichnet, damit es auf Luftbild und OSM-Karte gut zu sehen ist.
// LKW-fähige Wege (Fahrwege, Wirtschaftswege grade1/2) breit, Rückewege schmaler, Pfade gestrichelt.

export const WEGE_MIN_ZOOM = 13;
const ZELLE = 0.02; // Kachelraster in Grad – lädt nur, was noch fehlt
const cache = new Map(); // zelle → elements (gilt für alle Karten der Sitzung)
const laufend = new Map();

/** Stil je Wegeart: [Kontur, Füllung, Breite, Strichmuster] */
export function wegStil(t = {}) {
  const hw = t.highway;
  if (/^(secondary|tertiary|unclassified|residential)$/.test(hw)) return { art: 'strasse', rand: '#3A3A3A', farbe: '#FFFFFF', w: 5 };
  if (hw === 'service') return { art: 'fahrweg', rand: '#3A2A14', farbe: '#FFE9A8', w: 4.5 };
  if (hw === 'track') {
    const g = t.tracktype;
    if (g === 'grade1' || g === 'grade2') return { art: 'fahrweg', rand: '#3A2A14', farbe: '#F2C14E', w: 4.5 };
    return { art: 'rueckeweg', rand: '#3A2A14', farbe: '#E8A33D', w: 3.2, strich: g === 'grade4' || g === 'grade5' ? '8 5' : null };
  }
  return { art: 'pfad', rand: '#3A2A14', farbe: '#FFFFFF', w: 2, strich: '4 4' };
}

async function zelleLaden(key) {
  if (cache.has(key)) return cache.get(key);
  if (laufend.has(key)) return laufend.get(key);
  const [i, j] = key.split(':').map(Number);
  const s = i * ZELLE, w = j * ZELLE;
  const q = `[out:json][timeout:25];way["highway"~"^(track|path|service|unclassified|residential|tertiary|secondary|bridleway|footway)$"](${s},${w},${s + ZELLE},${w + ZELLE});out geom tags;`;
  const p = fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { const el = (j?.elements || []).filter((x) => x.geometry); if (j) cache.set(key, el); return el; })
    .catch(() => null)
    .finally(() => laufend.delete(key));
  laufend.set(key, p);
  return p;
}

/** Wege im Ausschnitt [s, w, n, e] (z. B. fürs PDF); null bei Fehler */
export async function wegeImAusschnitt(s, w, n, e) {
  const keys = [];
  for (let i = Math.floor(s / ZELLE); i <= Math.floor(n / ZELLE); i++) for (let j = Math.floor(w / ZELLE); j <= Math.floor(e / ZELLE); j++) keys.push(`${i}:${j}`);
  if (keys.length > 30) return null;
  const teile = await Promise.all(keys.map(zelleLaden));
  if (teile.some((t) => t == null)) return null;
  const seen = new Set();
  return teile.flat().filter((x) => !seen.has(x.id) && seen.add(x.id)).map((x) => ({ typ: x.tags?.highway, tags: x.tags || {}, pts: x.geometry.map((g) => [g.lat, g.lon]) }));
}

export function createWegeLayer() {
  const grp = L.layerGroup();
  const renderer = L.canvas({ padding: 0.4 });
  let map = null, timer = 0;
  const gezeichnet = new Set();
  async function laden() {
    if (!map || map.getZoom() < WEGE_MIN_ZOOM) { grp.clearLayers(); gezeichnet.clear(); return; }
    if (!map.getSize().x || !map.getSize().y) { clearTimeout(timer); timer = setTimeout(laden, 300); return; } // Karte noch nicht sichtbar
    const b = map.getBounds().pad(0.2);
    const wege = await wegeImAusschnitt(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
    if (!wege || !map) return;
    // zuerst alle Konturen, dann alle Füllungen – so sehen Kreuzungen sauber aus
    const neu = wege.filter((x) => !gezeichnet.has(x.pts.join()));
    const st = neu.map((x) => [x, wegStil(x.tags)]);
    for (const [x, s] of st) L.polyline(x.pts, { renderer, interactive: false, color: s.rand, weight: s.w + 2.5, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(grp);
    for (const [x, s] of st) { L.polyline(x.pts, { renderer, interactive: false, color: s.farbe, weight: s.w, opacity: 1, dashArray: s.strich, lineCap: s.strich ? 'butt' : 'round', lineJoin: 'round' }).addTo(grp); gezeichnet.add(x.pts.join()); }
  }
  const beiBewegung = () => { clearTimeout(timer); timer = setTimeout(laden, 500); };
  // nach Größenänderung (Seite aufgebaut, Drehen) neu zeichnen
  const neu = () => { grp.clearLayers(); gezeichnet.clear(); beiBewegung(); };
  grp.on('add', () => { map = grp._map; map.on('moveend', beiBewegung); map.on('resize', neu); beiBewegung(); });
  grp.on('remove', () => { map?.off('moveend', beiBewegung); map?.off('resize', neu); grp.clearLayers(); gezeichnet.clear(); map = null; });
  return grp;
}
