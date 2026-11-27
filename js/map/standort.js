// Eigener Standort in Bearbeitungskarten: Auswahl „Anzeigen“, „Karte folgen“, „Nicht anzeigen“.
// Die Wahl wird je Karte gemerkt. Beim Verschieben der Karte von Hand endet „Karte folgen“ (Standort bleibt sichtbar).
import { h, icon, toast } from '../ui.js';

const MODI = [['an', 'Anzeigen'], ['folgen', 'Karte folgen'], ['aus', 'Nicht anzeigen']];
const merken = (k, v) => { try { localStorage.setItem(`waldwaechter.standort.${k}`, v); } catch { /* */ } };
const gemerkt = (k) => { try { return localStorage.getItem(`waldwaechter.standort.${k}`); } catch { return null; } };

/** Fügt der Karte den Standort-Knopf hinzu. Rückgabe: { stop(), modus(), letzte() } */
export function standortSteuerung(map, { schluessel = 'karte', start = 'an', position = 'topleft', zentrieren = false } = {}) {
  let modus = gemerkt(schluessel) || start, watch = null, punkt = null, kreis = null, letzte = null, fehler = false, offen = false;
  const knopf = h('button', { type: 'button', class: 'standort-knopf', html: icon.locate });
  const menue = h('div', { class: 'standort-menue', role: 'menu', hidden: true });
  const box = h('div', { class: 'standort-steuerung leaflet-bar' }, knopf, menue);
  L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
  const ctl = L.control({ position }); ctl.onAdd = () => box; ctl.addTo(map);

  function anzeigen() {
    knopf.className = `standort-knopf standort-${modus}`;
    const l = MODI.find(([k]) => k === modus)[1];
    knopf.title = `Mein Standort: ${l}`; knopf.setAttribute('aria-label', `Mein Standort: ${l} – ändern`);
    menue.replaceChildren(...MODI.map(([k, t]) => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(k === modus), class: k === modus ? 'aktiv' : '', onclick: () => { setzen(k); zu(); } }, t)));
  }
  const zu = () => { offen = false; menue.hidden = true; };
  knopf.onclick = () => { offen = !offen; menue.hidden = !offen; };

  function setzen(k) {
    modus = k; merken(schluessel, k); anzeigen();
    if (k === 'aus') { stopWatch(); return; }
    starten();
    if (k === 'folgen' && letzte) map.panTo(letzte);
  }
  function starten() {
    if (watch != null) return;
    if (!('geolocation' in navigator)) { toast('Dein Gerät kann keinen Standort bestimmen.'); return; }
    fehler = false;
    watch = navigator.geolocation.watchPosition(pos, (e) => {
      if (e.code === 1) { toast('Standort freigeben: in den Browser-Einstellungen für diese Seite erlauben.'); modus = 'aus'; anzeigen(); stopWatch(); return; }
      if (!fehler) { fehler = true; toast('Standort gerade ungenau oder nicht verfügbar – es wird weiter gesucht.'); }
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  function pos(p) {
    const ll = [p.coords.latitude, p.coords.longitude], acc = p.coords.accuracy || 0;
    const erstes = !letzte; letzte = ll;
    if (!punkt) {
      kreis = L.circle(ll, { radius: acc, color: '#1F74B8', weight: 1, opacity: 0.5, fillColor: '#1F74B8', fillOpacity: 0.08, interactive: false }).addTo(map);
      punkt = L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: 'me', html: '<span class="me-dot"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);
    } else { punkt.setLatLng(ll); kreis.setLatLng(ll).setRadius(acc); }
    if (erstes && zentrieren && modus !== 'folgen') map.setView(ll, Math.max(map.getZoom(), 17)); // einmal hinspringen
    if (modus === 'folgen') {
      if (erstes) map.setView(ll, Math.max(map.getZoom(), 17));
      else if (!map.getBounds().pad(-0.3).contains(ll)) map.panTo(ll, { animate: true });
    }
  }
  function stopWatch() {
    if (watch != null) navigator.geolocation.clearWatch(watch);
    watch = null; letzte = null;
    punkt?.remove(); kreis?.remove(); punkt = kreis = null;
  }
  // Karte von Hand verschoben → nicht mehr folgen, Standort bleibt sichtbar
  const beiZiehen = () => { if (modus === 'folgen') { modus = 'an'; merken(schluessel, 'an'); anzeigen(); toast('Karte folgt nicht mehr – Standort wird weiter angezeigt.'); } };
  map.on('dragstart', beiZiehen);
  map.on('click', zu);

  anzeigen();
  if (modus !== 'aus') starten();
  return { stop: () => { stopWatch(); map.off('dragstart', beiZiehen); map.off('click', zu); }, modus: () => modus, letzte: () => letzte };
}
