// Fläche für eine Maßnahme direkt in der Karte wählen – wie bei der Durchforstung:
// jedes Flurstück antippen (muss nicht zu „Meine Flächen“ gehören) oder eine Fläche selbst einzeichnen.
import { h, fill, icon, openPage, toast } from './ui.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { createBaseMap } from './map/basemap.js';
import { eigeneFlaechenLayer } from './map/eigeneflaechen.js';
import { areaHa, formatHa, polysOf, centroid } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';

const STIL_WAHL = { color: '#F26B1D', weight: 3, fillColor: '#F26B1D', fillOpacity: 0.25, interactive: false };

/** Öffnet eine Kartenseite. Ergebnis: { parcel, ring } – ring nur bei eingezeichneter Fläche; null bei Abbruch. */
export function flaecheAufKarte({ titel = 'Fläche wählen', frage = 'Welche Fläche?', parcelId = null, nurFlurstueck = false, knopf = 'Weiter zu den Angaben' } = {}) {
  return new Promise((resolve) => {
    const own = store.get().parcels.filter((p) => p.ring);
    let modus = 'parcel', parcel = own.find((p) => p.id === parcelId) || null, draft = [], fertigeTeile = [], fertig = false, ich = null, suche = 0;

    const mapEl = h('div', { class: 'fk-karte' });
    const tabsEl = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Art der Flächenauswahl' });
    const infoEl = h('div', { class: 'fk-info' });
    const weiter = h('button', { type: 'button', class: 'btn btn-primary btn-block btn-large', onclick: () => {
      fertig = true;
      const ringe = [...fertigeTeile, draft].filter((r) => r.length >= 3).map((r) => r.map((x) => [...x]));
      const erg = modus === 'parcel' ? { parcel } : { parcel: null, ring: ringe[0], ringe };
      seite.close();
      resolve(erg);
    } }, knopf);
    // Eigene Flächen auch direkt aus der Liste wählbar
    const eigeneWahl = own.length ? h('label', { class: 'fk-eigene' }, 'Aus meinen Flächen',
      h('select', { onchange: (e) => { const p = own.find((x) => x.id === e.target.value); if (!p) return; modus = 'parcel'; parcel = p; tabs(); zeichne(); info(); map.fitBounds(L.polygon(polysOf(p)).getBounds(), { padding: [24, 24], maxZoom: 17 }); } },
        h('option', { value: '' }, '– oder in der Karte antippen –'),
        own.map((p) => h('option', { value: p.id, selected: p.id === parcel?.id }, `Flurstück ${p.nr}, ${p.gemarkung}`)))) : null;
    const seite = openPage(titel, h('div', { class: 'fk' }, h('h2', { class: 'step-title' }, frage), eigeneWahl, nurFlurstueck ? null : tabsEl, mapEl, infoEl, weiter),
      { onClose: () => { try { map.remove(); } catch {} if (!fertig) resolve(null); } });

    const start = parcel ? centroid(parcel.ring) : own.length ? centroid(own[0].ring) : [50.9, 11.0];
    const { map } = createBaseMap(mapEl, { center: start, zoom: own.length || parcel ? 16 : 9, basemap: store.get().settings?.basemap, alkis: true });
    eigeneFlaechenLayer(map);
    const wahlLyr = L.layerGroup().addTo(map);
    const ichLyr = L.layerGroup().addTo(map);
    setTimeout(() => {
      map.invalidateSize();
      const b = parcel ? L.polygon(polysOf(parcel)).getBounds() : own.length ? L.featureGroup(own.map((p) => L.polygon(polysOf(p)))).getBounds() : null;
      if (b?.isValid()) map.fitBounds(b, { padding: [24, 24], maxZoom: 17 });
    }, 80);

    // Standort-Knopf in der Karte
    const ortBtn = L.control({ position: 'topleft' });
    ortBtn.onAdd = () => { const b = h('button', { type: 'button', class: 'map-fab fk-ort', title: 'Mein Standort', 'aria-label': 'Mein Standort', html: icon.locate }); L.DomEvent.disableClickPropagation(b); b.onclick = () => standort(true); return b; };
    ortBtn.addTo(map);
    function standort(hin) {
      if (!navigator.geolocation) { toast('GPS ist auf diesem Gerät nicht verfügbar.'); return; }
      navigator.geolocation.getCurrentPosition((g) => {
        ich = { at: [g.coords.latitude, g.coords.longitude], genau: Math.round(g.coords.accuracy) };
        ichLyr.clearLayers();
        L.circle(ich.at, { radius: ich.genau, color: '#2F6FB0', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(ichLyr);
        L.circleMarker(ich.at, { radius: 6, color: '#fff', weight: 2, fillColor: '#2F6FB0', fillOpacity: 1, interactive: false }).addTo(ichLyr);
        if (hin) map.setView(ich.at, Math.max(map.getZoom(), 17));
        info();
      }, () => toast('Standort nicht verfügbar – GPS freigeben?'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
    }

    map.on('click', async (e) => {
      const ll = [e.latlng.lat, e.latlng.lng];
      if (modus === 'draw') { draft.push(ll); zeichne(); info(); return; }
      const nr = ++suche;
      toast('Suche Flurstück …');
      let p = null;
      try { p = await source.parcelAt(ll); } catch { p = null; }
      if (nr !== suche || modus !== 'parcel') return;
      if (!p) { toast(source.lastError ? 'Flurstücksdienst nicht erreichbar – du kannst die Fläche auch einzeichnen.' : 'Hier wurde kein Flurstück gefunden.'); return; }
      parcel = p; zeichne(); info();
    });

    function zeichne() {
      wahlLyr.clearLayers();
      if (modus === 'parcel' && parcel) L.polygon(polysOf(parcel), STIL_WAHL).addTo(wahlLyr);
      if (modus === 'draw') fertigeTeile.forEach((r, i) => L.polygon(r, STIL_WAHL).addTo(wahlLyr).bindTooltip(`Teilfläche ${i + 1}`, { permanent: true, direction: 'center', className: 'teil-label' }));
      if (modus === 'draw' && draft.length) {
        (draft.length >= 3 ? L.polygon(draft, STIL_WAHL) : L.polyline(draft, { ...STIL_WAHL, dashArray: '6 6' })).addTo(wahlLyr);
        draft.forEach((ll) => L.circleMarker(ll, { radius: 5, color: '#fff', weight: 2, fillColor: '#F26B1D', fillOpacity: 1, interactive: false }).addTo(wahlLyr));
      }
    }
    function tabs() {
      fill(tabsEl, [['parcel', 'Flurstück antippen'], ['draw', 'Fläche einzeichnen']].map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(modus === k), onclick: () => { if (k === modus) return; modus = k; tabs(); zeichne(); info(); } }, l)));
    }
    function info() {
      if (modus === 'parcel') {
        const meins = parcel && own.some((p) => p.id === parcel.id);
        fill(infoEl, parcel
          ? h('p', { class: 'selected-label' }, h('span', { html: icon.check }), `Flurstück ${parcel.nr}, ${parcel.gemarkung}, Flur ${parcel.flur} · ${formatHa(amtlicheFlaecheHa(parcel))}${meins ? ' · eigene Fläche' : ''}`)
          : h('p', { class: 'hint tap-hint' }, 'Tippe in der Karte auf ein beliebiges Flurstück – es muss nicht zu deinen Flächen gehören. Eigene Flächen sind farbig.'),
          parcel && !meins ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => {
            store.update((s) => { if (!s.parcels.some((x) => x.id === parcel.id)) s.parcels.push({ ...parcel, category: parcel.nutzung || 'Wald', addedAt: Date.now() }); });
            own.push(parcel); toast('Zu deinen Flächen hinzugefügt'); info();
          } }, h('span', { html: icon.plus || '' }), 'Zu meinen Flächen hinzufügen (optional)') : null,
          parcel ? h('p', { class: 'hint' }, 'Nur einen Teil des Flurstücks? Im nächsten Schritt kannst du Teilflächen einzeichnen.') : null);
        weiter.disabled = !parcel;
      } else {
        fill(infoEl,
          h('p', { class: 'hint' }, 'Tippe nacheinander auf die Eckpunkte – oder geh die Grenze ab und setze die Ecken an deinem Standort.'),
          h('p', { class: 'draw-status', 'aria-live': 'polite' }, `${fertigeTeile.length ? `${fertigeTeile.length} Teilfläche${fertigeTeile.length > 1 ? 'n' : ''} fertig · ` : ''}${draft.length >= 3 ? `${fertigeTeile.length ? `Teilfläche ${fertigeTeile.length + 1}: ` : ''}${draft.length} Eckpunkte, ${formatHa(areaHa(draft))}` : `${draft.length} von mindestens 3 Eckpunkten`}${fertigeTeile.length ? ` · gesamt ${formatHa([...fertigeTeile, draft].filter((r) => r.length >= 3).reduce((x, r) => x + areaHa(r), 0))}` : ''}`),
          h('button', { type: 'button', class: 'btn btn-block', onclick: () => {
            if (!ich) { standort(true); toast('Warte auf GPS … dann noch einmal tippen.'); return; }
            draft.push([...ich.at]); zeichne(); info(); standort(false);
          } }, h('span', { html: icon.locate }), ich ? `Eckpunkt an meinem Standort (± ${ich.genau} m)` : 'Standort für Eckpunkte einschalten'),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn btn-small', disabled: !draft.length && !fertigeTeile.length, onclick: () => { if (!draft.length) draft = fertigeTeile.pop(); else draft.pop(); zeichne(); info(); } }, 'Letzten Punkt entfernen'),
            h('button', { type: 'button', class: 'btn btn-small', disabled: draft.length < 3, onclick: () => { fertigeTeile.push(draft); draft = []; zeichne(); info(); } }, '+ Weitere Teilfläche'),
            h('button', { type: 'button', class: 'btn btn-small', disabled: !draft.length && !fertigeTeile.length, onclick: () => { draft = []; fertigeTeile = []; zeichne(); info(); } }, 'Alle löschen')));
        weiter.disabled = !(draft.length >= 3 || (fertigeTeile.length && !draft.length));
      }
    }
    tabs(); zeichne(); info();
  });
}

/** Schnappschuss eines Flurstücks, das nicht in „Meine Flächen“ liegt – damit die Maßnahme es später noch kennt */
export const flurstueckSchnappschuss = (p) => p && ({ id: p.id, nr: p.nr, flur: p.flur, gemarkung: p.gemarkung, gemeinde: p.gemeinde, lage: p.lage, ring: p.ring, polys: p.polys, flaecheAmtlich: p.flaecheAmtlich, nutzungText: p.nutzungText, source: p.source });

/** Fremdes Flurstück für Maßnahmen dauerhaft merken (ohne es zu „Meine Flächen“ hinzuzufügen) */
export function fremdesMerken(p) {
  if (!p?.id) return;
  store.update((s) => {
    if (s.parcels.some((x) => x.id === p.id)) return;
    s.fremdFlurstuecke = (s.fremdFlurstuecke || []).filter((x) => x.id !== p.id);
    s.fremdFlurstuecke.push(flurstueckSchnappschuss(p));
  });
}

/**
 * Flurstücks-Auswahl mit Knopf „Auf der Karte wählen“: Das gewählte Flurstück (auch ein fremdes) wird
 * in die Liste übernommen und ausgewählt – das change-Ereignis der Liste läuft wie bei einer normalen Auswahl.
 * @param {HTMLSelectElement} select  die bestehende Flurstücksliste
 * @param {object} byId  Nachschlage-Tabelle des Formulars (wird um das fremde Flurstück ergänzt)
 */
export function mitKartenwahl(select, byId = null, liste = null, { zeichnen = false, onRinge = null } = {}) {
  const knopf = h('button', { type: 'button', class: 'btn btn-small fk-knopf', onclick: async (e) => {
    e.preventDefault();
    const w = await flaecheAufKarte(zeichnen
      ? { titel: 'Fläche wählen', frage: 'Flurstück antippen oder Fläche(n) einzeichnen', parcelId: select.value && select.value !== '__ring' ? select.value : null, knopf: 'Übernehmen' }
      : { titel: 'Flurstück wählen', frage: 'Welches Flurstück?', parcelId: select.value || null, nurFlurstueck: true, knopf: 'Dieses Flurstück übernehmen' });
    if (w?.ringe?.length && onRinge) {
      onRinge(w.ringe);
      const ha = w.ringe.reduce((x, r) => x + areaHa(r), 0);
      let o = [...select.options].find((x) => x.value === '__ring');
      if (!o) { o = h('option', { value: '__ring' }); select.append(o); }
      o.textContent = `Eingezeichnete Fläche${w.ringe.length > 1 ? ` (${w.ringe.length} Teilflächen)` : ''}, ${formatHa(ha)}`;
      select.value = '__ring';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const p = w?.parcel;
    if (!p) return;
    if (byId && !Array.isArray(byId)) byId[p.id] = p;
    if (Array.isArray(liste) && !liste.some((x) => x.id === p.id)) liste.push(p); // bleibt in der Liste, wenn das Formular neu zeichnet
    const eigen = store.get().parcels.some((x) => x.id === p.id);
    if (!eigen) fremdesMerken(p);
    if (![...select.options].some((o) => o.value === p.id)) {
      select.append(h('option', { value: p.id }, `Flurstück ${p.nr}, ${p.gemarkung}${eigen ? '' : ' (nicht in „Meine Flächen“)'}`));
    }
    select.value = p.id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  } }, h('span', { html: icon.map || icon.locate }), zeichnen ? 'oder Fläche auf der Karte wählen / einzeichnen' : 'oder Flurstück auf der Karte wählen');
  return h('span', { class: 'flst-wahl' }, select, knopf);
}
