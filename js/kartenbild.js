// Hintergrundbild (OSM oder Luftbild) für einen Kartenausschnitt, als JPEG zum Einbetten ins PDF.
// Lädt die Kacheln wie die Karte, setzt sie auf einer Leinwand zusammen und schneidet den Ausschnitt aus.
import { tileUrls } from './map/basemap.js';

const lon2px = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
const lat2px = (lat, z) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z; };

function ladeBild(url, ms = 10000) {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => { img.src = ''; res(null); }, ms);
    img.onload = () => { clearTimeout(t); res(img); };
    img.onerror = () => { clearTimeout(t); res(null); };
    img.src = url;
  });
}

/**
 * @param {{ nord, sued, west, ost, basemap: 'osm'|'dop', breitePx?: number }} o
 * @returns {Promise<{ jpeg: Uint8Array, w: number, h: number } | null>}  null, wenn keine Kachel geladen werden konnte
 */
export async function kartenBild({ nord, sued, west, ost, basemap = 'osm', breitePx = 1400 }) {
  const maxZ = basemap === 'osm' ? 19 : 20;
  let z = Math.ceil(Math.log2(breitePx / (((ost - west) / 360) * 256)));
  z = Math.max(10, Math.min(maxZ, z));
  // höchstens ca. 2400 Pixel Kantenlänge
  while (z > 10 && Math.max(lon2px(ost, z) - lon2px(west, z), lat2px(sued, z) - lat2px(nord, z)) > 2400) z--;
  const x0 = lon2px(west, z), x1 = lon2px(ost, z), y0 = lat2px(nord, z), y1 = lat2px(sued, z);
  const w = Math.max(1, Math.round(x1 - x0)), h = Math.max(1, Math.round(y1 - y0));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  const kacheln = [];
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++) {
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++) kacheln.push([tx, ty]);
  }
  let geladen = 0;
  // Ebenen nacheinander (Luftbild, dann Beschriftung), Kacheln je Ebene parallel
  const ebenen = tileUrls(basemap, z, 0, 0, { alkis: false }).length;
  for (let e = 0; e < ebenen; e++) {
    const bilder = await Promise.all(kacheln.map(([tx, ty]) => ladeBild(tileUrls(basemap, z, tx, ty, { alkis: false })[e])));
    bilder.forEach((img, i) => { if (img) { ctx.drawImage(img, kacheln[i][0] * 256 - x0, kacheln[i][1] * 256 - y0, 256, 256); if (e === 0) geladen++; } });
  }
  if (!geladen) return null;
  try {
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) return null;
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), w, h };
  } catch { return null; } // Leinwand durch fremde Kacheln gesperrt
}
export const KARTEN_QUELLE = { osm: '© OpenStreetMap-Mitwirkende', dop: 'Luftbild © GDI-Th, dl-de/by-2-0; Beschriftung © CARTO, © OpenStreetMap-Mitwirkende' };
