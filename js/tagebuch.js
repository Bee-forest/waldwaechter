// Waldtagebuch je Fläche: eigene Notizen mit Fotos, alle Maßnahmen, Schäden und Fotopunkte mit Datum –
// zusammen die Bestandsgeschichte (auch für Erben oder einen Verkauf). Fotopunkte: fester Standort und
// Blickrichtung, an dem jedes Jahr fotografiert wird.
import { h, fill, openPage, dialog, confirmDialog, toast, fmtDate } from './ui.js';
import { store, uid } from './store.js';
import { compassLabel } from './geo.js';
import { openFotos, fotoListe, fotosLoeschen, fotoKnopfText } from './fotos.js';
import { openNavigation } from './grenzfinder.js';
import { fotopunktAufKarte } from './map/fotopunkte.js';


/** Tagebuch und Flurstückhistorie sind eins: die Seite ist die Detailansicht der Flurstückhistorie */
export async function openWaldtagebuch(parcelId) {
  const { openHistorieFlurstueck } = await import('./historie.js');
  return openHistorieFlurstueck(parcelId);
}

/** Abschnitt „Fotopunkte“ eines Flurstücks (für die Flurstückhistorie) */
export function fotopunkteAbschnitt(p, ort) {
  const fps = (store.get().fotopunkte || []).filter((f) => f.parcelId === p.id);
  const titel = `Flurstück ${p.nr}, ${p.gemarkung}`;
  if (!fps.length) return null;
  return h('section', { class: 'foto-abschnitt' }, h('h3', {}, 'Fotopunkte'),
    h('ul', { class: 'fp-liste' }, fps.map((f) => h('li', {},
      h('div', {}, h('strong', {}, f.name || 'Fotopunkt'), h('small', { class: 'muted' }, `Blick ${f.blick}° (${compassLabel(f.blick)}) · ${fotoListe(`fp:${f.id}`).length} Aufnahmen`)),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => openNavigation({ titel: f.name || 'Fotopunkt', ziel: f.at, zielName: f.name || 'Fotopunkt', blick: f.blick, parcel: p }) }, 'Hinführen'),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => openFotos(`fp:${f.id}`, `${f.name || 'Fotopunkt'} · ${titel}`, { verlauf: true, hinweis: `Fotografiere immer von hier in Richtung ${f.blick}° (${compassLabel(f.blick)}), am besten jedes Jahr zur gleichen Jahreszeit.` }) }, fotoKnopfText(`fp:${f.id}`)),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => ort.zeige(f) }, 'Auf der Karte'),
        h('button', { type: 'button', class: 'link-btn', onclick: () => fotopunktAufKarteVerschieben(f, p, ort) }, 'Standort / Blickrichtung ändern'),
        h('button', { type: 'button', class: 'link-btn', onclick: () => fotopunktHierSetzen(f) }, 'Per GPS neu setzen'),
        h('button', { type: 'button', class: 'link-btn', onclick: async () => { if (await confirmDialog('Fotopunkt mit allen Aufnahmen löschen?', { ok: 'Löschen', danger: true })) { store.update((st) => { st.fotopunkte = st.fotopunkte.filter((x) => x.id !== f.id); }); fotosLoeschen(`fp:${f.id}`); } } }, 'löschen'))))));
}

/** Ein Tagebucheintrag als Zeile der Flurstückhistorie */
export function notizZeile(e, titel) {
  const d = fmtDate(e.datum);
  return h('li', { class: 'measure tb-eintrag' },
    h('div', { class: 'hm-kopf tb-kopf' }, h('span', { class: 'hm-datum' }, d), h('strong', {}, 'Tagebuch'), h('span', { class: 'badge' }, 'Notiz')),
    h('div', { class: 'hm-details' }, h('p', {}, e.text || '(ohne Text)'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => openFotos(`tb:${e.id}`, `Tagebuch ${d} · ${titel}`) }, fotoKnopfText(`tb:${e.id}`)),
        h('button', { type: 'button', class: 'link-btn', onclick: () => notizDialog(e.parcelId, e) }, 'bearbeiten'))));
}

export async function notizDialog(parcelId, alt = null) {
  const w = { text: alt?.text || '', datum: new Date(alt?.datum || Date.now()).toISOString().slice(0, 10) };
  const r = await dialog({
    title: alt ? 'Eintrag bearbeiten' : 'Neuer Tagebucheintrag',
    body: h('div', { class: 'form' },
      h('label', {}, 'Datum', h('input', { type: 'date', value: w.datum, onchange: (e) => { w.datum = e.target.value; } })),
      h('label', {}, 'Was hast du gesehen oder gemacht?', h('textarea', { rows: 4, placeholder: 'z. B. Rehwild-Verbiss an der Tanne, 3 Käferbäume am Südrand markiert', oninput: (e) => { w.text = e.target.value; } }, w.text)),
      h('p', { class: 'hint' }, 'Fotos fügst du nach dem Speichern am Eintrag hinzu.')),
    actions: [...(alt ? [{ label: 'Löschen', value: 'weg' }] : []), { label: 'Abbrechen', value: null }, { label: 'Speichern', value: 'ok', primary: true }],
  });
  if (r === 'weg') { store.update((s) => { s.tagebuch = (s.tagebuch || []).filter((x) => x.id !== alt.id); }); fotosLoeschen(`tb:${alt.id}`); return; }
  if (r !== 'ok') return;
  const datum = new Date(`${w.datum}T12:00`).getTime();
  store.update((s) => {
    s.tagebuch ||= [];
    if (alt) Object.assign(s.tagebuch.find((x) => x.id === alt.id) || {}, { text: w.text.trim(), datum });
    else s.tagebuch.push({ id: uid(), parcelId, datum, text: w.text.trim(), erfasst: Date.now() });
  });
}

/**
 * Fotopunkt anlegen: Standort und Blickrichtung direkt in der Karte der Flurstückhistorie setzen
 * (ort = { map, leiste }), danach Name vergeben.
 */
export async function fotopunktAnlegen(parcelId, p, ort) {
  const r = await fotopunktAufKarte(ort.map, ort.leiste, { titel: 'Neuer Fotopunkt' });
  if (!r) return;
  return fotopunktSpeichern(r, parcelId);
}

/**
 * Neuer Fotopunkt auf einer eigenen Seite mit Karte – mit oder ohne vorher gewähltes Flurstück.
 * Standort per Karte oder GPS; das Flurstück ergibt sich aus der Lage (eigene Fläche), sonst ohne Flurstück.
 */
export function fotopunktNeu({ parcelId = null } = {}) {
  return new Promise(async (fertig) => {
    const [{ createBaseMap }, { eigeneFlaechenLayer }, { standortSteuerung }, { createFotopunktLayer }, geo] = await Promise.all([
      import('./map/basemap.js'), import('./map/eigeneflaechen.js'), import('./map/standort.js'), import('./map/fotopunkte.js'), import('./geo.js')]);
    const s = store.get();
    const eigene = s.parcels.filter((x) => x.ring);
    const start = eigene.find((x) => x.id === parcelId) || null;
    const mapEl = h('div', { class: 'fp-neu-karte' });
    const leiste = h('div', { class: 'fp-neu-leiste' });
    let erledigt = false, std = null, map = null, fpLyr = null;
    const seite = openPage('Neuer Fotopunkt', h('div', { class: 'fp-neu' },
      h('p', { class: 'hint' }, 'Tippe in die Karte, wo du stehst, und zieh die Blickrichtung – oder nimm deinen GPS-Standort. Mit dem Knopf links oben zeigst du deinen Standort an.'),
      mapEl, leiste), { onClose: () => { std?.stop(); fpLyr?.entfernen?.(); try { map?.remove(); } catch { /* */ } if (!erledigt) { erledigt = true; fertig(null); } } });
    ({ map } = createBaseMap(mapEl, { center: start ? geo.centroid(start.ring) : eigene[0] ? geo.centroid(eigene[0].ring) : [50.9, 11.0], zoom: start || eigene.length ? 16 : 9, basemap: s.settings?.basemap, alkis: true }));
    eigeneFlaechenLayer(map);
    fpLyr = createFotopunktLayer(map); fpLyr.addTo(map);
    std = standortSteuerung(map, { schluessel: 'fotopunkt', start: 'an', zentrieren: !start });
    setTimeout(() => { map.invalidateSize(); if (start) map.fitBounds(L.polygon(geo.polysOf(start)).getBounds(), { padding: [20, 20], maxZoom: 18 }); }, 80);
    const r = await fotopunktAufKarte(map, leiste, { titel: 'Neuer Fotopunkt' });
    if (!r) { if (!erledigt) { erledigt = true; seite.close(); fertig(null); } return; }
    const imFlst = eigene.find((x) => geo.inPolys(r.at, geo.polysOf(x)));
    const id = await fotopunktSpeichern(r, imFlst?.id || null);
    erledigt = true; seite.close(); fertig(id || null);
  });
}

/** Name und Blickrichtung abfragen und den Fotopunkt speichern */
async function fotopunktSpeichern(r, parcelId) {
  const w = { name: '', blick: r.blick != null ? String(r.blick) : '' };
  const blickFeld = h('input', { type: 'number', min: 0, max: 359, inputmode: 'numeric', placeholder: 'z. B. 135', value: w.blick, oninput: (e) => { w.blick = e.target.value; } });
  const kompassKnopf = h('button', { type: 'button', class: 'btn btn-small', onclick: async () => {
    try {
      if (typeof DeviceOrientationEvent?.requestPermission === 'function' && (await DeviceOrientationEvent.requestPermission()) !== 'granted') throw new Error('Kompass nicht freigegeben');
      const werte = [];
      const lesen = (e) => { const hd = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null); if (hd != null) werte.push(hd); };
      window.addEventListener('deviceorientationabsolute', lesen); window.addEventListener('deviceorientation', lesen);
      await new Promise((ok) => setTimeout(ok, 1500));
      window.removeEventListener('deviceorientationabsolute', lesen); window.removeEventListener('deviceorientation', lesen);
      if (!werte.length) throw new Error('Kein Kompass verfügbar');
      const sx = werte.reduce((a, v) => a + Math.cos((v * Math.PI) / 180), 0), sy = werte.reduce((a, v) => a + Math.sin((v * Math.PI) / 180), 0);
      w.blick = String(Math.round(((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360)); blickFeld.value = w.blick;
    } catch (e) { toast(e.message); }
  } }, 'Vor Ort mit Kompass messen');
  const ok = await dialog({
    title: 'Fotopunkt anlegen',
    body: h('div', { class: 'form' },
      h('label', {}, 'Name', h('input', { placeholder: 'z. B. Blick über die Kultur', oninput: (e) => { w.name = e.target.value; } })),
      h('label', {}, 'Blickrichtung (Grad)', blickFeld), kompassKnopf,
      h('p', { class: 'hint' }, 'Von hier fotografierst du jedes Jahr in die gleiche Richtung – am besten zur gleichen Jahreszeit.')),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'Anlegen', value: true, primary: true }],
  });
  if (!ok) return;
  const id = uid();
  const blick = ((Math.round(Number(w.blick) || 0) % 360) + 360) % 360;
  store.update((s) => { s.fotopunkte ||= []; s.fotopunkte.push({ id, parcelId, at: r.at, genau: r.genau, perKarte: r.genau == null, blick, name: w.name.trim() || `Fotopunkt ${(s.fotopunkte.filter((x) => x.parcelId === parcelId).length) + 1}`, erfasst: Date.now() }); });
  toast('Fotopunkt angelegt');
  return id;
}

/** Fotopunkt auf den aktuellen GPS-Standort verschieben (z. B. wenn er falsch erfasst wurde) */
function fotopunktHierSetzen(f) {
  if (!navigator.geolocation) { toast('Kein GPS verfügbar'); return; }
  toast('Standort wird gemessen …');
  let best = null;
  const watch = navigator.geolocation.watchPosition((pp) => { if (!best || pp.coords.accuracy < best.acc) best = { at: [pp.coords.latitude, pp.coords.longitude], acc: Math.round(pp.coords.accuracy) }; }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  setTimeout(async () => {
    navigator.geolocation.clearWatch(watch);
    if (!best) { toast('Kein GPS-Standort erhalten.'); return; }
    if (!(await confirmDialog(`Fotopunkt „${f.name}“ hierher verschieben (± ${best.acc} m)?`, { ok: 'Verschieben' }))) return;
    store.update((s) => { const x = s.fotopunkte.find((y) => y.id === f.id); if (x) { x.at = best.at; x.genau = best.acc; } });
    toast('Fotopunkt verschoben');
  }, 8000);
}

/** Fotos eines Fotopunkts öffnen (auch von der Karte aus) */
export function fotopunktFotos(f) {
  openFotos(`fp:${f.id}`, f.name || 'Fotopunkt', { verlauf: true, ziel: { blick: f.blick ?? null, at: f.at || null, name: f.name || 'Fotopunkt' }, hinweis: `Fotografiere immer von hier in Richtung ${f.blick}° (${compassLabel(f.blick)}), am besten jedes Jahr zur gleichen Jahreszeit. „Foto mit Kompass“ zeigt dir, wie weit du dich drehen musst – grün heißt: richtig ausgerichtet.` });
}

/** Standort und Blickrichtung eines Fotopunkts in der Karte ändern (ort = { map, leiste, ohne(id) }) */
export async function fotopunktAufKarteVerschieben(f, p, ort) {
  ort.ohne?.(f.id);
  const r = await fotopunktAufKarte(ort.map, ort.leiste, { start: f.at, blick: f.blick, titel: `${f.name || 'Fotopunkt'} ändern` });
  ort.ohne?.(null);
  if (!r) return;
  const verschoben = r.at[0] !== f.at[0] || r.at[1] !== f.at[1];
  store.update((s) => { const x = s.fotopunkte.find((y) => y.id === f.id); if (x) { if (verschoben) { x.at = r.at; x.genau = r.genau; x.perKarte = r.genau == null; } if (r.blick != null) x.blick = r.blick; } });
  toast('Fotopunkt geändert');
}
