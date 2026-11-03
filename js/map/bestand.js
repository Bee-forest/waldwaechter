// Bestandsdaten zum Flurstück: Baumart und Alter (ThüringenForst, Waldverzeichnis)
// sowie Oberhöhe aus LiDAR-Höhenmodellen (DOM1 − DGM1, TLBG), beides als
// vorbereitete Kacheln im Repository (data/baumarten, data/oberhoehe).
import { pointInPolygon, generateGrid, toUTM32, bbox } from '../geo.js';

const Z = 14;
const tX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const tY = (lat) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** Z);
const cache = new Map();

const BA = {
  FI: 'Fichte', KI: 'Kiefer', SKI: 'Kiefer', BU: 'Buche', EI: 'Eiche', TEI: 'Eiche', SEI: 'Eiche', REI: 'Eiche',
  ELA: 'Lärche', JLA: 'Lärche', LA: 'Lärche', DGL: 'Douglasie', TA: 'Tanne', WTA: 'Tanne', KTA: 'Tanne',
  BAH: 'Ahorn', AH: 'Ahorn', SAH: 'Ahorn', FAH: 'Ahorn', ES: 'Esche', GBI: 'Birke', BI: 'Birke', MBI: 'Birke',
  ER: 'Erle', RER: 'Erle', SER: 'Erle', HBU: 'Hainbuche',
};
export const artVonKurz = (kurz, text = '') => BA[kurz] || (/fichte/i.test(text) ? 'Fichte' : /kiefer/i.test(text) ? 'Kiefer' : /buche/i.test(text) ? 'Buche'
  : /eiche/i.test(text) ? 'Eiche' : /lärche|laerche/i.test(text) ? 'Lärche' : null);

function decodeRing(q) {
  const ring = []; let la = 0, lo = 0;
  for (let i = 0; i + 1 < q.length; i += 2) { la += q[i]; lo += q[i + 1]; ring.push([la / 1e6, lo / 1e6]); }
  return ring;
}

async function tile(x, y) {
  const k = `${x}/${y}`;
  if (!cache.has(k)) {
    cache.set(k, fetch(`data/baumarten/${Z}/${x}/${y}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => [])
      .then((list) => list.map((it) => ({ ...it, rings: it.r.map(decodeRing) }))));
  }
  return cache.get(k);
}

function inside(pt, rings) { let c = false; for (const r of rings) if (pointInPolygon(pt, r)) c = !c; return c; }

const heute = () => new Date().getFullYear();
function info(it) {
  const alterHeute = it.a != null && it.j ? it.a + (heute() - it.j) : null;
  return { kurz: it.b, text: it.t, art: artVonKurz(it.b, it.t), alterStichtag: it.a, stichtag: it.j, alter: alterHeute };
}

/** Bestand am Punkt */
export async function bestandAt([lat, lng]) {
  const list = await tile(tX(lng), tY(lat));
  const it = list.find((x) => inside([lat, lng], x.rings));
  return it ? info(it) : null;
}

/** Vorherrschender Bestand in einer Fläche (Stichprobe über ein Punktraster) */
export async function bestandInFlaeche(ring) {
  const pts = generateGrid(ring, 15).slice(0, 400);
  const hits = await Promise.all(pts.map((p) => bestandAt(p)));
  const groups = new Map();
  for (const b of hits.filter(Boolean)) {
    const key = b.art || b.text;
    const g = groups.get(key) || { n: 0, alterSumme: 0, alterN: 0, b };
    g.n++; if (b.alter != null) { g.alterSumme += b.alter; g.alterN++; }
    groups.set(key, g);
  }
  if (!groups.size) return null;
  const sorted = [...groups.values()].sort((a, b) => b.n - a.n);
  const top = sorted[0];
  return {
    ...top.b,
    alter: top.alterN ? Math.round(top.alterSumme / top.alterN) : null,
    anteil: top.n / pts.length,
    waldanteil: hits.filter(Boolean).length / pts.length,
    weitere: sorted.slice(1, 3).map((g) => ({ art: g.b.art || g.b.text, anteil: g.n / pts.length })),
  };
}

// ---------- Oberhöhe aus LiDAR ----------
// Kacheln data/oberhoehe/<E-km>_<N-km>.bin (UTM 32, 1 km × 1 km): 100 × 100 Zellen à 10 m,
// je Zelle die größte Vegetationshöhe (nDOM) als Byte in 0,2-m-Schritten, 0 = keine Angabe.
const hCache = new Map();
async function hTile(e, n) {
  const k = `${e}_${n}`;
  if (!hCache.has(k)) {
    hCache.set(k, fetch(`data/oberhoehe/${k}.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new Uint8Array(b) : null)).catch(() => null));
  }
  return hCache.get(k);
}

/** Oberhöhe der Fläche ≈ Mittel der höchsten Bäume je 10-m-Zelle (≈ 100 Bäume/ha); null, wenn keine Daten */
export async function oberhoeheFlaeche(ring) {
  const b = bbox(ring);
  const [e0, n0] = toUTM32([b.s, b.w]), [e1, n1] = toUTM32([b.n, b.e]);
  const vals = [];
  let tilesFound = 0;
  for (let ek = Math.floor(Math.min(e0, e1) / 1000); ek <= Math.floor(Math.max(e0, e1) / 1000); ek++) {
    for (let nk = Math.floor(Math.min(n0, n1) / 1000); nk <= Math.floor(Math.max(n0, n1) / 1000); nk++) {
      const t = await hTile(ek, nk);
      if (!t) continue;
      tilesFound++;
      for (let row = 0; row < 100; row++) {
        for (let col = 0; col < 100; col++) {
          const v = t[row * 100 + col];
          if (!v) continue;
          const E = ek * 1000 + col * 10 + 5, N = nk * 1000 + (99 - row) * 10 + 5;
          if (E < Math.min(e0, e1) || E > Math.max(e0, e1) || N < Math.min(n0, n1) || N > Math.max(n0, n1)) continue;
          vals.push({ E, N, h: v * 0.2 });
        }
      }
    }
  }
  if (!tilesFound) return null;
  const { fromUTM32 } = await import('../geo.js');
  const inRing = vals.filter((c) => pointInPolygon(fromUTM32([c.E, c.N]), ring)).map((c) => c.h).filter((h) => h >= 3);
  if (inRing.length < 5) return null;
  const mean = inRing.reduce((s, h) => s + h, 0) / inRing.length;
  return { oberhoehe: mean, zellen: inRing.length };
}
