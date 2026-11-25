// Rückegassen-Raster: parallele Gassen mit festem Abstand über ein Flurstück legen,
// und Abstände zwischen vorhandenen Gassen messen. Rechnet in einer lokalen Meter-Ebene.

const R = 6371000;
function ebene(bezug) {
  const k = Math.cos((bezug[0] * Math.PI) / 180);
  return {
    hin: ([lat, lng]) => [((lng - bezug[1]) * Math.PI / 180) * R * k, ((lat - bezug[0]) * Math.PI / 180) * R],
    zurueck: ([x, y]) => [Number((bezug[0] + (y / R) * 180 / Math.PI).toFixed(7)), Number((bezug[1] + (x / (R * k)) * 180 / Math.PI).toFixed(7))],
  };
}
const ringeVon = (polys) => polys.flat(); // [[ [lat,lng]... ] ...] – Außen- und Innenringe
function mitte(ringe) { const pts = ringe.flat(); return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]; }

/** Richtung (Grad, 0 = Nord, im Uhrzeigersinn) der längsten Kante des Außenrings */
export function hauptRichtung(polys) {
  const ringe = ringeVon(polys);
  const E = ebene(mitte(ringe));
  let best = 0, winkel = 0;
  for (const ring of ringe.slice(0, 1)) {
    const p = ring.map(E.hin);
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > best) { best = l; winkel = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI; }
    }
  }
  return ((winkel % 180) + 180) % 180;
}

/**
 * Parallele Gassen im Flurstück. winkel: Richtung der Gassen in Grad (0 = Nord–Süd, 90 = Ost–West),
 * abstand in m (Mitte zu Mitte), versatz in m (verschiebt das ganze Raster quer).
 * Gibt { linien: [[lat,lng],[lat,lng]][], abstaende: [{ at:[lat,lng], m }] } zurück.
 */
export function gassenRaster(polys, { abstand = 30, winkel = 0, versatz = 0, minLaenge = 15 } = {}) {
  const ringe = ringeVon(polys);
  if (!ringe.length) return { linien: [], abstaende: [] };
  const E = ebene(mitte(ringe));
  const P = ringe.map((r) => r.map(E.hin));
  const w = (winkel * Math.PI) / 180;
  const d = [Math.sin(w), Math.cos(w)]; // Gassenrichtung
  const n = [Math.cos(w), -Math.sin(w)]; // quer dazu
  const proj = (p, v) => p[0] * v[0] + p[1] * v[1];
  const alle = P.flat();
  const nMin = Math.min(...alle.map((p) => proj(p, n))), nMax = Math.max(...alle.map((p) => proj(p, n)));
  const start = nMin + ((((versatz - nMin) % abstand) + abstand) % abstand);
  const linien = [], mitten = [];
  for (let o = start; o <= nMax; o += abstand) {
    // Schnittpunkte der Linie {p·n = o} mit allen Kanten
    const t = [];
    for (const ring of P) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const pa = proj(a, n) - o, pb = proj(b, n) - o;
      if ((pa > 0) === (pb > 0) || pa === pb) continue;
      const s = pa / (pa - pb);
      const q = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
      t.push(proj(q, d));
    }
    t.sort((x, y) => x - y);
    for (let i = 0; i + 1 < t.length; i += 2) {
      if (t[i + 1] - t[i] < minLaenge) continue;
      const pkt = (u) => [n[0] * o + d[0] * u, n[1] * o + d[1] * u];
      linien.push([E.zurueck(pkt(t[i])), E.zurueck(pkt(t[i + 1]))]);
      mitten.push({ o, u: (t[i] + t[i + 1]) / 2 });
    }
  }
  // Abstandsangaben zwischen benachbarten Gassen (in der Mitte zwischen ihnen)
  const abstaende = [];
  const offs = [...new Set(mitten.map((m) => m.o))].sort((a, b) => a - b);
  for (let i = 0; i + 1 < offs.length; i++) {
    const a = mitten.filter((m) => m.o === offs[i]), b = mitten.filter((m) => m.o === offs[i + 1]);
    if (!a.length || !b.length) continue;
    const u = (a[0].u + b[0].u) / 2, o = (offs[i] + offs[i + 1]) / 2;
    abstaende.push({ at: E.zurueck([n[0] * o + d[0] * u, n[1] * o + d[1] * u]), m: Math.round(offs[i + 1] - offs[i]) });
  }
  return { linien, abstaende };
}

/** Abstände zwischen vorhandenen, ungefähr parallelen Gassen (für die Anzeige im Editor) */
export function gassenAbstaende(gassen, { maxM = 80, maxWinkel = 25 } = {}) {
  const lin = gassen.filter((g) => g.line?.length >= 2);
  if (lin.length < 2) return [];
  const E = ebene(mitte([lin.flatMap((g) => g.line)]));
  const P = lin.map((g) => g.line.map(E.hin));
  const richt = (p) => { const a = p[0], b = p[p.length - 1]; return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI; };
  const mittelpunkt = (p) => { let L = 0; const seg = []; for (let i = 1; i < p.length; i++) { const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); seg.push(l); L += l; } let r = L / 2; for (let i = 1; i < p.length; i++) { if (r <= seg[i - 1]) { const s = r / seg[i - 1]; return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * s, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * s]; } r -= seg[i - 1]; } return p[0]; };
  const abstandZuLinie = (q, p) => { let best = Infinity, fuss = null; for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i]; const vx = b[0] - a[0], vy = b[1] - a[1]; const l2 = vx * vx + vy * vy || 1; let s = ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / l2; if (s <= 0 || s >= 1) continue; const f = [a[0] + vx * s, a[1] + vy * s]; const dd = Math.hypot(q[0] - f[0], q[1] - f[1]); if (dd < best) { best = dd; fuss = f; } } return { d: best, fuss }; };
  const out = [], gesehen = new Set();
  P.forEach((p, i) => {
    const m = mittelpunkt(p);
    const a0 = p[0], b0 = p[p.length - 1];
    const seite = (q) => Math.sign((b0[0] - a0[0]) * (q[1] - a0[1]) - (b0[1] - a0[1]) * (q[0] - a0[0]));
    const best = {};
    P.forEach((p2, j) => {
      if (i === j) return;
      const dw = Math.abs((((richt(p) - richt(p2)) % 180) + 180) % 180);
      if (Math.min(dw, 180 - dw) > maxWinkel) return;
      const r = abstandZuLinie(m, p2);
      if (!r.fuss || r.d > maxM) return;
      const sd = seite(r.fuss);
      if (!best[sd] || r.d < best[sd].d) best[sd] = { ...r, j };
    });
    for (const b of Object.values(best)) {
      const key = [i, b.j].sort().join('-');
      if (gesehen.has(key)) continue;
      gesehen.add(key);
      out.push({ at: E.zurueck([(m[0] + b.fuss[0]) / 2, (m[1] + b.fuss[1]) / 2]), m: Math.round(b.d), von: E.zurueck(m), bis: E.zurueck(b.fuss) });
    }
  });
  return out;
}
