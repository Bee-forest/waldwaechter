// Einzelschutz für eine geplante Pflanzung: Baumarten und Stückzahlen aus der Pflanzplanung übernehmen,
// Art, Höhe, Material und Befestigung wählen, Kosten und Förderung rechnen, als Maßnahme buchen.
import { h, fill, openPage, toast } from './ui.js';
import { store, uid } from './store.js';
import { formatHa } from './geo.js';
import { SAETZE } from './foerder-formular.js';

export const SCHUTZ_ARTEN = [
  { art: 'Freiwuchsgitter / Drahthose', text: 'Metallgitter gegen Verbiss und Fegen; kunststofffrei, mehrfach verwendbar.', material: 'kunststofffrei' },
  { art: 'Wuchshülle', text: 'Geschlossene Hülle gegen Verbiss; als Holz- oder Pappvariante kunststofffrei.', material: null },
  { art: 'Fegeschutz (Spirale, Fegestab)', text: 'Nur gegen Fegen des Rehbocks, nicht gegen Verbiss.', material: null },
  { art: 'Terminaltriebschutz', text: 'Schützt nur den Leittrieb, vor allem bei Nadelbäumen.', material: null },
  { art: 'Verbissschutzmittel (Streichmittel)', text: 'Wird auf die Triebe gestrichen und muss jährlich erneuert werden.', material: null },
];
export const SCHUTZ_HOEHEN = [['0,60 m', 60], ['0,90 m', 90], ['1,20 m', 120], ['1,50 m', 150], ['1,80 m', 180], ['2,00 m', 200]];
const STAEBE = ['Robinienstab', 'Lärchenstab', 'Tonkinstab', 'ohne Stab'];
// Weniger verbissgefährdete Baumarten werden nicht automatisch geschützt
const SELTEN_GESCHUETZT = ['Gemeine Fichte', 'Gemeine Kiefer', 'Schwarzkiefer', 'Schwarzerle', 'Sandbirke', 'Aspe', 'Robinie', 'Blaufichte'];
const PREIS_KEY = 'waldwaechter.einzelschutzpreise';
const lies = () => { try { return JSON.parse(localStorage.getItem(PREIS_KEY) || '{}'); } catch { return {}; } };
const merke = (k, v) => { const p = lies(); if (v == null) delete p[k]; else p[k] = v; try { localStorage.setItem(PREIS_KEY, JSON.stringify(p)); } catch { /* egal */ } };
const zahl = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; const t = String(v ?? '').trim().replace(/\s|€/g, ''); if (!t) return null; const n = Number(/,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? n : null; };
const euro = (v) => `${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Förderung je Stück nach Höhe (Richtlinie Teil A und Landesprogramm) */
export function esFoerderung(cm) {
  if (!(cm >= 120)) return null;
  const g = cm >= 180 ? 'gross' : 'klein';
  return { stufe: g === 'gross' ? 'ab 180 cm' : '120–150 cm', GANW: SAETZE.GANW.es[g], LABE: SAETZE.LABE.es[g] };
}

/**
 * @param {{ pflanzung: object, foerdern?: boolean, onSaved?: (id) => void, onAbbruch?: () => void }} o
 *   pflanzung: gebuchte Pflanzungsmaßnahme (mit pflanzplan.arten, flaeche, date, parcelId)
 */
export function openEinzelschutzPlanung({ pflanzung, foerdern = false, onSaved, onAbbruch = null }) {
  const pp = pflanzung.pflanzplan || {};
  const arten = (pp.arten || []).map((a) => ({ name: a.name, gepflanzt: a.stueck, an: !SELTEN_GESCHUETZT.includes(a.name), stueck: a.stueck }));
  if (!arten.some((a) => a.an)) arten.forEach((a) => { a.an = true; });
  const s = { art: SCHUTZ_ARTEN[0].art, material: 'kunststofffrei', hoehe: 120, stab: STAEBE[0], preis: null, date: pflanzung.date ? new Date(pflanzung.date).toISOString().slice(0, 10) : '', note: '' };
  const preisKey = () => `${s.art}|${s.hoehe}|${s.stab}`;
  s.preis = lies()[preisKey()] ?? null;
  let gespeichert = false;
  const body = h('div', { class: 'einzelschutz' });
  const page = openPage('Einzelschutz planen', body, { onClose: () => { if (!gespeichert) onAbbruch?.(); } });

  function rechnen() {
    const stueck = arten.filter((a) => a.an).reduce((x, a) => x + (Number(a.stueck) || 0), 0);
    const kosten = s.preis != null ? s.preis * stueck : null;
    const f = s.material === 'kunststofffrei' && /Drahthose|Wuchshülle/.test(s.art) ? esFoerderung(s.hoehe) : null;
    return { stueck, kosten, f };
  }
  function render() {
    const b = rechnen();
    const A = SCHUTZ_ARTEN.find((x) => x.art === s.art);
    const foerderGrund = !/Drahthose|Wuchshülle/.test(s.art) ? `${s.art} wird nicht als Einzelschutz gefördert – gefördert werden Wuchshüllen und Drahthosen.`
      : s.material !== 'kunststofffrei' ? 'Kunststoffmaterial wird nicht gefördert – nur kunststofffreier Einzelschutz (Holz, Pappe, Metall).'
        : s.hoehe < 120 ? 'Gefördert wird Einzelschutz erst ab 1,20 m Höhe.'
          : s.hoehe > 150 && s.hoehe < 180 ? 'Zwischen 150 und 180 cm wird wie 120–150 cm gefördert.' : null;
    fill(body,
      h('p', { class: 'muted' }, `Aus der Pflanzung übernommen: ${(pp.arten || []).reduce((x, a) => x + a.stueck, 0).toLocaleString('de-DE')} Pflanzen auf ${formatHa(pflanzung.flaeche?.ha || 0)}. Wähle, welche Baumarten wie viele Schützer bekommen.`),
      h('p', { class: 'sheet-label' }, 'Zu schützende Pflanzen'),
      h('ul', { class: 'pflanz-liste' }, arten.map((a) => h('li', {},
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.an, onchange: (e) => { a.an = e.target.checked; render(); } }), h('strong', {}, a.name), h('span', { class: 'muted' }, ` · ${a.gepflanzt.toLocaleString('de-DE')} gepflanzt`)),
        a.an ? h('label', {}, 'Anzahl Einzelschützer', h('input', { type: 'number', min: 0, max: a.gepflanzt, step: 1, value: a.stueck, onchange: (e) => { a.stueck = Math.max(0, Math.min(a.gepflanzt, Math.round(Number(e.target.value) || 0))); render(); } })) : null,
        a.an && a.stueck < a.gepflanzt ? h('small', { class: 'muted' }, `${Math.round((a.stueck / a.gepflanzt) * 100)} % der Pflanzen geschützt – die übrigen bleiben ungeschützt.`) : null))),
      h('div', { class: 'zaun-optionen' },
        h('label', {}, 'Art des Schutzes', h('select', { onchange: (e) => { s.art = e.target.value; const m = SCHUTZ_ARTEN.find((x) => x.art === s.art).material; if (m) s.material = m; s.preis = lies()[preisKey()] ?? null; render(); } },
          SCHUTZ_ARTEN.map((x) => h('option', { selected: x.art === s.art }, x.art)))),
        h('label', {}, 'Material', h('select', { onchange: (e) => { s.material = e.target.value; render(); } },
          [['kunststofffrei', 'kunststofffrei (Holz, Pappe, Metall)'], ['kunststoff', 'Kunststoff']].map(([v, l]) => h('option', { value: v, selected: s.material === v }, l)))),
        h('label', {}, 'Höhe', h('select', { onchange: (e) => { s.hoehe = Number(e.target.value); s.preis = lies()[preisKey()] ?? s.preis; render(); } },
          SCHUTZ_HOEHEN.map(([l, cm]) => h('option', { value: cm, selected: s.hoehe === cm }, l)))),
        h('label', {}, 'Befestigung', h('select', { onchange: (e) => { s.stab = e.target.value; s.preis = lies()[preisKey()] ?? s.preis; render(); } },
          STAEBE.map((x) => h('option', { selected: s.stab === x }, x))))),
      h('p', { class: 'hint' }, A.text),
      h('label', {}, 'Preis je Stück inkl. Stab, netto (€)', h('input', { inputmode: 'decimal', placeholder: 'z. B. 2,50', value: s.preis != null ? s.preis.toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '',
        onchange: (e) => { s.preis = zahl(e.target.value); merke(preisKey(), s.preis); render(); } })),
      h('small', { class: 'muted' }, 'Den Preis aus dem Angebot eintragen – die App merkt ihn sich für diese Art, Höhe und Befestigung.'),
      h('div', { class: 'zaun-summe' }, h('span', {}, `${b.stueck.toLocaleString('de-DE')} Einzelschützer`), h('strong', {}, b.kosten != null ? euro(b.kosten) : 'Preis fehlt')),
      b.f ? h('div', { class: 'lrt-hinweis ok' }, h('strong', {}, `Förderfähig (${b.f.stufe})`),
        h('p', {}, `Richtlinie (Teil A): ${euro(b.f.GANW)} je Stück, zusammen ${euro(b.f.GANW * b.stueck)} · Landesprogramm: ${euro(b.f.LABE)} je Stück, zusammen ${euro(b.f.LABE * b.stueck)}.`),
        foerderGrund ? h('p', { class: 'muted' }, foerderGrund) : null)
        : h('div', { class: 'lrt-hinweis brutzeit' }, h('strong', {}, 'Nicht förderfähig'), h('p', {}, foerderGrund)),
      h('label', {}, 'Geplanter Termin', h('input', { type: 'date', value: s.date, onchange: (e) => { s.date = e.target.value; } })),
      h('label', {}, 'Notiz', h('textarea', { rows: 2, oninput: (e) => { s.note = e.target.value; } }, s.note)),
      h('div', { class: 'q-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => page.close() }, 'Abbrechen'),
        h('button', { type: 'button', class: 'btn btn-primary btn-large', disabled: !b.stueck, onclick: speichern }, 'Einzelschutz buchen')));
  }
  function speichern() {
    const b = rechnen();
    const geschuetzt = arten.filter((a) => a.an && a.stueck > 0);
    const id = uid();
    store.update((st) => st.measures.push({
      id, type: 'einzelschutz', parcelId: pflanzung.parcelId, date: s.date ? new Date(s.date).getTime() : null, status: 'geplant', createdAt: Date.now(), note: s.note.trim(),
      details: { art: s.art, species: geschuetzt.map((a) => a.name).join(', '), count: String(b.stueck), hoehe: SCHUTZ_HOEHEN.find(([, cm]) => cm === s.hoehe)[0], stab: s.stab, preis: s.preis != null ? String(s.preis).replace('.', ',') : '', material: s.material },
      flaeche: pflanzung.flaeche ? { ring: [...pflanzung.flaeche.ring], ha: pflanzung.flaeche.ha } : undefined,
      schutz: { pflanzungId: pflanzung.id, material: s.material, hoeheCm: s.hoehe, arten: geschuetzt.map((a) => ({ name: a.name, stueck: a.stueck })) },
      kosten: b.kosten != null ? Math.round(b.kosten * 100) / 100 : undefined,
    }));
    gespeichert = true;
    toast(`Einzelschutz gebucht: ${b.stueck.toLocaleString('de-DE')} Stück`);
    page.close();
    onSaved?.(id);
  }
  render();
  return page;
}
