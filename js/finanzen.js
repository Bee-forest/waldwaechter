// Reiter 3: Finanzen – Einnahmen und Ausgaben je Bereich (Wald, Landwirtschaft, Gewässer, Gebäude),
// Belege, Übersicht über den aktuellen Stand und eine einfache Finanzplanung für den Wald:
// Wer Holz verkauft, legt einen Teil des Erlöses für Pflanzung, Pflege und Schutz zurück.
import { h, fill, icon, openPage, dialog, confirmDialog, toast, fmtDate } from './ui.js';
import { store, uid } from './store.js';
import { CATEGORIES } from './map/basemap.js';
import { kopfInhalt, parcelTitle } from './home.js';
import { dateiSpeichern, dateiLaden, dateiLoeschen } from './dateien.js';
import { MEASURE_TYPES } from './measures.js';
import { WANZE_SVG } from './mascot.js';

export const euro = (v) => `${Number(v || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const euroKurz = (v) => `${Math.round(Number(v || 0)).toLocaleString('de-DE')} €`;

// ---------- Bereiche und Kategorien ----------
export const BEREICHE = {
  Wald: { label: 'Wald', farbe: CATEGORIES.Wald.color },
  Landwirtschaft: { label: 'Landwirtschaft', farbe: CATEGORIES.Landwirtschaft.color },
  Gewässer: { label: 'Gewässer', farbe: CATEGORIES.Gewässer.color },
  Gebäude: { label: 'Gebäude', farbe: CATEGORIES.Gebäude.color },
};

// invest: zählt in der Finanzplanung als Investition zurück in den Wald
export const KATEGORIEN = {
  Wald: {
    ausgabe: [
      { k: 'pflanzung', l: 'Pflanzung', invest: true },
      { k: 'pflege', l: 'Kultur- und Jungwaldpflege', invest: true },
      { k: 'wildschutz', l: 'Wildschutz (Zaun, Einzelschutz)', invest: true },
      { k: 'waldschutz', l: 'Waldschutz (z. B. Borkenkäfer)', invest: true },
      { k: 'holzernte', l: 'Holzernte und Rückung' },
      { k: 'wege', l: 'Wegebau und Wegepflege', invest: true },
      { k: 'vsp', l: 'Verkehrssicherung' },
      { k: 'bg', l: 'Berufsgenossenschaft (SVLFG)' },
      { k: 'fbg', l: 'FBG-Beitrag und Betreuung' },
      { k: 'grundsteuer', l: 'Grundsteuer' },
      { k: 'versicherung', l: 'Versicherung' },
      { k: 'sonstiges', l: 'Sonstiges' },
    ],
    einnahme: [
      { k: 'holzerloes', l: 'Holzerlös' },
      { k: 'foerderung', l: 'Fördermittel' },
      { k: 'jagd', l: 'Jagdpacht und Wildschadensersatz' },
      { k: 'sonstiges', l: 'Sonstiges' },
    ],
  },
  Landwirtschaft: {
    ausgabe: [{ k: 'bewirtschaftung', l: 'Bewirtschaftung' }, { k: 'bg', l: 'Berufsgenossenschaft (SVLFG)' }, { k: 'grundsteuer', l: 'Grundsteuer' }, { k: 'versicherung', l: 'Versicherung' }, { k: 'sonstiges', l: 'Sonstiges' }],
    einnahme: [{ k: 'pacht', l: 'Pacht' }, { k: 'agrarfoerderung', l: 'Agrarförderung' }, { k: 'sonstiges', l: 'Sonstiges' }],
  },
  Gewässer: {
    ausgabe: [{ k: 'unterhaltung', l: 'Gewässerunterhaltung (Verbandsbeitrag)' }, { k: 'grundsteuer', l: 'Grundsteuer' }, { k: 'sonstiges', l: 'Sonstiges' }],
    einnahme: [{ k: 'fischerei', l: 'Fischereipacht' }, { k: 'sonstiges', l: 'Sonstiges' }],
  },
  Gebäude: {
    ausgabe: [{ k: 'instandhaltung', l: 'Instandhaltung und Reparatur' }, { k: 'nebenkosten', l: 'Nebenkosten' }, { k: 'versicherung', l: 'Versicherung' }, { k: 'grundsteuer', l: 'Grundsteuer' }, { k: 'sonstiges', l: 'Sonstiges' }],
    einnahme: [{ k: 'miete', l: 'Miete und Pacht' }, { k: 'sonstiges', l: 'Sonstiges' }],
  },
};
const katDef = (b) => KATEGORIEN[b.bereich]?.[b.art]?.find((x) => x.k === b.kat);
export const katLabel = (b) => katDef(b)?.l || 'Sonstiges';

// Maßnahme → Ausgabenkategorie im Wald
const MASSNAHME_KAT = { pflanzung: 'pflanzung', zaunbau: 'wildschutz', einzelschutz: 'wildschutz', pflege: 'pflege', durchforstung: 'holzernte', holzernte_df: 'holzernte', polter: 'holzernte', verkehrssicherung: 'vsp', sonstiges: 'sonstiges' };

// ---------- Daten ----------
const fin = () => store.get().finanzen || { buchungen: [], quote: 25 };
const buchungen = () => fin().buchungen || [];
const heute = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const jahrVon = (b) => Number(String(b.datum || '').slice(0, 4)) || new Date(b.createdAt || Date.now()).getFullYear();
const datumText = (iso) => (iso ? fmtDate(new Date(`${iso}T12:00:00`)) : '');
const zahl = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const t = String(v ?? '').trim().replace(/\s|€/g, '');
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : 0;
};
const mitVz = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + euro(Math.abs(v));
const vorzeichen = (b) => (b.art === 'einnahme' ? 1 : -1) * (Number(b.betrag) || 0);
function summen(liste) {
  let ein = 0, aus = 0;
  for (const b of liste) (b.art === 'einnahme' ? (ein += Number(b.betrag) || 0) : (aus += Number(b.betrag) || 0));
  return { ein, aus, saldo: ein - aus };
}
function speichereFin(fn) {
  store.update((s) => { s.finanzen = s.finanzen || { buchungen: [], quote: 25 }; s.finanzen.buchungen = s.finanzen.buchungen || []; fn(s.finanzen); });
}
const meineFlaechen = () => store.get().parcels || [];
const flaecheVon = (id) => meineFlaechen().find((p) => p.id === id);
const bereichVonFlaeche = (p) => (p && BEREICHE[p.category] ? p.category : 'Wald');

// ---------- Finanzplanung (Waldrücklage) ----------
/** Rücklage aus Holzerlösen: quote % jedes Holzerlöses sollen zurück in den Wald fließen. */
export function waldPlanung() {
  const q = Math.max(0, Math.min(100, Number(fin().quote ?? 25))) / 100;
  const wald = buchungen().filter((b) => b.bereich === 'Wald');
  const erloese = wald.filter((b) => b.art === 'einnahme' && b.kat === 'holzerloes');
  if (!erloese.length) return { q, erloes: 0, soll: 0, invest: 0, offen: 0, ab: null };
  const ab = erloese.map((b) => b.datum || heute()).sort()[0];
  const erloes = erloese.reduce((s, b) => s + (Number(b.betrag) || 0), 0);
  const invest = wald.filter((b) => b.art === 'ausgabe' && katDef(b)?.invest && (b.datum || '') >= ab).reduce((s, b) => s + (Number(b.betrag) || 0), 0);
  const soll = erloes * q;
  return { q, erloes, soll, invest, offen: Math.max(0, soll - invest), ab };
}
const geplanteWaldkosten = () => (store.get().measures || []).filter((m) => m.status !== 'fertig' && Number(m.kosten) > 0 && ['pflanzung', 'pflege', 'zaunbau', 'einzelschutz'].includes(m.type));
const holzernteOhneErloes = () => (store.get().measures || []).filter((m) => ['durchforstung', 'holzernte_df', 'polter'].includes(m.type) && m.status === 'fertig'
  && !buchungen().some((b) => b.measureId === m.id && b.art === 'einnahme'));
const massnahmenMitKosten = () => (store.get().measures || []).filter((m) => m.status === 'fertig' && Number(m.kosten) > 0 && !buchungen().some((b) => b.measureId === m.id && b.art === 'ausgabe'));

function neueMassnahme(typ) {
  window.dispatchEvent(new CustomEvent('ww:new-measure', { detail: { typ } }));
}

/** Hinweis nach einem gebuchten Holzerlös: Teil des Erlöses in den Wald investieren. */
async function reinvestHinweis(betrag) {
  const q = Number(fin().quote ?? 25);
  const p = waldPlanung();
  const w = await dialog({
    title: 'Denk an die nächste Waldgeneration',
    mascot: true,
    body: h('div', { class: 'fin-hinweis' },
      h('p', {}, `Du hast ${euro(betrag)} Holzerlös gebucht. Wenn du ${q} % davon zurücklegst, sind das `, h('strong', {}, euro(betrag * q / 100)), ' für deinen Wald.'),
      p.offen > 0 ? h('p', {}, 'Offen in deiner Waldrücklage: ', h('strong', {}, euro(p.offen)), '.') : null,
      h('p', { class: 'muted' }, 'Wo Holz geerntet wurde, braucht der Wald danach oft Pflege: Jungwuchs freistellen, Lücken bepflanzen, Pflanzen gegen Wild schützen. Prüfe auch, ob die Maßnahme gefördert werden kann.')),
    actions: [
      { label: 'Jungwaldpflege planen', value: 'pflege', primary: true },
      { label: 'Pflanzung planen', value: 'pflanzung' },
      { label: 'Später', value: null },
    ],
  });
  if (w) neueMassnahme(w);
}

// ---------- Ansicht ----------
let root;
let jahr = 'alle';

export function initFinanzen(el) {
  root = el;
  render();
  store.subscribe(render);
}

function jahre() {
  const js = new Set(buchungen().map(jahrVon));
  js.add(new Date().getFullYear());
  return [...js].sort((a, b) => b - a);
}
const imJahr = (liste) => (jahr === 'alle' ? liste : liste.filter((b) => jahrVon(b) === Number(jahr)));

function balken(teile, gesamt) {
  return h('ul', { class: 'fin-balken' }, teile.map((t) => h('li', {},
    h('div', { class: 'fin-balken-kopf' }, h('span', {}, t.l), h('strong', {}, euro(t.v))),
    h('div', { class: 'fin-balken-spur' }, h('span', { style: `width:${gesamt ? Math.max(2, Math.round((t.v / gesamt) * 100)) : 0}%;background:${t.farbe || 'var(--primary)'}` })))));
}
function aufteilung(liste, art, bereich) {
  const m = new Map();
  for (const b of liste.filter((x) => x.art === art && (!bereich || x.bereich === bereich))) {
    const l = katLabel(b);
    m.set(l, (m.get(l) || 0) + (Number(b.betrag) || 0));
  }
  return [...m.entries()].map(([l, v]) => ({ l, v })).sort((a, b) => b.v - a.v);
}

function render() {
  const alle = imJahr(buchungen());
  const g = summen(alle);
  const jahrWahl = h('select', { class: 'fin-jahr', 'aria-label': 'Zeitraum', onchange: (e) => { jahr = e.target.value; render(); } },
    h('option', { value: 'alle', selected: jahr === 'alle' }, 'Alle Jahre'),
    jahre().map((j) => h('option', { value: String(j), selected: String(jahr) === String(j) }, String(j))));

  fill(root,
    h('header', { class: 'card app-head' }, kopfInhalt()),
    h('section', { class: 'kachel fin-stand' },
      h('div', { class: 'fin-stand-kopf' }, h('h1', {}, 'Finanzen'), jahrWahl),
      h('p', { class: 'muted fin-stand-label' }, jahr === 'alle' ? 'Aktueller Stand über alle Flächen' : `Stand ${jahr} über alle Flächen`),
      h('div', { class: `fin-saldo ${g.saldo < 0 ? 'neg' : 'pos'}` }, mitVz(g.saldo)),
      h('div', { class: 'fin-ein-aus' },
        h('div', {}, h('span', { class: 'muted' }, 'Einnahmen'), h('strong', { class: 'pos' }, euro(g.ein))),
        h('div', {}, h('span', { class: 'muted' }, 'Ausgaben'), h('strong', { class: 'neg' }, euro(g.aus)))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', onclick: () => openBuchung({ art: 'ausgabe' }) }, h('span', { html: icon.plus }), 'Rechnung'),
        h('button', { class: 'btn', onclick: () => openBuchung({ art: 'einnahme' }) }, h('span', { html: icon.plus }), 'Einnahme / Gutschrift'))),
    planungKachel(),
    h('section', { class: 'kachel' },
      h('h2', { class: 'kachel-titel' }, 'Nach Bereichen'),
      h('div', { class: 'fin-bereiche' }, Object.entries(BEREICHE).map(([k, b]) => {
        const s = summen(alle.filter((x) => x.bereich === k));
        const n = alle.filter((x) => x.bereich === k).length;
        return h('button', { class: 'fin-bereich', style: `--farbe:${b.farbe}`, onclick: () => openBereich(k) },
          h('span', { class: 'fin-bereich-name' }, h('span', { class: 'chip-dot', style: `--chip:${b.farbe}` }), b.label),
          h('strong', { class: s.saldo < 0 ? 'neg' : s.saldo > 0 ? 'pos' : '' }, (s.saldo > 0 ? '+' : s.saldo < 0 ? '−' : '') + euroKurz(Math.abs(s.saldo))),
          h('small', { class: 'muted' }, n ? `${n} Buchung${n === 1 ? '' : 'en'}` : 'noch leer'),
          h('span', { class: 'fin-pfeil', html: icon.chevron }));
      }))),
    waldKachel(alle),
    uebernahmeKachel(),
    h('section', { class: 'kachel' },
      h('h2', { class: 'kachel-titel' }, 'Letzte Buchungen'),
      alle.length ? buchungsListe(alle.slice().sort(nachDatum).slice(0, 8)) : leer(),
      alle.length > 8 ? h('button', { class: 'btn btn-block', onclick: () => openAlle() }, `Alle ${alle.length} Buchungen`) : null,
      buchungen().length ? h('button', { class: 'btn btn-block', onclick: exportCsv }, h('span', { html: icon.download }), 'Als Tabelle exportieren (CSV)') : null),
  );
}
const nachDatum = (a, b) => String(b.datum || '').localeCompare(String(a.datum || '')) || (b.createdAt || 0) - (a.createdAt || 0);
const leer = () => h('div', { class: 'empty with-bug' }, h('div', { class: 'empty-bug', html: WANZE_SVG }),
  h('p', {}, 'Noch keine Buchungen. Trag deine erste Rechnung oder einen Holzerlös ein – dann siehst du hier, wo dein Geld hingeht und woher es kommt.'));

function waldKachel(alle) {
  const wald = alle.filter((b) => b.bereich === 'Wald');
  if (!wald.length) return null;
  const aus = aufteilung(wald, 'ausgabe'), ein = aufteilung(wald, 'einnahme');
  const s = summen(wald);
  return h('section', { class: 'kachel' },
    h('h2', { class: 'kachel-titel' }, 'Wald im Detail'),
    ein.length ? [h('h3', { class: 'fin-unter' }, 'Einnahmen ', h('span', { class: 'pos' }, euro(s.ein))), balken(ein.map((x) => ({ ...x, farbe: 'var(--ok)' })), s.ein)] : null,
    aus.length ? [h('h3', { class: 'fin-unter' }, 'Ausgaben ', h('span', { class: 'neg' }, euro(s.aus))), balken(aus.map((x) => ({ ...x, farbe: 'var(--signal)' })), s.aus)] : null,
    h('button', { class: 'btn btn-block', onclick: () => openBereich('Wald') }, 'Alle Buchungen im Wald'));
}

function planungKachel() {
  const p = waldPlanung();
  const geplant = geplanteWaldkosten();
  const geplantSumme = geplant.reduce((s, m) => s + Number(m.kosten), 0);
  const ohneErloes = holzernteOhneErloes();
  const anteil = p.soll ? Math.min(100, Math.round((p.invest / p.soll) * 100)) : 0;
  return h('section', { class: 'kachel fin-plan' },
    h('div', { class: 'fin-plan-kopf' },
      h('h2', { class: 'kachel-titel' }, 'Finanzplanung Wald'),
      h('button', { class: 'link-btn', onclick: quoteAendern }, `Rücklage ${Math.round(p.q * 100)} %`)),
    ohneErloes.length ? h('div', { class: 'fin-alarm' },
      h('p', {}, h('strong', {}, `Holzernte abgeschlossen: ${ohneErloes.length === 1 ? 'eine Maßnahme' : `${ohneErloes.length} Maßnahmen`} ohne gebuchten Holzerlös.`), ' Trag den Erlös ein, sobald die Abrechnung da ist.'),
      ohneErloes.slice(0, 3).map((m) => h('button', { class: 'btn btn-small', onclick: () => openBuchung({ art: 'einnahme', bereich: 'Wald', kat: 'holzerloes', parcelId: m.parcelId, measureId: m.id, menge: zahl(m.details?.fm || m.details?.menge) || null, text: `${MEASURE_TYPES[m.type]?.label || 'Holzernte'}${m.details?.polterNr ? ` Polter ${m.details.polterNr}` : ''}` }) },
        `Erlös eintragen: ${MEASURE_TYPES[m.type]?.label || 'Holzernte'}${m.ort ? ` – ${m.ort}` : ''}`))) : null,
    p.erloes ? [
      h('p', {}, `Seit deinem ersten Holzverkauf (${datumText(p.ab)}) hast du `, h('strong', {}, euro(p.erloes)), ' Holzerlös gebucht. Davon sollen ', h('strong', {}, euro(p.soll)), ' zurück in den Wald.'),
      h('div', { class: 'fin-fortschritt', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': anteil }, h('span', { style: `width:${anteil}%` })),
      h('p', { class: 'fin-plan-zahlen' }, h('span', {}, 'Investiert ', h('strong', {}, euro(p.invest))), h('span', {}, 'Noch offen ', h('strong', { class: p.offen > 0 ? 'neg' : 'pos' }, euro(p.offen)))),
      p.offen > 0
        ? h('p', { class: 'muted' }, 'Gute Verwendung: Jungwaldpflege, Pflanzung auf Lücken und Schadflächen, Wildschutz für junge Bäume. Als Investition zählen Ausgaben für Pflanzung, Pflege, Wild- und Waldschutz sowie Wege.')
        : h('p', { class: 'pos' }, 'Deine Rücklage ist investiert. Gut für die nächste Waldgeneration!'),
    ] : h('p', { class: 'muted' }, `Sobald du einen Holzerlös buchst, rechnet die App aus, wie viel du zurück in den Wald investieren solltest (${Math.round(p.q * 100)} % des Erlöses).`),
    geplant.length ? h('div', { class: 'fin-geplant' },
      h('h3', { class: 'fin-unter' }, 'Geplante Waldmaßnahmen'),
      h('ul', {}, geplant.map((m) => h('li', {}, h('span', {}, `${MEASURE_TYPES[m.type]?.label || m.type}${m.ort ? ` – ${m.ort}` : ''}`), h('strong', {}, euro(m.kosten))))),
      p.erloes ? h('p', { class: p.offen >= geplantSumme ? 'pos' : 'muted' }, p.offen >= geplantSumme ? 'Deine offene Rücklage deckt die geplanten Kosten.' : `Deine offene Rücklage deckt ${euro(p.offen)} davon. Die übrigen ${euro(geplantSumme - p.offen)} brauchen eine andere Finanzierung – prüfe, ob die Maßnahme gefördert werden kann.`) : null) : null,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-small', onclick: () => neueMassnahme('pflege') }, 'Jungwaldpflege planen'),
      h('button', { class: 'btn btn-small', onclick: () => neueMassnahme('pflanzung') }, 'Pflanzung planen')));
}

async function quoteAendern() {
  let wert = Number(fin().quote ?? 25);
  const ok = await dialog({
    title: 'Rücklage aus Holzerlösen',
    body: h('div', { class: 'form' },
      h('p', { class: 'muted' }, 'Wie viel Prozent jedes Holzerlöses möchtest du wieder in deinen Wald stecken?'),
      h('div', { class: 'chips' }, [10, 20, 25, 30, 50].map((q) => h('button', { type: 'button', class: 'chip', 'aria-checked': String(q === wert), onclick: (e) => { wert = q; e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c === e.currentTarget))); e.currentTarget.closest('.form').querySelector('input').value = q; } }, `${q} %`))),
      h('label', {}, 'Eigener Wert (%)', h('input', { type: 'number', min: 0, max: 100, step: 1, value: wert, oninput: (e) => { wert = Number(e.target.value); } }))),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'Übernehmen', value: true, primary: true }],
  });
  if (ok && Number.isFinite(wert)) speichereFin((f) => { f.quote = Math.max(0, Math.min(100, Math.round(wert))); });
}

function uebernahmeKachel() {
  const ms = massnahmenMitKosten();
  if (!ms.length) return null;
  return h('section', { class: 'kachel' },
    h('h2', { class: 'kachel-titel' }, 'Kosten aus Maßnahmen übernehmen'),
    h('p', { class: 'muted' }, 'Diese abgeschlossenen Maßnahmen haben Kosten, die noch nicht in deinen Finanzen stehen.'),
    h('ul', { class: 'fin-liste' }, ms.slice(0, 6).map((m) => h('li', { class: 'fin-zeile' },
      h('div', { class: 'fin-zeile-text' }, h('strong', {}, MEASURE_TYPES[m.type]?.label || m.type), h('small', { class: 'muted' }, [m.ort, m.finishedAt ? fmtDate(m.finishedAt) : null].filter(Boolean).join(' · '))),
      h('div', { class: 'fin-zeile-rechts' }, h('strong', { class: 'neg' }, `−${euro(m.kosten)}`),
        h('button', { class: 'btn btn-small', onclick: () => openBuchung({ art: 'ausgabe', bereich: 'Wald', kat: MASSNAHME_KAT[m.type] || 'sonstiges', betrag: Number(m.kosten), parcelId: m.parcelId, measureId: m.id, datum: m.finishedAt ? new Date(m.finishedAt).toISOString().slice(0, 10) : heute(), text: MEASURE_TYPES[m.type]?.label }) }, 'Übernehmen'))))));
}

function buchungsListe(liste) {
  return h('ul', { class: 'fin-liste' }, liste.map((b) => {
    const p = b.parcelId ? flaecheVon(b.parcelId) : null;
    return h('li', {}, h('button', { class: 'fin-zeile', onclick: () => openBuchung(b) },
      h('span', { class: 'chip-dot', style: `--chip:${BEREICHE[b.bereich]?.farbe || '#888'}` }),
      h('div', { class: 'fin-zeile-text' },
        h('strong', {}, b.text || katLabel(b)),
        h('small', { class: 'muted' }, [datumText(b.datum), b.text ? katLabel(b) : null, b.partner, p ? `Flst. ${p.nr}` : null, b.belegId ? '📎 Beleg' : null].filter(Boolean).join(' · '))),
      h('strong', { class: b.art === 'einnahme' ? 'pos' : 'neg' }, `${b.art === 'einnahme' ? '+' : '−'}${euro(b.betrag)}`)));
  }));
}

function openAlle() {
  const inhalt = h('div', { class: 'fin-seite' });
  const zeichne = () => fill(inhalt, buchungsListe(imJahr(buchungen()).slice().sort(nachDatum)));
  zeichne();
  const ab = store.subscribe(zeichne);
  openPage(jahr === 'alle' ? 'Alle Buchungen' : `Buchungen ${jahr}`, inhalt, { onClose: ab });
}

function openBereich(bereich) {
  const inhalt = h('div', { class: 'fin-seite' });
  const zeichne = () => {
    const liste = imJahr(buchungen()).filter((b) => b.bereich === bereich).sort(nachDatum);
    const s = summen(liste);
    const aus = aufteilung(liste, 'ausgabe'), ein = aufteilung(liste, 'einnahme');
    const flaechen = meineFlaechen().filter((p) => bereichVonFlaeche(p) === bereich);
    fill(inhalt,
      h('section', { class: 'kachel fin-stand' },
        h('p', { class: 'muted fin-stand-label' }, jahr === 'alle' ? 'Stand über alle Jahre' : `Stand ${jahr}`),
        h('div', { class: `fin-saldo ${s.saldo < 0 ? 'neg' : 'pos'}` }, mitVz(s.saldo)),
        h('div', { class: 'fin-ein-aus' },
          h('div', {}, h('span', { class: 'muted' }, 'Einnahmen'), h('strong', { class: 'pos' }, euro(s.ein))),
          h('div', {}, h('span', { class: 'muted' }, 'Ausgaben'), h('strong', { class: 'neg' }, euro(s.aus)))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary', onclick: () => openBuchung({ art: 'ausgabe', bereich }) }, h('span', { html: icon.plus }), 'Rechnung'),
          h('button', { class: 'btn', onclick: () => openBuchung({ art: 'einnahme', bereich }) }, h('span', { html: icon.plus }), 'Einnahme / Gutschrift'))),
      ein.length || aus.length ? h('section', { class: 'kachel' },
        ein.length ? [h('h3', { class: 'fin-unter' }, 'Einnahmen nach Art'), balken(ein.map((x) => ({ ...x, farbe: 'var(--ok)' })), s.ein)] : null,
        aus.length ? [h('h3', { class: 'fin-unter' }, 'Ausgaben nach Art'), balken(aus.map((x) => ({ ...x, farbe: 'var(--signal)' })), s.aus)] : null) : null,
      flaechen.length ? h('section', { class: 'kachel' },
        h('h2', { class: 'kachel-titel' }, 'Je Flurstück'),
        h('ul', { class: 'fin-liste' }, flaechen.map((p) => {
          const sp = summen(liste.filter((b) => b.parcelId === p.id));
          return h('li', { class: 'fin-zeile' }, h('div', { class: 'fin-zeile-text' }, h('strong', {}, parcelTitle(p))),
            h('strong', { class: sp.saldo < 0 ? 'neg' : sp.saldo > 0 ? 'pos' : 'muted' }, mitVz(sp.saldo)));
        }))) : null,
      h('section', { class: 'kachel' },
        h('h2', { class: 'kachel-titel' }, 'Buchungen'),
        liste.length ? buchungsListe(liste) : h('p', { class: 'muted' }, `Noch keine Buchungen im Bereich ${BEREICHE[bereich].label}.`)),
    );
  };
  zeichne();
  const ab = store.subscribe(zeichne);
  openPage(`Finanzen: ${BEREICHE[bereich].label}`, inhalt, { onClose: ab });
}

// ---------- Rechnung / Einnahme erfassen oder bearbeiten ----------
export function openBuchung(vorgabe = {}) {
  const alt = vorgabe.id ? buchungen().find((b) => b.id === vorgabe.id) : null;
  const b = { art: 'ausgabe', bereich: null, kat: null, betrag: '', datum: heute(), parcelId: null, text: '', partner: '', menge: null, nr: '', ...(alt || vorgabe) };
  if (!b.bereich) b.bereich = b.parcelId ? bereichVonFlaeche(flaecheVon(b.parcelId)) : 'Wald';
  let neuerBeleg = null, belegWeg = false;
  const inhalt = h('form', { class: 'form fin-form', onsubmit: (e) => { e.preventDefault(); speichern(); } });

  const zeichne = () => {
    const kats = KATEGORIEN[b.bereich][b.art];
    if (!kats.some((x) => x.k === b.kat)) b.kat = kats[0].k;
    const flaechen = meineFlaechen();
    fill(inhalt,
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Art' },
        [['ausgabe', 'Rechnung / Ausgabe'], ['einnahme', 'Einnahme / Gutschrift']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(b.art === k), onclick: () => { b.art = k; zeichne(); } }, l))),
      h('div', { class: 'fin-feld' }, h('span', { class: 'fin-feld-label' }, 'Bereich'),
        h('div', { class: 'chips' }, Object.entries(BEREICHE).map(([k, x]) => h('button', { type: 'button', class: 'chip', style: `--chip:${x.farbe}`, role: 'radio', 'aria-checked': String(b.bereich === k), onclick: () => { b.bereich = k; if (b.parcelId && bereichVonFlaeche(flaecheVon(b.parcelId)) !== k) b.parcelId = null; zeichne(); } }, h('span', { class: 'chip-dot' }), x.label)))),
      h('label', {}, b.art === 'einnahme' ? 'Art der Einnahme' : 'Wofür?',
        h('select', { name: 'kat', onchange: (e) => { b.kat = e.target.value; zeichne(); } }, kats.map((x) => h('option', { value: x.k, selected: x.k === b.kat }, x.l)))),
      h('div', { class: 'form-row' },
        h('label', {}, b.art === 'einnahme' ? 'Betrag (€, brutto)' : 'Rechnungsbetrag (€, brutto)',
          h('input', { name: 'betrag', type: 'text', inputmode: 'decimal', required: true, placeholder: '0,00', value: b.betrag === '' ? '' : String(b.betrag).replace('.', ','), oninput: (e) => { b.betrag = e.target.value; } })),
        h('label', {}, 'Datum', h('input', { name: 'datum', type: 'date', required: true, value: b.datum, oninput: (e) => { b.datum = e.target.value; } }))),
      b.bereich === 'Wald' && b.art === 'einnahme' && b.kat === 'holzerloes'
        ? h('label', {}, 'Holzmenge (Fm, optional)', h('input', { name: 'menge', type: 'text', inputmode: 'decimal', value: b.menge ?? '', oninput: (e) => { b.menge = e.target.value; } }), mengePreis(b)) : null,
      h('label', {}, b.art === 'einnahme' ? 'Von wem? (z. B. Käufer, Bewilligungsstelle)' : 'Von wem? (Firma, Lieferant)',
        h('input', { name: 'partner', type: 'text', value: b.partner || '', oninput: (e) => { b.partner = e.target.value; } })),
      h('label', {}, 'Beschreibung (optional)', h('input', { name: 'text', type: 'text', value: b.text || '', placeholder: b.art === 'einnahme' ? 'z. B. Fichte Abschnitte, Los 12' : 'z. B. 500 Rotbuchen, Pflanzung Frühjahr', oninput: (e) => { b.text = e.target.value; } })),
      h('label', {}, 'Rechnungs- oder Belegnummer (optional)', h('input', { name: 'nr', type: 'text', value: b.nr || '', oninput: (e) => { b.nr = e.target.value; } })),
      h('label', {}, 'Flurstück (optional)',
        h('select', { name: 'parcel', onchange: (e) => { b.parcelId = e.target.value || null; if (b.parcelId) b.bereich = bereichVonFlaeche(flaecheVon(b.parcelId)); zeichne(); } },
          h('option', { value: '' }, flaechen.length ? 'Alle / kein bestimmtes Flurstück' : 'Noch keine Flurstücke angelegt'),
          flaechen.filter((p) => bereichVonFlaeche(p) === b.bereich || p.id === b.parcelId).map((p) => h('option', { value: p.id, selected: p.id === b.parcelId }, parcelTitle(p))))),
      belegFeld(),
      h('button', { type: 'submit', class: 'btn btn-primary btn-block btn-large' }, alt ? 'Änderungen speichern' : b.art === 'einnahme' ? 'Einnahme buchen' : 'Rechnung buchen'),
      alt ? h('button', { type: 'button', class: 'btn btn-block btn-danger-ghost', onclick: loeschen }, h('span', { html: icon.trash }), 'Buchung löschen') : null,
    );
  };
  function mengePreis(x) {
    const fm = zahl(x.menge), eur = zahl(x.betrag);
    return fm > 0 && eur > 0 ? h('small', { class: 'muted' }, `entspricht ${euro(eur / fm)} je Fm (brutto)`) : null;
  }
  function belegFeld() {
    const hat = (b.belegId && !belegWeg) || neuerBeleg;
    return h('div', { class: 'fin-feld' }, h('span', { class: 'fin-feld-label' }, 'Beleg (Foto oder PDF, optional)'),
      hat ? h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: belegZeigen }, `📎 ${neuerBeleg?.name || b.belegName || 'Beleg ansehen'}`),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { neuerBeleg = null; belegWeg = true; zeichne(); } }, 'Entfernen'))
        : h('label', { class: 'btn btn-block fin-beleg-btn' }, h('span', { html: icon.plus }), 'Beleg fotografieren oder hochladen',
          h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true, onchange: (e) => { const f = e.target.files?.[0]; if (f) { neuerBeleg = f; belegWeg = false; zeichne(); } } })));
  }
  async function belegZeigen() {
    const blob = neuerBeleg || (b.belegId ? await dateiLaden(b.belegId).catch(() => null) : null);
    if (!blob) { toast('Beleg nicht gefunden.'); return; }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function speichern() {
    const betrag = Math.round(zahl(b.betrag) * 100) / 100;
    if (!(betrag > 0)) { toast('Bitte einen Betrag größer als 0 eintragen.'); return; }
    if (!b.datum) { toast('Bitte ein Datum wählen.'); return; }
    const id = alt?.id || uid();
    let belegId = belegWeg ? null : (b.belegId || null), belegName = belegWeg ? null : (b.belegName || null);
    try {
      if ((belegWeg || neuerBeleg) && b.belegId) await dateiLoeschen(b.belegId).catch(() => {});
      if (neuerBeleg) { belegId = `beleg-${id}`; belegName = neuerBeleg.name || 'Beleg'; await dateiSpeichern(belegId, neuerBeleg); }
    } catch { toast('Der Beleg konnte nicht gespeichert werden. Die Buchung wird ohne Beleg gespeichert.'); belegId = null; belegName = null; }
    const eintrag = {
      id, art: b.art, bereich: b.bereich, kat: b.kat, betrag, datum: b.datum, parcelId: b.parcelId || null,
      text: String(b.text || '').trim(), partner: String(b.partner || '').trim(), nr: String(b.nr || '').trim(),
      menge: b.kat === 'holzerloes' && zahl(b.menge) > 0 ? zahl(b.menge) : null,
      measureId: b.measureId || null, belegId, belegName, createdAt: alt?.createdAt || Date.now(), geaendert: alt ? Date.now() : undefined,
    };
    const warNeuerErloes = !alt && eintrag.bereich === 'Wald' && eintrag.art === 'einnahme' && eintrag.kat === 'holzerloes';
    speichereFin((f) => { const i = f.buchungen.findIndex((x) => x.id === id); if (i >= 0) f.buchungen[i] = eintrag; else f.buchungen.push(eintrag); });
    pg.close();
    toast(alt ? 'Buchung geändert.' : eintrag.art === 'einnahme' ? 'Einnahme gebucht.' : 'Rechnung gebucht.');
    if (warNeuerErloes) reinvestHinweis(betrag);
  }
  async function loeschen() {
    if (!(await confirmDialog('Buchung löschen?', { ok: 'Löschen', danger: true, body: 'Die Buchung und ein angehängter Beleg werden von diesem Gerät gelöscht.' }))) return;
    if (alt.belegId) await dateiLoeschen(alt.belegId).catch(() => {});
    speichereFin((f) => { f.buchungen = f.buchungen.filter((x) => x.id !== alt.id); });
    pg.close();
    toast('Buchung gelöscht.');
  }
  zeichne();
  const pg = openPage(alt ? 'Buchung bearbeiten' : b.art === 'einnahme' ? 'Einnahme erfassen' : 'Rechnung erfassen', inhalt);
  return pg;
}

// ---------- Export ----------
function exportCsv() {
  const esc = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const kopf = ['Datum', 'Art', 'Bereich', 'Kategorie', 'Betrag (€)', 'Partner', 'Beschreibung', 'Beleg-Nr.', 'Flurstück', 'Holzmenge (Fm)'];
  const zeilen = buchungen().slice().sort((a, b) => String(a.datum).localeCompare(String(b.datum))).map((b) => {
    const p = b.parcelId ? flaecheVon(b.parcelId) : null;
    return [datumText(b.datum), b.art === 'einnahme' ? 'Einnahme' : 'Ausgabe', BEREICHE[b.bereich]?.label || b.bereich, katLabel(b),
      vorzeichen(b).toFixed(2).replace('.', ','), b.partner, b.text, b.nr, p ? parcelTitle(p) : '', b.menge ? String(b.menge).replace('.', ',') : ''];
  });
  const csv = '﻿' + [kopf, ...zeilen].map((z) => z.map(esc).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `waldwaechter-finanzen-${heute()}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
