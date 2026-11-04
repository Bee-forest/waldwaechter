// Welcher Teil der Fläche ist Wald oder Gehölz? Nur dort wird das automatische Raster gelegt.
import { generateGrid, inPolys, polysOf, areaM2Polys } from '../geo.js';
import { waldMaske, istWald, nutzungAnteile } from '../map/thueringen.js';

/**
 * status: frei (selbst eingezeichnet – keine Prüfung), ganz (nur Wald/Gehölz), teil (Raster nur im Wald),
 *         kein (laut ALKIS kein Wald), fehler (Waldflächen nicht abrufbar – Raster über die ganze Fläche)
 */
export async function waldbereich(sel, mode) {
  if (!sel?.ring?.length) return null;
  if (mode === 'draw') return { status: 'frei' };
  const polys = polysOf(sel);
  const clip = sel.clip?.length ? sel.clip : null;
  const gesamtHa = sel.stand?.anteilHa ?? sel.flaecheHa ?? areaM2Polys(polys) / 10000;
  // Amtliche Nutzungsanteile des Flurstücks (Wald + Gehölz)
  const anteile = !clip && sel.parcel?.nutzungText
    ? nutzungAnteile({ nutzungText: sel.parcel.nutzungText, flaecheAmtlich: sel.flaecheHa != null ? sel.flaecheHa * 10000 : null, ring: sel.ring, polys })
    : null;
  if (anteile) {
    const wald = anteile.Wald || 0;
    if (wald <= 0) return { status: 'kein', waldHa: 0, gesamtHa, quelle: 'ALKIS-Nutzung' };
    if (Object.keys(anteile).every((k) => k === 'Wald')) return { status: 'ganz', waldHa: gesamtHa, gesamtHa, quelle: 'ALKIS-Nutzung' };
  }
  let maske;
  try { maske = await waldMaske(sel.ring); } catch { return { status: 'fehler', gesamtHa }; }
  let probe = generateGrid(sel.ring, 5, { polys });
  if (clip) probe = probe.filter((pt) => inPolys(pt, clip));
  const n = probe.length, w = probe.filter((pt) => istWald(maske, pt)).length;
  if (!n) return { status: 'fehler', gesamtHa };
  const anteil = w / n;
  if (anteil < 0.01) return { status: 'kein', waldHa: 0, gesamtHa, quelle: 'ALKIS-Nutzungskarte' };
  // Fläche: amtlicher Wald-/Gehölzanteil, sonst aus der Karte geschätzt
  const waldHa = anteile ? anteile.Wald : anteil * gesamtHa;
  if (anteil > 0.98) return { status: 'ganz', waldHa: anteile ? waldHa : gesamtHa, gesamtHa, quelle: 'ALKIS-Nutzungskarte' };
  return { status: 'teil', waldHa, gesamtHa, anteil, maske, quelle: anteile ? 'ALKIS-Nutzung' : 'ALKIS-Nutzungskarte' };
}

export const imWald = (wald, pt) => !wald?.maske || istWald(wald.maske, pt);
