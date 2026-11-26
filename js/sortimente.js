// Sortimente: eigene Definitionen (Länge, Zopf, max. Durchmesser, Baumarten, Preis) und Aushaltung
// je Baum. Rechenweg: Für jede Durchmesserstufe und Baumart wird ein Musterstamm gebildet
// (Höhe aus einer Höhenkurve, Durchmesser nach oben abnehmend). Vom Stammfuß (Stock 0,3 m) aufwärts
// werden Stücke in der Reihenfolge der Sortimentsliste ausgehalten: ein Stück passt, wenn der
// Zopf (oberes Ende, ohne Rinde) mindestens „Zopf min“ hat und das dicke Ende höchstens „Durchmesser max“.
// Was oben übrig bleibt, geht ins Restholz-Sortiment (z. B. Energieholz), sonst bleibt es im Wald.
// Zum Schluss wird alles so skaliert, dass die Summe zur Menge im Zähler passt.
import { h, fill, openPage, toast, confirmDialog } from './ui.js';
import { store, uid } from './store.js';

export const STANDARD_SORTIMENTE = [
  { k: 'stamm', name: 'Stammholz Abschnitte', laenge: 5, zopf: 16, max: '', fuer: 'alle', preis: '' },
  { k: 'las', name: 'LAS', laenge: 4, zopf: 12, max: 45, fuer: 'nadel', preis: '' },
  { k: 'palette', name: 'Palettenholz', laenge: 4, zopf: 12, max: 40, fuer: 'alle', preis: '' },
  { k: 'pfahl', name: 'Pfahlholz', laenge: 2.5, zopf: 8, max: 16, fuer: 'nadel', preis: '' },
  { k: 'is', name: 'IS Industrieholz', laenge: 3, zopf: 7, max: 45, fuer: 'alle', preis: '' },
  { k: 'brenn', name: 'Brennholz', laenge: 1, zopf: 7, max: 60, fuer: 'alle', preis: '' },
  { k: 'energie', name: 'Energieholz / Hackschnitzel', laenge: 0, zopf: 0, max: 0, fuer: 'alle', preis: '', rest: true },
];
const FUER = { alle: 'alle Baumarten', nadel: 'nur Nadelholz', laub: 'nur Laubholz' };
const ALT = { industrie: 'is' }; // Schlüssel aus der ersten Version

/** Sortimentsliste aus den Einstellungen (bei Bedarf mit Standardwerten anlegen) */
export function sortimente() {
  const s = store.get().settings || {};
  if (Array.isArray(s.sortimente) && s.sortimente.length) return s.sortimente;
  const altPreise = s.sortimentPreise || {};
  return STANDARD_SORTIMENTE.map((x) => ({ ...x, preis: altPreise[x.k] ?? altPreise[Object.keys(ALT).find((a) => ALT[a] === x.k)] ?? '' }));
}
const speichern = (liste) => store.update((st) => { st.settings.sortimente = liste.map((x) => ({ ...x })); });
export const gewaehlteKeys = (keys) => [...new Set((keys || []).map((k) => ALT[k] || k))];

// ---------- Musterstamm ----------
const HOEHE = { fi: 1, ki: 0.9, lae: 0.97, dgl: 1.05, bu: 0.95, ei: 0.85, elb: 0.92, wlb: 0.85 };
const hoehe = (d, ba) => 1.3 + 40 * (1 - Math.exp(-0.045 * d)) * (HOEHE[ba] ?? 0.95);
const RINDE = (ba) => (['ei', 'ki', 'lae', 'dgl'].includes(ba) ? 0.9 : 0.94); // Durchmesser ohne Rinde
function dmAt(x, d13, H, ba) { if (x >= H) return 0; return d13 * RINDE(ba) * Math.pow((H - x) / (H - 1.3), 0.62); }
const vol = (dm, L) => Math.PI / 4 * (dm / 100) ** 2 * L; // Mittenformel

/** Aushaltung eines Musterbaums: Menge (Efm, skaliert) und Stück je Sortiment */
export function aushalten(d13, ba, efmZiel, liste, gewaehlt, nadel) {
  const H = hoehe(d13, ba);
  const res = {};
  let x = 0.3, summe = 0, xholz = 0;
  const passend = liste.filter((s) => !s.rest && gewaehlt.includes(s.k) && Number(s.laenge) > 0
    && !(s.fuer === 'nadel' && nadel === false) && !(s.fuer === 'laub' && nadel === true)); // nadel === null: Durchschnitt – alle erlaubt
  // Stück für Stück vom Stock aufwärts: jeweils das ranghöchste Sortiment, dessen Maße passen
  for (let n = 0; n < 200 && x < H; n++) {
    let genommen = false, zuDick = false;
    for (const s of passend) {
      const L = Number(s.laenge), zopf = Number(s.zopf) || 0, max = Number(s.max) || Infinity;
      if (x + L > H) continue;
      const unten = dmAt(x, d13, H, ba), oben = dmAt(x + L, d13, H, ba);
      if (unten > max) { zuDick = true; continue; }
      if (oben < zopf) continue;
      const v = vol(dmAt(x + L / 2, d13, H, ba), L);
      res[s.k] = res[s.k] || { fm: 0, stueck: 0 };
      res[s.k].fm += v; res[s.k].stueck += 1; summe += v; x += L; genommen = true;
      break;
    }
    if (genommen) continue;
    if (!zuDick) break; // zu dünn für alles → Rest
    // zu dick für alle gewählten Sortimente: 0,5 m weiter oben versuchen, das Stück zählt zum Rest
    const v = vol(dmAt(x + 0.25, d13, H, ba), 0.5); xholz += v; x += 0.5;
  }
  // Rest des Stamms bis zur Spitze
  let rest = xholz;
  for (let y = x; y < H; y += 0.25) rest += vol(dmAt(y + 0.125, d13, H, ba), Math.min(0.25, H - y));
  const restS = liste.find((s) => s.rest && gewaehlt.includes(s.k));
  const faktor = efmZiel / ((summe + rest) || 1);
  Object.values(res).forEach((r) => { r.fm *= faktor; });
  if (restS && rest > 0) res[restS.k] = { fm: rest * faktor, stueck: 0 };
  else res._wald = { fm: rest * faktor, stueck: 0 };
  return res;
}

// ---------- Einstellen ----------
export function openSortimenteEinstellen({ onClose } = {}) {
  let liste = sortimente().map((x) => ({ ...x }));
  const body = h('div', { class: 'sortimente-edit' });
  const seite = openPage('Sortimente einstellen', body, { onClose: () => { speichern(liste); onClose?.(); } });
  const zahl = (s, feld, label, einheit, step = 0.1) => h('label', {}, label,
    h('span', { class: 'mit-einheit' }, h('input', { type: 'number', inputmode: 'decimal', min: 0, step, value: s[feld] ?? '', onchange: (e) => { s[feld] = e.target.value === '' ? '' : Number(String(e.target.value).replace(',', '.')); speichern(liste); } }), h('span', {}, einheit)));
  function render() {
    fill(body,
      h('p', { class: 'hint' }, 'Die Reihenfolge ist die Rangfolge beim Aushalten: Vom Stammfuß nach oben wird zuerst das oberste Sortiment ausgehalten, solange die Maße passen, dann das nächste. Was übrig bleibt, geht ins Restholz (z. B. Energieholz) – ist keins gewählt, bleibt es im Wald.'),
      liste.map((s, i) => h('details', { class: 'kachel so-kachel', open: s._neu || null },
        h('summary', {}, h('strong', {}, s.name || 'Neues Sortiment'),
          h('small', { class: 'muted' }, s.rest ? 'Restholz – nimmt alles, was übrig bleibt' : `${String(s.laenge).replace('.', ',')} m · Zopf ≥ ${s.zopf} cm · ${s.max ? `max. ${s.max} cm` : 'ohne Höchstmaß'} · ${FUER[s.fuer] || FUER.alle}`)),
        h('div', { class: 'form' },
          h('label', {}, 'Name', h('input', { value: s.name, onchange: (e) => { s.name = e.target.value.trim() || s.name; speichern(liste); render(); } })),
          s.rest ? h('p', { class: 'hint' }, 'Restholz hat keine feste Länge: Kronen- und Zopfstücke, die in kein anderes Sortiment passen.') : [
            zahl(s, 'laenge', 'Länge', 'm', 0.1),
            zahl(s, 'zopf', 'Zopf min. (oberes Ende, ohne Rinde)', 'cm', 1),
            zahl(s, 'max', 'Durchmesser max. (dickes Ende, ohne Rinde) – leer = ohne Höchstmaß', 'cm', 1),
            h('label', {}, 'Gilt für', h('select', { onchange: (e) => { s.fuer = e.target.value; speichern(liste); render(); } }, Object.entries(FUER).map(([k, l]) => h('option', { value: k, selected: (s.fuer || 'alle') === k }, l))))],
          zahl(s, 'preis', 'Preis', '€/Fm', 1),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn btn-small', disabled: i === 0, onclick: () => { [liste[i - 1], liste[i]] = [liste[i], liste[i - 1]]; speichern(liste); render(); } }, '↑ höher'),
            h('button', { type: 'button', class: 'btn btn-small', disabled: i === liste.length - 1, onclick: () => { [liste[i + 1], liste[i]] = [liste[i], liste[i + 1]]; speichern(liste); render(); } }, '↓ tiefer'),
            h('button', { type: 'button', class: 'btn btn-small btn-danger-ghost', onclick: async () => { if (await confirmDialog(`„${s.name}“ löschen?`, { ok: 'Löschen', danger: true })) { liste.splice(i, 1); speichern(liste); render(); } } }, 'Löschen'))))),
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => { const restI = liste.findIndex((x) => x.rest); const neu = { k: uid(), name: 'Neues Sortiment', laenge: 3, zopf: 10, max: 40, fuer: 'alle', preis: '', _neu: true }; liste.splice(restI >= 0 ? restI : liste.length, 0, neu); speichern(liste); render(); } }, '+ Sortiment hinzufügen'),
      h('button', { type: 'button', class: 'btn btn-block', onclick: async () => { if (await confirmDialog('Alle Sortimente auf die Standardwerte zurücksetzen? Eigene Sortimente und Preise gehen verloren.', { ok: 'Zurücksetzen', danger: true })) { liste = STANDARD_SORTIMENTE.map((x) => ({ ...x })); speichern(liste); render(); } } }, 'Standardwerte wiederherstellen'),
      h('p', { class: 'hint' }, 'Standardwerte sind Vorschläge – bitte an die Vorgaben eures Käufers bzw. der Rahmenvereinbarung anpassen (Längen inkl. Zugabe, Zopf- und Höchstdurchmesser).'),
      h('button', { type: 'button', class: 'btn btn-primary btn-block btn-large', onclick: () => seite.close() }, 'Fertig'));
    liste.forEach((s) => delete s._neu);
  }
  render();
}
