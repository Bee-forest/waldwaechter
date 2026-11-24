import { eigeneFlaechenLayer } from './eigeneflaechen.js';
// Punkt-Ebenen zum Selbstpflegen: Habitatbäume (stehend / liegend) und jagdliche Einrichtungen
// (Kanzel, Drückjagdbock, Erdsitz). Bearbeiten wie bei den Lagerplätzen: in die Karte tippen,
// antippen zum Ändern, gedrückt halten und ziehen zum Verschieben.
import { h, fill, dialog, confirmDialog, toast, openPage } from '../ui.js';
import { store, uid } from '../store.js';
import { createBaseMap } from './basemap.js';
import { openFotos, fotoKnopfText, fotosLoeschen } from '../fotos.js';

export const HABITAT_FARBE = '#2E7D32';
export const JAGD_FARBE = '#5D4037';

const svg = (inhalt) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inhalt}</svg>`;
export const SYMBOLE = {
  // stehender Baum: Krone auf Stamm
  stehend: svg('<circle cx="12" cy="9" r="6.5" fill="#fff" fill-opacity=".35"/><path d="M12 15.5V22M12 18l-3-2.5M12 17l2.5-2"/>'),
  // liegender Stamm mit Schnittfläche (Jahresringe) auf dem Boden
  liegend: svg('<path d="M3 20h18"/><path d="M4 10.5h12.5M4 17.5h12.5M4 10.5c-1.2 0-1.8 1.6-1.8 3.5s.6 3.5 1.8 3.5"/><ellipse cx="17" cy="14" rx="3" ry="3.5" fill="#fff" fill-opacity=".35"/><circle cx="17" cy="14" r="1.2"/>'),
  // Kanzel: geschlossene Hütte mit Dach auf Stelzen
  kanzel: svg('<path d="M3.5 8.5L12 3l8.5 5.5"/><rect x="6" y="8.5" width="12" height="6.5" fill="#fff" stroke="#fff"/><path d="M8.5 11.5h7" stroke="#5D4037"/><path d="M7.5 15l-2 7M16.5 15l2 7"/>'),
  // Drückjagdbock: offene Plattform mit Brüstung, ohne Dach, mit Leiter
  bock: svg('<path d="M5 6.5h14M5 6.5v6M19 6.5v6M4 12.5h16"/><path d="M6.5 12.5L4.5 22M17.5 12.5l2 9.5"/><path d="M10 12.5L9 22M14 12.5l1 9.5M9.6 16h4.8M9.2 19.5h5.6"/>'),
  // Erdsitz: niedriger, überdachter Sitz direkt am Boden
  erdsitz: svg('<path d="M2 20.5h20"/><path d="M4 12.5L12 8l8 4.5"/><path d="M6 12.5v8M18 12.5v8"/><path d="M6 15.5h12" stroke-dasharray="2 2"/>'),
};

export const ARTEN = {
  habitat: {
    titel: 'Habitatbaum', mehrzahl: 'Habitatbäume', farbe: HABITAT_FARBE, form: 'rund',
    typen: [['stehend', 'stehend'], ['liegend', 'liegend']],
  },
  jagd: {
    titel: 'Jagdliche Einrichtung', mehrzahl: 'Jagdliche Einrichtungen', farbe: JAGD_FARBE, form: 'eckig',
    typen: [['kanzel', 'Kanzel'], ['bock', 'Drückjagdbock'], ['erdsitz', 'Erdsitz']],
  },
};
export const HABITAT_MERKMALE = ['Höhlen (Specht, Fäule)', 'Mulmhöhle', 'Horst / Nest', 'Rindentaschen, Spalten', 'Pilzkonsolen', 'Kronentotholz', 'Uralt- / Methusalembaum', 'Blitzrinne, Stammriss'];
export const JAGD_ZUSTAND = [
  ['gut', 'gut, sicher nutzbar'],
  ['reparatur', 'reparaturbedürftig'],
  ['gesperrt', 'nicht nutzbar / gesperrt'],
];
const typText = (art, t) => ARTEN[art].typen.find(([k]) => k === t)?.[1] || '';
const zustandText = (k) => JAGD_ZUSTAND.find(([x]) => x === k)?.[1] || '';

const daten = () => store.get().punkte || { habitat: [], jagd: [] };
function speichere(fn) {
  store.update((s) => { s.punkte = s.punkte || {}; s.punkte.habitat ||= []; s.punkte.jagd ||= []; fn(s.punkte); });
}

/** Symbolgröße je Zoomstufe: nah groß, weiter weg deutlich kleiner (ab Zoom 14 nur noch ein Punkt) */
export const punktGroesse = (z) => (z >= 18 ? 36 : z >= 17 ? 30 : z >= 16 ? 24 : z >= 15 ? 18 : 12);
export function punktIcon(art, typ, groesse = 36) {
  const a = ARTEN[art];
  const g = groesse, rand = g >= 24 ? 3 : 2;
  const inhalt = g >= 18 ? (SYMBOLE[typ] || SYMBOLE[a.typen[0][0]]) : '';
  return L.divIcon({ className: `punkt-symbol punkt-${a.form}`, html: `<span aria-hidden="true" style="background:${a.farbe};width:${g}px;height:${g}px;border-width:${rand}px;--sym:${Math.round(g * 0.58)}px">${inhalt}</span>`, iconSize: [g, g], iconAnchor: [g / 2, g / 2] });
}

// ---------- Dialoge ----------
export async function punktDialog(art, alt = {}) {
  const a = ARTEN[art];
  const w = art === 'habitat'
    ? { typ: 'stehend', baumart: '', bhd: '', merkmale: [], markiert: false, text: '', ...alt }
    : { typ: 'kanzel', name: '', zustand: 'gut', kontrolle: '', text: '', ...alt };
  w.merkmale = [...(w.merkmale || [])];
  const typWahl = h('div', { class: 'segmented punkt-typwahl', role: 'radiogroup', 'aria-label': 'Art' });
  const zeigeTyp = () => fill(typWahl, a.typen.map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(w.typ === k), onclick: () => { w.typ = k; zeigeTyp(); } },
    h('span', { class: `punkt-mini punkt-${a.form}`, style: `background:${a.farbe}`, html: SYMBOLE[k] }), l)));
  zeigeTyp();
  const felder = art === 'habitat' ? [
    h('label', {}, 'Baumart', h('input', { value: w.baumart, placeholder: 'z. B. Rotbuche, Eiche, Kiefer', oninput: (e) => { w.baumart = e.target.value; } })),
    h('label', {}, 'Brusthöhendurchmesser (cm, optional)', h('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: w.bhd, oninput: (e) => { w.bhd = e.target.value; } })),
    h('div', { class: 'fin-feld' }, h('span', { class: 'fin-feld-label' }, 'Merkmale'),
      h('div', { class: 'chip-wahl' }, HABITAT_MERKMALE.map((m) => h('label', { class: 'check-row' },
        h('input', { type: 'checkbox', checked: w.merkmale.includes(m), onchange: (e) => { w.merkmale = e.target.checked ? [...w.merkmale, m] : w.merkmale.filter((x) => x !== m); } }), m)))),
    h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: !!w.markiert, onchange: (e) => { w.markiert = e.target.checked; } }), 'Am Baum markiert (z. B. Wellenlinie, „H“)'),
  ] : [
    h('label', {}, 'Name / Nummer', h('input', { value: w.name, placeholder: 'z. B. Kanzel 7 am Wiesengrund', oninput: (e) => { w.name = e.target.value; } })),
    h('label', {}, 'Zustand', h('select', { onchange: (e) => { w.zustand = e.target.value; } }, JAGD_ZUSTAND.map(([k, l]) => h('option', { value: k, selected: k === w.zustand }, l)))),
    h('label', {}, 'Zuletzt kontrolliert', h('input', { type: 'date', value: w.kontrolle, onchange: (e) => { w.kontrolle = e.target.value; } })),
  ];
  const ok = await dialog({
    title: alt.id ? `${a.titel} bearbeiten` : (art === 'habitat' ? 'Neuer Habitatbaum' : 'Neue jagdliche Einrichtung'),
    body: h('div', { class: 'form' },
      h('div', { class: 'fin-feld' }, h('span', { class: 'fin-feld-label' }, 'Art'), typWahl),
      ...felder,
      h('label', {}, 'Beschreibung', h('textarea', { rows: 3, placeholder: art === 'habitat' ? 'Lage, Besonderheiten, Verkehrssicherung …' : 'Schussrichtung, Zugang, Revier, Besonderheiten …', oninput: (e) => { w.text = e.target.value; } }, w.text))),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'Speichern', value: true, primary: true }],
  });
  if (!ok) return null;
  const basis = { id: alt.id || uid(), at: alt.at, typ: w.typ, text: (w.text || '').trim(), erfasst: alt.erfasst || Date.now() };
  const eintrag = art === 'habitat'
    ? { ...basis, baumart: w.baumart.trim(), bhd: Number(w.bhd) || null, merkmale: w.merkmale, markiert: !!w.markiert }
    : { ...basis, name: w.name.trim(), zustand: w.zustand, kontrolle: w.kontrolle || '' };
  speichere((p) => { const i = p[art].findIndex((x) => x.id === eintrag.id); if (i >= 0) p[art][i] = eintrag; else p[art].push(eintrag); });
  return eintrag;
}

function punktTitel(art, x) {
  if (art === 'habitat') return `Habitatbaum, ${typText(art, x.typ)}${x.baumart ? ` – ${x.baumart}` : ''}`;
  return x.name ? `${typText(art, x.typ)}: ${x.name}` : typText(art, x.typ);
}

function punktPopup(art, x, { schliessen, nurAnsehen }) {
  const zeilen = art === 'habitat'
    ? [x.bhd ? `BHD ${x.bhd} cm` : null, x.merkmale?.length ? x.merkmale.join(', ') : null, x.markiert ? 'am Baum markiert' : null]
    : [zustandText(x.zustand), x.kontrolle ? `kontrolliert am ${new Date(x.kontrolle).toLocaleDateString('de-DE')}` : null];
  return h('div', { class: 'lager-popup' },
    h('strong', {}, punktTitel(art, x)),
    zeilen.filter(Boolean).map((z) => h('p', {}, z)),
    x.text ? h('p', { class: 'muted' }, x.text) : null,
    nurAnsehen ? h('p', { class: 'muted' }, art === 'habitat' ? 'Bearbeiten unter „Weitere Layer“ → Naturschutz → „Habitatbäume bearbeiten“.' : 'Bearbeiten unter „Weitere Layer“ → Jagd → „Jagdliche Einrichtungen bearbeiten“.') : null,
    h('div', { class: 'btn-row' },
      nurAnsehen ? null : h('button', { class: 'btn btn-small', onclick: () => { schliessen(); punktDialog(art, x); } }, 'Bearbeiten'),
      nurAnsehen ? null : h('button', { class: 'btn btn-small btn-danger-ghost', onclick: async () => { schliessen(); if (await confirmDialog(`${ARTEN[art].titel} löschen?`, { ok: 'Löschen', danger: true })) { speichere((p) => { p[art] = p[art].filter((y) => y.id !== x.id); }); fotosLoeschen(`${art}:${x.id}`); } } }, 'Löschen'),
      h('button', { class: 'btn btn-small', onclick: () => { schliessen(); openFotos(`${art}:${x.id}`, punktTitel(art, x)); } }, fotoKnopfText(`${art}:${x.id}`)),
      h('a', { class: 'btn btn-small', href: `https://www.google.com/maps/dir/?api=1&destination=${x.at[0]},${x.at[1]}`, target: '_blank', rel: 'noopener' }, 'Navigation')));
}

// ---------- Kartenebenen ----------
/** Ebenen „habitat“ und „jagd“ für eine Karte; zeichnen sich bei Änderungen selbst neu */
export function createPunktLayers(map, { klickbar = () => true, verschiebbar = false, nurAnsehen = false } = {}) {
  const gruppen = { habitat: L.layerGroup(), jagd: L.layerGroup() };
  function zeichne() {
    const d = daten();
    for (const art of Object.keys(ARTEN)) {
      gruppen[art].clearLayers();
      for (const x of d[art] || []) {
        if (!x.at) continue;
        const m = L.marker(x.at, { icon: punktIcon(art, x.typ, punktGroesse(map.getZoom())), title: punktTitel(art, x), zIndexOffset: 350, draggable: verschiebbar });
        if (verschiebbar) m.on('dragend', () => { const ll = m.getLatLng(); speichere((p) => { const y = p[art].find((z) => z.id === x.id); if (y) y.at = [Number(ll.lat.toFixed(7)), Number(ll.lng.toFixed(7))]; }); toast(`${ARTEN[art].titel} verschoben`); });
        m.bindPopup(() => punktPopup(art, x, { schliessen: () => map.closePopup(), nurAnsehen }));
        m.on('click', (e) => { if (!klickbar()) { L.DomEvent.stop(e); m.closePopup(); } });
        gruppen[art].addLayer(m);
      }
    }
  }
  zeichne();
  const ab = store.subscribe(zeichne);
  let letzte = punktGroesse(map.getZoom());
  const beiZoom = () => { const g = punktGroesse(map.getZoom()); if (g !== letzte) { letzte = g; zeichne(); } };
  map.on('zoomend', beiZoom);
  return { ...gruppen, entfernen: () => { ab(); map.off('zoomend', beiZoom); } };
}

// ---------- Bearbeiten ----------
export function openPunktEditor({ center, zoom = 17, art = 'habitat' } = {}) {
  // Habitatbäume und jagdliche Einrichtungen werden getrennt bearbeitet: ein Editor je Art
  const s0 = store.get();
  const A = ARTEN[art];
  const mapEl = h('div', { class: 'ersch-map malt' });
  const leiste = h('div', { class: 'ersch-leiste' });
  const inhalt = h('div', { class: 'ersch' }, mapEl, leiste);
  openPage(A.mehrzahl, inhalt, { onClose: () => { lyr.entfernen(); abo(); map.remove(); } });
  const base = createBaseMap(mapEl, { center, zoom, basemap: s0.settings.basemap, alkis: true });
  const map = base.map;
  L.control.zoom({ position: 'topleft' }).addTo(map);
  eigeneFlaechenLayer(map);
  const lyr = createPunktLayers(map, { verschiebbar: true });
  lyr[art].addTo(map);
  setTimeout(() => map.invalidateSize(), 250);

  // Tippen in die Karte legt einen neuen Punkt an; vorhandene Punkte antippen = bearbeiten, gedrückt ziehen = verschieben
  map.on('click', async (e) => {
    const x = await punktDialog(art, { at: [Number(e.latlng.lat.toFixed(7)), Number(e.latlng.lng.toFixed(7))] });
    if (x) toast(`${A.titel} gespeichert`);
  });

  function render() {
    const d = daten();
    const zaehle = A.typen.map(([k, l]) => `${(d[art] || []).filter((x) => x.typ === k).length} ${l}`).join(', ');
    fill(leiste,
      h('p', { class: 'draw-status' }, `Tippe in die Karte, wo ${art === 'habitat' ? 'ein Habitatbaum steht oder liegt' : 'eine jagdliche Einrichtung steht'} – dann öffnet sich das Formular. Vorhandene Punkte antippen zum Bearbeiten oder Löschen, gedrückt halten und ziehen zum Verschieben.`),
      h('p', { class: 'muted' }, `Eingetragen: ${zaehle}`),
      h('div', { class: 'punkt-legende' }, A.typen.map(([k, l]) => h('span', {}, h('span', { class: `punkt-mini punkt-${A.form}`, style: `background:${A.farbe}`, html: SYMBOLE[k] }), l))),
      art === 'jagd' ? h('button', { type: 'button', class: 'btn btn-block', onclick: () => import('../jagdkarte.js').then((x) => x.openJagdkarte()) }, 'Revierkarte als PDF erstellen') : null);
  }
  render();
  const abo = store.subscribe(render);
}
