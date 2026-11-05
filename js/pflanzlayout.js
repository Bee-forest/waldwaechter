// Pflanzplan als Reihen und Pflanzplätze: Reihen (2,5 m) parallel zu den Rückegassen, je Baumart ihr eigener
// Abstand in der Reihe (aus Pflanzen je ha). Mischungsformen einzeln, reihen-, trupp-, gruppen- und horstweise;
// einzelne Zellen lassen sich „übermalen“. Die Zahl der Pflanzplätze in der Karte ist genau die Pflanzenzahl.
import { areaHa } from './geo.js';

export const REIHE = 2.5;
const RAND = 1; // Abstand der ersten/letzten Pflanze zur Flächengrenze (m)
export const FORMEN = {
  einzeln: { label: 'Einzeln gemischt', zelle: 5, text: 'Die Baumarten stehen einzeln gemischt in den Reihen.' },
  reihen: { label: 'Reihenweise', zelle: 5, reihen: 3, text: 'Je drei Reihen eine Baumart.' },
  trupp: { label: 'Truppweise', zelle: 10, text: 'Trupps von etwa 10 × 10 m.' },
  gruppe: { label: 'Gruppenweise', zelle: 20, text: 'Gruppen von etwa 20 × 20 m.' },
  horst: { label: 'Horstweise', zelle: 40, text: 'Horste von etwa 40 × 40 m.' },
};
const mod = (a, n) => ((a % n) + n) % n;

/** Lokales, um die Gassenrichtung gedrehtes Koordinatensystem in Metern */
export function rahmen(ring, winkel = 0) {
  const lat0 = ring.reduce((a, p) => a + p[0], 0) / ring.length, lon0 = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const t = (-winkel * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const toXY = ([la, lo]) => { const x = (lo - lon0) * kx, y = (la - lat0) * ky; return [x * c - y * s, x * s + y * c]; };
  const toLL = ([x, y]) => { const a = x * c + y * s, b = -x * s + y * c; return [lat0 + b / ky, lon0 + a / kx]; };
  const P = ring.map(toXY);
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  return { toXY, toLL, P, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function schnitt(P, y) {
  const xs = [];
  for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length];
    if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}
/** y-Lage der Gassenmitten (auch knapp außerhalb, damit die Reihen an beiden Rändern richtig liegen) */
export function gassenMitten(R, g) {
  if (!g?.abstand) return [];
  const A = g.abstand, base = R.minY + mod(A / 2 + (g.versatz || 0), A);
  const out = [];
  for (let y = base - A; y <= R.maxY + A; y += A) out.push(y);
  return out;
}
/** Rückegassen als Linien (Mittelachsen) innerhalb der Fläche */
export function gassenLinien(ring, g) {
  if (!g?.abstand || ring.length < 3) return [];
  const R = rahmen(ring, g.winkel || 0);
  const out = [];
  for (const y of gassenMitten(R, g)) {
    if (y <= R.minY || y >= R.maxY) continue;
    for (const [a, b] of schnitt(R.P, y)) out.push({ y, linie: [R.toLL([a, y]), R.toLL([b, y])], mitte: R.toLL([(a + b) / 2, y]) });
  }
  return out;
}
/** Pflanzreihen: Lage (y) und Abschnitte innerhalb der Fläche, ohne Gassen */
function reihen(R, g) {
  const ys = [];
  if (g?.abstand) {
    const m = gassenMitten(R, g), halb = (g.breite || 4) / 2 + REIHE / 2;
    for (let k = 0; k + 1 < m.length; k++) for (let y = m[k] + halb; y <= m[k + 1] - halb + 1e-6; y += REIHE) if (y > R.minY && y < R.maxY) ys.push(y);
  } else for (let y = R.minY + REIHE / 2; y < R.maxY; y += REIHE) ys.push(y);
  return ys.map((y, i) => ({ y, i, seg: schnitt(R.P, y).map(([a, b]) => [a + RAND, b - RAND]).filter(([a, b]) => b - a >= 0.5) }));
}
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function mischen(arr, r) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
export const zellSchluessel = (form, [x, y]) => { const c = (FORMEN[form] || FORMEN.einzeln).zelle; return `${Math.floor(x / c)},${Math.floor(y / c)}`; };

const memo = [{ key: '' }, { key: '' }];
/**
 * @param {{ ring, arten: {name, anteil, nHa, gruppeHa}[], gassen: {abstand, breite, winkel, versatz}, form, seed, mal }} p
 * @param {boolean} mitPunkten  Pflanzplätze erzeugen (für Karte und PDF)
 */
export function pflanzLayout(p, mitPunkten = false) {
  const key = JSON.stringify([p.ring, p.arten.map((a) => [a.name, a.anteil, a.nHa, a.gruppeHa]), p.gassen, p.form, p.seed, p.mal, mitPunkten]);
  const M = memo[mitPunkten ? 1 : 0];
  if (M.key === key) return M.wert;
  const form = FORMEN[p.form] ? p.form : 'einzeln';
  const F = FORMEN[form];
  const R = rahmen(p.ring, p.gassen?.winkel || 0);
  const r = rng(p.seed || 1);
  const namen = p.arten.map((a) => a.name);
  const summe = p.arten.reduce((a, x) => a + (Number(x.anteil) || 0), 0) || 1;
  const anteil = Object.fromEntries(p.arten.map((a) => [a.name, (Number(a.anteil) || 0) / summe]));
  const nHa = Object.fromEntries(p.arten.map((a) => [a.name, a.nHa || 2500]));
  const mal = p.mal || {};

  // Reihenabschnitte an den Zellgrenzen teilen
  const pieces = [];
  const c = F.zelle;
  for (const row of reihen(R, p.gassen)) {
    for (const [a, b] of row.seg) {
      let x = a;
      while (x < b - 1e-6) {
        const x2 = Math.min(b, (Math.floor(x / c) + 1) * c);
        const ix = Math.floor((x + 1e-6) / c), iy = Math.floor(row.y / c);
        const pk = `${ix},${iy}`;
        const gk = form === 'einzeln' ? 'mix' : form === 'reihen' ? `r${Math.floor(row.i / F.reihen)}` : pk;
        pieces.push({ y: row.y, row: row.i, x1: x, x2, len: x2 - x, pk, gk, ix, iy, art: null });
        x = x2;
      }
    }
  }
  // Übermalte Abschnitte
  for (const pc of pieces) if (mal[pc.pk] && namen.includes(mal[pc.pk])) { pc.art = mal[pc.pk]; pc.gemalt = true; }
  // Gruppen der übrigen Abschnitte
  const gruppen = new Map();
  for (const pc of pieces) if (!pc.art) { const g = gruppen.get(pc.gk) || { key: pc.gk, len: 0, pieces: [], ix: pc.ix, iy: pc.iy, band: pc.row }; g.len += pc.len; g.pieces.push(pc); gruppen.set(pc.gk, g); }
  const Lauto = [...gruppen.values()].reduce((a, g) => a + g.len, 0);
  const T = Object.fromEntries(namen.map((n) => [n, anteil[n] * Lauto]));
  const A = Object.fromEntries(namen.map((n) => [n, 0]));
  const defizit = () => namen.filter((n) => T[n] > 0).sort((x, y) => (T[y] - A[y]) / T[y] - (T[x] - A[x]) / T[x])[0];
  const setze = (g, n) => { g.art = n; A[n] += g.len; g.pieces.forEach((pc) => { pc.art = n; }); };
  if (form === 'einzeln') gruppen.forEach((g) => g.pieces.forEach((pc) => { pc.art = 'mix'; }));
  else if (form === 'reihen') [...gruppen.values()].sort((a, b) => a.band - b.band).forEach((g) => { const n = defizit(); if (n) setze(g, n); });
  else {
    // Zellen zu Gruppen in Mindestgröße der Baumart wachsen lassen (z. B. Eiche ab 0,3 ha)
    const offen = new Set(gruppen.keys());
    const gruppeLen = Object.fromEntries(p.arten.map((a) => [a.name, ((a.gruppeHa || 0) * 10000) / REIHE]));
    for (const k of mischen([...gruppen.keys()], r)) {
      if (!offen.has(k)) continue;
      const n = defizit(); if (!n) break;
      const ziel = Math.max(gruppen.get(k).len, Math.min(gruppeLen[n], T[n] - A[n]));
      let len = 0; const queue = [k];
      while (queue.length && len < ziel) {
        const q = queue.shift();
        if (!offen.has(q)) continue;
        offen.delete(q); const g = gruppen.get(q); setze(g, n); len += g.len;
        const nb = mischen([[g.ix + 1, g.iy], [g.ix - 1, g.iy], [g.ix, g.iy + 1], [g.ix, g.iy - 1]].map(([x, y]) => `${x},${y}`).filter((z) => offen.has(z)), r);
        queue.push(...nb);
      }
    }
  }
  // Längen und Stückzahlen
  const len = Object.fromEntries(namen.map((n) => [n, 0])); let Lmix = 0;
  for (const pc of pieces) { if (pc.art === 'mix') Lmix += pc.len; else if (pc.art) len[pc.art] += pc.len; }
  const reinStk = Object.fromEntries(namen.map((n) => [n, Math.round((len[n] * REIHE * nHa[n]) / 10000)]));
  const mixStk = Object.fromEntries(namen.map((n) => [n, Math.round((anteil[n] * Lmix * REIHE * nHa[n]) / 10000)]));
  const stueck = Object.fromEntries(namen.map((n) => [n, reinStk[n] + mixStk[n]]));
  const lenEff = Object.fromEntries(namen.map((n) => [n, len[n] + anteil[n] * Lmix]));
  const gesamtLen = pieces.reduce((a, pc) => a + pc.len, 0);

  let punkte = null;
  if (mitPunkten) {
    punkte = [];
    const verteile = (liste, n, artVon) => {
      const L = liste.reduce((a, pc) => a + pc.len, 0);
      if (!n || !L) return;
      const d = L / n; let pos = d / 2, k = 0, basis = 0;
      for (const pc of liste) {
        while (k < n && pos < basis + pc.len) { punkte.push([pc.x1 + (pos - basis), pc.y, artVon(k)]); k++; pos += d; }
        basis += pc.len;
      }
    };
    for (const n of namen) verteile(pieces.filter((pc) => pc.art === n), reinStk[n], () => n);
    const mixListe = pieces.filter((pc) => pc.art === 'mix');
    const folge = mischen(namen.flatMap((n) => Array(mixStk[n]).fill(n)), r);
    verteile(mixListe, folge.length, (k) => folge[k]);
  }
  const wert = { R, form, pieces, stueck, lenEff, gesamtLen, Lmix, ha: areaHa(p.ring), nettoHa: (gesamtLen * REIHE) / 10000, punkte };
  M.key = key; M.wert = wert;
  return wert;
}
/** Baumart an einem Punkt ('mix' = Einzelmischung) */
export function artAm(lay, ll) {
  const [x, y] = lay.R.toXY(ll);
  let best = null, bd = Infinity;
  for (const pc of lay.pieces) {
    const dy = Math.abs(pc.y - y); if (dy > REIHE) continue;
    const dx = x < pc.x1 ? pc.x1 - x : x > pc.x2 ? x - pc.x2 : 0;
    const d = dy + dx; if (d < bd) { bd = d; best = pc; }
  }
  return bd < 3 ? best.art : null;
}
/** Zusammenhängende Abschnitte je Reihe und Baumart als Rechtecke (für Bestandeskarte und PDF) */
export function streifen(lay) {
  const out = []; let cur = null;
  const sorted = [...lay.pieces].sort((a, b) => a.y - b.y || a.x1 - b.x1);
  for (const pc of sorted) {
    if (cur && cur.y === pc.y && cur.art === pc.art && Math.abs(cur.x2 - pc.x1) < 1e-6) { cur.x2 = pc.x2; continue; }
    cur = { y: pc.y, x1: pc.x1, x2: pc.x2, art: pc.art }; out.push(cur);
  }
  return out.map((st) => ({ art: st.art, ring: [[st.x1, st.y - REIHE / 2], [st.x2, st.y - REIHE / 2], [st.x2, st.y + REIHE / 2], [st.x1, st.y + REIHE / 2]].map(lay.R.toLL) }));
}
/** Größe der zusammenhängenden Flächen je Baumart (m²) – für die Hinweise zur Gruppengröße */
export function gruppenGroessen(lay) {
  const zelle = new Map();
  for (const pc of lay.pieces) { if (!pc.art || pc.art === 'mix') continue; const z = zelle.get(pc.pk) || { art: pc.art, len: 0, ix: pc.ix, iy: pc.iy }; if (z.art === pc.art) z.len += pc.len; zelle.set(pc.pk, z); }
  const gesehen = new Set(), out = {};
  for (const [k, z] of zelle) {
    if (gesehen.has(k)) continue;
    let flaeche = 0; const q = [k]; gesehen.add(k);
    while (q.length) {
      const a = zelle.get(q.pop()); flaeche += a.len * REIHE;
      for (const [x, y] of [[a.ix + 1, a.iy], [a.ix - 1, a.iy], [a.ix, a.iy + 1], [a.ix, a.iy - 1]]) { const nk = `${x},${y}`; const nz = zelle.get(nk); if (nz && nz.art === z.art && !gesehen.has(nk)) { gesehen.add(nk); q.push(nk); } }
    }
    (out[z.art] ||= []).push(flaeche);
  }
  return out;
}

/** Pflanzlayout einer gespeicherten Pflanzung (für Bestandeskarte und Bestand am Punkt) */
export function gespeichertesLayout(m) {
  const pp = m?.pflanzplan;
  if (!pp?.vert || !pp.vorgabe?.length || !m.flaeche?.ring?.length) return null;
  return pflanzLayout({ ring: m.flaeche.ring, arten: pp.vorgabe, gassen: pp.gassen, form: pp.vert.form, seed: pp.vert.seed, mal: pp.vert.mal });
}
