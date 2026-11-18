// Fotos zu Maßnahmen, Lagerplätzen, Rückegassen und Kartenpunkten – für den Vorher-Nachher-Vergleich.
// Die Bilder liegen verkleinert in IndexedDB (dateien.js), die Angaben dazu im Store unter store.fotos[schluessel].
import { h, fill, icon, openPage, dialog, confirmDialog, toast } from './ui.js';
import { store, uid } from './store.js';
import { dateiSpeichern, dateiLaden, dateiLoeschen } from './dateien.js';

export const PHASEN = [['vorher', 'Vorher'], ['nachher', 'Nachher']];
const MAX_KANTE = 1600, VORSCHAU_KANTE = 360;

export const fotoListe = (key) => store.get().fotos?.[key] || [];
export const fotoAnzahl = (key) => fotoListe(key).length;
/** Beschriftung für einen Knopf: „Fotos“ bzw. „Fotos · 3“ */
export const fotoKnopfText = (key) => { const n = fotoAnzahl(key); return n ? `Fotos · ${n}` : 'Fotos'; };

const datumText = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

async function verkleinern(datei, kante, qualitaet) {
  let bild;
  try { bild = await createImageBitmap(datei, { imageOrientation: 'from-image' }); } catch { bild = await createImageBitmap(datei); }
  const f = Math.min(1, kante / Math.max(bild.width, bild.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bild.width * f); c.height = Math.round(bild.height * f);
  c.getContext('2d').drawImage(bild, 0, 0, c.width, c.height);
  bild.close?.();
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', qualitaet));
  return { blob, w: c.width, h: c.height };
}

async function hinzufuegen(key, dateien, phase) {
  let n = 0;
  for (const d of dateien) {
    if (!d.type.startsWith('image/')) continue;
    try {
      const gross = await verkleinern(d, MAX_KANTE, 0.82);
      const klein = await verkleinern(gross.blob, VORSCHAU_KANTE, 0.75);
      const id = `foto-${uid()}`;
      await dateiSpeichern(id, gross.blob);
      await dateiSpeichern(`${id}-v`, klein.blob);
      const datum = d.lastModified && Date.now() - d.lastModified < 20 * 365 * 864e5 ? d.lastModified : Date.now();
      store.update((s) => { s.fotos ||= {}; (s.fotos[key] ||= []).push({ id, phase, datum, notiz: '', w: gross.w, h: gross.h, erfasst: Date.now() }); });
      n++;
    } catch { toast('Ein Bild konnte nicht gespeichert werden (Speicher voll oder Format nicht lesbar).'); }
  }
  if (n) toast(n === 1 ? 'Foto gespeichert' : `${n} Fotos gespeichert`);
}

/** Alle Fotos zu einem Eintrag entfernen (beim Löschen des Eintrags) */
export async function fotosLoeschen(key) {
  const liste = fotoListe(key);
  if (!liste.length) return;
  store.update((s) => { if (s.fotos) delete s.fotos[key]; });
  for (const f of liste) { await dateiLoeschen(f.id).catch(() => {}); await dateiLoeschen(`${f.id}-v`).catch(() => {}); }
}

const urlCache = new Map();
async function bildUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await dateiLaden(id).catch(() => null);
  const url = blob ? URL.createObjectURL(blob) : null;
  if (url) urlCache.set(id, url);
  return url;
}
function bildEl(id, alt, cls) {
  const img = h('img', { class: cls, alt, loading: 'lazy', decoding: 'async' });
  bildUrl(id).then((u) => { if (u) img.src = u; else img.replaceWith(h('div', { class: `${cls} foto-fehlt` }, 'Bild fehlt')); });
  return img;
}

// ---------- Vergleich (Schieberegler) ----------
function vergleich(vor, nach) {
  const wrap = h('div', { class: 'foto-vergleich', style: `aspect-ratio:${nach.w || 4} / ${nach.h || 3}` });
  const unten = bildEl(nach.id, `Nachher, ${datumText(nach.datum)}`, 'fv-bild');
  const oben = bildEl(vor.id, `Vorher, ${datumText(vor.datum)}`, 'fv-bild');
  const deckel = h('div', { class: 'fv-deckel' }, oben);
  const linie = h('div', { class: 'fv-linie' });
  const regler = h('input', { type: 'range', min: 0, max: 100, value: 50, class: 'fv-regler', 'aria-label': 'Vorher-Nachher-Regler', oninput: (e) => setze(e.target.value) });
  const setze = (v) => { deckel.style.clipPath = `inset(0 ${100 - v}% 0 0)`; linie.style.left = `${v}%`; };
  setze(50);
  fill(wrap, unten, deckel, linie, h('span', { class: 'fv-label fv-l' }, `Vorher · ${datumText(vor.datum)}`), h('span', { class: 'fv-label fv-r' }, `Nachher · ${datumText(nach.datum)}`), regler);
  return wrap;
}

// ---------- Einzelbild ----------
async function fotoAnsehen(key, f) {
  const w = { phase: f.phase, notiz: f.notiz || '', datum: new Date(f.datum).toISOString().slice(0, 10) };
  const r = await dialog({
    title: `Foto ${PHASEN.find(([k]) => k === f.phase)?.[1] || ''}`.trim(),
    body: h('div', { class: 'form' },
      h('div', { class: 'foto-gross' }, bildEl(f.id, 'Foto', 'foto-gross-bild')),
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Zuordnung' }, PHASEN.map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(w.phase === k),
        onclick: (e) => { w.phase = k; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget))); } }, l))),
      h('label', {}, 'Aufnahmedatum', h('input', { type: 'date', value: w.datum, onchange: (e) => { w.datum = e.target.value; } })),
      h('label', {}, 'Notiz', h('textarea', { rows: 2, placeholder: 'z. B. Blick von Süden, Polter 3', oninput: (e) => { w.notiz = e.target.value; } }, w.notiz))),
    actions: [{ label: 'Löschen', value: 'weg' }, ...(navigator.canShare ? [{ label: 'Teilen', value: 'teilen' }] : []), { label: 'Abbrechen', value: null }, { label: 'Speichern', value: 'ok', primary: true }],
  });
  if (r === 'weg') {
    if (!(await confirmDialog('Foto löschen?', { ok: 'Löschen', danger: true }))) return;
    store.update((s) => { s.fotos[key] = (s.fotos[key] || []).filter((x) => x.id !== f.id); if (!s.fotos[key].length) delete s.fotos[key]; });
    await dateiLoeschen(f.id).catch(() => {}); await dateiLoeschen(`${f.id}-v`).catch(() => {});
    toast('Foto gelöscht');
  } else if (r === 'teilen') {
    const blob = await dateiLaden(f.id).catch(() => null);
    const datei = blob && new File([blob], `waldwaechter-${f.phase}-${w.datum}.jpg`, { type: 'image/jpeg' });
    if (datei && navigator.canShare({ files: [datei] })) navigator.share({ files: [datei] }).catch(() => {});
    else toast('Teilen wird auf diesem Gerät nicht unterstützt.');
  } else if (r === 'ok') {
    store.update((s) => { const x = s.fotos[key]?.find((y) => y.id === f.id); if (x) Object.assign(x, { phase: w.phase, notiz: w.notiz.trim(), datum: w.datum ? new Date(`${w.datum}T12:00`).getTime() : x.datum }); });
  }
}

// ---------- Seite ----------
/**
 * Fotoseite für einen Eintrag.
 * @param {string} key    z. B. `m:<id>` (Maßnahme), `lager:<id>`, `gasse:<id>`, `habitat:<id>`, `jagd:<id>`
 * @param {string} titel  Überschrift, z. B. „Pflanzung, Flurstück 45/1“
 */
export function openFotos(key, titel) {
  const body = h('div', { class: 'fotos' });
  let wahl = { vorher: null, nachher: null };
  const zeichne = () => {
    const liste = [...fotoListe(key)].sort((a, b) => a.datum - b.datum);
    const vor = liste.filter((f) => f.phase === 'vorher'), nach = liste.filter((f) => f.phase === 'nachher');
    const vSel = vor.find((f) => f.id === wahl.vorher) || vor[vor.length - 1];
    const nSel = nach.find((f) => f.id === wahl.nachher) || nach[nach.length - 1];
    const auswahl = (arr, phase, sel) => (arr.length > 1 ? h('label', {}, phase === 'vorher' ? 'Vorher-Bild' : 'Nachher-Bild',
      h('select', { onchange: (e) => { wahl[phase] = e.target.value; zeichne(); } }, arr.map((f, i) => h('option', { value: f.id, selected: f === sel }, `${datumText(f.datum)}${f.notiz ? ` – ${f.notiz}` : ''} (${i + 1})`)))) : null);
    const abschnitt = (phase, label, arr) => h('section', { class: 'foto-abschnitt' },
      h('h3', {}, label, h('span', { class: 'muted' }, ` ${arr.length}`)),
      arr.length ? h('div', { class: 'foto-raster' }, arr.map((f) => h('button', { type: 'button', class: 'foto-kachel', onclick: () => fotoAnsehen(key, f), 'aria-label': `${label}-Foto vom ${datumText(f.datum)} öffnen` },
        bildEl(`${f.id}-v`, '', 'foto-vorschau'), h('span', { class: 'foto-datum' }, datumText(f.datum))))) : h('p', { class: 'muted' }, phase === 'vorher' ? 'Noch kein Vorher-Foto. Am besten vor Beginn der Arbeiten von einem festen Standpunkt aus fotografieren.' : 'Noch kein Nachher-Foto. Für einen guten Vergleich vom gleichen Standpunkt und in die gleiche Richtung fotografieren.'),
      h('div', { class: 'btn-row' },
        h('label', { class: 'btn btn-small' }, h('span', { html: icon.plus }), 'Foto aufnehmen',
          h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => { hinzufuegen(key, [...e.target.files], phase); e.target.value = ''; } })),
        h('label', { class: 'btn btn-small' }, 'Aus Galerie',
          h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => { hinzufuegen(key, [...e.target.files], phase); e.target.value = ''; } }))));
    fill(body,
      h('p', { class: 'muted' }, titel),
      vSel && nSel ? h('section', { class: 'foto-abschnitt' }, h('h3', {}, 'Vergleich'), vergleich(vSel, nSel),
        h('div', { class: 'form-row' }, auswahl(vor, 'vorher', vSel), auswahl(nach, 'nachher', nSel)),
        h('small', { class: 'muted' }, 'Regler nach links und rechts schieben.')) : null,
      abschnitt('vorher', 'Vorher', vor),
      abschnitt('nachher', 'Nachher', nach),
      h('p', { class: 'hint' }, 'Die Fotos werden verkleinert nur auf diesem Gerät gespeichert.'));
  };
  zeichne();
  const ab = store.subscribe(zeichne);
  openPage('Fotos', body, { onClose: ab });
}
