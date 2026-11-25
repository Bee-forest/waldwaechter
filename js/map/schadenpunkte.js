// Symbole für Schadstellen (je Schadensart ein eigenes Zeichen) und eine Karte, in der man sie setzt.
import { h, fill, toast } from '../ui.js';
import { miniKarte } from '../flaeche.js';

const svg = (inhalt) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inhalt}</svg>`;
export const SCHADEN_SYMBOLE = {
  // Borkenkäfer: Körper mit Kopf und Beinen
  kaefer: svg('<ellipse cx="12" cy="14" rx="4.5" ry="6"/><circle cx="12" cy="6.5" r="2.2"/><path d="M12 8.5v11.5M7.5 11L4 9M7.5 14.5H3.5M7.5 18L4 20M16.5 11L20 9M16.5 14.5h4M16.5 18l3.5 2"/>'),
  // Windwurf: liegender Stamm mit Wurzelteller
  windwurf: svg('<circle cx="6" cy="15" r="4"/><path d="M10 15h11M14 15l2-3M18 15l2-3"/><path d="M2 20h20"/>'),
  // Bruch: Stamm mit abgebrochener, gezackter Spitze und liegender Krone
  bruch: svg('<path d="M8 21V10l2 2 1-3 1 2 1-2v12"/><path d="M15 17l6-2M17 16.5l1.5-2.5M19 15.8l1.6 1.6"/><path d="M3 21h18"/>'),
  // Trockenschaden: kahler Baum
  trocken: svg('<path d="M12 21V8M12 12l-4-3M12 10l4-4M12 15l3.5-2M8 9l-2 1M16 6l2 0"/><path d="M5 21h14"/>'),
  sonstig: svg('<path d="M12 5v9"/><circle cx="12" cy="18.5" r="1.2" fill="#fff"/>'),
};
export const SCHADEN_FARBE = '#B83A1E';
export const SCHADEN_NAMEN = { kaefer: 'Borkenkäfer', windwurf: 'Windwurf', bruch: 'Schnee- oder Windbruch', trocken: 'Trockenschaden', sonstig: 'Sonstiger Schaden' };
export function schadenIcon(typ, gross = 34) {
  return L.divIcon({ className: 'schaden-symbol', html: `<span style="width:${gross}px;height:${gross}px;background:${SCHADEN_FARBE}">${SCHADEN_SYMBOLE[typ] || SCHADEN_SYMBOLE.sonstig}</span>`, iconSize: [gross, gross], iconAnchor: [gross / 2, gross / 2] });
}

/**
 * Karte zum Setzen der Schadstellen. punkte: [{ at:[lat,lng], typ, genau? }] (wird verändert).
 * typ(): aktuelle Schadensart für neue Punkte. Gibt { el, setFlurstueck(p), neuZeichnen() } zurück.
 */
export function schadstellenKarte({ punkte, typ, onAenderung = () => {} }) {
  const kartenHost = h('div');
  const status = h('p', { class: 'draw-status', 'aria-live': 'polite' });
  const liste = h('div', { class: 'schaden-punkte' });
  const el = h('div', { class: 'schadstellen' }, kartenHost, status, h('div', { class: 'btn-row' },
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => gps() }, 'Meinen Standort als Schadstelle'),
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => { punkte.pop(); zeichne(); onAenderung(); } }, 'Letzte Stelle entfernen')), liste);
  let karte = null, lyr = null, parcel = null;
  function zeichne() {
    lyr?.clearLayers();
    punkte.forEach((p, i) => {
      if (!lyr) return;
      const m = L.marker(p.at, { icon: schadenIcon(p.typ), draggable: true, title: `Schadstelle ${i + 1}`, zIndexOffset: 500 });
      m.on('dragend', () => { const ll = m.getLatLng(); p.at = [Number(ll.lat.toFixed(7)), Number(ll.lng.toFixed(7))]; p.genau = null; zeichne(); onAenderung(); });
      m.on('click', () => { punkte.splice(i, 1); zeichne(); onAenderung(); toast('Schadstelle entfernt'); });
      lyr.addLayer(m);
    });
    status.textContent = punkte.length
      ? `${punkte.length} ${punkte.length === 1 ? 'Schadstelle' : 'Schadstellen'} gesetzt. Antippen entfernt, gedrückt halten und ziehen verschiebt.`
      : 'Tippe in die Karte, wo der Schaden ist – bei mehreren Nestern oder Würfen jede Stelle einzeln.';
    fill(liste, punkte.map((p, i) => h('p', { class: 'muted' }, `Stelle ${i + 1}: ${p.at[0].toFixed(5)}, ${p.at[1].toFixed(5)}${p.genau ? ` (GPS ± ${p.genau} m)` : ''}`)));
  }
  function karteBauen() {
    karte?.map.remove();
    const mapEl = h('div', { class: 'mini-map schaden-karte' });
    kartenHost.replaceChildren(mapEl);
    karte = miniKarte(mapEl, parcel, { zoom: 17 });
    lyr = L.layerGroup().addTo(karte.map);
    karte.map.doubleClickZoom.disable();
    karte.map.on('click', (e) => { punkte.push({ at: [Number(e.latlng.lat.toFixed(7)), Number(e.latlng.lng.toFixed(7))], typ: typ() }); zeichne(); onAenderung(); });
    if (!parcel && punkte[0]) karte.map.setView(punkte[0].at, 17);
    zeichne();
  }
  function gps() {
    if (!navigator.geolocation) { toast('Kein GPS verfügbar'); return; }
    toast('Standort wird bestimmt …');
    navigator.geolocation.getCurrentPosition((p) => {
      const at = [p.coords.latitude, p.coords.longitude];
      punkte.push({ at, typ: typ(), genau: Math.round(p.coords.accuracy) });
      karte?.map.setView(at, Math.max(karte.map.getZoom(), 17));
      zeichne(); onAenderung();
    }, () => toast('Standort nicht verfügbar'), { enableHighAccuracy: true, timeout: 20000 });
  }
  return {
    el,
    setFlurstueck(p) { parcel = p || null; karteBauen(); },
    neuZeichnen() { zeichne(); setTimeout(() => karte?.map.invalidateSize(), 60); },
    entferne() { karte?.map.remove(); karte = null; },
  };
}

/** Alle Schadstellen offener (nicht behobener) Schadensmeldungen als Kartenebene */
export function createSchadenLayer(store, { oeffnen, behoben }) {
  const grp = L.layerGroup();
  const zeichne = () => {
    grp.clearLayers();
    for (const m of store.get().measures.filter((x) => x.type === 'schaden' && x.status !== 'fertig')) {
      const pkte = m.schaden?.punkte?.length ? m.schaden.punkte : m.schaden?.pos ? [{ at: m.schaden.pos, typ: m.schaden.typ }] : [];
      pkte.forEach((p, i) => {
        const mk = L.marker(p.at, { icon: schadenIcon(p.typ || m.schaden?.typ, 30), title: m.details?.schaden || 'Schaden', zIndexOffset: 450 });
        mk.bindPopup(() => h('div', { class: 'lager-popup' },
          h('strong', {}, `${m.details?.schaden || 'Schaden'}${pkte.length > 1 ? ` · Stelle ${i + 1} von ${pkte.length}` : ''}`),
          h('p', {}, `Festgestellt am ${new Date(m.date).toLocaleDateString('de-DE')}${m.details?.menge ? ` · ca. ${m.details.menge} Fm` : ''}${m.details?.baeume ? ` · ${m.details.baeume} Bäume` : ''}`),
          h('p', { class: 'muted' }, m.schaden?.gemeldet ? `An die FBG gemeldet am ${new Date(m.schaden.gemeldet).toLocaleDateString('de-DE')}` : 'Noch nicht gemeldet'),
          m.note ? h('p', { class: 'muted' }, m.note) : null,
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => { mk.closePopup(); behoben(m.id); } }, 'Als behoben markieren'),
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => { mk.closePopup(); oeffnen(m.id); } }, 'Details'))));
        grp.addLayer(mk);
      });
    }
  };
  zeichne();
  store.subscribe(zeichne);
  return grp;
}
