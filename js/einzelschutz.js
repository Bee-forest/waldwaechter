// Einzelschutz für eine geplante Pflanzung – aufgebaut wie der Zaunbau:
// 1. auf der Karte alle Pflanzen oder einzelne auswählen (aus der Pflanzplanung),
// 2. ein paar Fragen (wovor schützen, erdölbasiert ja/nein, Förderung, Priorität) → ideale Hülle wird vorgeschlagen,
// 3. alle Hüllen ansehen und frei wählen, 4. Stückliste mit Preisen (Hülle, Stab …), Förderung, buchen.
// Preise: Waldbesitzer Service GmbH (WBS), Materialsortiment Herbst 2026, netto zzgl. 19 % MwSt.
import { h, fill, openPage, toast, dialog } from './ui.js';
import { store, uid } from './store.js';
import { formatHa } from './geo.js';
import { SAETZE } from './foerder-formular.js';
import { miniKarte } from './flaeche.js';
import { gespeichertesLayout, flaechenRinge } from './pflanzlayout.js';
import { WBS as PFLANZ_WBS } from './pflanzpreise.js';

// Kategorien wie in der Maßnahmenliste (für Förderung und Historie)
export const SCHUTZ_ARTEN = [
  { art: 'Freiwuchsgitter / Drahthose', text: 'Gitter gegen Verbiss und Fegen; luftig, auch für Nadelholz.', material: null },
  { art: 'Wuchshülle', text: 'Geschlossene Hülle gegen Verbiss und Fegen.', material: null },
  { art: 'Fegeschutz (Spirale, Fegestab)', text: 'Nur gegen Fegen des Rehbocks, nicht gegen Verbiss.', material: null },
  { art: 'Terminaltriebschutz', text: 'Schützt nur den Leittrieb, vor allem bei Nadelbäumen.', material: null },
  { art: 'Verbissschutzmittel (Streichmittel)', text: 'Wird auf die Triebe gestrichen und muss jährlich erneuert werden.', material: null },
];
export const SCHUTZ_HOEHEN = [['0,60 m', 60], ['0,90 m', 90], ['1,20 m', 120], ['1,50 m', 150], ['1,80 m', 180], ['2,00 m', 200]];

const MWST = 1.19;
const WBS_URL = 'https://www.waldbesitzer-service.de/seite/883737/materialsortiment-herbst-2026';
const brutto = (netto) => Math.round(netto * MWST * 100) / 100;

// ---------- Bilder (eigene Zeichnungen je Bauart) ----------
const SVG = (inhalt) => `<svg viewBox="0 0 80 100" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><rect width="80" height="100" rx="10" fill="#EEF3EA"/>${inhalt}<path d="M8 92h64" stroke="#7A6A4F" stroke-width="3" stroke-linecap="round"/></svg>`;
const BILD = {
  huelle: SVG('<rect x="26" y="14" width="22" height="76" rx="3" fill="#C9D7B7" stroke="#6E8B4E" stroke-width="2"/><path d="M30 24h14M30 40h14M30 56h14M30 72h14" stroke="#9DB383" stroke-width="2"/><rect x="51" y="8" width="4" height="84" fill="#A0784F"/><path d="M37 14c-2-6 2-9 4-10" stroke="#2E7D32" stroke-width="3" fill="none"/>'),
  belueftet: SVG('<rect x="26" y="14" width="22" height="76" rx="3" fill="#D3DEC5" stroke="#6E8B4E" stroke-width="2"/>' + [22, 34, 46, 58].map((y) => `<circle cx="32" cy="${y}" r="2" fill="#6E8B4E"/><circle cx="42" cy="${y + 6}" r="2" fill="#6E8B4E"/>`).join('') + '<rect x="51" y="8" width="4" height="84" fill="#A0784F"/><path d="M37 14c-2-6 2-9 4-10" stroke="#2E7D32" stroke-width="3" fill="none"/>'),
  gitter: SVG('<rect x="24" y="14" width="26" height="76" rx="3" fill="none" stroke="#5B7F3A" stroke-width="2"/>' + [0, 1, 2, 3, 4, 5, 6].map((i) => `<path d="M24 ${18 + i * 11}l26 9M50 ${18 + i * 11}l-26 9" stroke="#5B7F3A" stroke-width="1.4"/>`).join('') + '<rect x="53" y="8" width="4" height="84" fill="#A0784F"/><path d="M37 30v-24" stroke="#2E7D32" stroke-width="3"/><path d="M37 16l-7-5M37 22l7-5" stroke="#2E7D32" stroke-width="2.5"/>'),
  holz: SVG(Array.from({ length: 6 }, (_, i) => `<rect x="${24 + i * 4.4}" y="14" width="3.6" height="76" rx="1" fill="${i % 2 ? '#C79A63' : '#D8AE78'}"/>`).join('') + '<path d="M23 30h28M23 70h28" stroke="#7A5A33" stroke-width="2"/><rect x="54" y="8" width="4" height="84" fill="#A0784F"/>'),
  bio: SVG('<rect x="26" y="14" width="22" height="76" rx="3" fill="#E5D9B6" stroke="#9C8A52" stroke-width="2"/><path d="M31 30c6-6 12 0 6 6s-12 0 -6-6z" fill="#7FA35A"/><rect x="51" y="8" width="4" height="84" fill="#A0784F"/>'),
  stachel: SVG('<rect x="37" y="16" width="5" height="74" fill="#5E7D3E"/>' + [22, 32, 42, 52, 62, 72].map((y, i) => `<path d="M${i % 2 ? 42 : 37} ${y}l${i % 2 ? 10 : -10} -4" stroke="#5E7D3E" stroke-width="3" stroke-linecap="round"/>`).join('') + '<path d="M26 90c4-20 6-40 4-70" stroke="#2E7D32" stroke-width="3" fill="none"/>'),
  klemme: SVG('<path d="M40 90V24" stroke="#2E7D32" stroke-width="4"/><path d="M40 40l-12-8M40 52l12-8M40 64l-12-8" stroke="#2E7D32" stroke-width="3"/><path d="M33 16c0-6 14-6 14 0v10c0 4-14 4-14 0z" fill="#E0A32E" stroke="#9C6B10" stroke-width="2"/>'),
  mittel: SVG('<rect x="20" y="30" width="40" height="56" rx="6" fill="#4F7BB5"/><rect x="46" y="22" width="10" height="10" rx="2" fill="#2F5E99"/><rect x="26" y="46" width="28" height="22" rx="3" fill="#fff"/><path d="M30 56h20M30 62h14" stroke="#4F7BB5" stroke-width="2"/>'),
  stab: SVG('<rect x="37" y="6" width="6" height="86" fill="#A0784F"/><path d="M37 92l3 4 3-4" fill="#A0784F"/>'),
};

/**
 * Sortiment (WBS-Nr. = Nummer im Materialsortiment). hoehe in cm, material: kunststoff | holz | bio | natur.
 * FESTLEGUNG: Höhe von Dendron und Buck Bio-Wuchshülle laut Sortiment nicht angegeben → 120 cm angenommen (im Angebot prüfen).
 */
export const PRODUKTE = [
  { id: 'plantagard', name: 'PlantaGard Wuchshülle 1200×100×100 mm', netto: 1.48, typ: 'huelle', kat: 'Wuchshülle', hoehe: 120, material: 'kunststoff', schutz: ['verbiss', 'fegen'], stab: 'akazie1500', bild: 'huelle',
    text: 'Geschlossene, eckige Kunststoffhülle. Günstig; das Kleinklima in der Hülle fördert das Wachstum von Laubholz.', nadel: false },
  { id: 'freiwuchs', nr: 6, name: 'PlantaGard „Freiwuchs 300“ 1200 mm', netto: 2.30, typ: 'gitter', kat: 'Freiwuchsgitter / Drahthose', hoehe: 120, material: 'kunststoff', schutz: ['verbiss', 'fegen'], stab: 'akazie1500', bild: 'gitter',
    text: 'Luftiges Kunststoffgitter – kein Hitzestau, deshalb auch für Nadelholz und Lichtbaumarten geeignet.', nadel: true },
  { id: 'tubex120', nr: 17, name: 'Tubex-Ventex Schutzhülle 120 cm', netto: 2.58, typ: 'huelle', kat: 'Wuchshülle', hoehe: 120, material: 'kunststoff', schutz: ['verbiss', 'fegen'], stab: 'akazie1500', bild: 'belueftet',
    text: 'Belüftete Markenhülle, stabil; gegen Rehwild. Sollbruchstelle, wächst nicht ein.', nadel: false },
  { id: 'tubex150', nr: 88, name: 'Tubex-Ventex Schutzhülle 150 cm', netto: 2.88, typ: 'huelle', kat: 'Wuchshülle', hoehe: 150, material: 'kunststoff', schutz: ['verbiss', 'fegen'], stab: 'akazie2000', bild: 'belueftet',
    text: 'Belüftet, 1,50 m – bei hohem Rehwilddruck, Schnee und Damwild.', nadel: false },
  { id: 'tubex180', nr: 18, name: 'Tubex-Ventex Schutzhülle 180 cm', netto: 4.37, typ: 'huelle', kat: 'Wuchshülle', hoehe: 180, material: 'kunststoff', schutz: ['verbiss', 'fegen'], stab: 'akazie2000', bild: 'belueftet',
    text: 'Belüftet, 1,80 m – gegen Rotwild.', nadel: false },
  { id: 'dendron', nr: 117, name: 'Wuchshülle aus Holz – Dendron', netto: 3.73, typ: 'huelle', kat: 'Wuchshülle', hoehe: 120, material: 'holz', schutz: ['verbiss', 'fegen'], stab: 'akazie1500', bild: 'holz',
    text: 'Aus Holz, kunststofffrei und verrottbar – muss nicht wieder eingesammelt werden. Förderfähig.', nadel: true },
  { id: 'buck', nr: 132, name: 'Buck Bio-Wuchshülle', netto: 5.75, typ: 'huelle', kat: 'Wuchshülle', hoehe: 120, material: 'bio', schutz: ['verbiss', 'fegen'], stab: 'akazie1500', bild: 'bio',
    text: 'Biobasierte, abbaubare Hülle (nicht erdölbasiert). Förderfähig nur, wenn sie laut Hersteller kunststofffrei ist.', nadel: false },
  { id: 'stachel', nr: 92, name: 'PlantaGard Stachelbäume', netto: 0.92, typ: 'fegeschutz', kat: 'Fegeschutz (Spirale, Fegestab)', hoehe: 120, material: 'kunststoff', schutz: ['fegen'], stab: null, bild: 'stachel',
    text: 'Stachelstab neben die Pflanze – hält den Rehbock vom Fegen ab. Kein Verbissschutz.', nadel: true },
  { id: 'klemmen', nr: 99, name: 'Verbissschutzklemmen', netto: 15.46 / 100, einheitText: '15,46 € je 100 Stück', typ: 'terminal', kat: 'Terminaltriebschutz', hoehe: 0, material: 'kunststoff', schutz: ['leittrieb'], stab: null, bild: 'klemme',
    text: 'Klemme am Leittrieb – schützt nur die Triebspitze, vor allem bei Nadelholz. Jedes Jahr umsetzen.', nadel: true },
  { id: 'trico', nr: 7, name: 'Trico Verbiss- und Fegeschutz mittel, 5-l-Kanister', netto: 73.25, je: 'Kanister', typ: 'mittel', kat: 'Verbissschutzmittel (Streichmittel)', hoehe: 0, material: 'natur', schutz: ['verbiss', 'fegen', 'leittrieb'], stab: null, bild: 'mittel',
    // FESTLEGUNG: Richtwert 1 Kanister (5 l) je 1.000 Pflanzen – Menge im Angebot anpassen
    proKanister: 1000, text: 'Sprüh- und Streichmittel auf Schafwollbasis gegen Verbiss und Fegen. Muss jedes Jahr erneuert werden.', nadel: true },
];
// ---------- Infos je Hülle: Versuche und Praxis, Aufbau, Quellen ----------
const Q = {
  lwf: { titel: 'LWF/TU Dresden: Mikroklima in Wuchshüllen (waldwissen.net)', url: 'https://www.waldwissen.net/de/waldwirtschaft/waldbau/waldverjuengung/mikroklima-in-handelsueblichen-und-biologisch-abbaubaren-wuchshuellen' },
  lwfPdf: { titel: 'LWF aktuell 2/2024: Wuchshüllen im Test (PDF)', url: 'https://www.lwf.bayern.de/mam/cms04/waldbau-bergwald/bilder/a145_s7-11_schuldt.pdf' },
  douglasie: { titel: 'Douglasie in drei Wuchshüllentypen, Baden-Württemberg (Allg. Forst- u. J.-Zeitung)', url: 'https://www.sauerlaender-verlag.com/en/?p=2814' },
  praxis: { titel: 'Wuchshüllen in der forstlichen Praxis – Umfrage BW (waldwissen.net)', url: 'https://www.waldwissen.net/de/waldwirtschaft/waldbau/waldverjuengung/wuchshuellen-in-der-forstlichen-praxis' },
  afz: { titel: 'AFZ-DerWald 22/2024: Holz statt Plastik – neue Wuchshüllen (PDF)', url: 'https://lms.wald.rlp.de/pluginfile.php/17524/mod_resource/content/1/AFZ_22_2024_Zusammenfassung.pdf' },
  abbau: { titel: 'Abbaubarkeit von Wuchshüllen (waldwissen.net)', url: 'https://www.waldwissen.net/de/waldwirtschaft/waldbau/waldverjuengung/abbaubarkeit-von-wuchshuellen' },
  merkblatt: { titel: 'LWF-Merkblatt 40: Wuchshüllen (PDF)', url: 'https://lfl.bayern.de/mam/cms04/service/dateien/rz_mb40_wuchshüllen_6seitig_wickelfalz_071222_web_bf.pdf' },
  kwf: { titel: 'KWF: Prüfung von Einzelschutzlösungen, „KWF-Test Pflanzenschutz“ (PDF)', url: 'https://kwf2020.kwf-online.de/wp-content/uploads/2022/05/05_Kobov.pdf' },
  wbs: { titel: 'WBS Materialsortiment Herbst 2026', url: WBS_URL },
};
const AUFBAU_HUELLE = [
  'Stab auf der Hauptwindseite (meist West) dicht neben der Pflanze senkrecht einschlagen, etwa 30–40 cm tief, so dass er die Hülle oben überragt.',
  'Hülle von oben über die Pflanze stülpen, ohne Triebe abzuknicken, und unten einige Zentimeter in den Boden drücken – so kommen Mäuse und Wind nicht darunter.',
  'Hülle mit den beiliegenden Bindern (oben und unten) am Stab festmachen.',
  'Begleitwuchs (Gras, Brombeere) in den ersten Jahren rund um die Hülle zurückdrängen.',
  'Wenn der Baum oben herausgewachsen und stabil ist, Hülle und Stab abbauen und mitnehmen – Kunststoff darf nicht im Wald bleiben.',
];
const INFO = {
  plantagard: { praxis: ['In einem Versuch der TU Dresden/LWF kam in Polypropylen-Hüllen von PlantaGard (Microvent) im Tagesmaximum etwa zwei Drittel des Lichts an (66 % der Freifläche).', 'An Douglasie in Baden-Württemberg waren Pflanzen in PlantaGard-Hüllen nach drei Jahren deutlich höher als ohne Hülle, aber etwas dünner im Wurzelhals – also schlanker.'],
    aufbau: AUFBAU_HUELLE, quellen: ['lwf', 'douglasie', 'merkblatt', 'wbs'] },
  freiwuchs: { praxis: ['Gitterhüllen sind luftiger: Laut einer Umfrage unter Förstern in Baden-Württemberg liegen die Vorteile der Gitterhülle genau in den Nachteilen der geschlossenen Wuchshüllen – und umgekehrt (kein Hitzestau, mehr Licht, aber weniger Treibhauseffekt).', 'An Douglasie wuchsen Pflanzen im PlantaGard-Gitter nach drei Jahren etwas höher als ohne Schutz, aber weniger stark als in geschlossenen Hüllen.'],
    aufbau: ['Stab dicht neben der Pflanze einschlagen (30–40 cm tief).', 'Gitter zu einer Röhre formen bzw. über die Pflanze stülpen und am Stab mit Bindern befestigen.', 'Seitentriebe, die durch das Gitter wachsen, nicht abreißen.', 'Gitter abbauen, sobald der Leittrieb über Äserhöhe ist.'], quellen: ['praxis', 'douglasie', 'wbs'] },
  tubex120: { praxis: ['In belüfteten Tubex-Ventex-Hüllen (Ventex Clear) kam im Mittel rund drei Viertel des Lichts an (78 % der Freifläche) – mehr als in den anderen geprüften Kunststoffhüllen.', 'Bei Elsbeere wuchsen die Pflanzen in Kunststoffhüllen im Versuch etwa 50 % mehr in die Höhe als ohne Hülle – allerdings auf Kosten der Stabilität.', 'An Douglasie in Baden-Württemberg hing die Vitalität nicht vom Hüllendurchmesser (8–12 cm) ab.'],
    aufbau: AUFBAU_HUELLE, quellen: ['lwf', 'praxis', 'merkblatt', 'wbs'] },
  dendron: { praxis: ['Dendron (Firma Walthmeyer) besteht aus 2 mm starkem Nadelholzfurnier; es gibt Laub-, Universal- und Nadelholz-Varianten.', 'Im Versuch der TU Dresden/LWF ließ die Holzhülle im Tagesmaximum am meisten Licht durch (77 % der Freifläche). Bei Elsbeere lag der Höhenzuwachs etwa 16 % über der Pflanze ohne Hülle – weniger Treibhauseffekt als in Kunststoff, dafür stabiler.'],
    aufbau: ['Stab dicht neben der Pflanze einschlagen.', 'Furnierhülle aufstellen bzw. aufspreizen und um die Pflanze legen, am Stab befestigen (Montage laut Hersteller, z. B. mit Tacker oder Draht).', 'Die Hülle verrottet mit der Zeit und muss nicht eingesammelt werden – den Stab später entfernen oder ebenfalls verrotten lassen.'], quellen: ['afz', 'lwf', 'lwfPdf', 'wbs'] },
  buck: { praxis: ['Biobasierte Hüllen sollen sich nach einigen Jahren abbauen. Bei abbaubaren Tubex-Hüllen etwa ist die volle Funktion auf 5 Jahre ausgelegt, danach folgen weitere 5 Jahre Abbau – für die Buck-Hülle bitte die Herstellerangaben prüfen.', 'Achtung Licht: Im LWF-Versuch kam in einer Biokunststoff-Hülle (PLA) nur gut ein Fünftel, in einer Papierhülle sogar nur rund ein Zehntel des Lichts an – undurchsichtige Biohüllen nur an sehr hellen Plätzen.'],
    aufbau: AUFBAU_HUELLE.slice(0, 4).concat(['Abbaubare Hüllen müssen nicht eingesammelt werden; prüfe trotzdem, ob Reste stören.']), quellen: ['abbau', 'lwf', 'wbs'] },
  stachel: { praxis: ['Stachelbäume halten den Rehbock vom Fegen ab, schützen aber nicht gegen Verbiss.'],
    aufbau: ['Im Frühjahr vor der Fegezeit (ab April) dicht neben die Pflanze stecken, Stacheln zum Bäumchen.', 'Bei Laubholz mit hohem Verbissdruck zusätzlich Verbissschutz einsetzen.'], quellen: ['wbs'] },
  klemmen: { praxis: ['Klemmen schützen nur die Knospe am Leittrieb – Seitentriebe bleiben ungeschützt. Vor allem für Nadelholz.'],
    aufbau: ['Im Herbst vor dem Winterverbiss knapp unter der Endknospe auf den Leittrieb klemmen.', 'Jedes Jahr nach dem Austrieb auf den neuen Leittrieb umsetzen.'], quellen: ['wbs'] },
  trico: { praxis: ['Streichmittel wirken nur eine Saison und müssen jedes Jahr erneuert werden; der Aufwand steigt mit der Pflanzenzahl.'],
    aufbau: ['Bei trockenem, frostfreiem Wetter im Herbst (Winterverbiss) bzw. Frühjahr (Fegen) auf Leittrieb und obere Triebe sprühen oder streichen.', 'Gebrauchsanleitung und Aufwandmenge auf dem Kanister beachten.'], quellen: ['wbs'] },
};
INFO.tubex150 = INFO.tubex120; INFO.tubex180 = INFO.tubex120;

/** Info-Fenster zu einer Hülle: Praxis und Versuche, Aufbau, KWF, Quellen */
export function zeigeInfo(p) {
  const inf = INFO[p.id] || { praxis: [], aufbau: [], quellen: ['wbs'] };
  dialog({ title: p.name, actions: [{ label: 'Schließen', value: null }], body: h('div', { class: 'es-info' },
    h('div', { class: 'es-info-kopf' }, h('div', { class: 'es-bild', html: BILD[p.bild] }), h('p', {}, p.text)),
    inf.praxis.length ? h('div', {}, h('p', { class: 'sheet-label' }, 'Erfahrungen und Versuche'), h('ul', {}, inf.praxis.map((t) => h('li', {}, t)))) : null,
    h('div', {}, h('p', { class: 'sheet-label' }, 'Aufbau'), h('ol', {}, inf.aufbau.map((t) => h('li', {}, t))), h('small', { class: 'muted' }, 'Allgemeine Hinweise – die Montageanleitung des Herstellers geht vor.')),
    h('div', {}, h('p', { class: 'sheet-label' }, 'KWF-Prüfung'),
      h('p', {}, 'Das KWF prüft Einzelschutz und vergibt das Gebrauchswertzeichen „KWF-Test Pflanzenschutz“. Ob dieses Produkt geprüft ist, steht auf der Verpackung bzw. in den Prüfberichten des KWF.')),
    h('div', {}, h('p', { class: 'sheet-label' }, 'Quellen'), h('ul', { class: 'es-quellen' }, [...inf.quellen, 'kwf'].filter((k, i, a) => a.indexOf(k) === i).map((k) => h('li', {}, h('a', { href: Q[k].url, target: '_blank', rel: 'noopener' }, Q[k].titel)))))) });
}

const STAEBE = {
  akazie1500: { id: 'akazie1500', nr: 1, name: 'Akazienstab 1500×22×22 mm', netto: 0.80, bild: 'stab' },
  akazie2000: { id: 'akazie2000', nr: 2, name: 'Akazienstab 2000×22×22 mm', netto: 1.95, bild: 'stab' },
};
const kunststofffrei = (p) => p.material === 'holz' || (p.material === 'bio' && false);
const erdoelfrei = (p) => p.material !== 'kunststoff';

/** Förderung je Stück nach Höhe (Richtlinie Teil A und Landesprogramm) */
export function esFoerderung(cm) {
  if (!(cm >= 120)) return null;
  const g = cm >= 180 ? 'gross' : 'klein';
  return { stufe: g === 'gross' ? 'ab 180 cm' : '120–150 cm', GANW: SAETZE.GANW.es[g], LABE: SAETZE.LABE.es[g] };
}
const foerderfaehig = (p) => (p.typ === 'huelle' || p.typ === 'gitter') && kunststofffrei(p) && p.hoehe >= 120;

const NADEL = /fichte|kiefer|tanne|lärche|douglasie|eibe|nadel/i;
// Weniger verbissgefährdete Baumarten werden bei „Alle“ nicht automatisch geschützt
const SELTEN_GESCHUETZT = ['Gemeine Fichte', 'Gemeine Kiefer', 'Schwarzkiefer', 'Schwarzerle', 'Sandbirke', 'Aspe', 'Robinie', 'Blaufichte'];

/**
 * Ideale Hülle aus den Antworten. Liefert { produkt, gruende[], warnung } – oder null, wenn nichts passt.
 * a: { ziel: 'reh' | 'hoch' | 'rot' | 'fegen' | 'leittrieb', erdoel: 'nein' | 'egal', foerderung: bool, wichtig: 'preis' | 'haltbar', nadelAnteil: 0..1 }
 */
export function empfehle(a) {
  const gruende = [];
  let kand = PRODUKTE.filter((p) => {
    if (a.ziel === 'fegen') return p.typ === 'fegeschutz' || p.typ === 'mittel';
    if (a.ziel === 'leittrieb') return p.typ === 'terminal' || p.typ === 'mittel';
    return p.typ === 'huelle' || p.typ === 'gitter';
  });
  if (a.erdoel === 'nein') { kand = kand.filter(erdoelfrei); gruende.push('nicht erdölbasiert'); }
  if (a.foerderung && !['fegen', 'leittrieb'].includes(a.ziel)) { const f = kand.filter(foerderfaehig); if (f.length) { kand = f; gruende.push('förderfähig (kunststofffrei, ab 1,20 m)'); } }
  const minH = a.ziel === 'rot' ? 180 : a.ziel === 'hoch' ? 150 : 0;
  let warnung = null;
  if (minH) {
    const hoch = kand.filter((p) => p.hoehe >= minH);
    if (hoch.length) { kand = hoch; gruende.push(`mindestens ${(minH / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} m hoch`); }
    else warnung = `Keine passende Hülle mit ${(minH / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} m Höhe in dieser Auswahl – bei ${a.ziel === 'rot' ? 'Rotwild' : 'hohem Wilddruck'} besser einen Zaun erwägen oder Kunststoff zulassen.`;
  } else if (['reh'].includes(a.ziel)) {
    const n = kand.filter((p) => p.hoehe === 120); if (n.length) kand = n;
  }
  if (!kand.length) return null;
  // Nadelholz: keine geschlossenen Kunststoffhüllen (Hitzestau) → Gitter oder Holz bevorzugen
  const nadelLastig = (a.nadelAnteil || 0) >= 0.5;
  const schatten = a.licht === 'schatten';
  // Kosten je Pflanze (Streichmittel: Kanisterpreis je Richtwert-Pflanzenzahl)
  const kosten = (p) => (p.typ === 'mittel' ? brutto(p.netto) / p.proKanister : brutto(p.netto)) + (p.stab ? brutto(STAEBE[p.stab].netto) : 0);
  const punkte = (p) => {
    let s = 0;
    if (nadelLastig && p.typ === 'huelle' && p.material === 'kunststoff') s -= 5;
    if (nadelLastig && (p.typ === 'gitter' || p.nadel)) s += 2;
    // Unter Schirm/im Halbschatten: geschlossene Hüllen nehmen zu viel Licht → offenes Gitter bevorzugen
    if (schatten && p.typ === 'gitter') s += 6;
    if (schatten && p.typ === 'huelle') s -= 3;
    if (a.wichtig === 'preis') s -= kosten(p) * 2;
    else {
      // langlebig/bewährt: belüftete Markenhülle bzw. mechanischer Schutz statt jährlich zu erneuerndem Mittel
      s += /^tubex/.test(p.id) ? 4 : p.id === 'buck' ? 3 : p.id === 'freiwuchs' ? 1 : 0;
      if (p.typ === 'mittel') s -= 4;
      s -= kosten(p) * 0.3;
    }
    // Holzlatten lassen Licht durch: im Schatten besser als eine geschlossene Biohülle
    if (schatten && p.id === 'dendron') s += 4;
    if (a.erdoel === 'nein' && a.ziel === 'fegen' && p.typ === 'mittel') s += 1;
    return s;
  };
  kand.sort((x, y) => punkte(y) - punkte(x));
  const best = kand[0];
  if (nadelLastig && best.nadel) gruende.push('geeignet für Nadelholz (kein Hitzestau)');
  if (schatten && best.typ === 'gitter') gruende.push('offenes Gitter – genug Licht unter Schirm');
  if (schatten && best.typ === 'huelle') gruende.push('geschlossene Hülle, obwohl schattig – nur so ist die gewählte Bedingung erfüllbar');
  gruende.push(a.wichtig === 'preis' ? 'günstigste passende Lösung' : best.typ === 'mittel' ? 'einzige passende Lösung' : 'langlebige, bewährte Lösung');
  if (kand.length === 1 && a.foerderung) gruende.push('die einzige förderfähige Hülle im Sortiment');
  return { produkt: best, gruende, warnung };
}

/** Stückliste für ein Produkt und eine Pflanzenzahl */
export function stueckliste(p, n, eigen = {}) {
  const zeilen = [];
  const preis = (id, netto) => (eigen[id] != null ? eigen[id] : brutto(netto));
  if (p.typ === 'mittel') {
    const k = Math.max(1, Math.ceil(n / p.proKanister));
    zeilen.push({ id: p.id, name: p.name, menge: k, einheit: 'Kanister', preis: preis(p.id, p.netto), nr: p.nr, info: `Richtwert 1 Kanister je ${p.proKanister.toLocaleString('de-DE')} Pflanzen – jährlich erneuern.` });
  } else {
    zeilen.push({ id: p.id, name: p.name, menge: n, einheit: 'Stück', preis: preis(p.id, p.netto), nr: p.nr, info: p.einheitText || '' });
    if (p.stab) { const s = STAEBE[p.stab]; zeilen.push({ id: s.id, name: s.name, menge: n, einheit: 'Stück', preis: preis(s.id, s.netto), nr: s.nr, info: 'Befestigungsstab, ein Stab je Hülle' }); }
  }
  const summe = zeilen.reduce((a, z) => a + z.menge * z.preis, 0);
  return { zeilen, summe, jePflanze: n ? summe / n : 0 };
}

const euro = (v) => `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const zahl = (v) => { const t = String(v ?? '').trim().replace(/\s|€/g, ''); if (!t) return null; const n = Number(/,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? n : null; };

const pflanzungsName = (m) => {
  const p = store.get().parcels.find((x) => x.id === m.parcelId);
  const n = (m.pflanzplan?.arten || []).reduce((a, x) => a + (x.stueck || 0), 0) || Number(m.details?.count) || 0;
  const wann = m.date ? new Date(m.date).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' }) : 'ohne Termin';
  const arten = [...new Set(artenAusPflanzung(m).map((a) => a.name))].slice(0, 2).join(', ');
  return `${arten ? `${arten} · ` : ''}${n ? `${n.toLocaleString('de-DE')} Pflanzen` : 'Stückzahl offen'} · ${p ? `Flurstück ${p.nr}, ${p.gemarkung}` : 'ohne Fläche'} · ${wann}${m.status === 'fertig' ? ' · erledigt' : ''}`;
};
/** Aus einer Pflanzungsmaßnahme ohne Pflanzplan (z. B. von Hand angelegt) die Baumarten lesen */
const artenAusPflanzung = (m) => (m?.pflanzplan?.arten?.length ? m.pflanzplan.arten
  : String(m?.details?.species || '').split(/,\s*/).filter(Boolean).map((name, i, all) => ({ name, stueck: i === 0 ? Number(m.details?.count) || 0 : 0 })));

/**
 * @param {{ pflanzung?: object|null, parcelId?: string, foerdern?: boolean, onSaved?: (id) => void, onAbbruch?: () => void }} o
 *   pflanzung: Pflanzungsmaßnahme (mit pflanzplan.arten, flaeche, date, parcelId) – ohne sie wird gefragt,
 *   welche Pflanzung geschützt werden soll (auch eine parallel angelegte), oder die Stückzahl selbst eingegeben.
 */
export function openEinzelschutzPlanung({ pflanzung = null, parcelId = null, foerdern = false, onSaved, onAbbruch = null, antworten = null }) {
  const pflanzungen = store.get().measures.filter((m) => m.type === 'pflanzung').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (pflanzung === null && pflanzungen.length) {
    pflanzung = pflanzungen.find((m) => m.parcelId === parcelId && m.status !== 'fertig') || null;
  }
  const ohne = !pflanzung;
  pflanzung ||= { id: null, parcelId: parcelId || store.get().parcels[0]?.id || null, pflanzplan: { arten: [] } };
  if (!pflanzung.pflanzplan?.arten?.length && !ohne) pflanzung = { ...pflanzung, pflanzplan: { ...(pflanzung.pflanzplan || {}), arten: artenAusPflanzung(pflanzung) } };
  const pp = pflanzung.pflanzplan || {};
  const lay = (() => { try { return gespeichertesLayout(pflanzung); } catch { return null; } })();
  const punkte = lay?.punkte || [];
  const namen = [...new Set((pp.arten || []).map((a) => a.name))];
  const nadelArt = (n) => NADEL.test(n);
  // Auswahl: Menge der Punktindizes; ohne Karte Stückzahl je Baumart
  const sel = new Set();
  const listeStueck = Object.fromEntries((pp.arten || []).map((a) => [a.name, SELTEN_GESCHUETZT.includes(a.name) ? 0 : a.stueck]));
  const s = { modus: 'alle', pinsel: 'an', antworten: antworten || { ziel: 'reh', erdoel: foerdern ? 'nein' : 'egal', foerderung: foerdern, wichtig: 'preis', licht: pflanzung?.pflanzplan?.art === 'voranbau' ? 'schatten' : 'hell' }, produkt: null, eigen: {}, date: pflanzung.date ? new Date(pflanzung.date).toISOString().slice(0, 10) : '', note: '', parcelId: pflanzung.parcelId };
  // ohne Pflanzung: Baumarten und Stückzahlen selbst eingeben
  const eigeneArten = ohne ? [{ name: '', stueck: 0 }] : null;
  const alleWaehlen = () => { sel.clear(); punkte.forEach((q, i) => { if (!SELTEN_GESCHUETZT.includes(q[2]) || namen.every((n) => SELTEN_GESCHUETZT.includes(n))) sel.add(i); }); };
  alleWaehlen();
  let gespeichert = false, wechsel = false, karte = null, marker = [];
  const body = h('div', { class: 'einzelschutz' });
  const page = openPage('Einzelschutz planen', body, { onClose: () => { karte?.remove(); if (!gespeichert && !wechsel) onAbbruch?.(); } });
  /** andere Pflanzung wählen: Seite mit dieser Pflanzung neu aufbauen (Antworten bleiben) */
  const wechsleZu = (m) => { wechsel = true; page.close(); openEinzelschutzPlanung({ pflanzung: m || false, parcelId: s.parcelId, foerdern, onSaved, onAbbruch, antworten: s.antworten }); };

  const zaehlung = () => {
    const je = Object.fromEntries(namen.map((n) => [n, 0]));
    if (eigeneArten) { for (const k of Object.keys(je)) delete je[k]; for (const a of eigeneArten) if (a.name.trim() && a.stueck > 0) je[a.name.trim()] = (je[a.name.trim()] || 0) + a.stueck; }
    else if (punkte.length) for (const i of sel) je[punkte[i][2]] = (je[punkte[i][2]] || 0) + 1;
    else Object.assign(je, listeStueck);
    const n = Object.values(je).reduce((a, b) => a + b, 0);
    const nadel = Object.entries(je).reduce((a, [k, v]) => a + (nadelArt(k) ? v : 0), 0);
    return { je, n, nadelAnteil: n ? nadel / n : 0 };
  };

  // ---------- Karte mit den Pflanzen ----------
  const mapEl = h('div', { class: 'mini-map es-map' });
  const kartenStatus = h('p', { class: 'draw-status', 'aria-live': 'polite' });
  const lyr = L.layerGroup();
  const canvas = L.canvas({ padding: 0.3 });
  function karteAufbauen() {
    if (!punkte.length) return;
    const ringe = flaechenRinge(pflanzung.flaeche);
    karte = miniKarte(mapEl, ringe.length ? { ring: ringe[0], polys: ringe.map((r) => [r]) } : null, { zoom: 18 });
    lyr.addTo(karte.map);
    if (ringe.length) ringe.forEach((r) => L.polygon(r, { color: '#F26B1D', weight: 2, fillOpacity: 0.05, interactive: false }).addTo(lyr));
    const z = karte.map.getZoom();
    marker = punkte.map(([x, y]) => L.circleMarker(lay.R.toLL([x, y]), { renderer: canvas, radius: z >= 19 ? 4 : 3, stroke: true, weight: 1, color: '#fff', fillOpacity: 1, interactive: false }).addTo(lyr));
    farben();
    // Einzelne Pflanzen antippen oder mit dem Finger übermalen
    let malt = false;
    const treffer = (e) => {
      const ll = karte.map.mouseEventToLatLng(e.touches?.[0] || e);
      const [x, y] = lay.R.toXY([ll.lat, ll.lng]);
      const r = Math.max(1.2, 12 / Math.pow(2, karte.map.getZoom() - 16)); // m, vom Zoom abhängig
      let geaendert = false;
      punkte.forEach((q, i) => { if (Math.hypot(q[0] - x, q[1] - y) <= r) { if (s.pinsel === 'an' && !sel.has(i)) { sel.add(i); geaendert = true; } else if (s.pinsel === 'aus' && sel.has(i)) { sel.delete(i); geaendert = true; } } });
      if (geaendert) { farben(); renderUnten(); }
    };
    const el = karte.map.getContainer();
    const start = (e) => { if (s.modus !== 'einzeln' || s.pinsel === 'karte') return; malt = true; karte.map.dragging.disable(); treffer(e); e.preventDefault?.(); };
    const weiter = (e) => { if (malt) { treffer(e); e.preventDefault?.(); } };
    const ende = () => { if (malt) { malt = false; karte.map.dragging.enable(); } };
    el.addEventListener('pointerdown', start); el.addEventListener('pointermove', weiter); window.addEventListener('pointerup', ende);
    karte.map.on('zoomend', () => marker.forEach((m) => m.setRadius(karte.map.getZoom() >= 19 ? 4 : 3)));
    setTimeout(() => { const b = L.latLngBounds(marker.map((m) => m.getLatLng())); if (b.isValid()) karte.map.fitBounds(b, { padding: [16, 16], maxZoom: 19 }); }, 120);
  }
  function farben() {
    marker.forEach((m, i) => m.setStyle(sel.has(i) ? { fillColor: '#F26B1D', color: '#fff' } : { fillColor: '#9AA59A', color: '#fff' }));
    const z = zaehlung();
    kartenStatus.textContent = `${z.n.toLocaleString('de-DE')} von ${punkte.length.toLocaleString('de-DE')} Pflanzen ausgewählt (orange)`;
  }

  const oben = h('div', {});
  const unten = h('div', {});
  function renderOben() {
    const z = zaehlung();
    const artenNamen = [...new Set(PFLANZ_WBS.map((a) => a.art))].sort((a, b) => a.localeCompare(b, 'de'));
    fill(oben,
      foerdern ? h('div', { class: 'lrt-hinweis ok' }, h('strong', {}, 'Mit Förderantrag'), h('p', {}, 'Gefördert wird kunststofffreier Einzelschutz ab 1,20 m.')) : null,
      h('h2', { class: 'step-title' }, 'Welche Pflanzung soll geschützt werden?'),
      h('label', {}, 'Pflanzung', h('select', { onchange: (e) => wechsleZu(e.target.value ? pflanzungen.find((m) => m.id === e.target.value) : false) },
        h('option', { value: '', selected: ohne }, 'Keine Pflanzung – Stückzahl selbst eingeben'),
        pflanzungen.map((m) => h('option', { value: m.id, selected: m.id === pflanzung.id }, pflanzungsName(m))))),
      !pflanzungen.length ? h('small', { class: 'muted' }, 'Noch keine Pflanzung angelegt – du kannst die Stückzahl selbst eingeben.') : null,
      ohne ? h('div', {},
        h('label', {}, 'Fläche', h('select', { onchange: (e) => { s.parcelId = e.target.value || null; } },
          h('option', { value: '' }, 'ohne Flächenzuordnung'), store.get().parcels.map((p) => h('option', { value: p.id, selected: p.id === s.parcelId }, `Flurstück ${p.nr}, ${p.gemarkung}`)))),
        h('datalist', { id: 'es-arten' }, artenNamen.map((n) => h('option', { value: n }))),
        h('p', { class: 'sheet-label' }, 'Baumarten und Anzahl der zu schützenden Pflanzen'),
        h('ul', { class: 'pflanz-liste' }, eigeneArten.map((a, i) => h('li', { class: 'es-eigen' },
          h('input', { type: 'text', list: 'es-arten', placeholder: 'Baumart, z. B. Rotbuche', value: a.name, onchange: (e) => { a.name = e.target.value; renderOben(); renderUnten(); } }),
          h('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', placeholder: 'Stück', value: a.stueck || '', onchange: (e) => { a.stueck = Math.max(0, Math.round(Number(e.target.value) || 0)); renderOben(); renderUnten(); } }),
          eigeneArten.length > 1 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zeile entfernen', onclick: () => { eigeneArten.splice(i, 1); renderOben(); renderUnten(); } }, '✕') : null))),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { eigeneArten.push({ name: '', stueck: 0 }); renderOben(); } }, '+ Weitere Baumart')) : null,
      ohne ? null : h('h2', { class: 'step-title' }, 'Welche Pflanzen sollen geschützt werden?'),
      ohne ? null : h('p', { class: 'muted' }, `Aus der Pflanzung übernommen: ${(pp.arten || []).reduce((x, a) => x + (a.stueck || 0), 0).toLocaleString('de-DE')} Pflanzen${pflanzung.flaeche?.ha ? ` auf ${formatHa(pflanzung.flaeche.ha)}` : ''}.`),
      ohne ? null : h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Auswahl der Pflanzen' },
        [['alle', 'Alle Pflanzen'], ['einzeln', 'Einzelne auswählen']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.modus === k),
          onclick: () => { s.modus = k; if (k === 'alle') { alleWaehlen(); farben(); } renderOben(); renderUnten(); } }, l))),
      punkte.length || ohne ? null : h('p', { class: 'hint' }, 'Für diese Pflanzung gibt es keine Pflanzkarte – wähle die Stückzahl je Baumart.'),
      s.modus === 'einzeln' && punkte.length ? h('div', {},
        h('div', { class: 'segmented compact', role: 'radiogroup', 'aria-label': 'Werkzeug' },
          [['an', 'Auswählen'], ['aus', 'Abwählen'], ['karte', 'Karte verschieben']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.pinsel === k), onclick: () => { s.pinsel = k; renderOben(); } }, l))),
        h('p', { class: 'hint' }, 'Pflanzen antippen oder mit dem Finger übermalen. Ganze Baumarten:'),
        h('div', { class: 'q-chips' }, namen.map((n) => {
          const idx = punkte.map((q, i) => (q[2] === n ? i : -1)).filter((i) => i >= 0), an = idx.length && idx.every((i) => sel.has(i));
          return h('button', { type: 'button', class: `q-option ${an ? 'on' : ''}`, onclick: () => { idx.forEach((i) => (an ? sel.delete(i) : sel.add(i))); farben(); renderOben(); renderUnten(); } }, `${an ? '✓ ' : ''}${n} (${idx.length})`);
        })),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { punkte.forEach((_, i) => sel.add(i)); farben(); renderOben(); renderUnten(); } }, 'Alle wählen'),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { sel.clear(); farben(); renderOben(); renderUnten(); } }, 'Keine'))) : null,
      !punkte.length && !ohne ? h('ul', { class: 'pflanz-liste' }, (pp.arten || []).map((a) => h('li', {},
        h('label', {}, h('strong', {}, a.name), h('span', { class: 'muted' }, ` · ${a.stueck.toLocaleString('de-DE')} gepflanzt`),
          h('input', { type: 'number', min: 0, max: a.stueck, value: listeStueck[a.name], onchange: (e) => { listeStueck[a.name] = Math.max(0, Math.min(a.stueck, Math.round(Number(e.target.value) || 0))); renderUnten(); } }))))) : null,
      h('div', { class: 'es-arten' }, Object.entries(z.je).filter(([, v]) => v).map(([k, v]) => h('span', {}, h('strong', {}, v.toLocaleString('de-DE')), ` ${k}`))));
  }

  // ---------- Fragen, Empfehlung, Stückliste ----------
  const frage = (titel, key, optionen) => h('div', { class: 'q-group' },
    h('p', { class: 'sheet-label' }, titel),
    h('div', { class: 'q-cards' }, optionen.map(([v, t, u]) => h('button', { type: 'button', class: `q-option ${s.antworten[key] === v ? 'on' : ''}`, 'aria-pressed': String(s.antworten[key] === v),
      onclick: () => {
        s.antworten[key] = v; s.produkt = null;
        // Förderung gibt es nur für kunststofffreien Einzelschutz – die Antworten passen sich gegenseitig an
        if (key === 'foerderung' && v === true) s.antworten.erdoel = 'nein';
        if (key === 'erdoel' && v === 'egal' && s.antworten.foerderung) { s.antworten.foerderung = false; toast('Kunststoff wird nicht gefördert – „Förderung“ ist jetzt auf Nein gestellt.'); }
        renderUnten();
      } }, h('span', { class: 'q-text' }, h('strong', {}, t), u ? h('small', {}, u) : null)))));
  const produktKarte = (p, { gewaehlt = false, onWahl = null, n = 0 } = {}) => {
    const sl = stueckliste(p, n || 1, s.eigen);
    return h('div', { class: `es-produkt ${gewaehlt ? 'on' : ''}` },
      h('button', { type: 'button', class: 'es-i', 'aria-label': `Infos zu ${p.name}: Erfahrungen, Aufbau, Prüfung`, onclick: () => zeigeInfo(p) }, 'i'),
      h('div', { class: 'es-bild', html: BILD[p.bild] }),
      h('div', { class: 'es-text' },
        h('strong', {}, p.name),
        h('small', {}, `${p.einheitText || `${euro(brutto(p.netto))} je ${p.je || 'Stück'}`}${p.stab ? ` + Stab ${euro(brutto(STAEBE[p.stab].netto))}` : ''} · brutto${p.nr ? ` · WBS-Nr. ${p.nr}` : ''}`),
        h('small', { class: 'muted' }, p.text),
        h('div', { class: 'es-tags' },
          p.hoehe ? h('span', {}, `${(p.hoehe / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} m`) : null,
          h('span', { class: erdoelfrei(p) ? 'gruen' : '' }, erdoelfrei(p) ? 'nicht erdölbasiert' : 'Kunststoff (erdölbasiert)'),
          foerderfaehig(p) ? h('span', { class: 'gruen' }, 'förderfähig') : null,
          p.nadel ? h('span', {}, 'auch Nadelholz') : null),
        n ? h('small', {}, h('strong', {}, `${euro(sl.jePflanze)} je Pflanze`)) : null,
        onWahl ? h('button', { type: 'button', class: `btn btn-small ${gewaehlt ? 'btn-primary' : ''}`, onclick: onWahl }, gewaehlt ? 'Gewählt' : 'Diese nehmen') : null));
  };
  function alleZeigen(n) {
    dialog({ title: 'Alle Hüllen und Schutzmittel', actions: [{ label: 'Schließen', value: null }], body: (close) => h('div', { class: 'es-alle' },
      h('p', { class: 'muted' }, `Preise Waldbesitzer Service GmbH, Materialsortiment Herbst 2026, brutto inkl. 19 % MwSt.`),
      PRODUKTE.map((p) => produktKarte(p, { n, gewaehlt: s.produkt === p.id, onWahl: () => { s.produkt = p.id; close(null); renderUnten(); } })),
      h('a', { href: WBS_URL, target: '_blank', rel: 'noopener' }, 'Materialsortiment der WBS öffnen')) });
  }
  function renderUnten() {
    const z = zaehlung();
    const emp = empfehle({ ...s.antworten, nadelAnteil: z.nadelAnteil });
    const p = PRODUKTE.find((x) => x.id === s.produkt) || emp?.produkt || PRODUKTE[0];
    const sl = stueckliste(p, z.n, s.eigen);
    const f = foerderfaehig(p) ? esFoerderung(p.hoehe) : null;
    const foerderGrund = !(p.typ === 'huelle' || p.typ === 'gitter') ? `${p.kat} wird nicht als Einzelschutz gefördert – gefördert werden Wuchshüllen und Drahthosen.`
      : !kunststofffrei(p) ? (p.material === 'bio' ? 'Biobasierte Hüllen sind nur förderfähig, wenn sie laut Hersteller kunststofffrei sind – bitte im Datenblatt prüfen.' : 'Kunststoff wird nicht gefördert – nur kunststofffreier Einzelschutz (z. B. Holz).')
        : p.hoehe < 120 ? 'Gefördert wird Einzelschutz erst ab 1,20 m Höhe.' : null;
    fill(unten,
      h('h2', { class: 'step-title' }, 'Was soll der Schutz können?'),
      frage('Wovor schützen?', 'ziel', [['reh', 'Verbiss und Fegen durch Rehwild', 'üblich – 1,20 m'], ['hoch', 'Hoher Wilddruck, Schnee, Damwild', '1,50 m'], ['rot', 'Rotwild', '1,80 m'], ['fegen', 'Nur gegen Fegen', 'z. B. Stachelbäume'], ['leittrieb', 'Nur den Leittrieb (Nadelholz)', 'Klemmen oder Streichmittel']]),
      frage('Material', 'erdoel', [['nein', 'Nicht erdölbasiert', 'Holz, biobasiert, Schafwolle'], ['egal', 'Kunststoff ist in Ordnung', 'meist günstiger']]),
      frage('Wie hell ist der Pflanzplatz?', 'licht', [['hell', 'Freifläche, sonnig'], ['schatten', 'Unter Schirm / Halbschatten', 'z. B. Voranbau']]),
      frage('Förderung beantragen?', 'foerderung', [[true, 'Ja', 'nur kunststofffrei ab 1,20 m'], [false, 'Nein']]),
      frage('Was ist dir wichtiger?', 'wichtig', [['preis', 'Möglichst günstig'], ['haltbar', 'Langlebig und bewährt']]),
      h('h2', { class: 'step-title' }, s.produkt && s.produkt !== emp?.produkt.id ? 'Deine Wahl' : 'Vorschlag'),
      emp && !s.produkt ? h('p', { class: 'ok-line' }, `Passt am besten: ${emp.gruende.join(', ')}.`) : null,
      emp?.warnung ? h('p', { class: 'warn-line' }, emp.warnung) : null,
      !emp ? h('p', { class: 'warn-line' }, 'Mit diesen Antworten passt keine Hülle aus dem Sortiment – schau dir alle an.') : null,
      produktKarte(p, { n: z.n, gewaehlt: true }),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => alleZeigen(z.n) }, 'Alle Hüllen ansehen'),
        s.produkt ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.produkt = null; renderUnten(); } }, 'Zurück zum Vorschlag') : null),
      h('h2', { class: 'step-title' }, 'Material und Kosten'),
      h('p', { class: 'muted' }, `${z.n.toLocaleString('de-DE')} Pflanzen geschützt. Richtpreise WBS, brutto. Preise lassen sich überschreiben.`),
      h('ul', { class: 'material-liste' }, sl.zeilen.map((zl) => h('li', {},
        h('div', { class: 'mat-kopf' }, h('strong', {}, zl.name), h('span', { class: 'mat-menge' }, `${zl.menge.toLocaleString('de-DE')} ${zl.einheit}`)),
        zl.info ? h('small', { class: 'muted' }, zl.info) : null,
        h('div', { class: 'mat-preis' },
          h('label', {}, 'Einzelpreis', h('span', { class: 'mit-einheit' },
            h('input', { type: 'text', inputmode: 'decimal', value: String(zl.preis.toFixed(zl.preis < 1 ? 3 : 2)).replace('.', ','), onchange: (e) => { const v = zahl(e.target.value); if (v == null) delete s.eigen[zl.id]; else s.eigen[zl.id] = v; renderUnten(); } }), h('span', {}, '€'))),
          h('strong', { class: 'mat-summe' }, euro(zl.preis * zl.menge))),
        h('small', { class: 'mat-quelle' }, s.eigen[zl.id] != null ? 'eigener Preis' : h('a', { href: WBS_URL, target: '_blank', rel: 'noopener' }, `WBS${zl.nr ? `-Nr. ${zl.nr}` : ''}, Herbst 2026`))))),
      h('div', { class: 'zaun-summe' }, h('span', {}, 'Materialkosten gesamt'), h('strong', {}, euro(sl.summe))),
      f ? h('div', { class: 'lrt-hinweis ok' }, h('strong', {}, `Förderfähig (${f.stufe})`),
        h('p', {}, `Richtlinie (Teil A): ${euro(f.GANW)} je Stück, zusammen ${euro(f.GANW * z.n)} · Landesprogramm: ${euro(f.LABE)} je Stück, zusammen ${euro(f.LABE * z.n)}.`))
        : h('div', { class: 'lrt-hinweis brutzeit' }, h('strong', {}, 'Nicht förderfähig'), h('p', {}, foerderGrund)),
      h('h2', { class: 'step-title' }, 'Termin und Notiz'),
      h('label', {}, 'Geplanter Termin', h('input', { type: 'date', value: s.date, onchange: (e) => { s.date = e.target.value; } })),
      h('label', {}, 'Notiz', h('textarea', { rows: 2, oninput: (e) => { s.note = e.target.value; } }, s.note)),
      h('div', { class: 'q-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => page.close() }, 'Abbrechen'),
        h('button', { type: 'button', class: 'btn btn-primary btn-large', disabled: !z.n, onclick: () => speichern(p, sl, z) }, 'Einzelschutz buchen')));
  }

  function speichern(p, sl, z) {
    const id = uid();
    const hoeheText = p.hoehe ? `${(p.hoehe / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} m` : '';
    const arten = Object.entries(z.je).filter(([, v]) => v > 0).map(([name, stueck]) => ({ name, stueck }));
    store.update((st) => st.measures.push({
      id, type: 'einzelschutz', parcelId: ohne ? s.parcelId : pflanzung.parcelId, date: s.date ? new Date(s.date).getTime() : null, status: 'geplant', createdAt: Date.now(), note: s.note.trim(),
      details: { art: p.kat, produkt: p.name, species: arten.map((a) => a.name).join(', '), count: String(z.n), hoehe: hoeheText, stab: p.stab ? STAEBE[p.stab].name : 'ohne Stab', preis: String(Math.round(sl.jePflanze * 100) / 100).replace('.', ','), material: kunststofffrei(p) ? 'kunststofffrei' : p.material === 'kunststoff' ? 'kunststoff' : p.material },
      flaeche: pflanzung.flaeche ? JSON.parse(JSON.stringify(pflanzung.flaeche)) : undefined,
      schutz: { pflanzungId: pflanzung.id || null, produkt: p.id, material: kunststofffrei(p) ? 'kunststofffrei' : p.material, hoeheCm: p.hoehe, arten,
        auswahl: punkte.length && s.modus === 'einzeln' ? [...sel].map((i) => punkte[i][4]) : null,
        material_liste: sl.zeilen.map((zl) => ({ name: zl.name, menge: zl.menge, einheit: zl.einheit, preis: zl.preis })) },
      kosten: Math.round(sl.summe * 100) / 100,
    }));
    gespeichert = true;
    toast(`Einzelschutz gebucht: ${z.n.toLocaleString('de-DE')} Pflanzen, ${euro(sl.summe)}`);
    page.close();
    onSaved?.(id);
  }

  fill(body, oben, punkte.length ? h('div', {}, mapEl, kartenStatus) : null, unten);
  renderOben();
  karteAufbauen();
  renderUnten();
  return page;
}
