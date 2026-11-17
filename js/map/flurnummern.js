// Layer „Flurstücksnummern“: schreibt die Nummer in jedes Flurstück (ab Zoomstufe 16).
// Quelle sind die mitgelieferten ALKIS-Kacheln und die bereits geladenen Flurstücke.
import { parcelsNear } from './thueringen.js';
import { polysOf, inPolys, centroid } from '../geo.js';

export const NUMMERN_MIN_ZOOM = 16;

/** Punkt sicher im Flurstück (Schwerpunkt, sonst Suche im Raster) */
export function innenPunkt(p) {
  const polys = polysOf(p);
  if (!polys.length) return null;
  const ring = polys.map((x) => x[0]).sort((a, b) => b.length - a.length)[0];
  const c = centroid(ring);
  if (inPolys(c, polys)) return c;
  let s = 90, w = 180, n = -90, e = -180;
  for (const [la, lo] of ring) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  let best = null, bd = Infinity;
  for (let i = 1; i < 12; i++) for (let k = 1; k < 12; k++) {
    const pt = [s + ((n - s) * i) / 12, w + ((e - w) * k) / 12];
    if (!inPolys(pt, polys)) continue;
    const d = (pt[0] - c[0]) ** 2 + (pt[1] - c[1]) ** 2;
    if (d < bd) { bd = d; best = pt; }
  }
  return best || ring[0];
}

/**
 * @param {L.Map} map
 * @param {() => Array} weitere  zusätzlich bekannte Flurstücke (z. B. eigene Flächen)
 */
export function createFlurnummernLayer(map, weitere = () => []) {
  const group = L.layerGroup();
  let timer = 0, lauf = 0;
  const punkte = new Map(); // id → Punkt (Berechnung nur einmal)
  async function zeichne() {
    if (!map.hasLayer(group)) return;
    if (map.getZoom() < NUMMERN_MIN_ZOOM) { group.clearLayers(); return; }
    const t = ++lauf;
    const b = map.getBounds();
    const rahmen = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
    const liste = await parcelsNear(rahmen).catch(() => []);
    if (t !== lauf) return;
    const alle = new Map();
    for (const p of [...liste, ...weitere()]) if (p?.id && p.nr) alle.set(p.id, p);
    const innen = b.pad(0.05);
    group.clearLayers();
    let n = 0;
    for (const p of alle.values()) {
      if (!punkte.has(p.id)) punkte.set(p.id, innenPunkt(p));
      const pt = punkte.get(p.id);
      if (!pt || !innen.contains(pt)) continue;
      if (++n > 700) break;
      group.addLayer(L.marker(pt, { interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'flurnr', html: `<span>${String(p.nr).replace(/[<>&]/g, '')}</span>`, iconSize: null }) }));
    }
  }
  map.on('moveend', () => { clearTimeout(timer); timer = setTimeout(zeichne, 250); });
  group.on('add', zeichne);
  return group;
}
