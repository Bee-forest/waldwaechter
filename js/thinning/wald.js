// Welcher Teil der Fläche ist Wald? Nur dort wird das automatische Raster gelegt.
// Maßgeblich ist die Waldfläche von ThüringenForst (wie im Thüringen-Viewer); die ALKIS-Nutzung
// sagt oft „Wald“ für das ganze Flurstück, auch wenn ein Teil Wiese ist – daher nicht als Abkürzung nutzen.
import { generateGrid, inPolys, polysOf, areaM2Polys } from '../geo.js';
import { waldMaske, istWald, WALD_QUELLEN } from '../map/thueringen.js';

/**
 * status: frei (selbst eingezeichnet – keine Prüfung), ganz (komplett Wald), teil (Raster nur im Wald),
 *         kein (kein Wald), fehler (Waldflächen nicht abrufbar – Raster über die ganze Fläche)
 */
export async function waldbereich(sel, mode) {
  if (!sel?.ring?.length) return null;
  if (mode === 'draw') return { status: 'frei' };
  const polys = polysOf(sel);
  const clip = sel.clip?.length ? sel.clip : null;
  const gesamtHa = sel.stand?.anteilHa ?? sel.flaecheHa ?? areaM2Polys(polys) / 10000;
  let maske = null;
  for (const q of WALD_QUELLEN) {
    try { maske = await waldMaske(sel.ring, q); break; } catch { /* nächste Quelle */ }
  }
  if (!maske) return { status: 'fehler', gesamtHa };
  let probe = generateGrid(sel.ring, 5, { polys });
  if (clip) probe = probe.filter((pt) => inPolys(pt, clip));
  const n = probe.length, w = probe.filter((pt) => istWald(maske, pt)).length;
  if (!n) return { status: 'fehler', gesamtHa };
  const anteil = w / n;
  const quelle = maske.quelle;
  if (anteil < 0.01) return { status: 'kein', waldHa: 0, gesamtHa, quelle };
  if (anteil > 0.98) return { status: 'ganz', waldHa: gesamtHa, gesamtHa, quelle };
  return { status: 'teil', waldHa: anteil * gesamtHa, gesamtHa, anteil, maske, quelle };
}

export const imWald = (wald, pt) => !wald?.maske || istWald(wald.maske, pt);
