import { eigeneFlaechenLayer } from './map/eigeneflaechen.js';
// Fläche einer Maßnahme: ganzes Flurstück oder selbst eingezeichnete Teilfläche.
import { h, fill, toast } from './ui.js';
import { store } from './store.js';
import { createBaseMap, BASEMAP_LABELS } from './map/basemap.js';
import { areaHa, formatHa, polysOf, inPolys, centroid } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { umlaufSteuerung, vereinfachen } from './umlauf.js';

const STIL_FLURSTUECK = { color: '#F2C94C', weight: 3, fillOpacity: 0.06, interactive: false };
const STIL_MASSNAHME = { color: '#F26B1D', weight: 3, fillColor: '#F26B1D', fillOpacity: 0.28, interactive: false };

/** Kleine Karte mit Flurstück; optional weitere Fläche hervorgehoben. */
export function miniKarte(el, parcel, { zoom = 17, hell = false } = {}) {
  const settings = store.get().settings || {};
  const polys = parcel ? polysOf(parcel) : [];
  const base = createBaseMap(el, { center: parcel ? centroid(parcel.ring) : [50.9, 11.0], zoom, basemap: settings.basemap, alkis: false, hell });
  const map = base.map;
  // Umschalter Luftbild/OSM kommt aus createBaseMap
  eigeneFlaechenLayer(map); // eigene Flächen farbig zur Orientierung
  const parcelLyr = parcel ? L.polygon(polys, STIL_FLURSTUECK).addTo(map) : null;
  const hl = L.layerGroup().addTo(map);
  const fit = (lyr) => setTimeout(() => { map.invalidateSize(); const b = (lyr || parcelLyr)?.getBounds(); if (b?.isValid()) map.fitBounds(b, { padding: [20, 20], maxZoom: 18 }); }, 60);
  fit();
  return {
    map,
    zeige(flaeche) {
      hl.clearLayers();
      if (!flaeche?.polys?.length) { fit(); return; }
      const lyr = L.polygon(flaeche.polys, STIL_MASSNAHME).addTo(hl);
      fit(lyr);
    },
    remove() { map.remove(); },
  };
}

/**
 * Auswahl für Maßnahmen: ganzes Flurstück oder eine bzw. mehrere Teilflächen einzeichnen.
 * start: ein Ring, mehrere Ringe oder ein gespeichertes flaeche-Objekt ({ ring, ringe }).
 * wert() liefert { modus: 'ganz', ha } oder { modus: 'teil', ring, ringe, ha } – null, wenn eine Teilfläche unvollständig ist.
 */
export function flaechenWahl(parcel, start = null) {
  const startRinge = !start ? [] : Array.isArray(start) ? (Array.isArray(start[0]?.[0]) ? start : [start]) : (start.ringe?.length ? start.ringe : start.ring ? [start.ring] : []);
  let ringe = startRinge.filter((r) => r?.length >= 3).map((r) => r.map((x) => [...x]));
  let modus = ringe.length ? 'teil' : 'ganz', aktiv = ringe.length ? ringe.length - 1 : 0, karte = null, umlauf = null;
  if (!ringe.length) ringe = [[]];
  const umlaufHost = h('div');
  const host = h('div', { class: 'flaeche-wahl' });
  const status = h('p', { class: 'draw-status', 'aria-live': 'polite' });
  const teileHost = h('div', { class: 'teil-liste' });
  const mapEl = h('div', { class: 'mini-map' });
  const lyr = L.layerGroup();
  const ecke = (an) => L.divIcon({ className: an ? 'gpunkt' : 'gpunkt gpunkt-mitte', html: '<span></span>', iconSize: an ? [22, 22] : [16, 16], iconAnchor: an ? [11, 11] : [8, 8] });
  const gesamtHa = () => ringe.filter((r) => r.length >= 3).reduce((x, r) => x + areaHa(r), 0);

  function zeichne() {
    lyr.clearLayers();
    if (modus !== 'teil') return;
    ringe.forEach((r, ri) => {
      const an = ri === aktiv;
      if (r.length >= 2) {
        const pg = L.polygon(r, { ...STIL_MASSNAHME, weight: an ? 3 : 2, fillOpacity: an ? 0.3 : 0.18, dashArray: an ? null : '5 5' });
        if (!an) pg.on('click', (e) => { L.DomEvent.stop(e); aktiv = ri; zeichne(); listeZeichnen(); });
        pg.addTo(lyr);
      }
      if (!an) return;
      r.forEach((ll, i) => {
        const m = L.marker(ll, { icon: ecke(true), draggable: true, zIndexOffset: 800, title: 'Ziehen verschiebt die Ecke · antippen entfernt sie' });
        m.on('drag', () => { const p = m.getLatLng(); r[i] = [p.lat, p.lng]; lyr.eachLayer((x) => { if (x instanceof L.Polygon && x.getLatLngs()[0]?.length === r.length) x.setLatLngs(r); }); });
        m.on('dragend', () => { zeichne(); listeZeichnen(); });
        m.on('click', (e) => { L.DomEvent.stop(e); r.splice(i, 1); zeichne(); listeZeichnen(); });
        m.addTo(lyr);
      });
    });
    const r = ringe[aktiv];
    status.textContent = r.length >= 3
      ? `Teilfläche ${aktiv + 1}: ${r.length} Ecken, ${formatHa(areaHa(r))}${ringe.length > 1 ? ` · zusammen ${formatHa(gesamtHa())}` : ''}. Ecken ziehen zum Verschieben, antippen zum Entfernen.`
      : `Teilfläche ${aktiv + 1}: ${r.length} von mindestens 3 Ecken – tippe in der Karte auf die Ecken oder lauf die Fläche mit dem GPS ab.`;
  }
  function listeZeichnen() {
    fill(teileHost, ringe.length > 1 ? h('div', { class: 'teil-chips' }, ringe.map((r, i) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(i === aktiv),
      onclick: () => { aktiv = i; zeichne(); listeZeichnen(); } }, `Teilfläche ${i + 1}${r.length >= 3 ? ` · ${formatHa(areaHa(r))}` : ' · unvollständig'}`))) : null);
  }
  function render() {
    fill(host,
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Fläche der Maßnahme' },
        [['ganz', 'Ganzes Flurstück'], ['teil', 'Teilfläche(n) einzeichnen']].map(([k, l]) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(modus === k), class: modus === k ? 'on' : '',
          onclick: () => { modus = k; render(); },
        }, l))),
      modus === 'ganz'
        ? h('p', { class: 'muted' }, `Die Maßnahme gilt für das ganze Flurstück (${formatHa(amtlicheFlaecheHa(parcel))}).`)
        : [mapEl, status, teileHost, umlaufHost, h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => { ringe[aktiv].pop(); zeichne(); listeZeichnen(); } }, 'Letzte Ecke entfernen'),
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => { if (ringe[aktiv].length < 3) { toast('Erst diese Teilfläche fertig einzeichnen (mindestens 3 Ecken).'); return; } ringe.push([]); aktiv = ringe.length - 1; zeichne(); listeZeichnen(); render(); } }, '+ Weitere Teilfläche'),
            h('button', { type: 'button', class: 'btn btn-small btn-danger-ghost', onclick: () => { if (ringe.length > 1) { ringe.splice(aktiv, 1); aktiv = Math.max(0, aktiv - 1); } else ringe[0] = []; zeichne(); listeZeichnen(); render(); } }, ringe.length > 1 ? 'Diese Teilfläche löschen' : 'Neu beginnen'))],
    );
    if (modus === 'teil' && !karte) {
      karte = miniKarte(mapEl, parcel);
      lyr.addTo(karte.map);
      karte.map.doubleClickZoom.disable(); // schnelles Tippen setzt Punkte statt zu zoomen
      karte.map.on('click', (e) => { ringe[aktiv].push([e.latlng.lat, e.latlng.lng]); zeichne(); listeZeichnen(); });
      umlauf = umlaufSteuerung({ map: karte.map, onPunkt: (ll) => { ringe[aktiv].push(ll); zeichne(); }, onEnde: () => { ringe[aktiv] = vereinfachen(ringe[aktiv], 1.5); zeichne(); listeZeichnen(); } });
      fill(umlaufHost, umlauf.el);
      if (ringe.some((r) => r.length >= 3)) setTimeout(() => karte.map.fitBounds(L.latLngBounds(ringe.flat()), { padding: [24, 24], maxZoom: 18 }), 120);
    } else if (karte) setTimeout(() => karte.map.invalidateSize(), 60);
    zeichne(); listeZeichnen();
  }
  render();
  return {
    el: host,
    wert() {
      if (modus === 'ganz') return { modus: 'ganz', ha: amtlicheFlaecheHa(parcel) };
      const fertig = ringe.filter((r) => r.length >= 3);
      if (!fertig.length || ringe.some((r) => r.length > 0 && r.length < 3)) return null;
      const rr = fertig.map((r) => r.map(([a, b]) => [Number(a.toFixed(7)), Number(b.toFixed(7))]));
      return { modus: 'teil', ring: rr[0], ringe: rr, ha: rr.reduce((x, r) => x + areaHa(r), 0) };
    },
    entferne() { umlauf?.stop(); karte?.remove(); },
  };
}

/** Fläche, auf der eine Maßnahme stattfindet – so wie sie beim Anlegen gewählt wurde. */
export function flaecheVon(m, parcel) {
  const t = m.thinning;
  if (t?.ring?.length) {
    const polys = t.clip?.length ? t.clip : polysOf(t);
    const ganz = t.mode === 'parcel';
    return {
      polys, ganz,
      art: t.mode === 'draw' ? 'Eingezeichnete Fläche' : t.mode === 'stand' ? 'Bestand im Flurstück' : 'Ganzes Flurstück',
      ha: t.plan?.flaecheGesamtHa ?? t.flaecheHa ?? areaHa(t.ring),
      label: t.label,
    };
  }
  if (m.flaeche?.ring?.length) return { polys: (m.flaeche.ringe?.length ? m.flaeche.ringe : [m.flaeche.ring]).map((r) => [r]), ganz: false, art: 'Eingezeichnete Teilfläche', ha: m.flaeche.ha ?? areaHa(m.flaeche.ring) };
  if (parcel) return { polys: polysOf(parcel), ganz: true, art: 'Ganzes Flurstück', ha: amtlicheFlaecheHa(parcel) };
  return null;
}

/** Gehört die Maßnahme zu diesem Flurstück? (zugeordnet oder eingezeichnete Fläche liegt darauf) */
export function betrifftFlurstueck(m, parcel) {
  if (m.parcelId) return m.parcelId === parcel.id;
  const ring = m.thinning?.ring || m.flaeche?.ring;
  if (!ring?.length || !parcel.ring?.length) return false;
  const polys = polysOf(parcel);
  return inPolys(centroid(ring), polys) || ring.some((pt) => inPolys(pt, polys));
}
