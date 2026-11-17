// Rückegassen im Luftbild (DOP) erkennen – als Vorschlag, den man prüft und übernimmt.
// Gassen sind ca. 4 m breite Schneisen im Kronendach, mindestens ca. 24 m voneinander entfernt; sie können
// gebogen sein und ineinander übergehen. Siehe erkenneGassenPixel.
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
 * Gassen sind Schneisen im Kronendach: schmale (ca. 4 m), lang gezogene Streifen, die heller, weniger grün oder
 * im Schatten dunkler sind als das Kronendach daneben. Sie müssen nicht parallel sein, dürfen gebogen sein und
 * ineinander übergehen. Vorgehen:
 *  1. „Lückenbild“ F: Abweichung jedes Punkts vom Kronendach der Umgebung.
 *  2. Linienfilter: Mittel von F auf einer 16 m langen Strecke minus Mittel daneben (±6 m), in 16 Richtungen.
 *  3. Von den stärksten Stellen aus werden Gassen in 3-m-Schritten verfolgt (Richtung darf sich langsam ändern),
 *     kurze Lücken (bis 24 m) werden überbrückt, stößt eine Gasse auf eine schon gefundene, wird sie angeschlossen.
 * @returns {{ linien: number[][][], staerke: number }}  Linien als Punktfolgen in Pixelkoordinaten
 */
export function erkenneGassenPixel({ rgba, w, h, mask, voll = null, mProPx, abstandMinM = 22 }) {
  const n = w * h;
  const L = new Float32Array(n), G = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    L[i] = (r + g + b) / 3; G[i] = 2 * g - r - b;
  }
  const rBg = Math.max(3, Math.round(8 / mProPx));
  const rS = Math.max(1, Math.round(1 / mProPx));
  const Ls = boxBlur(L, w, h, rS), Lb = boxBlur(L, w, h, rBg), Gs = boxBlur(G, w, h, rS), Gb = boxBlur(G, w, h, rBg);
  let sl = 0, sl2 = 0, sg = 0, sg2 = 0, m = 0;
  for (let i = 0; i < n; i++) if (mask[i]) { const a = Ls[i] - Lb[i], c = Gb[i] - Gs[i]; sl += a; sl2 += a * a; sg += c; sg2 += c * c; m++; }
  if (m < 200) return { linien: [], staerke: 0 };
  const sdL = Math.sqrt(Math.max(1e-6, sl2 / m - (sl / m) ** 2)), sdG = Math.sqrt(Math.max(1e-6, sg2 / m - (sg / m) ** 2));
  const F = new Float32Array(n);
  for (let i = 0; i < n; i++) if (mask[i]) {
    const zl = (Ls[i] - Lb[i]) / sdL, zg = (Gb[i] - Gs[i]) / sdG;
    F[i] = Math.min(3, Math.max(0, zl) + 0.5 * Math.max(0, -zl) + 0.5 * Math.max(0, zg));
  }
  const innen = (x, y, mk) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < w && yi < h && mk[yi * w + xi] === 1; };
  const Fat = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < w && yi < h && mask[yi * w + xi] ? F[yi * w + xi] : null; };

  // Linienfilter an einem Punkt in Richtung t (Bogenmaß, 0 = nach rechts)
  const halbL = 8 / mProPx, seit = 6 / mProPx, schritt = 1.5 / mProPx;
  function antwort(x, y, t) {
    const dx = Math.cos(t), dy = Math.sin(t), nx = -dy, ny = dx;
    let a = 0, an = 0, b = 0, bn = 0;
    for (let u = -halbL; u <= halbL; u += schritt) {
      const px = x + dx * u, py = y + dy * u;
      const v = Fat(px, py); if (v != null) { a += v; an++; }
      for (const sgn of [-1, 1]) { const q = Fat(px + nx * seit * sgn, py + ny * seit * sgn); if (q != null) { b += q; bn++; } }
    }
    if (an < 5 || bn < 5) return -Infinity;
    return a / an - b / bn;
  }
  const RICHTUNGEN = 16;
  // Startpunkte auf einem 3-m-Raster
  const raster = Math.max(1, Math.round(3 / mProPx));
  const starts = [];
  const alle = [];
  for (let y = 0; y < h; y += raster) for (let x = 0; x < w; x += raster) {
    if (!mask[y * w + x]) continue;
    let best = -Infinity, bt = 0;
    for (let k = 0; k < RICHTUNGEN; k++) { const t = (k * Math.PI) / RICHTUNGEN; const r = antwort(x, y, t); if (r > best) { best = r; bt = t; } }
    if (best === -Infinity) continue;
    alle.push(best); starts.push([best, x, y, bt]);
  }
  if (alle.length < 20) return { linien: [], staerke: 0 };
  const sortiert = alle.slice().sort((a, b) => a - b);
  const med = sortiert[Math.floor(sortiert.length / 2)];
  const mad = sortiert.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[Math.floor(sortiert.length / 2)] || 0.05;
  const tStart = Math.max(0.4, med + 3.8 * mad), tWeiter = Math.max(0.2, med + 1.8 * mad);
  starts.sort((a, b) => b[0] - a[0]);

  const belegt = new Int32Array(n).fill(-1); // Pixel nahe einer gefundenen Gasse → deren Nummer
  const sperr = Math.round((abstandMinM / 3) / mProPx);
  const markiere = (pts, id) => {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0), k = Math.max(1, Math.ceil(len));
      for (let j = 0; j <= k; j++) {
        const cx = Math.round(x0 + ((x1 - x0) * j) / k), cy = Math.round(y0 + ((y1 - y0) * j) / k);
        for (let yy = cy - sperr; yy <= cy + sperr; yy++) for (let xx = cx - sperr; xx <= cx + sperr; xx++)
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && (xx - cx) ** 2 + (yy - cy) ** 2 <= sperr * sperr && belegt[yy * w + xx] < 0) belegt[yy * w + xx] = id;
      }
    }
  };
  const schrittPx = 3 / mProPx, maxLuecke = Math.round(40 / 3), maxDreh = (30 * Math.PI) / 180;
  const randPx = 30 / mProPx, aussen = voll || mask;
  const linien = [];
  function verfolge(x, y, t, id) {
    const pts = []; let luecke = 0, treffer = 0, gesamt = 0, anschluss = null;
    let px = x, py = y, dir = t;
    for (let iter = 0; iter < 2000; iter++) {
      let best = -Infinity, bx = 0, by = 0, bt = dir;
      for (let d = -maxDreh; d <= maxDreh + 1e-9; d += maxDreh / 4) {
        const tt = dir + d, qx = px + Math.cos(tt) * schrittPx, qy = py + Math.sin(tt) * schrittPx;
        if (!innen(qx, qy, mask)) continue;
        const r = antwort(qx, qy, tt) - Math.abs(d) * 0.3;
        if (r > best) { best = r; bx = qx; by = qy; bt = tt; }
      }
      if (best === -Infinity) break; // Rand erreicht
      gesamt++;
      if (best >= tWeiter) { luecke = 0; treffer++; dir = dir * 0.6 + bt * 0.4; px = bx; py = by; }
      else { luecke++; if (luecke > maxLuecke) break; px += Math.cos(dir) * schrittPx; py += Math.sin(dir) * schrittPx; if (!innen(px, py, mask)) break; }
      pts.push([px, py, best >= tWeiter]);
      const b = belegt[Math.round(py) * w + Math.round(px)];
      if (b >= 0 && b !== id && luecke === 0) { anschluss = b; break; } // trifft andere Gasse → anschließen
    }
    while (pts.length && !pts[pts.length - 1][2]) pts.pop(); // Lücke am Ende verwerfen
    return { pts: pts.map(([a, b]) => [a, b]), treffer, gesamt, anschluss };
  }
  const bisRand = (p, q) => { // vom Endpunkt q in Richtung p→q bis zum Flurstücksrand, wenn nah
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    let k = 0; while (innen(q[0] + ux * (k + 1), q[1] + uy * (k + 1), aussen)) k++;
    return k <= randPx && k > 0 ? [q[0] + ux * k, q[1] + uy * k] : null;
  };
  for (const [r0, x, y, t] of starts) {
    if (r0 < tStart) break;
    if (belegt[y * w + x] >= 0) continue;
    const id = linien.length;
    const vor = verfolge(x, y, t, id), zur = verfolge(x, y, t + Math.PI, id);
    let pts = [...zur.pts.reverse(), [x, y], ...vor.pts];
    const laenge = pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0) * mProPx;
    const anteil = (vor.treffer + zur.treffer + 1) / Math.max(1, vor.gesamt + zur.gesamt + 1);
    if (laenge < 30 || anteil < 0.55 || pts.length < 3) continue;
    // Enden bis an den Flurstücksrand ziehen, wenn sie nah daran enden und nicht an eine andere Gasse anschließen
    if (!vor.anschluss && pts.length > 2) { const e = bisRand(pts[pts.length - 3], pts[pts.length - 1]); if (e) pts.push(e); }
    if (!zur.anschluss && pts.length > 2) { const e = bisRand(pts[2], pts[0]); if (e) pts.unshift(e); }
    pts = vereinfachePx(pts, 1.5 / mProPx);
    linien.push(pts);
    markiere(pts, id);
  }
  return { linien: verbinde(linien, 45 / mProPx, (25 * Math.PI) / 180), staerke: tStart };
}

/** Stücke derselben Gasse verbinden: Enden nah beieinander und Richtung passt */
function verbinde(linien, maxAbst, maxWinkel) {
  const richtung = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const winkelDiff = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
  let L0 = linien.map((l) => l.slice());
  let geaendert = true;
  while (geaendert) {
    geaendert = false;
    outer: for (let i = 0; i < L0.length; i++) for (let j = 0; j < L0.length; j++) {
      if (i === j) continue;
      const a = L0[i], b = L0[j];
      // Ende von a an Anfang von b (b ggf. umdrehen)
      for (const bb of [b, b.slice().reverse()]) {
        const ae = a[a.length - 1], bs = bb[0];
        const d = Math.hypot(bs[0] - ae[0], bs[1] - ae[1]);
        if (d > maxAbst) continue;
        const ra = richtung(a[Math.max(0, a.length - 2)], ae), rb = richtung(bs, bb[Math.min(1, bb.length - 1)]), rv = richtung(ae, bs);
        if (winkelDiff(ra, rb) > maxWinkel || (d > 3 && winkelDiff(ra, rv) > maxWinkel)) continue;
        L0[i] = [...a, ...bb];
        L0.splice(j, 1);
        geaendert = true;
        break outer;
      }
    }
  }
  return L0;
}

function vereinfachePx(P, tol) {
  if (P.length < 3) return P;
  const keep = new Array(P.length).fill(false); keep[0] = keep[P.length - 1] = true;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = P[a], [x2, y2] = P[b], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
    let best = 0, bi = -1;
    for (let i = a + 1; i < b; i++) { const d = L < 1e-6 ? Math.hypot(P[i][0] - x1, P[i][1] - y1) : Math.abs(dy * P[i][0] - dx * P[i][1] + x2 * y1 - y2 * x1) / L; if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = true; stack.push([a, bi], [bi, b]); }
  }
  return P.filter((_, i) => keep[i]);
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
  return { linien: r.linien.map((ab) => ab.map(zuLL)) };
}
