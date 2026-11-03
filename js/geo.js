// Geometrie-Hilfen ohne externe Abhängigkeiten.
// Koordinaten: [lat, lng] (wie Leaflet). Für Flächen und Raster wird lokal
// in ein metrisches System (äquirektangulär um einen Ursprung) projiziert –
// für Bestände bis einige km Ausdehnung ist der Fehler vernachlässigbar.

const R = 6371008.8; // mittlerer Erdradius in m
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function makeProjector([lat0, lng0]) {
  const kx = Math.cos(rad(lat0)) * (Math.PI / 180) * R;
  const ky = (Math.PI / 180) * R;
  return {
    toXY: ([lat, lng]) => [(lng - lng0) * kx, (lat - lat0) * ky],
    toLatLng: ([x, y]) => [lat0 + y / ky, lng0 + x / kx],
  };
}

export function centroid(ring) {
  let la = 0, ln = 0;
  for (const [a, b] of ring) { la += a; ln += b; }
  return [la / ring.length, ln / ring.length];
}

export function bbox(ring) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const [a, b] of ring) {
    if (a < s) s = a; if (a > n) n = a;
    if (b < w) w = b; if (b > e) e = b;
  }
  return { s, w, n, e };
}

/** Fläche eines Polygons in m² */
export function areaM2(ring) {
  if (!ring || ring.length < 3) return 0;
  const p = makeProjector(centroid(ring));
  const xy = ring.map(p.toXY);
  let a = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    a += (xy[j][0] + xy[i][0]) * (xy[j][1] - xy[i][1]);
  }
  return Math.abs(a / 2);
}

export const areaHa = (ring) => areaM2(ring) / 10000;

// Flurstücke können aus mehreren Teilflächen mit Löchern bestehen:
// polys = [[außen, loch, …], [außen2, …]]; ohne polys gilt der einfache Ring.
export const polysOf = (o) => (o?.polys?.length ? o.polys : o?.ring ? [[o.ring]] : []);
export const areaM2Polys = (polys) => polys.reduce((s, [ext, ...holes]) => s + areaM2(ext) - holes.reduce((h, r) => h + areaM2(r), 0), 0);
export function inPolys(pt, polys) {
  return polys.some(([ext, ...holes]) => pointInPolygon(pt, ext) && !holes.some((r) => pointInPolygon(pt, r)));
}

export function pointInPolygon([lat, lng], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Entfernung in Metern (Haversine) */
export function distance([la1, lo1], [la2, lo2]) {
  const dLa = rad(la2 - la1), dLo = rad(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Richtung von a nach b in Grad (0 = Nord, im Uhrzeigersinn) */
export function bearing([la1, lo1], [la2, lo2]) {
  const y = Math.sin(rad(lo2 - lo1)) * Math.cos(rad(la2));
  const x = Math.cos(rad(la1)) * Math.sin(rad(la2)) - Math.sin(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
export const compassLabel = (b) => DIRS[Math.round(b / 45) % 8];

/** Punkt in Richtung `brg` (Grad) um `dist` Meter verschieben */
export function destination([lat, lng], brg, dist) {
  const p = makeProjector([lat, lng]);
  return p.toLatLng([Math.sin(rad(brg)) * dist, Math.cos(rad(brg)) * dist]);
}

/**
 * Quadratisches Raster über ein Polygon legen.
 * Liefert die Punkte in Schlangenlinien-Reihenfolge (Reihe für Reihe,
 * abwechselnd West→Ost und Ost→West), damit der Laufweg kurz bleibt.
 */
export function generateGrid(ring, spacing, { rand = null, polys = null, offset = null } = {}) {
  const ps = polys?.length ? polys : [[ring]];
  const p = makeProjector(centroid(ring));
  const xy = ps.flatMap((poly) => poly[0]).map(p.toXY);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of xy) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // Raster am Polygon-Mittelpunkt ausrichten, damit es symmetrisch sitzt
  // rand: fester Abstand der ersten Reihe/Spalte vom Rand (Startpunkt im Nordwesten), sonst mittig
  // offset: [x, y] in m ab Westrand/Nordrand (zufällige Rasterlage), 0 ≤ x, y < spacing
  const offX = offset ? offset[0] : rand ?? ((maxX - minX) % spacing) / 2 + spacing / 2;
  const offY = offset ? offset[1] : rand ?? ((maxY - minY) % spacing) / 2 + spacing / 2;
  const rows = [];
  for (let y = maxY - offY; y >= minY; y -= spacing) { // von Nord nach Süd
    const row = [];
    for (let x = minX + offX; x <= maxX; x += spacing) {
      const ll = p.toLatLng([x, y]);
      if (inPolys(ll, ps)) row.push(ll);
    }
    if (row.length) rows.push(row);
  }
  const out = [];
  rows.forEach((row, i) => out.push(...(i % 2 ? row.reverse() : row)));
  // Fallback für sehr kleine Flächen: mindestens ein Punkt im Schwerpunkt
  if (!out.length) out.push(centroid(ring));
  return out;
}

export function formatHa(ha) {
  if (!Number.isFinite(ha)) return '– ha';
  return ha.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha';
}

export function formatDist(m) {
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' km';
}

// ---------- ETRS89 / UTM Zone 32N (EPSG:25832), GRS80 ----------
const A = 6378137, F = 1 / 298.257222101, K0 = 0.9996, E0 = 500000;
const E2 = F * (2 - F), EP2 = E2 / (1 - E2), L0 = rad(9);

export function toUTM32([lat, lon]) {
  const la = rad(lat), lo = rad(lon);
  const n = A / Math.sqrt(1 - E2 * Math.sin(la) ** 2);
  const t = Math.tan(la) ** 2, c = EP2 * Math.cos(la) ** 2, a = Math.cos(la) * (lo - L0);
  const m = A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * la - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * la)
    + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * la) - (35 * E2 ** 3 / 3072) * Math.sin(6 * la));
  const x = E0 + K0 * n * (a + (1 - t + c) * a ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5 / 120);
  const y = K0 * (m + n * Math.tan(la) * (a * a / 2 + (5 - t + 9 * c + 4 * c * c) * a ** 4 / 24 + (61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6 / 720));
  return [x, y];
}

export function fromUTM32([x, y]) {
  const mu = (y / K0) / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const n1 = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2), t1 = Math.tan(p) ** 2, c1 = EP2 * Math.cos(p) ** 2;
  const r1 = A * (1 - E2) / (1 - E2 * Math.sin(p) ** 2) ** 1.5, d = (x - E0) / (n1 * K0);
  const lat = p - (n1 * Math.tan(p) / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6 / 720);
  const lon = L0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5 / 120) / Math.cos(p);
  return [deg(lat), deg(lon)];
}
