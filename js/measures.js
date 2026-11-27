// Reiter 2: Maßnahmen – Übersicht, neue Maßnahme anlegen.
import { h, fill, icon, openPage, confirmDialog, toast, fmtDate, dialog } from './ui.js';
import { mitKartenwahl } from './flaechekarte.js';
import { openFotos, fotoAnzahl, fotosLoeschen } from './fotos.js';

// Symbolknopf mit Zähler für die Maßnahmenkarte
const knopf = (svg, n, label, onclick) => h('button', { type: 'button', class: 'icon-btn measure-icon', 'aria-label': n ? `${label} (${n})` : label, title: label, onclick },
  h('span', { html: svg }), n ? h('span', { class: 'zaehler' }, String(n)) : null);
import { inBrutzeit, nachBrutzeit, schutzzeitVon, schutzzeitText, datumText, gebieteVon, strengeGebiete, vorpruefungNoetig, gebieteText, zeigeVerordnung, EINGRIFF } from './schutzgebiete.js';
import { openVertraeglichkeit, openVerlauf, anhangOeffnen, protokoll } from './vertraeglichkeit.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { CATEGORIES } from './map/basemap.js';
import { formatHa, areaHa } from './geo.js';
import { flurstueckSchnappschuss } from './flaechekarte.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { openThinningWizard } from './thinning/wizard.js';
import { SPECIES } from './thinning/plan.js';
import { WANZE_SVG } from './mascot.js';
import { flaechenWahl, flaecheAutomatisch } from './flaeche.js';
import { openFlurstueckHistorie } from './historie.js';
import { openPolterVermessung } from './polter.js';
import { openZaunPlanung } from './zaun.js';
import { openPflanzPlanung } from './pflanzung.js';
import { FOERDER, fragFoerderung, weiterZumAntrag, openFoerderantrag, antragFuer } from './foerderung.js';
import { kopfInhalt } from './home.js';
import { passtEintrag, passtFlurstueck } from './profi.js';
import { openMassnahmeBearbeiten, openProtokoll, protokollKurz, openFlaecheHinterlegen } from './massnahme-protokoll.js';

const AUSZEICHNEN = ['holzernte_df', 'holzernte_bs'];
export const MEASURE_TYPES = {
  raeumung:     { label: 'Flächenräumung', gruppe: 'vorbereitung', info: 'Handräumung oder maschinelles Verfahren: Schlagabraum, Kronen, Bewuchs', fields: [['verfahren', 'Verfahren', ['Handräumung', 'Maschinell (Räumrechen am Bagger)', 'Maschinell (Forstmulcher, ganzflächig)', 'Schlagabraum in Reihen legen (Schwaden)']], ['material', 'Was wird geräumt?', ['Schlagabraum und Kronen', 'Käferholzreste', 'Brombeere / Vergrasung', 'Stubben', 'Gemischt']], ['schwadabstand', 'Abstand der Schwaden (m, falls in Reihen)', 'decimal'], ['area', 'Fläche (ha)', 'decimal']] },
  bodenverwundung: { label: 'Bodenverwundung', gruppe: 'vorbereitung', info: 'Boden für Naturverjüngung oder Saat öffnen – plätze- oder streifenweise', fields: [['verfahren', 'Verfahren', ['Plätzeweise (Hacke, Wiedehopfhaue)', 'Streifenweise (Scheibenegge / Fräse)', 'Streifenweise (Grubber am Rückeschlepper)', 'Bagger mit Rechen (plätzeweise)']], ['anteil', 'Verwundeter Flächenanteil (%)', 'number'], ['ziel', 'Für', ['Naturverjüngung', 'Saat', 'Pflanzung']], ['area', 'Fläche (ha)', 'decimal']] },
  mulchen:      { label: 'Streifenweises Mulchen', gruppe: 'vorbereitung', info: 'Pflanzstreifen freimulchen, Schlagabraum zerkleinern', fields: [['technik', 'Technik', ['Forstmulcher am Bagger', 'Forstmulcher am Traktor / Raupe', 'Freischneider mit Häckselmesser']], ['streifenbreite', 'Streifenbreite (m)', 'decimal'], ['abstand', 'Abstand der Streifen, Mitte zu Mitte (m)', 'decimal'], ['area', 'Fläche (ha)', 'decimal']] },
  pflanzung:    { label: 'Pflanzung', gruppe: 'kultur', info: 'Pflanzfläche planen, Baumarten verteilen, Pflanzenzahl und Kosten', fields: [['species', 'Baumart', 'species'], ['count', 'Anzahl Pflanzen', 'number'], ['area', 'Fläche (ha)', 'decimal'], ['verband', 'Pflanzverband (z. B. 2 × 1 m)', 'text']] },
  saat:         { label: 'Saat', gruppe: 'kultur', info: 'Platz-, Streifen- oder Vollsaat, Hähersaat (Eiche), Saat unter Schirm', fields: [['species', 'Baumart', 'species'], ['verfahren', 'Saatverfahren', ['Platzsaat', 'Streifensaat', 'Vollsaat', 'Hähersaat (Eichelkästen)', 'Saat unter Schirm (Voranbau)']], ['menge', 'Saatgutmenge (kg)', 'decimal'], ['herkunft', 'Herkunft / Saatgutnummer', 'text'], ['area', 'Fläche (ha)', 'decimal']] },
  zaunbau:      { label: 'Zaunbau', gruppe: 'wildschutz', info: 'Zaunverlauf einzeichnen, Material und Kosten', fields: [['length', 'Zaunlänge (m)', 'number'], ['zaun', 'Zauntyp', 'text'], ['tore', 'Tore', 'text']] },
  einzelschutz: { label: 'Einzelschutz', gruppe: 'wildschutz', info: 'Wuchshüllen, Drahthosen, Fege- und Verbissschutz', fields: [['art', 'Art des Schutzes', ['Wuchshülle', 'Freiwuchsgitter / Drahthose', 'Fegeschutz (Spirale, Fegestab)', 'Terminaltriebschutz', 'Verbissschutzmittel (Streichmittel)']], ['species', 'Baumart', 'species'], ['count', 'Anzahl Pflanzen (Stück)', 'number'], ['hoehe', 'Höhe des Schutzes (z. B. 1,20 m)', 'text'], ['stab', 'Befestigung', ['Robinienstab', 'Lärchenstab', 'Tonkinstab', 'ohne Stab']], ['preis', 'Preis je Stück inkl. Stab (€)', 'decimal']] },
  pflege:       { label: 'Pflege im Jungwaldstadium', gruppe: 'pflege', info: 'Kulturpflege, Jungwuchs- und Dickungspflege, Wertästung – mit Fläche, Kosten und Förderung', fields: [['art', 'Art der Pflege', ['Kulturpflege (Sicherung der Kultur)', 'Jungwuchspflege', 'Dickungspflege (Jungbestandspflege)', 'Wertästung']], ['area', 'Fläche (ha)', 'decimal'], ['vorgehen', 'Vorgehen', 'text'], ['species', 'Hauptbaumart', 'text'], ['mittelhoehe', 'Mittelhöhe (m)', 'text'], ['pflanzjahr', 'Jahr der Pflanzung', 'text'], ['zBaeume', 'Z-Bäume (Stück)', 'text'], ['ausfuehrung', 'Ausführung', 'text']] },
  holzernte_df: { label: 'Holzernte', gruppe: 'holzernte', info: 'Frei auszeichnen: je Baum die Durchmesserstufe antippen – Menge, GPS-Punkte, Sortimente und Kalkulation', fields: [['verfahren', 'Verfahren', ['motormanuell', 'Harvester', 'Harvester und motormanuell', 'Seilkran', 'Rückepferd']], ['species', 'Hauptbaumart', 'species'], ['baeume', 'Anzahl entnommener Bäume', 'number'], ['menge', 'Entnahmemenge (Fm)', 'decimal'], ['area', 'Fläche (ha)', 'decimal']] },
  durchforstung:{ label: 'Durchforstung nach Masterarbeit', gruppe: 'holzernte', info: 'Geführte Durchforstung mit GPS-Raster nach der Methode der Masterarbeit', fields: [] },
  holzernte_bs: { label: 'Bodenschonende Holzernte', gruppe: 'holzernte', info: 'Seilkran, Rückepferd, Seilwinde, Bänder – Pferd und Seilkran sind förderfähig', fields: [['verfahren', 'Verfahren', ['Seilkran', 'Rückepferd', 'Seilschlepper / Seilwinde (Vorliefern)', 'Harvester / Forwarder mit Bändern', 'Traktionshilfswinde', 'Rückegassen auf Reisigmatte']], ['species', 'Hauptbaumart', 'species'], ['baeume', 'Anzahl entnommener Bäume', 'number'], ['menge', 'Entnahmemenge (Fm)', 'decimal'], ['gassenabstand', 'Gassenabstand (m)', 'number'], ['area', 'Fläche (ha)', 'decimal']] },
  polter:       { label: 'Holzvermessung', gruppe: 'holzernte', info: 'Schritt für Schritt nach RVR (6. Aufl. 2024): Messverfahren, Sortiment, Menge in Rm oder Fm', fields: [['polterNr', 'Polter-Nr.', 'text'], ['species', 'Baumart', 'species'], ['sortiment', 'Sortiment', 'text'], ['verfahren', 'Messverfahren', 'text'], ['laenge', 'Poltertiefe/Bestelllänge (m)', 'text'], ['uebermass', 'Zugabe/Übermaß (m)', 'text'], ['rindenabzug', 'Rindenabzug', 'text'], ['stueck', 'Anzahl Stämme', 'text'], ['stirnflaechen', 'Stirnflächen gezählt (Foto)', 'text'], ['unterlagen', 'Unterlagen im Los (Rm m.R.)', 'text'], ['rm', 'Raummaß (Rm m.R.)', 'text'], ['red', 'Reduktionsfaktor', 'text'], ['faktor', 'Umrechnungsfaktor', 'text'], ['fm', 'Festmaß (Fm o.R.)', 'text'], ['pos', 'Standort des Polters', 'text']] },
  schaden:      { label: 'Schadensmeldung', info: 'Käfer, Windwurf, Bruch – mit GPS, Foto und Meldung an die FBG', fields: [['schaden', 'Schaden', 'text'], ['species', 'Baumart', 'text'], ['menge', 'Menge grob (Fm)', 'text'], ['baeume', 'Anzahl Bäume', 'text'], ['gps', 'GPS', 'text'], ['gemeldet', 'An FBG gemeldet am', 'text']] },
  holzverkauf:  { label: 'Holz verkaufen', gruppe: 'holzernte', info: 'Anfrage an die FBG mit Fläche, Baumart und Menge', fields: [['species', 'Baumart', 'text'], ['menge', 'Menge geschätzt (Fm)', 'text'], ['zustand', 'Zustand', 'text'], ['wann', 'Zeitraum', 'text'], ['gemeldet', 'Angefragt am', 'text']] },
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
export function termine(m, von, bis) {
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
  const t0 = m.date || (m.status === 'fertig' ? m.finishedAt : null); // erledigt ohne Termin: am Tag des Abschlusses
  if (!t0) return [];
  const d = new Date(t0);
  return d >= von && d < bis ? [{ date: d, key: 'einmal', label: MEASURE_TYPES[m.type]?.label || m.type, done: m.status === 'fertig' }] : [];
}
function naechsterTermin(m) {
  const jetzt = new Date(); jetzt.setHours(0, 0, 0, 0);
  const bis = new Date(jetzt.getFullYear() + 2, 0, 1);
  return termine(m, new Date(jetzt.getFullYear() - 1, 0, 1), bis).filter((t) => !t.done).sort((a, b) => a.date - b.date)[0] || null;
}
let tagWahl = null;

let root;

// ---------- Detailseite einer Maßnahme: Planen → Durchführen → Abschließen ----------
const SCHRITTE = [['geplant', 'Planen'], ['arbeit', 'Durchführen'], ['fertig', 'Abschließen']];
function schrittLeiste(m) {
  const i = SCHRITTE.findIndex(([k]) => k === m.status);
  const ganzFertig = m.status === 'fertig' && (m.protokoll || m.serie || m.type === 'schaden');
  return h('ol', { class: 'schritte', 'aria-label': 'Fortschritt' }, SCHRITTE.map(([, l], j) =>
    h('li', { class: j < i || (j === i && ganzFertig) ? 'fertig' : j === i ? 'aktiv' : '', 'aria-current': j === i ? 'step' : null },
      h('span', { class: 'schritt-nr' }, j < i || (j === i && ganzFertig) ? '✓' : String(j + 1)), h('span', {}, l))));
}
function naechsterSchrittText(m) {
  if (m.serie) { const nt = naechsterTermin(m); return nt ? `Nächste Kontrolle am ${nt.date.toLocaleDateString('de-DE')}.` : 'Kontrolltermine im Jahresrhythmus.'; }
  if (m.status === 'geplant') return m.date ? `Termin am ${fmtDate(m.date)}. Arbeitsauftrag an den Unternehmer geben; wenn es losgeht, auf „Begonnen“ tippen.` : 'Lege einen Termin fest und gib den Arbeitsauftrag weiter.';
  if (m.status === 'arbeit') return 'Läuft gerade. Fotos festhalten – und wenn alles fertig ist, „Erledigt“ tippen.';
  if (m.type === 'schaden') return 'Abgeschlossen.';
  return m.protokoll ? 'Abgeschlossen und protokolliert.' : 'Fertig – jetzt kurz das Abschlussprotokoll ausfüllen (Schäden, Unternehmer).';
}
async function openMassnahmeDetail(id) {
  const m0 = store.get().measures.find((x) => x.id === id);
  if (!m0) return;
  const body = h('div', { class: 'mdetail' });
  let unsub = null;
  const seite = openPage(MEASURE_TYPES[m0.type]?.label || 'Maßnahme', body, { onClose: () => unsub?.() });
  const draw = async () => {
    const m = store.get().measures.find((x) => x.id === id);
    if (!m) { seite.close(); return; }
    const all = await source.allParcels();
    const byId = Object.fromEntries(all.map((p) => [p.id, p]));
    const y = seite.el.querySelector('.page-body')?.scrollTop;
    fill(body,
      schrittLeiste(m),
      h('p', { class: 'mdetail-hinweis' }, naechsterSchrittText(m)),
      h('ul', { class: 'measure-list mdetail-karte' }, measureCard(m, byId)));
    if (y != null) seite.el.querySelector('.page-body').scrollTop = y;
  };
  unsub = store.subscribe(draw);
  draw();
}
window.addEventListener('ww:massnahme-oeffnen', (e) => openMassnahmeDetail(e.detail));

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
  const list = [...store.get().measures].filter(passtEintrag).sort((a, b) => (a.status === 'fertig') - (b.status === 'fertig') || ((naechsterTermin(a)?.date ?? Infinity) - (naechsterTermin(b)?.date ?? Infinity)) || b.createdAt - a.createdAt);
  // Unter „Offene Maßnahmen“ nur, was noch nicht abgeschlossen ist; Erledigtes bleibt im Kalender und in der Flurstückhistorie
  const offen = list.filter((m) => m.status !== 'fertig');

  fill(root,
    h('header', { class: 'card app-head' }, kopfInhalt()),
    h('section', { class: 'kachel massn-kopf' },
      h('div', { class: 'view-head' },
        h('h1', {}, 'Maßnahmen'),
        h('p', { class: 'muted' }, list.length ? `${offen.length} offen · ${list.length - offen.length} abgeschlossen` : 'Plane und dokumentiere Maßnahmen auf deinen Flächen.')),
      h('button', { class: 'btn btn-primary btn-block btn-large', onclick: () => openNewMeasure() }, h('span', { html: icon.plus }), 'Neue Maßnahme beginnen'),
      h('div', { class: 'schnell-chips', role: 'group', 'aria-label': 'Schnell anlegen' },
        [['pflanzung', 'Pflanzung'], ['zaunbau', 'Zaun'], ['pflege', 'Pflege'], ['holzernte_df', 'Holzernte'], ['schaden', 'Schaden melden']].map(([k, l]) =>
          h('button', { type: 'button', class: 'chip', onclick: () => openNewMeasure({ typ: k }) }, l))),
      h('button', { class: 'btn btn-block historie-btn', onclick: () => openFlurstueckHistorie() }, h('span', { html: icon.map || icon.list || '' }), 'Flurstückhistorie')),
    kalender(list, byId),
    listenKachel(list, byId),
  );
}

// ---------- Fotos einer Maßnahme: einfach so, an einem vorhandenen oder an einem neuen Fotopunkt ----------
function fotopunktVerknuepfen(mid, fpId) {
  store.update((s) => { const x = s.measures.find((y) => y.id === mid); if (x) { x.fotopunkte ||= []; if (!x.fotopunkte.includes(fpId)) x.fotopunkte.push(fpId); } });
}
async function fotosWaehlen(m, titel) {
  const flst = m.parcelIds?.length ? m.parcelIds : m.parcelId ? [m.parcelId] : [];
  const alle = store.get().fotopunkte || [];
  const verknuepft = alle.filter((f) => (m.fotopunkte || []).includes(f.id));
  const vorhanden = alle.filter((f) => flst.includes(f.parcelId) && !verknuepft.includes(f));
  const zeile = (f) => `${f.name || 'Fotopunkt'} · Blick ${f.blick}° · ${fotoAnzahl(`fp:${f.id}`)} Fotos`;
  const wahl = await dialog({
    title: 'Fotos zur Maßnahme',
    body: (close) => h('div', { class: 'foto-wahl' },
      h('p', { class: 'muted' }, 'Wie möchtest du fotografieren?'),
      h('button', { type: 'button', class: 'type-tile', onclick: () => close({ art: 'einfach' }) },
        h('span', { class: 'type-text' }, h('strong', {}, 'Einfach Fotos machen'), h('small', {}, `Vorher/Nachher-Bilder direkt an der Maßnahme · ${fotoAnzahl(`m:${m.id}`)} Fotos`))),
      verknuepft.length || vorhanden.length ? h('div', { class: 'foto-wahl-gruppe' },
        h('p', { class: 'eyebrow' }, 'Vorhandenen Fotopunkt nutzen'),
        [...verknuepft, ...vorhanden].map((f) => h('button', { type: 'button', class: 'type-tile', onclick: () => close({ art: 'punkt', id: f.id }) },
          h('span', { class: 'type-text' }, h('strong', {}, f.name || 'Fotopunkt'), h('small', {}, `${zeile(f).split(' · ').slice(1).join(' · ')}${verknuepft.includes(f) ? ' · mit dieser Maßnahme verknüpft' : ''}`))))) : null,
      flst.length ? h('button', { type: 'button', class: 'type-tile', onclick: () => close({ art: 'neu' }) },
        h('span', { class: 'type-text' }, h('strong', {}, 'Neuen Fotopunkt anlegen'), h('small', {}, 'Fester Standort mit Blickrichtung – so lässt sich die Fläche über Jahre vergleichen'))) : null,
      !flst.length ? h('p', { class: 'hint' }, 'Fotopunkte gibt es nur für Maßnahmen mit Flurstück.') : null),
    actions: [{ label: 'Abbrechen', value: null }],
  });
  if (!wahl) return;
  const { fotopunktFotos } = await import('./tagebuch.js');
  if (wahl.art === 'einfach') openFotos(`m:${m.id}`, titel);
  else if (wahl.art === 'punkt') {
    fotopunktVerknuepfen(m.id, wahl.id);
    const f = (store.get().fotopunkte || []).find((x) => x.id === wahl.id);
    if (f) fotopunktFotos(f);
  } else if (wahl.art === 'neu') {
    let pid = flst[0];
    if (flst.length > 1) {
      const all = await source.allParcels();
      pid = await dialog({ title: 'Auf welchem Flurstück?', body: h('p', {}, 'Wähle das Flurstück, auf dem der Fotopunkt liegen soll.'),
        actions: [...flst.map((id) => { const p = all.find((x) => x.id === id); return { label: p ? `Flurstück ${p.nr}, ${p.gemarkung}` : id, value: id }; }), { label: 'Abbrechen', value: null }] });
      if (!pid) return;
    }
    const { openHistorieFlurstueck } = await import('./historie.js');
    openHistorieFlurstueck(pid, { neuerFotopunkt: (id) => {
      fotopunktVerknuepfen(m.id, id);
      const f = (store.get().fotopunkte || []).find((x) => x.id === id);
      if (f) fotopunktFotos(f);
    } });
  }
}

// ---------- Liste: kompakte Zeilen mit Filter ----------
let listFilter = 'offen';
function listenKachel(list, byId) {
  const offen = list.filter((m) => m.status !== 'fertig');
  const fertig = list.filter((m) => m.status === 'fertig').sort((a, b) => (b.finishedAt || b.date || 0) - (a.finishedAt || a.date || 0));
  const zeigen = listFilter === 'offen' ? offen : listFilter === 'erledigt' ? fertig : [...offen, ...fertig];
  return h('section', { class: 'kachel' },
    h('div', { class: 'liste-kopf' },
      h('h2', { class: 'kachel-titel' }, 'Meine Maßnahmen'),
      h('div', { class: 'segmented compact', role: 'radiogroup', 'aria-label': 'Filter' },
        [['offen', `Offen ${offen.length}`], ['erledigt', `Erledigt ${fertig.length}`], ['alle', 'Alle']].map(([k, l]) =>
          h('button', { role: 'radio', 'aria-checked': String(listFilter === k), onclick: () => { listFilter = k; render(); } }, l)))),
    zeigen.length
      ? h('ul', { class: 'mzeilen' }, zeigen.map((m) => zeile(m, byId)))
      : list.length ? h('p', { class: 'muted' }, listFilter === 'offen' ? 'Alles erledigt – keine offenen Maßnahmen.' : 'Noch nichts abgeschlossen.')
      : h('div', { class: 'empty with-bug' }, h('div', { class: 'empty-bug', html: WANZE_SVG }),
          h('p', {}, 'Noch keine Maßnahmen. Starte mit einer Pflanzung, einem Zaunbau oder der geführten Durchforstung.')));
}
function zeile(m, byId) {
  const nt = naechsterTermin(m);
  const datum = m.status === 'fertig' ? (m.finishedAt || m.date) : nt?.date?.getTime?.() ?? m.date;
  const ueberfaellig = m.status !== 'fertig' && datum && datum < new Date().setHours(0, 0, 0, 0);
  const offenesProtokoll = m.status === 'fertig' && !m.protokoll && !m.serie && m.type !== 'schaden';
  const warn = vorpruefungNoetig(m);
  return h('li', { 'data-mid': m.id },
    h('button', { type: 'button', class: `mzeile mzeile-${m.status}`, onclick: () => openMassnahmeDetail(m.id) },
      h('i', { class: `dot dot-${m.type}` }),
      h('span', { class: 'mzeile-text' },
        h('strong', {}, MEASURE_TYPES[m.type]?.label || m.type),
        h('small', {}, wo(m, byId)),
        warn ? h('small', { class: 'mzeile-warn' }, 'Vorprüfung fehlt') : offenesProtokoll ? h('small', { class: 'mzeile-warn' }, 'Protokoll fehlt') : null),
      h('span', { class: 'mzeile-rechts' },
        h('span', { class: `badge badge-${m.status}` }, STATUS[m.status]),
        h('small', { class: ueberfaellig ? 'ueberfaellig' : '' }, datum ? new Date(datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : 'ohne Termin')),
      h('span', { class: 'chev', html: icon.chevron })),
    auszeichnenOffen(m) ? fortsetzenKnopf(m, 'mzeile-weiter') : null);
}
/** Holzernte, die noch nicht für beendet erklärt wurde: direkt weiter Bäume auszeichnen */
const auszeichnenOffen = (m) => AUSZEICHNEN.includes(m.type) && m.status !== 'fertig' && !m.auszeichnung?.abgeschlossen;
function fortsetzenKnopf(m, cls = '') {
  const n = m.auszeichnung?.baeume?.length || 0;
  return h('button', { type: 'button', class: `btn btn-primary btn-block ${cls}`, onclick: () => import('./auszeichnen.js').then((x) => x.openAuszeichnen(m.id)) },
    n ? `Fortsetzen · ${n} ${n === 1 ? 'Baum' : 'Bäume'}${m.details?.menge ? `, ${m.details.menge} Fm` : ''}` : 'Auszeichnen starten');
}

// ---------- Maßnahmenplan: Tages-, Wochen- oder Monatsansicht ----------
const ANSICHTEN = { tag: 'Tag', woche: 'Woche', monat: 'Monat' };
let ansicht = (() => { try { return ANSICHTEN[localStorage.getItem('waldwaechter.planAnsicht')] ? localStorage.getItem('waldwaechter.planAnsicht') : 'woche'; } catch { return 'woche'; } })();
let bezug = new Date(new Date().setHours(0, 0, 0, 0));
let ansichtWahl = false;
const montag = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
function zeitraum() {
  if (ansicht === 'tag') { const v = new Date(bezug); return [v, new Date(v.getFullYear(), v.getMonth(), v.getDate() + 1)]; }
  if (ansicht === 'woche') { const v = montag(bezug); return [v, new Date(v.getFullYear(), v.getMonth(), v.getDate() + 7)]; }
  const v = new Date(bezug.getFullYear(), bezug.getMonth(), 1); return [v, new Date(v.getFullYear(), v.getMonth() + 1, 1)];
}
function blaettern(r) {
  const d = new Date(bezug);
  if (ansicht === 'tag') d.setDate(d.getDate() + r);
  else if (ansicht === 'woche') d.setDate(d.getDate() + 7 * r);
  else { d.setDate(1); d.setMonth(d.getMonth() + r); }
  bezug = d; tagWahl = null; render();
}
const kw = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - n + 3); const j = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - j) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7); };

function kalender(list, byId) {
  const [von, bis] = zeitraum();
  const ev = list.flatMap((m) => termine(m, von, bis).map((t) => ({ ...t, m })));
  const byDay = new Map();
  for (const e of ev) { const k = ymd(e.date); (byDay.get(k) || byDay.set(k, []).get(k)).push(e); }
  const heute = ymd(new Date());
  const zelle = (dt) => {
    const k = ymd(dt);
    const es = byDay.get(k) || [];
    return h('button', { class: `cal-cell ${k === heute ? 'today' : ''} ${tagWahl === k ? 'sel' : ''} ${es.length ? 'has' : ''}`, 'aria-label': `${dt.getDate()}. ${es.length ? `${es.length} Termin(e)` : 'kein Termin'}`,
      onclick: () => { tagWahl = tagWahl === k ? null : k; render(); } },
      h('span', { class: 'cal-d' }, dt.getDate()),
      es.length ? h('span', { class: 'cal-dots' }, es.slice(0, 3).map((e) => h('i', { class: `dot dot-${e.m.type} ${e.done ? 'done' : ''}` }))) : null);
  };
  let raster = null;
  if (ansicht === 'monat') {
    const zellen = [];
    for (let i = 0; i < (von.getDay() + 6) % 7; i++) zellen.push(h('span', { class: 'cal-cell empty' }));
    for (let d = 1; d <= new Date(bis - 1).getDate(); d++) zellen.push(zelle(new Date(von.getFullYear(), von.getMonth(), d)));
    raster = h('div', { class: 'cal-grid' }, ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((t) => h('span', { class: 'cal-wd' }, t)), zellen);
  } else if (ansicht === 'woche') {
    raster = h('div', { class: 'cal-grid' }, ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((t) => h('span', { class: 'cal-wd' }, t)),
      Array.from({ length: 7 }, (_, i) => zelle(new Date(von.getFullYear(), von.getMonth(), von.getDate() + i))));
  }
  const zeigen = tagWahl && tagWahl >= ymd(von) && tagWahl < ymd(bis) ? (byDay.get(tagWahl) || []) : ev;
  const fmt = (d, o) => d.toLocaleDateString('de-DE', o);
  const titel = ansicht === 'monat' ? fmt(von, { month: 'long', year: 'numeric' })
    : ansicht === 'woche' ? `KW ${kw(von)} · ${fmt(von, { day: '2-digit', month: '2-digit' })}–${fmt(new Date(bis - 864e5), { day: '2-digit', month: '2-digit', year: 'numeric' })}`
    : fmt(von, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const leer = { tag: 'An diesem Tag ist nichts geplant.', woche: 'In dieser Woche ist nichts geplant.', monat: 'In diesem Monat ist nichts geplant.' }[ansicht];
  const einheit = { tag: 'Tag', woche: 'Woche', monat: 'Monat' }[ansicht];
  return h('section', { class: 'kachel calendar', 'aria-label': 'Maßnahmenplan' },
    h('div', { class: 'cal-top' },
      h('h2', {}, 'Maßnahmenplan'),
      h('button', { class: `icon-btn cal-ansicht ${ansichtWahl ? 'on' : ''}`, 'aria-label': `Ansicht wechseln (jetzt: ${ANSICHTEN[ansicht]})`, 'aria-expanded': String(ansichtWahl), title: 'Tag, Woche oder Monat', onclick: () => { ansichtWahl = !ansichtWahl; render(); } },
        h('span', { html: icon.calendar }), h('small', {}, ANSICHTEN[ansicht]))),
    ansichtWahl ? h('div', { class: 'segmented compact cal-wahl', role: 'radiogroup', 'aria-label': 'Ansicht' },
      Object.entries(ANSICHTEN).map(([k, l]) => h('button', { role: 'radio', 'aria-checked': String(ansicht === k), onclick: () => {
        ansicht = k; ansichtWahl = false; tagWahl = null; try { localStorage.setItem('waldwaechter.planAnsicht', k); } catch {} render();
      } }, l))) : null,
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn', 'aria-label': `${einheit} zurück`, onclick: () => blaettern(-1) }, '‹'),
      h('button', { class: 'cal-titel', title: 'Zu heute springen', onclick: () => { bezug = new Date(new Date().setHours(0, 0, 0, 0)); tagWahl = null; render(); } }, titel),
      h('button', { class: 'icon-btn', 'aria-label': `${einheit} weiter`, onclick: () => blaettern(1) }, '›')),
    raster,
    h('ul', { class: 'cal-list' }, zeigen.length
      ? zeigen.sort((a, b) => a.date - b.date).map((e) => h('li', { class: `cal-item ${e.done ? 'done' : ''}` },
          h('i', { class: `dot dot-${e.m.type}` }),
          h('span', { class: 'cal-date' }, e.date.toLocaleDateString('de-DE', { weekday: ansicht === 'monat' ? undefined : 'short', day: '2-digit', month: '2-digit' })),
          h('button', { type: 'button', class: 'cal-text', onclick: () => openMassnahmeDetail(e.m.id) }, h('strong', {}, e.m.type === 'verkehrssicherung' ? `Verkehrssicherung: ${e.label}` : e.label), h('small', {}, wo(e.m, byId))),
          e.m.serie && !e.done ? h('button', { class: 'btn btn-small', onclick: () => { store.update((s) => { const x = s.measures.find((y) => y.id === e.m.id); x.erledigt = { ...(x.erledigt || {}), [e.key]: Date.now() }; }); toast('Kontrolle als erledigt vermerkt'); } }, 'Erledigt') : null,
          e.done && !e.m.serie && e.m.type !== 'schaden' ? h('button', { class: `btn btn-small ${e.m.protokoll ? '' : 'btn-primary'}`, title: 'Abschlussprotokoll', onclick: () => openProtokoll(e.m.id) }, e.m.protokoll ? 'Protokoll' : 'Protokoll ausfüllen') : null,
          e.done && (e.m.serie || e.m.type === 'schaden') ? h('span', { class: 'badge badge-fertig' }, 'Erledigt') : null,
          !e.done && !e.m.serie && e.m.type !== 'durchforstung' ? h('button', { class: 'icon-btn', 'aria-label': 'Bearbeiten', title: 'Bearbeiten', html: icon.edit, onclick: () => openMassnahmeBearbeiten(e.m.id) }) : null))
      : h('li', { class: 'muted' }, tagWahl ? 'An diesem Tag ist nichts geplant.' : leer)),
  );
}
const wo = (m, byId) => { const p = byId[m.parcelId] || m.flurstueck; return m.thinning?.label || (p ? `${p.gemarkung}, Flur ${p.flur}, Flurstück ${p.nr}` : m.ort || 'Ohne Flächenzuordnung'); };

function datumFeld(m) {
  return h('label', { class: 'date-field' }, 'Termin',
    h('input', { type: 'date', value: m.date ? ymd(new Date(m.date)) : '', onchange: async (e) => {
      const v = e.target.value;
      let ts = v ? new Date(`${v}T09:00`).getTime() : null;
      const natura = strengeGebiete(gebieteVon(m));
      const szm = schutzzeitVon(m);
      if (vorpruefungNoetig(m, ts)) {
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
      if (ts) { const d = new Date(ts); bezug = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
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

const fmtM3 = (v) => Number(v || 0).toLocaleString('de-DE', { maximumFractionDigits: 1 });

function measureCard(m, byId) {
  const p = byId[m.parcelId] || m.flurstueck;
  const where = wo(m, byId);
  let progress = null, action = null;
  if (m.type === 'durchforstung' && m.thinning?.plan) {
    const pts = m.thinning.plan.points;
    const done = pts.filter((x) => x.status === 'done').length;
    progress = h('div', { class: 'progress' },
      h('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': pts.length, 'aria-valuenow': done }, h('span', { style: `width:${(done / pts.length) * 100}%` })),
      h('span', { class: 'progress-label' }, `${done} von ${pts.length} Rasterpunkten erledigt`),
    );
    action = h('button', { class: `btn btn-voll ${m.status === 'fertig' ? '' : 'btn-primary'}`, onclick: () => openThinningWizard({ measureId: m.id }) },
      m.status === 'fertig' ? 'Ansehen' : m.status === 'geplant' ? 'Öffnen' : 'Im Bestand fortsetzen');
  } else if (m.type === 'durchforstung') {
    action = h('button', { class: 'btn btn-voll btn-primary', onclick: () => openThinningWizard({ measureId: m.id }) }, 'Planung fortsetzen');
  }
  const details = Object.entries(m.details || {}).filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => {
      const f = MEASURE_TYPES[m.type]?.fields.find((x) => x[0] === k);
      const einheit = f && /\(([^)]{1,8})\)$/.exec(f[1])?.[1];
      return f ? `${f[1].replace(/ \(.*\)/, '')}: ${v}${einheit && !/je /.test(einheit) ? ` ${einheit}` : ''}` : null;
    }).filter(Boolean);

  return h('li', { class: `measure measure-${m.status}`, 'data-mid': m.id },
    h('div', { class: 'measure-top' },
      h('strong', { class: 'measure-type' }, MEASURE_TYPES[m.type]?.label || m.type),
      h('span', { class: `badge badge-${m.status}` }, STATUS[m.status]),
    ),
    h('p', { class: 'measure-where' }, where),
    m.serie ? vspFelder(m) : m.status === 'fertig' ? h('p', { class: 'muted' }, `Termin ${m.date ? fmtDate(m.date) : 'offen'}`) : datumFeld(m),
    details.length ? h('p', { class: 'measure-details' }, details.join('; ')) : null,
    m.flaeche?.ring ? h('p', { class: 'measure-details' }, `${m.flaeche.ringe?.length > 1 ? `${m.flaeche.ringe.length} Teilflächen` : 'Teilfläche'} ${formatHa(m.flaeche.ha)}`) : null,
    m.foerderung?.antragId ? (() => { const fa = store.get().foerderantraege?.find((x) => x.id === m.foerderung.antragId); return fa ? h('p', { class: 'measure-details' }, h('button', { type: 'button', class: 'link-btn', onclick: () => openFoerderantrag({ antragId: fa.id }) }, fa.status === 'fertig' ? 'Förderantrag vorbereitet – ansehen' : 'Förderantrag fortsetzen')) : null; })() : null,
    m.kosten ? h('p', { class: 'measure-details' }, `Kosten: ${Number(m.kosten).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`) : null,
    m.thinning?.plan ? h('p', { class: 'measure-details' }, `${m.thinning.plan.eingriffe?.anzahl > 1 ? `Eingriff ${m.thinning.plan.eingriffe.nr} von ${m.thinning.plan.eingriffe.anzahl}, ` : ''}${formatHa(m.thinning.plan.areaHa)}, ${m.thinning.plan.methode === 'f4' ? `${fmtM3(m.thinning.plan.planung?.mengeHa)} m³/ha = ${fmtM3(m.thinning.plan.planung?.budget)} m³ Menge${m.thinning.f4 ? `, ${fmtM3(m.thinning.f4.gezaehlt)} m³ gezählt` : ''}` : `${m.thinning.plan.total} Bäume Entnahme geplant`}`) : null,
    m.note ? h('p', { class: 'measure-note' }, m.note) : null,
    m.protokoll ? h('p', { class: `measure-details ${m.protokoll.schadenStufe === 'erheblich' ? 'warn-line' : ''}` }, `Protokoll: ${protokollKurz(m.protokoll)}`) : null,
    progress,
    gebieteVon(m).length ? h('p', { class: 'measure-details schutz-zeile' }, 'Schutzgebiet: ',
      gebieteVon(m).map((g, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'link-btn', onclick: () => zeigeVerordnung({ label: g.art, layer: g.layer, props: g.props || {}, text: '' }) }, `${g.art} „${g.name || 'ohne Namen'}“`)])) : null,
    vorpruefungNoetig(m)
      ? h('p', { class: 'warn-line' }, `Termin in der Brut- und Setzzeit (${schutzzeitText(schutzzeitVon(m))}, Schutzgebiet) – verschieben oder `, h('button', { type: 'button', class: 'link-btn', onclick: () => openVertraeglichkeit(m.id) }, 'Verträglichkeits-Vorprüfung ausfüllen'), '.') : null,
    h('div', { class: 'measure-actions' },
      action,
      m.type === 'schaden' ? h('button', { class: 'btn btn-voll', onclick: () => import('./schaden.js').then((x) => x.schadenMelden(m.id)) }, m.schaden?.gemeldet ? 'Erneut an FBG melden' : 'An FBG melden') : null,
      m.type === 'schaden' && m.status !== 'fertig' ? h('button', { class: 'btn btn-voll', onclick: () => { store.update((st) => { const x = st.measures.find((y) => y.id === m.id); if (x) { x.status = 'fertig'; x.finishedAt = Date.now(); x.details = { ...x.details, behoben: new Date().toLocaleDateString('de-DE') }; } }); toast('Schaden als behoben markiert'); } }, 'Als behoben markieren') : null,
      m.type === 'schaden' && (m.schaden?.punkte?.length || m.schaden?.pos) ? h('button', { class: 'btn btn-voll', onclick: () => window.dispatchEvent(new CustomEvent('ww:karte-punkt', { detail: { at: m.schaden.punkte?.[0]?.at || m.schaden.pos, ebene: 'meineSchaeden' } })) }, 'In der Karte zeigen') : null,
      m.type !== 'durchforstung' && m.type !== 'schaden' && !m.serie && m.status !== 'fertig' ? h('button', { class: 'btn btn-status', title: m.status === 'geplant' ? 'Als begonnen markieren' : 'Als erledigt markieren', onclick: () => {
        if (m.status === 'geplant') { store.update((s) => { const x = s.measures.find((y) => y.id === m.id); x.status = 'arbeit'; }); if (AUSZEICHNEN.includes(m.type)) import('./auszeichnen.js').then((x) => x.openAuszeichnen(m.id)); }
        else openProtokoll(m.id, { abschliessen: true }); // Erledigt: gleich das Abschlussprotokoll anbieten
      } }, h('span', { html: m.status === 'geplant' ? icon.play : icon.checkmark }), m.status === 'geplant' ? 'Begonnen' : 'Erledigt') : null,
      auszeichnenOffen(m) ? fortsetzenKnopf(m, 'btn-voll btn-auszeichnen')
        : AUSZEICHNEN.includes(m.type) && m.status !== 'fertig' ? h('button', { class: 'btn btn-voll btn-auszeichnen', onclick: () => import('./auszeichnen.js').then((x) => x.openAuszeichnen(m.id)) }, `Auszeichnung ansehen / ändern (${m.auszeichnung?.baeume?.length || 0} Bäume)`) : null,
      m.status === 'fertig' && !m.serie && m.type !== 'schaden' ? h('button', { class: 'btn btn-voll', onclick: () => openProtokoll(m.id) }, m.protokoll ? 'Protokoll ansehen' : 'Protokoll ausfüllen') : null,
      !m.serie && !['schaden', 'holzverkauf', 'polter'].includes(m.type) ? h('button', { class: 'btn btn-voll', title: 'Arbeitsauftrag mit Karte als PDF', onclick: () => import('./arbeitsauftrag.js').then((x) => x.arbeitsauftragAusfuellen(m.id)).catch(() => toast('Arbeitsauftrag konnte nicht erstellt werden.')) }, h('span', { html: icon.auftrag }), 'Arbeitsauftrag') : null,
      h('span', { class: 'measure-icons' },
        m.status !== 'fertig' && m.type !== 'durchforstung' ? knopf(icon.edit, 0, 'Bearbeiten', () => openMassnahmeBearbeiten(m.id)) : null,
        knopf(icon.camera, fotoAnzahl(`m:${m.id}`) + (m.fotopunkte || []).reduce((a, id) => a + fotoAnzahl(`fp:${id}`), 0), 'Fotos', () => fotosWaehlen(m, `${MEASURE_TYPES[m.type]?.label || 'Maßnahme'} · ${where}`)),
        knopf(icon.history, m.anhaenge?.length || 0, 'Verlauf und Anhänge', () => openVerlauf(m.id)),
        m.type !== 'durchforstung' && !m.serie ? knopf(icon.map, m.flaeche?.ring ? 1 : 0, m.flaeche?.ring ? `Fläche: ${formatHa(m.flaeche.ha)} – ändern` : 'Fläche hinterlegen', () => openFlaecheHinterlegen(m.id)) : null,
        m.type === 'polter' ? knopf(icon.zaehlen, 0, 'Stämme auf Foto zählen', () => import('./stirnzaehlung.js').then((x) => x.openStirnZaehlung({ onFertig: (n, blob) => { store.update((st) => { const y = st.measures.find((q) => q.id === m.id); if (y) y.details = { ...y.details, stueck: String(n) }; }); import('./fotos.js').then((f) => f.fotoHinzufuegen(`m:${m.id}`, blob, 'vorher', 'polter-zaehlung.jpg')); toast(`${n} Stämme gezählt`); } }))) : null,
        m.anhaenge?.some((a) => a.typ === 'pflanzplan') ? knopf(icon.doc, 0, 'Pflanzplan (PDF) öffnen', () => anhangOeffnen(m.id, [...m.anhaenge].reverse().find((a) => a.typ === 'pflanzplan'))) : null,
      h('button', { class: 'icon-btn danger', 'aria-label': 'Maßnahme löschen', title: 'Löschen', html: icon.trash, onclick: async () => {
        if (await confirmDialog('Möchtest du diese Maßnahme wirklich löschen?', { ok: 'Löschen', danger: true })) {
          store.update((s) => { s.measures = s.measures.filter((x) => x.id !== m.id); });
          fotosLoeschen(`m:${m.id}`);
          toast('Maßnahme gelöscht');
        }
      } })),
    ),
  );
}

/** Arbeitsauftrag sofort anzeigen – für alle Maßnahmen, für die es einen gibt */
export function arbeitsauftragZeigen(id) {
  const m = store.get().measures.find((x) => x.id === id);
  if (!m || m.serie || ['schaden', 'holzverkauf', 'polter'].includes(m.type)) return;
  setTimeout(() => import('./arbeitsauftrag.js').then((b) => b.arbeitsauftragAusfuellen(id)).catch(() => toast('Der Arbeitsauftrag konnte nicht erstellt werden – du findest ihn später bei der Maßnahme.')), 300);
}

async function openNewMeasure({ parcelId, antragId = null, typ = null, pflegeArt = null } = {}) {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id] && passtFlurstueck(p));
  const seiten = []; // geöffnete Seiten – nach dem Speichern alle schließen
  const neueSeite = (titel, inhalt) => { const pg = openPage(titel, inhalt, { onClose: () => { const k = seiten.indexOf(pg); if (k >= 0) seiten.splice(k, 1); } }); seiten.push(pg); return pg; };
  const alleSchliessen = () => [...seiten].reverse().forEach((pg) => pg.close());
  const kachel = (label, info, onclick, feature = false) => h('button', { class: `type-tile ${feature ? 'type-feature' : ''}`, onclick }, h('strong', {}, label), info ? h('span', {}, info) : null);

  // Förderung: bei förderfähigen Maßnahmen vorher fragen; beim Hinzufügen zu einem Antrag ist sie gesetzt
  async function starte(k, weiter) {
    let foerdern = !!antragId;
    if (!foerdern && FOERDER[k]) { const w = await fragFoerderung(k, MEASURE_TYPES[k].label); if (w == null) return; foerdern = w; }
    weiter(foerdern);
  }
  const nachSpeichern = (foerdern) => (id) => {
    alleSchliessen();
    // Nach dem Anlegen direkt den Arbeitsauftrag mit Karte zeigen (zum Weitergeben an den Unternehmer)
    const erste = Array.isArray(id) ? id[0] : id;
    const mt = store.get().measures.find((x) => x.id === erste)?.type;
    // Holzernte: nach dem Anlegen direkt ins Auszeichnen – der Arbeitsauftrag kommt danach mit den Bäumen
    if (!foerdern && id && AUSZEICHNEN.includes(mt)) { import('./auszeichnen.js').then((x) => x.openAuszeichnen(erste)); return; }
    if (!foerdern && id) arbeitsauftragZeigen(erste);
    if (!foerdern || !id) return;
    if (Array.isArray(id)) antragFuer(id, antragId); else weiterZumAntrag(id, antragId);
  };
  const oeffne = (k) => starte(k, (foerdern) => {
    if (k === 'zaunbau') openZaunPlanung({ parcelId, foerdern, onSaved: nachSpeichern(foerdern) });
    else if (k === 'einzelschutz') import('./einzelschutz.js').then(({ openEinzelschutzPlanung }) => openEinzelschutzPlanung({ parcelId, foerdern, onSaved: nachSpeichern(foerdern) }));
    else if (k === 'pflanzung') openPflanzPlanung({ parcelId, foerdern, onSaved: nachSpeichern(foerdern) });
    else if (k === 'pflege') import('./pflege.js').then(({ openPflegePlanung }) => openPflegePlanung({ parcelId, foerdern, art: pflegeArt, onSaved: nachSpeichern(foerdern) }));
    else if (k === 'schaden') import('./schaden.js').then((x) => x.openSchadensmeldung({ parcelId, onSaved: alleSchliessen }));
    else if (k === 'holzverkauf') { alleSchliessen(); import('./schaden.js').then((x) => x.openHolzVerkaufen({ parcelId })); }
    else if (AUSZEICHNEN.includes(k)) import('./flaechekarte.js').then(async ({ flaecheAufKarte }) => {
      const w = await flaecheAufKarte({ titel: MEASURE_TYPES[k].label, frage: 'Wo soll Holz geerntet werden?', parcelId });
      if (w) formularSeite(k, foerdern, w);
    });
    else formularSeite(k, foerdern);
  });

  // Direkt eine bestimmte Maßnahme öffnen (z. B. aus der Finanzplanung)
  if (typ && MEASURE_TYPES[typ]) { oeffne(typ); return; }

  // Zum Förderantrag hinzufügen: nur förderfähige Maßnahmen
  if (antragId) {
    neueSeite('Maßnahme zum Förderantrag', h('div', { class: 'new-measure' },
      h('h2', { class: 'step-title' }, 'Welche Maßnahme soll in den Förderantrag?'),
      h('div', { class: 'type-grid einspaltig' }, Object.keys(FOERDER).map((k) => kachel(MEASURE_TYPES[k].label, FOERDER[k].gegenstand, () => oeffne(k)))),
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => { alleSchliessen(); openFoerderantrag({ antragId, schritt: 'zusammenfassung' }); } }, 'Doch keine – zurück zum Antrag')));
    return;
  }

  // Seite 1: Art der Maßnahme. Gruppen: Holzernte (Durchforstung mit GPS, Durchforstung, Holzvermessung) und Wildschutz (Zaunbau, Einzelschutz)
  const GRUPPEN = {
    vorbereitung: { label: 'Flächenvorbereitung', info: 'Handräumung / maschinell, Bodenverwundung, streifenweises Mulchen', frage: 'Welche Flächenvorbereitung?' },
    kultur: { label: 'Kulturbegründung', info: 'Pflanzung, Saat', frage: 'Wie wird die Kultur begründet?' },
    wildschutz: { label: 'Wildschutz', info: 'Zaunbau, Einzelschutz', frage: 'Welcher Wildschutz?' },
    pflege: { label: 'Pflege', info: 'Pflege von Beständen im Jungwaldstadium', frage: 'Welche Pflege?' },
    holzernte: { label: 'Holzernte', info: 'Holzernte mit Auszeichnen, Durchforstung nach Masterarbeit, bodenschonende Verfahren, Holzvermessung, Holz verkaufen', frage: 'Welche Holzernte?' },
  };
  neueSeite('Neue Maßnahme', h('div', { class: 'new-measure' },
    h('h2', { class: 'step-title' }, 'Art der Maßnahme'),
    h('div', { class: 'type-grid' },
      Object.entries(GRUPPEN).map(([g, x]) => kachel(x.label, x.info, () => gruppenSeite(g), true)),
      Object.entries(MEASURE_TYPES).filter(([, t]) => !t.gruppe).map(([k, t]) => kachel(t.label, FOERDER[k] ? 'förderfähig' : null, () => oeffne(k))))));

  // Seite 2: Maßnahmen einer Gruppe
  function gruppenSeite(g) {
    neueSeite(GRUPPEN[g].label, h('div', { class: 'new-measure' },
      h('h2', { class: 'step-title' }, GRUPPEN[g].frage),
      h('div', { class: 'type-grid einspaltig' },
        Object.entries(MEASURE_TYPES).filter(([, t]) => t.gruppe === g).map(([k, t]) => kachel(t.label, FOERDER[k] ? `${t.info} · förderfähig` : t.info, () => {
          if (k === 'durchforstung') { alleSchliessen(); openThinningWizard({ parcelId }); return; }
          if (k === 'polter') { openPolterVermessung({ parcelId, onSaved: alleSchliessen }); return; }
          oeffne(k);
        })))));
  }

  // Seite 3: Eingabe der Maßnahme
  function formularSeite(type, foerdern = false, vorwahl = null) {
    const t = MEASURE_TYPES[type];
    const vp = vorwahl?.parcel || null;
    const flHost = h('div', { class: 'flaeche-host' });
    let wahl = null;
    const schutzHost = h('div');
    let setzeHa = () => {};
    let gezeichnet = null; // Teilflächen aus der Kartenwahl (Modus „Fläche einzeichnen“)
    const zeigeWahl = (id) => {
      if (vorwahl) { // Fläche kommt aus der Kartenwahl (auch fremde Flurstücke oder selbst eingezeichnet)
        if (vp) { wahl = flaechenWahl(vp, null, { onChange: (f) => setzeHa(f?.ha) }); flHost.append(wahl.el); } else setzeHa((vorwahl.ringe || [vorwahl.ring]).reduce((x, r) => x + areaHa(r), 0));
        const sel = vp || { ring: vorwahl.ring, polys: (vorwahl.ringe || [vorwahl.ring]).map((r) => [r]) };
        import('./schutzpruefung.js').then((x) => schutzHost.replaceChildren(x.schutzHinweis(sel, { eingriff: EINGRIFF.includes(type) })));
        return;
      }
      wahl?.entferne(); wahl = null; flHost.replaceChildren(); schutzHost.replaceChildren();
      if (id === '__ring' && gezeichnet?.length) { // frei eingezeichnete Fläche(n), auch ohne bzw. über Flurstücke hinweg
        const ha = gezeichnet.reduce((x, r) => x + areaHa(r), 0);
        setzeHa(ha);
        flHost.append(h('p', { class: 'hint' }, `${gezeichnet.length > 1 ? `${gezeichnet.length} Teilflächen` : 'Eingezeichnete Fläche'}, zusammen ${formatHa(ha)}. Ändern: „oder Fläche auf der Karte wählen“ noch einmal antippen.`));
        import('./schutzpruefung.js').then((x) => schutzHost.replaceChildren(x.schutzHinweis({ ring: gezeichnet[0], polys: gezeichnet.map((r) => [r]) }, { eingriff: EINGRIFF.includes(type) })));
        return;
      }
      if (!id) flHost.append(h('p', { class: 'hint' }, 'Nach der Wahl der Fläche kannst du festlegen, ob die Maßnahme das ganze Flurstück betrifft oder nur eine oder mehrere Teilflächen, die du in der Karte einzeichnest.'));
      if (!id) setzeHa(null);
      if (id && byId[id]) { wahl = flaechenWahl(byId[id], null, { onChange: (f) => setzeHa(f?.ha) }); flHost.append(wahl.el); import('./schutzpruefung.js').then((x) => schutzHost.replaceChildren(x.schutzHinweis(byId[id], { eingriff: EINGRIFF.includes(type) }))); }
    };
    const form = h('form', { class: 'form', onsubmit: (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const frei = fd.get('parcel') === '__ring' && gezeichnet?.length ? gezeichnet : null;
      const vRinge = vorwahl?.ring ? (vorwahl.ringe || [vorwahl.ring]) : frei;
      const fl = vRinge ? { modus: 'teil', ring: vRinge[0], ringe: vRinge, ha: vRinge.reduce((x, r) => x + areaHa(r), 0) } : wahl ? wahl.wert() : null;
      if (wahl && !fl) { toast('Bitte mindestens 3 Eckpunkte der Teilfläche einzeichnen.'); return; }
      let kosten = String(fd.get('kosten') || '').trim();
      if (type === 'einzelschutz' && !kosten) { const n = Number(fd.get('count')) || 0, pr = Number(String(fd.get('preis') || '').replace(',', '.')) || 0; if (n && pr) kosten = String(Math.round(n * pr * 100) / 100); }
      const details = Object.fromEntries(t.fields.map(([k]) => [k, String(fd.get(k) || '').trim()]));
      const neuId = uid();
      store.update((s) => {
        const eigen = vp && s.parcels.some((x) => x.id === vp.id);
        s.measures.push({ id: neuId, type, parcelId: vorwahl ? (vp?.id || null) : frei ? null : (fd.get('parcel') || null),
          ...(vp && !eigen ? { flurstueck: flurstueckSchnappschuss(vp) } : {}),
          ...(vorwahl?.ring || frei ? { ort: `Eingezeichnete Fläche (${formatHa(vRinge.reduce((x, r) => x + areaHa(r), 0))})` } : {}), date: fd.get('date') ? new Date(fd.get('date')).getTime() : null,
          note: String(fd.get('note') || '').trim(), details, status: 'geplant', createdAt: Date.now(),
          ...(fl?.modus === 'teil' ? { flaeche: { ring: fl.ring, ringe: fl.ringe, ha: fl.ha } } : {}), kosten: kosten ? Number(kosten.replace(',', '.')) : null,
          ...(type === 'verkehrssicherung' ? { date: null, serie: { termine: VSP_TERMINE.map((x) => ({ ...x })) }, erledigt: {} } : {}) });
      });
      toast(`${t.label} gebucht`);
      nachSpeichern(foerdern)(neuId);
    } },
      foerdern ? h('div', { class: 'lrt-hinweis ok' }, h('strong', {}, 'Mit Förderantrag'), h('p', {}, 'Nach dem Buchen geht es direkt mit dem Förderantrag weiter. Die Angaben hier werden übernommen.')) : null,
      h('h2', { class: 'step-title' }, 'Fläche und Angaben'),
      vorwahl ? h('div', { class: 'fk-gewaehlt' }, h('span', { class: 'sheet-label' }, 'Fläche'),
        h('p', {}, vp ? `Flurstück ${vp.nr}, ${vp.gemarkung}, Flur ${vp.flur}${store.get().parcels.some((x) => x.id === vp.id) ? '' : ' (nicht in „Meine Flächen“)'}` : `Eingezeichnete Fläche${(vorwahl.ringe || []).length > 1 ? ` (${vorwahl.ringe.length} Teilflächen)` : ''}, ${formatHa((vorwahl.ringe || [vorwahl.ring]).reduce((x, r) => x + areaHa(r), 0))}`)) :
      h('label', {}, 'Fläche',
        mitKartenwahl(h('select', { name: 'parcel', onchange: (e) => zeigeWahl(e.target.value) },
          h('option', { value: '' }, mine.length ? 'Fläche wählen' : 'Noch keine eigenen Flächen'),
          mine.map((p) => h('option', { value: p.id, selected: p.id === parcelId }, `Flurstück ${p.nr}, ${p.gemarkung} (${CATEGORIES[p.category].label}, ${formatHa(amtlicheFlaecheHa(byId[p.id]))})`)),
        ), byId, mine, { zeichnen: true, onRinge: (r) => { gezeichnet = r; } })),
      t.gruppe === 'vorbereitung' ? h('p', { class: 'hint' }, 'Förderung: Räumung, Bodenverwundung und streifenweises Mulchen werden als Kulturvorbereitung zusammen mit der Pflanzung gefördert (Richtlinie 530 €/ha bzw. 1.300 €/ha Mulchen). Im Förderantrag der Pflanzung unter „Kulturvorbereitung“ angeben.') : null,
      flHost, schutzHost,
      AUSZEICHNEN.includes(type) ? h('p', { class: 'hint' }, 'Anzahl der Bäume und die Menge brauchst du hier nicht anzugeben: Nach dem Anlegen geht es direkt ins Auszeichnen. Dort tippst du je Baum die Durchmesserstufe an – die App zählt mit und setzt GPS-Punkte.') : null,
      t.fields.filter(([k]) => !(AUSZEICHNEN.includes(type) && ['baeume', 'menge'].includes(k))).map(([k, label, kind]) => h('label', {}, label,
        Array.isArray(kind) ? h('select', { name: k }, kind.map((o) => h('option', {}, o)))
          : kind === 'species' ? h('select', { name: k }, SPECIES.map((o) => h('option', {}, o)))
          : h('input', { name: k, type: kind === 'number' ? 'number' : 'text', inputmode: kind === 'decimal' ? 'decimal' : kind === 'number' ? 'numeric' : null, min: kind === 'number' ? 0 : null }))),
      h('label', {}, 'Geplanter Termin', h('input', { type: 'date', name: 'date' })),
      h('label', {}, 'Kosten (€, optional)', h('input', { name: 'kosten', type: 'number', inputmode: 'decimal', min: 0, step: '0.01' })),
      h('label', {}, 'Notiz', h('textarea', { name: 'note', rows: 3 })),
      h('button', { class: 'btn btn-primary btn-block btn-large', type: 'submit' }, AUSZEICHNEN.includes(type) && !foerdern ? 'Anlegen und Bäume auszeichnen' : `${t.label} buchen`),
    );
    neueSeite(t.label, h('div', { class: 'new-measure' }, form));
    setzeHa = flaecheAutomatisch(form);
    zeigeWahl(vorwahl ? null : parcelId);
  }
}
