// Profimodus: Eigentümer je Flurstück (Excel-Import), Kontakte der Revierförster.
// Eigentümerdaten bleiben nur auf diesem Gerät (eigener Speicherplatz, nicht in der Datensicherung).
import { h, fill, dialog, confirmDialog, toast, openPage } from './ui.js';
import { store, uid } from './store.js';
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

// ---------- Revierleiter laut ThüringenForst (data/revierleiter.json) ----------
let RL = null;
export function ladeRevierleiter() {
  RL ??= fetch('./data/revierleiter.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return RL;
}
const rlNorm = (t) => String(t || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/forstamt|forstrevier|revier|rev\./g, '').replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '');
/** Revierleiter und Forstamt zum Ergebnis des Dienstes „Hoheitsstruktur“; null, wenn nicht hinterlegt */
export function revierleiterVon(daten, z) {
  if (!daten?.forstaemter || !z) return null;
  const fa = rlNorm(z.Forstamt), rv = rlNorm(z.Revier);
  const aemter = Object.entries(daten.forstaemter);
  const amt = aemter.find(([k]) => fa && (rlNorm(k) === fa || fa.includes(rlNorm(k)) || rlNorm(k).includes(fa)));
  const suche = amt ? [amt] : aemter;
  for (const [name, a] of suche) {
    const r = rv ? a.reviere.find((x) => rlNorm(x.revier) === rv || rv.includes(rlNorm(x.revier))) : null;
    if (r || amt) return { forstamt: name, amt: a, revier: r || null, stand: daten.stand };
  }
  return null;
}

// ---------- Ordner je Eigentümer (Profimodus) ----------
// Flurstücke lassen sich Ordnern zuordnen; Maßnahmen und Buchungen gehören zum Ordner ihres Flurstücks
// (ohne Flurstück: zum Ordner, der beim Anlegen gewählt war). „Eigene Flächen“ = ohne Ordner.
export const ordnerListe = () => store.get().ordner || [];
export const ordnerName = (id) => (id ? ordnerListe().find((o) => o.id === id)?.name || 'Ordner' : 'Eigene Flächen');
export const aktiverOrdner = () => (istProfi() ? store.get().settings.ordnerAktiv || 'eigen' : 'alle');
const parcelOrdner = (pid) => (pid ? store.get().parcels.find((p) => p.id === pid)?.ordnerId || null : undefined);
export function ordnerVon(x) {
  if (!x) return null;
  const vomFlurstueck = parcelOrdner(x.parcelId);
  return vomFlurstueck !== undefined ? vomFlurstueck : x.ordnerId || null;
}
/** passt ein Ordner (null = eigene Flächen) zur aktuellen Auswahl? */
export function passtOrdner(ordnerId) {
  const a = aktiverOrdner();
  if (a === 'alle') return true;
  if (a === 'eigen') return !ordnerId;
  return ordnerId === a;
}
export const passtFlurstueck = (p) => passtOrdner(p?.ordnerId || null);
export const passtEintrag = (x) => passtOrdner(ordnerVon(x));
/** Ordner für einen neuen Eintrag ohne Flurstück */
export const ordnerFuerNeu = () => { const a = aktiverOrdner(); return a === 'eigen' || a === 'alle' ? null : a; };

// Neue Maßnahmen und Buchungen ohne Flurstück bekommen den gerade gewählten Ordner
let ordnerAbo = false;
export function ordnerBeobachten() {
  if (ordnerAbo) return; ordnerAbo = true;
  const pruefe = () => {
    const s = store.get();
    const fehlt = (x) => !x.parcelId && !('ordnerId' in x);
    if (!(s.measures || []).some(fehlt) && !(s.finanzen?.buchungen || []).some(fehlt)) return;
    const o = ordnerFuerNeu();
    store.update((st) => {
      for (const m of st.measures || []) if (fehlt(m)) m.ordnerId = o;
      for (const b of st.finanzen?.buchungen || []) if (fehlt(b)) b.ordnerId = o;
    });
  };
  store.subscribe(pruefe);
  pruefe();
}

export function ordnerWaehlen(id) {
  store.update((s) => { s.settings.ordnerAktiv = id; });
}

/** Leiste im Kopf: welcher Ordner ist zu sehen? */
export function ordnerLeiste() {
  if (!istProfi()) return null;
  const a = aktiverOrdner();
  const liste = ordnerListe();
  return h('div', { class: 'ordner-leiste' },
    h('span', { class: 'ordner-symbol', 'aria-hidden': 'true' }, '📁'),
    h('select', { 'aria-label': 'Ordner', onchange: (e) => { if (e.target.value === '__neu') { e.target.value = a; ordnerAnlegen(); return; } if (e.target.value === '__verwalten') { e.target.value = a; openOrdnerVerwaltung(); return; } ordnerWaehlen(e.target.value); } },
      h('option', { value: 'eigen', selected: a === 'eigen' }, 'Eigene Flächen'),
      liste.slice().sort((x, y) => x.name.localeCompare(y.name, 'de')).map((o) => h('option', { value: o.id, selected: a === o.id }, o.name)),
      h('option', { value: 'alle', selected: a === 'alle' }, 'Alle Ordner'),
      h('option', { value: '__neu' }, '+ Neuer Ordner …'),
      h('option', { value: '__verwalten' }, 'Ordner verwalten …')));
}

export async function ordnerAnlegen(vorgabe = '') {
  let name = vorgabe;
  const ok = await dialog({
    title: 'Neuer Ordner',
    body: h('div', { class: 'form' }, h('label', {}, 'Name (z. B. Eigentümer)', h('input', { value: name, oninput: (e) => { name = e.target.value; } })),
      h('p', { class: 'hint' }, 'Flurstücke ordnest du in der Flurstücks-Info dem Ordner zu. Maßnahmen und Finanzen werden dann je Ordner getrennt angezeigt.')),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'Anlegen', value: true, primary: true }],
  });
  if (!ok || !name.trim()) return null;
  const o = { id: uid(), name: name.trim(), erstellt: Date.now() };
  store.update((s) => { s.ordner = s.ordner || []; s.ordner.push(o); s.settings.ordnerAktiv = o.id; });
  toast(`Ordner „${o.name}“ angelegt`);
  return o;
}

/** Ordner aus der Eigentümerliste: je Eigentümer (Name + Anschrift) ein Ordner; eigene Flurstücke mit passendem Eigentümer werden zugeordnet */
export function ordnerAusEigentuemern() {
  const s = store.get();
  const ordner = [...(s.ordner || [])];
  const nachName = new Map(ordner.map((o) => [o.name.toLowerCase(), o]));
  let neu = 0, zugeordnet = 0;
  const zuordnung = {};
  for (const p of s.parcels) {
    const e = eigentuemerVon(p);
    const name = etName(e);
    if (!name) continue;
    let o = nachName.get(name.toLowerCase());
    if (!o) { o = { id: uid(), name, erstellt: Date.now() }; ordner.push(o); nachName.set(name.toLowerCase(), o); neu++; }
    if (p.ordnerId !== o.id) { zuordnung[p.id] = o.id; zugeordnet++; }
  }
  store.update((st) => { st.ordner = ordner; for (const p of st.parcels) if (zuordnung[p.id]) p.ordnerId = zuordnung[p.id]; });
  return { neu, zugeordnet };
}

/** Flurstück einem Ordner zuordnen (null = eigene Flächen) */
export function flurstueckZuordnen(pid, ordnerId) {
  store.update((s) => { const p = s.parcels.find((x) => x.id === pid); if (p) p.ordnerId = ordnerId || null; });
}

/** Auswahl in der Flurstücks-Info */
export function ordnerAuswahl(p, { beiAenderung } = {}) {
  const liste = ordnerListe();
  const e = eigentuemerVon(p);
  const vorschlag = e && etName(e) && !liste.some((o) => o.name.toLowerCase() === etName(e).toLowerCase()) ? etName(e) : null;
  return h('div', { class: 'info-block' }, h('h3', {}, 'Ordner'),
    h('select', { 'aria-label': 'Ordner des Flurstücks', onchange: async (ev) => {
      let v = ev.target.value;
      if (v === '__neu') { const o = await ordnerAnlegen(vorschlag || ''); if (!o) { ev.target.value = p.ordnerId || ''; return; } v = o.id; }
      flurstueckZuordnen(p.id, v || null); toast(`Flurstück ${p.nr}: ${ordnerName(v || null)}`); beiAenderung?.();
    } },
      h('option', { value: '', selected: !p.ordnerId }, 'Eigene Flächen'),
      liste.map((o) => h('option', { value: o.id, selected: p.ordnerId === o.id }, o.name)),
      h('option', { value: '__neu' }, vorschlag ? `+ Neuer Ordner „${vorschlag}“` : '+ Neuer Ordner …')),
    h('p', { class: 'hint' }, 'Maßnahmen und Finanzen dieses Flurstücks erscheinen im gewählten Ordner.'));
}

export function openOrdnerVerwaltung() {
  const inhalt = h('div', { class: 'ordner-seite' });
  const zeichne = () => {
    const s = store.get();
    const liste = (s.ordner || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const zahl = (id) => ({
      fl: s.parcels.filter((p) => (p.ordnerId || null) === id).length,
      m: (s.measures || []).filter((m) => ordnerVon(m) === id).length,
      b: (s.finanzen?.buchungen || []).filter((b) => ordnerVon(b) === id).length,
    });
    const zeile = (id, name) => { const z = zahl(id); return h('li', { class: 'fin-zeile' },
      h('div', { class: 'fin-zeile-text' }, h('strong', {}, name), h('small', { class: 'muted' }, `${z.fl} Flurstücke · ${z.m} Maßnahmen · ${z.b} Buchungen`)),
      h('button', { class: 'btn btn-small', onclick: () => { ordnerWaehlen(id || 'eigen'); seite.close(); } }, 'Öffnen'),
      id ? h('button', { class: 'btn btn-small', onclick: async () => { let n = name; const ok = await dialog({ title: 'Ordner umbenennen', body: h('div', { class: 'form' }, h('label', {}, 'Name', h('input', { value: n, oninput: (e) => { n = e.target.value; } }))), actions: [{ label: 'Abbrechen', value: false }, { label: 'Speichern', value: true, primary: true }] }); if (ok && n.trim()) store.update((st) => { st.ordner.find((o) => o.id === id).name = n.trim(); }); } }, 'Umbenennen') : null,
      id ? h('button', { class: 'btn btn-small btn-danger-ghost', onclick: async () => {
        if (!(await confirmDialog(`Ordner „${name}“ auflösen?`, { ok: 'Auflösen', danger: true, body: 'Flurstücke, Maßnahmen und Buchungen bleiben erhalten und kommen zu „Eigene Flächen“.' }))) return;
        store.update((st) => { st.ordner = st.ordner.filter((o) => o.id !== id); for (const p of st.parcels) if (p.ordnerId === id) p.ordnerId = null; for (const m of st.measures || []) if (m.ordnerId === id) m.ordnerId = null; for (const b of st.finanzen?.buchungen || []) if (b.ordnerId === id) b.ordnerId = null; if (st.settings.ordnerAktiv === id) st.settings.ordnerAktiv = 'eigen'; });
      } }, 'Auflösen') : null); };
    fill(inhalt,
      h('p', { class: 'muted' }, 'Je Eigentümer ein Ordner: Flurstücke, Maßnahmen und Finanzen werden getrennt geführt. Oben in jeder Ansicht wählst du, welcher Ordner zu sehen ist.'),
      h('ul', { class: 'fin-liste' }, zeile(null, 'Eigene Flächen'), liste.map((o) => zeile(o.id, o.name))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', onclick: () => ordnerAnlegen() }, '+ Neuer Ordner'),
        eigentuemerAnzahl() ? h('button', { class: 'btn', onclick: () => { const r = ordnerAusEigentuemern(); toast(`${r.neu} Ordner angelegt, ${r.zugeordnet} Flurstücke zugeordnet`); } }, 'Ordner aus Eigentümerliste') : null),
      eigentuemerAnzahl() ? h('p', { class: 'hint' }, '„Ordner aus Eigentümerliste“ legt für jeden importierten Eigentümer deiner Flurstücke einen Ordner an und ordnet die Flurstücke zu.') : null);
  };
  zeichne();
  const ab = store.subscribe(zeichne);
  const seite = openPage('Ordner verwalten', inhalt, { onClose: ab });
  return seite;
}
