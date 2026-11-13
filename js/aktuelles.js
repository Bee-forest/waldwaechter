// Reiter 4: Aktuelles – Holzpreise, Waldbrandgefahr für die eigene Region, FBG-Termine, Austausch.
import { h, fill, icon, openPage, dialog, confirmDialog, toast, fmtDate } from './ui.js';
import { store, uid } from './store.js';
import { kopfInhalt } from './home.js';
import { centroid, polysOf, distance } from './geo.js';

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const monatText = (ym) => { const [y, m] = String(ym || '').split('-').map(Number); return y && m ? `${MONATE[m - 1]} ${y}` : ''; };
const preisText = (s) => (s.von === s.bis ? `${s.von}` : `${s.von}–${s.bis}`) + ` ${s.einheit}`;

let root;
let preise = null, termineFbg = null, wbi = null, wbiFehler = false, wbiLaedt = false;

export function initAktuelles(el) {
  root = el;
  render();
  store.subscribe(render);
  ladePreise(); ladeTermine();
  // Waldbrandgefahr erst laden, wenn der Reiter geöffnet wird (spart Daten beim App-Start)
  const beob = new MutationObserver(() => { if (!root.hidden && !wbi && !wbiLaedt && !wbiFehler) ladeWbi(); });
  beob.observe(root, { attributes: true, attributeFilter: ['hidden'] });
  if (!root.hidden) ladeWbi();
}

async function ladeJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function ladePreise() { try { preise = await ladeJson('./data/holzpreise.json'); if (!Array.isArray(preise?.baumarten)) throw new Error('leer'); } catch { preise = { fehler: true }; } render(); }
async function ladeTermine() { try { termineFbg = (await ladeJson('./data/fbg-termine.json')).termine || []; } catch { termineFbg = []; } render(); }

function render() {
  fill(root,
    h('header', { class: 'card app-head' }, kopfInhalt()),
    h('div', { class: 'view-head akt-kopf' }, h('h1', {}, 'Aktuelles')),
    waldbrandKachel(),
    holzpreisKachel(),
    termineKachel(),
    communityKachel(),
  );
}

// ---------- Holzpreise ----------
const HIGHLIGHTS = [['Fichte', 'Stammholz lang (> 10 m)'], ['Kiefer', 'Stammholzabschnitte'], ['Buche', 'Stammholz'], ['Eiche', 'Stammholz']];
function holzpreisKachel() {
  if (!preise) return h('section', { class: 'kachel' }, h('h2', { class: 'kachel-titel' }, 'Holzpreise'), h('p', { class: 'muted' }, 'Wird geladen …'));
  if (preise.fehler) return h('section', { class: 'kachel' }, h('h2', { class: 'kachel-titel' }, 'Holzpreise'), h('p', { class: 'muted' }, 'Die Holzpreise konnten gerade nicht geladen werden.'));
  const zeilen = HIGHLIGHTS.map(([art, sort]) => {
    const b = preise.baumarten.find((x) => x.art === art);
    const s = b?.sortimente.find((x) => x.sortiment === sort);
    return s ? { art, s } : null;
  }).filter(Boolean);
  return h('section', { class: 'kachel' },
    h('button', { class: 'akt-kachel-btn', onclick: openHolzpreise, 'aria-label': 'Alle Holzpreise anzeigen' },
      h('div', { class: 'akt-titelzeile' }, h('h2', { class: 'kachel-titel' }, 'Holzpreise'), h('span', { class: 'akt-stand' }, `Stand ${monatText(preise.stand)}`)),
      h('ul', { class: 'akt-preise' }, zeilen.map(({ art, s }) => h('li', {},
        h('span', {}, h('strong', {}, art), ' ', h('small', { class: 'muted' }, [s.sortiment, s.guete, s.staerke].filter(Boolean).join(' · '))),
        h('strong', {}, preisText(s))))),
      h('span', { class: 'akt-mehr' }, 'Alle Baumarten und Sortimente', h('span', { html: icon.chevron }))));
}

function openHolzpreise() {
  const p = preise;
  openPage('Holzpreise', h('div', { class: 'akt-seite' },
    h('div', { class: 'kachel' },
      h('p', {}, h('strong', {}, p.titel), ` – Stand ${monatText(p.stand)}`),
      h('p', { class: 'muted' }, p.hinweis),
      p.quelle ? h('p', {}, h('a', { href: p.quelle.url, target: '_blank', rel: 'noopener' }, `Quelle: ${p.quelle.titel}`)) : null),
    p.baumarten.map((b, i) => h('details', { class: 'kachel akt-art', open: i === 0 },
      h('summary', {}, h('strong', {}, b.art), h('small', { class: 'muted' }, `${b.sortimente.length} Sortiment${b.sortimente.length === 1 ? '' : 'e'}`)),
      h('table', { class: 'akt-tabelle' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Sortiment'), h('th', {}, 'Güte'), h('th', {}, 'Stärke'), h('th', { class: 'zahl' }, 'Preis'))),
        h('tbody', {}, b.sortimente.map((s) => h('tr', {},
          h('td', {}, s.sortiment, s.stand && s.stand !== p.stand ? h('small', { class: 'muted' }, ` (Stand ${monatText(s.stand)})`) : null),
          h('td', {}, s.guete || '–'), h('td', {}, s.staerke || '–'), h('td', { class: 'zahl' }, preisText(s)))))))),
    h('p', { class: 'muted akt-fuss' }, 'Fm = Festmeter, Rm = Raummeter. Stärkeklasse nach Mittendurchmesser (z. B. 2b = 25–29 cm). Preise ohne Mehrwertsteuer.')));
}

// ---------- Waldbrandgefahr (Waldbrandgefahrenindex des DWD) ----------
// Stationswerte des DWD-Waldbrandgefahrenindex, täglich vom DWD übernommen (ArcGIS-Dienst „DWD“).
const WBI_URL = 'https://services2.arcgis.com/7wuv6DH7DYhDuwvU/ArcGIS/rest/services/DWD/FeatureServer/3/query?where=1%3D1&outFields=Stationsname,Bundesland,geoBreite,geoLaenge,wbi_tag,tag,aktualisierung_DWD&returnGeometry=false&f=json';
const WBI_CACHE = 'waldwaechter.wbi';
const STUFEN = {
  1: { l: 'sehr geringe Gefahr', farbe: '#F7F3B5', ink: '#5B5300' },
  2: { l: 'geringe Gefahr', farbe: '#F5D76E', ink: '#5B4300' },
  3: { l: 'mittlere Gefahr', farbe: '#F0A23B', ink: '#4A2600' },
  4: { l: 'hohe Gefahr', farbe: '#D9531E', ink: '#fff' },
  5: { l: 'sehr hohe Gefahr', farbe: '#8E1B10', ink: '#fff' },
};
const VERHALTEN = {
  1: 'Rauchen und offenes Feuer sind im Wald trotzdem ganzjährig verboten.',
  2: 'Rauchen und offenes Feuer sind im Wald ganzjährig verboten. Nicht auf trockenem Gras parken.',
  3: 'Kein Feuer, keine Zigaretten, nicht auf trockenem Gras parken. Waldwege für die Feuerwehr freihalten.',
  4: 'Hohe Gefahr: Grillplätze können gesperrt werden. Bei Arbeiten mit Maschinen Funkenflug vermeiden und Löschmittel mitführen.',
  5: 'Sehr hohe Gefahr: Wälder können gesperrt werden. Arbeiten im Wald möglichst verschieben. Rauch sofort über 112 melden.',
};

function region() {
  const ps = (store.get().parcels || []).filter((p) => polysOf(p).length);
  const wald = ps.filter((p) => (p.category || 'Wald') === 'Wald');
  const wahl = wald.length ? wald : ps;
  if (!wahl.length) return { pt: [50.9, 11.03], name: 'Thüringen (Mitte)', eigene: false };
  const pts = wahl.map((p) => centroid(polysOf(p)[0][0]));
  const pt = [pts.reduce((s, x) => s + x[0], 0) / pts.length, pts.reduce((s, x) => s + x[1], 0) / pts.length];
  const gem = [...new Set(wahl.map((p) => p.gemarkung).filter(Boolean))];
  return { pt, name: gem.length ? gem.slice(0, 2).join(', ') + (gem.length > 2 ? ' …' : '') : 'deine Flächen', eigene: true };
}

async function ladeWbi() {
  wbiLaedt = true; wbiFehler = false;
  try { const c = JSON.parse(localStorage.getItem(WBI_CACHE) || 'null'); if (c?.features) wbi = { ...c, ausCache: true }; } catch { /* leer */ }
  render();
  try {
    const r = await fetch(WBI_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    if (!Array.isArray(j.features) || !j.features.length) throw new Error('leer');
    const features = j.features.map((f) => f.attributes).filter((a) => Number.isFinite(a.geoBreite) && Number.isFinite(a.geoLaenge) && a.wbi_tag);
    wbi = { features, geholt: Date.now() };
    try { localStorage.setItem(WBI_CACHE, JSON.stringify(wbi)); } catch { /* Speicher voll */ }
  } catch { if (!wbi) wbiFehler = true; }
  wbiLaedt = false;
  render();
}

function waldbrandKachel() {
  const reg = region();
  const links = h('p', { class: 'akt-links' },
    h('a', { href: 'https://www.dwd.de/DE/leistungen/waldbrandgef/waldbrandgef.html', target: '_blank', rel: 'noopener' }, 'Karte beim DWD'), ' · ',
    h('a', { href: 'https://www.thueringenforst.de/', target: '_blank', rel: 'noopener' }, 'ThüringenForst'));
  const kopf = h('div', { class: 'akt-titelzeile' }, h('h2', { class: 'kachel-titel' }, 'Waldbrandgefahr'), h('span', { class: 'akt-stand' }, reg.name));
  if (!wbi) return h('section', { class: 'kachel' }, kopf,
    h('p', { class: 'muted' }, wbiFehler ? 'Die Waldbrandgefahr konnte gerade nicht abgerufen werden. Schau beim DWD oder bei ThüringenForst nach.' : 'Wird geladen …'),
    wbiFehler ? h('button', { class: 'btn btn-small', onclick: ladeWbi }, 'Erneut versuchen') : null, links);
  const naechste = wbi.features.map((a) => ({ a, d: distance(reg.pt, [a.geoBreite, a.geoLaenge]) })).sort((x, y) => x.d - y.d)[0];
  if (!naechste) return h('section', { class: 'kachel' }, kopf, h('p', { class: 'muted' }, 'Keine Station in der Nähe gefunden.'), links);
  const { a, d } = naechste;
  const stufe = Math.max(1, Math.min(5, Math.round(Number(a.wbi_tag))));
  const st = STUFEN[stufe];
  const tag = a.tag ? new Date(a.tag) : null;
  const alt = tag && (Date.now() - tag.getTime()) > 2 * 86400000;
  return h('section', { class: 'kachel akt-wbi' }, kopf,
    h('div', { class: 'akt-wbi-stufe', style: `--wbi:${st.farbe};--wbi-ink:${st.ink}` },
      h('span', { class: 'akt-wbi-zahl' }, String(stufe)),
      h('div', {}, h('strong', {}, `Stufe ${stufe}: ${st.l}`),
        h('small', {}, `DWD-Station ${a.Stationsname} (${Math.round(d / 1000)} km entfernt)${tag ? ` · ${fmtDate(tag)}` : ''}`))),
    h('ol', { class: 'akt-wbi-skala', 'aria-label': 'Gefahrenstufen 1 bis 5' }, [1, 2, 3, 4, 5].map((n) => h('li', { class: n === stufe ? 'an' : '', style: `background:${STUFEN[n].farbe}`, title: STUFEN[n].l }, String(n)))),
    alt ? h('p', { class: 'fin-alarm' }, `Der letzte Wert ist vom ${fmtDate(tag)}. Außerhalb der Waldbrandsaison meldet der DWD nicht immer täglich – im Zweifel beim Forstamt nachfragen.`) : null,
    wbi.ausCache && wbiLaedt ? h('p', { class: 'muted' }, 'Gespeicherter Stand – wird aktualisiert …') : null,
    h('p', {}, VERHALTEN[stufe]),
    h('p', { class: 'muted' }, reg.eigene ? 'Berechnet für die Mitte deiner Waldflächen. Verbindlich ist die vom zuständigen Forstamt ausgerufene Waldbrandgefahrenstufe.' : 'Leg Flurstücke an, dann zeigt die App die Gefahr für deine Region. Verbindlich ist die Stufe des zuständigen Forstamts.'),
    links);
}

// ---------- FBG-Termine ----------
function termineKachel() {
  const fbg = String(store.get().profile?.fbg || '').trim();
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const vonFbg = (termineFbg || []).filter((t) => !fbg || !t.fbg || norm(t.fbg).includes(norm(fbg)) || norm(fbg).includes(norm(t.fbg))).map((t) => ({ ...t, quelle: 'fbg' }));
  const eigene = (store.get().termine || []).map((t) => ({ ...t, quelle: 'eigen' }));
  const heute = new Date().toISOString().slice(0, 10);
  const alle = [...vonFbg, ...eigene].filter((t) => (t.datum || '') >= heute).sort((x, y) => `${x.datum}${x.zeit || ''}`.localeCompare(`${y.datum}${y.zeit || ''}`));
  return h('section', { class: 'kachel' },
    h('div', { class: 'akt-titelzeile' }, h('h2', { class: 'kachel-titel' }, 'FBG-Termine'), fbg ? h('span', { class: 'akt-stand' }, fbg) : null),
    !fbg ? h('p', { class: 'muted' }, 'Trag im Profil deine Forstbetriebsgemeinschaft ein, dann siehst du hier ihre Termine.') : null,
    termineFbg === null ? h('p', { class: 'muted' }, 'Wird geladen …')
      : alle.length ? h('ul', { class: 'akt-termine' }, alle.slice(0, 8).map(terminZeile))
      : h('p', { class: 'muted' }, fbg ? `Für ${fbg} sind noch keine Termine hinterlegt.` : 'Keine anstehenden Termine.'),
    h('button', { class: 'btn btn-block', onclick: () => terminBearbeiten() }, h('span', { html: icon.plus }), 'Eigenen Termin eintragen'));
}
function terminZeile(t) {
  const d = new Date(`${t.datum}T12:00:00`);
  return h('li', { class: 'akt-termin' },
    h('div', { class: 'akt-datum' }, h('strong', {}, String(d.getDate())), h('small', {}, MONATE[d.getMonth()].slice(0, 3))),
    h('div', { class: 'akt-termin-text' },
      h('strong', {}, t.titel),
      h('small', { class: 'muted' }, [t.zeit ? `${t.zeit} Uhr` : null, t.ort, t.quelle === 'fbg' ? (t.fbg || 'FBG') : 'eigener Termin'].filter(Boolean).join(' · ')),
      t.text ? h('small', {}, t.text) : null,
      h('div', { class: 'akt-termin-aktionen' },
        h('button', { class: 'link-btn', onclick: () => icsLaden(t) }, 'In den Kalender'),
        t.link ? h('a', { href: t.link, target: '_blank', rel: 'noopener' }, 'Mehr') : null,
        t.quelle === 'eigen' ? h('button', { class: 'link-btn', onclick: () => terminBearbeiten(t) }, 'Bearbeiten') : null)));
}
async function terminBearbeiten(alt = null) {
  const t = { titel: '', datum: new Date().toISOString().slice(0, 10), zeit: '', ort: '', text: '', ...(alt || {}) };
  const feld = (l, k, typ = 'text') => h('label', {}, l, h('input', { type: typ, value: t[k] || '', oninput: (e) => { t[k] = e.target.value; } }));
  const w = await dialog({
    title: alt ? 'Termin bearbeiten' : 'Eigener Termin',
    body: h('div', { class: 'form' }, feld('Was?', 'titel'), h('div', { class: 'form-row' }, feld('Datum', 'datum', 'date'), feld('Uhrzeit', 'zeit', 'time')), feld('Wo?', 'ort'), feld('Notiz', 'text')),
    actions: [...(alt ? [{ label: 'Löschen', value: 'weg' }] : []), { label: 'Abbrechen', value: null }, { label: 'Speichern', value: 'ok', primary: true }],
  });
  if (w === 'weg') { if (await confirmDialog('Termin löschen?', { ok: 'Löschen', danger: true })) store.update((s) => { s.termine = (s.termine || []).filter((x) => x.id !== alt.id); }); return; }
  if (w !== 'ok') return;
  if (!t.titel.trim() || !t.datum) { toast('Bitte mindestens „Was?“ und ein Datum eintragen.'); return; }
  const eintrag = { id: alt?.id || uid(), titel: t.titel.trim(), datum: t.datum, zeit: t.zeit, ort: t.ort.trim(), text: t.text.trim() };
  store.update((s) => { s.termine = s.termine || []; const i = s.termine.findIndex((x) => x.id === eintrag.id); if (i >= 0) s.termine[i] = eintrag; else s.termine.push(eintrag); });
}
function icsLaden(t) {
  const esc = (s) => String(s || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const d = t.datum.replace(/-/g, '');
  let start, ende;
  if (t.zeit) { const [hh, mm] = t.zeit.split(':'); start = `DTSTART:${d}T${hh}${mm}00`; ende = `DTEND:${d}T${String(Math.min(23, Number(hh) + 2)).padStart(2, '0')}${mm}00`; }
  else { const n = new Date(`${t.datum}T12:00:00`); n.setDate(n.getDate() + 1); start = `DTSTART;VALUE=DATE:${d}`; ende = `DTEND;VALUE=DATE:${n.toISOString().slice(0, 10).replace(/-/g, '')}`; }
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Waldwaechter//DE', 'BEGIN:VEVENT', `UID:${t.id || uid()}@waldwaechter`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, start, ende,
    `SUMMARY:${esc(t.titel)}`, t.ort ? `LOCATION:${esc(t.ort)}` : null, t.text ? `DESCRIPTION:${esc(t.text)}` : null, 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = h('a', { href: url, download: `${t.titel.replace(/[^\wäöüÄÖÜß -]/g, '').slice(0, 40) || 'termin'}.ics` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ---------- Community ----------
function communityKachel() {
  return h('section', { class: 'kachel akt-community' },
    h('h2', { class: 'kachel-titel' }, 'Community und Austausch'),
    h('p', {}, 'Hier kannst du dich bald mit anderen Waldbesitzerinnen und Waldbesitzern austauschen: Fragen stellen, Erfahrungen teilen, Unternehmer und Pflanzen empfehlen.'),
    h('ul', { class: 'soon-list' }, ['Fragen und Antworten nach Themen (Pflanzung, Käfer, Holzverkauf …)', 'Beiträge aus deiner Region und deiner FBG', 'Fotos aus dem Wald teilen'].map((x) => h('li', {}, x))),
    h('p', { class: 'muted' }, 'Für den Austausch braucht die App einen Server mit Anmeldung – daran arbeiten wir.'));
}
