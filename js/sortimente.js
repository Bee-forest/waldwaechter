// Sortimente: eigene Definitionen (Länge, Zugabe, Zopf, max. Durchmesser, Baumarten) und Preise –
// als ein Preis (€/Fm oder €/Rm) oder nach Stärkeklassen und Güte. Preise bleiben nur auf dem Gerät
// (Einstellungen im Browser-Speicher), auch wenn sie aus einer Preisliste geladen werden.
//
// Rechenweg der Aushaltung: Für jede Durchmesserstufe und Baumart wird ein Musterstamm gebildet
// (Höhe aus einer Höhenkurve, Durchmesser ohne Rinde nach oben abnehmend). Vom Stock (0,3 m) aufwärts
// bekommt jedes Stück das ranghöchste Sortiment, dessen Maße passen (Zopf am oberen Ende der Nennlänge,
// Höchstdurchmesser am dicken Ende). Die Längenzugabe wird mit abgeschnitten, aber nicht verkauft.
// Der Rest geht ins Restholz (z. B. Energieholz) oder bleibt im Wald. Zum Schluss wird alles auf die
// Menge im Zähler umgerechnet. Jedes Stück bekommt seine Stärkeklasse (Heilbronner Sortierung, Mitte o.R.).
import { h, fill, openPage, confirmDialog } from './ui.js';
import { store, uid } from './store.js';

export const KLASSEN_STANDARD = ['1a', '1b', '2a', '2b-4b', 'ÜS', 'NSF'];
const SPALTEN_STANDARD = ['B/C frisch', 'K/D Käfer/Fäule'];
const leereKlassen = () => Object.fromEntries(KLASSEN_STANDARD.map((k) => [k, ['', '']]));

export const STANDARD_SORTIMENTE = [
  { k: 'las_fi', name: 'LAS Fichte (Langholzabschnitte)', laenge: 5, zugabe: 10, zopf: 12, max: '', fuer: ['fi'], einheit: 'fm', preisArt: 'klassen', spalten: SPALTEN_STANDARD, klassen: leereKlassen() },
  { k: 'las_ki', name: 'LAS Kiefer / Lärche', laenge: 5, zugabe: 10, zopf: 13, max: '', fuer: ['ki', 'lae'], einheit: 'fm', preisArt: 'klassen', spalten: SPALTEN_STANDARD, klassen: leereKlassen() },
  { k: 'stamm', name: 'Stammholz Abschnitte (übrige Baumarten)', laenge: 5, zugabe: 10, zopf: 16, max: '', fuer: 'alle', einheit: 'fm', preisArt: 'klassen', spalten: SPALTEN_STANDARD, klassen: leereKlassen() },
  { k: 'pal', name: 'PAL Palettenholz', laenge: 2.4, zugabe: 0, zopf: 10, max: 40, fuer: 'nadel', einheit: 'rm', rmFaktor: 0.6, preisArt: 'einfach', preis: '' },
  { k: 'pfahl', name: 'Zaun- / Pfahlholz', laenge: 2.5, zugabe: 0, zopf: 6, max: 14, fuer: 'nadel', einheit: 'rm', rmFaktor: 0.65, preisArt: 'einfach', preis: '' },
  { k: 'is', name: 'IS Industrieholz', laenge: 2.5, zugabe: 0, zopf: 8, max: 45, fuer: 'alle', einheit: 'rm', rmFaktor: 0.65, preisArt: 'einfach', preis: '' },
  { k: 'brenn', name: 'Brennholz', laenge: 1, zugabe: 0, zopf: 7, max: 60, fuer: 'alle', einheit: 'rm', rmFaktor: 0.7, preisArt: 'einfach', preis: '' },
  { k: 'energie', name: 'Energieholz / Hackschnitzel', laenge: 0, zopf: 0, max: 0, fuer: 'alle', einheit: 'fm', preisArt: 'einfach', preis: '', rest: true },
];
export const STANDARD_WAHL = ['las_fi', 'las_ki', 'stamm', 'is'];
export const BA_NAMEN = { fi: 'Fichte', ki: 'Kiefer', lae: 'Lärche', dgl: 'Douglasie', bu: 'Buche', ei: 'Eiche', elb: 'Ahorn / Esche', wlb: 'Birke / Weichlaub' };
const FUER = { alle: 'alle Baumarten', nadel: 'nur Nadelholz', laub: 'nur Laubholz', auswahl: 'bestimmte Baumarten' };
const NADEL = ['fi', 'ki', 'lae', 'dgl'];
const ALT = { industrie: 'is', las: 'las_fi', palette: 'pal' }; // Schlüssel aus früheren Versionen
const VERSION = 2;
const kopie = (x) => JSON.parse(JSON.stringify(x));

/** Sortimentsliste aus den Einstellungen (bei Bedarf mit Standardwerten anlegen bzw. umstellen) */
export function sortimente() {
  const s = store.get().settings || {};
  if (Array.isArray(s.sortimente) && s.sortimente.length && s.sortimenteV === VERSION) return s.sortimente;
  // Umstellung auf Version 2: eigene Sortimente behalten, Standard-Sortimente neu
  const alteStd = ['stamm', 'las', 'palette', 'pfahl', 'is', 'brenn', 'energie'];
  const eigene = (s.sortimente || []).filter((x) => !alteStd.includes(x.k)).map((x) => ({ einheit: 'fm', preisArt: 'einfach', ...x }));
  const liste = STANDARD_SORTIMENTE.map(kopie);
  liste.splice(liste.findIndex((x) => x.rest), 0, ...eigene);
  return liste;
}
export function speichern(liste) {
  store.update((st) => { st.settings.sortimente = liste.map((x) => { const y = kopie(x); delete y._neu; return y; }); st.settings.sortimenteV = VERSION; });
}
export const gewaehlteKeys = (keys) => [...new Set((keys || []).map((k) => ALT[k] || k))];
export const zugabeVon = (s) => Number(s.zugabe ?? STANDARD_SORTIMENTE.find((x) => x.k === s.k)?.zugabe ?? 0) || 0;
const zahlText = (x) => String(x).replace('.', ',');

/** Kurztext der Maße, z. B. „5 m + 10 cm Zugabe · Zopf ≥ 12 cm · max. 45 cm“ */
export function masseText(s, { ge = '≥' } = {}) {
  if (s.rest) return 'Rest';
  const z = zugabeVon(s);
  return `${zahlText(s.laenge)} m${z ? ` + ${z} cm Zugabe` : ''} · Zopf ${ge} ${s.zopf} cm${s.max ? ` · max. ${s.max} cm` : ''}`;
}
export function fuerText(s) {
  if (Array.isArray(s.fuer)) return s.fuer.map((k) => BA_NAMEN[k] || k).join(', ');
  return FUER[s.fuer] || FUER.alle;
}
function passtBaumart(s, ba) { // ba: Baumartschlüssel oder 'avg' (Durchschnitt – alles erlaubt)
  if (ba === 'avg' || !ba) return true;
  if (Array.isArray(s.fuer)) return s.fuer.includes(ba);
  if (s.fuer === 'nadel') return NADEL.includes(ba);
  if (s.fuer === 'laub') return !NADEL.includes(ba);
  return true;
}

// ---------- Preise ----------
/** „60,00 - 70,00“ → 65 (Mittelwert einer Spanne); „85“ → 85; leer → null */
export function preisZahl(t) {
  const z = String(t ?? '').match(/\d+(?:[.,]\d+)?/g);
  if (!z) return null;
  const n = z.slice(0, 2).map((x) => Number(x.replace(',', '.')));
  return n.reduce((a, b) => a + b, 0) / n.length;
}
export const preisAnzeige = (t) => { const z = String(t ?? '').match(/\d+(?:[.,]\d+)?/g); return z ? z.slice(0, 2).map((x) => Number(x.replace(',', '.')).toLocaleString('de-DE')).join('–') : '–'; };

// Heilbronner Sortierung (Mittendurchmesser ohne Rinde, ganze cm); ÜS ab 65 cm am dicken Ende
const HB = ['0', '1a', '1b', '2a', '2b', '3a', '3b', '4a', '4b', '5', '6'];
export function hbKlasse(dm, unten) {
  if (unten >= 65) return 'ÜS';
  const d = Math.floor(dm);
  if (d < 10) return '0'; if (d < 15) return '1a'; if (d < 20) return '1b'; if (d < 25) return '2a'; if (d < 30) return '2b';
  if (d < 35) return '3a'; if (d < 40) return '3b'; if (d < 45) return '4a'; if (d < 50) return '4b'; if (d < 60) return '5'; return '6';
}
const keyNorm = (k) => String(k).replace(/\*/g, '').replace(/[–—]/g, '-').replace(/\s/g, '').toLowerCase();
const istNsf = (k) => keyNorm(k) === 'nsf';
const istUes = (k) => /^(ü|ue|u)s/.test(keyNorm(k));
/** Tabellenzeile für eine Stärkeklasse: genau, als Spanne („2b-4b“), sonst die nächstliegende */
export function klassenZeile(s, hb) {
  const keys = Object.keys(s.klassen || {}).filter((k) => !istNsf(k));
  const ues = keys.find(istUes);
  if (ues && (hb === 'ÜS' || hb === '5' || hb === '6')) return ues;
  const idx = HB.indexOf(hb === 'ÜS' ? '6' : hb);
  const bereich = keys.filter((k) => !istUes(k)).map((k) => { const [a, b] = keyNorm(k).split('-'); const i = HB.indexOf(a), j = b ? HB.indexOf(b) : i; return { k, i, j }; }).filter((x) => x.i >= 0 && x.j >= 0);
  const treffer = bereich.find((x) => idx >= x.i && idx <= x.j);
  if (treffer) return treffer.k;
  if (!bereich.length) return ues || keys[0];
  bereich.sort((a, b) => a.i - b.i);
  if (idx < bereich[0].i) return bereich[0].k;
  return bereich.filter((x) => x.j < idx).pop()?.k || bereich[0].k;
}
/** Preis in €/Fm für ein Sortiment, eine Stärkeklasse und die Gütemischung { kd: Anteil, nsf: Anteil } */
export function preisJeFm(s, hb, mix = {}) {
  const umr = s.einheit === 'rm' ? (Number(s.rmFaktor) || 0.65) : 1; // €/Rm ÷ (Fm je Rm) = €/Fm
  if (s.preisArt !== 'klassen') { const p = preisZahl(s.preis); return p == null ? null : p / umr; }
  const zeile = s.klassen?.[klassenZeile(s, hb)] || [];
  const nsfKey = Object.keys(s.klassen || {}).find(istNsf);
  const p0 = preisZahl(zeile[0]); const p1 = preisZahl(zeile[1]) ?? p0; const pn = nsfKey ? preisZahl(s.klassen[nsfKey][0]) : null;
  if (p0 == null) return null;
  const kd = Math.min(1, Math.max(0, Number(mix.kd) || 0));
  const nsf = pn == null ? 0 : Math.min(1 - kd, Math.max(0, Number(mix.nsf) || 0));
  return ((1 - kd - nsf) * p0 + kd * p1 + nsf * pn) / umr;
}
/** Erlös je Sortiment aus den Mengen (inkl. Stärkeklassen) */
export function erloese(menge, liste, gewaehlt, mix) {
  const r = {};
  for (const s of liste) {
    if (!gewaehlt.includes(s.k) || !menge[s.k]?.fm) continue;
    const kl = menge[s.k].kl && Object.keys(menge[s.k].kl).length ? menge[s.k].kl : { '2a': menge[s.k].fm };
    let e = 0, fehlt = false;
    for (const [hb, fm] of Object.entries(kl)) { const p = preisJeFm(s, hb, mix); if (p == null) fehlt = true; else e += fm * p; }
    r[s.k] = { euro: e, fehlt };
  }
  return r;
}
export const hatPreis = (s) => (s.preisArt === 'klassen' ? Object.values(s.klassen || {}).some((z) => preisZahl(z?.[0]) != null) : preisZahl(s.preis) != null);
export const hatKlassen = (s) => s.preisArt === 'klassen';

// ---------- Musterstamm ----------
const HOEHE = { fi: 1, ki: 0.9, lae: 0.97, dgl: 1.05, bu: 0.95, ei: 0.85, elb: 0.92, wlb: 0.85 };
const hoehe = (d, ba) => 1.3 + 40 * (1 - Math.exp(-0.045 * d)) * (HOEHE[ba] ?? 0.95);
const RINDE = (ba) => (['ei', 'ki', 'lae', 'dgl'].includes(ba) ? 0.9 : 0.94); // Durchmesser ohne Rinde
function dmAt(x, d13, H, ba) { if (x >= H) return 0; return d13 * RINDE(ba) * Math.pow((H - x) / (H - 1.3), 0.62); }
const vol = (dm, L) => Math.PI / 4 * (dm / 100) ** 2 * L; // Mittenformel

/** Aushaltung eines Musterbaums: Menge (Efm, skaliert), Stück und Stärkeklassen je Sortiment.
 *  ba: Baumart für das Stammmodell, baKey: Baumart der Auszeichnung ('avg' = Durchschnitt) */
export function aushalten(d13, ba, efmZiel, liste, gewaehlt, baKey = ba) {
  const H = hoehe(d13, ba);
  const res = {};
  let x = 0.3, summe = 0, xholz = 0, zug = 0;
  const passend = liste.filter((s) => !s.rest && gewaehlt.includes(s.k) && Number(s.laenge) > 0 && passtBaumart(s, baKey));
  // Stück für Stück vom Stock aufwärts: jeweils das ranghöchste Sortiment, dessen Maße passen
  for (let n = 0; n < 200 && x < H; n++) {
    let genommen = false, zuDick = false;
    for (const s of passend) {
      const L = Number(s.laenge), Z = zugabeVon(s) / 100, zopf = Number(s.zopf) || 0, max = Number(s.max) || Infinity;
      if (x + L + Z > H) continue;
      const unten = dmAt(x, d13, H, ba), oben = dmAt(x + L, d13, H, ba);
      if (unten > max) { zuDick = true; continue; }
      if (oben < zopf) continue;
      const mitte = dmAt(x + L / 2, d13, H, ba);
      const v = vol(mitte, L);
      const vz = Z ? vol(dmAt(x + L + Z / 2, d13, H, ba), Z) : 0;
      const r = res[s.k] = res[s.k] || { fm: 0, stueck: 0, kl: {} };
      const kl = hbKlasse(mitte, unten);
      r.fm += v; r.stueck += 1; r.kl[kl] = (r.kl[kl] || 0) + v;
      summe += v; zug += vz; x += L + Z; genommen = true;
      break;
    }
    if (genommen) continue;
    if (!zuDick) break; // zu dünn für alles → Rest
    const v = vol(dmAt(x + 0.25, d13, H, ba), 0.5); xholz += v; x += 0.5; // zu dick für alles: 0,5 m höher versuchen
  }
  let rest = xholz;
  for (let y = x; y < H; y += 0.25) rest += vol(dmAt(y + 0.125, d13, H, ba), Math.min(0.25, H - y));
  const restS = liste.find((s) => s.rest && gewaehlt.includes(s.k));
  const faktor = efmZiel / ((summe + rest + zug) || 1);
  Object.values(res).forEach((r) => { r.fm *= faktor; Object.keys(r.kl).forEach((k) => { r.kl[k] *= faktor; }); });
  if (zug > 0) res._zugabe = { fm: zug * faktor, stueck: 0 };
  if (restS && rest > 0) res[restS.k] = { fm: rest * faktor, stueck: 0, kl: {} };
  else res._wald = { fm: rest * faktor, stueck: 0 };
  return res;
}

// ---------- Einstellen ----------
export function openSortimenteEinstellen({ onClose } = {}) {
  let liste = sortimente().map(kopie);
  const body = h('div', { class: 'sortimente-edit' });
  const seite = openPage('Sortimente und Preise', body, { onClose: () => { speichern(liste); onClose?.(); } });
  const sp = () => speichern(liste);
  const zahl = (s, feld, label, einheit, step = 0.1) => h('label', {}, label,
    h('span', { class: 'mit-einheit' }, h('input', { type: 'number', inputmode: 'decimal', min: 0, step, value: s[feld] ?? '', onchange: (e) => { s[feld] = e.target.value === '' ? '' : Number(String(e.target.value).replace(',', '.')); sp(); } }), h('span', {}, einheit)));
  const preisFeld = (wert, setze, ph = 'z. B. 60-70') => h('input', { class: 'so-preis', inputmode: 'decimal', value: wert ?? '', placeholder: ph, onchange: (e) => { setze(e.target.value.trim()); sp(); } });

  function preisTeil(s) {
    const einheit = s.einheit === 'rm' ? '€/Rm' : '€/Fm';
    const kopf = [
      h('div', { class: 'so-zwei' },
        h('label', {}, 'Preis', h('select', { onchange: (e) => { s.preisArt = e.target.value; if (s.preisArt === 'klassen' && !s.klassen) { s.klassen = leereKlassen(); s.spalten = [...SPALTEN_STANDARD]; } sp(); render(); } },
          h('option', { value: 'einfach', selected: s.preisArt !== 'klassen' }, 'ein Preis'), h('option', { value: 'klassen', selected: s.preisArt === 'klassen' }, 'nach Stärkeklassen'))),
        h('label', {}, 'Einheit', h('select', { onchange: (e) => { s.einheit = e.target.value; if (s.einheit === 'rm' && !s.rmFaktor) s.rmFaktor = 0.65; sp(); render(); } },
          h('option', { value: 'fm', selected: s.einheit !== 'rm' }, '€ je Festmeter'), h('option', { value: 'rm', selected: s.einheit === 'rm' }, '€ je Raummeter')))),
      s.einheit === 'rm' ? zahl(s, 'rmFaktor', 'Umrechnung: 1 Raummeter = … Festmeter (URF)', 'Fm', 0.01) : null,
    ];
    if (s.preisArt !== 'klassen') return [...kopf, h('label', {}, `Preis (${einheit}) – Spanne möglich, gerechnet wird mit der Mitte`, preisFeld(s.preis, (v) => { s.preis = v; }, 'z. B. 30-35'))];
    const spalten = s.spalten?.length ? s.spalten : SPALTEN_STANDARD;
    const keys = Object.keys(s.klassen || {});
    return [...kopf,
      h('table', { class: 'so-tabelle' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Stkl.'), spalten.slice(0, 2).map((t, j) => h('th', {}, h('input', { class: 'so-spalte', value: t, 'aria-label': `Güte Spalte ${j + 1}`, onchange: (e) => { s.spalten = [...spalten]; s.spalten[j] = e.target.value.trim() || t; sp(); } }))))),
        h('tbody', {}, keys.map((k) => (istNsf(k)
          ? h('tr', {}, h('th', {}, k), h('td', { colspan: 2 }, preisFeld(s.klassen[k][0], (v) => { s.klassen[k] = [v, v]; }, 'nicht sägefähig')))
          : h('tr', {}, h('th', {}, k), [0, 1].map((j) => h('td', {}, preisFeld(s.klassen[k][j], (v) => { s.klassen[k][j] = v; })))))))),
      h('p', { class: 'hint' }, `${einheit}; Spannen wie „60-70“ gehen (gerechnet wird mit der Mitte). Stärkeklasse nach Mittendurchmesser ohne Rinde, ÜS ab 65 cm am dicken Ende. NSF = nicht sägefähig – die Anteile von Spalte 2 und NSF stellst du beim Auszeichnen ein.`)];
  }

  function render() {
    const pl = store.get().settings?.preisliste;
    fill(body,
      h('div', { class: 'kachel so-import' },
        h('strong', {}, 'Preisliste laden'),
        h('p', { class: 'hint' }, pl ? `Geladen: ${pl.titel || 'Preisliste'} (am ${new Date(pl.am).toLocaleDateString('de-DE')}). Die Preise bleiben nur auf diesem Gerät.` : 'PDF-Preisliste deines Holzkäufers vom Handy laden – die App liest Sortimente und Preise aus. Datei und Preise bleiben nur auf diesem Gerät.'),
        h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => import('./preisliste.js').then((x) => x.preislisteLaden({ onFertig: () => { liste = sortimente().map(kopie); render(); } })) }, pl ? 'Neue Preisliste laden' : 'Preisliste (PDF) laden')),
      h('p', { class: 'hint' }, 'Die Reihenfolge ist die Rangfolge beim Aushalten: Vom Stammfuß nach oben bekommt jedes Stück das oberste Sortiment, dessen Maße passen. Was übrig bleibt, geht ins Restholz (z. B. Energieholz) – ist keins gewählt, bleibt es im Wald.'),
      liste.map((s, i) => h('details', { class: 'kachel so-kachel', open: s._neu || null },
        h('summary', {}, h('strong', {}, s.name || 'Neues Sortiment'),
          h('small', { class: 'muted' }, s.rest ? 'Restholz – nimmt alles, was übrig bleibt' : `${masseText(s)}${s.max ? '' : ' · ohne Höchstmaß'} · ${fuerText(s)}`),
          h('small', { class: hatPreis(s) ? 'so-hat-preis' : 'muted' }, hatPreis(s) ? (s.preisArt === 'klassen' ? `Preise nach Stärkeklassen (${s.einheit === 'rm' ? '€/Rm' : '€/Fm'})` : `${preisAnzeige(s.preis)} ${s.einheit === 'rm' ? '€/Rm' : '€/Fm'}`) : 'noch kein Preis')),
        h('div', { class: 'form' },
          h('label', {}, 'Name', h('input', { value: s.name, onchange: (e) => { s.name = e.target.value.trim() || s.name; sp(); render(); } })),
          s.rest ? h('p', { class: 'hint' }, 'Restholz hat keine feste Länge: Kronen- und Zopfstücke, die in kein anderes Sortiment passen.') : [
            h('div', { class: 'so-zwei' }, zahl(s, 'laenge', 'Länge (Nenn-)', 'm', 0.1),
              h('label', {}, 'Längenzugabe', h('span', { class: 'mit-einheit' }, h('input', { type: 'number', inputmode: 'numeric', min: 0, step: 1, value: zugabeVon(s), onchange: (e) => { s.zugabe = Number(e.target.value) || 0; sp(); render(); } }), h('span', {}, 'cm')))),
            h('div', { class: 'so-zwei' }, zahl(s, 'zopf', 'Zopf min. (o.R.)', 'cm', 1), zahl(s, 'max', 'Durchm. max. (o.R.)', 'cm', 1)),
            h('p', { class: 'hint' }, 'Durchmesser max. leer = ohne Höchstmaß.'),
            h('label', {}, 'Gilt für', h('select', { onchange: (e) => { s.fuer = e.target.value === 'auswahl' ? ['fi'] : e.target.value; sp(); render(); } },
              Object.entries(FUER).map(([k, l]) => h('option', { value: k, selected: (Array.isArray(s.fuer) ? 'auswahl' : s.fuer || 'alle') === k }, l)))),
            Array.isArray(s.fuer) ? h('div', { class: 'schnell-chips' }, Object.entries(BA_NAMEN).map(([k, n]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s.fuer.includes(k)), onclick: () => { s.fuer = s.fuer.includes(k) ? s.fuer.filter((x) => x !== k) : [...s.fuer, k]; if (!s.fuer.length) s.fuer = 'alle'; sp(); render(); } }, n))) : null],
          preisTeil(s),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn btn-small', disabled: i === 0, onclick: () => { [liste[i - 1], liste[i]] = [liste[i], liste[i - 1]]; sp(); render(); } }, '↑ höher'),
            h('button', { type: 'button', class: 'btn btn-small', disabled: i === liste.length - 1, onclick: () => { [liste[i + 1], liste[i]] = [liste[i], liste[i + 1]]; sp(); render(); } }, '↓ tiefer'),
            h('button', { type: 'button', class: 'btn btn-small btn-danger-ghost', onclick: async () => { if (await confirmDialog(`„${s.name}“ löschen?`, { ok: 'Löschen', danger: true })) { liste.splice(i, 1); sp(); render(); } } }, 'Löschen'))))),
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => { const restI = liste.findIndex((x) => x.rest); const neu = { k: uid(), name: 'Neues Sortiment', laenge: 3, zugabe: 0, zopf: 10, max: 40, fuer: 'alle', einheit: 'fm', preisArt: 'einfach', preis: '', _neu: true }; liste.splice(restI >= 0 ? restI : liste.length, 0, neu); sp(); render(); } }, '+ Sortiment hinzufügen'),
      h('label', { class: 'so-skonto' }, 'Skonto / Abzug vom Erlös', h('span', { class: 'mit-einheit' }, h('input', { type: 'number', inputmode: 'decimal', min: 0, max: 30, step: 0.5, value: store.get().settings?.skonto ?? '', onchange: (e) => store.update((st) => { st.settings.skonto = e.target.value; }) }), h('span', {}, '%'))),
      h('button', { type: 'button', class: 'btn btn-block', onclick: async () => { if (await confirmDialog('Alle Sortimente auf die Standardwerte zurücksetzen? Eigene Sortimente und alle Preise gehen verloren.', { ok: 'Zurücksetzen', danger: true })) { liste = STANDARD_SORTIMENTE.map(kopie); store.update((st) => { delete st.settings.preisliste; }); sp(); render(); } } }, 'Standardwerte wiederherstellen'),
      h('button', { type: 'button', class: 'btn btn-primary btn-block btn-large', onclick: () => seite.close() }, 'Fertig'));
    liste.forEach((s) => delete s._neu);
  }
  render();
}
