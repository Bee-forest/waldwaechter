// Reiter 2: Maßnahmen – Übersicht, neue Maßnahme anlegen.
import { h, fill, icon, openPage, confirmDialog, toast, fmtDate, dialog } from './ui.js';
import { inBrutzeit, nachBrutzeit, schutzzeitVon, schutzzeitText, datumText } from './schutzgebiete.js';
import { openVertraeglichkeit, openVerlauf, protokoll } from './vertraeglichkeit.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { CATEGORIES } from './map/basemap.js';
import { formatHa } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { openThinningWizard } from './thinning/wizard.js';
import { SPECIES } from './thinning/plan.js';
import { WANZE_SVG } from './mascot.js';
import { flaechenWahl } from './flaeche.js';
import { openFlurstueckHistorie } from './historie.js';
import { openPolterVermessung } from './polter.js';

export const MEASURE_TYPES = {
  pflanzung:    { label: 'Pflanzung', fields: [['species', 'Baumart', 'species'], ['count', 'Anzahl Pflanzen', 'number'], ['area', 'Fläche (ha)', 'decimal'], ['verband', 'Pflanzverband (z. B. 2 × 1 m)', 'text']] },
  zaunbau:      { label: 'Zaunbau', fields: [['length', 'Zaunlänge (m)', 'number'], ['zaun', 'Zauntyp (z. B. Knotengeflecht 1,60 m)', 'text']] },
  pflege:       { label: 'Pflege', fields: [['art', 'Art der Pflege', ['Jungwuchspflege', 'Jungbestandspflege', 'Freischneiden', 'Wertastung']], ['area', 'Fläche (ha)', 'decimal']] },
  durchforstung:{ label: 'Durchforstung mit GPS', gruppe: 'holzernte', info: 'Geführt per GPS-Raster', fields: [] },
  holzernte_df: { label: 'Durchforstung', gruppe: 'holzernte', info: 'Ohne GPS-Raster dokumentieren', fields: [['verfahren', 'Verfahren', ['motormanuell', 'Harvester', 'Harvester und motormanuell', 'Seilkran', 'Rückepferd']], ['species', 'Hauptbaumart', 'species'], ['baeume', 'Anzahl entnommener Bäume', 'number'], ['menge', 'Entnahmemenge (Fm)', 'decimal'], ['area', 'Fläche (ha)', 'decimal']] },
  polter:       { label: 'Poltervermessung', gruppe: 'holzernte', info: 'Schritt für Schritt nach RVR: Sortiment, Messverfahren, Volumen', fields: [['polterNr', 'Polter-Nr.', 'text'], ['species', 'Baumart', 'species'], ['sortiment', 'Sortiment', 'text'], ['verfahren', 'Messverfahren', 'text'], ['laenge', 'Poltertiefe (m)', 'text'], ['stueck', 'Anzahl Stämme', 'text'], ['rm', 'Raummaß netto (Rm m.R.)', 'text'], ['red', 'Reduktionsfaktor', 'text'], ['faktor', 'Umrechnungsfaktor', 'text'], ['fm', 'Holzmenge (Fm o.R.)', 'text'], ['pos', 'Standort des Polters', 'text']] },
  verkehrssicherung: { label: 'Verkehrssicherung', fields: [] },
  sonstiges:    { label: 'Sonstiges', fields: [['what', 'Was wird gemacht?', 'text'], ['amount', 'Menge / Umfang', 'text']] },
};

const STATUS = { geplant: 'Geplant', arbeit: 'In Arbeit', fertig: 'Abgeschlossen' };

// ---------- Verkehrssicherung: zweimal im Jahr (unbelaubt und belaubt) ----------
// Einmal in der Vegetationsperiode (belaubt, Mai–September) und einmal im unbelaubten Zustand
// (November–März, über den Jahreswechsel). Der Tag innerhalb des Zeitraums ist frei wählbar.
export const VSP_TERMINE = [
  { zustand: 'unbelaubt', label: 'im unbelaubten Zustand', zeitraum: 'November bis März', monate: [11, 12, 1, 2, 3], monat: 1, tag: 15 },
  { zustand: 'belaubt', label: 'in der Vegetationsperiode (belaubt)', zeitraum: 'Mai bis September', monate: [5, 6, 7, 8, 9], monat: 7, tag: 15 },
];
const vspDef = (z) => VSP_TERMINE.find((t) => t.zustand === z);
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
    const ab = new Date(new Date(m.createdAt).setHours(0, 0, 0, 0));
    for (let y = von.getFullYear() - 1; y <= bis.getFullYear(); y++) for (const t of m.serie.termine) {
      const d = new Date(y, t.monat - 1, t.tag);
      if (d < von || d >= bis) continue;
      // Winterhalbjahr läuft über den Jahreswechsel: November–Dezember gehören zum Winter y/y+1, Januar–März zum Winter y−1/y
      const winter = t.monat >= 11 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`;
      const key = t.zustand === 'unbelaubt' ? `winter-${winter}` : `sommer-${y}`;
      const ende = t.zustand === 'unbelaubt' ? new Date(t.monat >= 11 ? y + 1 : y, 2, 31) : new Date(y, 8, 30);
      if (ende < ab) continue; // Zeitraum vor dem Anlegen der Erinnerung
      const def = vspDef(t.zustand) || t;
      out.push({ date: d, key, done: !!m.erledigt?.[key],
        label: t.zustand === 'unbelaubt' ? `Kontrolle im unbelaubten Zustand (Winter ${winter}, bis 31.03.)` : `Kontrolle in der Vegetationsperiode (Sommer ${y}, bis 30.09.)`, zeitraum: def.zeitraum });
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
    h('button', { class: 'btn btn-block historie-btn', onclick: () => openFlurstueckHistorie() }, h('span', { html: icon.map || icon.list || '' }), 'Flurstückhistorie'),
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
    h('input', { type: 'date', value: m.date ? ymd(new Date(m.date)) : '', onchange: async (e) => {
      const v = e.target.value;
      let ts = v ? new Date(`${v}T09:00`).getTime() : null;
      const natura = m.thinning?.natura2000 || [];
      const szm = schutzzeitVon(m);
      if (ts && m.type === 'durchforstung' && natura.length && inBrutzeit(ts, szm) && !m.anhaenge?.some((a) => a.typ === 'vertraeglichkeit')) {
        const w = await dialog({
          title: 'Termin in der Brut- und Setzzeit',
          body: h('div', {}, h('p', {}, `Die Fläche liegt im ${natura.map((g) => `${g.art} „${g.name || 'ohne Namen'}“`).join(', ')}. Der Termin fällt in die Brut- und Setzzeit (${schutzzeitText(szm)}).`),
            h('p', {}, 'Lege den Einschlag am besten außerhalb dieser Zeit. Ist das nicht zu umgehen, ist eine Verträglichkeits-Vorprüfung nötig.')),
          actions: [{ label: `Auf ${datumText(nachBrutzeit(ts, szm))} verschieben`, value: 'verschieben' }, { label: 'Termin behalten – Vorprüfung ausfüllen', value: 'pruefung', primary: true }],
        });
        if (w === 'verschieben') ts = nachBrutzeit(ts, szm);
        else if (w === 'pruefung') setTimeout(() => openVertraeglichkeit(m.id), 50);
        else { e.target.value = m.date ? ymd(new Date(m.date)) : ''; return; }
      }
      store.update((s) => { const x = s.measures.find((y) => y.id === m.id); x.date = ts; });
      protokoll(m.id, ts ? `Termin auf ${new Date(ts).toLocaleDateString('de-DE')} gelegt` : 'Termin entfernt');
      if (ts) { const d = new Date(ts); monat = new Date(d.getFullYear(), d.getMonth(), 1); }
    } }));
}

function vspFelder(m) {
  const nt = naechsterTermin(m);
  return h('div', { class: 'vsp-termine' },
    h('p', { class: 'muted' }, `Einmal in der Vegetationsperiode (Mai–September) und einmal im unbelaubten Zustand (November–März, über den Jahreswechsel).${nt ? ` Nächste Kontrolle: ${nt.date.toLocaleDateString('de-DE')} – ${nt.label.replace('Kontrolle ', '')}.` : ''}`),
    m.serie.termine.map((t, i) => {
      const def = vspDef(t.zustand) || t;
      return h('label', { class: 'date-field' }, `Kontrolle ${def.label} – geplanter Tag (${def.zeitraum})`,
        h('input', { type: 'date', value: ymd(new Date(new Date().getFullYear(), t.monat - 1, t.tag)), onchange: (e) => {
          const [, mo, ta] = e.target.value.split('-').map(Number);
          if (!mo) return;
          if (def.monate && !def.monate.includes(mo)) { toast(`Bitte einen Tag zwischen ${def.zeitraum} wählen.`); e.target.value = ymd(new Date(new Date().getFullYear(), t.monat - 1, t.tag)); return; }
          store.update((s) => { const x = s.measures.find((y) => y.id === m.id); x.serie.termine[i] = { ...x.serie.termine[i], monat: mo, tag: ta }; });
        } }));
    }),
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
      const einheit = f && /\(([^)]{1,8})\)$/.exec(f[1])?.[1];
      return f ? `${f[1].replace(/ \(.*\)/, '')}: ${v}${einheit && !/je /.test(einheit) ? ` ${einheit}` : ''}` : null;
    }).filter(Boolean);

  return h('li', { class: `measure measure-${m.status}` },
    h('div', { class: 'measure-top' },
      h('strong', { class: 'measure-type' }, MEASURE_TYPES[m.type]?.label || m.type),
      h('span', { class: `badge badge-${m.status}` }, STATUS[m.status]),
    ),
    h('p', { class: 'measure-where' }, where),
    m.serie ? vspFelder(m) : m.status === 'fertig' ? h('p', { class: 'muted' }, `Termin ${m.date ? fmtDate(m.date) : 'offen'}`) : datumFeld(m),
    details.length ? h('p', { class: 'measure-details' }, details.join('; ')) : null,
    m.flaeche?.ring ? h('p', { class: 'measure-details' }, `Teilfläche ${formatHa(m.flaeche.ha)}`) : null,
    m.kosten ? h('p', { class: 'measure-details' }, `Kosten: ${Number(m.kosten).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`) : null,
    m.thinning?.plan ? h('p', { class: 'measure-details' }, `${m.thinning.plan.eingriffe?.anzahl > 1 ? `Eingriff ${m.thinning.plan.eingriffe.nr} von ${m.thinning.plan.eingriffe.anzahl}, ` : ''}${formatHa(m.thinning.plan.areaHa)}, ${m.thinning.plan.total} Bäume Entnahme geplant`) : null,
    m.note ? h('p', { class: 'measure-note' }, m.note) : null,
    progress,
    m.type === 'durchforstung' && m.thinning?.natura2000?.length && m.date && inBrutzeit(m.date, schutzzeitVon(m)) && !m.anhaenge?.some((a) => a.typ === 'vertraeglichkeit')
      ? h('p', { class: 'warn-line' }, `Termin in der Brut- und Setzzeit (${schutzzeitText(schutzzeitVon(m))}, Schutzgebiet) – verschieben oder Verträglichkeits-Vorprüfung ausfüllen.`) : null,
    h('div', { class: 'measure-actions' },
      action,
      h('button', { class: 'btn', onclick: () => openVerlauf(m.id) }, m.anhaenge?.length ? `Verlauf · ${m.anhaenge.length} Anhang${m.anhaenge.length > 1 ? 'e' : ''}` : 'Verlauf'),
      m.type !== 'durchforstung' && !m.serie && m.status !== 'fertig' ? h('button', { class: 'btn', onclick: () => {
        store.update((s) => { const x = s.measures.find((y) => y.id === m.id); x.status = x.status === 'geplant' ? 'arbeit' : 'fertig'; if (x.status === 'fertig') x.finishedAt = Date.now(); });
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
  const seiten = []; // geöffnete Seiten – nach dem Speichern alle schließen
  const neueSeite = (titel, inhalt) => { const pg = openPage(titel, inhalt, { onClose: () => { const k = seiten.indexOf(pg); if (k >= 0) seiten.splice(k, 1); } }); seiten.push(pg); return pg; };
  const alleSchliessen = () => [...seiten].reverse().forEach((pg) => pg.close());
  const kachel = (label, info, onclick, feature = false) => h('button', { class: `type-tile ${feature ? 'type-feature' : ''}`, onclick }, h('strong', {}, label), info ? h('span', {}, info) : null);

  // Seite 1: Art der Maßnahme (Holzernte fasst Durchforstung mit GPS, Durchforstung und Poltervermessung zusammen)
  neueSeite('Neue Maßnahme', h('div', { class: 'new-measure' },
    h('h2', { class: 'step-title' }, 'Art der Maßnahme'),
    h('div', { class: 'type-grid' },
      kachel('Holzernte', 'Durchforstung mit GPS, Durchforstung, Poltervermessung', holzernteSeite, true),
      Object.entries(MEASURE_TYPES).filter(([, t]) => t.gruppe !== 'holzernte').map(([k, t]) => kachel(t.label, null, () => formularSeite(k))))));

  // Seite 2: Holzernte
  function holzernteSeite() {
    neueSeite('Holzernte', h('div', { class: 'new-measure' },
      h('h2', { class: 'step-title' }, 'Welche Holzernte?'),
      h('div', { class: 'type-grid einspaltig' },
        Object.entries(MEASURE_TYPES).filter(([, t]) => t.gruppe === 'holzernte').map(([k, t]) => kachel(t.label, t.info, () => {
          if (k === 'durchforstung') { alleSchliessen(); openThinningWizard({ parcelId }); return; }
          if (k === 'polter') { openPolterVermessung({ parcelId, onSaved: alleSchliessen }); return; }
          formularSeite(k);
        }, k === 'durchforstung')))));
  }

  // Seite 3: Eingabe der Maßnahme
  function formularSeite(type) {
    const t = MEASURE_TYPES[type];
    const flHost = h('div', { class: 'flaeche-host' });
    let wahl = null;
    const zeigeWahl = (id) => { wahl?.entferne(); wahl = null; flHost.replaceChildren(); if (id && byId[id]) { wahl = flaechenWahl(byId[id]); flHost.append(wahl.el); } };
    const form = h('form', { class: 'form', onsubmit: (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const fl = wahl ? wahl.wert() : null;
      if (wahl && !fl) { toast('Bitte mindestens 3 Eckpunkte der Teilfläche einzeichnen.'); return; }
      const kosten = String(fd.get('kosten') || '').trim();
      const details = Object.fromEntries(t.fields.map(([k]) => [k, String(fd.get(k) || '').trim()]));
      store.update((s) => {
        s.measures.push({ id: uid(), type, parcelId: fd.get('parcel') || null, date: fd.get('date') ? new Date(fd.get('date')).getTime() : null,
          note: String(fd.get('note') || '').trim(), details, status: 'geplant', createdAt: Date.now(),
          ...(fl?.modus === 'teil' ? { flaeche: { ring: fl.ring, ha: fl.ha } } : {}), kosten: kosten ? Number(kosten.replace(',', '.')) : null,
          ...(type === 'verkehrssicherung' ? { date: null, serie: { termine: VSP_TERMINE.map((x) => ({ ...x })) }, erledigt: {} } : {}) });
      });
      alleSchliessen();
      toast(`${t.label} gebucht`);
    } },
      h('h2', { class: 'step-title' }, 'Fläche und Angaben'),
      h('label', {}, 'Fläche',
        h('select', { name: 'parcel', onchange: (e) => zeigeWahl(e.target.value) },
          h('option', { value: '' }, mine.length ? 'Fläche wählen' : 'Noch keine eigenen Flächen'),
          mine.map((p) => h('option', { value: p.id, selected: p.id === parcelId }, `Flurstück ${p.nr}, ${p.gemarkung} (${CATEGORIES[p.category].label}, ${formatHa(amtlicheFlaecheHa(byId[p.id]))})`)),
        )),
      flHost,
      t.fields.map(([k, label, kind]) => h('label', {}, label,
        Array.isArray(kind) ? h('select', { name: k }, kind.map((o) => h('option', {}, o)))
          : kind === 'species' ? h('select', { name: k }, SPECIES.map((o) => h('option', {}, o)))
          : h('input', { name: k, type: kind === 'number' ? 'number' : 'text', inputmode: kind === 'decimal' ? 'decimal' : kind === 'number' ? 'numeric' : null, min: kind === 'number' ? 0 : null }))),
      h('label', {}, 'Geplanter Termin', h('input', { type: 'date', name: 'date' })),
      h('label', {}, 'Kosten (€, optional)', h('input', { name: 'kosten', type: 'number', inputmode: 'decimal', min: 0, step: '0.01' })),
      h('label', {}, 'Notiz', h('textarea', { name: 'note', rows: 3 })),
      h('button', { class: 'btn btn-primary btn-block btn-large', type: 'submit' }, `${t.label} buchen`),
    );
    neueSeite(t.label, h('div', { class: 'new-measure' }, form));
    if (parcelId) zeigeWahl(parcelId);
  }
}
