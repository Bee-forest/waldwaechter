// Fläche oder Zaunverlauf mit dem GPS abgehen: Beim Umlaufen werden automatisch Punkte gesetzt,
// sobald man sich um den Mindestabstand weiterbewegt hat und das GPS genau genug ist.
import { h, fill } from './ui.js';
import { distance, formatDist } from './geo.js';
import { createPositionSource } from './thinning/gps.js';

/** Douglas-Peucker in Metern: entfernt Punkte, die weniger als tol vom Verlauf abweichen */
export function vereinfachen(pts, tol = 1.5) {
  if (pts.length < 3) return pts;
  const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const P = pts.map(([la, lo]) => [lo * kx, la * ky]);
  const keep = new Array(P.length).fill(false); keep[0] = keep[P.length - 1] = true;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = P[a], [x2, y2] = P[b];
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
    let best = 0, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = P[i];
      const d = L < 1e-6 ? Math.hypot(x - x1, y - y1) : Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = true; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Bedienleiste „Mit GPS umlaufen“.
 * @param {L.Map} map  Karte für die Live-Position
 * @param {(ll:[number,number]) => void} onPunkt  neuer Punkt
 * @param {() => void} onEnde  Umlauf beendet (Aufrufer kann vereinfachen)
 */
export function umlaufSteuerung({ map, onPunkt, onEnde, minAbstand = 4, maxGenau = 15, text = 'Fläche umlaufen' }) {
  const el = h('div', { class: 'umlauf' });
  let gps = null, aktiv = false, letzter = null, n = 0, weg = 0, genau = null;
  const pos = L.circleMarker([0, 0], { radius: 8, color: '#fff', weight: 3, fillColor: '#1A73E8', fillOpacity: 1, interactive: false });
  const kreis = L.circle([0, 0], { radius: 1, color: '#1A73E8', weight: 1, fillOpacity: 0.08, interactive: false });
  let folgen = true;

  function render(meldung = '') {
    fill(el,
      aktiv
        ? h('div', { class: 'umlauf-live' },
            h('span', { class: 'umlauf-punkt', 'aria-hidden': 'true' }),
            h('div', {}, h('strong', {}, 'Umlauf läuft'),
              h('small', {}, `${n} Punkte, ${formatDist(weg)} gegangen${genau != null ? ` · GPS ±${Math.round(genau)} m` : ''}`),
              meldung ? h('small', { class: 'warn' }, meldung) : null),
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => stop(false) }, 'Pause'),
            h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => stop(true) }, 'Fertig'))
        : h('button', { type: 'button', class: 'btn btn-block umlauf-start', onclick: start },
            h('span', { class: 'umlauf-icon', 'aria-hidden': 'true' }, '◎'), `${text} (GPS setzt die Punkte)`),
      !aktiv && meldung ? h('p', { class: 'warn-line' }, meldung) : null,
      aktiv ? null : h('small', { class: 'hint' }, `Geh die Grenze ab – alle ${minAbstand} m wird ein Punkt gesetzt, wenn das GPS auf ±${maxGenau} m genau ist. Am genauesten wird es langsam und mit freiem Himmel. Punkte lassen sich danach wie gewohnt ergänzen.`));
  }
  function start() {
    aktiv = true; letzter = null; n = 0; weg = 0; folgen = true;
    pos.addTo(map); kreis.addTo(map);
    map.once('dragstart', () => { folgen = false; });
    gps = createPositionSource({});
    gps.start((p) => {
      genau = p.accuracy;
      pos.setLatLng(p.latlng); kreis.setLatLng(p.latlng).setRadius(p.accuracy || 1);
      if (folgen) map.panTo(p.latlng, { animate: true });
      if (p.accuracy > maxGenau) { render(`GPS zu ungenau (±${Math.round(p.accuracy)} m) – kurz stehen bleiben oder freie Sicht zum Himmel suchen.`); return; }
      const d = letzter ? distance(letzter, p.latlng) : Infinity;
      if (d >= minAbstand) {
        if (letzter) weg += d;
        letzter = p.latlng; n++;
        onPunkt([p.latlng[0], p.latlng[1]]);
      }
      render();
    }, (e) => {
      // kurzzeitige Aussetzer (kein Signal, Zeitüberschreitung) beenden den Umlauf nicht
      if (e.code === 2 || e.code === 3) { render(`${e.message} Weitergehen – der Umlauf läuft weiter.`); return; }
      stop(false); render(e.message);
    });
    try { navigator.wakeLock?.request('screen').then((w) => { el._wl = w; }).catch(() => {}); } catch { /* egal */ }
    render();
  }
  function stop(fertig) {
    gps?.stop(); gps = null; aktiv = false;
    pos.remove(); kreis.remove();
    el._wl?.release?.(); el._wl = null;
    render();
    if (fertig) onEnde?.();
  }
  render();
  return { el, stop: () => { if (aktiv) stop(false); } };
}
