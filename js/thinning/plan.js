// Rechenkern der Durchforstungsmethode (ohne UI, gut testbar).
import { areaHa, generateGrid, inPolys, polysOf, areaM2Polys } from '../geo.js';
import { imWald } from './wald.js';
import { bestimme, DIMENSION, RASTER_M, amPunkt, QUALITAET_TEXT, AUSWAHL_TEXT } from './methode.js';

export const SPECIES = ['Fichte', 'Kiefer', 'Lärche', 'Douglasie', 'Tanne', 'Buche', 'Eiche', 'Bergahorn', 'Esche', 'Birke', 'Erle'];

export const THINNING_TYPES = {
  nieder:  { label: 'Niederdurchforstung', factor: [0.6, 0.9],  hint: 'Schwache, unterdrückte und kranke Bäume entnehmen. Herrschende Bäume bleiben stehen.' },
  hoch:    { label: 'Hochdurchforstung',   factor: [0.9, 1.25], hint: 'Konkurrenten der besten herrschenden Bäume entnehmen. Der Unterstand bleibt als Bodenschutz.' },
  auslese: { label: 'Auslesedurchforstung (Z-Bäume)', factor: [1.0, 1.4], hint: 'Z-Baum festlegen und seine ein bis zwei stärksten Bedränger in der Krone entnehmen.' },
};

/**
 * @param {Array<[number,number]>} ring  Bestandesgrenze
 * @param {object} p
 *   p.species  [{ name, share (%), dg (cm) }]
 *   p.nIst     Stammzahl je ha vor dem Eingriff
 *   p.nZiel    Stammzahl je ha nach dem Eingriff
 *   p.type     nieder | hoch | auslese
 *   p.spacing  Rasterweite in m
 */
export function computePlan(ring, p) {
  const ha = areaHa(ring);
  const grid = generateGrid(ring, p.spacing);
  const n = grid.length;
  const perHa = Math.max(0, p.nIst - p.nZiel);
  const total = Math.round(perHa * ha);

  // Gesamtentnahme je Baumart (Größte-Reste-Verfahren, Summe bleibt exakt)
  const shareSum = p.species.reduce((s, x) => s + x.share, 0) || 1;
  const raw = p.species.map((x) => (total * x.share) / shareSum);
  const tot = raw.map(Math.floor);
  let rest = total - tot.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest-- > 0) tot[i]++; });

  const [f0, f1] = THINNING_TYPES[p.type].factor;
  const points = grid.map((at, i) => ({
    id: i + 1,
    at,
    status: 'open', // open | done | skipped
    removals: p.species.map((sp, s) => ({
      species: sp.name,
      // gleichmäßige Verteilung auf die Punkte, Summe je Baumart bleibt exakt
      count: Math.floor(((i + 1) * tot[s]) / n) - Math.floor((i * tot[s]) / n),
      dmin: Math.max(7, Math.round(sp.dg * f0)),
      dmax: Math.max(8, Math.round(sp.dg * f1)),
      marked: 0,
    })).filter((r) => r.count > 0),
  }));

  return {
    areaHa: ha,
    perHa,
    total,
    cellM2: p.spacing * p.spacing,
    points,
    hint: THINNING_TYPES[p.type].hint,
  };
}

export const pointRemaining = (pt) => pt.removals.reduce((s, r) => s + Math.max(0, r.count - r.marked), 0);
export const pointTotal = (pt) => pt.removals.reduce((s, r) => s + r.count, 0);

// ---------- Neue Methode (Raster-Verfahren, siehe methode.js) ----------

export function zufallsLage() {
  return { offset: [Math.random(), Math.random()], relativ: true, umkehren: Math.random() < 0.5, erzeugt: Date.now() };
}

export function computePlanMethode(sel, p, wald = null) {
  // wald: Ergebnis von waldbereich() – Raster nur auf Wald- und Gehölzflächen
  // sel: { ring, polys?, flaecheHa? } – bei Flurstücken amtliche Fläche und vollständige Geometrie
  const sh = Array.isArray(sel) ? { ring: sel } : sel;
  const polys = polysOf(sh);
  // Bestand aus dem Waldverzeichnis: nur der Teil innerhalb des Flurstücks (Fläche per 5-m-Stichprobe)
  const clip = sh.clip?.length ? sh.clip : null;
  const geoHa = clip
    ? generateGrid(sh.ring, 5, { polys }).filter((pt) => inPolys(pt, clip)).length * 25 / 10000
    : areaM2Polys(polys) / 10000;
  const flaeche = clip ? geoHa : sh.flaecheHa ?? geoHa;
  const ha = wald?.status === 'teil' ? wald.waldHa : wald?.status === 'kein' ? 0 : flaeche;
  const r = bestimme(p);
  const raster = r.raster || RASTER_M;
  p.spacing = raster;
  // Rasterlage bei jedem Eingriff zufällig neu (Versatz 0–25 m, Startecke zufällig), damit der Bestand
  // nicht immer an denselben Stellen bearbeitet wird. Einmal gewählt, bleibt sie für diesen Eingriff fest.
  p.eingriffNr ??= 1;
  p.lage ??= zufallsLage();
  const off = p.lage.relativ ? p.lage.offset.map((v) => v * raster) : p.lage.offset.map((v) => v % raster);
  let grid = generateGrid(sh.ring, raster, { offset: off, polys });
  if (clip) grid = grid.filter((pt) => inPolys(pt, clip));
  if (wald?.status === 'kein') grid = [];
  else if (wald?.status === 'teil') grid = grid.filter((pt) => imWald(wald, pt));
  if (p.lage.umkehren) grid = grid.reverse();
  // „in jedem n-ten Punkt“: fortlaufend über alle Punkte mitzählen
  const points = grid.map((at, i) => ({
    id: i + 1,
    at,
    status: 'open',
    removals: ['dick', 'mittel', 'duenn'].map((k) => {
      const d = DIMENSION[k];
      return { klasse: k, species: d.baum, count: amPunkt(r.jePunkt[k], i + 1), dmin: d.dmin, dmax: d.dmax ?? 99, marked: 0 };
    }).filter((x) => x.count > 0),
  }));
  const total = points.reduce((s2, pt) => s2 + pt.removals.reduce((a2, x) => a2 + x.count, 0), 0);
  return {
    methode: 'raster-2026-11',
    areaHa: ha,
    areaAmtlich: !clip && sh.flaecheHa != null && wald?.status !== 'teil',
    flaecheGesamtHa: flaeche,
    wald: wald ? { status: wald.status, waldHa: wald.waldHa ?? null, gesamtHa: wald.gesamtHa ?? flaeche, quelle: wald.quelle || null } : null,
    areaGeoHa: geoHa,
    stufe: r.stufe,
    eingriffe: { ...r.eingriffe, nr: p.eingriffNr },
    jePunktJahrzehnt: r.jePunktJahrzehnt,
    lage: p.lage,
    szenario: r.szenario,
    gruppeLabel: r.gruppeLabel,
    jePunkt: r.jePunkt,
    regel: r.regel,
    perHa: Math.round(r.baeumeHa),
    total,
    gZielHa: r.stufe,
    schritte: r.schritte,
    cellM2: raster * raster, raster, eng: !!r.eng, kreis: r.kreis, ausweichen: r.ausweichen,
    points,
    hint: QUALITAET_TEXT,
    auswahl: AUSWAHL_TEXT.replace('bis 15 m', `bis ${r.ausweichen || 15} m`),
  };
}

// ---------- Fassung 4: Mengenzähler (siehe f4.js) ----------
import { parameter, planung as planungF4, rasterAbstand } from './f4.js';

/** Fläche (ha) der Auswahl: amtlich, Waldanteil oder geometrisch */
export function flaecheDerAuswahl(sel, wald = null) {
  const sh = Array.isArray(sel) ? { ring: sel } : sel;
  const polys = polysOf(sh);
  const clip = sh.clip?.length ? sh.clip : null;
  const geoHa = clip ? generateGrid(sh.ring, 5, { polys }).filter((pt) => inPolys(pt, clip)).length * 25 / 10000 : areaM2Polys(polys) / 10000;
  const flaeche = clip ? geoHa : sh.flaecheHa ?? geoHa;
  const ha = wald?.status === 'teil' ? wald.waldHa : wald?.status === 'kein' ? 0 : flaeche;
  return { sh, polys, clip, geoHa, flaeche, ha };
}

/** Rasterpunkte nach Fassung 4: quadratisches Raster, zufälliger Versatz 0–Abstand in x und y, Schlangenlinie, nur Punkte im Polygon */
export function rasterF4(sel, wald, offsetRel, sz = null) {
  const { sh, polys, clip } = flaecheDerAuswahl(sel, wald);
  const R = parameter().raster;
  const punkteBei = (abstand) => {
    let g = generateGrid(sh.ring, abstand, { offset: offsetRel.map((v) => v * abstand), polys });
    if (clip) g = g.filter((pt) => inPolys(pt, clip));
    if (wald?.status === 'kein') g = [];
    else if (wald?.status === 'teil') g = g.filter((pt) => imWald(wald, pt));
    return g.filter((pt) => inPolys(pt, clip || polys)); // nur Punkte innerhalb des Polygons (kein Ersatzpunkt)
  };
  // Raster 25 m, in Szenario 3 (viele dünne Bäume) 12,5 m
  const start = rasterAbstand(sz);
  let abstand = start;
  let grid = punkteBei(abstand);
  // FESTLEGUNG: Kleine Flächen – weniger als 8 Punkte → Abstand verkleinern, bis mindestens 8 Punkte im Polygon liegen,
  // aber nicht unter 15 m (Szenario 3: nicht unter 10 m). Prüfkreis und Ausweichradius bleiben gleich. (Regel nicht simuliert.)
  const MIN_PUNKTE = 8, MIN_ABSTAND = Number(sz) === 3 ? 10 : 15;
  while (grid.length < MIN_PUNKTE && abstand > MIN_ABSTAND) { abstand = Math.max(MIN_ABSTAND, abstand - (start > 15 ? 1 : 0.5)); grid = punkteBei(abstand); }
  return { grid, abstand, verkleinert: abstand < start };
}

/**
 * Plan eines Eingriffs nach Fassung 4.
 * f: { art, nadel, ho, b, sz, eingriffNr, bisherGezaehltHa, offset? }
 */
export function computePlanF4(sel, f, wald = null) {
  const { flaeche, ha, geoHa, sh, clip } = flaecheDerAuswahl(sel, wald);
  f.eingriffNr ??= 1;
  // Versatz in x und y zufällig zwischen 0 und Rasterabstand, je Eingriff neu – einmal gewählt bleibt er für diesen Eingriff fest
  f.offset ??= [Math.random(), Math.random()];
  const r = rasterF4(sel, wald, f.offset, f.sz);
  const pl = planungF4({ art: f.art, nadel: f.nadel, ho: f.ho, b: f.b, sz: f.sz, flaecheHa: ha, eingriffNr: f.eingriffNr, bisherGezaehltHa: f.bisherGezaehltHa || 0 });
  const R = parameter().raster;
  return {
    methode: 'f4',
    version: parameter().version,
    areaHa: ha,
    areaAmtlich: !clip && sh.flaecheHa != null && wald?.status !== 'teil',
    flaecheGesamtHa: flaeche,
    areaGeoHa: geoHa,
    wald: wald ? { status: wald.status, waldHa: wald.waldHa ?? null, gesamtHa: wald.gesamtHa ?? flaeche, quelle: wald.quelle || null } : null,
    planung: pl,
    eingriffe: { nr: f.eingriffNr, anzahl: pl.eingriffe, abstandJahre: pl.abstandJahre },
    raster: r.abstand, rasterVerkleinert: r.verkleinert, kreis: R.pruefkreis_m, ausweichen: R.ausweich_m,
    offset: f.offset,
    points: r.grid.map((at, i) => ({ id: i + 1, at, status: 'open' })),
    auswahl: parameter().auswahl_rangfolge_baumart,
  };
}
