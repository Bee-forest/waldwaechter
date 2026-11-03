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
export function generateGrid(ring, spacing) {
  const p = makeProjector(centroid(ring));
  const xy = ring.map(p.toXY);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of xy) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // Raster am Polygon-Mittelpunkt ausrichten, damit es symmetrisch sitzt
  const offX = ((maxX - minX) % spacing) / 2 + spacing / 2;
  const offY = ((maxY - minY) % spacing) / 2 + spacing / 2;
  const rows = [];
  for (let y = maxY - offY; y >= minY; y -= spacing) { // von Nord nach Süd
    const row = [];
    for (let x = minX + offX; x <= maxX; x += spacing) {
      const ll = p.toLatLng([x, y]);
      if (pointInPolygon(ll, ring)) row.push(ll);
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
  return ha.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha';
}

export function formatDist(m) {
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' km';
}
