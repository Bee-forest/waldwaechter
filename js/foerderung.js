// Forstförderung Thüringen: Abfrage „Soll die Maßnahme gefördert werden?“, Hinweise auf Förderbedingungen und
// Assistent, der den amtlichen Förderantrag ausfüllt:
//  • Thüringer Richtlinie zur Förderung forstwirtschaftlicher Maßnahmen 2025, Teil A (Formular GANW 26)
//  • Thüringer Landesprogramm zur Bewältigung der Folgen von Extremwetterereignissen im Wald (Formular LABE 25)
import { h, fill, openPage, toast, dialog } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { centroid, formatHa, polysOf } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { Pdf, herunterladen } from './pdf.js';
import { BAUMARTEN, baumart, normBaumart, num, euro, kategorie, KAT_TEXT, KAT_TEXT_LABE, LABE_KATS, berechne, bagatelle, pruefeMischung,
  pflanzen, hoeheCm, zaunArt, zaunLaenge, haVon, werteGANW, werteLABE, seitenHinweis, SAETZE, datum } from './foerder-formular.js';

export const LINKS = {
  foerderung: 'https://www.thueringenforst.de/angebote-produkte/forstamtsservice/forstfoerderung',
  formulare: 'https://www.thueringenforst.de/aktuelles-service/service/formularcenter/formulare-forstfoerderung',
  forstaemter: 'https://www.thueringenforst.de/ueber-uns/standorte/forstaemter',
};
export const PROGRAMME = {
  GANW: { kurz: 'Richtlinie Teil A – Naturnahe Waldbewirtschaftung', formularKurz: 'ganw',
    name: 'Thüringer Richtlinie zur Förderung forstwirtschaftlicher Maßnahmen 2025, Teil A – Naturnahe Waldbewirtschaftung',
    formular: 'Antrag Naturnahe Waldbewirtschaftung (GANW 26)',
    wann: 'Für alle Waldbesitzenden: Wiederaufforstung (auch nach Sturm, Dürre oder Käfer), Voranbau, Nachbesserung, Schutz und Sicherung der Kultur, Jungwaldpflege, Holzrücken mit Pferd oder Seilkran.' },
  LABE: { kurz: 'Landesprogramm – Folgen von Extremwetter', formularKurz: 'labe',
    name: 'Thüringer Landesprogramm zur Bewältigung der Folgen von Extremwetterereignissen im Wald',
    formular: 'Antrag Landesprogramm (LABE 25)',
    wann: 'Nur bei bis zu 20 ha Waldbesitz in Thüringen und für Flächen, die durch Extremwetter (Sturm, Dürre, Borkenkäfer) geschädigt wurden. Höhere Festbeträge, Pflanzgut bis 100 %. Keine Jungwaldpflege und keine Holzernte.' },
};
/** Landesprogramm nur bei Kalamitätsfläche und höchstens 20 ha Waldbesitz – sonst Richtlinie Teil A */
export function empfehleProgramm({ schaden, besitzHa, kats = [] }) {
  const labeMoeglich = schaden === 'ja' && besitzHa != null && besitzHa <= 20 && kats.every((k) => !k || LABE_KATS.includes(k));
  return labeMoeglich ? 'LABE' : 'GANW';
}

// Allgemeine Förderbedingungen (Richtlinie 2025 Nr. IV, VII; Landesprogramm Nr. 4, 6)
export const ALLGEMEIN = [
  'Erst beginnen, wenn der Zuwendungsbescheid vorliegt – oder der vorzeitige Beginn genehmigt ist. Als Beginn zählt schon die Bestellung (z. B. von Pflanzen).',
  'Eigenleistung ist förderfähig: Die Festbeträge (je Pflanze, je lfm Zaun, je ha) gibt es auch, wenn du selbst arbeitest. Material wie Pflanzgut wird nach Rechnung gefördert.',
  'Der Antrag wird unterschrieben im Original beim Forstamt eingereicht. Für 2026 sind die Antragsstichtage aufgehoben; das Landesprogramm hat keine Fristen.',
  'Für den Antrag brauchst du einen forstwirtschaftlichen Personenident (PI Forst).',
];
// Förderfähige Maßnahmen und ihre besonderen Bedingungen
export const FOERDER = {
  pflanzung: {
    gegenstand: 'Wiederaufforstung, Voranbau oder Nachbesserung',
    bedingungen: [
      'Mindestens 40 % Laubbäume (Landesprogramm: 30 %, Fichte höchstens 30 %); überwiegend standortheimische Baumarten.',
      'Auf Flächen über 1 ha darf eine Baumart höchstens 75 % ausmachen.',
      'Herkunftsempfehlungen sind bindend – die Herkunft weist du mit der Pflanzenrechnung nach.',
      'Nicht gefördert: Wiederaufforstung von Kahlschlägen ohne Schadereignis und Nachbesserung wegen Wildverbiss oder mangelnder Pflege.',
    ],
  },
  zaunbau: {
    gegenstand: 'Schutz der Kultur: Wildschutzzaun',
    bedingungen: [
      'Gefördert wird der Zaun zum Schutz einer Kultur – mit 1,60 m Höhe gegen Rehwild, 2,00 m gegen Rotwild.',
      'Festbetrag je laufendem Meter: Richtlinie 5,40 € (Reh) / 7,70 € (Rot), Landesprogramm 7,00 € / 10,00 €.',
    ],
  },
  einzelschutz: {
    gegenstand: 'Schutz der Kultur: Einzelschutz',
    bedingungen: [
      'Nur Material ohne Kunststoff (Landesprogramm: ohne erdölbasierte Kunststoffe) – klassische Kunststoff-Wuchshüllen werden nicht gefördert.',
      'Gefördert wird Einzelschutz ab 1,20 m Höhe (120–150 cm und ab 180 cm).',
    ],
  },
  pflege: {
    gegenstand: 'Sicherung der Kultur oder Jungwaldpflege',
    bedingungen: [
      'Sicherung der Kultur (z. B. Mahd verdämmender Vegetation): in den ersten fünf Jahren nach der Pflanzung, jedes Jahr ein eigener Antrag.',
      'Jungwuchs- und Dickungspflege (Mischungs- und Standraumregulierung bis 7 cm BHD) nur über die Richtlinie Teil A. Wertastung wird nicht gefördert.',
    ],
  },
  holzernte_df: {
    gegenstand: 'Bodenschonende Holzernte mit Rückepferd oder Seilkran',
    bedingungen: [
      'Nur über die Richtlinie Teil A (A 2.4) und nur beim Einsatz von Rückepferden oder Seilkran – befristet bis 31.12.2026.',
      'Pferde: 10,40 €/fm abfuhrbereites Rücken bzw. 5,60 €/fm Vorliefern; Seilkran: bis 65 % der Mehrausgaben.',
    ],
  },
};
export const istFoerderfaehig = (type) => !!FOERDER[type];

/** Vor dem Anlegen fragen, ob die Maßnahme gefördert werden soll. Ergebnis: true / false / null (abgebrochen) */
export function fragFoerderung(type, label) {
  const f = FOERDER[type];
  return dialog({
    title: `${label} fördern lassen?`,
    body: h('div', { class: 'foerder-frage' },
      h('p', {}, `Diese Maßnahme ist in Thüringen förderfähig (${f.gegenstand}). Wenn du möchtest, füllt die App nach der Eingabe direkt den amtlichen Förderantrag aus.`),
      h('p', { class: 'sheet-label' }, 'Das musst du beachten'),
      h('ul', { class: 'lrt-punkte' }, [...f.bedingungen, ALLGEMEIN[0]].map((t) => h('li', {}, t)))),
    actions: [{ label: 'Ohne Förderung', value: false }, { label: 'Ja, Förderung beantragen', value: true, primary: true }],
  });
}

// ---------- Antrag ----------
const antragVon = (id) => store.get().foerderantraege?.find((a) => a.id === id);
function neuerAntrag(measureIds) {
  const p = store.get().profile;
  const a = { id: uid(), erstellt: Date.now(), status: 'entwurf', massnahmen: [...measureIds],
    daten: { name: p.name || '', strasse: p.strasse || '', ort: p.ort || '', telefon: p.telefon || '', email: p.email || '', pi: p.pi || '',
      rechtsform: p.rechtsform || 'natuerlich', geburtsdatum: p.geburtsdatum || '', geburtsort: p.geburtsort || '', zuHaenden: '',
      rolle: 'eigentuemer', eigentum: 'ja', alleinig: 'ja', ust: p.ust || '', steuernummer: p.steuernummer || '', website: '',
      vorzeitig: 'nein', forstamt: '', m: {}, erkl: {} } };
  store.update((s) => { (s.foerderantraege ||= []).push(a); measureIds.forEach((id) => { const m = s.measures.find((x) => x.id === id); if (m) m.foerderung = { antragId: a.id }; }); });
  return a.id;
}
export function zumAntragHinzufuegen(antragId, measureId) {
  store.update((s) => {
    const a = s.foerderantraege?.find((x) => x.id === antragId);
    if (a && !a.massnahmen.includes(measureId)) a.massnahmen.push(measureId);
    const m = s.measures.find((x) => x.id === measureId);
    if (m) m.foerderung = { antragId };
  });
}

/** Nach dem Speichern einer Maßnahme mit Förderwunsch: Antrag fortsetzen bzw. neu beginnen */
export function weiterZumAntrag(measureId, antragId = null) {
  if (antragId && antragVon(antragId)) { zumAntragHinzufuegen(antragId, measureId); openFoerderantrag({ antragId, schritt: 'massnahmen' }); }
  else openFoerderantrag({ antragId: neuerAntrag([measureId]) });
}

const SCHRITTE = ['programm', 'antragsteller', 'flaeche', 'massnahmen', 'erklaerungen', 'weitere', 'zusammenfassung'];
const TITEL = { programm: 'Welches Förderprogramm passt?', antragsteller: 'Antragsteller', flaeche: 'Waldfläche, Forstamt und Schutzgebiete', massnahmen: 'Angaben zu den Maßnahmen', erklaerungen: 'Beginn und Erklärungen', weitere: 'Noch eine Maßnahme?', zusammenfassung: 'Antrag prüfen und herunterladen' };
const monat = (t) => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export async function openFoerderantrag({ antragId, schritt = null, nurLesen = false } = {}) {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const MT = (await import('./measures.js')).MEASURE_TYPES;
  let i = schritt ? SCHRITTE.indexOf(schritt) : nurLesen ? SCHRITTE.length - 1 : 0;
  const body = h('div', { class: 'antrag' });
  const page = openPage('Förderantrag', body);
  const a0 = antragVon(antragId);
  if (!a0) { page.close(); toast('Antrag nicht gefunden'); return; }
  const d = structuredClone(a0.daten);
  d.m ||= {}; d.erkl ||= {};
  const speichere = (patch = {}) => store.update((s) => { const a = s.foerderantraege.find((x) => x.id === antragId); if (a) { a.daten = structuredClone(d); Object.assign(a, patch); } });
  const ms = () => (antragVon(antragId)?.massnahmen || []).map((id) => store.get().measures.find((m) => m.id === id)).filter(Boolean);
  const ctx = { parcel: (id) => byId[id] || store.get().parcels.find((p) => p.id === id) || null, parcelHa: (id) => (byId[id] ? amtlicheFlaecheHa(byId[id]) : 0) };
  const prog = () => (PROGRAMME[d.programm] ? d.programm : 'GANW');
  const kats = () => ms().map((m) => kategorie(m, d.m[m.id] || {}));

  // Vorbelegung je Maßnahme
  for (const m of ms()) {
    const x = (d.m[m.id] ||= {});
    if (!x.beginn && m.date) x.beginn = monat(m.date);
    if (!x.ende && x.beginn) x.ende = x.beginn;
    if (!x.abrechnung) x.abrechnung = (x.ende || x.beginn || monat(Date.now())).slice(0, 4);
    if (m.type === 'pflanzung' && !x.baumarten) x.baumarten = pflanzen(m, x).map((b) => ({ ...b, stueck: num(b.stueck) || '' }));
    if (m.type === 'pflege' && !x.pflegeArt) x.pflegeArt = kategorie(m, x) || 'wertastung';
  }
  // Besitzgröße: Summe der eigenen Waldflurstücke
  if (d.besitzHa == null || d.besitzHa === '') {
    const wald = store.get().parcels.filter((p) => (p.category || 'Wald') === 'Wald').map((p) => byId[p.id] || p);
    const ha = wald.reduce((a, p) => a + (amtlicheFlaecheHa(p) || 0), 0);
    if (ha) d.besitzHa = String(Math.round(ha * 100) / 100).replace('.', ',');
  }
  // Forstamt, Waldschadfläche und Natura 2000 aus dem Geoportal
  const p0 = ms().map((m) => byId[m.parcelId]).find(Boolean);
  if (p0 && (!d.forstamt || d.schadenKarte == null || d.natura == null)) import('./map/geoinfo.js').then((g) => g.queryPoint(centroid(p0.ring))).then((info) => {
    const fa = info?.zustaendig?.Forstamt;
    if (fa && !d.forstamt) d.forstamt = `Forstamt ${fa}`;
    if (!info?.failed) {
      d.schadenKarte = (info.wald || []).some((x) => x.layer === 'waldschaeden'); if (!d.schaden) d.schaden = d.schadenKarte ? 'ja' : '';
      const nr = (f) => Object.entries(f.props || {}).find(([k]) => /nr|nummer|code|kenn/i.test(k))?.[1] || '';
      const name = (f) => Object.entries(f.props || {}).find(([k]) => /name/i.test(k))?.[1] || '';
      d.natura = true;
      for (const f of info.schutz || []) {
        if (f.layer === 'ffh_geb' && !d.ffh) d.ffh = [nr(f), name(f)].filter(Boolean).join(' ') || 'ja';
        if (f.layer === 'spa' && !d.spa) d.spa = [nr(f), name(f)].filter(Boolean).join(' ') || 'ja';
      }
    }
    speichere(); if (['flaeche', 'programm'].includes(SCHRITTE[i])) render();
  }).catch(() => {});

  const feld = (label, key, attrs = {}, obj = d, hint = null) => h('label', {}, label, h('input', { value: obj[key] ?? '', ...attrs, oninput: (e) => { obj[key] = e.target.value; speichere(); } }), hint ? h('small', { class: 'hint' }, hint) : null);
  const auswahl = (label, key, opts, obj = d, onchg) => h('label', {}, label, h('select', { onchange: (e) => { obj[key] = e.target.value; speichere(); onchg?.(); } },
    obj[key] ? null : h('option', { value: '' }, 'bitte wählen'), opts.map(([v, l]) => h('option', { value: v, selected: obj[key] === v }, l))));
  const jaNein = (label, key, obj = d, onchg = render) => auswahl(label, key, [['ja', 'Ja'], ['nein', 'Nein']], obj, onchg);
  const hinweis = (text, art = 'warn') => h('p', { class: art === 'warn' ? 'warn-line' : 'ok-line' }, text);
  const katText = (k) => (prog() === 'LABE' ? KAT_TEXT_LABE[k] : KAT_TEXT[k]) || 'nicht förderfähig';

  function pruefungen() {
    const out = [];
    const P = prog();
    const liste = ms();
    for (const m of liste) {
      const x = d.m[m.id] || {};
      const name = MT[m.type]?.label || m.type;
      const k = kategorie(m, x);
      if (!k) out.push(m.type === 'pflege' ? 'Pflege: Wertastung wird nicht gefördert.' : `${name}: Gefördert wird nur das Rücken mit Pferden oder der Seilkraneinsatz – mit diesem Verfahren ist die Holzernte nicht förderfähig.`);
      else if (P === 'LABE' && !LABE_KATS.includes(k)) out.push(`${name}: ${KAT_TEXT[k]} gibt es nur über die Richtlinie Teil A – dafür einen eigenen Antrag (GANW) stellen oder das Programm wechseln.`);
      if (m.date && m.date < Date.now() - 86400000 && d.vorzeitig !== 'ja') out.push(`${name}: Der geplante Termin liegt in der Vergangenheit. Begonnene Maßnahmen werden nicht gefördert.`);
      if (k === 'kultur' || k === 'nachbesserung') {
        if (!pflanzen(m, x).length) out.push('Pflanzung: Baumarten und Stückzahlen angeben.');
        if (pflanzen(m, x).some((b) => !b.hsn) && !num(x.wildlinge)) out.push('Pflanzung: Herkunftsgebiet (HSN) je Baumart angeben – die Herkunftsempfehlungen sind bindend.');
        if (num(x.pflanzgutKosten) && !x.firma) out.push('Pflanzung: Firma und Datum des Angebots für das Pflanzgut angeben.');
      }
      if (k === 'nachbesserung') {
        if (x.ursache === 'wild' || x.ursache === 'pflege') out.push('Nachbesserung: Ausfälle durch Wildverbiss oder mangelnde Pflege werden nicht gefördert.');
        if (num(x.ausfallProzent) && num(x.ausfallProzent) <= 30 && haVon(m, ctx) < 1) out.push('Nachbesserung: Gefördert erst bei mehr als 30 % Ausfall oder 1 ha zusammenhängender Ausfallfläche.');
        if (!x.vorgang) out.push('Nachbesserung: Vorgangsnummer der geförderten Kultur angeben.');
      }
      if (k === 'kultur' && x.art === 'wiederaufforstung' && x.schadUrsache === 'nein') out.push('Pflanzung: Die Wiederaufforstung von Kahlschlägen ohne Schadereignis ist nicht förderfähig (Voranbau unter Schirm schon).');
      if (k === 'einzelschutz') {
        const cm = hoeheCm(m.details?.hoehe);
        if (!cm) out.push('Einzelschutz: Höhe angeben (gefördert ab 120 cm).');
        else if (cm < 120) out.push(`Einzelschutz: ${cm} cm sind zu niedrig – gefördert wird erst ab 120 cm.`);
        else if (cm > 150 && cm < 180) out.push(`Einzelschutz: ${cm} cm liegen zwischen den Förderstufen – gefördert wird wie 120–150 cm.`);
        if (x.kunststofffrei !== true) out.push('Einzelschutz: Nur Material ohne Kunststoff wird gefördert – bitte bestätigen.');
      }
      if ((k === 'zaun' || k === 'einzelschutz') && !kats().some((y) => y === 'kultur' || y === 'nachbesserung') && x.kultur !== 'ja') out.push(`${name}: Gefördert wird der Schutz einer Kultur. Füge die Pflanzung hinzu oder bestätige, dass eine Kultur geschützt wird.`);
      if (k === 'zaun' && !zaunLaenge(m)) out.push('Zaunbau: Zaunlänge fehlt.');
      if (k === 'sicherung') {
        const j = Number(x.pflanzjahr);
        if (j && new Date().getFullYear() - j > 5) out.push(`Pflege: Die Kultur ist älter als fünf Jahre (Pflanzjahr ${j}) – Sicherung der Kultur nur in den ersten fünf Jahren.`);
        if (!x.vorhaben) out.push('Sicherung der Kultur: Die geplanten Arbeiten müssen im Antrag beschrieben werden (z. B. Mahd verdämmender Vegetation).');
      }
      if (k === 'jungwuchs' && num(x.mittelhoehe) > 2) out.push('Pflege: Bei mehr als 2 m Mittelhöhe ist es Dickungspflege.');
      if (k === 'dickung' && num(x.mittelhoehe) && num(x.mittelhoehe) <= 2) out.push('Pflege: Bis 2 m Mittelhöhe ist es Jungwuchspflege.');
      if (k === 'seilkran' && !num(x.mehrkosten)) out.push('Seilkran: Mehrausgaben gegenüber dem Standardverfahren angeben (Angebot).');
      if (k === 'pferd' && !num(x.fm || m.details?.menge)) out.push('Rückepferd: Holzmenge in fm angeben.');
      if (x.abrechnung && x.beginn && x.abrechnung < x.beginn.slice(0, 4)) out.push(`${name}: Abrechnungsjahr liegt vor dem Beginn.`);
    }
    out.push(...pruefeMischung(P, liste, d, ctx));
    if (P === 'LABE') {
      if (d.schaden !== 'ja') out.push('Programm: Das Landesprogramm fördert nur Folgemaßnahmen nach Extremwetter (Kalamitätsfläche) – sonst Richtlinie Teil A wählen.');
      if (num(d.besitzHa) > 20) out.push('Programm: Das Landesprogramm gilt nur bei höchstens 20 ha Waldbesitz in Thüringen – sonst Richtlinie Teil A.');
    }
    const { summe } = berechne(P, d, liste, ctx);
    const bg = bagatelle(P, kats().filter(Boolean));
    if (summe && summe < bg) out.push(`Die erwartete Förderung (${euro(summe)}) liegt unter der Bagatellgrenze von ${euro(bg)} – so wird sie nicht bewilligt. Weitere Maßnahmen oder Flächen hinzufügen.`);
    if (!d.pi) out.push('Personenident (PI Forst) fehlt – die App füllt dir den „Antrag auf Vergabe eines PI Forst“ gleich mit aus.');
    if (d.ust === 'regel') out.push('Vorsteuerabzug: Gefördert werden nur Nettokosten – Pflanzgut und Mehrausgaben netto angeben.');
    if (d.rechtsform !== 'oeffentlich' && kats().some((k) => k === 'kultur' || k === 'nachbesserung' || k === 'seilkran') && liste.some((m) => num(d.m[m.id]?.pflanzgutKosten) >= 1000 || num(d.m[m.id]?.mehrkosten) >= 1000)) out.push('Angebote: Für Pflanzgut bzw. Seilkran drei vergleichbare Angebote beilegen (unter 1 000 € netto reicht eines).');
    return out;
  }

  function render() {
    const q = SCHRITTE[i];
    const liste = ms();
    let inhalt = [];
    if (q === 'programm') {
      const besitz = num(d.besitzHa) || null;
      const empf = empfehleProgramm({ schaden: d.schaden, besitzHa: besitz, kats: kats() });
      if (!PROGRAMME[d.programm]) d.programm = empf;
      const moeglich = (k) => k === 'GANW' || (d.schaden === 'ja' && (besitz == null || besitz <= 20));
      inhalt = [
        h('p', { class: 'muted' }, 'Für Pflanzung, Zaun, Einzelschutz und Pflege gibt es in Thüringen zwei Wege. Welcher passt, hängt davon ab, ob die Fläche durch Extremwetter geschädigt ist und wie groß dein Waldbesitz ist.'),
        auswahl('Ist die Fläche durch Sturm, Dürre oder Borkenkäfer geschädigt (Kalamitätsfläche)?', 'schaden', [['ja', 'Ja – Schad- oder Kalamitätsfläche'], ['nein', 'Nein – Waldumbau oder Voranbau im gesunden Bestand']], d, () => { d.programm = ''; render(); }),
        d.schadenKarte != null ? h('p', { class: 'hint' }, d.schadenKarte ? 'Laut Karte „Waldschadflächen“ von ThüringenForst liegt das Flurstück in einer Schadfläche.' : 'In der Karte „Waldschadflächen“ von ThüringenForst ist hier keine Schadfläche verzeichnet.') : null,
        h('label', {}, 'Wie groß ist dein gesamter Waldbesitz in Thüringen (ha)?', h('input', { inputmode: 'decimal', value: d.besitzHa || '', oninput: (e) => { d.besitzHa = e.target.value; d.programm = ''; speichere(); }, onchange: () => render() }),
          h('small', { class: 'hint' }, 'Vorbelegt aus deinen Waldflurstücken in der App – kommt so auch in den Antrag (Nr. 106/107).')),
        h('p', { class: 'sheet-label' }, 'Förderprogramm'),
        h('div', { class: 'q-cards' }, Object.entries(PROGRAMME).map(([k, pr]) => h('button', { type: 'button', class: `q-option ${d.programm === k ? 'on' : ''}`, disabled: !moeglich(k), onclick: () => { d.programm = k; speichere(); render(); } },
          h('span', { class: 'q-text' }, h('strong', {}, `${pr.kurz}${k === empf ? ' – empfohlen' : ''}`), h('small', {}, pr.wann), h('small', {}, `Formular: ${pr.formular}`))))),
        d.schaden === 'ja' && besitz != null && besitz <= 20
          ? h('p', { class: 'hint' }, `Beispiel Pflanzung: Richtlinie ${euro(SAETZE.GANW.pflanzung)} je Pflanze und 75–85 % des Pflanzguts, Landesprogramm ${euro(SAETZE.LABE.pflanzung)} je Pflanze und bis 100 % des Pflanzguts. Dieselbe Maßnahme darf nur aus einem Programm gefördert werden.`)
          : null,
        h('p', { class: 'hint' }, 'Teil E der Richtlinie (Extremwetter) fördert keine Wiederaufforstung, sondern Borkenkäferbekämpfung, Holzlagerplätze und Waldbrandvorsorge.'),
      ];
      speichere();
    } else if (q === 'antragsteller') {
      inhalt = [
        auswahl('Antragsteller ist (Nr. 101)', 'rechtsform', [['natuerlich', 'natürliche Person'], ['privat', 'juristische Person des Privatrechts (z. B. GmbH, Verein, Waldgenossenschaft)'], ['oeffentlich', 'juristische Person des öffentlichen Rechts (z. B. Gemeinde)']], d, render),
        feld(d.rechtsform === 'natuerlich' ? 'Name, Vorname' : 'Bezeichnung', 'name'),
        d.rechtsform !== 'natuerlich' ? feld('zu Händen', 'zuHaenden') : null,
        feld('Straße, Hausnummer', 'strasse'), feld('PLZ, Wohnort', 'ort'),
        feld('Telefon', 'telefon', { type: 'tel' }), feld('E-Mail', 'email', { type: 'email' }),
        feld(d.rechtsform === 'natuerlich' ? 'Geburtsdatum' : 'Gründungsdatum', 'geburtsdatum', { type: 'date' }),
        feld(d.rechtsform === 'natuerlich' ? 'Geburtsort' : 'Unternehmenssitz', 'geburtsort'),
        feld('Personenident (PI Forst)', 'pi', { placeholder: 'falls vorhanden', onchange: render }, d, 'Noch keiner? Lass das Feld leer – die App füllt dir den Antrag auf Vergabe eines PI Forst mit aus.'),
        !d.pi ? [auswahl('Mitgliedschaft in einer Forstbetriebsgemeinschaft (für den PI-Antrag)', 'fbg', [['kein', 'kein FBG-Mitglied'], ['mitglied', 'FBG-Mitglied'], ['fbg', 'Ich beantrage als FBG']], d, render),
          d.fbg && d.fbg !== 'kein' ? feld('Name der FBG', 'fbgName') : null,
          jaNein('Bewirtschaftest du auch landwirtschaftliche Flächen?', 'landwirtschaft', d, () => {})] : null,
        auswahl('Du stellst den Antrag als', 'rolle', [['eigentuemer', 'Eigentümer/in bzw. Pächter/in'], ['bevollmaechtigt', 'Bevollmächtigte/r (Vollmacht liegt bei)']], d, render),
        jaNein('Bist du Eigentümer/in der beantragten Fläche? (Nr. 103)', 'eigentum'),
        d.eigentum === 'nein' ? hinweis('Bei Pachtflächen muss die Zustimmung des Grundeigentümers beiliegen.') : jaNein('Bist du alleinige/r Eigentümer/in? (Nr. 104)', 'alleinig'),
        d.eigentum === 'ja' && d.alleinig === 'nein' ? hinweis('Bei Miteigentum müssen die Vollmachten der Miteigentümer beiliegen.') : null,
        auswahl('Umsatzsteuer (Nr. 105 und Erklärung zum Vorsteuerabzug)', 'ust', [['kein', 'Ich bin kein Unternehmer – Kosten brutto'], ['pauschal', 'Pauschalbesteuerung nach § 24 UStG – Kosten brutto'], ['regel', 'Regelbesteuerung nach § 12 UStG – vorsteuerabzugsberechtigt, Kosten netto']], d, render),
        d.ust && d.ust !== 'kein' ? feld('Steuernummer des Forstbetriebs', 'steuernummer') : null,
        prog() === 'GANW' ? feld('Website oder Social-Media-Seite des Betriebs (Nr. 414)', 'website', { placeholder: 'leer lassen, wenn keine' }) : null,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) store.update((s) => Object.assign(s.profile, { name: d.name, strasse: d.strasse, ort: d.ort, telefon: d.telefon, email: d.email, pi: d.pi, rechtsform: d.rechtsform, geburtsdatum: d.geburtsdatum, geburtsort: d.geburtsort, ust: d.ust, steuernummer: d.steuernummer })); } }), 'Diese Angaben in meinem Profil speichern'),
      ];
    } else if (q === 'flaeche') {
      const parcels = [...new Set(liste.map((m) => m.parcelId).filter(Boolean))].map((id) => byId[id]).filter(Boolean);
      inhalt = [
        parcels.length ? h('dl', { class: 'parcel-facts' }, parcels.map((p) => h('div', {}, h('dt', {}, `${p.gemeinde && p.gemeinde !== '–' ? `${p.gemeinde}, ` : ''}Gemarkung ${p.gemarkung}, Flur ${p.flur}`), h('dd', {}, `Flurstück ${p.nr} · ${formatHa(amtlicheFlaecheHa(p))}`))))
          : hinweis('Keine Flurstücke zugeordnet – ordne die Maßnahmen einem deiner Flurstücke zu.'),
        h('p', { class: 'muted' }, 'Gemeinde, Gemarkung, Flur und Flurstück kommen aus dem ALKIS direkt ins Flächenverzeichnis des Antrags.'),
        feld('Zuständiges Forstamt', 'forstamt', { placeholder: 'wird aus dem Geoportal ermittelt' }),
        h('p', { class: 'hint' }, h('a', { href: LINKS.forstaemter, target: '_blank', rel: 'noopener' }, 'Übersicht der Forstämter')),
        prog() === 'LABE' ? feld('Aktuelle Schadfläche in deinem Forstbetrieb (ha, alle Wuchsklassen)', 'schadHa', { inputmode: 'decimal' }) : null,
        prog() === 'GANW' ? feld('FFH-Gebiet Nr. (Nr. 107)', 'ffh', { placeholder: 'leer, wenn nicht im FFH-Gebiet' }, d, d.natura ? 'Aus der Schutzgebietskarte von Thüringen vorbelegt.' : null) : null,
        prog() === 'GANW' ? feld('Vogelschutzgebiet (SPA) Nr.', 'spa', { placeholder: 'leer, wenn nicht im SPA' }) : null,
      ];
    } else if (q === 'massnahmen') {
      inhalt = liste.map((m) => massnahmeKarte(m));
    } else if (q === 'erklaerungen') {
      const E = [['nichtBegonnen', 'Ich habe mit den Vorhaben noch nicht begonnen (auch nichts bestellt) und beginne erst nach dem Zuwendungsbescheid bzw. der Genehmigung des vorzeitigen Beginns.'],
        ['eigenmittel', 'Die nötigen Eigenmittel stehen zur Verfügung; ich bin nicht insolvent und habe meine Steuerpflichten erfüllt.'],
        ['keineDoppel', 'Für dieselben Vorhaben beantrage oder erhalte ich keine anderen Fördermittel; Versicherungsleistungen gebe ich an.'],
        ['zweckbindung', 'Ich erhalte und pflege die geförderte Kultur und halte die Zweckbindung ein.'],
        ['richtig', 'Meine Angaben sind vollständig und richtig (subventionserheblich, § 264 StGB). Änderungen teile ich dem Forstamt unverzüglich mit.']];
      inhalt = [
        jaNein(`Möchtest du einen vorzeitigen Vorhabensbeginn beantragen? (${prog() === 'LABE' ? 'Nr. 316' : 'Nr. 418'})`, 'vorzeitig'),
        d.vorzeitig === 'ja' ? [feld('Beginn gewünscht ab', 'vorzeitigAb', { type: 'date' }), h('label', {}, 'Begründung', h('textarea', { rows: 3, oninput: (e) => { d.vorzeitigGrund = e.target.value; speichere(); } }, d.vorzeitigGrund || '')),
          hinweis('Auch dann erst beginnen, wenn das Forstamt den vorzeitigen Beginn schriftlich genehmigt hat. Ein Anspruch auf Förderung entsteht dadurch nicht.')] : null,
        h('p', { class: 'sheet-label' }, 'Erklärungen im Antrag (Teil 3/4)'),
        h('div', { class: 'erkl-liste' }, E.map(([k, t]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!d.erkl[k], onchange: (e) => { d.erkl[k] = e.target.checked; speichere(); } }), t))),
        h('p', { class: 'hint' }, 'Den vollständigen Wortlaut liest du im ausgefüllten Formular vor der Unterschrift.')];
    } else if (q === 'weitere') {
      inhalt = [h('p', {}, `Im Antrag: ${liste.map((m) => MT[m.type]?.label || m.type).join(', ')}.`),
        h('p', { class: 'muted' }, 'Soll noch eine Maßnahme dazu? Zum Beispiel zum Zaunbau die Pflanzung, die er schützt.'),
        h('div', { class: 'q-cards' },
          h('button', { type: 'button', class: 'q-option', onclick: () => { page.close(); window.dispatchEvent(new CustomEvent('ww:new-measure', { detail: { antragId, parcelId: liste[0]?.parcelId || null } })); } },
            h('span', { class: 'q-text' }, h('strong', {}, 'Ja, Maßnahme hinzufügen'), h('small', {}, prog() === 'LABE' ? 'Pflanzung, Zaunbau, Einzelschutz oder Sicherung der Kultur' : 'Pflanzung, Zaunbau, Einzelschutz, Pflege oder Holzrücken mit Pferd/Seilkran'))),
          h('button', { type: 'button', class: 'q-option', onclick: () => { i++; render(); } },
            h('span', { class: 'q-text' }, h('strong', {}, 'Nein, Antrag abschließen'), h('small', {}, 'Prüfen und herunterladen'))))];
    } else {
      inhalt = [zusammenfassung()];
    }
    const pr = q === 'zusammenfassung' || q === 'massnahmen' ? pruefungen() : [];
    fill(body,
      h('div', { class: 'q-progress' }, SCHRITTE.map((_, k) => h('span', { class: k < i ? 'done' : k === i ? 'now' : '' }))),
      h('h2', { class: 'step-title' }, TITEL[q]),
      pr.length ? h('div', { class: 'lrt-hinweis brutzeit' }, h('strong', {}, 'Förderbedingungen beachten'), h('ul', { class: 'lrt-punkte' }, pr.map((t) => h('li', {}, t)))) : null,
      h('div', { class: 'antrag-inhalt' }, inhalt),
      q === 'weitere' ? null : h('div', { class: 'q-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => { if (i === 0) page.close(); else { i--; render(); } } }, i === 0 ? 'Später weiter' : 'Zurück'),
        q === 'zusammenfassung'
          ? h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: abschliessen }, 'Antrag speichern')
          : h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => { i++; render(); } }, 'Weiter')));
    body.closest('.page-body')?.scrollTo?.(0, 0);
  }

  function baumartenEditor(x) {
    const box = h('div', { class: 'baumarten' });
    const zeichne = () => fill(box,
      h('p', { class: 'sheet-label' }, 'Pflanzen je Baumart'),
      x.baumarten.map((b, k) => h('div', { class: 'baumart-zeile' },
        h('select', { 'aria-label': 'Baumart', onchange: (e) => { b.art = e.target.value; speichere(); } },
          h('option', { value: '' }, 'Baumart'), BAUMARTEN.map((a) => h('option', { value: a.name, selected: normBaumart(b.art) === a.name }, `${a.name}${a.laub ? '' : ' (Nadel)'}`)),
          b.art && !baumart(b.art) ? h('option', { value: b.art, selected: true }, b.art) : null),
        h('input', { inputmode: 'numeric', placeholder: 'Stück', 'aria-label': 'Stückzahl', value: b.stueck ?? '', oninput: (e) => { b.stueck = e.target.value; speichere(); } }),
        h('input', { placeholder: 'HSN', 'aria-label': 'Herkunft (HSN)', value: b.hsn || '', oninput: (e) => { b.hsn = e.target.value; speichere(); } }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Entfernen', onclick: () => { x.baumarten.splice(k, 1); speichere(); zeichne(); } }, '×'))),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { x.baumarten.push({ art: '', stueck: '', hsn: '' }); speichere(); zeichne(); } }, '+ Baumart'),
      h('small', { class: 'hint' }, 'HSN = Herkunftsschlüsselnummer laut Lieferschein bzw. Angebot der Baumschule (z. B. 810 08 für Rotbuche). Entfällt bei Wildlingen.'));
    zeichne();
    return box;
  }

  function massnahmeKarte(m) {
    const x = (d.m[m.id] ||= {});
    const t = MT[m.type]?.label || m.type;
    const det = m.details || {};
    const ha = haVon(m, ctx);
    const k = kategorie(m, x);
    const zeile = (kk, v) => (v ? h('div', {}, h('dt', {}, kk), h('dd', {}, v)) : null);
    const extra = [];
    const pi = (label, key, attrs = {}) => h('label', {}, label, h('input', { value: x[key] ?? '', ...attrs, oninput: (e) => { x[key] = e.target.value; speichere(); } }));
    if (m.type === 'pflanzung') {
      extra.push(
        auswahl('Art der Kulturbegründung', 'art', [['wiederaufforstung', 'Wiederaufforstung (Schad- oder Freifläche)'], ['voranbau', 'Voranbau unter Schirm'], ['nachbesserung', 'Nachbesserung einer geförderten Kultur']], x, render),
        x.art === 'wiederaufforstung' ? jaNein('Ist die Freifläche durch ein Schadereignis entstanden (Sturm, Dürre, Käfer, Schnee)?', 'schadUrsache', x) : null,
        x.art === 'nachbesserung' ? [pi('Ausfall der Pflanzen (%)', 'ausfallProzent', { inputmode: 'decimal' }), auswahl('Ursache des Ausfalls', 'ursache', [['natur', 'natürliche Ereignisse (Trockenheit, Frost, Mäuse …)'], ['wild', 'Wildverbiss'], ['pflege', 'mangelnde Pflege']], x, render), pi('Vorgangsnummer der geförderten Kultur', 'vorgang')] : null,
        baumartenEditor(x),
        x.art !== 'nachbesserung' ? auswahl('Kulturvorbereitung', 'vorbereitung', [['keine', 'keine'], ['raeumung', 'Handräumung, maschinelle Räumung oder Bodenverwundung'], ['mulchen', 'streifenweises Mulchen']], x, render) : null,
        x.vorbereitung && x.vorbereitung !== 'keine' ? pi(`Fläche der Kulturvorbereitung (ha, sonst ${formatHa(ha)})`, 'vorbereitungHa', { inputmode: 'decimal' }) : null,
        pi('Davon Wildlinge (Stück)', 'wildlinge', { inputmode: 'numeric' }),
        x.art !== 'nachbesserung' ? pi('Markierungsstäbe ab 1,20 m (Stück, kein Einzelschutz)', 'staebe', { inputmode: 'numeric' }) : null,
        prog() === 'GANW' ? auswahl('Werden ausschließlich standortheimische Baumarten gepflanzt?', 'standortheimisch', [['ja', 'Ja – Pflanzgut zu 85 % gefördert'], ['nein', 'Nein – standort- und herkunftsgerecht, 75 %']], x, render) : null,
        pi(`Kosten Pflanzgut laut Angebot (${d.ust === 'regel' ? 'netto' : 'brutto'}, €)`, 'pflanzgutKosten', { inputmode: 'decimal' }),
        pi('Baumschule / Firma des Angebots', 'firma'), pi('Datum des Angebots', 'angebotDatum', { type: 'date' }),
        pi('Sortiment (Bemerkung zu den Pflanzen)', 'sortiment', { placeholder: 'z. B. 1+1, 50–80 cm' }));
    }
    if (m.type === 'zaunbau') extra.push(
      h('p', { class: 'muted' }, `${zaunLaenge(m) ? `${zaunLaenge(m).toLocaleString('de-DE')} lfm` : 'Länge fehlt'} · ${zaunArt(m, x) === 'rot' ? 'Rotwild (2,00 m)' : 'Rehwild (1,60 m)'} – aus der Zaunplanung.`),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!x.hordengatter, onchange: (e) => { x.hordengatter = e.target.checked; speichere(); render(); } }), 'Es ist ein Hordengatter (2,00 m)'));
    if (m.type === 'einzelschutz') extra.push(
      h('p', { class: 'muted' }, `${num(det.count) || '?'} Stück, Höhe ${det.hoehe || 'nicht angegeben'}${det.art ? `, ${det.art}` : ''}.`),
      /wuchshülle/i.test(det.art || '') ? hinweis('Wuchshüllen sind meist aus Kunststoff und dann nicht förderfähig – nur kunststofffreie Hüllen (z. B. Holz, Pappe) oder Drahthosen.') : null,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: x.kunststofffrei === true, onchange: (e) => { x.kunststofffrei = e.target.checked; speichere(); } }), 'Das Material enthält keinen Kunststoff'));
    if (m.type === 'zaunbau' || m.type === 'einzelschutz') extra.push(auswahl('Welche Kultur wird geschützt?', 'kultur', [['ja', 'Vorhandene oder geplante Kultur / Naturverjüngung'], ['nein', 'Keine Kultur']], x, render));
    if (m.type === 'pflege') {
      extra.push(auswahl('Welche Pflege?', 'pflegeArt', [['sicherung', 'Sicherung der Kultur (erste 5 Jahre, z. B. Mahd, Mäusebekämpfung)'],
        ...(prog() === 'GANW' ? [['jungwuchs', 'Jungwuchspflege (bis 2 m Mittelhöhe)'], ['dickung', 'Dickungspflege (über 2 m, unter 7 cm BHD)']] : []), ['wertastung', 'Wertastung (nicht förderfähig)']], x, render));
      if (x.pflegeArt === 'sicherung') extra.push(
        pi('Jahr der Pflanzung (Kulturbegründung)', 'pflanzjahr', { type: 'number', min: 1990, max: 2100 }),
        auswahl('Wievielter Antrag auf Sicherung dieser Kultur?', 'mal', [1, 2, 3, 4, 5].map((n) => [String(n), `${n}. Mal`]), x),
        pi('Vorgangsnummer der Kulturbegründung', 'vorgang'),
        pi('Geplante Arbeiten (werden im Antrag verbal angegeben)', 'vorhaben', { placeholder: 'z. B. Mahd verdämmender Vegetation' }));
      if (x.pflegeArt === 'jungwuchs' || x.pflegeArt === 'dickung') extra.push(pi('Mittelhöhe des Bestands (m)', 'mittelhoehe', { inputmode: 'decimal' }));
    }
    if (m.type === 'holzernte_df' && k === 'pferd') extra.push(
      auswahl('Art des Rückens', 'pferdArt', [['abfuhr', 'abfuhrbereites Rücken bis zum Polterplatz'], ['vorliefern', 'Vorliefern oder Anrücken im Bestand']], x, render),
      pi('Holzmenge (fm)', 'fm', { inputmode: 'decimal', placeholder: det.menge || '' }));
    if (m.type === 'holzernte_df' && k === 'seilkran') extra.push(pi(`Mehrausgaben gegenüber dem Standardverfahren (${d.ust === 'regel' ? 'netto' : 'brutto'}, €)`, 'mehrkosten', { inputmode: 'decimal' }));
    const post = berechne(prog(), d, [m], ctx);
    return h('section', { class: 'antrag-massnahme' },
      h('h3', {}, t),
      h('p', { class: k && (prog() === 'GANW' || LABE_KATS.includes(k)) ? 'ok-line' : 'warn-line' }, katText(k)),
      h('dl', { class: 'parcel-facts' },
        zeile('Fläche', ha ? `${m.flaeche ? 'Teilfläche' : 'Flurstück'}, ${formatHa(ha)}` : null),
        Object.entries(det).filter(([, v]) => v !== '' && v != null).map(([kk, v]) => { const f = MT[m.type]?.fields.find((y) => y[0] === kk); return f ? zeile(f[1].replace(/ \(.*\)/, ''), String(v)) : null; })),
      extra,
      h('div', { class: 'zwei-spalten' },
        pi('Beginn (Monat)', 'beginn', { type: 'month' }), pi('Ende (Monat)', 'ende', { type: 'month' })),
      pi('Abrechnung bis 15.11. des Jahres', 'abrechnung', { type: 'number', min: 2025, max: 2035 }),
      post.posten.length ? h('div', { class: 'foerder-posten' }, h('p', { class: 'sheet-label' }, 'Erwartete Förderung'),
        h('ul', { class: 'mat-kurz' }, post.posten.map((p) => h('li', {}, `${p.text} = ${euro(p.betrag)}`))), h('p', {}, h('strong', {}, euro(post.summe)))) : null);
  }

  function zusammenfassung() {
    const liste = ms();
    const P = prog();
    const pr = PROGRAMME[P];
    const { posten, summe } = berechne(P, d, liste, ctx);
    const offen = [['Name', d.name], ['Anschrift', d.strasse && d.ort], ['Rechtsform', d.rechtsform], ['Umsatzsteuer', d.ust], ['Forstamt', d.forstamt]].filter(([, v]) => !v).map(([k]) => k);
    const erklOffen = ['nichtBegonnen', 'eigenmittel', 'keineDoppel', 'zweckbindung', 'richtig'].filter((k) => !d.erkl[k]).length;
    const status = h('p', { class: 'hint' });
    const lade = async (art) => {
      status.textContent = 'Formular wird ausgefüllt …';
      try {
        const { formularAusfuellen } = await import('./formfill.js');
        if (art === 'antrag') {
          const werte = P === 'LABE' ? werteLABE(d, liste, ctx) : werteGANW(d, liste, ctx);
          herunterladen(await formularAusfuellen(pr.formularKurz, werte), `Antrag_${P}_${dateiName()}.pdf`);
        } else if (art === 'pi') {
          herunterladen(await formularAusfuellen('pi', werteVergabePI()), `Antrag_PI_Forst_${dateiName()}.pdf`);
        }
        status.textContent = 'Heruntergeladen. Ausdrucken, prüfen, unterschreiben und beim Forstamt einreichen.';
      } catch (e) {
        console.error(e);
        status.textContent = 'Das Formular konnte nicht geladen werden – bitte mit Internetverbindung erneut versuchen.';
      }
    };
    return h('div', { class: 'antrag-zusammen' },
      offen.length ? hinweis(`Noch offen: ${offen.join(', ')}.`) : hinweis('Alle Pflichtangaben sind ausgefüllt.', 'ok'),
      erklOffen ? hinweis(`${erklOffen} Erklärung${erklOffen > 1 ? 'en' : ''} noch nicht bestätigt.`) : null,
      h('dl', { class: 'parcel-facts' },
        h('div', {}, h('dt', {}, 'Förderprogramm'), h('dd', {}, pr.name)),
        h('div', {}, h('dt', {}, 'Formular'), h('dd', {}, pr.formular)),
        h('div', {}, h('dt', {}, 'Antragsteller'), h('dd', {}, [d.name, d.strasse, d.ort].filter(Boolean).join(', ') || '–')),
        h('div', {}, h('dt', {}, 'Einreichen bei'), h('dd', {}, d.forstamt || 'zuständiges Forstamt'))),
      h('h3', { class: 'sheet-label' }, 'Erwartete Förderung'),
      posten.length ? h('ul', { class: 'mat-kurz' }, posten.map((p) => h('li', {}, `${p.text} = ${euro(p.betrag)}`))) : h('p', { class: 'muted' }, 'Noch keine förderfähigen Angaben.'),
      h('p', {}, h('strong', {}, `Summe: ${euro(summe)}`)),
      h('p', { class: 'hint' }, 'Berechnet mit den Festbeträgen und Fördersätzen der Richtlinie bzw. des Landesprogramms. Die genaue Höhe setzt die Bewilligungsstelle fest.'),
      h('h3', { class: 'sheet-label' }, 'Herunterladen'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => lade('antrag') }, `Amtlichen Antrag ausgefüllt (${P === 'LABE' ? 'LABE 25' : 'GANW 26'})`),
        h('button', { type: 'button', class: 'btn', onclick: () => pdfErstellen() }, 'Lageplan und Übersicht (Anlage Karte)'),
        !d.pi ? h('button', { type: 'button', class: 'btn', onclick: () => lade('pi') }, 'Antrag auf PI Forst') : null),
      status,
      h('h3', { class: 'sheet-label' }, 'So geht es weiter'),
      h('ol', { class: 'mess-liste' },
        h('li', {}, `Ausdrucken: ${seitenHinweis(P, kats().filter(Boolean))}. Die übrigen Seiten gehören zu anderen Maßnahmen.`),
        h('li', {}, 'Alles prüfen; was die App nicht kennt (z. B. Angaben zur Beihilfe und KMU-Eigenschaft im Mantelbogen), im PDF oder von Hand ergänzen.'),
        h('li', {}, `Anlagen beifügen: Lageplan (Karte)${kats().some((k) => k === 'kultur' || k === 'nachbesserung' || k === 'seilkran') ? ', Angebote' : ''}${d.alleinig === 'nein' || d.rolle === 'bevollmaechtigt' ? ', Vollmacht(en)' : ''}${d.eigentum === 'nein' ? ', Zustimmung des Grundeigentümers' : ''}.`),
        h('li', {}, 'Auf jeder Seite mit Unterschriftsfeld unterschreiben und im Original beim Forstamt einreichen.'),
        h('li', {}, d.vorzeitig === 'ja' ? 'Erst beginnen, wenn das Forstamt den vorzeitigen Beginn genehmigt hat.' : 'Erst nach Erhalt des Zuwendungsbescheids beginnen – auch nichts vorher bestellen.')));
  }

  const dateiName = () => (d.name || 'Waldbesitz').replace(/[^\wäöüÄÖÜß-]+/g, '_');
  function werteVergabePI() {
    // Antrag auf Vergabe eines forstwirtschaftlichen Personenidents (Formular des Forstamts)
    const m = /^\s*(\d{5})\s*(.*)$/.exec(d.ort || '');
    const nat = d.rechtsform === 'natuerlich';
    const gd = [datum(d.geburtsdatum), d.geburtsort].filter(Boolean).join(', ');
    return {
      'Personen Name Vorname Unternehmen InstitutionBezeichnung': d.name, 'Ansprechpartner nicht bei Privatpersonen': nat ? '' : d.zuHaenden,
      GeburtsdatumGeburtsort: nat ? gd : '', GründungsdatumUnternehmenssitz: nat ? '' : gd,
      'Straße Hausnummer Postfach': d.strasse, Postleitzahl: m ? m[1] : '', Wohnort: m ? m[2] : d.ort, TelefonMobilfunk: d.telefon, EMail: d.email,
      'kein FBG Mitglied': d.fbg === 'kein', 'FBG Mitglied': d.fbg === 'mitglied', FBG: d.fbg === 'fbg', 'Name der FBG': d.fbg && d.fbg !== 'kein' ? d.fbgName : '',
      Forstwirtschaft: true, 'natürliche Person': nat, 'Juristische Person des Privatrechts': d.rechtsform === 'privat', 'Juristische Person des öffentlichen Rechts': d.rechtsform === 'oeffentlich',
      ja: true, ...(d.landwirtschaft === 'ja' ? { ja_2: true } : { nein_2: true }), Nein: true, Datum: datum(Date.now()),
    };
  }

  // ---------- Lageplan und Übersicht (Anlage „Kartenmäßige Darstellung“) ----------
  function pdfErstellen() {
    const liste = ms();
    const P = prog();
    const pr = PROGRAMME[P];
    const doc = new Pdf();
    const L = 50, R = 545, LW = 150;
    let y = 50;
    const platz = (hoehe) => { if (y + hoehe > 800) { fuss(); doc.neueSeite(); y = 50; } };
    let seite = 1;
    const fuss = () => { doc.linie(L, 812, R, 812); doc.text(L, 825, `Anlage zum ${pr.formular} – Kartenmäßige Darstellung und Übersicht (WaldWächter)`, { size: 7.5, farbe: [90, 100, 90] }); doc.text(R - 40, 825, `Seite ${seite++}`, { size: 7.5, farbe: [90, 100, 90] }); };
    const titel = (t) => { platz(34); y += 10; doc.text(L, y, t, { bold: true, size: 12.5, farbe: [27, 77, 46] }); y += 6; doc.linie(L, y, R, y, { w: 1, farbe: [27, 77, 46] }); y += 14; };
    const zeile = (k, v) => {
      const zl = doc.umbrechen(v == null || v === '' ? '–' : String(v), R - L - LW, { size: 9.5 });
      platz(zl.length * 12 + 4);
      doc.text(L, y, k, { bold: true, size: 9, farbe: [70, 80, 70] });
      zl.forEach((t, k2) => doc.text(L + LW, y + k2 * 12, t, { size: 9.5 }));
      y += zl.length * 12 + 4;
    };
    doc.text(L, y, 'Lageplan der beantragten Flächen', { bold: true, size: 16, farbe: [27, 77, 46] }); y += 18;
    zeile('Antragsteller', [d.name, d.strasse, d.ort].filter(Boolean).join(', '));
    zeile('Förderprogramm', pr.name);
    zeile('Forstamt', d.forstamt);
    const parcels = [...new Set(liste.map((m) => m.parcelId).filter(Boolean))].map((id) => byId[id]).filter(Boolean);
    titel('Karte im Maßstab 1:10 000');
    y = lageplan(doc, parcels, liste, y, true);
    if (lageplanDetail) { titel('Detailkarte'); y = lageplan(doc, parcels, liste, y, false); }
    titel('Flächen und Maßnahmen');
    parcels.forEach((p) => zeile(`Gemarkung ${p.gemarkung}`, `${p.gemeinde && p.gemeinde !== '–' ? `Gemeinde ${p.gemeinde}, ` : ''}Flur ${p.flur}, Flurstück ${p.nr}, ${formatHa(amtlicheFlaecheHa(p))} (amtlich)`));
    const { posten, summe } = berechne(P, d, liste, ctx);
    liste.forEach((m) => {
      const x = d.m[m.id] || {};
      const ha = haVon(m, ctx);
      zeile(MT[m.type]?.label || m.type, [katText(kategorie(m, x)), ha ? `${m.flaeche ? 'Teilfläche' : 'Flurstück'} ${formatHa(ha)}` : null,
        x.beginn ? `Durchführung ${x.beginn.slice(5)}/${x.beginn.slice(0, 4)}${x.ende && x.ende !== x.beginn ? `–${x.ende.slice(5)}/${x.ende.slice(0, 4)}` : ''}` : null].filter(Boolean).join(' · '));
    });
    if (posten.length) {
      titel('Erwartete Förderung (Berechnung der App)');
      posten.forEach((p) => zeile(euro(p.betrag), p.text));
      zeile('Summe', euro(summe));
    }
    fuss();
    herunterladen(doc.blob(), `Lageplan_${P}_${dateiName()}.pdf`);
    toast('PDF wird heruntergeladen');
  }

  let lageplanDetail = false;
  function lageplan(doc, parcels, liste, y, fest) {
    // Flurstücke grau, Maßnahmenflächen farbig; lokale Projektion in Metern
    const flaechen = liste.map((m, k) => ({ k, polys: m.flaeche?.ring ? [[m.flaeche.ring]] : m.thinning?.ring ? polysOf(m.thinning) : null, linie: m.zaun && !m.zaun.geschlossen ? m.zaun.pts : null })).filter((f) => f.polys || f.linie);
    const allePunkte = [...parcels.flatMap((p) => polysOf(p).flat(2)), ...flaechen.flatMap((f) => (f.polys ? f.polys.flat(2) : f.linie))];
    if (!allePunkte.length) return y;
    const lat0 = allePunkte.reduce((a, p) => a + p[0], 0) / allePunkte.length;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    const xy = ([la, ln]) => [ln * kx, -la * ky];
    const P = allePunkte.map(xy);
    const minX = Math.min(...P.map((p) => p[0])), maxX = Math.max(...P.map((p) => p[0])), minY = Math.min(...P.map((p) => p[1])), maxY = Math.max(...P.map((p) => p[1]));
    const BX = 50, BB = 495, BH = fest ? 260 : 300;
    // Maßstab 1:10 000 (wie vom Formular verlangt), wenn die Fläche hineinpasst; sonst kleiner
    const pt = 72 / 0.0254; // Punkte je Meter Papier
    const sk10 = pt / 10000;
    const skFit = Math.min((BB - 40) / Math.max(1, maxX - minX), (BH - 40) / Math.max(1, maxY - minY));
    const sk = fest ? Math.min(sk10, skFit) : skFit;
    if (fest) lageplanDetail = skFit > sk10 * 2;
    const massstab = Math.round(pt / sk / 500) * 500;
    if (y + BH + 30 > 800) { doc.neueSeite(); y = 50; }
    const ox = BX + (BB - (maxX - minX) * sk) / 2, oy = y + (BH - (maxY - minY) * sk) / 2;
    const tr = (ll) => { const [a, b] = xy(ll); return [ox + (a - minX) * sk, oy + (b - minY) * sk]; };
    doc.rechteck(BX, y, BB, BH, { stroke: [170, 180, 170], fill: [248, 250, 246] });
    parcels.forEach((p) => polysOf(p).forEach((poly) => doc.polygon(poly.map((r) => r.map(tr)), { fill: [233, 239, 228], stroke: [120, 130, 110], w: 1 })));
    const FARBEN = [[242, 107, 29], [47, 125, 58], [63, 127, 176], [176, 92, 166]];
    flaechen.forEach((f) => {
      const c = FARBEN[f.k % FARBEN.length];
      if (f.polys) f.polys.forEach((poly) => doc.polygon(poly.map((r) => r.map(tr)), { stroke: c, w: 1.8 }));
      else f.linie.slice(1).forEach((pt2, j) => { const [a, b] = tr(f.linie[j]), [c2, d2] = tr(pt2); doc.linie(a, b, c2, d2, { w: 2, farbe: c }); });
    });
    parcels.forEach((p) => { const [cx, cy] = tr(centroid(p.ring)); doc.text(cx - 10, cy, String(p.nr), { size: 7.5, farbe: [60, 70, 60] }); });
    doc.linie(BX + BB - 20, y + 40, BX + BB - 20, y + 16, { w: 1.4, farbe: [40, 50, 40] }); doc.linie(BX + BB - 24, y + 22, BX + BB - 20, y + 16, { w: 1.4, farbe: [40, 50, 40] }); doc.linie(BX + BB - 16, y + 22, BX + BB - 20, y + 16, { w: 1.4, farbe: [40, 50, 40] });
    doc.text(BX + BB - 23, y + 12, 'N', { bold: true, size: 9 });
    const meter = [10, 20, 50, 100, 200, 500, 1000].find((mm) => mm * sk >= 60) || 1000;
    doc.linie(BX + 14, y + BH - 14, BX + 14 + meter * sk, y + BH - 14, { w: 2, farbe: [40, 50, 40] });
    doc.text(BX + 14, y + BH - 20, `${meter} m · Maßstab 1:${massstab.toLocaleString('de-DE')} (bei Druck in Originalgröße)`, { size: 8 });
    y += BH + 8;
    const leg = [['Flurstück', [120, 130, 110]], ...flaechen.map((f) => [`${MT[liste[f.k].type]?.label || ''}`, FARBEN[f.k % FARBEN.length]])];
    let lx = BX;
    leg.forEach(([t, c]) => { doc.rechteck(lx, y - 7, 10, 7, { stroke: c, w: 1.6 }); doc.text(lx + 14, y, t, { size: 8.5 }); lx += 24 + t.length * 4.6; });
    return y + 14;
  }

  function abschliessen() {
    speichere({ status: 'fertig', abgeschlossen: Date.now() });
    store.update((s) => ms().forEach((m0) => {
      const m = s.measures.find((x) => x.id === m0.id);
      if (!m) return;
      m.anhaenge = (m.anhaenge || []).filter((x) => !(x.typ === 'foerderantrag' && x.antragId === antragId));
      m.anhaenge.push({ id: uid(), typ: 'foerderantrag', antragId, titel: `Förderantrag (${PROGRAMME[prog()].formular})`, erstellt: Date.now() });
      (m.historie ||= []).push({ ts: Date.now(), text: 'Förderantrag vorbereitet' });
    }));
    toast('Förderantrag gespeichert – im Verlauf der Maßnahmen abrufbar');
    page.close();
  }
  render();
  return page;
}
