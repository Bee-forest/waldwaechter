// Reiter 2: Maßnahmen – Übersicht, neue Maßnahme anlegen.
import { h, fill, icon, openPage, confirmDialog, toast, fmtDate } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { CATEGORIES } from './map/basemap.js';
import { formatHa } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { openThinningWizard } from './thinning/wizard.js';
import { SPECIES } from './thinning/plan.js';
import { WANZE_SVG } from './mascot.js';

export const MEASURE_TYPES = {
  pflanzung:    { label: 'Pflanzung', fields: [['species', 'Baumart', 'species'], ['count', 'Anzahl Pflanzen', 'number'], ['area', 'Fläche (ha)', 'decimal'], ['verband', 'Pflanzverband (z. B. 2 × 1 m)', 'text']] },
  zaunbau:      { label: 'Zaunbau', fields: [['length', 'Zaunlänge (m)', 'number'], ['zaun', 'Zauntyp (z. B. Knotengeflecht 1,60 m)', 'text']] },
  pflege:       { label: 'Pflege', fields: [['art', 'Art der Pflege', ['Jungwuchspflege', 'Jungbestandspflege', 'Freischneiden', 'Wertastung']], ['area', 'Fläche (ha)', 'decimal']] },
  durchforstung:{ label: 'Durchforstung', fields: [] },
  verkehrssicherung: { label: 'Verkehrssicherung', fields: [] },
  sonstiges:    { label: 'Sonstiges', fields: [['what', 'Was wird gemacht?', 'text'], ['amount', 'Menge / Umfang', 'text']] },
};

const STATUS = { geplant: 'Geplant', arbeit: 'In Arbeit', fertig: 'Abgeschlossen' };

// ---------- Verkehrssicherung: zweimal im Jahr (unbelaubt und belaubt) ----------
export const VSP_TERMINE = [
  { zustand: 'unbelaubt', label: 'im unbelaubten Zustand', monat: 2, tag: 15 },
  { zustand: 'belaubt', label: 'im belaubten Zustand', monat: 7, tag: 15 },
];
export const hatVerkehrssicherung = (parcelId) => store.get().measures.some((m) => m.type === 'verkehrssicherung' && m.parcelId === parcelId && m.status !== 'fertig');
export function erinnereVerkehrssicherung(p) {
  if (hatVerkehrssicherung(p.id)) return;
  store.update((s) => s.measures.push({
    id: uid(), type: 'verkehrssicherung', parcelId: p.id, date: null, status: 'geplant', createdAt: Date.now(), details: {},
    note: `Waldrand an öffentlicher Verkehrsfläche kontrollieren und Kontrolle schriftlich festhalten.`,
    serie: { termine: VSP_TERMINE.map((t) => ({ ...t })) }, erledigt: {},
    ort: `${p.gemarkung}, Flur ${p.flur}, Flurstück ${p.nr}`,
  }));
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Termine einer Maßnahme im Zeitraum [von, bis) als { date, key, label, done } */
function termine(m, von, bis) {
  if (m.serie) {
    const out = [];
    for (let y = von.getFullYear(); y <= bis.getFullYear(); y++) for (const t of m.serie.termine) {
      const d = new Date(y, t.monat - 1, t.tag);
      if (d >= von && d < bis && d >= new Date(new Date(m.createdAt).setHours(0, 0, 0, 0))) out.push({ date: d, key: `${y}-${t.zustand}`, label: `Kontrolle ${t.label}`, done: !!m.erledigt?.[`${y}-${t.zustand}`] });
    }
    return out;
  }
  if (!m.date) return [];
  const d = new Date(m.date);
  return d >= von && d < bis ? [{ date: d, key: 'einmal', label: MEASURE_TYPES[m.type]?.label || m.type, done: m.status === 'fertig' }] : [];
}
function naechsterTermin(m) {
  const jetzt = new Date(); jetzt.setHours(0, 0, 0, 0);
  const bis = new Date(jetzt.getFullYear() + 2, 0, 1);
  return termine(m, new Date(jetzt.getFullYear() - 1, 0, 1), bis).filter((t) => !t.done).sort((a, b) => a.date - b.date)[0] || null;
}
let monat = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
let tagWahl = null;

let root;

export function initMeasures(el) {
  root = el;
  render();
  store.subscribe(render);
  window.addEventListener('ww:new-measure', (e) => {
    window.dispatchEvent(new CustomEvent('ww:navigate', { detail: 'massnahmen' }));
    openNewMeasure(e.detail || {});
  });
}

async function render() {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const list = [...store.get().measures].sort((a, b) => (a.status === 'fertig') - (b.status === 'fertig') || ((naechsterTermin(a)?.date ?? Infinity) - (naechsterTermin(b)?.date ?? Infinity)) || b.createdAt - a.createdAt);

  fill(root, 
    h('header', { class: 'view-head' },
      h('h1', {}, 'Maßnahmen'),
      h('p', { class: 'muted' }, list.length ? `${list.length} ${list.length === 1 ? 'Maßnahme' : 'Maßnahmen'} gebucht` : 'Plane und dokumentiere Maßnahmen auf deinen Flächen.'),
    ),
    h('button', { class: 'btn btn-primary btn-block btn-large', onclick: () => openNewMeasure() }, h('span', { html: icon.plus }), 'Neue Maßnahme beginnen'),
    kalender(list, byId),
    list.length ? h('h2', { class: 'section-title' }, 'Alle Maßnahmen') : null,
    list.length
      ? h('ul', { class: 'measure-list' }, list.map((m) => measureCard(m, byId)))
      : h('div', { class: 'empty with-bug' }, h('div', { class: 'empty-bug', html: WANZE_SVG }),
          h('p', {}, 'Noch keine Maßnahmen. Starte mit einer Pflanzung, einem Zaunbau oder der geführten Durchforstung.')),
  );
}

// ---------- Maßnahmenplan als Monatskalender ----------
function kalender(list, byId) {
  const von = new Date(monat), bis = new Date(monat.getFullYear(), monat.getMonth() + 1, 1);
  const ev = list.flatMap((m) => termine(m, von, bis).map((t) => ({ ...t, m })));
  const byDay = new Map();
  for (const e of ev) { const k = ymd(e.date); (byDay.get(k) || byDay.set(k, []).get(k)).push(e); }
  const heute = ymd(new Date());
  const start = (von.getDay() + 6) % 7; // Montag = 0
  const tage = new Date(bis - 1).getDate();
  const zellen = [];
  for (let i = 0; i < start; i++) zellen.push(h('span', { class: 'cal-cell empty' }));
  for (let d = 1; d <= tage; d++) {
    const k = ymd(new Date(von.getFullYear(), von.getMonth(), d));
    const es = byDay.get(k) || [];
    zellen.push(h('button', { class: `cal-cell ${k === heute ? 'today' : ''} ${tagWahl === k ? 'sel' : ''} ${es.length ? 'has' : ''}`, 'aria-label': `${d}. ${es.length ? `${es.length} Termin(e)` : 'kein Termin'}`,
      onclick: () => { tagWahl = tagWahl === k ? null : k; render(); } },
      h('span', { class: 'cal-d' }, d),
      es.length ? h('span', { class: 'cal-dots' }, es.slice(0, 3).map((e) => h('i', { class: `dot dot-${e.m.type} ${e.done ? 'done' : ''}` }))) : null));
  }
  const zeigen = tagWahl && tagWahl.startsWith(ymd(von).slice(0, 7)) ? (byDay.get(tagWahl) || []) : ev;
  const titel = monat.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return h('section', { class: 'card calendar', 'aria-label': 'Maßnahmenplan' },
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Vorheriger Monat', onclick: () => { monat = new Date(monat.getFullYear(), monat.getMonth() - 1, 1); tagWahl = null; render(); } }, '‹'),
      h('h2', {}, `Maßnahmenplan ${titel}`),
      h('button', { class: 'icon-btn', 'aria-label': 'Nächster Monat', onclick: () => { monat = new Date(monat.getFullYear(), monat.getMonth() + 1, 1); tagWahl = null; render(); } }, '›')),
    h('div', { class: 'cal-grid' }, ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((t) => h('span', { class: 'cal-wd' }, t)), zellen),
    h('ul', { class: 'cal-list' }, zeigen.length
      ? zeigen.sort((a, b) => a.date - b.date).map((e) => h('li', { class: `cal-item ${e.done ? 'done' : ''}` },
          h('i', { class: `dot dot-${e.m.type}` }),
          h('span', { class: 'cal-date' }, e.date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })),
          h('span', { class: 'cal-text' }, h('strong', {}, e.m.type === 'verkehrssicherung' ? `Verkehrssicherung: ${e.label}` : e.label), h('small', {}, wo(e.m, byId))),
          e.m.serie && !e.done ? h('button', { class: 'btn btn-small', onclick: () => { store.update((s) => { const x = s.measures.find((y) => y.id === e.m.id); x.erledigt = { ...(x.erledigt || {}), [e.key]: Date.now() }; }); toast('Kontrolle als erledigt vermerkt'); } }, 'Erledigt') : null,
          e.done ? h('span', { class: 'badge badge-fertig' }, 'Erledigt') : null))
      : h('li', { class: 'muted' }, tagWahl ? 'An diesem Tag ist nichts geplant.' : 'In diesem Monat ist nichts geplant. Gib deinen Maßnahmen unten ein Datum, dann erscheinen sie hier.')),
  );
}
const wo = (m, byId) => { const p = byId[m.parcelId]; return m.thinning?.label || (p ? `${p.gemarkung}, Flur ${p.flur}, Flurstück ${p.nr}` : m.ort || 'Ohne Flächenzuordnung'); };

function datumFeld(m) {
  return h('label', { class: 'date-field' }, 'Termin',
    h('input', { type: 'date', value: m.date ? ymd(new Date(m.date)) : '', onchange: (e) => {
      const v = e.target.value;
      store.update((s) => { const x = s.measures.find((y) => y.id === m.id); x.date = v ? new Date(`${v}T09:00`).getTime() : null; });
      if (v) { const d = new Date(`${v}T09:00`); monat = new Date(d.getFullYear(), d.getMonth(), 1); }
    } }));
}

function vspFelder(m) {
  const nt = naechsterTermin(m);
  return h('div', { class: 'vsp-termine' },
    h('p', { class: 'muted' }, `Zweimal im Jahr: im unbelaubten und im belaubten Zustand.${nt ? ` Nächste Kontrolle: ${nt.date.toLocaleDateString('de-DE')} (${nt.label.replace('Kontrolle ', '')}).` : ''}`),
    m.serie.termine.map((t, i) => h('label', { class: 'date-field' }, `Kontrolle ${t.label}`,
      h('input', { type: 'date', value: ymd(new Date(new Date().getFullYear(), t.monat - 1, t.tag)), onchange: (e) => {
        const [, mo, ta] = e.target.value.split('-').map(Number);
        if (!mo) return;
        store.update((s) => { const x = s.measures.find((y) => y.id === m.id); x.serie.termine[i] = { ...x.serie.termine[i], monat: mo, tag: ta }; });
      } }))),
  );
}

function measureCard(m, byId) {
  const p = byId[m.parcelId];
  const where = wo(m, byId);
  let progress = null, action = null;
  if (m.type === 'durchforstung' && m.thinning?.plan) {
    const pts = m.thinning.plan.points;
    const done = pts.filter((x) => x.status === 'done').length;
    progress = h('div', { class: 'progress' },
      h('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': pts.length, 'aria-valuenow': done }, h('span', { style: `width:${(done / pts.length) * 100}%` })),
      h('span', { class: 'progress-label' }, `${done} von ${pts.length} Rasterpunkten erledigt`),
    );
    action = h('button', { class: `btn ${m.status === 'fertig' ? '' : 'btn-primary'}`, onclick: () => openThinningWizard({ measureId: m.id }) },
      m.status === 'fertig' ? 'Ansehen' : m.status === 'geplant' ? 'Öffnen' : 'Im Bestand fortsetzen');
  } else if (m.type === 'durchforstung') {
    action = h('button', { class: 'btn btn-primary', onclick: () => openThinningWizard({ measureId: m.id }) }, 'Planung fortsetzen');
  }
  const details = Object.entries(m.details || {}).filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => {
      const f = MEASURE_TYPES[m.type]?.fields.find((x) => x[0] === k);
      return f ? `${f[1].replace(/ \(.*\)/, '')}: ${v}` : null;
    }).filter(Boolean);

  return h('li', { class: `measure measure-${m.status}` },
    h('div', { class: 'measure-top' },
      h('strong', { class: 'measure-type' }, MEASURE_TYPES[m.type]?.label || m.type),
      h('span', { class: `badge badge-${m.status}` }, STATUS[m.status]),
    ),
    h('p', { class: 'measure-where' }, where),
    m.serie ? vspFelder(m) : m.status === 'fertig' ? h('p', { class: 'muted' }, `Termin ${m.date ? fmtDate(m.date) : 'offen'}`) : datumFeld(m),
    details.length ? h('p', { class: 'measure-details' }, details.join('; ')) : null,
    m.thinning?.plan ? h('p', { class: 'measure-details' }, `${m.thinning.plan.eingriffe?.anzahl > 1 ? `Eingriff ${m.thinning.plan.eingriffe.nr} von ${m.thinning.plan.eingriffe.anzahl}, ` : ''}${formatHa(m.thinning.plan.areaHa)}, ${m.thinning.plan.total} Bäume Entnahme geplant`) : null,
    m.note ? h('p', { class: 'measure-note' }, m.note) : null,
    progress,
    h('div', { class: 'measure-actions' },
      action,
      m.type !== 'durchforstung' && !m.serie && m.status !== 'fertig' ? h('button', { class: 'btn', onclick: () => {
        store.update((s) => { const x = s.measures.find((y) => y.id === m.id); x.status = x.status === 'geplant' ? 'arbeit' : 'fertig'; });
      } }, m.status === 'geplant' ? 'Als begonnen markieren' : 'Als erledigt markieren') : null,
      h('button', { class: 'icon-btn danger', 'aria-label': 'Maßnahme löschen', html: icon.trash, onclick: async () => {
        if (await confirmDialog('Möchtest du diese Maßnahme wirklich löschen?', { ok: 'Löschen', danger: true })) {
          store.update((s) => { s.measures = s.measures.filter((x) => x.id !== m.id); });
          toast('Maßnahme gelöscht');
        }
      } }),
    ),
  );
}

async function openNewMeasure({ parcelId } = {}) {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id]);
  const body = h('div', { class: 'new-measure' });
  const page = openPage('Neue Maßnahme', body);

  const typeGrid = h('div', { class: 'type-grid', role: 'radiogroup', 'aria-label': 'Art der Maßnahme' },
    Object.entries(MEASURE_TYPES).map(([k, t]) => h('button', {
      class: `type-tile ${k === 'durchforstung' ? 'type-feature' : ''}`, role: 'radio', 'aria-checked': 'false',
      onclick: () => pickType(k),
    }, h('strong', {}, t.label), k === 'durchforstung' ? h('span', {}, 'Geführt per GPS-Raster') : null)),
  );
  const formHost = h('div');
  body.append(h('h2', { class: 'step-title' }, 'Art der Maßnahme'), typeGrid, formHost);

  function pickType(type) {
    typeGrid.querySelectorAll('.type-tile').forEach((b, i) => b.setAttribute('aria-checked', String(Object.keys(MEASURE_TYPES)[i] === type)));
    if (type === 'durchforstung') {
      fill(formHost, 
        h('div', { class: 'card callout' },
          h('div', { class: 'callout-bug', html: WANZE_SVG }),
          h('div', {},
            h('p', {}, 'Bei der Durchforstung wählst du zuerst den Bestand, gibst die waldbaulichen Daten ein und ich lege ein Raster aus roten Punkten darüber. Im Wald führe ich dich per GPS von Punkt zu Punkt.'),
            h('button', { class: 'btn btn-primary btn-block', onclick: () => { page.close(); openThinningWizard({ parcelId }); } }, 'Durchforstung planen'),
          ),
        ),
      );
      return;
    }
    const t = MEASURE_TYPES[type];
    const form = h('form', { class: 'form', onsubmit: (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const details = Object.fromEntries(t.fields.map(([k]) => [k, String(fd.get(k) || '').trim()]));
      store.update((s) => {
        s.measures.push({ id: uid(), type, parcelId: fd.get('parcel') || null, date: fd.get('date') ? new Date(fd.get('date')).getTime() : null,
          note: String(fd.get('note') || '').trim(), details, status: 'geplant', createdAt: Date.now(),
          ...(type === 'verkehrssicherung' ? { date: null, serie: { termine: VSP_TERMINE.map((t) => ({ ...t })) }, erledigt: {} } : {}) });
      });
      page.close();
      toast(`${t.label} gebucht`);
    } },
      h('h2', { class: 'step-title' }, 'Fläche und Angaben'),
      h('label', {}, 'Fläche',
        h('select', { name: 'parcel' },
          h('option', { value: '' }, mine.length ? 'Fläche wählen' : 'Noch keine eigenen Flächen'),
          mine.map((p) => h('option', { value: p.id, selected: p.id === parcelId }, `Flurstück ${p.nr}, ${p.gemarkung} (${CATEGORIES[p.category].label}, ${formatHa(amtlicheFlaecheHa(byId[p.id]))})`)),
        )),
      t.fields.map(([k, label, kind]) => h('label', {}, label,
        Array.isArray(kind) ? h('select', { name: k }, kind.map((o) => h('option', {}, o)))
          : kind === 'species' ? h('select', { name: k }, SPECIES.map((o) => h('option', {}, o)))
          : h('input', { name: k, type: kind === 'number' ? 'number' : 'text', inputmode: kind === 'decimal' ? 'decimal' : kind === 'number' ? 'numeric' : null, min: kind === 'number' ? 0 : null }))),
      h('label', {}, 'Geplanter Termin', h('input', { type: 'date', name: 'date' })),
      h('label', {}, 'Notiz', h('textarea', { name: 'note', rows: 3 })),
      h('button', { class: 'btn btn-primary btn-block btn-large', type: 'submit' }, `${t.label} buchen`),
    );
    fill(formHost, form);
    form.querySelector('select, input')?.focus();
  }
}
