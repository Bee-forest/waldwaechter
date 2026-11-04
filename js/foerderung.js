// Forstförderung Thüringen: Abfrage „Soll die Maßnahme gefördert werden?“, Hinweise auf Förderbedingungen und
// Assistent für den Förderantrag (Thüringer Richtlinie zur Förderung forstwirtschaftlicher Maßnahmen 2025,
// Teil A „Naturnahe Waldbewirtschaftung“, Antrag beim zuständigen Forstamt).
import { h, fill, openPage, toast, dialog } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { centroid, formatHa, polysOf } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { Pdf, herunterladen } from './pdf.js';

export const LINKS = {
  foerderung: 'https://www.thueringenforst.de/angebote-produkte/forstamtsservice/forstfoerderung',
  formulare: 'https://www.thueringenforst.de/aktuelles-service/service/formularcenter/formulare-forstfoerderung',
  forstaemter: 'https://www.thueringenforst.de/ueber-uns/standorte/forstaemter',
};
const FORM = 'https://www.thueringenforst.de/fileadmin/user_upload/PDF/';
// Förderprogramme in Thüringen für Wiederbewaldung, Schutz und Pflege
export const PROGRAMME = {
  GANW: { kurz: 'Richtlinie, Teil A – Naturnahe Waldbewirtschaftung',
    name: 'Thüringer Richtlinie zur Förderung forstwirtschaftlicher Maßnahmen 2025 (in Kraft seit 30.07.2025), Teil A – Naturnahe Waldbewirtschaftung',
    formular: 'Antrag Naturnahe Waldbewirtschaftung (GANW 26)', url: `${FORM}Forstfoerderung__Thueringer_Richtlinie/Antrag_GANW_26_Naturnahe_Waldbewirtschaftung.pdf`,
    wann: 'Waldumbau, Voranbau und Wiederaufforstung ohne Zusammenhang mit einem Extremwetterschaden.' },
  GABE: { kurz: 'Richtlinie, Teil E – Bewältigung von Extremwetterereignissen',
    name: 'Thüringer Richtlinie zur Förderung forstwirtschaftlicher Maßnahmen 2025, Teil E – Bewältigung von Extremwetterereignissen',
    formular: 'Antrag Bewältigung Extremwetterereignisse (GABE 25)', url: `${FORM}Forstfoerderung__Thueringer_Richtlinie/Antrag_GABE_25_Bewaeltigung_von_Extremwetterereignissen.pdf`,
    wann: 'Vorhaben, die unmittelbar mit Schäden durch Sturm, Dürre oder Borkenkäfer zusammenhängen und auf der geschädigten Fläche wieder standortgerechten, klimaangepassten Wald begründen.' },
  LABE: { kurz: 'Thüringer Landesprogramm (Extremwetterfolgen)',
    name: 'Thüringer Landesprogramm zur Bewältigung der Folgen von Extremwetterereignissen im Wald (konsolidierte Fassung, in Kraft seit 26.06.2024)',
    formular: 'Antrag Landesprogramm (LABE 25)', url: `${FORM}Forstfoerderung_Landesprogramm/Antrag_LABE_25_Landesprogramm.pdf`,
    wann: 'Ergänzt die Richtlinie für Vorhaben in Zusammenhang mit Kalamitäten – vor allem für kleine Waldbesitzende. Anträge laufend; das Budget war in den letzten Jahren oft im Jahresverlauf ausgeschöpft.' },
};
/** Empfehlung: ohne Schaden Teil A; Schadfläche und kleiner Besitz (bisher bis 20 ha) Landesprogramm; sonst Teil E */
export function empfehleProgramm({ schaden, besitzHa }) {
  if (schaden !== 'ja') return 'GANW';
  return besitzHa != null && besitzHa <= 20 ? 'LABE' : 'GABE';
}
export const RICHTLINIE = PROGRAMME.GANW.name;

// Allgemeine Förderbedingungen (ThüringenForst, Stand 2026)
export const ALLGEMEIN = [
  'Mit der Maßnahme erst beginnen, wenn der Zuwendungsbescheid vorliegt – sonst entfällt die Förderung.',
  'Eigenleistungen sind nicht förderfähig: Die Arbeiten führt ein Unternehmer aus und stellt sie in Rechnung.',
  'Der Antrag wird im Original unterschrieben und mit allen Anlagen beim zuständigen Forstamt eingereicht.',
  'Die Antragsstichtage 2026 sind aufgehoben; bewilligt wird nach Prüfung im Rahmen der verfügbaren Haushaltsmittel.',
  'Für den Antrag brauchst du einen forstwirtschaftlichen Personenident (PI Forst). Die Eigentumsverhältnisse prüft das Forstamt selbst.',
];
// Förderfähige Maßnahmen und ihre besonderen Bedingungen
export const FOERDER = {
  pflanzung: {
    gegenstand: 'Kulturbegründung: Wiederaufforstung oder Voranbau durch Pflanzung',
    bedingungen: [
      'Nur standortgerechte Baumarten; Ziel sind stabile Laub- und Mischbestände.',
      'Forstliches Vermehrungsgut muss standort- und herkunftsgerecht sein (Herkunftsempfehlungen beachten) und mit Herkunftsnachweis bezogen werden.',
      'Zweckbindung: Die Kultur muss 5 Jahre erhalten bleiben.',
      'Schutz (Zaun, Einzelschutz) und Sicherung (Kulturpflege) der Kultur können mit beantragt werden.',
    ],
  },
  zaunbau: {
    gegenstand: 'Schutz der Kultur: Zaunbau',
    bedingungen: [
      'Gefördert wird der Zaun zum Schutz einer Kultur – in der Regel zusammen mit der Pflanzung oder Naturverjüngung, die er schützt.',
      'Der Zaun muss wilddicht gebaut und während der Zweckbindung instand gehalten werden.',
    ],
  },
  einzelschutz: {
    gegenstand: 'Schutz der Kultur: Einzelschutz',
    bedingungen: [
      'Gefördert wird der Einzelschutz einer (geförderten) Kultur – meist zusammen mit der Pflanzung.',
      'Einzelschutz statt Zaun lohnt sich vor allem bei wenigen Pflanzen je Hektar.',
    ],
  },
  pflege: {
    gegenstand: 'Sicherung der Kultur: Kulturpflege (erste fünf Jahre)',
    bedingungen: [
      'Gefördert wird die Pflege einer Kultur innerhalb der ersten fünf Jahre nach der Kulturbegründung (z. B. Freischneiden gegen verdämmende Vegetation).',
      'Jungbestandspflege und Wertastung sind keine Kulturpflege – bitte vorher beim Forstamt klären, ob und wie sie gefördert werden.',
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
      h('p', {}, `Diese Maßnahme ist in Thüringen förderfähig (${f.gegenstand}). Wenn du möchtest, füllen wir nach der Eingabe direkt den Förderantrag aus.`),
      h('p', { class: 'sheet-label' }, 'Das musst du beachten'),
      h('ul', { class: 'lrt-punkte' }, [...f.bedingungen, ALLGEMEIN[0], ALLGEMEIN[1]].map((t) => h('li', {}, t)))),
    actions: [{ label: 'Ohne Förderung', value: false }, { label: 'Ja, Förderung beantragen', value: true, primary: true }],
  });
}

// ---------- Antrag ----------
const antragVon = (id) => store.get().foerderantraege?.find((a) => a.id === id);
function neuerAntrag(measureIds) {
  const p = store.get().profile;
  const a = { id: uid(), erstellt: Date.now(), status: 'entwurf', massnahmen: [...measureIds],
    daten: { name: p.name || '', strasse: p.strasse || '', ort: p.ort || '', telefon: p.telefon || '', email: p.email || '', pi: p.pi || '',
      rolle: 'eigentuemer', eigentuemer: '', kontoinhaber: p.accountHolder || p.name || '', iban: p.iban || '', vorsteuer: null, forstamt: '',
      m: {}, erkl: {} } };
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
const TITEL = { programm: 'Welches Förderprogramm passt?', antragsteller: 'Antragsteller', flaeche: 'Waldfläche und Forstamt', massnahmen: 'Angaben zu den Maßnahmen', erklaerungen: 'Erklärungen', weitere: 'Noch eine Maßnahme?', zusammenfassung: 'Antrag prüfen und abschließen' };

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
  const speichere = (patch = {}) => store.update((s) => { const a = s.foerderantraege.find((x) => x.id === antragId); if (a) { a.daten = structuredClone(d); Object.assign(a, patch); } });
  const ms = () => (antragVon(antragId)?.massnahmen || []).map((id) => store.get().measures.find((m) => m.id === id)).filter(Boolean);

  // Forstamt aus dem Geoportal vorbelegen
  // Besitzgröße: Summe der eigenen Waldflurstücke
  if (d.besitzHa == null || d.besitzHa === '') {
    const wald = store.get().parcels.filter((p) => (p.category || 'Wald') === 'Wald').map((p) => byId[p.id] || p);
    const ha = wald.reduce((a, p) => a + (amtlicheFlaecheHa(p) || 0), 0);
    if (ha) d.besitzHa = String(Math.round(ha * 100) / 100).replace('.', ',');
  }
  // Forstamt und Waldschadfläche aus dem Geoportal
  const p0 = ms().map((m) => byId[m.parcelId]).find(Boolean);
  if (p0 && (!d.forstamt || d.schadenKarte == null)) import('./map/geoinfo.js').then((g) => g.queryPoint(centroid(p0.ring))).then((info) => {
    const fa = info?.zustaendig?.Forstamt;
    if (fa && !d.forstamt) d.forstamt = `Forstamt ${fa}`;
    if (!info?.failed) { d.schadenKarte = (info.wald || []).some((x) => x.layer === 'waldschaeden'); if (!d.schaden) d.schaden = d.schadenKarte ? 'ja' : ''; }
    speichere(); if (['flaeche', 'programm'].includes(SCHRITTE[i])) render();
  }).catch(() => {});

  const feld = (label, key, attrs = {}, obj = d) => h('label', {}, label, h('input', { value: obj[key] ?? '', ...attrs, oninput: (e) => { obj[key] = e.target.value; speichere(); } }));
  const auswahl = (label, key, opts, obj = d, onchg) => h('label', {}, label, h('select', { onchange: (e) => { obj[key] = e.target.value; speichere(); onchg?.(); } },
    h('option', { value: '' }, 'bitte wählen'), opts.map(([v, l]) => h('option', { value: v, selected: obj[key] === v }, l))));
  const hinweis = (text, art = 'warn') => h('p', { class: art === 'warn' ? 'warn-line' : 'ok-line' }, text);

  function pruefungen() {
    // Förderbedingungen, die sich aus den Angaben ergeben
    const out = [];
    const typen = ms().map((m) => m.type);
    for (const m of ms()) {
      const x = d.m[m.id] || {};
      const name = MT[m.type]?.label || m.type;
      if (!x.ausfuehrung) out.push(`${name}: Angeben, wer die Arbeiten ausführt (Unternehmer).`);
      if (x.ausfuehrung === 'eigen') out.push(`${name}: Eigenleistungen sind nicht förderfähig – nur Arbeiten eines Unternehmers mit Rechnung.`);
      if (m.date && m.date < Date.now() - 86400000) out.push(`${name}: Der geplante Termin liegt in der Vergangenheit. Begonnene Maßnahmen werden nicht gefördert.`);
      if (m.type === 'pflanzung' && /fichte/i.test(m.details?.species || '') && !typen.some((t, k) => t === 'pflanzung' && !/fichte/i.test(ms()[k].details?.species || ''))) out.push('Pflanzung: Eine reine Fichtenkultur entspricht nicht dem Ziel stabiler Laub- und Mischbestände – plane standortgerechte Mischbaumarten ein und stimme die Baumartenwahl mit dem Forstamt ab.');
      if (m.type === 'pflanzung' && !x.herkunft) out.push('Pflanzung: Herkunftsgebiet des Pflanzguts fehlt – ohne Herkunftsnachweis keine Förderung.');
      if ((m.type === 'zaunbau' || m.type === 'einzelschutz') && !typen.includes('pflanzung') && x.kultur !== 'ja') out.push(`${name}: Der Schutz wird nur für eine Kultur gefördert. Füge die Pflanzung hinzu oder bestätige, dass eine Kultur geschützt wird.`);
      if (m.type === 'pflege') {
        if (!/jungwuchs|freischneid/i.test(m.details?.art || '')) out.push(`Pflege: „${m.details?.art || 'diese Pflege'}“ ist keine Kulturpflege – vorher beim Forstamt klären, ob sie gefördert wird.`);
        const j = Number(x.pflanzjahr);
        if (j && new Date().getFullYear() - j > 5) out.push(`Pflege: Die Kultur ist älter als fünf Jahre (Pflanzjahr ${j}). Kulturpflege wird nur in den ersten fünf Jahren gefördert.`);
      }
      if (m.thinning?.natura2000?.length || m.natura2000?.length) out.push(`${name}: Fläche im Schutzgebiet – Schutzgebietsverordnung beachten und mit dem Forstamt abstimmen.`);
    }
    if (d.programm === 'GANW' && d.schaden === 'ja') out.push('Programm: Die Fläche ist eine Schadfläche – prüfe Teil E der Richtlinie oder das Landesprogramm.');
    if ((d.programm === 'GABE' || d.programm === 'LABE') && d.schaden !== 'ja') out.push('Programm: Teil E und das Landesprogramm setzen einen Schaden durch Extremwetter voraus – sonst Teil A wählen.');
    if (d.programm === 'GABE' || d.programm === 'LABE') out.push('Programm: Den Schaden dokumentieren (Fotos, Schadursache, betroffene Fläche) und dem Antrag beilegen.');
    if (d.programm === 'LABE') out.push('Programm: Das Budget des Landesprogramms ist begrenzt – den Antrag möglichst früh im Jahr stellen.');
    if (!d.pi) out.push('Personenident (PI Forst) fehlt – ohne PI kann der Antrag nicht bearbeitet werden. Ein PI kann beim Forstamt beantragt werden.');
    if (d.rolle === 'bevollmaechtigt') out.push('Du stellst den Antrag für jemand anderen: Die unterschriebene Vollmacht muss beiliegen.');
    return out;
  }

  function render() {
    const q = SCHRITTE[i];
    const liste = ms();
    let inhalt = [];
    if (q === 'programm') {
      const besitz = Number(String(d.besitzHa || '').replace(',', '.')) || null;
      const empf = empfehleProgramm({ schaden: d.schaden, besitzHa: besitz });
      d.programm ||= empf;
      inhalt = [
        h('p', { class: 'muted' }, 'In Thüringen gibt es für Pflanzung, Schutz und Pflege drei Wege. Welcher passt, hängt davon ab, ob die Fläche durch Extremwetter geschädigt ist und wie groß dein Waldbesitz ist.'),
        auswahl('Ist die Fläche durch Sturm, Dürre oder Borkenkäfer geschädigt (Schadfläche)?', 'schaden', [['ja', 'Ja – Schad- oder Kalamitätsfläche'], ['nein', 'Nein – Waldumbau oder Voranbau im gesunden Bestand']], d, () => { d.programm = ''; render(); }),
        d.schadenKarte != null ? h('p', { class: 'hint' }, d.schadenKarte ? 'Laut Karte „Waldschadflächen“ von ThüringenForst liegt das Flurstück in einer Schadfläche.' : 'In der Karte „Waldschadflächen“ von ThüringenForst ist hier keine Schadfläche verzeichnet.') : null,
        h('label', {}, 'Wie groß ist dein gesamter Waldbesitz in Thüringen (ha)?', h('input', { inputmode: 'decimal', value: d.besitzHa || '', oninput: (e) => { d.besitzHa = e.target.value; d.programm = ''; speichere(); }, onchange: () => render() }),
          h('small', { class: 'hint' }, 'Vorbelegt aus deinen Waldflurstücken in der App.')),
        h('p', { class: 'sheet-label' }, 'Förderprogramm wählen'),
        h('div', { class: 'q-cards' }, Object.entries(PROGRAMME).map(([k, pr]) => h('button', { type: 'button', class: `q-option ${d.programm === k ? 'on' : ''}`, onclick: () => { d.programm = k; speichere(); render(); } },
          h('span', { class: 'q-text' }, h('strong', {}, `${pr.kurz}${k === empf ? ' – empfohlen' : ''}`), h('small', {}, pr.wann), h('small', {}, `Formular: ${pr.formular}`))))),
        h('p', { class: 'hint' }, 'Dieselbe Maßnahme darf nur aus einem Programm gefördert werden. Die Grenze von 20 ha für das Landesprogramm stammt aus der bisherigen Fassung – das Forstamt bestätigt dir, welches Programm gilt.'),
      ];
      speichere();
    } else if (q === 'antragsteller') {
      inhalt = [
        feld('Name, Vorname bzw. Betrieb', 'name'), feld('Straße, Hausnummer', 'strasse'), feld('PLZ, Ort', 'ort'),
        feld('Telefon', 'telefon', { type: 'tel' }), feld('E-Mail', 'email', { type: 'email' }),
        feld('Personenident (PI Forst)', 'pi', { placeholder: 'falls vorhanden' }),
        h('p', { class: 'hint' }, 'Noch kein PI Forst? Den „Antrag auf Vergabe eines forstwirtschaftlichen Personenidents“ gibt es im ', h('a', { href: LINKS.formulare, target: '_blank', rel: 'noopener' }, 'Formularcenter von ThüringenForst'), '.'),
        auswahl('Du stellst den Antrag als', 'rolle', [['eigentuemer', 'Eigentümer/in der Fläche'], ['bevollmaechtigt', 'Bevollmächtigte/r (Vollmacht liegt bei)']], d, render),
        d.rolle === 'bevollmaechtigt' ? feld('Name der Eigentümerin / des Eigentümers', 'eigentuemer') : null,
        h('h3', { class: 'sheet-label' }, 'Bankverbindung für die Auszahlung'),
        feld('Kontoinhaber/in', 'kontoinhaber'), feld('IBAN', 'iban', { autocomplete: 'off', inputmode: 'text' }),
        auswahl('Bist du zum Vorsteuerabzug berechtigt?', 'vorsteuer', [['nein', 'Nein – Kosten brutto'], ['ja', 'Ja – Kosten netto']]),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) store.update((s) => Object.assign(s.profile, { name: d.name, strasse: d.strasse, ort: d.ort, telefon: d.telefon, email: d.email, pi: d.pi, accountHolder: d.kontoinhaber, iban: d.iban })); } }), 'Diese Angaben in meinem Profil speichern'),
      ];
    } else if (q === 'flaeche') {
      const parcels = [...new Set(liste.map((m) => m.parcelId).filter(Boolean))].map((id) => byId[id]).filter(Boolean);
      inhalt = [
        parcels.length ? h('dl', { class: 'parcel-facts' }, parcels.map((p) => h('div', {}, h('dt', {}, `Gemarkung ${p.gemarkung}, Flur ${p.flur}`), h('dd', {}, `Flurstück ${p.nr} · ${formatHa(amtlicheFlaecheHa(p))}`))))
          : hinweis('Keine Flurstücke zugeordnet – ordne die Maßnahmen einem deiner Flurstücke zu.'),
        h('p', { class: 'muted' }, 'Die Angaben stammen aus dem ALKIS. Die Eigentumsverhältnisse prüft das Forstamt im Verfahren; ein Grundbuchauszug ist nicht nötig.'),
        feld('Zuständiges Forstamt', 'forstamt', { placeholder: 'wird aus dem Geoportal ermittelt' }),
        h('p', { class: 'hint' }, h('a', { href: LINKS.forstaemter, target: '_blank', rel: 'noopener' }, 'Übersicht der Forstämter')),
      ];
    } else if (q === 'massnahmen') {
      inhalt = liste.map((m) => massnahmeKarte(m));
    } else if (q === 'erklaerungen') {
      const E = [['nichtBegonnen', 'Mit den Maßnahmen wurde noch nicht begonnen; ich beginne erst nach Erhalt des Zuwendungsbescheids.'],
        ['zweckbindung', 'Ich halte die Zweckbindung ein (z. B. Pflanzung 5 Jahre erhalten) und pflege bzw. unterhalte die geförderten Anlagen.'],
        ['keineDoppel', 'Für dieselben Maßnahmen beantrage oder erhalte ich keine anderen öffentlichen Mittel.'],
        ['unternehmer', 'Die Arbeiten werden von einem Unternehmer ausgeführt (Eigenleistungen sind nicht förderfähig).'],
        ['richtig', 'Meine Angaben sind vollständig und richtig. Änderungen teile ich dem Forstamt unverzüglich mit.']];
      inhalt = [h('div', { class: 'erkl-liste' }, E.map(([k, t]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!d.erkl[k], onchange: (e) => { d.erkl[k] = e.target.checked; speichere(); } }), t))),
        h('p', { class: 'hint' }, 'Die verbindlichen Erklärungen stehen im amtlichen Antragsformular – lies sie dort vor der Unterschrift.')];
    } else if (q === 'weitere') {
      inhalt = [h('p', {}, `Im Antrag: ${liste.map((m) => MT[m.type]?.label || m.type).join(', ')}.`),
        h('p', { class: 'muted' }, 'Soll noch eine Maßnahme dazu? Zum Beispiel zum Zaunbau die Pflanzung, die er schützt, oder die Kulturpflege.'),
        h('div', { class: 'q-cards' },
          h('button', { type: 'button', class: 'q-option', onclick: () => { page.close(); window.dispatchEvent(new CustomEvent('ww:new-measure', { detail: { antragId, parcelId: liste[0]?.parcelId || null } })); } },
            h('span', { class: 'q-text' }, h('strong', {}, 'Ja, Maßnahme hinzufügen'), h('small', {}, 'Pflanzung, Zaunbau, Einzelschutz oder Kulturpflege'))),
          h('button', { type: 'button', class: 'q-option', onclick: () => { i++; render(); } },
            h('span', { class: 'q-text' }, h('strong', {}, 'Nein, Antrag abschließen'), h('small', {}, 'Zur Übersicht'))))];
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

  function massnahmeKarte(m) {
    const x = (d.m[m.id] ||= {});
    const t = MT[m.type]?.label || m.type;
    const det = m.details || {};
    const ha = m.flaeche?.ha ?? (m.parcelId && byId[m.parcelId] ? amtlicheFlaecheHa(byId[m.parcelId]) : null);
    x.kostenNetto ??= m.kosten ? String(Math.round((m.kosten / 1.19) * 100) / 100).replace('.', ',') : '';
    const zeile = (k, v) => (v ? h('div', {}, h('dt', {}, k), h('dd', {}, v)) : null);
    const extra = [];
    if (m.type === 'pflanzung') extra.push(
      auswahl('Art der Kulturbegründung', 'verfahren', [['wiederaufforstung', 'Wiederaufforstung (Kahl- oder Schadfläche)'], ['voranbau', 'Voranbau unter Schirm']], x),
      h('label', {}, 'Sortiment / Alter des Pflanzguts', h('input', { value: x.sortiment || '', placeholder: 'z. B. 1+1, 50–80 cm', oninput: (e) => { x.sortiment = e.target.value; speichere(); } })),
      h('label', {}, 'Herkunftsgebiet', h('input', { value: x.herkunft || '', placeholder: 'z. B. 810 08 (Buche)', oninput: (e) => { x.herkunft = e.target.value; speichere(); } })),
      h('label', {}, 'Baumschule / Bezugsquelle', h('input', { value: x.baumschule || '', oninput: (e) => { x.baumschule = e.target.value; speichere(); } })));
    if (m.type === 'zaunbau' || m.type === 'einzelschutz') extra.push(auswahl('Welche Kultur wird geschützt?', 'kultur', [['ja', 'Vorhandene oder geplante Kultur/Naturverjüngung'], ['nein', 'Keine Kultur']], x));
    if (m.type === 'pflege') extra.push(h('label', {}, 'Jahr der Pflanzung (Kulturbegründung)', h('input', { type: 'number', min: 1990, max: 2100, value: x.pflanzjahr || '', oninput: (e) => { x.pflanzjahr = e.target.value; speichere(); } })));
    return h('section', { class: 'antrag-massnahme' },
      h('h3', {}, `${t}${FOERDER[m.type] ? ` – ${FOERDER[m.type].gegenstand}` : ''}`),
      h('dl', { class: 'parcel-facts' },
        zeile('Fläche', ha ? `${m.flaeche ? 'Teilfläche' : 'Flurstück'}, ${formatHa(ha)}` : null),
        Object.entries(det).filter(([, v]) => v !== '' && v != null).map(([k, v]) => { const f = MT[m.type]?.fields.find((y) => y[0] === k); return f ? zeile(f[1].replace(/ \(.*\)/, ''), String(v)) : null; }),
        zeile('Geplanter Termin', m.date ? new Date(m.date).toLocaleDateString('de-DE') : 'offen'),
        m.zaun?.material?.length ? zeile('Material', m.zaun.material.map((y) => `${y.menge} ${y.einheit} ${y.name}`).join('; ')) : null),
      extra,
      auswahl('Wer führt die Arbeiten aus?', 'ausfuehrung', [['unternehmer', 'Forstunternehmer / Dienstleister'], ['eigen', 'Ich selbst (Eigenleistung)']], x, render),
      x.ausfuehrung === 'unternehmer' ? h('label', {}, 'Unternehmer (falls bekannt)', h('input', { value: x.unternehmer || '', oninput: (e) => { x.unternehmer = e.target.value; speichere(); } })) : null,
      h('label', {}, d.vorsteuer === 'ja' ? 'Kosten laut Angebot (netto, €)' : 'Kosten laut Angebot (€)', h('input', { inputmode: 'decimal', value: x.kostenNetto, oninput: (e) => { x.kostenNetto = e.target.value; speichere(); } })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!x.angebot, onchange: (e) => { x.angebot = e.target.checked; speichere(); } }), 'Angebot / Kostenvoranschlag liegt vor (als Anlage beifügen)'));
  }

  function zusammenfassung() {
    const liste = ms();
    const summe = liste.reduce((s, m) => s + (Number(String(d.m[m.id]?.kostenNetto || '').replace(',', '.')) || 0), 0);
    const offen = [['Name', d.name], ['Anschrift', d.strasse && d.ort], ['PI Forst', d.pi], ['IBAN', d.iban], ['Forstamt', d.forstamt]].filter(([, v]) => !v).map(([k]) => k);
    const erklOffen = ['nichtBegonnen', 'zweckbindung', 'keineDoppel', 'unternehmer', 'richtig'].filter((k) => !d.erkl[k]).length;
    return h('div', { class: 'antrag-zusammen' },
      offen.length ? hinweis(`Noch offen: ${offen.join(', ')}.`) : hinweis('Alle Pflichtangaben sind ausgefüllt.', 'ok'),
      erklOffen ? hinweis(`${erklOffen} Erklärung${erklOffen > 1 ? 'en' : ''} noch nicht bestätigt.`) : null,
      h('dl', { class: 'parcel-facts' },
        h('div', {}, h('dt', {}, 'Förderprogramm'), h('dd', {}, (PROGRAMME[d.programm] || PROGRAMME.GANW).name)),
        h('div', {}, h('dt', {}, 'Antragsteller'), h('dd', {}, [d.name, d.strasse, d.ort].filter(Boolean).join(', ') || '–')),
        h('div', {}, h('dt', {}, 'Einreichen bei'), h('dd', {}, d.forstamt || 'zuständiges Forstamt')),
        h('div', {}, h('dt', {}, 'Maßnahmen'), h('dd', {}, h('ul', { class: 'mat-kurz' }, liste.map((m) => h('li', {}, `${MT[m.type]?.label}: ${FOERDER[m.type]?.gegenstand || ''}${d.m[m.id]?.kostenNetto ? ` – ${d.m[m.id].kostenNetto} €` : ''}`))))),
        h('div', {}, h('dt', {}, 'Kosten gesamt laut Angeboten'), h('dd', {}, `${summe.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`))),
      h('h3', { class: 'sheet-label' }, 'So geht es weiter'),
      h('ol', { class: 'mess-liste' },
        h('li', {}, 'Amtliches Formular ', h('a', { href: (PROGRAMME[d.programm] || PROGRAMME.GANW).url, target: '_blank', rel: 'noopener' }, `„${(PROGRAMME[d.programm] || PROGRAMME.GANW).formular}“`), ' laden (', h('a', { href: LINKS.formulare, target: '_blank', rel: 'noopener' }, 'Formularcenter'), ') und die Angaben aus dem PDF übertragen – oder das PDF beim Forstamt vorlegen.'),
        h('li', {}, 'Anlagen beifügen: Lageplan bzw. Karte der Fläche (Übersicht drucken), Angebote, ggf. Vollmacht.'),
        h('li', {}, 'Im Original unterschreiben und per Post beim Forstamt einreichen.'),
        h('li', {}, 'Erst nach Erhalt des Zuwendungsbescheids mit der Arbeit beginnen.')),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => pdfErstellen() }, 'Antrag als PDF herunterladen')),
      h('p', { class: 'hint' }, 'Die Höhe der Förderung (Festbeträge bzw. Fördersätze) setzt die Bewilligungsstelle nach der Richtlinie fest – das Forstamt berät dich dazu.'));
  }

  // ---------- PDF ----------
  function pdfErstellen() {
    const liste = ms();
    const pr = PROGRAMME[d.programm] || PROGRAMME.GANW;
    const doc = new Pdf();
    const L = 50, R = 545, LW = 150;
    let y = 50;
    const platz = (hoehe) => { if (y + hoehe > 800) { fuss(); doc.neueSeite(); y = 50; } };
    let seite = 1;
    const fuss = () => { doc.linie(L, 812, R, 812); doc.text(L, 825, `WaldWächter – Antragsentwurf, kein amtliches Formular. Angaben in „${pr.formular}“ übertragen.`, { size: 7.5, farbe: [90, 100, 90] }); doc.text(R - 40, 825, `Seite ${seite++}`, { size: 7.5, farbe: [90, 100, 90] }); };
    const titel = (t) => { platz(34); y += 10; doc.text(L, y, t, { bold: true, size: 12.5, farbe: [27, 77, 46] }); y += 6; doc.linie(L, y, R, y, { w: 1, farbe: [27, 77, 46] }); y += 14; };
    const zeile = (k, v) => {
      const zl = doc.umbrechen(v == null || v === '' ? '–' : String(v), R - L - LW, { size: 9.5 });
      platz(zl.length * 12 + 4);
      doc.text(L, y, k, { bold: true, size: 9, farbe: [70, 80, 70] });
      zl.forEach((t, k2) => doc.text(L + LW, y + k2 * 12, t, { size: 9.5 }));
      y += zl.length * 12 + 4;
    };
    const absatz = (t, opt = {}) => { const zl = doc.umbrechen(t, R - L - (opt.einzug || 0), { size: opt.size || 9.5, bold: opt.bold }); platz(zl.length * 12 + 2); zl.forEach((x) => { doc.text(L + (opt.einzug || 0), y, x, { size: opt.size || 9.5, bold: opt.bold, farbe: opt.farbe }); y += 12; }); y += 2; };
    const euro = (v) => `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

    doc.text(L, y, 'Antrag auf Gewährung einer Zuwendung – Entwurf', { bold: true, size: 16, farbe: [27, 77, 46] }); y += 18;
    absatz(pr.name, { size: 10 });
    absatz(`Formular: ${pr.formular} · Einreichen bei: ${d.forstamt || 'zuständiges Forstamt'} · erstellt am ${new Date().toLocaleDateString('de-DE')}`, { size: 9, farbe: [90, 100, 90] });

    titel('1. Antragsteller');
    zeile('Name / Betrieb', d.name); zeile('Anschrift', [d.strasse, d.ort].filter(Boolean).join(', '));
    zeile('Telefon / E-Mail', [d.telefon, d.email].filter(Boolean).join(' · ')); zeile('Personenident (PI Forst)', d.pi || 'noch nicht vorhanden – beim Forstamt beantragen');
    zeile('Antrag gestellt als', d.rolle === 'bevollmaechtigt' ? `Bevollmächtigte/r für ${d.eigentuemer || '…'} (Vollmacht liegt bei)` : 'Eigentümer/in');
    zeile('Kontoinhaber/in', d.kontoinhaber); zeile('IBAN', d.iban);
    zeile('Vorsteuerabzug', d.vorsteuer === 'ja' ? 'berechtigt – Kosten netto' : d.vorsteuer === 'nein' ? 'nicht berechtigt – Kosten brutto' : 'keine Angabe');
    zeile('Waldbesitz gesamt', d.besitzHa ? `${d.besitzHa} ha` : null);
    zeile('Schadfläche', d.schaden === 'ja' ? 'ja – Schaden durch Extremwetter' : d.schaden === 'nein' ? 'nein' : null);

    titel('2. Waldfläche');
    const parcels = [...new Set(liste.map((m) => m.parcelId).filter(Boolean))].map((id) => byId[id]).filter(Boolean);
    parcels.forEach((p) => zeile(`Gemarkung ${p.gemarkung}`, `Flur ${p.flur}, Flurstück ${p.nr}, ${formatHa(amtlicheFlaecheHa(p))} (amtlich)${p.lage ? `, Lage: ${p.lage}` : ''}`));
    y = lageplan(doc, parcels, liste, y);

    titel('3. Beantragte Maßnahmen');
    let summe = 0;
    liste.forEach((m, k) => {
      const x = d.m[m.id] || {};
      const det = m.details || {};
      platz(40);
      absatz(`3.${k + 1} ${MT[m.type]?.label || m.type} – ${FOERDER[m.type]?.gegenstand || ''}`, { bold: true, size: 10.5 });
      const ha = m.flaeche?.ha ?? (m.parcelId && byId[m.parcelId] ? amtlicheFlaecheHa(byId[m.parcelId]) : null);
      zeile('Fläche', ha ? `${m.flaeche ? 'Teilfläche' : 'ganzes Flurstück'}, ${formatHa(ha)}` : null);
      for (const [key, label] of MT[m.type]?.fields || []) if (det[key] !== '' && det[key] != null) zeile(label.replace(/ \(.*\)/, ''), det[key]);
      if (m.zaun?.material?.length) zeile('Material', m.zaun.material.map((z) => `${z.menge} ${z.einheit} ${z.name}`).join('; '));
      if (x.verfahren) zeile('Kulturbegründung', x.verfahren === 'voranbau' ? 'Voranbau unter Schirm' : 'Wiederaufforstung');
      if (x.sortiment) zeile('Sortiment', x.sortiment);
      if (x.herkunft) zeile('Herkunftsgebiet', x.herkunft);
      if (x.baumschule) zeile('Baumschule', x.baumschule);
      if (x.kultur) zeile('Geschützte Kultur', x.kultur === 'ja' ? 'vorhanden bzw. geplant' : 'keine');
      if (x.pflanzjahr) zeile('Jahr der Pflanzung', x.pflanzjahr);
      zeile('Geplanter Termin', m.date ? new Date(m.date).toLocaleDateString('de-DE') : 'nach Erhalt des Zuwendungsbescheids');
      zeile('Ausführung', x.ausfuehrung === 'unternehmer' ? `Unternehmer${x.unternehmer ? `: ${x.unternehmer}` : ''}` : x.ausfuehrung === 'eigen' ? 'Eigenleistung (nicht förderfähig!)' : null);
      const kosten = Number(String(x.kostenNetto || '').replace(',', '.')) || 0;
      summe += kosten;
      zeile(d.vorsteuer === 'ja' ? 'Kosten (netto)' : 'Kosten', kosten ? `${euro(kosten)}${x.angebot ? ' – Angebot liegt bei' : ''}` : null);
      y += 4;
    });
    zeile('Kosten gesamt', euro(summe));

    const pruef = pruefungen();
    if (pruef.length) { titel('4. Hinweise zu den Förderbedingungen'); pruef.forEach((t) => absatz(`• ${t}`, { einzug: 6 })); }
    titel(`${pruef.length ? 5 : 4}. Erklärungen`);
    const E = [['nichtBegonnen', 'Mit den Maßnahmen wurde noch nicht begonnen; Beginn erst nach Erhalt des Zuwendungsbescheids.'], ['zweckbindung', 'Die Zweckbindung wird eingehalten (z. B. Pflanzung 5 Jahre).'], ['keineDoppel', 'Für dieselben Maßnahmen werden keine anderen öffentlichen Mittel beantragt oder bezogen.'], ['unternehmer', 'Die Arbeiten führt ein Unternehmer aus (keine Eigenleistung).'], ['richtig', 'Die Angaben sind vollständig und richtig.']];
    E.forEach(([k, t]) => { platz(14); doc.rechteck(L, y - 8, 9, 9, { stroke: [60, 70, 60] }); if (d.erkl[k]) { doc.linie(L + 1.5, y - 3.5, L + 4, y - 0.5, { w: 1.4, farbe: [27, 77, 46] }); doc.linie(L + 4, y - 0.5, L + 8, y - 7, { w: 1.4, farbe: [27, 77, 46] }); } const zl = doc.umbrechen(t, R - L - 16, { size: 9.5 }); zl.forEach((z, k2) => doc.text(L + 16, y + k2 * 12, z, { size: 9.5 })); y += zl.length * 12 + 4; });
    titel('Anlagen');
    ['Lageplan / Karte der Fläche (siehe Abschnitt 2)', 'Angebote bzw. Kostenvoranschläge', d.rolle === 'bevollmaechtigt' ? 'Vollmacht der Eigentümerin / des Eigentümers' : null, d.programm !== 'GANW' ? 'Dokumentation des Schadens (Fotos, Ursache, Fläche)' : null, liste.some((m) => m.type === 'pflanzung') ? 'Herkunftsnachweis des Pflanzguts (nach Lieferung)' : null].filter(Boolean).forEach((t) => absatz(`• ${t}`, { einzug: 6 }));
    platz(70); y += 30;
    doc.linie(L, y, L + 200, y, { farbe: [60, 70, 60] }); doc.linie(L + 260, y, R, y, { farbe: [60, 70, 60] });
    doc.text(L, y + 12, 'Ort, Datum', { size: 8.5, farbe: [90, 100, 90] }); doc.text(L + 260, y + 12, 'Unterschrift (im Original)', { size: 8.5, farbe: [90, 100, 90] });
    fuss();
    const name = `Foerderantrag_${pr.formular.match(/\(([^)]+)\)/)?.[1]?.replace(/\s+/g, '') || 'Entwurf'}_${(d.name || 'Waldbesitz').replace(/[^\wäöüÄÖÜß-]+/g, '_')}.pdf`;
    herunterladen(doc.blob(), name);
    toast('PDF wird heruntergeladen');
  }

  function lageplan(doc, parcels, liste, y) {
    // Flurstücke grau, Maßnahmenflächen farbig; lokale Projektion in Metern
    const flaechen = liste.map((m, k) => ({ k, polys: m.flaeche?.ring ? [[m.flaeche.ring]] : m.thinning?.ring ? polysOf(m.thinning) : null, linie: m.zaun && !m.zaun.geschlossen ? m.zaun.pts : null })).filter((f) => f.polys || f.linie);
    const allePunkte = [...parcels.flatMap((p) => polysOf(p).flat(2)), ...flaechen.flatMap((f) => (f.polys ? f.polys.flat(2) : f.linie))];
    if (!allePunkte.length) return y;
    const lat0 = allePunkte.reduce((a, p) => a + p[0], 0) / allePunkte.length;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    const xy = ([la, ln]) => [ln * kx, -la * ky];
    const P = allePunkte.map(xy);
    const minX = Math.min(...P.map((p) => p[0])), maxX = Math.max(...P.map((p) => p[0])), minY = Math.min(...P.map((p) => p[1])), maxY = Math.max(...P.map((p) => p[1]));
    const BX = 50, BB = 495, BH = 250;
    const sk = Math.min((BB - 40) / Math.max(1, maxX - minX), (BH - 40) / Math.max(1, maxY - minY));
    if (y + BH + 30 > 800) { doc.neueSeite(); y = 50; }
    const ox = BX + (BB - (maxX - minX) * sk) / 2, oy = y + (BH - (maxY - minY) * sk) / 2;
    const tr = (ll) => { const [a, b] = xy(ll); return [ox + (a - minX) * sk, oy + (b - minY) * sk]; };
    doc.rechteck(BX, y, BB, BH, { stroke: [170, 180, 170], fill: [248, 250, 246] });
    parcels.forEach((p) => polysOf(p).forEach((poly) => doc.polygon(poly.map((r) => r.map(tr)), { fill: [233, 239, 228], stroke: [120, 130, 110], w: 1 })));
    const FARBEN = [[242, 107, 29], [47, 125, 58], [63, 127, 176], [176, 92, 166]];
    flaechen.forEach((f) => {
      const c = FARBEN[f.k % FARBEN.length];
      if (f.polys) f.polys.forEach((poly) => doc.polygon(poly.map((r) => r.map(tr)), { stroke: c, w: 1.8 }));
      else f.linie.slice(1).forEach((pt, j) => { const [a, b] = tr(f.linie[j]), [c2, d2] = tr(pt); doc.linie(a, b, c2, d2, { w: 2, farbe: c }); });
    });
    // Nordpfeil und Maßstab
    doc.linie(BX + BB - 20, y + 40, BX + BB - 20, y + 16, { w: 1.4, farbe: [40, 50, 40] }); doc.linie(BX + BB - 24, y + 22, BX + BB - 20, y + 16, { w: 1.4, farbe: [40, 50, 40] }); doc.linie(BX + BB - 16, y + 22, BX + BB - 20, y + 16, { w: 1.4, farbe: [40, 50, 40] });
    doc.text(BX + BB - 23, y + 12, 'N', { bold: true, size: 9 });
    const meter = [10, 20, 50, 100, 200, 500, 1000].find((m) => m * sk >= 60) || 1000;
    doc.linie(BX + 14, y + BH - 14, BX + 14 + meter * sk, y + BH - 14, { w: 2, farbe: [40, 50, 40] });
    doc.text(BX + 14, y + BH - 20, `${meter} m`, { size: 8 });
    y += BH + 8;
    const leg = [['Flurstück', [120, 130, 110]], ...flaechen.map((f) => [`Fläche ${MT[liste[f.k].type]?.label || ''}`, FARBEN[f.k % FARBEN.length]])];
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
      m.anhaenge.push({ id: uid(), typ: 'foerderantrag', antragId, titel: 'Förderantrag (Entwurf für das Forstamt)', erstellt: Date.now() });
      (m.historie ||= []).push({ ts: Date.now(), text: 'Förderantrag vorbereitet' });
    }));
    toast('Förderantrag gespeichert – im Verlauf der Maßnahmen abrufbar');
    page.close();
  }
  render();
  return page;
}
