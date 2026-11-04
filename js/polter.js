// Interaktive Poltervermessung nach der Rahmenvereinbarung für den Rohholzhandel in Deutschland (RVR, 3. Aufl. 2020;
// Merkblatt Sektionsraummaßermittlung, FNR 2023). Schritt für Schritt mit Skizze, welche Werte gemessen werden.
import { h, fill, openPage, toast } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { SPECIES } from './thinning/plan.js';

// ---------- Regeln der RVR ----------
export const SORTIMENTE = [
  { key: 'stamm_lang', label: 'Stammholz lang (Langholz)', text: 'Ganze Stämme, meist über 6 m', verfahren: 'einzelstamm' },
  { key: 'stamm_abschnitt', label: 'Stammholz-Abschnitte', text: 'Abschnitte in festen Längen, z. B. 4 oder 5 m', verfahren: 'einzelstamm' },
  { key: 'ih_kurz', label: 'Industrieholz kurz', text: 'Einheitslängen 1–3 m', verfahren: 'sektion' },
  { key: 'ih_lang', label: 'Industrieholz lang', text: 'In Langform', verfahren: 'einzelstamm' },
  { key: 'eh_kurz', label: 'Energieholz kurz', text: 'Einheitslängen 1–3 m', verfahren: 'sektion' },
  { key: 'brennholz', label: 'Brennholz (Schichtholz 1 oder 2 m)', text: 'Gesetztes Schichtholz', verfahren: 'schicht' },
  { key: 'eh_lang', label: 'Energieholz lang', text: 'In Langform', verfahren: 'einzelstamm' },
];
export const VERFAHREN = {
  einzelstamm: { label: 'Manuelle Einzelstamm-Vermessung', einheit: 'Fm o.R.', anlage: 'RVR Anlage VI-b', text: 'Jeder Stamm wird einzeln gemessen: Länge und Mittendurchmesser. Volumen nach der Huberschen Formel.' },
  sektion: { label: 'Sektionsraummaß', einheit: 'Rm m.R.', anlage: 'RVR Anlage VI-d', text: 'Das Polter wird in gleich lange Sektionen eingeteilt. In jeder Sektionsmitte wird die Höhe gemessen.' },
  schicht: { label: 'Konventionelles Schichtraummaß', einheit: 'Rm m.R.', anlage: 'RVR Anlage VI-e', text: 'Für Schichtholz in 1 m oder 2 m: mittlere Höhe × Länge × Tiefe × 0,96.' },
};
// Sektionslänge LS in Abhängigkeit von der Poltergesamtlänge LAB (Merkblatt Sektionsraummaß)
export const sektionsLaenge = (lab) => (lab <= 10 ? 1 : lab <= 20 ? 2 : lab <= 40 ? 4 : lab <= 60 ? 6 : lab <= 80 ? 8 : 10);
// Reduktionsfaktoren (Raumübermaß 4 % plus bis zu 5,5 % je nach Holzart und Länge)
const FI_GRUPPE = /fichte|tanne|douglasie/i, KI_GRUPPE = /kiefer|lärche|buche/i;
export function reduktion(baumart, laenge) {
  const lang = laenge >= 2.5 ? 3 : laenge >= 1.5 ? 2 : 1;
  if (lang === 1) return { von: 0.96, bis: 0.96, text: 'Raumübermaß 4 % (für 1 m nennt die RVR keine weiteren Abzüge)' };
  if (FI_GRUPPE.test(baumart)) return lang === 2 ? { von: 0.96, bis: 0.94, text: 'Fichte/Douglasie, 2 m: 0,96 bis 0,94' } : { von: 0.94, bis: 0.92, text: 'Fichte/Douglasie, 3 m: 0,94 bis 0,92' };
  if (KI_GRUPPE.test(baumart)) return lang === 2 ? { von: 0.94, bis: 0.925, text: 'Kiefer/Lärche/Buche, 2 m: 0,94 bis 0,925' } : { von: 0.92, bis: 0.905, text: 'Kiefer/Lärche/Buche, 3 m: 0,92 bis 0,905' };
  return { von: 0.96, bis: 0.96, text: 'Raumübermaß 4 % (für diese Holzart nennt die RVR keine weiteren Abzüge)' };
}
// Empfohlene Umrechnungsfaktoren Raummaß → Festmaß (RVR 4.2.1, Tabelle 5), nach Stücklänge
export function umrechnung(laenge, entrindet) {
  const lang = laenge >= 2.5 ? 3 : laenge >= 1.5 ? 2 : 1;
  const f = entrindet ? { 1: 0.80, 2: 0.75, 3: 0.70 }[lang] : { 1: 0.70, 2: 0.65, 3: 0.60 }[lang];
  return { faktor: f, text: `1 Rm ${entrindet ? 'o.R.' : 'm.R.'} bei ${lang} m Stücklänge = ${zahlText(f)} Fm o.R.` };
}

const zahl = (v) => { const s = String(v ?? '').trim().replace(',', '.'); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
export const zahlText = (v, d = 2) => (v == null ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const r2 = (v) => Math.round(v * 100) / 100;
const ab2 = (v) => Math.floor(v * 100 + 1e-9) / 100;

// ---------- Berechnungen ----------
export function sektionRechnung(s) {
  const lab = s.lab, ls = sektionsLaenge(lab), n = Math.floor(lab / ls + 1e-9), lb = r2(lab - n * ls);
  const hoehe = (i) => { const v = s.hv[i], r = s.rueck ? s.hr[i] : null; return v != null && r != null ? (v + r) / 2 : v ?? r ?? 0; };
  const hA = Array.from({ length: n }, (_, i) => hoehe(i) / 100);
  const hB = lb > 0 ? hoehe(n) / 100 : 0;
  const A = ls * hA.reduce((a, b) => a + b, 0) * s.t, B = lb * hB * s.t, C = s.c || 0;
  const brutto = r2(A + B + C), netto = r2(brutto * s.red);
  return { ls, n, lb, A: r2(A), B: r2(B), C, brutto, netto, fm: r2(netto * s.u) };
}
export function schichtRechnung(s) {
  const hs = s.hs.filter((x) => x > 0);
  const H = ab2(hs.reduce((a, b) => a + b, 0) / hs.length / 100), L = ab2(s.l);
  const netto = r2(H * L * s.t * 0.96);
  return { H, L, netto, fm: r2(netto * s.u) };
}
export const stammMitte = (st) => {
  const d1 = Math.floor(st.d1), d2 = st.d2 != null ? Math.floor(st.d2) : null;
  let d = d1 >= 20 && d2 != null ? Math.floor((d1 + d2) / 2) : d1;
  if (st.rinde === 'mR') d = Math.max(0, d - Math.floor(st.rabzug || 0));
  return d;
};
export const stammVolumen = (st) => r2((Math.PI / 4) * stammMitte(st) ** 2 * st.l * 1e-4);

// ---------- Skizzen ----------
const ORANGE = '#F26B1D', GRAU = '#6B7280';
function pfeil(x1, y1, x2, y2, farbe, w = 2) {
  const m = farbe === ORANGE ? 'po' : 'pg';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${farbe}" stroke-width="${w}" marker-start="url(#${m})" marker-end="url(#${m})"/>`;
}
const DEFS = `<defs>
  <marker id="po" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#F26B1D"/></marker>
  <marker id="pg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6B7280"/></marker>
  <pattern id="stirn" width="13" height="12" patternUnits="userSpaceOnUse"><rect width="13" height="12" fill="#C99A5B"/><circle cx="6.5" cy="6" r="5.4" fill="#E8C78E" stroke="#9C6B32" stroke-width="1"/><circle cx="6.5" cy="6" r="1.4" fill="#B8864A"/></pattern>
</defs>`;
const OBEN = [[20, 92], [55, 82], [95, 90], [135, 78], [175, 86], [215, 80], [255, 88], [290, 96], [312, 108]];
const obenBei = (x) => { for (let i = 1; i < OBEN.length; i++) if (x <= OBEN[i][0]) { const [x0, y0] = OBEN[i - 1], [x1, y1] = OBEN[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return OBEN.at(-1)[1]; };

/** Polter von der Stirnseite: Sektionen, Sektionsmitten mit Höhen, Länge, Tiefe, Unterlagen. mark: lab | tiefe | h0… | hb | c | alle */
export function polterSkizze({ mark = 'alle', sektionen = 5, schicht = false } = {}) {
  const x0 = 20, xE = 312, basis = 160;
  const breite = schicht ? (xE - x0) : 52, nA = schicht ? 0 : sektionen;
  const xB = x0 + nA * breite;
  const f = (k) => (mark === 'alle' || mark === k ? ORANGE : GRAU);
  const w = (k) => (mark === k ? 3 : 1.6);
  let s = `<svg viewBox="0 0 340 212" class="polter-skizze" role="img" aria-label="Skizze eines Holzpolters mit den Messgrößen">${DEFS}`;
  // Tiefe (perspektivisch)
  s += `<polygon points="${OBEN.map(([x, y]) => `${x + 16},${y - 12}`).join(' ')} ${xE + 16},${basis - 12} ${xE},${basis}" fill="#B98A50" opacity=".55"/>`;
  s += `<polygon points="${x0},${basis} ${OBEN.map(([x, y]) => `${x},${y}`).join(' ')} ${xE},${basis}" fill="url(#stirn)" stroke="#7A5226" stroke-width="1.2"/>`;
  // Unterlagen
  s += `<rect x="${x0 + 6}" y="${basis}" width="${xE - x0 - 12}" height="6" fill="${mark === 'c' ? ORANGE : '#8B6A43'}"/>`;
  s += `<line x1="8" y1="${basis + 6}" x2="332" y2="${basis + 6}" stroke="#4B5B3A" stroke-width="2"/>`;
  if (!schicht) {
    for (let i = 0; i <= nA; i++) { const x = x0 + i * breite; s += `<line x1="${x}" y1="${basis}" x2="${x}" y2="52" stroke="#344" stroke-width="1" stroke-dasharray="4 3" opacity=".7"/>`; }
    for (let i = 0; i < nA; i++) {
      const xm = x0 + (i + 0.5) * breite, k = `h${i}`;
      s += pfeil(xm, basis - 2, xm, obenBei(xm) + 2, f(k), w(k));
      s += `<circle cx="${xm}" cy="${basis - 1}" r="3" fill="${f(k)}"/>`;
      s += `<text x="${xm}" y="${obenBei(xm) - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="${f(k)}">H${i + 1}</text>`;
    }
    const xmB = (xB + xE) / 2;
    s += pfeil(xmB, basis - 2, xmB, obenBei(xmB) + 2, f('hb'), w('hb'));
    s += `<text x="${xmB}" y="${obenBei(xmB) - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="${f('hb')}">HB</text>`;
    s += `<text x="${x0 + breite / 2}" y="46" text-anchor="middle" font-size="10" fill="#344">LS</text>`;
    s += `<text x="${(x0 + xB) / 2}" y="34" text-anchor="middle" font-size="10" fill="#344">Polterteil A (volle Sektionen)</text>`;
    s += `<text x="${xmB}" y="46" text-anchor="middle" font-size="10" fill="#344">LB</text>`;
  } else {
    [0.15, 0.38, 0.62, 0.85].forEach((p, i) => { const x = x0 + p * (xE - x0), k = `h${i}`; s += pfeil(x, basis - 2, x, obenBei(x) + 2, f('h'), w('h')); s += `<text x="${x}" y="${obenBei(x) - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="${f('h')}">H</text>`; });
  }
  s += pfeil(x0, basis + 22, xE, basis + 22, f('lab'), w('lab'));
  s += `<text x="${(x0 + xE) / 2}" y="${basis + 38}" text-anchor="middle" font-size="12" font-weight="700" fill="${f('lab')}">${schicht ? 'L = Polterlänge an der Basis' : 'LAB = Poltergesamtlänge an der Basis'}</text>`;
  s += pfeil(xE + 2, basis + 2, xE + 18, basis - 10, f('tiefe'), w('tiefe'));
  s += `<text x="${xE + 6}" y="${basis - 18}" text-anchor="end" font-size="11" font-weight="700" fill="${f('tiefe')}">T</text>`;
  s += `<text x="${x0 + 10}" y="${basis + 15}" font-size="10" fill="${f('c')}">${mark === 'c' ? 'C = Unterlagen' : ''}</text>`;
  return s + '</svg>';
}
/** Stamm von der Seite und Querschnitt in der Mitte. mark: l | d | alle */
export function stammSkizze(mark = 'alle') {
  const f = (k) => (mark === 'alle' || mark === k ? ORANGE : GRAU);
  return `<svg viewBox="0 0 340 170" class="polter-skizze" role="img" aria-label="Skizze eines Stammes mit Länge und Mittendurchmesser">${DEFS}
    <path d="M20 70 L250 78 L250 112 L20 124 Z" fill="#C99A5B" stroke="#7A5226"/>
    <ellipse cx="20" cy="97" rx="7" ry="27" fill="#E8C78E" stroke="#7A5226"/>
    <ellipse cx="250" cy="95" rx="5" ry="17" fill="#E8C78E" stroke="#7A5226"/>
    <line x1="135" y1="66" x2="135" y2="128" stroke="${f('d')}" stroke-width="2" stroke-dasharray="4 3"/>
    <text x="135" y="60" text-anchor="middle" font-size="11" font-weight="700" fill="${f('d')}">Mitte (L/2)</text>
    ${pfeil(20, 146, 250, 146, f('l'), mark === 'l' ? 3 : 1.6)}
    <text x="135" y="164" text-anchor="middle" font-size="12" font-weight="700" fill="${f('l')}">L = Länge (Bestelllänge, ohne Übermaß)</text>
    <circle cx="298" cy="92" r="30" fill="#E8C78E" stroke="#7A5226" stroke-width="1.5"/>
    ${pfeil(268, 92, 328, 92, f('d'), mark === 'd' ? 3 : 1.6)}${pfeil(298, 62, 298, 122, f('d'), mark === 'd' ? 3 : 1.6)}
    <text x="298" y="140" text-anchor="middle" font-size="11" font-weight="700" fill="${f('d')}">d1 ⟂ d2</text>
  </svg>`;
}

// Höhen intern immer in cm; Eingabe wahlweise in cm oder m (Einstellung bleibt gespeichert)
const EINHEIT_KEY = 'waldwaechter.polterEinheit';
const leseEinheit = () => { try { return localStorage.getItem(EINHEIT_KEY) === 'm' ? 'm' : 'cm'; } catch { return 'cm'; } };
const merkeEinheit = (e) => { try { localStorage.setItem(EINHEIT_KEY, e); } catch { /* egal */ } };
const hoeheText = (cm, e) => (e === 'm' ? `${zahlText(cm / 100)} m` : `${zahlText(cm, 0)} cm`);

// ---------- Assistent ----------
export async function openPolterVermessung({ parcelId = null, onSaved } = {}) {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id]);
  const s = { i: 0, parcelId, polterNr: '', species: 'Fichte', sortiment: null, verfahren: null, pos: null,
    lab: null, t: null, hv: [], hr: [], rueck: true, c: 0, cLos: false, red: null, u: null, entrindet: false,
    l: null, hs: [], staemme: [], einheit: leseEinheit(), neu: { l: null, d1: null, d2: null, rinde: 'oR', rabzug: null } };
  const body = h('div', { class: 'polter' });
  const page = openPage('Poltervermessung', body);

  const schritte = () => {
    const base = ['start', 'sortiment'];
    if (s.verfahren === 'sektion') {
      const n = s.lab ? Math.floor(s.lab / sektionsLaenge(s.lab) + 1e-9) : 0;
      const lb = s.lab ? r2(s.lab - n * sektionsLaenge(s.lab)) : 0;
      const seite = (k) => [...Array.from({ length: n }, (_, i) => `${k}:${i}`), ...(lb > 0 ? [`${k}:${n}`] : [])];
      return [...base, 'skizze', 'lab', 'tiefe', ...seite('v'), 'rueckfrage', ...(s.rueck ? seite('r') : []), 'unterlage', 'reduktion', 'faktor', 'ergebnis'];
    }
    if (s.verfahren === 'schicht') return [...base, 'skizze', 'lab', 'tiefe', 'hoehen', 'faktor', 'ergebnis'];
    if (s.verfahren === 'einzelstamm') return [...base, 'skizze', 'stamm', 'ergebnis'];
    return base;
  };

  function render() {
    const list = schritte();
    s.i = Math.min(s.i, list.length - 1);
    const q = list[s.i];
    let title = '', help = null, inhalt = [], canNext = true, nextLabel = 'Weiter', bild = null;
    const zahlFeld = (label, wert, onSet, { einheit = '', step = '0.01', autofocus = true } = {}) => {
      const inp = h('input', { type: 'text', inputmode: 'decimal', value: wert != null ? String(wert).replace('.', ',') : '', autofocus,
        oninput: (e) => { onSet(zahl(e.target.value)); upd(); }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); weiter(); } } });
      return h('label', { class: 'polter-feld' }, label, h('span', { class: 'mit-einheit' }, inp, einheit ? h('span', {}, einheit) : null));
    };
    let upd = () => {};
    const einheitWahl = () => h('div', { class: 'einheit-zeile' }, h('span', {}, 'Höhe eingeben in'),
      h('div', { class: 'segmented compact einheit-wahl', role: 'radiogroup', 'aria-label': 'Einheit der Höhe' },
        [['cm', 'cm'], ['m', 'm']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-label': k === 'cm' ? 'Zentimeter' : 'Meter', 'aria-checked': String(s.einheit === k),
          onclick: () => { s.einheit = k; merkeEinheit(k); render(); } }, l))));
    const ausCm = (cm) => (cm == null ? null : s.einheit === 'm' ? cm / 100 : cm);
    const inCm = (x) => (x == null ? null : s.einheit === 'm' ? Math.round(x * 1000) / 10 : x);
    const v = s.verfahren && VERFAHREN[s.verfahren];

    if (q === 'start') {
      title = 'Welches Polter nimmst du auf?';
      inhalt = [
        h('label', {}, 'Fläche (Herkunft)', h('select', { onchange: (e) => { s.parcelId = e.target.value || null; } },
          h('option', { value: '' }, 'ohne Flächenzuordnung'), mine.map((p) => h('option', { value: p.id, selected: p.id === s.parcelId }, `Flurstück ${p.nr}, ${p.gemarkung}`)))),
        h('label', {}, 'Polter-Nr.', h('input', { type: 'text', value: s.polterNr, placeholder: 'z. B. P-12', oninput: (e) => { s.polterNr = e.target.value.trim(); } })),
        h('label', {}, 'Baumart', h('select', { onchange: (e) => { s.species = e.target.value; s.red = null; } }, SPECIES.map((o) => h('option', { selected: o === s.species }, o)))),
        h('div', { class: 'gps-feld' }, h('span', {}, s.pos ? `Standort: ${s.pos}` : 'Standort des Polters (für Abfuhr und Holzkäufer)'),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => {
            if (!navigator.geolocation) { toast('Kein GPS verfügbar'); return; }
            navigator.geolocation.getCurrentPosition((p) => { s.pos = `${p.coords.latitude.toFixed(6)} N, ${p.coords.longitude.toFixed(6)} O`; render(); },
              () => toast('Standort nicht verfügbar'), { enableHighAccuracy: true, timeout: 15000 });
          } }, s.pos ? 'Neu erfassen' : 'Standort erfassen')),
      ];
    } else if (q === 'sortiment') {
      title = 'Welches Sortiment liegt im Polter?';
      help = 'Das Messverfahren wird nach der RVR (Tabelle 7) automatisch gewählt.';
      inhalt = [
        h('div', { class: 'q-cards' }, SORTIMENTE.map((o) => h('button', { type: 'button', class: `q-option ${s.sortiment === o.key ? 'on' : ''}`, 'aria-pressed': String(s.sortiment === o.key),
          onclick: () => { s.sortiment = o.key; s.verfahren = o.verfahren; render(); } },
          h('span', { class: 'q-text' }, h('strong', {}, o.label), h('small', {}, `${o.text} → ${VERFAHREN[o.verfahren].label}`))))),
        v ? h('div', { class: 'calc-box' }, h('strong', {}, `Verfahren: ${v.label} (${v.einheit})`), h('small', {}, `${v.text} Grundlage: ${v.anlage}.`),
          s.sortiment === 'ih_kurz' || s.sortiment === 'eh_kurz' ? h('button', { type: 'button', class: 'link-btn', onclick: () => { s.verfahren = s.verfahren === 'sektion' ? 'schicht' : 'sektion'; render(); } },
            s.verfahren === 'sektion' ? 'Stattdessen konventionelles Schichtraummaß (nur 1 m oder 2 m)' : 'Zurück zum Sektionsraummaß') : null) : null,
      ];
      canNext = !!s.verfahren;
    } else if (q === 'skizze') {
      title = 'Das wird gemessen';
      if (s.verfahren === 'einzelstamm') {
        bild = stammSkizze();
        inhalt = [h('ul', { class: 'mess-liste' },
          h('li', {}, h('b', {}, 'L – Länge: '), 'Bestelllänge in m, ohne Übermaß. Bei Stämmen mit Fallkerb ab der Mitte des Fallkerbs messen.'),
          h('li', {}, h('b', {}, 'd – Mittendurchmesser: '), 'in der Stammmitte, auf ganze cm abgerundet. Bis 19 cm einmal waagerecht kluppen, ab 20 cm zwei Messungen senkrecht zueinander (kleinster und größter Durchmesser).'),
          h('li', {}, 'Liegt die Mitte auf einem Astquirl, oberhalb und unterhalb im gleichen Abstand messen und mitteln.'),
          h('li', {}, 'Gemessen wird ohne Rinde. Mit Rinde gemessen: Rindenabzug nach RVR Anlage VII bzw. Vereinbarung eintragen.'))];
      } else if (s.verfahren === 'schicht') {
        bild = polterSkizze({ schicht: true });
        inhalt = [h('ul', { class: 'mess-liste' },
          h('li', {}, h('b', {}, 'L – Polterlänge '), 'an der Basis.'),
          h('li', {}, h('b', {}, 'T – Tiefe: '), 'Scheitlänge 1 m oder 2 m.'),
          h('li', {}, h('b', {}, 'H – Höhen: '), 'an mehreren Stellen von der Unter- bis zur Oberkante. Die App bildet den Mittelwert.'),
          h('li', {}, 'Volumen = H × L × T × 0,96 (pauschal 4 % Übermaß).'))];
      } else {
        bild = polterSkizze();
        inhalt = [h('ul', { class: 'mess-liste' },
          h('li', {}, h('b', {}, 'LAB – Poltergesamtlänge '), 'an der Polterbasis. Daraus ergibt sich die Sektionslänge LS (bis 10 m: 1 m, bis 20 m: 2 m, bis 40 m: 4 m …).'),
          h('li', {}, h('b', {}, 'T – Poltertiefe '), '= Bestelllänge laut Kaufvertrag.'),
          h('li', {}, h('b', {}, 'H1, H2 … – Sektionshöhen '), 'zentimetergenau, senkrecht über der markierten Sektionsmitte. Messlatte am Holz ansetzen, nicht am Boden. Abgelesen wird, wo die Senkrechte die Stirnfläche verlässt.'),
          h('li', {}, h('b', {}, 'HB – Höhe der Restsektion '), 'in deren Mitte (LB/2).'),
          h('li', {}, 'Vorder- und Rückseite vom gleichen Ende aus einteilen und messen.'),
          h('li', {}, h('b', {}, 'C – Unterlagen: '), 'Gemessen wird nur oberhalb der Unterlagen. Ihr Volumen zählt nur mit, wenn sie zum Los gehören (mitverkauft werden) – dann gutachterlich in Rm schätzen.'))];
        inhalt.push(h('p', { class: 'hint' }, 'Mindestens ca. 20 Rm je Polter, nur eine Bestelllänge je Los, Stirnflächen höchstens 10 cm von der mittleren Ebene abweichend. Du brauchst ein Maßband (20–50 m), Sprühfarbe und eine Messlatte mit cm-Teilung.'));
      }
      nextLabel = 'Messung beginnen';
    } else if (q === 'lab') {
      const sch = s.verfahren === 'schicht';
      bild = polterSkizze({ mark: 'lab', schicht: sch });
      title = sch ? 'Polterlänge L an der Basis' : 'Poltergesamtlänge LAB an der Basis';
      help = 'Mit dem Maßband an der Polterbasis messen.';
      inhalt = [zahlFeld(sch ? 'Polterlänge' : 'Poltergesamtlänge', sch ? s.l : s.lab, (x) => { if (sch) s.l = x; else { s.lab = x; s.hv = []; s.hr = []; } }, { einheit: 'm' }),
        sch ? null : h('div', { class: 'calc-box', id: 'ls-info' })];
      upd = () => {
        const box = body.querySelector('#ls-info');
        if (!box) { nextBtn.disabled = !((sch ? s.l : s.lab) > 0); return; }
        if (s.lab > 0 && s.lab <= 100) {
          const ls = sektionsLaenge(s.lab), n = Math.floor(s.lab / ls + 1e-9), lb = r2(s.lab - n * ls);
          fill(box, h('strong', {}, `Sektionslänge LS = ${ls} m`), h('small', {}, `${n} volle Sektion${n === 1 ? '' : 'en'}${lb > 0 ? ` und eine Restsektion von ${zahlText(lb)} m` : ''}. Markiere die Sektionsgrenzen und jeweils die Mitte (bei ${ls / 2} m, ${ls * 1.5} m, …) mit Sprühfarbe – auf Vorder- und Rückseite vom gleichen Ende aus.`));
        } else fill(box, h('small', {}, s.lab > 100 ? 'Die RVR-Tabelle reicht bis 100 m – teile längere Polter auf.' : 'Nach der Eingabe zeigt die App die Sektionseinteilung.'));
        nextBtn.disabled = !(s.lab > 0 && s.lab <= 100);
      };
    } else if (q === 'tiefe') {
      bild = polterSkizze({ mark: 'tiefe', schicht: s.verfahren === 'schicht' });
      title = 'Poltertiefe T';
      help = s.verfahren === 'schicht' ? 'Scheitlänge des Schichtholzes.' : 'Die Bestelllänge laut Kaufvertrag (abrechnungsrelevante Länge).';
      const opts = s.verfahren === 'schicht' ? [1, 2] : [1, 2, 3];
      inhalt = [h('div', { class: 'q-chips' }, opts.map((o) => h('button', { type: 'button', class: `q-option ${s.t === o ? 'on' : ''}`, onclick: () => { s.t = o; s.red = null; s.u = null; render(); } }, `${o} m`))),
        s.verfahren === 'schicht' ? null : zahlFeld('Andere Bestelllänge', opts.includes(s.t) ? null : s.t, (x) => { s.t = x; s.red = null; s.u = null; }, { einheit: 'm', autofocus: false })];
      canNext = s.t > 0;
      upd = () => { nextBtn.disabled = !(s.t > 0); };
    } else if (/^[vr]:\d+$/.test(q)) {
      const [seite, idx] = q.split(':'); const i = Number(idx);
      const ls = sektionsLaenge(s.lab), n = Math.floor(s.lab / ls + 1e-9), lb = r2(s.lab - n * ls);
      const istB = i === n;
      const arr = seite === 'v' ? s.hv : s.hr;
      const mitte = istB ? n * ls + lb / 2 : (i + 0.5) * ls;
      bild = polterSkizze({ mark: istB ? 'hb' : `h${Math.min(i, 4)}`, sektionen: 5 });
      title = istB ? `Restsektion B – Höhe HB (${seite === 'v' ? 'Vorderseite' : 'Rückseite'})` : `Sektion ${i + 1} von ${n} – Höhe H${i + 1} (${seite === 'v' ? 'Vorderseite' : 'Rückseite'})`;
      help = `Senkrecht über der Sektionsmitte bei ${zahlText(mitte)} m (vom Polteranfang) messen. Latte unten am Holz ansetzen – oberhalb der Unterlagen, nicht am Boden.`;
      inhalt = [einheitWahl(), zahlFeld('Höhe', ausCm(arr[i]), (x) => { arr[i] = inCm(x); }, { einheit: s.einheit }),
        h('p', { class: 'muted' }, `Bisher gemessen: ${arr.slice(0, n + (lb > 0 ? 1 : 0)).map((x, k) => (x != null ? `${k === n ? 'HB' : `H${k + 1}`} ${hoeheText(x, s.einheit)}` : null)).filter(Boolean).join(' · ') || '–'}`)];
      upd = () => { nextBtn.disabled = !(arr[i] > 0); };
    } else if (q === 'rueckfrage') {
      bild = polterSkizze({ mark: 'alle' });
      title = 'Rückseite messen?';
      help = 'Nach der RVR werden Vorder- und Rückseite gemessen; die App mittelt die Höhen je Sektion.';
      inhalt = [h('div', { class: 'q-cards' },
        h('button', { type: 'button', class: `q-option ${s.rueck ? 'on' : ''}`, onclick: () => { s.rueck = true; render(); } }, h('span', { class: 'q-text' }, h('strong', {}, 'Ja, Rückseite messen'), h('small', {}, 'Gleiche Sektionen vom gleichen Ende aus'))),
        h('button', { type: 'button', class: `q-option ${!s.rueck ? 'on' : ''}`, onclick: () => { s.rueck = false; render(); } }, h('span', { class: 'q-text' }, h('strong', {}, 'Nein, Rückseite nicht zugänglich'), h('small', {}, 'Es zählen nur die Höhen der Vorderseite'))))];
    } else if (q === 'unterlage') {
      bild = polterSkizze({ mark: 'c' });
      title = 'Gehören die Unterlagen zum Los?';
      help = 'Gemessen wurde nur oberhalb der Unterlagen. Ihr Volumen (Polterteil C) zählt nur mit, wenn die Unterlagen aus demselben Sortiment sind und mitverkauft werden.';
      inhalt = [h('div', { class: 'q-cards' },
        h('button', { type: 'button', class: `q-option ${!s.cLos ? 'on' : ''}`, onclick: () => { s.cLos = false; s.c = 0; render(); } },
          h('span', { class: 'q-text' }, h('strong', {}, 'Nein – keine Unterlagen oder sie bleiben liegen'), h('small', {}, 'Fremdholz, Abfallholz oder nicht mitverkauft: Polterteil C = 0'))),
        h('button', { type: 'button', class: `q-option ${s.cLos ? 'on' : ''}`, onclick: () => { s.cLos = true; render(); } },
          h('span', { class: 'q-text' }, h('strong', {}, 'Ja – die Unterlagen werden mitverkauft'), h('small', {}, 'Volumen gutachterlich in Rm m.R. schätzen')))),
        s.cLos ? zahlFeld('Geschätztes Volumen der Unterlagen', s.c || null, (x) => { s.c = x || 0; }, { einheit: 'Rm' }) : null];
      upd = () => { nextBtn.disabled = !!s.cLos && !(s.c > 0); };
    } else if (q === 'hoehen') {
      bild = polterSkizze({ mark: 'h', schicht: true });
      title = 'Polterhöhen H';
      help = 'An mehreren Stellen von der Unter- bis zur Oberkante messen. Nach jeder Messung „Höhe hinzufügen“.';
      const inp = h('input', { type: 'text', inputmode: 'decimal', autofocus: true, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } } });
      const add = () => { const x = inCm(zahl(inp.value)); if (x > 0) { s.hs.push(x); render(); } };
      inhalt = [einheitWahl(), h('label', { class: 'polter-feld' }, 'Höhe', h('span', { class: 'mit-einheit' }, inp, h('span', {}, s.einheit))),
        h('button', { type: 'button', class: 'btn', onclick: add }, 'Höhe hinzufügen'),
        s.hs.length ? h('ul', { class: 'mess-werte' }, s.hs.map((x, k) => h('li', {}, `H${k + 1}: ${hoeheText(x, s.einheit)}`, h('button', { type: 'button', class: 'link-btn', onclick: () => { s.hs.splice(k, 1); render(); } }, 'entfernen')))) : null,
        s.hs.length ? h('p', { class: 'muted' }, `Mittlere Höhe: ${hoeheText(s.hs.reduce((a, b) => a + b, 0) / s.hs.length, s.einheit)}`) : null];
      canNext = s.hs.length >= 2;
      if (!canNext) inhalt.push(h('p', { class: 'hint' }, 'Mindestens zwei Höhen messen.'));
    } else if (q === 'reduktion') {
      const rd = reduktion(s.species, s.t);
      s.red ??= rd.von;
      title = 'Reduktionsfaktor (Raumübermaß)';
      help = `Laut RVR: ${rd.text}. Damit wird das Übermaß gesetzter Polter abgezogen.`;
      const werte = [...new Set([rd.von, Math.round((rd.von + rd.bis) / 2 * 1000) / 1000, rd.bis])];
      inhalt = [h('div', { class: 'q-chips' }, werte.map((o) => h('button', { type: 'button', class: `q-option ${s.red === o ? 'on' : ''}`, onclick: () => { s.red = o; render(); } }, zahlText(o, 3)))),
        zahlFeld('Eigener Wert', werte.includes(s.red) ? null : s.red, (x) => { s.red = x; }, { autofocus: false })];
    } else if (q === 'faktor') {
      const len = s.t;
      const em = umrechnung(len, s.entrindet);
      s.u ??= em.faktor;
      title = 'Umrechnungsfaktor Raummeter → Festmeter';
      help = `Empfehlung der RVR (4.2.1, Tabelle 5): ${em.text}`;
      inhalt = [
        h('div', { class: 'segmented', role: 'radiogroup' },
          [[false, 'mit Rinde (m.R.)'], [true, 'entrindet (o.R.)']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.entrindet === k), onclick: () => { s.entrindet = k; s.u = umrechnung(len, k).faktor; render(); } }, l))),
        h('div', { class: 'q-chips' }, [0.80, 0.75, 0.70, 0.65, 0.60].map((o) => h('button', { type: 'button', class: `q-option ${s.u === o ? 'on' : ''}`, onclick: () => { s.u = o; render(); } }, `${zahlText(o)}${o === em.faktor ? ' (RVR)' : ''}`))),
        zahlFeld('Eigener Faktor', [0.8, 0.75, 0.7, 0.65, 0.6].includes(s.u) ? null : s.u, (x) => { s.u = x; }, { autofocus: false }),
        h('p', { class: 'hint' }, 'Die RVR-Faktoren sind Durchschnittswerte für die interne Umrechnung, kein Verkaufsmaß. Abgerechnet wird nach der Vereinbarung mit dem Holzkäufer.')];
      upd = () => { nextBtn.disabled = !(s.u > 0); };
    } else if (q === 'stamm') {
      const nw = s.neu;
      bild = stammSkizze(nw.l == null ? 'l' : 'd');
      title = `Stamm ${s.staemme.length + 1}`;
      help = 'Länge und Mittendurchmesser eintragen, dann „Stamm speichern“. Ab 20 cm zweite Messung senkrecht zur ersten.';
      const feld = (label, key, einheit, af) => h('label', { class: 'polter-feld' }, label, h('span', { class: 'mit-einheit' },
        h('input', { type: 'text', inputmode: 'decimal', value: nw[key] != null ? String(nw[key]).replace('.', ',') : '', autofocus: af, oninput: (e) => { nw[key] = zahl(e.target.value); zeigeV(); } }), h('span', {}, einheit)));
      const vBox = h('p', { class: 'muted' });
      const zeigeV = () => { const ok = nw.l > 0 && nw.d1 > 0 && (nw.d1 < 20 || nw.d2 > 0); vBox.textContent = ok ? `d = ${stammMitte(nw)} cm → V = π/4 × (${stammMitte(nw)} cm)² × ${zahlText(nw.l)} m = ${zahlText(stammVolumen(nw))} Fm o.R.` : 'Volumen nach der Huberschen Formel: V = π/4 × d² × L'; };
      const speichern = () => {
        if (!(nw.l > 0 && nw.d1 > 0 && (nw.d1 < 20 || nw.d2 > 0))) { toast(nw.d1 >= 20 ? 'Ab 20 cm bitte zweiten Durchmesser messen.' : 'Bitte Länge und Durchmesser eintragen.'); return; }
        s.staemme.push({ ...nw, d2: nw.d1 >= 20 ? nw.d2 : null }); s.neu = { l: nw.l, d1: null, d2: null, rinde: nw.rinde, rabzug: nw.rabzug }; render();
      };
      inhalt = [feld('Länge L', 'l', 'm', nw.l == null), feld('Durchmesser d1', 'd1', 'cm', nw.l != null), feld('Durchmesser d2 (ab 20 cm)', 'd2', 'cm', false),
        h('div', { class: 'segmented', role: 'radiogroup' }, [['oR', 'ohne Rinde gemessen'], ['mR', 'mit Rinde gemessen']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(nw.rinde === k), onclick: () => { nw.rinde = k; render(); } }, l))),
        nw.rinde === 'mR' ? feld('Rindenabzug (doppelte Rindenstärke)', 'rabzug', 'cm', false) : null,
        vBox, h('button', { type: 'button', class: 'btn', onclick: speichern }, 'Stamm speichern'),
        s.staemme.length ? h('ul', { class: 'mess-werte' }, s.staemme.map((x, k) => h('li', {}, `Nr. ${k + 1}: L ${zahlText(x.l)} m, d ${stammMitte(x)} cm → ${zahlText(stammVolumen(x))} Fm`,
          h('button', { type: 'button', class: 'link-btn', onclick: () => { s.staemme.splice(k, 1); render(); } }, 'entfernen')))) : null,
        s.staemme.length ? h('p', {}, h('strong', {}, `Summe: ${s.staemme.length} Stämme, ${zahlText(s.staemme.reduce((a, x) => a + stammVolumen(x), 0))} Fm o.R.`)) : null];
      setTimeout(zeigeV);
      canNext = s.staemme.length > 0; nextLabel = 'Fertig – zur Auswertung';
    } else if (q === 'ergebnis') {
      title = 'Ergebnis';
      inhalt = [ergebnisBox()];
      nextLabel = 'Polter speichern';
    }

    const zurueck = h('button', { type: 'button', class: 'btn', onclick: () => { if (s.i === 0) page.close(); else { s.i--; render(); } } }, s.i === 0 ? 'Abbrechen' : 'Zurück');
    const nextBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large', disabled: !canNext, onclick: () => weiter() }, nextLabel);
    fill(body,
      h('div', { class: 'q-progress', 'aria-label': `Schritt ${s.i + 1} von ${list.length}` }, list.map((_, k) => h('span', { class: k < s.i ? 'done' : k === s.i ? 'now' : '' }))),
      v && s.i > 1 ? h('p', { class: 'sheet-label' }, `${v.label} · ${SORTIMENTE.find((o) => o.key === s.sortiment)?.label || ''}`) : null,
      h('h2', { class: 'step-title' }, title), help ? h('p', { class: 'muted' }, help) : null,
      bild ? h('div', { class: 'polter-bild', html: bild }) : null,
      h('div', { class: 'polter-inhalt' }, inhalt),
      h('div', { class: 'q-nav' }, zurueck, nextBtn));
    upd();
    body.querySelector('[autofocus]')?.focus();
    body.closest('.page-body')?.scrollTo?.(0, 0);
  }
  function weiter() {
    const list = schritte();
    if (list[s.i] === 'ergebnis') { speichere(); return; }
    const btn = body.querySelector('.q-nav .btn-primary');
    if (btn?.disabled) return;
    s.i++; render();
  }

  function rechnung() {
    if (s.verfahren === 'sektion') return { art: 'sektion', ...sektionRechnung(s) };
    if (s.verfahren === 'schicht') return { art: 'schicht', ...schichtRechnung(s) };
    const fm = r2(s.staemme.reduce((a, x) => a + stammVolumen(x), 0));
    return { art: 'einzelstamm', fm, stueck: s.staemme.length };
  }
  function ergebnisBox() {
    const r = rechnung();
    const z = (a, b) => h('small', {}, a, ' ', h('b', {}, b));
    let zeilen = [];
    if (r.art === 'sektion') {
      zeilen = [z(`Sektionslänge LS ${r.ls} m, ${r.n} volle Sektionen${r.lb > 0 ? `, Restsektion ${zahlText(r.lb)} m` : ''}; Tiefe T ${zahlText(s.t)} m${s.rueck ? '; Höhen je Sektion aus Vorder- und Rückseite gemittelt' : ''}`, ''),
        z('Polterteil A = LS × Summe der Sektionshöhen × T =', `${zahlText(r.A)} Rm`),
        r.lb > 0 ? z('Polterteil B = LB × HB × T =', `${zahlText(r.B)} Rm`) : null,
        z('Unterlagen C =', r.C ? `${zahlText(r.C)} Rm (gehören zum Los)` : '0 Rm (nicht im Los)'),
        z('Bruttovolumen A + B + C =', `${zahlText(r.brutto)} Rm m.R.`),
        z(`Nettovolumen × Reduktionsfaktor ${zahlText(s.red, 3)} =`, `${zahlText(r.netto)} Rm m.R.`),
        z(`Holzmenge × Umrechnungsfaktor ${zahlText(s.u)} =`, `${zahlText(r.fm)} Fm o.R.`)];
    } else if (r.art === 'schicht') {
      zeilen = [z('Mittlere Höhe H (abgerundet) =', `${zahlText(r.H)} m`), z('Länge L =', `${zahlText(r.L)} m`), z('Tiefe T =', `${zahlText(s.t)} m`),
        z('Raummaß = H × L × T × 0,96 =', `${zahlText(r.netto)} Rm m.R.`), z(`Holzmenge × Umrechnungsfaktor ${zahlText(s.u)} =`, `${zahlText(r.fm)} Fm o.R.`)];
    } else {
      zeilen = [z('Anzahl Stämme:', String(r.stueck)), z('Summe nach Huberscher Formel:', `${zahlText(r.fm)} Fm o.R.`)];
    }
    return h('div', { class: 'calc-box polter-ergebnis' },
      h('div', { class: 'preview' },
        r.netto != null ? h('div', {}, h('span', { class: 'pv-n' }, zahlText(r.netto)), h('span', {}, 'Rm m.R.')) : h('div', {}, h('span', { class: 'pv-n' }, r.stueck), h('span', {}, 'Stämme')),
        h('div', {}, h('span', { class: 'pv-n' }, zahlText(r.fm)), h('span', {}, 'Fm o.R.'))),
      zeilen, h('small', { class: 'hint' }, `Gerechnet nach ${VERFAHREN[s.verfahren].anlage} (Rahmenvereinbarung für den Rohholzhandel in Deutschland).`));
  }
  function speichere() {
    const r = rechnung();
    const sort = SORTIMENTE.find((o) => o.key === s.sortiment);
    const details = {
      polterNr: s.polterNr, species: s.species, sortiment: sort?.label || '', verfahren: VERFAHREN[s.verfahren].label,
      laenge: s.verfahren === 'einzelstamm' ? '' : zahlText(s.t), stueck: r.stueck != null ? String(r.stueck) : '',
      rm: r.netto != null ? zahlText(r.netto) : '', unterlagen: s.verfahren === 'sektion' ? (s.c ? zahlText(s.c) : '0') : '', red: s.red != null && s.verfahren === 'sektion' ? zahlText(s.red, 3) : '',
      faktor: s.u != null && s.verfahren !== 'einzelstamm' ? zahlText(s.u) : '', fm: zahlText(r.fm), pos: s.pos || '',
    };
    const messung = { verfahren: s.verfahren, sortiment: s.sortiment, lab: s.lab, l: s.l, t: s.t, hv: s.hv, hr: s.rueck ? s.hr : [], rueck: s.rueck, c: s.c, red: s.red, u: s.u, entrindet: s.entrindet, hs: s.hs, staemme: s.staemme, ergebnis: r };
    store.update((st) => st.measures.push({ id: uid(), type: 'polter', parcelId: s.parcelId, date: Date.now(), finishedAt: Date.now(), status: 'fertig', createdAt: Date.now(), note: '', details, messung }));
    toast(`Polter gespeichert: ${zahlText(r.fm)} Fm o.R.`);
    page.close();
    onSaved?.();
  }
  render();
  return page;
}
