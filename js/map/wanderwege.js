// Wanderwege im Flurstück (OpenStreetMap, live über Overpass): ausgeschilderte Wander- und Fußwanderrouten,
// deren Verlauf das Flurstück berührt. Ergebnis je Flurstück für die Sitzung im Speicher.
import { polysOf, inPolys } from '../geo.js';

const SERVER = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const cache = new Map();
const NETZ = { iwn: 'international', nwn: 'national', rwn: 'regional', lwn: 'lokal' };

function rahmen(polys, pad = 0.0004) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const poly of polys) for (const ring of poly) for (const [la, lo] of ring) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  return [s - pad, w - pad, n + pad, e + pad];
}

/** Teile eines Linienzugs, die im Flurstück liegen (auf ca. 5 m verdichtet geprüft) */
function teileImFlurstueck(geom, polys) {
  const teile = []; let akt = null;
  for (let i = 0; i < geom.length; i++) {
    const a = geom[i], b = geom[i + 1];
    const pts = [a];
    if (b) {
      const d = Math.hypot((b[0] - a[0]) * 111000, (b[1] - a[1]) * 71000);
      const n = Math.min(60, Math.floor(d / 5));
      for (let k = 1; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    for (const p of pts) {
      if (inPolys(p, polys)) { if (!akt) { akt = []; teile.push(akt); } akt.push(p); } else akt = null;
    }
  }
  return teile.filter((t) => t.length > 1);
}

/**
 * @returns {Promise<Array<{ id, name, ref, netz, symbol, betreiber, laengeM, linien: [lat,lng][][] }>>}
 */
export async function wanderwege(parcel) {
  if (cache.has(parcel.id)) return cache.get(parcel.id);
  const polys = polysOf(parcel);
  const [s, w, n, e] = rahmen(polys);
  const bb = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:25];relation["route"~"^(hiking|foot|walking)$"](${bb});out geom(${bb});`;
  let json = null, fehler = null;
  for (const url of SERVER) {
    try {
      const r = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(q)}` });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      json = await r.json(); break;
    } catch (err) { fehler = err; }
  }
  if (!json) throw fehler || new Error('Overpass nicht erreichbar');
  const out = [];
  for (const rel of json.elements || []) {
    if (rel.type !== 'relation') continue;
    const linien = [];
    for (const m of rel.members || []) {
      if (m.type !== 'way' || !m.geometry) continue;
      const geom = m.geometry.filter(Boolean).map((g) => [g.lat, g.lon]);
      linien.push(...teileImFlurstueck(geom, polys));
    }
    if (!linien.length) continue;
    let laengeM = 0;
    for (const l of linien) for (let i = 1; i < l.length; i++) laengeM += Math.hypot((l[i][0] - l[i - 1][0]) * 111000, (l[i][1] - l[i - 1][1]) * 111000 * Math.cos((l[i][0] * Math.PI) / 180));
    const t = rel.tags || {};
    out.push({ id: rel.id, name: t.name || t.ref || 'Wanderweg ohne Namen', ref: t.ref && t.name ? t.ref : '', netz: NETZ[t.network] || '', symbol: t['osmc:symbol'] || '',
      betreiber: t.operator || '', laengeM, linien });
  }
  out.sort((a, b) => b.laengeM - a.laengeM);
  cache.set(parcel.id, out);
  return out;
}
