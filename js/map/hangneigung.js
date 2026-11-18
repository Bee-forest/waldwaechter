// Hangneigung aus einem Geländemodell: Terrarium-Höhenkacheln (AWS Open Data, Mapzen/Tilezen;
// in Deutschland aus SRTM/EU-DEM, Auflösung ca. 30 m). Die Neigung wird im Browser berechnet –
// als farbige Kartenebene und als Auswertung für ein Flurstück mit Hinweis zur Befahrbarkeit.

const QUELLE = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const DATEN_Z = 14;   // feiner bringen die Kacheln keine echte Zusatzinformation
export const MIN_ZOOM = 12;

/** Neigungsklassen (Prozent) mit Faustwerten für die Holzernte */
export const KLASSEN = [
  { bis: 15, farbe: [76, 175, 80], hex: '#4CAF50', name: 'bis 15 %', kurz: 'eben bis flach', text: 'Radmaschinen (Harvester, Forwarder, Schlepper) ohne Einschränkung.' },
  { bis: 30, farbe: [205, 220, 57], hex: '#CDDC39', name: '15–30 %', kurz: 'befahrbar, mit Vorsicht', text: 'Befahrbar, beladen möglichst bergab rücken; bei Nässe Bänder oder Ketten.' },
  { bis: 50, farbe: [255, 152, 0], hex: '#FF9800', name: '30–50 %', kurz: 'nur mit Traktionshilfswinde', text: 'Befahrung nur mit Traktionshilfswinde (Seilunterstützung) oder Spezialmaschinen; erhöhte Gefahr von Boden- und Erosionsschäden.' },
  { bis: 70, farbe: [229, 57, 53], hex: '#E53935', name: '50–70 %', kurz: 'Steillage', text: 'Befahrung nur ausnahmsweise mit Traktionshilfswinde; meist Seilkran oder Seilwinde vom Weg aus.' },
  { bis: Infinity, farbe: [123, 31, 162], hex: '#7B1FA2', name: 'über 70 %', kurz: 'nicht befahrbar', text: 'Seilkran oder motormanuell mit Seilwinde – keine Befahrung.' },
];
export const klasseVon = (p) => KLASSEN.findIndex((k) => p < k.bis);
export const grad = (p) => Math.round(Math.atan(p / 100) * 180 / Math.PI);

// ---------- Höhenkacheln ----------
const cache = new Map();
function hoehen(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key);
  const p = new Promise((ok, fehler) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, 256, 256).data;
      const hgt = new Float32Array(256 * 256);
      for (let i = 0; i < hgt.length; i++) hgt[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      ok(hgt);
    };
    img.onerror = () => fehler(new Error('Höhendaten nicht erreichbar'));
    img.src = QUELLE(z, x, y);
  });
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  if (cache.size > 120) cache.delete(cache.keys().next().value);
  return p;
}
const pixelM = (z, y) => { const n = Math.PI - 2 * Math.PI * (y + 0.5) / 2 ** z; const lat = Math.atan(Math.sinh(n)); return 40075016.686 * Math.cos(lat) / (256 * 2 ** z); };

/** Neigung (%) und Hangrichtung (Grad, 0 = Nord, Richtung bergab) je Pixel einer Kachel */
const neigCache = new Map();
function neigung(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (neigCache.has(key)) return neigCache.get(key);
  const p = hoehen(z, x, y).then((hgt) => {
    const res = pixelM(z, y);
    const sl = new Float32Array(256 * 256), asp = new Float32Array(256 * 256);
    const H = (i, j) => hgt[Math.min(255, Math.max(0, j)) * 256 + Math.min(255, Math.max(0, i))];
    for (let j = 0; j < 256; j++) {
      for (let i = 0; i < 256; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(255, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(255, j + 1);
        // Sobel-Filter: glättet das Rauschen der Höhenkacheln
        const dx = ((H(i1, j0) + 2 * H(i1, j) + H(i1, j1)) - (H(i0, j0) + 2 * H(i0, j) + H(i0, j1))) / (4 * (i1 - i0) * res);
        const dy = ((H(i0, j1) + 2 * H(i, j1) + H(i1, j1)) - (H(i0, j0) + 2 * H(i, j0) + H(i1, j0))) / (4 * (j1 - j0) * res);
        sl[j * 256 + i] = Math.hypot(dx, dy) * 100;
        // bergab zeigt in Richtung -Gradient; y wächst nach Süden
        asp[j * 256 + i] = (Math.atan2(-dx, dy) * 180 / Math.PI + 360) % 360;
      }
    }
    return { sl, asp };
  });
  p.catch(() => neigCache.delete(key));
  neigCache.set(key, p);
  if (neigCache.size > 80) neigCache.delete(neigCache.keys().next().value);
  return p;
}

// ---------- Kartenebene ----------
export function createHangneigungLayer() {
  const Ebene = L.GridLayer.extend({
    createTile(coords, done) {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      if (coords.z < MIN_ZOOM) { setTimeout(() => done(null, c), 0); return c; }
      const zs = Math.min(coords.z, DATEN_Z), d = coords.z - zs, f = 2 ** d;
      const sx = coords.x >> d, sy = coords.y >> d;
      const ox = (coords.x - sx * f) * (256 / f), oy = (coords.y - sy * f) * (256 / f), n = 256 / f;
      neigung(zs, sx, sy).then(({ sl }) => {
        const tmp = document.createElement('canvas'); tmp.width = tmp.height = n;
        const tctx = tmp.getContext('2d');
        const img = tctx.createImageData(n, n);
        for (let j = 0; j < n; j++) {
          for (let i = 0; i < n; i++) {
            const k = KLASSEN[klasseVon(sl[(oy + j) * 256 + ox + i])];
            const o = (j * n + i) * 4;
            img.data[o] = k.farbe[0]; img.data[o + 1] = k.farbe[1]; img.data[o + 2] = k.farbe[2];
            img.data[o + 3] = k.bis === 15 ? 60 : 150; // flaches Gelände nur leicht tönen
          }
        }
        tctx.putImageData(img, 0, 0);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(tmp, 0, 0, 256, 256);
        done(null, c);
      }).catch((e) => done(e, c));
      return c;
    },
  });
  return new Ebene({ opacity: 0.75, minZoom: MIN_ZOOM, maxNativeZoom: 19, zIndex: 250, attribution: 'Gelände: Terrain Tiles (Mapzen/AWS Open Data; SRTM, EU-DEM)' });
}

// ---------- Auswertung einer Fläche ----------
const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ya, xa] = ring[i], [yb, xb] = ring[j];
    if ((ya > pt[0]) !== (yb > pt[0]) && pt[1] < (xb - xa) * (pt[0] - ya) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}
const inPolys = (pt, polys) => polys.some((rings) => inRing(pt, rings[0]) && !rings.slice(1).some((r) => inRing(pt, r)));
const HIMMEL = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'];

/**
 * Neigung innerhalb einer Fläche.
 * @param {Array} polys  [[ring, loch …], …] mit [lat, lng]
 * @returns {Promise<{ anteile: number[], mittel, p90, max, exposition, n } | null>}
 */
export async function analysiereFlaeche(polys) {
  const alle = polys.flat(2);
  if (!alle.length) return null;
  const lats = alle.map((p) => p[0]), lngs = alle.map((p) => p[1]);
  const latMax = Math.max(...lats), latMin = Math.min(...lats), lngMin = Math.min(...lngs), lngMax = Math.max(...lngs);
  let z = DATEN_Z;
  const kacheln = (zz) => ({ x0: Math.floor(lon2x(Math.min(...lngs), zz)), x1: Math.floor(lon2x(Math.max(...lngs), zz)), y0: Math.floor(lat2y(Math.max(...lats), zz)), y1: Math.floor(lat2y(Math.min(...lats), zz)) });
  let k = kacheln(z);
  while ((k.x1 - k.x0 + 1) * (k.y1 - k.y0 + 1) > 16 && z > 11) { z--; k = kacheln(z); }
  const werte = [], ex = [0, 0];
  for (let y = k.y0; y <= k.y1; y++) {
    for (let x = k.x0; x <= k.x1; x++) {
      const { sl, asp } = await neigung(z, x, y);
      for (let j = 0; j < 256; j++) {
        const lat = Math.atan(Math.sinh(Math.PI - 2 * Math.PI * (y + (j + 0.5) / 256) / 2 ** z)) * 180 / Math.PI;
        if (lat > latMax || lat < latMin) continue;
        for (let i = 0; i < 256; i++) {
          const lng = (x + (i + 0.5) / 256) / 2 ** z * 360 - 180;
          if (lng < lngMin || lng > lngMax || !inPolys([lat, lng], polys)) continue;
          const s = sl[j * 256 + i];
          werte.push(s);
          if (s > 5) { const a = asp[j * 256 + i] * Math.PI / 180; ex[0] += Math.sin(a) * s; ex[1] += Math.cos(a) * s; }
        }
      }
    }
  }
  if (!werte.length) return null;
  werte.sort((a, b) => a - b);
  const anteile = KLASSEN.map(() => 0);
  for (const s of werte) anteile[klasseVon(s)]++;
  const exSumme = werte.reduce((s, v) => s + (v > 5 ? v : 0), 0);
  const exStaerke = exSumme ? Math.hypot(ex[0], ex[1]) / exSumme : 0;
  return {
    anteile: anteile.map((a) => a / werte.length),
    mittel: werte.reduce((s, v) => s + v, 0) / werte.length,
    p90: werte[Math.floor(werte.length * 0.9)],
    p98: werte[Math.min(werte.length - 1, Math.floor(werte.length * 0.98))], // „max.“ ohne einzelne Ausreißer
    max: werte[werte.length - 1],
    exposition: exStaerke > 0.3 ? HIMMEL[Math.round(((Math.atan2(ex[0], ex[1]) * 180 / Math.PI + 360) % 360) / 45) % 8] : null,
    n: werte.length,
  };
}

/** Kurzurteil zur Befahrbarkeit aus den Anteilen der Neigungsklassen */
export function befahrbarkeit(a) {
  const bis15 = a.anteile[0], bis30 = bis15 + a.anteile[1], ueber50 = a.anteile[3] + a.anteile[4];
  if (bis15 >= 0.85) return { stufe: 0, titel: 'Gut befahrbar', text: 'Die Fläche ist eben bis flach. Harvester und Forwarder können ohne Einschränkung durch die Neigung fahren – entscheidend sind Boden und Nässe.' };
  if (bis30 >= 0.85) return { stufe: 1, titel: 'Befahrbar', text: 'Überwiegend mäßig geneigt. Mit Radmaschinen befahrbar; beladen möglichst bergab rücken, bei Nässe mit Bändern arbeiten.' };
  if (ueber50 >= 0.3) return { stufe: 3, titel: 'Großteils Steillage', text: 'Ein großer Teil ist steiler als 50 %. Hier kommt meist nur Seilkran oder Seilwinde vom Weg aus in Frage, in Teilen ggf. Traktionshilfswinde.' };
  return { stufe: 2, titel: 'Teilweise steil', text: 'Teile der Fläche sind steiler als 30 %. Dort nur mit Traktionshilfswinde oder angepasster Technik fahren; flache Teile normal befahrbar.' };
}
