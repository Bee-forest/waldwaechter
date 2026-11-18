// Grenzfinder und Zielnavigation: per GPS zur nächsten Flurstücksgrenze, zu einem Eckpunkt (Grenzstein) oder zu
// einem gespeicherten Punkt (z. B. Fotopunkt) – mit großem Pfeil, Entfernung und Kompass.
import { h, fill, openPage, toast } from './ui.js';
import { polysOf, distance, bearing, compassLabel, formatDist, makeProjector } from './geo.js';
import { miniKarte } from './flaeche.js';

// ---------- Geometrie ----------
/** Nächster Punkt auf den Grenzen (Außen- und Innenringe) */
export function naechsteGrenze(pt, polys) {
  const P = makeProjector(pt);
  let best = null;
  for (const rings of polys) for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = P.toXY(ring[i]), b = P.toXY(ring[i + 1]);
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / l2)) : 0;
      const q = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(q[0], q[1]);
      if (!best || d < best.d) best = { d, ll: P.toLatLng(q) };
    }
  }
  return best;
}
/** Eckpunkte (Knickpunkte) der Grenze – dort stehen meist die Grenzsteine */
export function eckpunkte(polys, minWinkel = 12) {
  const out = [];
  for (const rings of polys) for (const ring of rings) {
    const n = ring.length - 1;
    for (let i = 0; i < n; i++) {
      const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
      const w = Math.abs(((bearing(b, c) - bearing(a, b) + 540) % 360) - 180);
      if (w >= minWinkel) out.push(b);
    }
  }
  return out.filter((p, i) => out.findIndex((q) => distance(p, q) < 1) === i);
}
const inRing = ([y, x], ring) => { let r = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [yi, xi] = ring[i], [yj, xj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r; } return r; };
const innen = (pt, polys) => polys.some((rings) => inRing(pt, rings[0]) && !rings.slice(1).some((r) => inRing(pt, r)));

// ---------- Kompass ----------
function kompass(onHeading) {
  const lesen = (e) => {
    let hd = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null);
    if (hd == null) return;
    onHeading((hd + (screen.orientation?.angle ?? 0) + 360) % 360);
  };
  const start = async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
      if (r !== 'granted') { toast('Kompass nicht freigegeben – der Pfeil zeigt dann nach Norden ausgerichtet.'); return; }
    }
    window.addEventListener('deviceorientationabsolute', lesen); window.addEventListener('deviceorientation', lesen);
  };
  return { start, stop: () => { window.removeEventListener('deviceorientationabsolute', lesen); window.removeEventListener('deviceorientation', lesen); } };
}

const PFEIL = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6 L80 78 L50 62 L20 78 Z" fill="currentColor" stroke="#fff" stroke-width="4" stroke-linejoin="round"/></svg>';

/**
 * Navigationsseite.
 * @param {object} o  titel, parcel (für Grenze/Eckpunkte), ziel ([lat,lng] fester Zielpunkt), zielName, blick (Blickrichtung in Grad, z. B. für Fotopunkte)
 */
export function openNavigation(o) {
  const polys = o.parcel ? polysOf(o.parcel) : [];
  const ecken = polys.length ? eckpunkte(polys) : [];
  let modus = o.ziel ? 'punkt' : 'grenze', gewaehlt = null, pos = null, genau = null, heading = null, watch = null;
  const pfeil = h('div', { class: 'nav-pfeil', html: PFEIL });
  const entf = h('div', { class: 'nav-entf' }, '–');
  const info = h('p', { class: 'nav-info', 'aria-live': 'polite' }, 'Warte auf GPS …');
  const modusEl = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Ziel' });
  const mapEl = h('div', { class: 'mini-map nav-karte' });
  const body = h('div', { class: 'nav-seite' }, polys.length && !o.ziel ? modusEl : null, h('div', { class: 'nav-anzeige' }, pfeil, entf), info, mapEl,
    o.blick != null ? h('p', { class: 'hint' }, `Blickrichtung für das Foto: ${o.blick}° (${compassLabel(o.blick)})`) : null,
    h('p', { class: 'hint' }, polys.length ? 'Grenzen und Eckpunkte aus ALKIS. Grenzsteine stehen meist an den Eckpunkten, können aber fehlen oder versetzt sein. Handy-GPS ist im Wald oft nur auf 5–15 m genau – für eine verbindliche Grenzfeststellung braucht es eine Vermessungsstelle.' : 'Handy-GPS ist im Wald oft nur auf 5–15 m genau.'));
  const k = kompass((hd) => { heading = hd; aktualisiere(); });
  const page = openPage(o.titel || 'Navigation', body, { onClose: () => { if (watch != null) navigator.geolocation.clearWatch(watch); k.stop(); karte?.remove(); } });
  let karte = null, posM = null, zielM = null, linie = null;
  setTimeout(() => {
    karte = miniKarte(mapEl, o.parcel || null, { zoom: 18 });
    if (o.ziel) karte.map.setView(o.ziel, 18);
    ecken.forEach((e) => L.circleMarker(e, { radius: 7, color: '#fff', weight: 2, fillColor: '#6D4C41', fillOpacity: 1 }).on('click', () => { modus = 'ecke'; gewaehlt = e; zeichneModus(); aktualisiere(); }).addTo(karte.map));
    if (o.ziel) L.circleMarker(o.ziel, { radius: 9, color: '#fff', weight: 3, fillColor: '#F26B1D', fillOpacity: 1 }).addTo(karte.map);
  }, 50);
  function zeichneModus() {
    fill(modusEl, [['grenze', 'Nächste Grenze'], ['ecke', 'Nächster Eckpunkt']].map(([m, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(modus === m), onclick: () => { modus = m; gewaehlt = null; zeichneModus(); aktualisiere(); } }, l)));
  }
  zeichneModus();
  function ziel() {
    if (!pos) return null;
    if (modus === 'punkt') return { ll: o.ziel, name: o.zielName || 'Ziel' };
    if (modus === 'ecke') {
      const e = gewaehlt || ecken.slice().sort((a, b) => distance(pos, a) - distance(pos, b))[0];
      return e ? { ll: e, name: gewaehlt ? 'gewählter Eckpunkt' : 'nächster Eckpunkt' } : null;
    }
    const g = naechsteGrenze(pos, polys);
    return g ? { ll: g.ll, name: 'nächste Grenze' } : null;
  }
  function aktualisiere() {
    const z = ziel();
    if (!z) return;
    const d = distance(pos, z.ll), b = bearing(pos, z.ll);
    const rel = heading != null ? (b - heading + 360) % 360 : b;
    pfeil.style.transform = `rotate(${rel}deg)`;
    pfeil.classList.toggle('nah', d <= Math.max(3, genau || 0));
    entf.textContent = formatDist(Math.round(d));
    const drin = polys.length ? innen(pos, polys) : null;
    fill(info, d <= Math.max(3, genau || 0)
      ? `Du bist am Ziel (${z.name}) – im Rahmen der GPS-Genauigkeit von ± ${genau || '?'} m.`
      : `${z.name}: ${formatDist(Math.round(d))} Richtung ${compassLabel(b)} (${Math.round(b)}°)${drin == null ? '' : drin ? ' · du bist im Flurstück' : ' · du bist außerhalb des Flurstücks'}${genau ? ` · GPS ± ${genau} m` : ''}${heading == null ? ' · Pfeil nach Norden ausgerichtet (kein Kompass)' : ''}`);
    if (karte) {
      posM ? posM.setLatLng(pos) : (posM = L.circleMarker(pos, { radius: 8, color: '#fff', weight: 3, fillColor: '#1A73E8', fillOpacity: 1 }).addTo(karte.map));
      zielM ? zielM.setLatLng(z.ll) : (zielM = L.circleMarker(z.ll, { radius: 6, color: '#F26B1D', weight: 3, fill: false }).addTo(karte.map));
      linie ? linie.setLatLngs([pos, z.ll]) : (linie = L.polyline([pos, z.ll], { color: '#F26B1D', weight: 3, dashArray: '6 6' }).addTo(karte.map));
    }
  }
  if (!navigator.geolocation) fill(info, 'Dieses Gerät liefert keinen Standort.');
  else {
    watch = navigator.geolocation.watchPosition((p) => {
      const erst = !pos;
      pos = [p.coords.latitude, p.coords.longitude]; genau = Math.round(p.coords.accuracy);
      aktualisiere();
      if (erst && karte) { const z = ziel(); if (z) karte.map.fitBounds(L.latLngBounds([pos, z.ll]).pad(0.3), { maxZoom: 19 }); }
    }, () => fill(info, 'Standort nicht verfügbar – GPS einschalten und Freigabe erlauben.'), { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  k.start();
  return page;
}
