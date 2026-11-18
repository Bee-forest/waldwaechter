// Wanzen-Ecke (Knopf neben dem Profil): Aufgabe der Woche mit Baumartenzähler und Bestimmungshilfe,
// Wanzen-Quiz, Saisonkalender und Abzeichen. Alles läuft ohne Anmeldung und ohne fremde Dienste.
import { h, fill, openPage, toast } from './ui.js';
import { store, uid } from './store.js';
import { WANZE_SVG } from './mascot.js';

// ---------- Bildkarten ----------
const g = (inhalt, farbe = '#3E7D3A') => `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="${farbe}" stroke="#24502A" stroke-width="1.5" stroke-linejoin="round">${inhalt}</g></svg>`;
const blatt = (d) => g(`<path d="${d}"/><path d="M32 58V40" fill="none"/>`);
export const ARTEN = [
  { k: 'fichte', name: 'Fichte', nadel: true, merkmal: 'Spitze, vierkantige Nadeln rund um den Zweig, hängende Zapfen', bild: g('<path d="M32 6v52" fill="none"/>' + Array.from({ length: 9 }, (_, i) => `<path d="M32 ${12 + i * 5} l-11 5 M32 ${12 + i * 5} l11 5" fill="none"/>`).join('')) },
  { k: 'kiefer', name: 'Kiefer', nadel: true, merkmal: 'Lange Nadeln zu zweit, rötliche Rinde oben am Stamm', bild: g('<path d="M32 58V30" fill="none"/>' + [[-20, -22], [-8, -26], [8, -26], [20, -22]].map(([x, y]) => `<path d="M32 30 q${x / 2} ${y / 2} ${x} ${y}" fill="none" stroke-width="2.4"/>`).join('')) },
  { k: 'laerche', name: 'Lärche', nadel: true, merkmal: 'Weiche Nadeln in Büscheln, im Herbst gelb und abfallend', bild: g([[20, 22], [44, 20], [30, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" />` + Array.from({ length: 8 }, (_, i) => `<path d="M${x} ${y} l${Math.cos(i * 0.8) * 9} ${Math.sin(i * 0.8) * 9}" fill="none"/>`).join('')).join(''), '#8DB34A') },
  { k: 'tanne', name: 'Weißtanne', nadel: true, merkmal: 'Flache Nadeln mit zwei weißen Streifen unten, stehende Zapfen', bild: g('<path d="M32 6v52" fill="none"/>' + Array.from({ length: 9 }, (_, i) => `<rect x="18" y="${11 + i * 5}" width="12" height="3" rx="1.5"/><rect x="34" y="${11 + i * 5}" width="12" height="3" rx="1.5"/>`).join('')) },
  { k: 'douglasie', name: 'Douglasie', nadel: true, merkmal: 'Weiche Nadeln, riechen nach Zitrone; Zapfen mit dreizipfligen Schuppen', bild: g('<path d="M32 6v52" fill="none"/>' + Array.from({ length: 8 }, (_, i) => `<path d="M32 ${12 + i * 5.5} l-12 3 M32 ${12 + i * 5.5} l12 3" fill="none" stroke-width="2"/>`).join(''), '#4F8C46') },
  { k: 'buche', name: 'Rotbuche', merkmal: 'Ovale Blätter mit gewelltem Rand, glatte graue Rinde', bild: blatt('M32 8 C46 16 48 34 32 44 C16 34 18 16 32 8Z') },
  { k: 'eiche', name: 'Eiche', merkmal: 'Gelappte Blätter, Eicheln, rissige Rinde', bild: blatt('M32 8 c6 2 4 6 8 7 c5 1 2 6 6 8 c4 3 -2 6 1 9 c2 4 -6 4 -6 8 c0 3 -6 4 -9 4 c-3 0 -9 -1 -9 -4 c0 -4 -8 -4 -6 -8 c3 -3 -3 -6 1 -9 c4 -2 1 -7 6 -8 c4 -1 2 -5 8 -7Z') },
  { k: 'ahorn', name: 'Ahorn', merkmal: 'Handförmige Blätter, Früchte mit Flügeln („Nasenzwicker“)', bild: blatt('M32 6 l5 12 l12 -6 l-4 12 l12 4 l-12 6 l4 10 l-12 -4 l-5 4 l-5 -4 l-12 4 l4 -10 l-12 -6 l12 -4 l-4 -12 l12 6Z') },
  { k: 'birke', name: 'Birke', merkmal: 'Weiße Rinde mit schwarzen Flecken, dreieckige gesägte Blätter', bild: blatt('M32 8 L48 36 Q40 44 32 44 Q24 44 16 36Z') },
  { k: 'esche', name: 'Esche', merkmal: 'Gefiederte Blätter, schwarze Knospen im Winter', bild: g('<path d="M32 58V8" fill="none"/>' + [14, 24, 34].map((y) => `<ellipse cx="22" cy="${y}" rx="8" ry="3.5"/><ellipse cx="42" cy="${y}" rx="8" ry="3.5"/>`).join('') + '<ellipse cx="32" cy="8" rx="3.5" ry="7"/>') },
  { k: 'erle', name: 'Schwarzerle', merkmal: 'Rundliche Blätter mit eingekerbter Spitze, kleine Zäpfchen; am Bach', bild: blatt('M32 10 C50 12 50 40 32 44 C14 40 14 12 32 10Z M28 10 l4 4 l4 -4') },
  { k: 'hainbuche', name: 'Hainbuche', merkmal: 'Doppelt gesägte Blätter mit deutlichen Adern, Stamm „spannrückig“', bild: blatt('M32 8 C44 14 46 34 32 44 C18 34 20 14 32 8Z') + '' },
  { k: 'linde', name: 'Linde', merkmal: 'Herzförmige Blätter, Früchte am Flügelblatt', bild: blatt('M32 14 C38 4 54 10 46 26 C42 34 36 40 32 44 C28 40 22 34 18 26 C10 10 26 4 32 14Z') },
  { k: 'kirsche', name: 'Vogelkirsche', merkmal: 'Längliche gesägte Blätter, Rinde mit Querstreifen', bild: blatt('M32 6 C42 16 44 34 32 46 C20 34 22 16 32 6Z') },
  { k: 'eberesche', name: 'Eberesche', merkmal: 'Gefiederte, gesägte Blätter, rote Beeren', bild: g('<path d="M32 58V10" fill="none"/>' + [14, 22, 30].map((y) => `<ellipse cx="24" cy="${y}" rx="7" ry="3"/><ellipse cx="40" cy="${y}" rx="7" ry="3"/>`).join('') + '<circle cx="26" cy="46" r="3" fill="#D84315"/><circle cx="32" cy="50" r="3" fill="#D84315"/><circle cx="38" cy="46" r="3" fill="#D84315"/>') },
];

// ---------- Bestimmungshilfe (ohne Fotoerkennung) ----------
const SCHLUESSEL = {
  start: { frage: 'Hat der Baum Nadeln oder Blätter?', antworten: [['Nadeln', 'nadel'], ['Blätter', 'laub']] },
  nadel: { frage: 'Wie sitzen die Nadeln?', antworten: [['in Büscheln, weich', 'laerche'], ['zu zweit, lang', 'kiefer'], ['einzeln rund um den Zweig, spitz', 'fichte'], ['einzeln, flach, weich', 'nadelflach']] },
  nadelflach: { frage: 'Unterseite der Nadeln?', antworten: [['zwei deutliche weiße Streifen, Nadelspitze eingekerbt', 'tanne'], ['hellgrün, riechen nach Zitrone beim Zerreiben', 'douglasie']] },
  laub: { frage: 'Wie ist das Blatt aufgebaut?', antworten: [['aus vielen Fiederblättchen', 'gefiedert'], ['gelappt oder handförmig', 'gelappt'], ['einfach, ungeteilt', 'einfach']] },
  gefiedert: { frage: 'Rand der Fiederblättchen?', antworten: [['scharf gesägt, rote Beeren', 'eberesche'], ['fein gesägt, schwarze Knospen', 'esche']] },
  gelappt: { frage: 'Form der Lappen?', antworten: [['rundliche Buchten, Eicheln', 'eiche'], ['spitze Zipfel wie eine Hand', 'ahorn']] },
  einfach: { frage: 'Form des Blatts?', antworten: [['herzförmig', 'linde'], ['dreieckig, Rinde weiß', 'birke'], ['rund, Spitze eingekerbt', 'erle'], ['oval, Rand gewellt, nicht gesägt', 'buche'], ['oval, doppelt gesägt, Adern deutlich', 'hainbuche'], ['länglich, gesägt, Rinde mit Querstreifen', 'kirsche']] },
};
function bestimmen(onArt) {
  const body = h('div', { class: 'wz-schluessel' });
  const pfad = [];
  const schritt = (k) => {
    const art = ARTEN.find((a) => a.k === k);
    if (art) {
      fill(body, h('div', { class: 'wz-ergebnis' }, h('div', { class: 'wz-bild', html: art.bild }), h('h3', {}, `Wahrscheinlich: ${art.name}`), h('p', {}, art.merkmal),
        h('div', { class: 'btn-row' }, onArt ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { onArt(art.k); page.close(); } }, 'Mitzählen') : null,
          h('button', { type: 'button', class: 'btn', onclick: () => { pfad.length = 0; schritt('start'); } }, 'Neu bestimmen'))));
      return;
    }
    const s = SCHLUESSEL[k];
    pfad.push(k);
    fill(body, h('p', { class: 'muted' }, `Frage ${pfad.length}`), h('h3', {}, s.frage),
      h('div', { class: 'q-cards' }, s.antworten.map(([l, z]) => h('button', { type: 'button', class: 'q-option', onclick: () => schritt(z) }, h('span', { class: 'q-text' }, h('strong', {}, l))))),
      pfad.length > 1 ? h('button', { type: 'button', class: 'link-btn', onclick: () => { pfad.pop(); schritt(pfad.pop()); } }, 'Zurück') : null);
  };
  const page = openPage('Baum bestimmen', body);
  schritt('start');
}

// ---------- Wochenaufgaben ----------
const woche = (d = new Date()) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const tag = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - tag); const j = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-${String(Math.ceil(((t - j) / 864e5 + 1) / 7)).padStart(2, '0')}`; };
const AUFGABEN = [
  { k: 'zaehlen', titel: 'Baumarten zählen', text: 'Geh 100 Schritte durch deinen Wald und zähle jeden Baum, an dem du vorbeikommst – nach Baumart. Wie gemischt ist dein Wald?', ziel: 20 },
  { k: 'habitat', titel: 'Habitatbäume finden', text: 'Finde Bäume mit Spechthöhlen, Pilzen oder Rissen und trage sie unter „Weitere Layer“ → Naturschutz ein.', ziel: 3 },
  { k: 'verbiss', titel: 'Verbiss prüfen', text: 'Schau dir 20 junge Bäume an und tippe für jeden an, ob und wo er verbissen ist.', ziel: 20 },
  { k: 'kaefer', titel: 'Fichten kontrollieren', text: 'Prüfe 10 Fichten am Stammfuß und in Rindenritzen auf braunes Bohrmehl und Harztropfen und schau in die Krone. Tippe für jede Fichte das Ergebnis an.', ziel: 10 },
  { k: 'zaehlen2', titel: 'Mischbaumarten entdecken', text: 'Zähle auf einer Fläche alle Bäume, die nicht Fichte oder Kiefer sind. Jede Mischbaumart macht deinen Wald stabiler.', ziel: 10 },
];
export const aufgabeDerWoche = () => { const w = woche(); const n = Number(w.slice(-2)) + Number(w.slice(0, 4)); return { ...AUFGABEN[n % AUFGABEN.length], woche: w }; };

// ---------- Abzeichen ----------
const ABZEICHEN = [
  ['erste', 'Erste Zählung', (d) => d.zaehlungen.length >= 1],
  ['fuenfarten', 'Artenkenner – 5 Baumarten gezählt', (d) => new Set(d.zaehlungen.flatMap((z) => Object.keys(z.arten).filter((k) => z.arten[k] > 0))).size >= 5],
  ['hundert', '100 Bäume gezählt', (d) => d.zaehlungen.reduce((a, z) => a + Object.values(z.arten).reduce((x, y) => x + y, 0), 0) >= 100],
  ['woche3', 'Fleißige Wanze – 3 Wochenaufgaben', (d) => new Set(d.erledigt).size >= 3],
  ['quiz', 'Quiz-Profi – alle Fragen richtig', (d) => d.quizBest >= 8],
  ['bestimmt', 'Baumdetektiv – Bestimmungshilfe genutzt', (d) => d.bestimmt >= 1],
];
const daten = () => ({ zaehlungen: [], erledigt: [], quizBest: 0, bestimmt: 0, abzeichen: [], ...(store.get().wanze || {}) });
function pruefeAbzeichen() {
  const d = daten();
  const neu = ABZEICHEN.filter(([k, , test]) => !d.abzeichen.includes(k) && test(d));
  if (!neu.length) return;
  store.update((s) => { s.wanze = { ...daten(), abzeichen: [...d.abzeichen, ...neu.map(([k]) => k)] }; });
  toast(`Neues Abzeichen: ${neu.map(([, l]) => l).join(', ')} 🪲`);
}
export const abzeichenAnzahl = () => daten().abzeichen.length;

// ---------- Zähler ----------
function openZaehler(aufgabe) {
  const z = { arten: Object.fromEntries(ARTEN.map((a) => [a.k, 0])) };
  const body = h('div', { class: 'wz-zaehler' });
  const summe = () => Object.values(z.arten).reduce((a, b) => a + b, 0);
  const zeichne = () => fill(body,
    h('p', { class: 'muted' }, aufgabe ? aufgabe.text : 'Tippe auf eine Bildkarte, um einen Baum dieser Art zu zählen. Langes Drücken zieht einen ab.'),
    h('div', { class: 'wz-summe' }, h('strong', {}, String(summe())), ` Bäume${aufgabe?.ziel ? ` von ${aufgabe.ziel}` : ''} · ${Object.values(z.arten).filter((v) => v > 0).length} Arten`),
    h('div', { class: 'wz-karten' }, ARTEN.map((a) => {
      let timer = null, lang = false;
      return h('button', { type: 'button', class: `wz-karte ${z.arten[a.k] ? 'on' : ''}`, 'aria-label': `${a.name}: ${z.arten[a.k]}`, title: a.merkmal,
        onpointerdown: () => { lang = false; timer = setTimeout(() => { lang = true; if (z.arten[a.k] > 0) { z.arten[a.k]--; zeichne(); navigator.vibrate?.(30); } }, 550); },
        onpointerup: () => clearTimeout(timer), onpointerleave: () => clearTimeout(timer), oncontextmenu: (e) => e.preventDefault(),
        onclick: () => { if (lang) return; z.arten[a.k]++; navigator.vibrate?.(10); zeichne(); } },
        h('span', { class: 'wz-bild', html: a.bild }), h('span', { class: 'wz-name' }, a.name), z.arten[a.k] ? h('span', { class: 'wz-zahl' }, String(z.arten[a.k])) : null);
    })),
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: () => bestimmen((k) => { z.arten[k]++; store.update((s) => { s.wanze = { ...daten(), bestimmt: daten().bestimmt + 1 }; }); zeichne(); }) }, 'Unbekannter Baum? Bestimmen')),
    h('div', { class: 'q-nav' }, h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: speichern }, 'Zählung speichern')));
  const speichern = () => {
    if (!summe()) { toast('Noch nichts gezählt.'); return; }
    const pos = null;
    store.update((s) => { const d = daten(); s.wanze = { ...d, zaehlungen: [...d.zaehlungen, { id: uid(), ts: Date.now(), aufgabe: aufgabe?.k || null, arten: { ...z.arten }, pos }], erledigt: aufgabe && summe() >= (aufgabe.ziel || 1) ? [...d.erledigt, aufgabe.woche] : d.erledigt }; });
    const anteil = Object.entries(z.arten).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const top = anteil[0] ? ARTEN.find((a) => a.k === anteil[0][0]) : null;
    toast(`${summe()} Bäume gespeichert${top && anteil[0][1] / summe() > 0.8 ? ` – fast nur ${top.name}: Mischbaumarten würden den Wald stabiler machen` : ''}`);
    pruefeAbzeichen();
    page.close();
  };
  const page = openPage(aufgabe ? aufgabe.titel : 'Baumartenzähler', body);
  zeichne();
}

// ---------- Kontrollen (Käfer, Verbiss) ----------
const KONTROLLE = {
  kaefer: { was: 'Fichten', stufen: [['ok', 'ohne Befund', 'Kein Bohrmehl, kein Harzfluss, Krone grün', '#2E7D32'], ['verdacht', 'Verdacht', 'Einzelne Harztropfen oder Bohrlöcher', '#F9A825'], ['befall', 'Befall', 'Braunes Bohrmehl, Rinde löst sich oder Krone wird rot', '#C62828']] },
  verbiss: { was: 'junge Bäume', stufen: [['ok', 'nicht verbissen', 'Leittrieb und Seitentriebe unversehrt', '#2E7D32'], ['seite', 'Seitentrieb verbissen', 'Nur seitliche Triebe abgebissen', '#F9A825'], ['leit', 'Leittrieb verbissen', 'Der oberste Trieb ist abgebissen', '#C62828']] },
};
function openKontrolle(aufgabe) {
  const K = KONTROLLE[aufgabe.k];
  const n = Object.fromEntries(K.stufen.map(([k]) => [k, 0]));
  const body = h('div', { class: 'wz-zaehler' });
  const summe = () => Object.values(n).reduce((a, b) => a + b, 0);
  const zeichne = () => fill(body,
    h('p', { class: 'muted' }, aufgabe.text),
    h('div', { class: 'wz-summe' }, h('strong', {}, String(summe())), ` ${K.was} geprüft${aufgabe.ziel ? ` von ${aufgabe.ziel}` : ''}`),
    h('div', { class: 'q-cards' }, K.stufen.map(([k, l, t, farbe]) => h('button', { type: 'button', class: 'q-option wz-kontrolle', style: `--c:${farbe}`, onclick: () => { n[k]++; navigator.vibrate?.(10); zeichne(); } },
      h('span', { class: 'ampel-punkt', style: `background:${farbe}` }), h('span', { class: 'q-text' }, h('strong', {}, l), h('small', {}, t)), h('b', { class: 'wz-kzahl' }, String(n[k]))))),
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-small', onclick: () => { const k = Object.keys(n).reverse().find((x) => n[x] > 0); if (k) { n[k]--; zeichne(); } } }, 'Letzte Eingabe zurück')),
    h('div', { class: 'q-nav' }, h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: speichern }, 'Kontrolle speichern')));
  const speichern = async () => {
    if (!summe()) { toast('Noch nichts geprüft.'); return; }
    store.update((s) => { const d = daten(); s.wanze = { ...d, kontrollen: [...(d.kontrollen || []), { id: uid(), ts: Date.now(), art: aufgabe.k, n: { ...n } }], erledigt: summe() >= (aufgabe.ziel || 1) ? [...d.erledigt, aufgabe.woche] : d.erledigt }; });
    pruefeAbzeichen();
    page.close();
    if (aufgabe.k === 'kaefer' && (n.verdacht || n.befall)) {
      const ja = await (await import('./ui.js')).confirmDialog(`${n.befall ? `${n.befall} befallene` : ''}${n.befall && n.verdacht ? ' und ' : ''}${n.verdacht ? `${n.verdacht} verdächtige` : ''} Fichte${n.befall + n.verdacht > 1 ? 'n' : ''} gefunden. Befallene Bäume müssen schnell aus dem Wald – jetzt Schaden melden?`, { ok: 'Schaden melden' });
      if (ja) (await import('./schaden.js')).openSchadensmeldung({ typ: 'kaefer', baeume: n.befall + n.verdacht });
    } else if (aufgabe.k === 'verbiss') {
      const q = Math.round((n.leit / summe()) * 100);
      toast(q >= 20 ? `${q} % mit verbissenem Leittrieb – das ist viel. Sprich mit dem Jagdpächter oder schütze die Pflanzen.` : `${q} % mit verbissenem Leittrieb – im Rahmen.`);
    } else toast('Kontrolle gespeichert – keine Auffälligkeiten.');
  };
  const page = openPage(aufgabe.titel, body);
  zeichne();
}
/** Wochenaufgabe öffnen: jede Aufgabe hat ihr eigenes Werkzeug */
async function aufgabeStarten(a) {
  if (KONTROLLE[a.k]) { openKontrolle(a); return; }
  if (a.k === 'habitat') {
    const p = store.get().parcels.find((x) => x.ring?.length);
    const c = p ? p.ring.reduce((acc, q) => [acc[0] + q[0] / p.ring.length, acc[1] + q[1] / p.ring.length], [0, 0]) : [50.9, 11.0];
    const { openPunktEditor } = await import('./map/punkte.js');
    openPunktEditor({ center: c, zoom: 17, art: 'habitat' });
    store.update((s) => { const d = daten(); s.wanze = { ...d, erledigt: [...d.erledigt, a.woche] }; });
    toast('Tippe in die Karte, wo ein Habitatbaum steht.');
    return;
  }
  openZaehler(a);
}

// ---------- Quiz ----------
const FRAGEN = [
  ['Ab welcher Tageshöchsttemperatur beginnt der Buchdrucker (Borkenkäfer) etwa zu schwärmen?', ['ca. 10 °C', 'ca. 16,5 °C', 'ca. 25 °C'], 1, 'Ab etwa 16,5 °C fliegt der Buchdrucker aus – dann Fichten regelmäßig kontrollieren.'],
  ['Woran erkennst du frischen Käferbefall an der Fichte?', ['Braunes Bohrmehl am Stammfuß', 'Weiße Flecken auf den Nadeln', 'Viele Zapfen'], 0, 'Braunes Bohrmehl in Rindenritzen und am Stammfuß ist das sicherste frühe Zeichen.'],
  ['Was ist ein Z-Baum?', ['Ein kranker Baum, der weg muss', 'Ein Zukunftsbaum, der gefördert wird', 'Ein Baum an der Grundstücksgrenze'], 1, 'Z-Bäume sind vitale, gut geformte Bäume, denen man bei der Durchforstung Platz verschafft.'],
  ['Welche Baumart hat Nadeln zu zweit?', ['Fichte', 'Kiefer', 'Lärche'], 1, 'Die Wald-Kiefer trägt ihre langen Nadeln paarweise.'],
  ['Welcher Nadelbaum wirft im Herbst seine Nadeln ab?', ['Lärche', 'Tanne', 'Douglasie'], 0, 'Die Lärche ist der einzige heimische Nadelbaum, der im Winter kahl ist.'],
  ['Wozu dienen Rückegassen?', ['Als Wanderwege', 'Maschinen fahren nur dort – der übrige Boden bleibt geschont', 'Als Brandschutzschneise'], 1, 'Feste Gassen im Abstand von 20–40 m schützen den Waldboden vor Verdichtung.'],
  ['Was ist eine Läuterung?', ['Pflege in der Dickung: Protzen und kranke Bäume entnehmen', 'Ernte alter Bäume', 'Kalkung des Bodens'], 0, 'Die Läuterung ist die Pflege junger Bestände vor der ersten Durchforstung.'],
  ['Wie viele Habitatbäume je Hektar gelten als gute Faustzahl?', ['etwa 1', 'etwa 5', 'etwa 50'], 1, 'Rund 5 Habitatbäume je ha bieten Höhlen und Nischen für viele Arten.'],
  ['Welche Baumart verträgt nasse Böden am besten?', ['Schwarzerle', 'Rotbuche', 'Kiefer'], 0, 'Die Schwarzerle wächst sogar auf zeitweise überfluteten Standorten.'],
  ['Warum sind Mischwälder stabiler als Reinbestände?', ['Sie wachsen schneller', 'Das Risiko durch Sturm, Käfer und Trockenheit verteilt sich', 'Sie brauchen keine Pflege'], 1, 'Fällt eine Baumart aus, bleiben die anderen – der Wald bleibt Wald.'],
  ['Wann sollte man feuchte Waldböden befahren?', ['Bei Frost oder nach längerer Trockenheit', 'Direkt nach Regen', 'Immer im Frühling'], 0, 'Gefrorener oder trockener Boden trägt die Maschinen, ohne zu verdichten.'],
  ['Was frisst der Rehbock bevorzugt an jungen Bäumen?', ['Wurzeln', 'Knospen und Leittriebe', 'Rinde alter Bäume'], 1, 'Verbiss am Leittrieb bremst junge Bäume stark – vor allem Tanne, Eiche und Ahorn.'],
  ['Woran erkennst du eine Rotbuche?', ['Glatte graue Rinde, ovale Blätter mit gewelltem Rand', 'Weiße Rinde mit schwarzen Flecken', 'Tief gefurchte Rinde und gelappte Blätter'], 0, 'Die glatte, silbergraue Rinde ist typisch für die Buche.'],
  ['Was bedeutet „Fm“ beim Holz?', ['Festmeter – 1 m³ reines Holz', 'Fichtenmeter', 'Flächenmeter'], 0, 'Ein Festmeter ist ein Kubikmeter feste Holzmasse ohne Zwischenräume.'],
];
function openQuiz() {
  const runde = [...FRAGEN].sort(() => Math.random() - 0.5).slice(0, 8);
  let i = 0, richtig = 0, beantwortet = null;
  const body = h('div', { class: 'wz-quiz' });
  const page = openPage('Wanzen-Quiz', body);
  const zeichne = () => {
    if (i >= runde.length) {
      const d = daten();
      if (richtig > d.quizBest) store.update((s) => { s.wanze = { ...daten(), quizBest: richtig }; });
      pruefeAbzeichen();
      fill(body, h('div', { class: 'wz-ergebnis' }, h('div', { class: 'wz-wanze', html: WANZE_SVG }), h('h3', {}, `${richtig} von ${runde.length} richtig`),
        h('p', {}, richtig === runde.length ? 'Perfekt – du kennst deinen Wald!' : richtig >= 5 ? 'Gut gemacht!' : 'Noch mal? Jede Runde hat neue Fragen.'),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { page.close(); openQuiz(); } }, 'Neue Runde'))));
      return;
    }
    const [frage, antworten, loesung, erkl] = runde[i];
    fill(body, h('p', { class: 'muted' }, `Frage ${i + 1} von ${runde.length} · ${richtig} richtig`), h('h3', {}, frage),
      h('div', { class: 'q-cards' }, antworten.map((a, k) => h('button', { type: 'button', disabled: beantwortet != null, class: `q-option ${beantwortet != null && k === loesung ? 'wz-richtig' : ''} ${beantwortet === k && k !== loesung ? 'wz-falsch' : ''}`,
        onclick: () => { beantwortet = k; if (k === loesung) richtig++; zeichne(); } }, h('span', { class: 'q-text' }, h('strong', {}, a))))),
      beantwortet != null ? h('div', { class: 'calc-box' }, h('strong', {}, beantwortet === loesung ? 'Richtig!' : 'Nicht ganz.'), h('small', {}, erkl)) : null,
      beantwortet != null ? h('div', { class: 'q-nav' }, h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => { i++; beantwortet = null; zeichne(); } }, i + 1 < runde.length ? 'Nächste Frage' : 'Auswertung')) : null);
  };
  zeichne();
}

// ---------- Saisonkalender ----------
export const SAISON = [
  ['Januar', ['Holzeinschlag bei Frost (bodenschonend)', 'Käferbäume vom Vorjahr aufarbeiten', 'Zäune nach Schneebruch kontrollieren']],
  ['Februar', ['Einschlag abschließen, Holz abfahren lassen', 'Pflanzung planen und Pflanzen bestellen', 'Förderanträge vorbereiten']],
  ['März', ['Pflanzung bei offenem Boden', 'Wildschutz anbringen', 'Ab Ende März Brut- und Setzzeit beachten']],
  ['April', ['Pflanzung abschließen', 'Ab 16,5 °C Fichten auf Käferbefall prüfen', 'Waldbrandgefahr beachten']],
  ['Mai', ['Käferkontrolle alle 1–2 Wochen', 'Kulturen freischneiden', 'Verkehrssicherung belaubt kontrollieren']],
  ['Juni', ['Käferkontrolle, befallene Bäume sofort raus', 'Kulturpflege', 'Bei Trockenheit Kulturen kontrollieren']],
  ['Juli', ['Zweite Käfergeneration im Blick behalten', 'Kulturen freischneiden', 'Waldbrandgefahr hoch']],
  ['August', ['Käferkontrolle', 'Durchforstungen für den Winter planen und auszeichnen', 'Verkehrssicherung an Wegen']],
  ['September', ['Auszeichnen für die Durchforstung', 'Saatgut / Eicheln sammeln', 'Unternehmer für den Winter beauftragen']],
  ['Oktober', ['Herbstpflanzung (Laubholz)', 'Zäune und Einzelschutz prüfen', 'Rückegassen markieren']],
  ['November', ['Herbstpflanzung abschließen', 'Fichten auf rote Kronen und abfallende Rinde prüfen', 'Durchforstung und Holzernte beginnen', 'Verkehrssicherung unbelaubt kontrollieren']],
  ['Dezember', ['Holzernte bei Frost', 'Holz über die FBG vermarkten', 'Flurstückhistorie (Tagebuch) und Waldbericht aktualisieren']],
];
function openSaison() {
  const m = new Date().getMonth();
  openPage('Saisonkalender', h('div', { class: 'wz-saison' },
    h('h3', {}, `Was ist im ${SAISON[m][0]} im Wald zu tun?`),
    h('ul', { class: 'wz-jetzt' }, SAISON[m][1].map((t) => h('li', {}, t))),
    h('details', { class: 'weitere-arten' }, h('summary', {}, 'Ganzes Jahr'),
      SAISON.map(([mon, tun], i) => h('div', { class: `wz-monat ${i === m ? 'jetzt' : ''}` }, h('strong', {}, mon), h('ul', {}, tun.map((t) => h('li', {}, t))))))));
}

// ---------- Seite ----------
export function openWanzenEcke() {
  const body = h('div', { class: 'wz' });
  const zeichne = () => {
    const d = daten(), a = aufgabeDerWoche(), m = new Date().getMonth();
    const erledigt = d.erledigt.includes(a.woche);
    fill(body,
      h('div', { class: 'wz-kopf' }, h('div', { class: 'wz-wanze', html: WANZE_SVG }), h('p', {}, 'Hallo! Hier gibt es jede Woche eine kleine Aufgabe für deinen Wald – und Abzeichen zum Sammeln.')),
      h('section', { class: 'kachel wz-aufgabe' }, h('p', { class: 'geo-kicker' }, `Aufgabe der Woche ${a.woche.slice(-2)}`), h('h3', {}, a.titel, erledigt ? ' ✓' : ''), h('p', {}, a.text),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => aufgabeStarten(a) }, erledigt ? 'Noch einmal' : 'Los geht’s'))),
      h('div', { class: 'wz-menue' },
        h('button', { type: 'button', class: 'kachel wz-knopf', onclick: () => openZaehler(null) }, h('strong', {}, 'Baumartenzähler'), h('small', {}, 'Bildkarten antippen und zählen')),
        h('button', { type: 'button', class: 'kachel wz-knopf', onclick: () => { bestimmen(null); store.update((s) => { s.wanze = { ...daten(), bestimmt: daten().bestimmt + 1 }; }); pruefeAbzeichen(); } }, h('strong', {}, 'Baum bestimmen'), h('small', {}, 'In wenigen Fragen zur Baumart')),
        h('button', { type: 'button', class: 'kachel wz-knopf', onclick: openQuiz }, h('strong', {}, 'Wanzen-Quiz'), h('small', {}, `Baumarten, Schädlinge, Pflege${d.quizBest ? ` · Bestwert ${d.quizBest}/8` : ''}`)),
        h('button', { type: 'button', class: 'kachel wz-knopf', onclick: openSaison }, h('strong', {}, 'Saisonkalender'), h('small', {}, `Was ist im ${SAISON[m][0]} zu tun?`))),
      h('section', { class: 'kachel' }, h('h3', {}, `Abzeichen ${d.abzeichen.length}/${ABZEICHEN.length}`),
        h('ul', { class: 'wz-abzeichen' }, ABZEICHEN.map(([k, l]) => h('li', { class: d.abzeichen.includes(k) ? 'hat' : '' }, h('span', { class: 'wz-orden', html: WANZE_SVG }), h('small', {}, l))))),
      d.zaehlungen.length ? h('section', { class: 'kachel' }, h('h3', {}, 'Deine Zählungen'),
        h('ul', { class: 'mat-kurz' }, [...d.zaehlungen].reverse().slice(0, 5).map((z) => h('li', {}, `${new Date(z.ts).toLocaleDateString('de-DE')}: ${Object.entries(z.arten).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).map(([k2, v]) => `${ARTEN.find((x) => x.k === k2)?.name} ${v}`).join(', ')}`)))) : null);
  };
  zeichne();
  const ab = store.subscribe(zeichne);
  openPage('Wanzen-Ecke', body, { onClose: ab });
}
