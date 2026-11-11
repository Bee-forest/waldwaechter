// Fläche einer Maßnahme: ganzes Flurstück oder selbst eingezeichnete Teilfläche.
import { h, fill } from './ui.js';
import { store } from './store.js';
import { createBaseMap, BASEMAP_LABELS } from './map/basemap.js';
import { areaHa, formatHa, polysOf, inPolys, centroid } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { umlaufSteuerung, vereinfachen } from './umlauf.js';

const STIL_FLURSTUECK = { color: '#F2C94C', weight: 3, fillOpacity: 0.06, interactive: false };
const STIL_MASSNAHME = { color: '#F26B1D', weight: 3, fillColor: '#F26B1D', fillOpacity: 0.28, interactive: false };

/** Kleine Karte mit Flurstück; optional weitere Fläche hervorgehoben. */
export function miniKarte(el, parcel, { zoom = 17 } = {}) {
  const settings = store.get().settings || {};
  const polys = parcel ? polysOf(parcel) : [];
  const base = createBaseMap(el, { center: parcel ? centroid(parcel.ring) : [50.9, 11.0], zoom, basemap: settings.basemap, alkis: false });
  const map = base.map;
  // Hintergrund OSM / Luftbild umschaltbar (Wahl wird gemerkt)
  const Schalter = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'segmented compact karten-schalter');
      el.setAttribute('role', 'radiogroup'); el.setAttribute('aria-label', 'Hintergrundkarte');
      const malen = () => {
        el.replaceChildren(...Object.entries(BASEMAP_LABELS).map(([k, l]) => {
          const b = L.DomUtil.create('button', '');
          b.type = 'button'; b.textContent = l; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(base.basemap === k));
          b.onclick = (e) => { e.preventDefault(); base.setBasemap(k); store.update((x) => { x.settings.basemap = k; }); malen(); };
          return b;
        }));
      };
      malen();
      L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el);
      ['pointerdown', 'touchstart', 'mousedown'].forEach((t) => el.addEventListener(t, (e) => e.stopPropagation()));
      return el;
    },
  });
  new Schalter({ position: 'topright' }).addTo(map);
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
 * Auswahl für das Formular „Neue Maßnahme“: ganzes Flurstück oder Teilfläche einzeichnen.
 * Gibt { el, wert() } zurück; wert() liefert { modus, ring?, ha } oder null, wenn die Zeichnung unvollständig ist.
 */
export function flaechenWahl(parcel) {
  let modus = 'ganz', draft = [], karte = null, umlauf = null;
  const umlaufHost = h('div');
  const host = h('div', { class: 'flaeche-wahl' });
  const status = h('p', { class: 'draw-status', 'aria-live': 'polite' });
  const mapEl = h('div', { class: 'mini-map' });
  const lyr = L.layerGroup();

  function zeichne() {
    lyr.clearLayers();
    if (modus !== 'teil') return;
    if (draft.length >= 2) L.polygon(draft, STIL_MASSNAHME).addTo(lyr);
    draft.forEach((ll) => L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: '#F26B1D', fillOpacity: 1, interactive: false }).addTo(lyr));
    status.textContent = draft.length >= 3 ? `${draft.length} Eckpunkte, ${formatHa(areaHa(draft))}` : `${draft.length} von mindestens 3 Eckpunkten – tippe in der Karte auf die Ecken der Fläche oder lauf sie mit dem GPS ab.`;
  }
  function render() {
    fill(host,
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Fläche der Maßnahme' },
        [['ganz', 'Ganzes Flurstück'], ['teil', 'Teilfläche einzeichnen']].map(([k, l]) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(modus === k), class: modus === k ? 'on' : '',
          onclick: () => { modus = k; render(); },
        }, l))),
      modus === 'ganz'
        ? h('p', { class: 'muted' }, `Die Maßnahme gilt für das ganze Flurstück (${formatHa(amtlicheFlaecheHa(parcel))}).`)
        : [mapEl, status, umlaufHost, h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => { draft.pop(); zeichne(); } }, 'Letzten Punkt entfernen'),
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => { draft = []; zeichne(); } }, 'Neu beginnen'))],
    );
    if (modus === 'teil' && !karte) {
      karte = miniKarte(mapEl, parcel);
      lyr.addTo(karte.map);
      karte.map.doubleClickZoom.disable(); // schnelles Tippen setzt Punkte statt zu zoomen
      karte.map.on('click', (e) => { draft.push([e.latlng.lat, e.latlng.lng]); zeichne(); });
      umlauf = umlaufSteuerung({ map: karte.map, onPunkt: (ll) => { draft.push(ll); zeichne(); }, onEnde: () => { draft = vereinfachen(draft, 1.5); zeichne(); } });
      fill(umlaufHost, umlauf.el);
    } else if (karte) setTimeout(() => karte.map.invalidateSize(), 60);
    zeichne();
  }
  render();
  return {
    el: host,
    wert() {
      if (modus === 'ganz') return { modus: 'ganz', ha: amtlicheFlaecheHa(parcel) };
      if (draft.length < 3) return null;
      return { modus: 'teil', ring: [...draft], ha: areaHa(draft) };
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
