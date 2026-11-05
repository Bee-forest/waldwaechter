// Bestandsdaten zum Flurstück: Baumart und Alter (ThüringenForst, Waldverzeichnis)
// sowie Oberhöhe aus LiDAR-Höhenmodellen (DOM1 − DGM1, TLBG), beides als
// vorbereitete Kacheln im Repository (data/baumarten, data/oberhoehe).
import { pointInPolygon, inPolys, generateGrid, toUTM32, fromUTM32, bbox } from '../geo.js';
import { gespeichertesLayout, artAm } from '../pflanzlayout.js';
import { store } from '../store.js';

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

export const bestandsKachel = (x, y) => tile(x, y);
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
  return { kurz: it.b, text: it.t, art: artVonKurz(it.b, it.t), alterStichtag: it.a, stichtag: it.j, alter: alterHeute, kennung: it.k || null, forstamt: it.f || null, revier: it.v || null, flaecheM2: it.q || null };
}

/** Bestand am Punkt */
export async function bestandAt([lat, lng]) {
  const list = await tile(tX(lng), tY(lat));
  const it = list.find((x) => inside([lat, lng], x.rings));
  return it ? info(it) : null;
}

/** Vorherrschender Bestand in einer Fläche (Stichprobe über ein Punktraster) */
export async function bestandInFlaeche(ring, polys = null) {
  const pts = generateGrid(ring, 15, { polys }).slice(0, 400);
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
export async function oberhoeheFlaeche(ring, polys = null) {
  const shape = polys?.length ? polys : [[ring]];
  const b = bbox(shape.flat(2));
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
  const inRing = vals.filter((c) => inPolys(fromUTM32([c.E, c.N]), shape)).map((c) => c.h).filter((h) => h >= 3);
  if (inRing.length < 5) return null;
  const mean = inRing.reduce((s, h) => s + h, 0) / inRing.length;
  return { oberhoehe: mean, zellen: inRing.length };
}

/** Alle Bestände (Waldverzeichnis), die ein Flurstück berühren – für die Auswahl „Bestand“ */
export async function bestaendeImFlurstueck(p) {
  const polys = p.polys?.length ? p.polys : [[p.ring]];
  const pts = generateGrid(p.ring, 10, { polys }).slice(0, 1500);
  const groups = new Map();
  for (const pt of pts) {
    const list = await tile(tX(pt[1]), tY(pt[0]));
    const it = list.find((x) => inside(pt, x.rings));
    if (!it) continue;
    const key = `${it.k || ''}|${it.r[0].slice(0, 4).join(',')}`;
    const g = groups.get(key) || { it, n: 0 };
    g.n++; groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.n >= 3).sort((a, b) => b.n - a.n).map(({ it, n }, i) => {
    const inf = info(it);
    return {
      id: `${p.id}|${it.k || i}|${i}`, parcelId: p.id, name: it.k ? `Abt. ${it.k}` : `Bestand ${i + 1}`, label: it.t || inf.art || 'Bestand',
      species: inf.art || it.t, age: inf.alter, ring: it.rings[0], polys: [it.rings], clip: polys, anteilHa: (n * 100) / 10000, info: inf,
    };
  });
}

// ---------- Eigene Angaben zum Bestand (wenn das Waldverzeichnis veraltet oder falsch ist) ----------
export const KORREKTUR_ARTEN = ['Fichte', 'Kiefer', 'Lärche', 'Douglasie', 'Tanne', 'Buche', 'Eiche', 'Ahorn', 'Esche', 'Birke', 'Erle', 'Hainbuche', 'Linde', 'Kirsche', 'Roteiche', 'sonstiges Laubholz', 'sonstiges Nadelholz'];
export const SCHICHTEN = [['haupt', 'Hauptbaumart'], ['misch', 'Mischbaumart'], ['neben', 'Nebenbaumart']];
/** Alter einer eigenen Angabe auf heute hochgerechnet */
export const korrAlter = (x, jahr) => (x?.alter != null && x.alter !== '' ? Number(x.alter) + (heute() - (jahr || heute())) : null);
/** Bestand mit eigenen Angaben überschreiben (Hauptbaumart und ihr Alter zählen) */
export function mitKorrektur(bestand, k) {
  if (!k?.haupt?.art) return bestand;
  return { ...(bestand || {}), art: k.haupt.art, text: k.haupt.art, alter: korrAlter(k.haupt, k.jahr), alterStichtag: k.haupt.alter != null && k.haupt.alter !== '' ? Number(k.haupt.alter) : null,
    stichtag: k.jahr, quelle: 'eigen', korrektur: k, original: bestand || null };
}

// ---------- Eigene, abgeschlossene Pflanzungen als Bestand ----------
const KURZ = { Rotbuche: 'Buche', Traubeneiche: 'Eiche', Stieleiche: 'Eiche', Roteiche: 'Eiche', Bergahorn: 'Ahorn', Spitzahorn: 'Ahorn', Feldahorn: 'Ahorn',
  Sandbirke: 'Birke', Schwarzerle: 'Erle', 'Gemeine Fichte': 'Fichte', 'Gemeine Kiefer': 'Kiefer', 'Europäische Lärche': 'Lärche', Weißtanne: 'Tanne' };
export const kurzArt = (name) => KURZ[name] || name;
const sortAlter = (s) => { const m = /(\d)\s*[+/]\s*(\d)/.exec(String(s || '')); return m ? Number(m[1]) + Number(m[2]) : 2; };
/** Pflanzjahr einer abgeschlossenen Pflanzung: geplanter Termin, sonst Tag des Abschlusses */
export const pflanzZeit = (m) => (m.date && (!m.finishedAt || m.date <= m.finishedAt + 864e5) ? m.date : m.finishedAt || m.createdAt);
export function eigenePflanzungen() {
  return (store.get().measures || []).filter((m) => m.type === 'pflanzung' && m.status === 'fertig' && m.flaeche?.ring?.length >= 3);
}
/** Bestand aus der jüngsten abgeschlossenen Pflanzung am Punkt (Alter = Jahre seit der Pflanzung + Alter des Sortiments, sonst + 2) */
export function pflanzungAm(pt) {
  const treffer = eigenePflanzungen().filter((m) => pointInPolygon(pt, m.flaeche.ring)).sort((a, b) => pflanzZeit(b) - pflanzZeit(a))[0];
  if (!treffer) return null;
  const pp = treffer.pflanzplan || {};
  const ts = pflanzZeit(treffer);
  const jahr = new Date(ts).getFullYear();
  const arten = (pp.arten?.length ? pp.arten : [{ name: treffer.details?.species || '', anteil: 100, sortiment: '' }]).map((a) => ({ ...a, alter: heute() - jahr + sortAlter(a.sortiment) }));
  const lay = gespeichertesLayout(treffer);
  const amPunkt = lay ? artAm(lay, pt) : null;
  const zone = lay ? null : (pp.zonen || []).slice().reverse().find((z) => pointInPolygon(pt, z.ring));
  const hier = arten.find((a) => a.name === (amPunkt && amPunkt !== 'mix' ? amPunkt : zone?.name || pp.grund)) || [...arten].sort((a, b) => (b.anteil || 0) - (a.anteil || 0))[0];
  return { quelle: 'pflanzung', measureId: treffer.id, ts, jahr, arten, art: kurzArt(hier?.name), text: hier?.name, alter: hier?.alter ?? null, stichtag: jahr, alterStichtag: hier ? hier.alter - (heute() - jahr) : null };
}
