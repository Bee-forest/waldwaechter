// „Das steht an“: höchstens drei fällige Punkte auf der Startseite.
// Quellen: Termine der Maßnahmen (überfällig, diese Woche), Verträglichkeits-Vorprüfung in der Brut- und Setzzeit,
// erledigte Maßnahmen ohne Protokoll, Verkehrssicherung, sonst die Aufgabe der Woche aus der Wanzen-Ecke.
import { h, fill, icon } from './ui.js';
import { store } from './store.js';
import { passtEintrag } from './profi.js';

const TAG = 86400000;
const heute0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const wann = (d) => {
  const t = Math.round((new Date(d).setHours(0, 0, 0, 0) - heute0()) / TAG);
  return t < -1 ? `seit ${-t} Tagen fällig` : t === -1 ? 'seit gestern fällig' : t === 0 ? 'heute' : t === 1 ? 'morgen' : `am ${new Date(d).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'numeric' })}`;
};

/** Liste der anstehenden Punkte, wichtigste zuerst */
export async function aufgabenListe() {
  const [{ MEASURE_TYPES, termine }, { vorpruefungNoetig }, { aufgabeDerWoche }] = await Promise.all([import('./measures.js'), import('./schutzgebiete.js'), import('./wanzenecke.js')]);
  const s = store.get();
  const byId = Object.fromEntries((s.parcels || []).map((p) => [p.id, p]));
  const name = (m) => (m.type === 'pflege' && m.details?.art ? m.details.art : MEASURE_TYPES[m.type]?.label || 'Maßnahme');
  const wo = (m) => { const p = byId[m.parcelId]; return m.thinning?.label || (p ? `${p.gemarkung}, Flst. ${p.nr}` : ''); };
  const jetzt = heute0();
  const out = [];
  for (const m of (s.measures || []).filter(passtEintrag)) {
    if (m.serie) {
      for (const t of termine(m, new Date(jetzt.getTime() - 120 * TAG), new Date(jetzt.getTime() + 14 * TAG)).filter((x) => !x.done)) {
        out.push({ prio: t.date < jetzt ? 1 : 3, datum: t.date, art: 'termin', titel: 'Verkehrssicherung', text: `${t.label.split('(')[0].trim()} · ${wann(t.date)}`, id: m.id });
      }
      continue;
    }
    if (m.status !== 'fertig' && vorpruefungNoetig(m)) out.push({ prio: 0, datum: m.date, art: 'warnung', titel: `${name(m)}: Vorprüfung fehlt`, text: `Termin in der Brut- und Setzzeit · ${wo(m)}`, id: m.id });
    else if (m.status !== 'fertig' && m.date && m.date < jetzt.getTime() + 7 * TAG) out.push({ prio: m.date < jetzt.getTime() ? 1 : 2, datum: m.date, art: m.date < jetzt.getTime() ? 'warnung' : 'termin', titel: name(m), text: `${wann(m.date)}${wo(m) ? ` · ${wo(m)}` : ''}`, id: m.id });
    else if (m.status === 'fertig' && !m.protokoll && m.finishedAt > Date.now() - 30 * TAG && !['schaden', 'holzverkauf'].includes(m.type)) out.push({ prio: 4, datum: m.finishedAt, art: 'protokoll', titel: `Protokoll: ${name(m)}`, text: `Schäden und Unternehmer festhalten${wo(m) ? ` · ${wo(m)}` : ''}`, id: m.id });
  }
  out.sort((a, b) => a.prio - b.prio || (a.datum || 0) - (b.datum || 0));
  if (out.length < 3) {
    const a = aufgabeDerWoche();
    out.push({ prio: 9, art: 'wanze', titel: `Aufgabe der Woche: ${a.titel}`, text: 'Mitmachen in der Wanzen-Ecke' });
  }
  return out;
}

/** Streifen für die Startseite (aktualisiert sich bei jeder Änderung) */
export function aufgabenStreifen() {
  const el = h('section', { class: 'aufgaben card', 'aria-label': 'Das steht an' });
  const oeffne = (x) => {
    if (x.art === 'wanze') import('./wanzenecke.js').then((w) => w.openWanzenEcke());
    else window.dispatchEvent(new CustomEvent('ww:massnahme-oeffnen', { detail: x.id }));
  };
  let lauf = 0;
  const zeichne = async () => {
    const n = ++lauf;
    const liste = await aufgabenListe().catch(() => []);
    if (n !== lauf) return;
    const zeigen = liste.slice(0, 3);
    const anzahl = liste.filter((x) => x.art !== 'wanze').length;
    fill(el,
      h('div', { class: 'aufgaben-kopf' }, h('h2', {}, 'Das steht an'),
        h('button', { type: 'button', class: 'link-btn', onclick: () => window.dispatchEvent(new CustomEvent('ww:navigate', { detail: 'massnahmen' })) }, anzahl > 3 ? `Alle ${anzahl} ansehen` : 'Zu den Maßnahmen')),
      h('ul', { class: 'aufgaben-liste' }, zeigen.map((x) => h('li', {},
        h('button', { type: 'button', class: `aufgabe aufgabe-${x.art}`, onclick: () => oeffne(x) },
          h('span', { class: 'aufgabe-punkt', 'aria-hidden': 'true' }),
          h('span', { class: 'aufgabe-text' }, h('strong', {}, x.titel), h('small', {}, x.text)),
          h('span', { class: 'chev', 'aria-hidden': 'true', html: icon.chevron }))))));
  };
  zeichne();
  store.subscribe(zeichne);
  return el;
}
