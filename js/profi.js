// Profimodus: Eigentümer je Flurstück (Excel-Import), Kontakte der Revierförster.
// Eigentümerdaten bleiben nur auf diesem Gerät (eigener Speicherplatz, nicht in der Datensicherung).
import { h, dialog, toast } from './ui.js';
import { store } from './store.js';
import { leseTabelle } from './xlsx.js';

export const istProfi = () => !!store.get().settings?.profi;

// ---------- Eigentümer ----------
const ET_KEY = 'waldwaechter.eigentuemer';
let et = null; // { key → eintrag }
const subs = new Set();
function laden() {
  if (et) return et;
  try { et = JSON.parse(localStorage.getItem(ET_KEY) || '{}') || {}; } catch { et = {}; }
  return et;
}
function sichern() {
  try { localStorage.setItem(ET_KEY, JSON.stringify(et)); } catch { toast('Speicher voll – Eigentümerdaten konnten nicht gespeichert werden.'); }
  subs.forEach((f) => f());
}
export const eigentuemerAbo = (f) => { subs.add(f); return () => subs.delete(f); };

const gemNorm = (t) => String(t || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '');
const flurNorm = (f) => String(Number(String(f || '').replace(/\D/g, '')) || String(f || '').trim());
const nrNorm = (n) => String(n || '').replace(/\s+/g, '').split('/').map((x) => String(Number(x)) === 'NaN' ? x : String(Number(x))).join('/');
export const flurstueckKey = (gemarkung, flur, nr) => `${gemNorm(gemarkung)}|${flurNorm(flur)}|${nrNorm(nr)}`;

export function eigentuemerVon(p) {
  if (!p) return null;
  return laden()[flurstueckKey(p.gemarkung, p.flur, p.nr)] || null;
}
export const eigentuemerAnzahl = () => Object.keys(laden()).length;
export function eigentuemerSpeichern(p, daten) {
  laden();
  const k = flurstueckKey(p.gemarkung, p.flur, p.nr);
  if (!daten || !Object.values(daten).some((v) => String(v || '').trim())) delete et[k];
  else et[k] = { ...daten, gemarkung: p.gemarkung, flur: p.flur, nr: p.nr, geaendert: Date.now() };
  sichern();
}
export function eigentuemerAlleLoeschen() { et = {}; sichern(); }

export const ET_FELDER = [
  ['vorname', 'Vorname'], ['nachname', 'Nachname'], ['strasse', 'Straße'], ['hausnummer', 'Hausnummer'],
  ['plz', 'PLZ'], ['ort', 'Ort'], ['telefon', 'Telefon'], ['email', 'E-Mail'],
];
const SPALTEN = ['gemarkung', 'flur', 'flurstueck', 'vorname', 'nachname', 'strasse', 'hausnummer', 'plz', 'ort', 'telefon', 'email'];
// Spaltenköpfe erkennen (Reihenfolge egal); ohne erkennbare Kopfzeile gilt die vorgegebene Reihenfolge
function spalteVon(kopf) {
  const k = gemNorm(kopf);
  if (!k) return null;
  if (k.startsWith('gemarkung') || k === 'gmk') return 'gemarkung';
  if (k === 'flur' || k === 'flurnr' || k === 'flurnummer') return 'flur';
  if (k.startsWith('flurstueck') || k.startsWith('flst') || k === 'flurstuecksnummer') return 'flurstueck';
  if (k.startsWith('vorname')) return 'vorname';
  if (k.startsWith('nachname') || k === 'name' || k === 'familienname') return 'nachname';
  if (k.startsWith('strasse') || k.startsWith('str')) return 'strasse';
  if (k.startsWith('hausnummer') || k === 'hnr' || k === 'hausnr' || k === 'nr') return 'hausnummer';
  if (k === 'plz' || k.startsWith('postleitzahl')) return 'plz';
  if (k === 'ort' || k === 'wohnort' || k === 'stadt') return 'ort';
  if (k.startsWith('telefon') || k === 'tel' || k.startsWith('mobil') || k.startsWith('handy')) return 'telefon';
  if (k.includes('mail')) return 'email';
  return null;
}

/** Tabelle einlesen und Eigentümer übernehmen. Liefert { neu, aktualisiert, fehler, gesamt, meine } */
export async function eigentuemerImport(datei) {
  const zeilen = await leseTabelle(datei);
  if (!zeilen.length) throw new Error('Die Tabelle ist leer.');
  const kopf = zeilen[0].map(spalteVon);
  const mitKopf = kopf.filter(Boolean).length >= 3;
  const zuordnung = mitKopf ? kopf : SPALTEN;
  const daten = mitKopf ? zeilen.slice(1) : zeilen;
  laden();
  let neu = 0, aktualisiert = 0, fehler = 0;
  const meineKeys = new Set(store.get().parcels.map((p) => flurstueckKey(p.gemarkung, p.flur, p.nr)));
  let meine = 0;
  for (const z of daten) {
    const r = {};
    zuordnung.forEach((sp, i) => { if (sp && z[i] != null && String(z[i]).trim()) r[sp] = String(z[i]).trim(); });
    if (!r.gemarkung || !r.flur || !r.flurstueck) { fehler++; continue; }
    const k = flurstueckKey(r.gemarkung, r.flur, r.flurstueck);
    const eintrag = { gemarkung: r.gemarkung, flur: r.flur, nr: r.flurstueck, geaendert: Date.now() };
    for (const [f] of ET_FELDER) if (r[f]) eintrag[f] = r[f];
    if (eintrag.plz && /^\d{4}$/.test(eintrag.plz)) eintrag.plz = `0${eintrag.plz}`; // Excel speichert PLZ als Zahl (07973 → 7973)
    if (et[k]) aktualisiert++; else neu++;
    if (meineKeys.has(k)) meine++;
    et[k] = eintrag;
  }
  sichern();
  return { neu, aktualisiert, fehler, gesamt: neu + aktualisiert, meine };
}

export const etName = (e) => [e?.vorname, e?.nachname].filter(Boolean).join(' ');
export const etAdresse = (e) => [[e?.strasse, e?.hausnummer].filter(Boolean).join(' '), [e?.plz, e?.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');

export async function eigentuemerBearbeiten(p) {
  const alt = eigentuemerVon(p) || {};
  const werte = { ...alt };
  const feld = ([k, l]) => h('label', {}, l, h('input', { value: werte[k] || '', type: k === 'email' ? 'email' : k === 'telefon' ? 'tel' : 'text', inputmode: k === 'plz' ? 'numeric' : undefined, oninput: (e) => { werte[k] = e.target.value.trim(); } }));
  const w = await dialog({
    title: `Eigentümer – Flurstück ${p.nr}`,
    body: h('div', { class: 'form' },
      h('p', { class: 'muted' }, `${p.gemarkung}, Flur ${p.flur}`),
      h('div', { class: 'form-row' }, feld(ET_FELDER[0]), feld(ET_FELDER[1])),
      h('div', { class: 'form-row' }, feld(ET_FELDER[2]), feld(ET_FELDER[3])),
      h('div', { class: 'form-row' }, feld(ET_FELDER[4]), feld(ET_FELDER[5])),
      feld(ET_FELDER[6]), feld(ET_FELDER[7]),
      h('p', { class: 'hint' }, 'Wird nur auf diesem Gerät gespeichert.')),
    actions: [...(eigentuemerVon(p) ? [{ label: 'Entfernen', value: 'weg' }] : []), { label: 'Abbrechen', value: null }, { label: 'Speichern', value: 'ok', primary: true }],
  });
  if (w === 'weg') { eigentuemerSpeichern(p, null); toast('Eigentümer entfernt'); return true; }
  if (w !== 'ok') return false;
  const daten = {}; for (const [k] of ET_FELDER) if (werte[k]) daten[k] = werte[k];
  eigentuemerSpeichern(p, daten);
  toast('Eigentümer gespeichert');
  return true;
}

/** Inhalt der Kachel „Eigentümer“ in der Infobox */
export function eigentuemerInhalt(p, neuZeichnen) {
  const e = eigentuemerVon(p);
  const tel = e?.telefon ? String(e.telefon).replace(/[^\d+]/g, '') : '';
  return h('div', { class: 'et-box' },
    e ? h('div', { class: 'kontakt-karte' },
      h('strong', {}, etName(e) || 'Name nicht angegeben'),
      etAdresse(e) ? h('span', {}, etAdresse(e)) : null,
      h('div', { class: 'kontakt-links' },
        tel ? h('a', { class: 'btn btn-small', href: `tel:${tel}` }, `☎ ${e.telefon}`) : null,
        e.email ? h('a', { class: 'btn btn-small', href: `mailto:${e.email}` }, `✉ ${e.email}`) : null))
      : h('p', { class: 'muted' }, 'Kein Eigentümer hinterlegt. Trag ihn ein oder importiere eine Excel-Liste im Profil.'),
    h('button', { class: 'btn btn-small', onclick: async () => { if (await eigentuemerBearbeiten(p)) neuZeichnen?.(); } }, e ? 'Bearbeiten' : 'Eigentümer eintragen'));
}

// ---------- Revierförster ----------
export const revierKey = (z) => `${z?.Forstamt || ''}|${z?.Revier || ''}`;
export const revierKontakt = (z) => store.get().kontakte?.reviere?.[revierKey(z)] || null;
export async function revierKontaktBearbeiten(z) {
  const alt = revierKontakt(z) || {};
  const w = { name: alt.name || '', tel: alt.tel || '', mail: alt.mail || '' };
  const f = (k, l, typ) => h('label', {}, l, h('input', { type: typ, value: w[k], oninput: (e) => { w[k] = e.target.value.trim(); } }));
  const ok = await dialog({
    title: `Revierförster ${z?.Revier ? `– Revier ${z.Revier}` : ''}`,
    body: h('div', { class: 'form' },
      h('p', { class: 'muted' }, `Gilt für alle Flurstücke im Revier ${z?.Revier || '–'} (Forstamt ${z?.Forstamt || '–'}).`),
      f('name', 'Name', 'text'), f('tel', 'Telefon', 'tel'), f('mail', 'E-Mail', 'email')),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'Speichern', value: true, primary: true }],
  });
  if (!ok) return false;
  store.update((s) => { s.kontakte = s.kontakte || { reviere: {} }; s.kontakte.reviere = s.kontakte.reviere || {}; s.kontakte.reviere[revierKey(z)] = w; });
  return true;
}

/** Telefon- und Mail-Knöpfe */
export function kontaktLinks({ tel, mail }) {
  const t = tel ? String(tel).replace(/[^\d+]/g, '') : '';
  if (!t && !mail) return null;
  return h('div', { class: 'kontakt-links' },
    t ? h('a', { class: 'btn btn-small', href: `tel:${t}` }, `☎ ${tel}`) : null,
    mail ? h('a', { class: 'btn btn-small', href: `mailto:${mail}` }, `✉ ${mail}`) : null);
}
