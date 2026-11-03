// Reiter 2: Maßnahmen – Übersicht, neue Maßnahme anlegen.
import { h, fill, icon, openPage, confirmDialog, toast, fmtDate } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { CATEGORIES } from './map/basemap.js';
import { areaHa, formatHa } from './geo.js';
import { openThinningWizard } from './thinning/wizard.js';
import { SPECIES } from './thinning/plan.js';
import { WANZE_SVG } from './mascot.js';

export const MEASURE_TYPES = {
  pflanzung:    { label: 'Pflanzung', fields: [['species', 'Baumart', 'species'], ['count', 'Anzahl Pflanzen', 'number'], ['area', 'Fläche (ha)', 'decimal'], ['verband', 'Pflanzverband (z. B. 2 × 1 m)', 'text']] },
  zaunbau:      { label: 'Zaunbau', fields: [['length', 'Zaunlänge (m)', 'number'], ['zaun', 'Zauntyp (z. B. Knotengeflecht 1,60 m)', 'text']] },
  pflege:       { label: 'Pflege', fields: [['art', 'Art der Pflege', ['Jungwuchspflege', 'Jungbestandspflege', 'Freischneiden', 'Wertastung']], ['area', 'Fläche (ha)', 'decimal']] },
  durchforstung:{ label: 'Durchforstung', fields: [] },
  sonstiges:    { label: 'Sonstiges', fields: [['what', 'Was wird gemacht?', 'text'], ['amount', 'Menge / Umfang', 'text']] },
};

const STATUS = { geplant: 'Geplant', arbeit: 'In Arbeit', fertig: 'Abgeschlossen' };

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
  const list = [...store.get().measures].sort((a, b) => b.createdAt - a.createdAt);

  fill(root, 
    h('header', { class: 'view-head' },
      h('h1', {}, 'Aufgaben'),
      h('p', { class: 'muted' }, list.length ? `${list.length} ${list.length === 1 ? 'Maßnahme' : 'Maßnahmen'} gebucht` : 'Plane und dokumentiere Maßnahmen auf deinen Flächen.'),
    ),
    h('button', { class: 'btn btn-primary btn-block btn-large', onclick: () => openNewMeasure() }, h('span', { html: icon.plus }), 'Neue Maßnahme beginnen'),
    list.length
      ? h('ul', { class: 'measure-list' }, list.map((m) => measureCard(m, byId)))
      : h('div', { class: 'empty with-bug' }, h('div', { class: 'empty-bug', html: WANZE_SVG }),
          h('p', {}, 'Noch keine Maßnahmen. Starte mit einer Pflanzung, einem Zaunbau oder der geführten Durchforstung.')),
  );
}

function measureCard(m, byId) {
  const p = byId[m.parcelId];
  const where = m.thinning?.label || (p ? `${p.gemarkung}, Flur ${p.flur}, Flurstück ${p.nr}` : 'Ohne Flächenzuordnung');
  let progress = null, action = null;
  if (m.type === 'durchforstung' && m.thinning?.plan) {
    const pts = m.thinning.plan.points;
    const done = pts.filter((x) => x.status === 'done').length;
    progress = h('div', { class: 'progress' },
      h('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': pts.length, 'aria-valuenow': done }, h('span', { style: `width:${(done / pts.length) * 100}%` })),
      h('span', { class: 'progress-label' }, `${done} von ${pts.length} Rasterpunkten erledigt`),
    );
    action = h('button', { class: `btn ${m.status === 'fertig' ? '' : 'btn-primary'}`, onclick: () => openThinningWizard({ measureId: m.id }) },
      m.status === 'fertig' ? 'Ansehen' : 'Im Bestand fortsetzen');
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
    h('p', { class: 'muted' }, `Termin ${m.date ? fmtDate(m.date) : 'offen'}`),
    details.length ? h('p', { class: 'measure-details' }, details.join('; ')) : null,
    m.thinning?.plan ? h('p', { class: 'measure-details' }, `${formatHa(m.thinning.plan.areaHa)}, ${m.thinning.plan.total} Bäume Entnahme geplant`) : null,
    m.note ? h('p', { class: 'measure-note' }, m.note) : null,
    progress,
    h('div', { class: 'measure-actions' },
      action,
      m.type !== 'durchforstung' && m.status !== 'fertig' ? h('button', { class: 'btn', onclick: () => {
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
          note: String(fd.get('note') || '').trim(), details, status: 'geplant', createdAt: Date.now() });
      });
      page.close();
      toast(`${t.label} gebucht`);
    } },
      h('h2', { class: 'step-title' }, 'Fläche und Angaben'),
      h('label', {}, 'Fläche',
        h('select', { name: 'parcel' },
          h('option', { value: '' }, mine.length ? 'Fläche wählen' : 'Noch keine eigenen Flächen'),
          mine.map((p) => h('option', { value: p.id, selected: p.id === parcelId }, `Flurstück ${p.nr}, ${p.gemarkung} (${CATEGORIES[p.category].label}, ${formatHa(areaHa(byId[p.id].ring))})`)),
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
