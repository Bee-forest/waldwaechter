// Fotopunkte auf der Karte: Kamera-Symbol mit Blickrichtung. Antippen zeigt Name, Aufnahmen und
// „Fotos“ / „Hinführen“ / „Verschieben“. Dazu ein Kartenwähler, um einen Fotopunkt per Fingertipp
// zu setzen oder zu verschieben (ohne GPS am Ort).
/* global L */
import { h, fill, openPage } from '../ui.js';
import { store } from '../store.js';
import { createBaseMap } from './basemap.js';
import { compassLabel } from '../geo.js';

export const FOTOPUNKT_FARBE = '#7B3FA0';

const RICHTUNG = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
/** Kamera mit deutlichem Blickkegel und Pfeil in Blickrichtung (Norden = oben) */
export function fotopunktIcon(blick) {
  const g = Number(blick);
  const mit = blick !== null && blick !== '' && Number.isFinite(g);
  const kegel = mit
    ? `<svg class="fp-kegel" viewBox="0 0 110 110" width="110" height="110" style="transform:rotate(${g}deg)">
        <path d="M55 55 L36 9 A50 50 0 0 1 74 9 Z" fill="${FOTOPUNKT_FARBE}" fill-opacity=".28" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
        <path d="M55 55 L36 9 A50 50 0 0 1 74 9 Z" fill="none" stroke="${FOTOPUNKT_FARBE}" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M55 42 L55 6" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
        <path d="M55 42 L55 8" stroke="${FOTOPUNKT_FARBE}" stroke-width="3" stroke-linecap="round"/>
        <path d="M46 14 L55 2 L64 14 Z" fill="${FOTOPUNKT_FARBE}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
      </svg>`
    : '';
  const kamera = `<span class="fp-punkt" style="background:${FOTOPUNKT_FARBE}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span>`;
  // Himmelsrichtung als Schild hinter der Pfeilspitze, bleibt aufrecht lesbar
  const r = (g * Math.PI) / 180;
  const schild = mit ? `<span class="fp-richtung" style="left:${55 + Math.sin(r) * 62}px;top:${55 - Math.cos(r) * 62}px">${RICHTUNG[Math.round(g / 45) % 8]}</span>` : '';
  return L.divIcon({ className: 'fp-icon', html: kegel + kamera + schild, iconSize: [110, 110], iconAnchor: [55, 55], popupAnchor: [0, -16] });
}

/** Ebene mit allen Fotopunkten. aktionen: { fotos(f), hinfuehren(f), verschieben(f) } */
export function createFotopunktLayer(map, aktionen = {}) {
  const gruppe = L.layerGroup();
  function zeichne() {
    gruppe.clearLayers();
    for (const f of store.get().fotopunkte || []) {
      if (!f.at) continue;
      const m = L.marker(f.at, { icon: fotopunktIcon(f.blick), title: f.name || 'Fotopunkt', zIndexOffset: 400 });
      m.bindPopup(() => h('div', { class: 'fp-popup' },
        h('strong', {}, f.name || 'Fotopunkt'),
        h('p', { class: 'muted' }, `Blick ${f.blick}° (${compassLabel(f.blick)})${f.genau ? ` · gemessen ± ${f.genau} m` : f.perKarte ? ' · auf der Karte gesetzt' : ''}`),
        h('div', { class: 'btn-row' },
          aktionen.fotos ? h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => { map.closePopup(); aktionen.fotos(f); } }, 'Fotos') : null,
          aktionen.hinfuehren ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => { map.closePopup(); aktionen.hinfuehren(f); } }, 'Hinführen') : null,
          aktionen.verschieben ? h('button', { type: 'button', class: 'link-btn', onclick: () => { map.closePopup(); aktionen.verschieben(f); } }, 'Standort / Blickrichtung ändern') : null)));
      gruppe.addLayer(m);
    }
  }
  zeichne();
  store.subscribe(zeichne);
  return gruppe;
}

/**
 * Punkt auf der Karte wählen. Liefert [lat, lng] oder null (abgebrochen).
 * @param {object} o  titel, center, zoom, start (bisheriger Punkt), blick (für die Vorschau), umriss (Polygone des Flurstücks)
 */
export function punktAufKarteWaehlen({ titel = 'Punkt auf der Karte setzen', center, zoom = 17, start = null, blick = null, umriss = null, mitBlick = false } = {}) {
  return new Promise((resolve) => {
    let gewaehlt = start ? [...start] : null, fertig = false, modus = 'ort';
    let richtung = blick === '' || blick == null || !Number.isFinite(Number(blick)) ? null : Number(blick);
    const mapEl = h('div', { class: 'ersch-map malt' });
    const status = h('p', { class: 'draw-status' });
    const ok = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => { fertig = true; seite.close(); resolve(mitBlick ? { at: gewaehlt, blick: richtung } : gewaehlt); } }, 'Übernehmen');
    const modusEl = h('div', { class: 'segmented ersch-modus', role: 'radiogroup', 'aria-label': 'Was setzen' });
    const zeigeModus = () => fill(modusEl, [['ort', 'Standort'], ['blick', 'Blickrichtung']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(modus === k), disabled: k === 'blick' && !gewaehlt, onclick: () => { modus = k; zeigeModus(); zeigeStatus(); } }, l)));
    const zeigeStatus = () => {
      status.textContent = modus === 'blick'
        ? `Tippe in die Karte, wohin du von hier aus schaust (z. B. auf die Kultur).${richtung != null ? ` Jetzt: ${Math.round(richtung)}° (${compassLabel(Math.round(richtung))}).` : ''}`
        : gewaehlt ? `Punkt gesetzt. Tippe erneut, um ihn zu verschieben – oder ziehe ihn mit dem Finger.${mitBlick ? ' Dann oben „Blickrichtung“ wählen.' : ''}` : 'Tippe in die Karte, wo der Fotopunkt ist (z. B. Wegkreuzung, markierter Baum).';
      ok.disabled = !gewaehlt;
    };
    const seite = openPage(titel, h('div', { class: 'ersch' }, mitBlick ? modusEl : null, mapEl, h('div', { class: 'ersch-leiste' }, status, ok)), { onClose: () => { map.remove(); if (!fertig) resolve(null); } });
    const base = createBaseMap(mapEl, { center: start || center, zoom, basemap: store.get().settings.basemap, alkis: true });
    const map = base.map;
    L.control.zoom({ position: 'topleft' }).addTo(map);
    if (umriss?.length) L.polygon(umriss, { color: '#FFFFFF', weight: 3, fillOpacity: 0.08, interactive: false }).addTo(map);
    let marker = null;
    const setze = (ll) => {
      gewaehlt = [Number(ll[0].toFixed(7)), Number(ll[1].toFixed(7))];
      if (!marker) {
        marker = L.marker(gewaehlt, { icon: fotopunktIcon(richtung), draggable: true }).addTo(map);
        marker.on('dragend', () => { const p = marker.getLatLng(); gewaehlt = [Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7))]; });
      } else marker.setLatLng(gewaehlt);
      zeigeModus(); zeigeStatus();
    };
    const richte = (ll) => {
      const a = map.latLngToContainerPoint(gewaehlt), b = map.latLngToContainerPoint(ll);
      richtung = Math.round(((Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI + 360) % 360);
      marker.setIcon(fotopunktIcon(richtung)); zeigeStatus();
    };
    if (gewaehlt) setze(gewaehlt);
    map.on('click', (e) => (modus === 'blick' && gewaehlt ? richte(e.latlng) : setze([e.latlng.lat, e.latlng.lng])));
    zeigeModus(); zeigeStatus();
    setTimeout(() => map.invalidateSize(), 250);
  });
}

/** Alle offenen Seiten schließen und auf der Startkarte zu einem Punkt springen */
export function aufKarteZeigen(at) {
  window.dispatchEvent(new CustomEvent('ww:karte-punkt', { detail: { at, ebene: 'fotopunkte' } }));
}
