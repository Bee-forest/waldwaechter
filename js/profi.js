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
  nachNr = null;
  try { localStorage.setItem(ET_KEY, JSON.stringify(et)); } catch { toast('Speicher voll – Eigentümerdaten konnten nicht gespeichert werden.'); }
  subs.forEach((f) => f());
}
export const eigentuemerAbo = (f) => { subs.add(f); return () => subs.delete(f); };

// Hochgeladene Tabellen (je Forstbetrieb / FBG eine): { id, name, datei, datum, anzahl, gefunden, nichtGefunden }
const DATEI_KEY = 'waldwaechter.eigentuemer.dateien';
export function etDateien() {
  let l; try { l = JSON.parse(localStorage.getItem(DATEI_KEY) || '[]'); } catch { l = []; }
  // Einträge aus früheren Importen (vor der Tabellenübersicht) als eigene Tabelle zeigen
  const ids = new Set(l.map((d) => d.id));
  const alt = Object.values(laden()).filter((e) => !e.datei || !ids.has(e.datei));
  if (alt.length) l = [...l, { id: '__alt', name: 'Frühere Importe', datei: 'vor der Tabellenübersicht hochgeladen', datum: Math.min(...alt.map((e) => e.geaendert || Date.now())), anzahl: alt.length, gefunden: null, nichtGefunden: null }];
  return l;
}
function dateienSichern(l) { try { localStorage.setItem(DATEI_KEY, JSON.stringify(l)); } catch { /* voll */ } bekannteIds = null; subs.forEach((f) => f()); }
export function etDateiAktualisieren(id, werte) { if (id === '__alt') return; dateienSichern(etDateien().filter((d) => d.id !== '__alt').map((d) => (d.id === id ? { ...d, ...werte } : d))); }
/** Tabelle mit allen ihren Eigentümereinträgen entfernen */
export function etDateiEntfernen(id) {
  laden();
  for (const [k, e] of Object.entries(et)) if (gehoertZu(e, id)) delete et[k];
  sichern();
  dateienSichern(etDateien().filter((d) => d.id !== id && d.id !== '__alt'));
}
/** Was beim Entfernen von Tabellen (null = alle) mit wegfällt: Ordner der Waldbesitzer, die nur in
 *  diesen Tabellen stehen, deren Flurstücke sowie Maßnahmen und Buchungen in diesen Ordnern */
export function tabellenFolgen(dateiIds = null) {
  const betroffen = (e) => !dateiIds || dateiIds.some((id) => gehoertZu(e, id));
  const namen = new Set(), andere = new Set();
  for (const e of Object.values(laden())) { const n = etName(e).toLowerCase(); if (n) (betroffen(e) ? namen : andere).add(n); }
  const sammel = new Set(etDateien().filter((d) => !dateiIds || dateiIds.includes(d.id)).map((d) => `ohne waldbesitzer (${d.name})`.toLowerCase()));
  const ordner = ordnerListe().filter((o) => { const n = o.name.toLowerCase(); return (namen.has(n) && !andere.has(n)) || sammel.has(n) || (!dateiIds && n.startsWith('ohne waldbesitzer')); });
  const ids = new Set(ordner.map((o) => o.id));
  const s = store.get();
  const flaechen = s.parcels.filter((p) => ids.has(p.ordnerId));
  const massnahmen = (s.measures || []).filter((m) => ids.has(ordnerVon(m)));
  const buchungen = (s.finanzen?.buchungen || []).filter((b) => ids.has(ordnerVon(b)));
  return { ordner, flaechen, massnahmen, buchungen };
}
/** Ordner (mit Flurstücken, Maßnahmen und Buchungen) aus tabellenFolgen() löschen */
export function ordnerMitInhaltLoeschen(f) {
  const ids = new Set(f.ordner.map((o) => o.id)), fl = new Set(f.flaechen.map((p) => p.id)), ms = new Set(f.massnahmen.map((m) => m.id)), bs = new Set(f.buchungen.map((b) => b.id));
  store.update((st) => {
    st.ordner = (st.ordner || []).filter((o) => !ids.has(o.id));
    st.parcels = st.parcels.filter((p) => !fl.has(p.id));
    st.measures = (st.measures || []).filter((m) => !ms.has(m.id));
    if (st.finanzen?.buchungen) st.finanzen.buchungen = st.finanzen.buchungen.filter((b) => !bs.has(b.id));
    if (ids.has(st.settings.ordnerAktiv)) st.settings.ordnerAktiv = 'eigen';
  });
}
let bekannteIds = null;
const ids = () => (bekannteIds ||= new Set((() => { try { return JSON.parse(localStorage.getItem(DATEI_KEY) || '[]'); } catch { return []; } })().map((d) => d.id)));
const gehoertZu = (e, id) => (id === '__alt' ? !e.datei || !ids().has(e.datei) : e.datei === id);
export const etDateiAnzahl = (id) => { const l = Object.values(laden()); return id === '__alt' ? l.filter((e) => gehoertZu(e, id)).length : l.filter((e) => e.datei === id).length; };

const gemNorm = (t) => String(t || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '');
const flurNorm = (f) => String(Number(String(f || '').replace(/\D/g, '')) || String(f || '').trim());
const nrNorm = (n) => String(n || '').replace(/\s+/g, '').split('/').map((x) => String(Number(x)) === 'NaN' ? x : String(Number(x))).join('/');
export const flurstueckKey = (gemarkung, flur, nr) => `${gemNorm(gemarkung)}|${flurNorm(flur)}|${nrNorm(nr)}`;

// Ersatzsuche, wenn die Schreibweise in der Tabelle von der amtlichen abweicht
// (z. B. „Langenberg“ statt „Gera-Langenberg“, Flur 3 statt der amtlichen „0“): gleiche Nummer,
// passende Flur und eine Gemarkung, deren Name im anderen enthalten ist
let nachNr = null;
// amtliche Gemarkungsnamen: Steht in der Tabelle eine andere amtliche Gemarkung (z. B. „Greiz“ statt „Greiz-Pohlitz“), ist es nicht dasselbe Flurstück
let amtlicheGem = null;
export const gemarkungenLaden = () => (amtlicheGem ? Promise.resolve() : fetch('data/alkis/index.json').then((r) => r.json()).then((j) => { amtlicheGem = new Set(Object.keys(j.gemarkungen || {}).map(gemNorm)); nachNr = null; }).catch(() => {}));
gemarkungenLaden();
function ersatzEintrag(p) {
  if (!nachNr) { nachNr = new Map(); for (const e of Object.values(laden())) { const n = nrNorm(e.nr); if (!nachNr.has(n)) nachNr.set(n, []); nachNr.get(n).push(e); } }
  const g = gemNorm(p.gemarkung), f = flurNorm(p.flur);
  const gemPasst = (x) => { const y = gemNorm(String(x || '').replace(/\(.*?\)/g, '').replace(/\d{4,6}/g, '')); if (y === g) return true; if (!amtlicheGem || amtlicheGem.has(y)) return false; return y.length >= 3 && (g.includes(y) || y.includes(g)); };
  const treffer = (nachNr.get(nrNorm(p.nr)) || []).filter((e) => {
    const ef = flurNorm(e.flur);
    return (ef === f || ef === '0' || f === '0' || !e.flur) && (gemPasst(e.gemarkung) || (p.source === 'alkis' && /^\d{4,6}$/.test(String(e.gemarkung || '').replace(/\D/g, '')) && String(e.gemarkung).replace(/\D/g, '').slice(-4) === String(p.id).slice(2, 6)));
  });
  return treffer.length === 1 ? treffer[0] : null; // bei mehreren möglichen Treffern lieber nichts raten
}
export function eigentuemerVon(p) {
  if (!p) return null;
  return laden()[flurstueckKey(p.gemarkung, p.flur, p.nr)] || ersatzEintrag(p);
}
export const eigentuemerAnzahl = () => Object.keys(laden()).length;
export function eigentuemerSpeichern(p, daten) {
  laden();
  const k = flurstueckKey(p.gemarkung, p.flur, p.nr);
  if (!daten || !Object.values(daten).some((v) => String(v || '').trim())) delete et[k];
  else et[k] = { ...daten, gemarkung: p.gemarkung, flur: p.flur, nr: p.nr, geaendert: Date.now() };
  sichern();
}
export function eigentuemerAlleLoeschen() { et = {}; sichern(); dateienSichern([]); }

export const ET_FELDER = [
  ['vorname', 'Vorname'], ['nachname', 'Nachname bzw. Name'], ['strasse', 'Straße'], ['hausnummer', 'Hausnummer'],
  ['plz', 'PLZ'], ['ort', 'Ort'], ['telefon', 'Telefon'], ['email', 'E-Mail'],
];
const SPALTEN_ALT = ['gemarkung', 'flur', 'flurstueck', 'vorname', 'nachname', 'strasse', 'hausnummer', 'plz', 'ort', 'telefon', 'email'];
// Formular für Waldbesitzer: Name in einer Spalte, Adresse und Kontakt dürfen leer bleiben
export const VORLAGE_KOPF = ['Gemarkung', 'Flur', 'Flurstück', 'Waldbesitzer', 'Straße', 'Hausnummer', 'PLZ', 'Ort', 'Telefon', 'E-Mail'];
const SPALTEN = ['gemarkung', 'flur', 'flurstueck', 'waldbesitzer', 'strasse', 'hausnummer', 'plz', 'ort', 'telefon', 'email'];
// Spaltenköpfe erkennen (Reihenfolge egal); ohne erkennbare Kopfzeile gilt die vorgegebene Reihenfolge
function spalteVon(kopf) {
  const k = gemNorm(kopf);
  if (!k) return null;
  if (k.startsWith('gemarkung') || k === 'gmk') return 'gemarkung';
  if (k === 'flur' || k === 'flurnr' || k === 'flurnummer') return 'flur';
  if (k.startsWith('flurstueck') || k.startsWith('flst') || k === 'flurstuecksnummer') return 'flurstueck';
  if (k.startsWith('vorname')) return 'vorname';
  if (k.startsWith('nachname') || k === 'familienname') return 'nachname';
  if (k.includes('besitzer') || k.includes('eigentuemer') || k.includes('eigentumer') || k.includes('inhaber') || k === 'name' || k.startsWith('namevorname') || k.startsWith('nameanschrift') || k === 'vollername') return 'waldbesitzer';
  if (k.startsWith('strasse') || k.startsWith('str')) return 'strasse';
  if (k.startsWith('hausnummer') || k === 'hnr' || k === 'hausnr' || k === 'nr') return 'hausnummer';
  if (k === 'plz' || k.startsWith('postleitzahl')) return 'plz';
  if (k === 'ort' || k === 'wohnort' || k === 'stadt') return 'ort';
  if (k.startsWith('telefon') || k === 'tel' || k.startsWith('mobil') || k.startsWith('handy')) return 'telefon';
  if (k.includes('mail')) return 'email';
  return null;
}

/** Tabelle einlesen und Eigentümer übernehmen. Liefert { neu, aktualisiert, fehler, gesamt, meine } */
export async function eigentuemerImport(datei, { name = '' } = {}) {
  const zeilen = await leseTabelle(datei);
  if (!zeilen.length) throw new Error('Die Tabelle ist leer.');
  const kopf = zeilen[0].map(spalteVon);
  // Kopfzeile ohne erkannte Namensspalte: erste unbekannte Textspalte gilt als Waldbesitzer
  if (kopf.some(Boolean) && !kopf.some((k) => ['waldbesitzer', 'vorname', 'nachname'].includes(k))) {
    const i = kopf.findIndex((k, j) => !k && zeilen.slice(1, 20).some((z) => /[a-zäöüß]{2,}/i.test(String(z[j] ?? ''))));
    if (i >= 0) kopf[i] = 'waldbesitzer';
  }
  const mitKopf = kopf.filter(Boolean).length >= 3;
  const zuordnung = mitKopf ? kopf : (zeilen[0].length >= 11 ? SPALTEN_ALT : SPALTEN);
  const daten = mitKopf ? zeilen.slice(1) : zeilen;
  laden();
  let neu = 0, aktualisiert = 0, fehler = 0;
  // gleiche Datei (Name) erneut hochgeladen → ersetzt deren Einträge
  const alt = etDateien().find((d) => d.datei === datei.name);
  const dateiId = alt?.id || uid();
  if (alt) for (const [k, e] of Object.entries(et)) if (e.datei === dateiId) delete et[k];
  const meineKeys = new Set(store.get().parcels.map((p) => flurstueckKey(p.gemarkung, p.flur, p.nr)));
  let meine = 0;
  for (const z of daten) {
    const r = {};
    zuordnung.forEach((sp, i) => { if (sp && z[i] != null && String(z[i]).trim()) r[sp] = String(z[i]).trim(); });
    if (!r.gemarkung || !r.flurstueck) { fehler++; continue; }
    r.flur ||= ''; // Flur fehlt: die App sucht das Flurstück in allen Fluren der Gemarkung
    const k = flurstueckKey(r.gemarkung, r.flur, r.flurstueck);
    const eintrag = { gemarkung: r.gemarkung, flur: r.flur, nr: r.flurstueck, geaendert: Date.now(), datei: dateiId };
    for (const [f] of ET_FELDER) if (r[f]) eintrag[f] = r[f];
    // Waldbesitzer in einer Spalte: „Nachname, Vorname“ wird geteilt, sonst bleibt der Name so stehen (z. B. „Forst GbR Müller“)
    if (r.waldbesitzer && !eintrag.vorname && !eintrag.nachname) {
      const [a, b] = r.waldbesitzer.split(/\s*,\s*/);
      if (b) { eintrag.nachname = a; eintrag.vorname = b; } else eintrag.nachname = r.waldbesitzer;
    }
    if (eintrag.plz && /^\d{4}$/.test(eintrag.plz)) eintrag.plz = `0${eintrag.plz}`; // Excel speichert PLZ als Zahl (07973 → 7973)
    if (et[k]) aktualisiert++; else neu++;
    if (meineKeys.has(k)) meine++;
    et[k] = eintrag;
  }
  sichern();
  const anzahl = Object.values(et).filter((e) => e.datei === dateiId).length;
  const liste = etDateien().filter((d) => d.id !== dateiId && d.id !== '__alt');
  dateienSichern([...liste, { id: dateiId, name: name || alt?.name || datei.name.replace(/\.(xlsx|csv)$/i, ''), datei: datei.name, datum: Date.now(), anzahl, gefunden: null, nichtGefunden: null }]);
  return { neu, aktualisiert, fehler, gesamt: neu + aktualisiert, meine, dateiId, ersetzt: !!alt };
}

export const etName = (e) => [e?.vorname, e?.nachname].filter(Boolean).join(' ');

/** Alle Eigentümer als Excel-Liste (gleiches Format wie das Formular, inkl. Änderungen aus der App) */
export async function eigentuemerExcel({ leer = false, dateiId = null } = {}) {
  const { schreibeXlsx } = await import('./xlsx.js');
  const zeilen = leer ? [] : Object.values(laden()).filter((e) => !dateiId || gehoertZu(e, dateiId))
    .sort((a, b) => String(a.gemarkung).localeCompare(String(b.gemarkung), 'de') || (Number(a.flur) || 0) - (Number(b.flur) || 0) || String(a.nr).localeCompare(String(b.nr), 'de', { numeric: true }))
    .map((e) => [e.gemarkung, e.flur, e.nr, e.vorname && e.nachname ? `${e.nachname}, ${e.vorname}` : etName(e), e.strasse, e.hausnummer, e.plz, e.ort, e.telefon, e.email].map((v) => v ?? ''));
  return schreibeXlsx([VORLAGE_KOPF, ...zeilen], { blatt: 'Waldbesitzer', breiten: [18, 7, 11, 28, 22, 11, 8, 18, 16, 28] });
}

/** Flurstücke aus der Eigentümerliste zu den Flächen holen und je Waldbesitzer in einen Ordner legen */
export async function flaechenAusEigentuemern({ onFortschritt, dateiId = null } = {}) {
  await gemarkungenLaden();
  const { source } = await import('./data/source.js');
  const { findeFlurstueck } = await import('./map/thueringen.js');
  const schonDa = new Map(store.get().parcels.map((p) => [flurstueckKey(p.gemarkung, p.flur, p.nr), p]));
  const liste = Object.values(laden()).filter((e) => !dateiId || gehoertZu(e, dateiId));
  let hinzu = 0, vorhanden = 0;
  const nicht = []; // { text, grund }
  for (let i = 0; i < liste.length; i++) {
    const e = liste[i];
    onFortschritt?.(i + 1, liste.length);
    const text = `${e.gemarkung}, Flur ${e.flur}, ${e.nr}`;
    if (schonDa.has(flurstueckKey(e.gemarkung, e.flur, e.nr))) { vorhanden++; continue; }
    if (/^\d{5}$/.test(String(e.nr)) && Number(e.nr) > 20000 && !String(e.nr).includes('/')) { nicht.push({ text, grund: 'Flurstücksnummer ist in Excel zum Datum geworden – Spalte als Text formatieren' }); continue; }
    let r = await findeFlurstueck({ gemarkung: e.gemarkung, flur: e.flur, nr: e.nr }).catch(() => ({ grund: 'fehler' }));
    if (!r.p && r.grund !== 'flurstueck') {
      // nicht in den mitgelieferten Daten: über den ALKIS-Dienst suchen
      try {
        const t = await source.search({ gemarkung: e.gemarkung, flur: e.flur, nr: e.nr });
        const p = t.find((x) => flurstueckKey(x.gemarkung, x.flur, x.nr) === flurstueckKey(e.gemarkung, e.flur, e.nr)) || (t.length === 1 ? t[0] : null);
        if (p?.ring) r = { p };
      } catch { /* bleibt nicht gefunden */ }
    }
    if (!r.p) { nicht.push({ text, grund: r.grund === 'gemarkung' ? 'Gemarkung unbekannt (Schreibweise prüfen oder Gebiet noch nicht in der App)' : r.mehrdeutig ? 'Flur fehlt, und die Nummer gibt es in mehreren Fluren – bitte Flur ergänzen' : r.grund === 'flurstueck' ? `Flurstück in ${r.gemarkungen.join(' / ')} nicht gefunden (Flur und Nummer prüfen)` : 'Gebiet noch nicht in der App' }); continue; }
    const p = r.p;
    // Eigentümer unter der amtlichen Schreibweise ablegen, damit Infobox und Ordner ihn finden
    const kAmtlich = flurstueckKey(p.gemarkung, p.flur, p.nr), kExcel = flurstueckKey(e.gemarkung, e.flur, e.nr);
    if (kAmtlich !== kExcel) { laden(); et[kAmtlich] = { ...e, gemarkung: p.gemarkung, flur: p.flur, nr: p.nr }; delete et[kExcel]; sichern(); }
    if (store.get().parcels.some((x) => x.id === p.id)) { vorhanden++; continue; }
    store.update((s) => { s.parcels.push({ ...p, category: ['Wald', 'Landwirtschaft', 'Gewässer', 'Gebäude'].includes(p.nutzung) ? p.nutzung : 'Wald', addedAt: Date.now(), ordnerId: null }); });
    hinzu++;
  }
  const o = ordnerAusEigentuemern({ dateiId });
  // Flurstücke der Tabelle ohne Namen kommen in einen Sammelordner der Tabelle (nicht zu den eigenen Flächen)
  const ohne = liste.filter((e) => !etName(e)).map((e) => store.get().parcels.find((p) => flurstueckKey(p.gemarkung, p.flur, p.nr) === flurstueckKey(e.gemarkung, e.flur, e.nr))).filter((p) => p && !p.ordnerId);
  if (ohne.length) {
    const d = etDateien().find((x) => x.id === dateiId);
    const name = `Ohne Waldbesitzer${d ? ` (${d.name})` : ''}`;
    let ord = ordnerListe().find((x) => x.name === name);
    store.update((st) => { st.ordner ||= []; if (!ord) { ord = { id: uid(), name, erstellt: Date.now() }; st.ordner.push(ord); o.neu++; } for (const p of st.parcels) if (ohne.some((q) => q.id === p.id)) p.ordnerId = ord.id; });
    o.zugeordnet += ohne.length; o.ohneName = ohne.length;
  }
  if (dateiId) etDateiAktualisieren(dateiId, { gefunden: hinzu + vorhanden, nichtGefunden: nicht.length, nichtListe: nicht.slice(0, 200) });
  const { speicherOk } = await import('./store.js');
  const eigene = store.get().parcels.filter((p) => !p.ordnerId).map((p) => `${p.gemarkung}, Flur ${p.flur}, ${p.nr}`);
  return { eigene, hinzu, vorhanden, nicht, nichtGefunden: nicht.map((x) => x.text), ...o, gespeichert: speicherOk(), ordnerGesamt: ordnerListe().length };
}
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
// Ohne Profimodus sind nur die eigenen Flächen zu sehen; Ordner bleiben gespeichert
export const aktiverOrdner = () => (istProfi() ? store.get().settings.ordnerAktiv || 'eigen' : 'eigen');
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
  // einmalig: Flurstücke, die wegen eines früheren Fehlers mit Waldbesitzer bei den eigenen Flächen
  // gelandet sind, in den Ordner ihres Waldbesitzers legen
  gemarkungenLaden().then(() => {
  const st = store.get();
  if (istProfi() && !st.settings.ordnerReparatur2 && st.parcels.some((p) => !p.ordnerId && etName(eigentuemerVon(p)))) {
    const r = ordnerAusEigentuemern();
    if (r.zugeordnet) setTimeout(() => toast(`${r.zugeordnet} Flurstücke in die Ordner ihrer Waldbesitzer einsortiert`), 1500);
  }
  if (!st.settings.ordnerReparatur2) store.update((x) => { x.settings.ordnerReparatur2 = true; });
  });
}

export function ordnerWaehlen(id) {
  store.update((s) => { s.settings.ordnerAktiv = id; });
}

/** Leiste im Kopf: welcher Ordner ist zu sehen? */
export function ordnerLeiste() {
  if (!istProfi()) return null;
  const a = aktiverOrdner();
  const liste = ordnerListe();
  const name = a === 'eigen' ? 'Eigene Flächen' : a === 'alle' ? 'Alle Ordner' : liste.find((o) => o.id === a)?.name || 'Eigene Flächen';
  return h('div', { class: 'ordner-leiste' },
    h('span', { class: 'ordner-symbol', 'aria-hidden': 'true' }, '📁'),
    h('button', { type: 'button', class: 'ordner-knopf', 'aria-haspopup': 'dialog', 'aria-label': `Ordner wählen, gewählt: ${name}`, onclick: () => ordnerSuchen({ aktiv: a, mitSpezial: true }).then((v) => { if (v) ordnerWaehlen(v); }) },
      h('span', { class: 'ordner-name' }, name), h('span', { class: 'ordner-zahl muted' }, liste.length ? `${liste.length} Ordner` : ''), h('span', { 'aria-hidden': 'true' }, '▾')));
}

/**
 * Ordner mit Suchfeld auswählen (für viele Waldbesitzer). Liefert die Ordner-ID, 'eigen', 'alle' oder null.
 * mitSpezial: „Eigene Flächen“ und „Alle Ordner“ anbieten; vorschlag: Name für „+ Neuer Ordner“.
 */
export function ordnerSuchen({ aktiv = null, mitSpezial = false, eigenWert = 'eigen', vorschlag = '' } = {}) {
  return new Promise((fertig) => {
    let erledigt = false;
    const ende = (v) => { if (erledigt) return; erledigt = true; seite.close(); fertig(v); };
    const s = store.get();
    const zahl = new Map();
    for (const p of s.parcels) if (p.ordnerId) zahl.set(p.ordnerId, (zahl.get(p.ordnerId) || 0) + 1);
    const alle = ordnerListe().slice().sort((x, y) => x.name.localeCompare(y.name, 'de'));
    const liste = h('ul', { class: 'ordner-suche-liste', role: 'listbox' });
    const norm = (t) => gemNorm(t);
    const zeile = (wert, titel, unter, aktivJa) => h('li', {}, h('button', { type: 'button', role: 'option', 'aria-selected': String(!!aktivJa), class: `ordner-suche-eintrag ${aktivJa ? 'on' : ''}`, onclick: () => ende(wert) },
      h('strong', {}, titel), unter ? h('small', { class: 'muted' }, unter) : null));
    const zeigen = (q) => {
      const qq = norm(q);
      const treffer = qq ? alle.filter((o) => norm(o.name).includes(qq) || norm(etName(o.eigentuemer) || '').includes(qq) || norm(o.eigentuemer?.ort || '').includes(qq)) : alle;
      fill(liste,
        mitSpezial && !qq ? [zeile(eigenWert, 'Eigene Flächen', `${s.parcels.filter((p) => !p.ordnerId).length} Flurstücke`, aktiv === eigenWert), zeile('alle', 'Alle Ordner', 'Alles zusammen', aktiv === 'alle')] : null,
        !mitSpezial && !qq ? zeile(eigenWert, 'Eigene Flächen', null, aktiv === eigenWert) : null,
        treffer.slice(0, 200).map((o) => zeile(o.id, o.name, [`${zahl.get(o.id) || 0} Flurstücke`, o.eigentuemer?.ort].filter(Boolean).join(' · '), aktiv === o.id)),
        treffer.length > 200 ? h('li', { class: 'muted' }, `… ${treffer.length - 200} weitere – Suche genauer eingeben`) : null,
        qq && !treffer.length ? h('li', { class: 'muted' }, 'Kein Ordner gefunden.') : null);
    };
    const feld = h('input', { type: 'search', placeholder: `In ${alle.length} Ordnern suchen (Name, Ort) …`, 'aria-label': 'Ordner suchen', autocomplete: 'off', oninput: (e) => zeigen(e.target.value) });
    const body = h('div', { class: 'ordner-suche' }, feld, liste,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: async () => { const o = await ordnerAnlegen(feld.value.trim() || vorschlag); if (o) ende(o.id); } }, '+ Neuer Ordner'),
        mitSpezial ? h('button', { type: 'button', class: 'btn', onclick: () => { ende(null); openOrdnerVerwaltung(); } }, 'Ordner verwalten') : null));
    const seite = openPage('Ordner wählen', body, { onClose: () => { if (!erledigt) { erledigt = true; fertig(null); } } });
    zeigen('');
    setTimeout(() => feld.focus(), 200);
  });
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
  toast(`Ordner „${o.name}“ angelegt – Eigentümerdaten trägst du unter „Ordner verwalten“ ein`);
  return o;
}

/** Ordner aus der Eigentümerliste: je Eigentümer (Name + Anschrift) ein Ordner; eigene Flurstücke mit passendem Eigentümer werden zugeordnet */
export function ordnerAusEigentuemern({ dateiId = null } = {}) {
  const s = store.get();
  const ordner = [...(s.ordner || [])];
  const nachName = new Map(ordner.map((o) => [o.name.toLowerCase(), o]));
  let neu = 0, zugeordnet = 0;
  const zuordnung = {};
  // je Waldbesitzer der Tabelle(n) ein Ordner – auch wenn sein Flurstück (noch) nicht gefunden wurde
  for (const e of Object.values(laden())) {
    if (dateiId && !gehoertZu(e, dateiId)) continue;
    const name = etName(e);
    if (!name || nachName.has(name.toLowerCase())) continue;
    const { gemarkung, flur, nr, geaendert, datei, ...nurPerson } = e;
    const o = { id: uid(), name, erstellt: Date.now(), eigentuemer: nurPerson };
    ordner.push(o); nachName.set(name.toLowerCase(), o); neu++;
  }
  const dateiName = new Map(etDateien().map((d) => [d.id, d.name]));
  for (const p of s.parcels) {
    const e = eigentuemerVon(p);
    let name = etName(e);
    // Flurstück steht in einer Tabelle, aber ohne Waldbesitzer → Sammelordner dieser Tabelle
    const sammel = !name && e?.datei && !p.ordnerId;
    if (sammel) name = `Ohne Waldbesitzer${dateiName.get(e.datei) ? ` (${dateiName.get(e.datei)})` : ''}`;
    if (!name) continue;
    let o = nachName.get(name.toLowerCase());
    if (!o) { const { gemarkung, flur, nr, geaendert, ...nurPerson } = e; o = { id: uid(), name, erstellt: Date.now(), ...(sammel ? {} : { eigentuemer: nurPerson }) }; ordner.push(o); nachName.set(name.toLowerCase(), o); neu++; }
    if (p.ordnerId !== o.id) { zuordnung[p.id] = o.id; zugeordnet++; }
  }
  store.update((st) => { st.ordner = ordner; for (const p of st.parcels) if (zuordnung[p.id]) p.ordnerId = zuordnung[p.id]; });
  return { neu, zugeordnet };
}

/** Flurstück einem Ordner zuordnen (null = eigene Flächen) */
export function flurstueckZuordnen(pid, ordnerId) {
  store.update((s) => { const p = s.parcels.find((x) => x.id === pid); if (p) p.ordnerId = ordnerId || null; });
  if (ordnerId) ordnerEigentuemerAnwenden(ordnerId, [pid]);
}

/** Eigentümer des Ordners bei seinen Flurstücken hinterlegen (alle oder nur die genannten) */
export function ordnerEigentuemerAnwenden(ordnerId, nurIds = null) {
  const o = ordnerListe().find((x) => x.id === ordnerId);
  if (!o?.eigentuemer || !Object.values(o.eigentuemer).some(Boolean)) return 0;
  let n = 0;
  for (const p of store.get().parcels) {
    if (p.ordnerId !== ordnerId || (nurIds && !nurIds.includes(p.id))) continue;
    eigentuemerSpeichern(p, o.eigentuemer); n++;
  }
  return n;
}

/** Eigentümerdaten am Ordner eintragen – gelten für alle Flurstücke im Ordner */
export async function ordnerEigentuemerBearbeiten(ordnerId) {
  const o = ordnerListe().find((x) => x.id === ordnerId);
  if (!o) return;
  // Vorbelegung: am Ordner gespeichert, sonst vom ersten Flurstück mit Eigentümer, sonst Name des Ordners
  const vomFlst = store.get().parcels.filter((p) => p.ordnerId === ordnerId).map(eigentuemerVon).find(Boolean);
  const werte = { ...(o.eigentuemer || vomFlst || {}) };
  if (!o.eigentuemer && !vomFlst) { const t = o.name.trim().split(/\s+/); if (t.length >= 2) { werte.vorname = t.slice(0, -1).join(' '); werte.nachname = t[t.length - 1]; } else werte.nachname = o.name; }
  const feld = ([k, l]) => h('label', {}, l, h('input', { value: werte[k] || '', type: k === 'email' ? 'email' : k === 'telefon' ? 'tel' : 'text', inputmode: k === 'plz' ? 'numeric' : undefined, oninput: (e) => { werte[k] = e.target.value.trim(); } }));
  const anzahl = store.get().parcels.filter((p) => p.ordnerId === ordnerId).length;
  let umbenennen = true;
  const ok = await dialog({
    title: `Eigentümer – ${o.name}`,
    body: h('div', { class: 'form' },
      h('div', { class: 'form-row' }, feld(ET_FELDER[0]), feld(ET_FELDER[1])),
      h('div', { class: 'form-row' }, feld(ET_FELDER[2]), feld(ET_FELDER[3])),
      h('div', { class: 'form-row' }, feld(ET_FELDER[4]), feld(ET_FELDER[5])),
      feld(ET_FELDER[6]), feld(ET_FELDER[7]),
      h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { umbenennen = e.target.checked; } }), 'Ordner nach dem Eigentümer benennen'),
      h('p', { class: 'hint' }, `Wird bei allen ${anzahl} Flurstücken des Ordners hinterlegt – und bei jedem Flurstück, das du später in den Ordner legst. Nur auf diesem Gerät gespeichert.`)),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'Übernehmen', value: true, primary: true }],
  });
  if (!ok) return;
  const daten = {}; for (const [k] of ET_FELDER) if (werte[k]) daten[k] = werte[k];
  const neuerName = umbenennen ? etName(daten) : '';
  store.update((s) => { const x = s.ordner.find((y) => y.id === ordnerId); x.eigentuemer = daten; if (neuerName) x.name = neuerName; });
  const n = ordnerEigentuemerAnwenden(ordnerId);
  toast(`Eigentümer bei ${n} ${n === 1 ? 'Flurstück' : 'Flurstücken'} hinterlegt`);
}

/** Auswahl in der Flurstücks-Info */
export function ordnerAuswahl(p, { beiAenderung } = {}) {
  const liste = ordnerListe();
  const e = eigentuemerVon(p);
  const vorschlag = e && etName(e) && !liste.some((o) => o.name.toLowerCase() === etName(e).toLowerCase()) ? etName(e) : null;
  return h('div', { class: 'info-block' }, h('h3', {}, 'Ordner'),
    h('button', { type: 'button', class: 'ordner-knopf ordner-knopf-rahmen', 'aria-label': `Ordner des Flurstücks: ${ordnerName(p.ordnerId || null)} – ändern`, onclick: async () => {
      const v = await ordnerSuchen({ aktiv: p.ordnerId || '', eigenWert: '', vorschlag: vorschlag || (e ? etName(e) : '') });
      if (v == null) return;
      flurstueckZuordnen(p.id, v || null); toast(`Flurstück ${p.nr}: ${ordnerName(v || null)}`); beiAenderung?.();
    } }, h('span', { class: 'ordner-name' }, ordnerName(p.ordnerId || null)), h('span', { 'aria-hidden': 'true' }, '▾')),
    h('p', { class: 'hint' }, 'Maßnahmen und Finanzen dieses Flurstücks erscheinen im gewählten Ordner.'));
}

export function openOrdnerVerwaltung() {
  const inhalt = h('div', { class: 'ordner-seite' });
  let suche = '';
  const listeHost = h('div');
  const sucheFeld = h('input', { type: 'search', placeholder: 'Ordner suchen (Name, Ort) …', 'aria-label': 'Ordner suchen', oninput: (e) => { suche = e.target.value; zeichne(); } });
  const zeichne = () => {
    const s = store.get();
    const q = gemNorm(suche);
    const liste = (s.ordner || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'de')).filter((o) => !q || gemNorm(o.name).includes(q) || gemNorm(o.eigentuemer?.ort || '').includes(q));
    const zahl = (id) => ({
      fl: s.parcels.filter((p) => (p.ordnerId || null) === id).length,
      m: (s.measures || []).filter((m) => ordnerVon(m) === id).length,
      b: (s.finanzen?.buchungen || []).filter((b) => ordnerVon(b) === id).length,
    });
    const zeile = (id, name) => { const z = zahl(id); return h('li', { class: 'fin-zeile' },
      h('div', { class: 'fin-zeile-text' }, h('strong', {}, name), h('small', { class: 'muted' }, `${z.fl} Flurstücke · ${z.m} Maßnahmen · ${z.b} Buchungen`), (() => { const e = id && ordnerListe().find((o) => o.id === id)?.eigentuemer; return e && etAdresse(e) ? h('small', { class: 'muted' }, `Eigentümer: ${[etName(e), etAdresse(e)].filter(Boolean).join(', ')}`) : null; })()),
      h('button', { class: 'btn btn-small', onclick: () => { ordnerWaehlen(id || 'eigen'); seite.close(); } }, 'Öffnen'),
      id ? h('button', { class: 'btn btn-small', onclick: () => ordnerEigentuemerBearbeiten(id) }, 'Eigentümer') : null,
      id ? h('button', { class: 'btn btn-small', onclick: async () => { let n = name; const ok = await dialog({ title: 'Ordner umbenennen', body: h('div', { class: 'form' }, h('label', {}, 'Name', h('input', { value: n, oninput: (e) => { n = e.target.value; } }))), actions: [{ label: 'Abbrechen', value: false }, { label: 'Speichern', value: true, primary: true }] }); if (ok && n.trim()) store.update((st) => { st.ordner.find((o) => o.id === id).name = n.trim(); }); } }, 'Umbenennen') : null,
      id ? h('button', { class: 'btn btn-small btn-danger-ghost', onclick: async () => {
        if (!(await confirmDialog(`Ordner „${name}“ auflösen?`, { ok: 'Auflösen', danger: true, body: 'Flurstücke, Maßnahmen und Buchungen bleiben erhalten und kommen zu „Eigene Flächen“.' }))) return;
        store.update((st) => { st.ordner = st.ordner.filter((o) => o.id !== id); for (const p of st.parcels) if (p.ordnerId === id) p.ordnerId = null; for (const m of st.measures || []) if (m.ordnerId === id) m.ordnerId = null; for (const b of st.finanzen?.buchungen || []) if (b.ordnerId === id) b.ordnerId = null; if (st.settings.ordnerAktiv === id) st.settings.ordnerAktiv = 'eigen'; });
      } }, 'Auflösen') : null); };
    if (!inhalt.childNodes.length) fill(inhalt, h('p', { class: 'muted' }, 'Je Eigentümer ein Ordner: Flurstücke, Maßnahmen und Finanzen werden getrennt geführt. Oben in jeder Ansicht wählst du, welcher Ordner zu sehen ist.'), (s.ordner || []).length > 8 ? sucheFeld : null, listeHost);
    fill(listeHost,
      h('ul', { class: 'fin-liste' }, q ? null : zeile(null, 'Eigene Flächen'), liste.slice(0, 300).map((o) => zeile(o.id, o.name))),
      liste.length > 300 ? h('p', { class: 'muted' }, `… ${liste.length - 300} weitere – Suche genauer eingeben`) : null,
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
