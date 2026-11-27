// Fotopunkte auf der Karte: Kamera-Symbol mit Blickrichtung. Antippen zeigt Name, Aufnahmen und
// „Fotos“ / „Hinführen“ / „Verschieben“. Dazu ein Kartenwähler, um einen Fotopunkt per Fingertipp
// zu setzen oder zu verschieben (ohne GPS am Ort).
/* global L */
import { h } from '../ui.js';
import { store } from '../store.js';
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
export function createFotopunktLayer(map, aktionen = {}, { ohne = () => null } = {}) {
  const gruppe = L.layerGroup();
  function zeichne() {
    gruppe.clearLayers();
    for (const f of store.get().fotopunkte || []) {
      if (!f.at || f.id === ohne()) continue;
      const m = L.marker(f.at, { icon: fotopunktIcon(f.blick), title: f.name || 'Fotopunkt', zIndexOffset: 400 });
      m.bindPopup(() => h('div', { class: 'fp-popup' },
        h('strong', {}, f.name || 'Fotopunkt'),
        h('p', { class: 'muted' }, `Blick ${f.blick}° (${compassLabel(f.blick)})${f.genau ? ` · gemessen ± ${f.genau} m` : f.perKarte ? ' · auf der Karte gesetzt' : ''}`),
        h('div', { class: 'btn-row' },
          aktionen.fotos ? h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => { map.closePopup(); aktionen.fotos(f); } }, 'Fotos') : null,
          aktionen.hinfuehren ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => { map.closePopup(); aktionen.hinfuehren(f); } }, 'Hinführen') : null,
          aktionen.verschieben ? h('button', { type: 'button', class: 'link-btn', onclick: () => { map.closePopup(); aktionen.verschieben(f); } }, 'Punkt bearbeiten') : null)));
      gruppe.addLayer(m);
    }
  }
  zeichne();
  const ab = store.subscribe(zeichne);
  gruppe.neuZeichnen = zeichne; gruppe.entfernen = ab;
  return gruppe;
}

/**
 * Fotopunkt direkt in einer vorhandenen Karte setzen (z. B. der Karte der Flurstückhistorie).
 * Unter der Karte erscheint eine Leiste: Standort / Blickrichtung, GPS, Abbrechen, Übernehmen.
 * Liefert { at, blick, genau } oder null.
 */
export function fotopunktAufKarte(map, leiste, { start = null, blick = null, titel = 'Fotopunkt setzen', mitGps = true } = {}) {
  return new Promise((resolve) => {
    let at = start ? [...start] : null, genau = null, modus = at ? 'blick' : 'ort', watch = null;
    let richtung = blick === '' || blick == null || !Number.isFinite(Number(blick)) ? null : Number(blick);
    const box = h('div', { class: 'fp-edit' });
    leiste.replaceChildren(box);
    map.getContainer().classList.add('malt');
    let marker = null;
    const gpsStopp = () => { if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; } };
    const ende = (wert) => {
      gpsStopp(); map.off('click', klick); marker?.remove(); map.getContainer().classList.remove('malt');
      leiste.replaceChildren(); resolve(wert);
    };
    const setze = (ll, acc = null) => {
      at = [Number(ll[0].toFixed(7)), Number(ll[1].toFixed(7))]; genau = acc;
      if (!marker) {
        marker = L.marker(at, { icon: fotopunktIcon(richtung), draggable: true, zIndexOffset: 1000 }).addTo(map);
        marker.on('dragend', () => { const q = marker.getLatLng(); at = [Number(q.lat.toFixed(7)), Number(q.lng.toFixed(7))]; genau = null; });
      } else marker.setLatLng(at);
      malen();
    };
    const richte = (ll) => {
      const a = map.latLngToContainerPoint(at), b = map.latLngToContainerPoint(ll);
      richtung = Math.round(((Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI + 360) % 360);
      marker.setIcon(fotopunktIcon(richtung)); malen();
    };
    function klick(e) { if (modus === 'blick' && at) richte(e.latlng); else { setze([e.latlng.lat, e.latlng.lng]); if (richtung == null) { modus = 'blick'; malen(); } } }
    map.on('click', klick);
    const gps = () => {
      if (!navigator.geolocation) return;
      gpsStopp();
      let best = null;
      watch = navigator.geolocation.watchPosition((pp) => {
        const acc = Math.round(pp.coords.accuracy);
        if (!best || acc <= best) { best = acc; setze([pp.coords.latitude, pp.coords.longitude], acc); map.panTo(at); }
        if (acc <= 5) gpsStopp();
      }, () => { gpsStopp(); malen('Kein GPS – bitte GPS einschalten oder den Punkt in die Karte tippen.'); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
      setTimeout(gpsStopp, 20000);
      malen();
    };
    function malen(fehler = null) {
      const text = fehler || (modus === 'blick'
        ? `Tippe in die Karte, wohin du von hier aus schaust (z. B. auf die Kultur).${richtung != null ? ` Jetzt: ${richtung}° (${compassLabel(richtung)}).` : ''}`
        : at ? `Standort gesetzt${genau != null ? ` (GPS ± ${genau} m${watch != null ? ', wird noch genauer …' : ''})` : ''}. Tippe erneut zum Verschieben oder ziehe den Punkt.` : 'Tippe in die Karte, wo der Fotopunkt ist (z. B. Wegkreuzung, markierter Baum) – oder nimm deinen GPS-Standort.');
      box.replaceChildren(
        h('strong', {}, titel),
        h('div', { class: 'segmented compact', role: 'radiogroup', 'aria-label': 'Was setzen' }, [['ort', 'Standort'], ['blick', 'Blickrichtung']].map(([k, l]) =>
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(modus === k), disabled: k === 'blick' && !at, onclick: () => { modus = k; malen(); } }, l))),
        h('p', { class: 'draw-status' }, text),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => ende(null) }, 'Abbrechen'),
          mitGps && navigator.geolocation && modus === 'ort' ? h('button', { type: 'button', class: 'btn btn-small', onclick: gps }, watch != null ? 'GPS misst …' : 'Mein GPS-Standort') : null,
          h('button', { type: 'button', class: 'btn btn-small btn-primary', disabled: !at, onclick: () => ende({ at, blick: richtung, genau }) }, 'Übernehmen')));
    }
    if (at) setze(at); else malen();
    map.getContainer().scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/** Alle offenen Seiten schließen und auf der Startkarte zu einem Punkt springen */
export function aufKarteZeigen(at) {
  window.dispatchEvent(new CustomEvent('ww:karte-punkt', { detail: { at, ebene: 'fotopunkte' } }));
}
