// Fotopunkte auf der Karte: Kamera-Symbol mit Blickrichtung. Antippen zeigt Name, Aufnahmen und
// „Fotos“ / „Hinführen“ / „Verschieben“. Dazu ein Kartenwähler, um einen Fotopunkt per Fingertipp
// zu setzen oder zu verschieben (ohne GPS am Ort).
/* global L */
import { h, openPage } from '../ui.js';
import { store } from '../store.js';
import { createBaseMap } from './basemap.js';
import { compassLabel } from '../geo.js';

export const FOTOPUNKT_FARBE = '#7B3FA0';

export function fotopunktIcon(blick) {
  const kegel = Number.isFinite(Number(blick))
    ? `<svg class="fp-kegel" viewBox="0 0 60 60" width="60" height="60" style="transform:rotate(${Number(blick)}deg)"><path d="M30 30 L19 3 A28 28 0 0 1 41 3 Z" fill="${FOTOPUNKT_FARBE}" fill-opacity=".35" stroke="${FOTOPUNKT_FARBE}" stroke-width="1.5"/></svg>`
    : '';
  const kamera = `<span class="fp-punkt" style="background:${FOTOPUNKT_FARBE}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span>`;
  return L.divIcon({ className: 'fp-icon', html: kegel + kamera, iconSize: [60, 60], iconAnchor: [30, 30], popupAnchor: [0, -14] });
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
          aktionen.verschieben ? h('button', { type: 'button', class: 'link-btn', onclick: () => { map.closePopup(); aktionen.verschieben(f); } }, 'Verschieben') : null)));
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
export function punktAufKarteWaehlen({ titel = 'Punkt auf der Karte setzen', center, zoom = 17, start = null, blick = null, umriss = null } = {}) {
  return new Promise((resolve) => {
    let gewaehlt = start ? [...start] : null, fertig = false;
    const mapEl = h('div', { class: 'ersch-map malt' });
    const status = h('p', { class: 'draw-status' });
    const ok = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => { fertig = true; seite.close(); resolve(gewaehlt); } }, 'Übernehmen');
    const zeigeStatus = () => {
      status.textContent = gewaehlt ? 'Punkt gesetzt. Tippe erneut, um ihn zu verschieben – oder ziehe ihn mit dem Finger.' : 'Tippe in die Karte, wo der Fotopunkt ist (z. B. Wegkreuzung, markierter Baum).';
      ok.disabled = !gewaehlt;
    };
    const seite = openPage(titel, h('div', { class: 'ersch' }, mapEl, h('div', { class: 'ersch-leiste' }, status, ok)), { onClose: () => { map.remove(); if (!fertig) resolve(null); } });
    const base = createBaseMap(mapEl, { center: start || center, zoom, basemap: store.get().settings.basemap, alkis: true });
    const map = base.map;
    L.control.zoom({ position: 'topleft' }).addTo(map);
    if (umriss?.length) L.polygon(umriss, { color: '#FFFFFF', weight: 3, fillOpacity: 0.08, interactive: false }).addTo(map);
    let marker = null;
    const setze = (ll) => {
      gewaehlt = [Number(ll[0].toFixed(7)), Number(ll[1].toFixed(7))];
      if (!marker) {
        marker = L.marker(gewaehlt, { icon: fotopunktIcon(blick), draggable: true }).addTo(map);
        marker.on('dragend', () => { const p = marker.getLatLng(); gewaehlt = [Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7))]; });
      } else marker.setLatLng(gewaehlt);
      zeigeStatus();
    };
    if (gewaehlt) setze(gewaehlt);
    map.on('click', (e) => setze([e.latlng.lat, e.latlng.lng]));
    zeigeStatus();
    setTimeout(() => map.invalidateSize(), 250);
  });
}

/** Alle offenen Seiten schließen und auf der Startkarte zu einem Punkt springen */
export function aufKarteZeigen(at) {
  window.dispatchEvent(new CustomEvent('ww:karte-punkt', { detail: { at, ebene: 'fotopunkte' } }));
}
