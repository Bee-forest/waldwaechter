// Rückegassen im Luftbild (DOP) erkennen – als Vorschlag, den man prüft und übernimmt.
// Idee: Gassen sind 3–5 m breite, gerade Lücken im Kronendach, die hell (Boden, Gras) oder weniger grün
// erscheinen und meist parallel im Abstand von 20–40 m liegen. Das Bild wird je Richtung zu Linienprofilen
// aufsummiert (Radon-Transformation); die stärkste Richtung mit mehreren deutlichen, parallelen Spitzen
// liefert die Gassen (Raster 24–42 m, durchgehend bis zum Rand). Ein zweiter, strengerer Durchgang findet
// einzelne Gassen in anderer Richtung (z. B. zusammenlaufende Gassen).
import { kartenLeinwand } from '../kartenbild.js';
import { polysOf } from '../geo.js';

const ZIEL_M = 0.75; // Auflösung der Auswertung (m je Zelle)

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0; const o = y * w;
    for (let x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s / (2 * r + 1);
      s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / (2 * r + 1);
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/**
 * Kern der Erkennung auf einem Pixelraster.
 * @param {{ rgba: Uint8ClampedArray, w: number, h: number, mask: Uint8Array, mProPx: number }} o
 * @returns {{ linien: Array<[[number,number],[number,number]]>, winkel: number|null, staerke: number }}  Linien in Pixelkoordinaten
 */
export function erkenneGassenPixel({ rgba, w, h, mask, voll = null, mProPx, abstandMinM = 22, abstandMaxM = 42 }) {
  const n = w * h;
  const L = new Float32Array(n), G = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    L[i] = (r + g + b) / 3; G[i] = 2 * g - r - b;
  }
  const rBg = Math.max(3, Math.round(8 / mProPx));
  const rS = Math.max(1, Math.round(1 / mProPx));
  const Ls = boxBlur(L, w, h, rS), Lb = boxBlur(L, w, h, rBg), Gs = boxBlur(G, w, h, rS), Gb = boxBlur(G, w, h, rBg);
  // Streuung im Flurstück
  let sl = 0, sl2 = 0, sg = 0, sg2 = 0, m = 0;
  for (let i = 0; i < n; i++) if (mask[i]) { const a = Ls[i] - Lb[i], c = Gb[i] - Gs[i]; sl += a; sl2 += a * a; sg += c; sg2 += c * c; m++; }
  if (m < 200) return { linien: [], winkel: null, staerke: 0 };
  const sdL = Math.sqrt(Math.max(1e-6, sl2 / m - (sl / m) ** 2)), sdG = Math.sqrt(Math.max(1e-6, sg2 / m - (sg / m) ** 2));
  const F = new Float32Array(n);
  // örtlich normieren: in dunkleren oder schattigen Bereichen ist der Kontrast der Gassen kleiner
  const D = new Float32Array(n), E = new Float32Array(n);
  for (let i = 0; i < n; i++) { const d = Ls[i] - Lb[i], e = Gb[i] - Gs[i]; D[i] = d * d; E[i] = e * e; }
  const rLok = Math.round(15 / mProPx), VL = boxBlur(D, w, h, rLok), VG = boxBlur(E, w, h, rLok);
  for (let i = 0; i < n; i++) if (mask[i]) {
    const sl0 = Math.max(Math.sqrt(VL[i]), 0.5 * sdL), sg0 = Math.max(Math.sqrt(VG[i]), 0.5 * sdG);
    F[i] = Math.min(3, Math.max(0, (Ls[i] - Lb[i]) / sl0) + 0.5 * Math.max(0, (Gb[i] - Gs[i]) / sg0));
  }

  const p1 = durchlauf(F, null);
  if (!p1.linien.length) return p1;
  // Zweiter Durchgang für Gassen in anderer Richtung (z. B. zusammenlaufende Gassen): gefundene Gassen ausblenden
  const F2 = F.slice();
  const r5 = Math.round(5 / mProPx);
  for (const [[x0, y0], [x1, y1]] of p1.linien) {
    const len = Math.hypot(x1 - x0, y1 - y0), k = Math.max(1, Math.ceil(len));
    for (let j = 0; j <= k; j++) {
      const cx = Math.round(x0 + ((x1 - x0) * j) / k), cy = Math.round(y0 + ((y1 - y0) * j) / k);
      for (let yy = cy - r5; yy <= cy + r5; yy++) for (let xx = cx - r5; xx <= cx + r5; xx++) if (xx >= 0 && yy >= 0 && xx < w && yy < h) F2[yy * w + xx] = 0;
    }
  }
  const p2 = durchlauf(F2, p1.winkel, true);
  return { ...p1, linien: [...p1.linien, ...p2.linien] };

  function durchlauf(F, sperrDeg, streng = false) {
  const diag = Math.ceil(Math.hypot(w, h));
  const minLen = 25 / mProPx, abstandMin = Math.round(abstandMinM / mProPx), fenster = Math.round(10 / mProPx), kern = Math.round(3 / mProPx);
  let best = null;
  const scores = [];
  for (let deg = 0; deg < 180; deg += 2) {
    if (sperrDeg != null && Math.min(Math.abs(deg - sperrDeg), 180 - Math.abs(deg - sperrDeg)) < 12) continue;
    const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const sum = new Float32Array(2 * diag + 1), cnt = new Uint32Array(2 * diag + 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!mask[i]) continue;
      const k = Math.round(x * c + y * s) + diag; sum[k] += F[i]; cnt[k]++;
    }
    const P = new Float32Array(sum.length).fill(NaN);
    for (let k = 0; k < P.length; k++) if (cnt[k] >= minLen) P[k] = sum[k] / cnt[k];
    // Prominenz gegenüber der Umgebung (±fenster, ohne den Kern ±kern)
    const prom = new Float32Array(P.length).fill(0);
    for (let k = 0; k < P.length; k++) {
      if (Number.isNaN(P[k])) continue;
      let a = 0, b = 0;
      for (let j = k - fenster; j <= k + fenster; j++) { if (j < 0 || j >= P.length || Math.abs(j - k) <= kern || Number.isNaN(P[j])) continue; a += P[j]; b++; }
      if (b > 2) prom[k] = P[k] - a / b;
    }
    const spitzen = [];
    const order = [...prom.keys()].filter((k) => prom[k] > 0.25).sort((a2, b2) => prom[b2] - prom[a2]);
    const top = order.length ? prom[order[0]] : 0;
    for (const k of order) { if (prom[k] < top * 0.4) break; if (spitzen.every((q) => Math.abs(q - k) >= abstandMin)) spitzen.push(k); if (spitzen.length >= 30) break; }
    const score = spitzen.slice(0, 8).reduce((a2, k) => a2 + prom[k], 0);
    scores.push(score);
    if (!best || score > best.score) best = { deg, c, s, spitzen, prom, score };
  }
  if (!best || !best.spitzen.length) return { linien: [], winkel: null, staerke: 0 };
  // Nur wenn eine Richtung deutlich heraussticht, sind es Gassen (sonst nur Kronenmuster)
  const median = scores.slice().sort((a2, b2) => a2 - b2)[Math.floor(scores.length / 2)];
  const deutlich = best.score / Math.max(1e-6, median);
  if (typeof globalThis.__gassenDebug === 'function') globalThis.__gassenDebug({ deutlich, score: best.score, median, top: best.prom[best.spitzen[0]] });
  if (deutlich < (streng ? 5 : 3) || best.prom[best.spitzen[0]] < (streng ? 0.9 : 0.5)) return { linien: [], winkel: null, staerke: deutlich };
  // Gassenraster: Gassen liegen parallel in festem Abstand (meist 24 m, auch bis 40 m). Abstand und Lage des
  // Rasters so wählen, dass die Profilspitzen am besten getroffen werden; dann jede Rasterlinie einzeln prüfen.
  const { c, s, prom } = best;
  const def = []; for (let k = 0; k < prom.length; k++) if (prom[k] !== 0) def.push(k);
  const k0 = def[0], k1 = def[def.length - 1];
  const tol = Math.max(1, Math.round(3 / mProPx));
  const maxIn = (pos) => { let m = -Infinity, at = pos; for (let j = pos - tol; j <= pos + tol; j++) if (j >= k0 && j <= k1 && prom[j] > m) { m = prom[j]; at = j; } return { m: m === -Infinity ? 0 : m, at }; };
  let raster = null;
  for (let sp = Math.round(abstandMinM / mProPx); sp <= Math.round(abstandMaxM / mProPx); sp++) {
    for (let ph = 0; ph < sp; ph++) {
      let sum = 0, n2 = 0;
      for (let pos = k0 + ph; pos <= k1; pos += sp) { sum += Math.max(0, maxIn(pos).m); n2++; }
      const mittel = n2 ? sum / n2 : 0;
      if (!raster || mittel > raster.mittel) raster = { sp, ph, mittel };
    }
  }
  const kandidaten = [];
  if (raster) for (let pos = k0 + raster.ph; pos <= k1; pos += raster.sp) { const t = maxIn(pos); if (t.m > (streng ? 0.6 : 0.05)) kandidaten.push(t.at); }
  const linien = [];
  const halb = Math.max(1, Math.round(2 / mProPx));
  const innen = (x, y, m) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < w && yi < h && m[yi * w + xi]; };
  for (const k of kandidaten) {
    const rho = k - diag;
    const px = rho * c, py = rho * s; // Linie: Punkt (px, py), Richtung (-s, c)
    // entlang der Linie: Gassenstreifen (±2 m) im Vergleich zum Kronendach daneben (6–9 m seitlich)
    const seit = [6, 7.5, 9].map((m2) => Math.round(m2 / mProPx));
    const werte = [];
    for (let tt = -diag; tt <= diag; tt++) {
      const x = px - s * tt, y = py + c * tt;
      if (!innen(x, y, mask)) { werte.push(null); continue; }
      let a = 0, b = 0, sa = 0, sb = 0;
      for (let q = -halb; q <= halb; q++) { const xx = x + c * q, yy = y + s * q; if (innen(xx, yy, mask)) { a += F[Math.round(yy) * w + Math.round(xx)]; b++; } }
      for (const q0 of seit) for (const sg of [-1, 1]) { const xx = x + c * q0 * sg, yy = y + s * q0 * sg; if (innen(xx, yy, mask)) { sa += F[Math.round(yy) * w + Math.round(xx)]; sb++; } }
      werte.push(b && sb ? a / b - sa / sb : null);
    }
    const r = Math.round(5 / mProPx), sm = werte.map((_, i) => { let a = 0, b = 0; for (let j = i - r; j <= i + r; j++) if (werte[j] != null) { a += werte[j]; b++; } return werte[i] == null ? null : a / b; });
    // Gassen laufen durch: vom ersten bis zum letzten deutlichen Stück durchziehen, Lücken (Kronenschluss, Schatten) überbrücken
    const schwelle = streng ? 0.4 : 0.18;
    let erst = -1, letzt = -1, treffer = 0, innenN = 0;
    for (let i = 0; i < sm.length; i++) { if (sm[i] == null) continue; innenN++; if (sm[i] >= schwelle) { if (erst < 0) erst = i; letzt = i; treffer++; } }
    if (erst < 0 || (letzt - erst) < minLen) continue;
    let spanne = 0; for (let i = erst; i <= letzt; i++) if (sm[i] != null) spanne++;
    if (treffer / Math.max(1, spanne) < 0.35) continue;
    // Enden bis an den Rand des Flurstücks verlängern, wenn sie nah am Rand liegen (≤ 30 m)
    const rand = Math.round(30 / mProPx), aussen = voll || mask;
    const randAb = (i, dir) => { let j = i; while (innen(px - s * (j + dir - diag), py + c * (j + dir - diag), aussen)) j += dir; return j; };
    let a0 = erst, a1 = letzt;
    const r0 = randAb(erst, -1), r1 = randAb(letzt, 1);
    if (erst - r0 <= rand) a0 = r0;
    if (r1 - letzt <= rand) a1 = r1;
    const t0 = a0 - diag, t1 = a1 - diag;
    linien.push([[px - s * t0, py + c * t0], [px - s * t1, py + c * t1]]);
  }
  return { linien, winkel: best.deg, staerke: deutlich, abstandM: raster ? Math.round(raster.sp * mProPx) : null };
  }
}

/**
 * Erkennung für ein Flurstück (oder eine Fläche) auf dem Thüringer Luftbild.
 * @returns {Promise<{ linien: [number,number][][], hinweis?: string }>}  Linien in [lat, lng]
 */
export async function erkenneGassen(flaeche) {
  const polys = polysOf(flaeche);
  let s = 90, w = 180, n = -90, e = -180;
  for (const poly of polys) for (const ring of poly) for (const [la, lo] of ring) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  const l = await kartenLeinwand({ nord: n, sued: s, west: w, ost: e, basemap: 'dop', zoom: 18 });
  if (!l) throw new Error('Das Luftbild konnte nicht geladen werden.');
  let px;
  try { px = l.cv.getContext('2d').getImageData(0, 0, l.w, l.h); } catch { throw new Error('Das Luftbild darf vom Browser nicht ausgewertet werden.'); }
  const mProPxBild = (156543.03392 * Math.cos((((s + n) / 2) * Math.PI) / 180)) / 2 ** l.z;
  const f = Math.max(1, Math.round(ZIEL_M / mProPxBild));
  const W = Math.floor(l.w / f), H = Math.floor(l.h / f);
  if (W * H > 1.6e6) throw new Error('Die Fläche ist zu groß für die automatische Erkennung (höchstens ca. 80 ha).');
  // verkleinern (Mittelwert je Block)
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) { const i = ((y * f + yy) * l.w + x * f + xx) * 4; r += px.data[i]; g += px.data[i + 1]; b += px.data[i + 2]; }
    const o = (y * W + x) * 4, q = f * f; rgba[o] = r / q; rgba[o + 1] = g / q; rgba[o + 2] = b / q; rgba[o + 3] = 255;
  }
  // Maske des Flurstücks (etwas nach innen, damit Waldränder und Grenzwege nicht als Gassen gelten)
  const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
  const mx = mc.getContext('2d');
  const zuPx = ([la, lo]) => [(l.lon2px(lo, l.z) - l.x0) / f, (l.lat2px(la, l.z) - l.y0) / f];
  mx.fillStyle = '#000';
  mx.beginPath();
  for (const poly of polys) for (const ring of poly) ring.forEach((pt, i) => { const [x, y] = zuPx(pt); if (i) mx.lineTo(x, y); else mx.moveTo(x, y); });
  mx.fill('evenodd');
  const vd = mx.getImageData(0, 0, W, H).data;
  const voll = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) voll[i] = vd[i * 4 + 3] > 128 ? 1 : 0;
  mx.globalCompositeOperation = 'destination-out';
  mx.lineWidth = (2 * 6) / ZIEL_M; mx.strokeStyle = '#000';
  mx.stroke();
  const md = mx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = md[i * 4 + 3] > 128 ? 1 : 0;
  const r = erkenneGassenPixel({ rgba, w: W, h: H, mask, voll, mProPx: mProPxBild * f });
  const welt = 256 * 2 ** l.z;
  const zuLL = ([x, y]) => {
    const X = l.x0 + x * f, Y = l.y0 + y * f;
    return [(Math.atan(Math.sinh(Math.PI * (1 - (2 * Y) / welt))) * 180) / Math.PI, (X / welt) * 360 - 180];
  };
  return { linien: r.linien.map((ab) => ab.map(zuLL)), winkel: r.winkel, abstandM: r.abstandM };
}
