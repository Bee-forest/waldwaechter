// Bestandsprofil und Handlungsempfehlung: Entwicklungsphase nach der Oberhöhe (Alter nur ergänzend),
// „Das steht jetzt an“ mit Skizzen „so sieht es oft aus / so sollte es aussehen“, Durchforstung nach Methode
// Fassung 5, Mischbaumarten-Hinweis aus dem Tabellenwerk und passende Fördertatbestände (data/foerderregeln.json).
// Die Ziele der Waldbesitzenden (Ertrag, Naturschutz, wenig Aufwand, Jagd, Erholung) gewichten die Empfehlungen.
import { h, fill, dialog, toast } from './ui.js';
import { store } from './store.js';
import { BAUMARTEN_KURZ } from './bzt.js';

// ---------- Ziele ----------
export const ZIELE = [
  ['ertrag', 'Holz als Einnahme', 'Wie wichtig sind dir Erlöse aus dem Holzverkauf?'],
  ['natur', 'Naturschutz', 'Wie wichtig sind dir Artenvielfalt, Habitatbäume und Totholz?'],
  ['aufwand', 'Wenig Aufwand', 'Wie wichtig ist dir, dass der Wald wenig Arbeit und Kosten macht?'],
  ['jagd', 'Jagd', 'Wie wichtig ist dir die Jagd auf deinen Flächen?'],
  ['erholung', 'Erholung', 'Wie wichtig sind dir Spazierwege, schöne Waldränder und Ruhe?'],
];
const STUFEN = [[0, 'kaum'], [1, 'wichtig'], [2, 'sehr wichtig']];
export const ziele = () => store.get().settings.ziele || null;
export const zieleText = (z = ziele()) => (z ? ZIELE.filter(([k]) => z[k] === 2).map(([, l]) => l).join(', ') || 'ausgewogen' : 'noch nicht festgelegt');

/** Kurze Abfrage der Ziele (5 Fragen auf einer Seite); erstmal = beim ersten Start */
export async function zieleAbfrage({ erstmal = false } = {}) {
  const w = { ertrag: 1, natur: 1, aufwand: 1, jagd: 1, erholung: 1, ...(ziele() || {}) };
  const zeile = ([k, titel, frage]) => {
    const seg = h('div', { class: 'segmented compact', role: 'radiogroup', 'aria-label': titel });
    const zeichne = () => fill(seg, STUFEN.map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(w[k] === v), onclick: () => { w[k] = v; zeichne(); } }, l)));
    zeichne();
    return h('div', { class: 'ziel-frage' }, h('strong', {}, titel), h('small', { class: 'muted' }, frage), seg);
  };
  const ok = await dialog({
    title: erstmal ? 'Was ist dir in deinem Wald wichtig?' : 'Meine Ziele',
    body: h('div', { class: 'form' },
      erstmal ? h('p', {}, 'Fünf kurze Fragen. Deine Antworten gewichten die Empfehlungen zu deinen Flächen. Du kannst sie jederzeit im Profil ändern.') : null,
      ZIELE.map(zeile)),
    actions: [{ label: erstmal ? 'Später' : 'Abbrechen', value: false }, { label: 'Speichern', value: true, primary: true }],
  });
  store.update((s) => { s.settings.zieleGefragt = true; if (ok) s.settings.ziele = w; });
  if (ok) toast('Ziele gespeichert');
}

// ---------- Entwicklungsphase ----------
export const PHASEN = {
  jungwuchs: { name: 'Jungwuchs', bis: 2, text: 'Junge Pflanzen bis etwa 2 m, die Kronen schließen sich noch nicht.' },
  dickung: { name: 'Dickung', bis: 8, text: 'Die Kronen haben sich geschlossen, der Bestand ist dicht und kaum begehbar (ca. 2–8 m).' },
  stangenholz: { name: 'Stangenholz', bis: 16, text: 'Die unteren Äste sterben ab, die Stämme sind noch dünn (ca. 8–16 m, BHD bis etwa 20 cm).' },
  baumholz: { name: 'Baumholz', bis: Infinity, text: 'Stämme über etwa 20 cm BHD, Oberhöhe über 16 m – Durchforstung und später Ernte und Verjüngung.' },
};
const REIHE = ['jungwuchs', 'dickung', 'stangenholz', 'baumholz'];
/** Phase vorrangig nach Oberhöhe, sonst grob nach Alter */
export function phaseVon({ oberhoehe = null, alter = null } = {}) {
  if (oberhoehe != null) return { phase: REIHE.find((p) => oberhoehe < PHASEN[p].bis), quelle: 'oberhoehe' };
  if (alter != null) return { phase: alter < 8 ? 'jungwuchs' : alter < 20 ? 'dickung' : alter < 40 ? 'stangenholz' : 'baumholz', quelle: 'alter' };
  return { phase: null, quelle: null };
}

// ---------- Aufgaben je Phase ----------
// g = Gewichte je Ziel (Ziel „wenig Aufwand“ negativ = aufwendig); foerder = Schlüssel in foerderregeln.json
const AUFGABEN = {
  jungwuchs: [
    { k: 'kulturpflege', titel: 'Kultur freischneiden', text: 'Gras, Brombeere und Adlerfarn um die Pflanzen zurückschneiden – meist 1–2× im Sommer, bis die Pflanzen über die Begleitflora hinausgewachsen sind.', basis: 3, g: { ertrag: 1, aufwand: -1 }, foerder: ['kulturpflege'], massnahme: 'pflege' },
    { k: 'wildschutz', titel: 'Verbiss und Schutz kontrollieren', text: 'Zaun auf Löcher prüfen, Einzelschutz richten. Starker Verbiss an Tanne, Eiche oder Ahorn? Mit dem Jagdpächter sprechen.', basis: 2, g: { jagd: 2, ertrag: 1 }, foerder: ['wildschutz'], massnahme: 'sonstiges' },
    { k: 'nachbessern', titel: 'Ausfälle nachbessern', text: 'Fallen mehr als etwa 20 % der Pflanzen aus, im Herbst oder Frühjahr nachpflanzen.', basis: 1, g: { ertrag: 1, aufwand: -1 }, foerder: ['pflanzung'], massnahme: 'pflanzung' },
    { k: 'pioniere', titel: 'Pionierbäume stehen lassen', text: 'Birke, Eberesche und Weide, die von selbst ankommen, als Mischung und Schattenspender erhalten – nur wo sie die Pflanzen erdrücken, zurücknehmen.', basis: 1, g: { natur: 2, aufwand: 1 }, foerder: [] },
  ],
  dickung: [
    { k: 'laeuterung', titel: 'Läuterung (Jungbestandspflege)', text: 'Protzen (sehr grobe, breitkronige Vorwüchse), Zwiesel und kranke Bäume entnehmen, seltene Mischbaumarten freistellen. Wenig Aufwand: nur dort eingreifen, wo es nötig ist („negative Auslese“).', basis: 3, g: { ertrag: 2, natur: 1, aufwand: -1 }, foerder: ['jungbestandspflege'], massnahme: 'pflege' },
    { k: 'pflegepfade', titel: 'Pflegepfade anlegen', text: 'Alle 20–40 m einen schmalen Pfad freischneiden. Daraus werden später die Rückegassen.', basis: 2, g: { ertrag: 1, aufwand: 1 }, foerder: [], aktion: 'gassen' },
    { k: 'mischung_dickung', titel: 'Mischung regulieren', text: 'Konkurrenzschwache Baumarten (z. B. Eiche, Kirsche, Tanne) vor bedrängenden Nachbarn schützen.', basis: 1, g: { natur: 2, ertrag: 1 }, foerder: ['jungbestandspflege'] },
  ],
  stangenholz: [
    { k: 'zbaum', titel: 'Z-Bäume auswählen', text: 'Vitale, gerade Bäume mit guter Krone dauerhaft markieren: Fichte/Kiefer/Lärche ca. 150–200 je ha, Buche/Eiche ca. 60–100 je ha, etwa gleichmäßig verteilt.', basis: 2, g: { ertrag: 2 }, foerder: [] },
    { k: 'erstdurchforstung', titel: 'Erste Durchforstung', text: 'Die stärksten Bedränger der Z-Bäume entnehmen. Die Durchforstungshilfe der App rechnet die Menge und führt dich im Bestand von Punkt zu Punkt.', basis: 3, g: { ertrag: 2, aufwand: -1 }, foerder: ['durchforstung'], aktion: 'durchforstung' },
    { k: 'rueckegassen', titel: 'Rückegassen anlegen', text: 'Feste Rückegassen im Abstand von 20–40 m, etwa 4 m breit. Gefahren wird nur noch auf den Gassen – das schont den Boden.', basis: 2, g: { ertrag: 1, natur: 1 }, foerder: [], aktion: 'gassen' },
    { k: 'astung', titel: 'Wertastung', text: 'Bei Douglasie, Kiefer, Lärche oder Kirsche an den Z-Bäumen die Äste bis etwa 6 m entfernen – nur, wenn später Wertholz verkauft werden soll.', basis: 0, g: { ertrag: 2, aufwand: -2 }, foerder: [], nurArten: /douglasie|kiefer|lärche|kirsche/i },
  ],
  baumholz: [
    { k: 'durchforstung', titel: 'Durchforstung', text: 'Den Z-Bäumen weiter Platz verschaffen. Die Menge gibt die Durchforstungshilfe (Methode Fassung 5) vor – höchstens 50 Fm je ha und Eingriff.', basis: 3, g: { ertrag: 2 }, foerder: ['durchforstung'], aktion: 'durchforstung' },
    { k: 'habitat', titel: 'Habitatbäume auswählen', text: 'Etwa 5 Bäume je ha mit Höhlen, Pilzen oder Rissen dauerhaft stehen lassen und in der Karte eintragen. Totholz liegen lassen, wo es nicht stört.', basis: 1, g: { natur: 3, aufwand: 1, ertrag: -1 }, foerder: ['habitat'], aktion: 'habitat' },
    { k: 'verjuengung', titel: 'Verjüngung vorbereiten', text: 'Naturverjüngung zulassen, in Fichten- und Kiefernreinbeständen Mischbaumarten (z. B. Buche oder Tanne) unter Schirm voranbauen.', basis: 1, g: { natur: 1, ertrag: 1 }, foerder: ['voranbau'], massnahme: 'pflanzung', reinbestand: true },
    { k: 'zielstaerke', titel: 'Zielstärken ernten', text: 'Bäume, die ihren Zieldurchmesser erreicht haben (z. B. Fichte ab ca. 45 cm, Buche ab 55 cm, Eiche ab 65 cm), einzeln oder in Gruppen ernten.', basis: 1, g: { ertrag: 2, natur: -1 }, foerder: [], ab: 25 },
  ],
};
const ZUSATZ = [
  { k: 'bejagung', titel: 'Bejagung abstimmen', text: 'Mit dem Jagdpächter Schwerpunkte, Ansitze und Schussschneisen besprechen. Wo Verjüngung wachsen soll, muss der Wildbestand passen.', basis: 0, g: { jagd: 2 }, foerder: [], aktion: 'jagd', ab: { ziel: 'jagd', wert: 2 } },
  { k: 'wege', titel: 'Wege und Waldränder pflegen', text: 'Totes Holz und gefährliche Äste an Wegen regelmäßig kontrollieren (Verkehrssicherung), Waldränder stufig und blühreich halten.', basis: 0, g: { erholung: 2, natur: 1 }, foerder: [], massnahme: 'verkehrssicherung', ab: { ziel: 'erholung', wert: 2 } },
];

let regelnP = null;
export const foerderRegeln = () => (regelnP ||= fetch('data/foerderregeln.json').then((r) => r.json()).catch(() => null));
const FOERDER_ALIAS = { pflanzung: ['pflanzung'], voranbau: ['voranbau'], kulturpflege: ['kulturpflege'], jungbestandspflege: ['jungbestandspflege'], wildschutz: ['wildschutz'], durchforstung: ['durchforstung'], habitat: ['habitat'], mischung: ['mischung'] };
export function passendeFoerderung(regeln, keys) {
  if (!regeln) return [];
  const wanted = new Set(keys.flatMap((k) => FOERDER_ALIAS[k] || [k]));
  return regeln.tatbestaende.filter((t) => t.fuer.some((f) => wanted.has(f)));
}

/** Gewichtete Aufgabenliste */
export function aufgaben(phase, { art = '', reinbestand = false, oberhoehe = null, ziel = ziele() } = {}) {
  const z = ziel || { ertrag: 1, natur: 1, aufwand: 1, jagd: 1, erholung: 1 };
  const liste = [...(AUFGABEN[phase] || []), ...ZUSATZ.filter((a) => (z[a.ab.ziel] || 0) >= a.ab.wert)]
    .filter((a) => !a.nurArten || a.nurArten.test(art))
    .filter((a) => !a.reinbestand || reinbestand)
    .filter((a) => typeof a.ab !== 'number' || oberhoehe == null || oberhoehe >= a.ab);
  return liste.map((a) => ({ ...a, score: a.basis + Object.entries(a.g).reduce((s, [k, v]) => s + v * (z[k] ?? 1), 0) * 0.6 })).sort((a, b) => b.score - a.score);
}

// ---------- Skizzen ----------
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const FARBEN = { nadel: '#2F6B3A', laub: '#6FA34B', misch: '#C9A227', zb: '#F26B1D' };
function baum(x, boden, hoehe, breite, typ, { z = false, protz = false } = {}) {
  const stamm = `<rect x="${x - Math.max(0.8, breite * 0.08)}" y="${boden - hoehe * 0.45}" width="${Math.max(1.6, breite * 0.16)}" height="${hoehe * 0.45}" fill="#7A5230"/>`;
  const krone = typ === 'nadel'
    ? `<path d="M${x} ${boden - hoehe} L${x + breite / 2} ${boden - hoehe * 0.3} L${x - breite / 2} ${boden - hoehe * 0.3} Z" fill="${FARBEN.nadel}"/>`
    : `<ellipse cx="${x}" cy="${boden - hoehe * 0.68}" rx="${breite / 2}" ry="${hoehe * 0.33}" fill="${typ === 'misch' ? FARBEN.misch : FARBEN.laub}"/>`;
  const band = z ? `<rect x="${x - breite * 0.12 - 1}" y="${boden - hoehe * 0.22}" width="${breite * 0.24 + 2}" height="3" fill="${FARBEN.zb}"/>` : '';
  return stamm + krone + band + (protz ? `<circle cx="${x}" cy="${boden - hoehe * 0.7}" r="${breite * 0.55}" fill="none" stroke="#B3261E" stroke-width="1.5" stroke-dasharray="3 2"/>` : '');
}
/** Skizze einer Phase: variante 'ist' (häufiger Zustand) oder 'soll' (Ziel) */
export function skizze(phase, variante, nadel = true) {
  const W = 160, H = 100, boden = 90, r = rng(phase.length * 7 + (variante === 'ist' ? 1 : 2));
  const typ = nadel ? 'nadel' : 'laub';
  let teile = '';
  const gras = (dicht) => Array.from({ length: dicht }, (_, i) => `<path d="M${(i * W) / dicht + r() * 3} ${boden} q2 -${6 + r() * 8} 4 0" stroke="#8DB255" fill="none" stroke-width="1.4"/>`).join('');
  if (phase === 'jungwuchs') {
    const n = 7;
    for (let i = 0; i < n; i++) { const x = 14 + i * 21; teile += baum(x, boden, 16 + r() * 4, 9, i % 3 === 1 && variante === 'soll' ? 'misch' : typ); }
    teile += variante === 'ist' ? gras(60) + `<rect x="0" y="${boden - 14}" width="${W}" height="14" fill="#9CC46A" opacity=".55"/>` : gras(12);
  } else {
    const cfg = { dickung: [16, 34, 8, 4], stangenholz: [12, 58, 9, 7], baumholz: [8, 80, 16, 14] }[phase];
    const [nIst, hoehe, bIst, bSoll] = cfg;
    const n = variante === 'ist' ? nIst : Math.max(3, Math.round(nIst * 0.55));
    for (let i = 0; i < n; i++) {
      const x = 8 + (i + 0.5) * ((W - 16) / n) + (r() - 0.5) * 4;
      const hh = hoehe * (0.75 + r() * 0.3);
      if (variante === 'ist') teile += baum(x, boden, hh, bIst + r() * 3, typ, { protz: phase === 'dickung' && i === 3 });
      else teile += baum(x, boden, hh, bIst + bSoll * 0.6, i % 3 === 2 ? (nadel ? 'misch' : 'laub') : typ, { z: phase !== 'dickung' && i % 2 === 0 });
    }
    if (variante === 'soll' && phase === 'baumholz') teile += [30, 95, 128].map((x) => baum(x, boden, 12, 7, nadel ? 'laub' : 'misch')).join('');
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${variante === 'ist' ? 'So sieht es oft aus' : 'So sollte es aussehen'}"><rect width="${W}" height="${H}" fill="#EAF2E3"/><rect y="${boden}" width="${W}" height="${H - boden}" fill="#B9A27A"/>${teile}</svg>`;
}
const SKIZZE_TEXT = {
  jungwuchs: ['Pflanzen von Gras und Brombeere überwachsen', 'Pflanzen frei, Mischbaumarten (gelb) erhalten'],
  dickung: ['sehr dicht, einzelne Protzen (rot markiert) bedrängen die Nachbarn', 'aufgelockert, Mischung erhalten, Protzen entnommen'],
  stangenholz: ['zu dicht, kleine Kronen, dünne Stämme', 'Z-Bäume (orange Band) mit freier Krone'],
  baumholz: ['geschlossenes Kronendach, keine Verjüngung', 'kräftige Z-Bäume, Mischung und Verjüngung darunter'],
};

// ---------- Karte ----------
/**
 * @param {object} o
 *  phase, quelle, oberhoehe, alter, art, einartig (bool), bzt (Ergebnis empfehlung()), durchforstung { faellig, text },
 *  onDurchforstung(), onMassnahme(typ), onAktion(key), onPhase(key)
 */
export function bestandsprofil(o) {
  const P = PHASEN[o.phase];
  const nadel = /fichte|kiefer|lärche|douglasie|tanne/i.test(o.art || '');
  const wrap = h('div', { class: 'empf' });
  const phaseWahl = h('div', { class: 'q-chips empf-phasen' }, REIHE.map((k) => h('button', { type: 'button', class: `q-option ${o.phase === k ? 'on' : ''}`, onclick: () => o.onPhase?.(k) }, PHASEN[k].name)));
  if (!P) {
    fill(wrap, h('div', { class: 'geo-card' }, h('p', { class: 'geo-kicker' }, 'Entwicklungsphase'),
      h('p', {}, 'Für diese Fläche gibt es keine Oberhöhe aus den LiDAR-Daten und kein Alter. In welcher Phase ist der Bestand?'), phaseWahl));
    return wrap;
  }
  const liste = aufgaben(o.phase, { art: o.art, reinbestand: o.einartig, oberhoehe: o.oberhoehe });
  const z = ziele();
  const herkunft = o.quelle === 'oberhoehe' ? `Oberhöhe ${o.oberhoehe.toFixed(1).replace('.', ',')} m (LiDAR)${o.alter != null ? `, Alter etwa ${o.alter} Jahre` : ''}`
    : o.quelle === 'alter' ? `nach dem Alter (etwa ${o.alter} Jahre) – keine Oberhöhe aus LiDAR` : 'von dir gewählt';
  const foerderBox = h('div', { class: 'empf-foerder' });
  foerderRegeln().then((regeln) => {
    const fs = passendeFoerderung(regeln, [...new Set(liste.slice(0, 4).flatMap((a) => a.foerder))].concat(o.einartig ? ['mischung'] : []));
    if (!fs.length) return;
    // kurz: nur die Titel; Sätze, Bedingungen und Links aufklappbar
    fill(foerderBox, h('details', { class: 'empf-foerder-kurz' },
      h('summary', {}, h('span', { class: 'foerder-marke' }, '€'), h('span', {}, h('strong', {}, 'Förderung möglich: '), fs.map((t) => t.titel).join(', '))),
      h('ul', { class: 'empf-foerder-liste' }, fs.map((t) => h('li', {},
        h('strong', {}, t.titel), h('small', {}, `${regeln.programme[t.programm]?.name || t.programm}: ${t.satz}`), h('small', { class: 'muted' }, t.bedingung),
        h('a', { href: regeln.programme[t.programm]?.link, target: '_blank', rel: 'noopener' }, 'Richtlinie und Formulare')))),
      h('p', { class: 'hint' }, `Stand ${new Date(regeln.stand).toLocaleDateString('de-DE')}${regeln.geprueft ? '' : ', noch nicht geprüft'}. Erst nach Bewilligung beginnen.`)));
  });
  const aufgabeEl = (a, i) => h('li', { class: i === 0 ? 'empf-top' : '' },
    h('strong', {}, a.titel), h('p', {}, a.text),
    a.aktion === 'durchforstung' && o.durchforstung ? h('p', { class: o.durchforstung.faellig ? 'empf-faellig' : 'muted' }, o.durchforstung.text) : null,
    h('div', { class: 'btn-row' },
      a.aktion === 'durchforstung' ? h('button', { type: 'button', class: `btn btn-small ${o.durchforstung?.faellig ? 'btn-primary' : ''}`, onclick: () => o.onDurchforstung?.() }, o.durchforstung?.faellig ? 'Durchforstung starten' : 'Durchforstung planen') : null,
      a.aktion && a.aktion !== 'durchforstung' ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => o.onAktion?.(a.aktion) }, { gassen: 'Rückegassen einzeichnen', habitat: 'Habitatbäume eintragen', jagd: 'Jagdeinrichtungen eintragen' }[a.aktion]) : null,
      a.massnahme ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => o.onMassnahme?.(a.massnahme, a.k) }, 'Als Maßnahme planen') : null));
  const zeigeAlle = liste.length > 3;
  const ol = h('ol', { class: 'empf-liste' }, liste.slice(0, 3).map(aufgabeEl));
  fill(wrap,
    h('div', { class: 'geo-card' },
      h('p', { class: 'geo-kicker' }, 'Entwicklungsphase'),
      h('h4', {}, P.name), h('p', {}, P.text), h('p', { class: 'muted' }, herkunft),
      h('details', { class: 'bzt-nachbar' }, h('summary', {}, 'Phase stimmt nicht?'), phaseWahl)),
    o.art ? ampelKarte(o.art, o.bzt) : null,
    h('div', { class: 'geo-card' },
      h('p', { class: 'geo-kicker' }, 'Das steht jetzt an'),
      h('div', { class: 'empf-skizzen' },
        h('figure', {}, h('div', { html: skizze(o.phase, 'ist', nadel) }), h('figcaption', {}, h('strong', {}, 'So sieht es oft aus: '), SKIZZE_TEXT[o.phase][0])),
        h('figure', {}, h('div', { html: skizze(o.phase, 'soll', nadel) }), h('figcaption', {}, h('strong', {}, 'So sollte es aussehen: '), SKIZZE_TEXT[o.phase][1]))),
      ol,
      zeigeAlle ? h('button', { type: 'button', class: 'link-btn', onclick: (e) => { fill(ol, liste.map(aufgabeEl)); e.currentTarget.remove(); } }, `Alle ${liste.length} Empfehlungen anzeigen`) : null,
      h('p', { class: 'hint' }, `Gewichtet nach deinen Zielen: ${zieleText(z)}. `, h('button', { type: 'button', class: 'link-btn', onclick: () => zieleAbfrage().then(() => o.onZiele?.()) }, z ? 'Ziele ändern' : 'Ziele festlegen'))),
    o.einartig ? mischHinweis(o) : null,
    foerderBox);
  return wrap;
}

function mischHinweis(o) {
  const e = o.bzt?.status === 'ok' ? o.bzt.eintrag : null;
  const vorhanden = (o.art || '').toLowerCase();
  const passt = (k) => !vorhanden.includes((BAUMARTEN_KURZ[k] || k).toLowerCase().split(' ')[0]);
  const misch = e ? [...e.C, ...e.B].filter((k, i, arr) => arr.indexOf(k) === i).filter(passt).slice(0, 6) : [];
  return h('div', { class: 'lrt-hinweis' },
    h('strong', {}, `Nur eine Baumart: ${o.art || 'Reinbestand'}`),
    h('p', {}, 'Reinbestände sind anfälliger für Sturm, Trockenheit und Käfer. Mischbaumarten verteilen das Risiko.'),
    misch.length ? h('div', {}, h('p', {}, 'Passend zum Standort laut Tabellenwerk:'), h('div', { class: 'ba-chips' }, misch.map((k) => h('span', { class: 'ba-chip' }, h('strong', {}, k), ` ${BAUMARTEN_KURZ[k] || ''}`))))
      : h('p', { class: 'muted' }, 'Welche Mischbaumarten passen, steht unter „Baumartenempfehlung“ (Standortskarte erforderlich).'),
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-small', onclick: () => o.onMassnahme?.('pflanzung') }, 'Voranbau / Pflanzung planen')));
}

/** Durchforstung fällig? Nach Methode Fassung 5: Eingriffsabstand 10/E Jahre (E = 1 oder 2) */
export function durchforstungStatus(parcelId, phase, oberhoehe) {
  if (!['stangenholz', 'baumholz'].includes(phase)) return null;
  const df = store.get().measures.filter((m) => m.type === 'durchforstung' && m.parcelId === parcelId);
  const offen = df.find((m) => m.status !== 'fertig');
  if (offen) return { faellig: true, text: 'Für diese Fläche ist schon eine Durchforstung angelegt – dort weitermachen.', measureId: offen.id };
  const letzte = df.filter((m) => m.finishedAt).sort((a, b) => b.finishedAt - a.finishedAt)[0];
  if (letzte) {
    const e = letzte.thinning?.plan?.eingriffe?.anzahl || 1;
    const naechste = new Date(letzte.finishedAt); naechste.setFullYear(naechste.getFullYear() + Math.round(10 / e));
    if (naechste > new Date()) return { faellig: false, text: `Letzter Eingriff ${new Date(letzte.finishedAt).getFullYear()}; der nächste ist etwa ${naechste.getFullYear()} fällig.` };
    return { faellig: true, text: `Letzter Eingriff ${new Date(letzte.finishedAt).getFullYear()} – eine Durchforstung ist wieder fällig.` };
  }
  if (oberhoehe != null && oberhoehe < 12) return { faellig: false, text: 'Mit unter 12 m Oberhöhe ist es für eine Durchforstung meist noch zu früh – erst Z-Bäume auswählen.' };
  return { faellig: true, text: 'In der App ist hier noch keine Durchforstung erfasst – wahrscheinlich ist eine fällig.' };
}

// ---------- Standort × Baumart (Ampel) ----------
const ART_CODES = [
  [/fichte/i, ['FI']], [/kiefer/i, ['KI']], [/lärche|laerche/i, ['LA']], [/douglasie/i, ['DGL']], [/tanne/i, ['WTA', 'TA', 'NB']],
  [/roteiche/i, ['REI', 'LB']], [/eiche/i, ['EI']], [/hainbuche/i, ['HBU', 'LB']], [/buche/i, ['BU']], [/ahorn|esche|ulme/i, ['ELB']],
  [/birke/i, ['BI', 'WLB']], [/erle/i, ['ER', 'WLB']], [/linde/i, ['LI', 'WLI', 'WLB']], [/kirsche/i, ['KB', 'ELB']], [/aspe|pappel|weide|eberesche/i, ['AS', 'EB', 'WLB']],
];
export const AMPEL = {
  gruen: { farbe: '#2E7D32', name: 'geeignet' },
  gelb: { farbe: '#F9A825', name: 'Risiko' },
  rot: { farbe: '#C62828', name: 'ungeeignet' },
  grau: { farbe: '#9E9E9E', name: 'unbekannt' },
};
/** Wie gut passt die Baumart zum Standort laut Tabellenwerk? */
export function standortAmpel(art, bzt) {
  if (!art) return { stufe: 'grau', text: 'Keine Baumart bekannt.' };
  if (!bzt || bzt.status !== 'ok') return { stufe: 'grau', text: 'Für den Standort gibt es keinen Eintrag im Tabellenwerk.' };
  const codes = ART_CODES.find(([re]) => re.test(art))?.[1] || [];
  const e = bzt.eintrag, in_ = (liste) => codes.some((c) => liste.includes(c));
  if (in_(e.B)) return { stufe: 'gruen', text: `${art} ist hier als Hauptbaumart empfohlen.` };
  if (in_(e.C)) return { stufe: 'gruen', text: `${art} ist hier als Mischbaumart (2/10 bis 5/10) geeignet – nicht als Reinbestand.` };
  if (in_(e.D)) return { stufe: 'gelb', text: `${art} ist hier nur als Nebenbaumart (bis 2/10) vorgesehen. Größere Anteile sind ein Risiko – langfristig mit standortgerechten Arten mischen.` };
  return { stufe: 'rot', text: `${art} wird für diesen Standort im künftigen Klima nicht empfohlen. Langfristig umbauen, z. B. mit ${[...e.B, ...e.C].slice(0, 4).map((k) => BAUMARTEN_KURZ[k] || k).join(', ') || 'standortgerechten Arten'}.` };
}
export function ampelKarte(art, bzt) {
  const a = standortAmpel(art, bzt);
  return h('div', { class: `geo-card ampel-karte ampel-${a.stufe}` },
    h('p', { class: 'geo-kicker' }, 'Standort × Baumart'),
    h('h4', {}, h('span', { class: 'ampel-punkt', style: `background:${AMPEL[a.stufe].farbe}` }), `${art || 'Baumart'}: ${AMPEL[a.stufe].name}`),
    h('p', {}, a.text),
    h('p', { class: 'hint' }, 'Grundlage: Tabellenwerk von ThüringenForst zur standortgerechten Baumartenwahl (Klimabereich 2041–2070).'));
}
