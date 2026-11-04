// Forstförderung Thüringen: Abfrage „Soll die Maßnahme gefördert werden?“, Hinweise auf Förderbedingungen und
// Assistent für den Förderantrag (Thüringer Richtlinie zur Förderung forstwirtschaftlicher Maßnahmen 2025,
// Teil A „Naturnahe Waldbewirtschaftung“, Antrag beim zuständigen Forstamt).
import { h, fill, openPage, toast, dialog } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { centroid, formatHa, polysOf } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';

export const LINKS = {
  foerderung: 'https://www.thueringenforst.de/angebote-produkte/forstamtsservice/forstfoerderung',
  formulare: 'https://www.thueringenforst.de/aktuelles-service/service/formularcenter/formulare-forstfoerderung',
  forstaemter: 'https://www.thueringenforst.de/ueber-uns/standorte/forstaemter',
};
export const RICHTLINIE = 'Thüringer Richtlinie zur Förderung forstwirtschaftlicher Maßnahmen 2025 (in Kraft seit 30.07.2025), Teil A – Naturnahe Waldbewirtschaftung';

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

const SCHRITTE = ['antragsteller', 'flaeche', 'massnahmen', 'erklaerungen', 'weitere', 'zusammenfassung'];
const TITEL = { antragsteller: 'Antragsteller', flaeche: 'Waldfläche und Forstamt', massnahmen: 'Angaben zu den Maßnahmen', erklaerungen: 'Erklärungen', weitere: 'Noch eine Maßnahme?', zusammenfassung: 'Antrag prüfen und abschließen' };

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
  if (!d.forstamt) {
    const p = ms().map((m) => byId[m.parcelId]).find(Boolean);
    if (p) import('./map/geoinfo.js').then((g) => g.queryPoint(centroid(p.ring))).then((info) => {
      const fa = info?.zustaendig?.Forstamt;
      if (fa && !d.forstamt) { d.forstamt = `Forstamt ${fa}`; speichere(); if (SCHRITTE[i] === 'flaeche') render(); }
    }).catch(() => {});
  }

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
    if (!d.pi) out.push('Personenident (PI Forst) fehlt – ohne PI kann der Antrag nicht bearbeitet werden. Ein PI kann beim Forstamt beantragt werden.');
    if (d.rolle === 'bevollmaechtigt') out.push('Du stellst den Antrag für jemand anderen: Die unterschriebene Vollmacht muss beiliegen.');
    return out;
  }

  function render() {
    const q = SCHRITTE[i];
    const liste = ms();
    let inhalt = [];
    if (q === 'antragsteller') {
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
        h('div', {}, h('dt', {}, 'Richtlinie'), h('dd', {}, RICHTLINIE)),
        h('div', {}, h('dt', {}, 'Antragsteller'), h('dd', {}, [d.name, d.strasse, d.ort].filter(Boolean).join(', ') || '–')),
        h('div', {}, h('dt', {}, 'Einreichen bei'), h('dd', {}, d.forstamt || 'zuständiges Forstamt')),
        h('div', {}, h('dt', {}, 'Maßnahmen'), h('dd', {}, h('ul', { class: 'mat-kurz' }, liste.map((m) => h('li', {}, `${MT[m.type]?.label}: ${FOERDER[m.type]?.gegenstand || ''}${d.m[m.id]?.kostenNetto ? ` – ${d.m[m.id].kostenNetto} €` : ''}`))))),
        h('div', {}, h('dt', {}, 'Kosten gesamt laut Angeboten'), h('dd', {}, `${summe.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`))),
      h('h3', { class: 'sheet-label' }, 'So geht es weiter'),
      h('ol', { class: 'mess-liste' },
        h('li', {}, 'Amtliches Antragsformular „Antrag Naturnahe Waldbewirtschaftung“ aus dem ', h('a', { href: LINKS.formulare, target: '_blank', rel: 'noopener' }, 'Formularcenter von ThüringenForst'), ' laden und die Angaben von hier übertragen (oder diese Übersicht dem Forstamt zeigen).'),
        h('li', {}, 'Anlagen beifügen: Lageplan bzw. Karte der Fläche (Übersicht drucken), Angebote, ggf. Vollmacht.'),
        h('li', {}, 'Im Original unterschreiben und per Post beim Forstamt einreichen.'),
        h('li', {}, 'Erst nach Erhalt des Zuwendungsbescheids mit der Arbeit beginnen.')),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, 'Übersicht drucken / als PDF')),
      h('p', { class: 'hint' }, 'Die Höhe der Förderung (Festbeträge bzw. Fördersätze) setzt die Bewilligungsstelle nach der Richtlinie fest – das Forstamt berät dich dazu.'));
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
