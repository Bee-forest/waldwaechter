// Pflege planen: Kulturpflege (Sicherung der Kultur), Jungwuchs- und Dickungspflege, Wertästung.
// Aufbau wie Pflanzung und Zaunbau: Art wählen → Fläche (ganzes Flurstück oder Teilfläche in der Karte,
// auch per GPS abgelaufen) → Bestand und Vorgehen → Ausführung und Kosten → Förderung → Termin.
// Förderung nach der Thüringer Richtlinie 2025 Teil A (A 2.2.1 f, A 2.3) bzw. dem Landesprogramm (nur Sicherung).
/* global L */
import { h, fill, openPage, toast } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { formatHa, areaHa } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { miniKarte } from './flaeche.js';
import { umlaufSteuerung, vereinfachen } from './umlauf.js';
import { passtFlurstueck } from './profi.js';
import { SPECIES } from './thinning/plan.js';
import { SAETZE } from './foerder-formular.js';

const euro = (v) => (v == null ? '–' : `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const zahl = (v) => { const s = String(v ?? '').trim().replace(',', '.'); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
const zt = (v, d = 2) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: d });

/** Pflegearten. kat = Förderkategorie (foerder-formular.js), satz = Festbetrag je ha */
export const PFLEGE_ARTEN = {
  sicherung: {
    label: 'Kulturpflege (Sicherung der Kultur)', kurz: 'Kulturpflege',
    text: 'Gras, Brombeere, Adlerfarn oder Stockausschläge zurücknehmen, damit die jungen Pflanzen nicht überwachsen werden – in den ersten Jahren nach der Pflanzung.',
    foerder: 'förderfähig in den ersten 5 Jahren nach der Pflanzung',
    monate: 'Juni bis August, vor der stärksten Verdämmung',
  },
  jungwuchs: {
    label: 'Jungwuchspflege', kurz: 'Jungwuchspflege',
    text: 'Junger Bestand bis etwa 2 m Mittelhöhe: Mischung regulieren, bedrängte Zielbaumarten freistellen, Vorwüchse und verdämmendes Weichlaubholz zurücknehmen.',
    foerder: 'förderfähig (Richtlinie Teil A)',
    monate: 'Spätsommer bis Winter (August bis März)',
  },
  dickung: {
    label: 'Dickungspflege (Jungbestandspflege)', kurz: 'Dickungspflege',
    text: 'Bestand über 2 m Mittelhöhe, Bäume unter 7 cm BHD: Protzen und Zwiesel entnehmen, Mischung und Standraum regulieren, Pflegepfade anlegen.',
    foerder: 'förderfähig bis 7 cm BHD (Richtlinie Teil A)',
    monate: 'Herbst und Winter (Oktober bis März), außerhalb der Brut- und Setzzeit',
  },
  wertastung: {
    label: 'Wertästung', kurz: 'Wertästung',
    text: 'An ausgewählten Zukunftsbäumen die unteren Äste sauber am Astring abschneiden – für astfreies, wertvolles Holz.',
    foerder: 'nicht förderfähig',
    monate: 'Nadelholz im Spätwinter vor dem Austrieb; Laubholz (Grünästung) im Sommer',
  },
};
// Ältere Einträge und Formularwerte auf die Pflegeart abbilden
export const PFLEGE_ALT = { Freischneiden: 'sicherung', Jungwuchspflege: 'jungwuchs', Jungbestandspflege: 'dickung', Wertastung: 'wertastung', Wertästung: 'wertastung' };
for (const [k, a] of Object.entries(PFLEGE_ARTEN)) PFLEGE_ALT[a.label] = k;

const VEGETATION = ['Gras / Reitgras', 'Brombeere / Himbeere', 'Adlerfarn', 'Stockausschläge / Weichlaubholz', 'Ginster', 'Mäuse (Wühlmaus, Rötelmaus)'];
const VERFAHREN_KULTUR = [
  ['freischneider', 'Freischneider (motormanuell)', 'Standard: schnell, auch bei Brombeere. Schnittschutz, Visier und Gehörschutz.'],
  ['manuell', 'Sense, Sichel oder Heppe', 'Schonend in kleinen Kulturen und direkt an den Pflanzen.'],
  ['treten', 'Niedertreten / Umknicken', 'Bei Adlerfarn und hohem Gras: wirkt länger als Abschneiden, Pflanzen bleiben beschattet.'],
  ['mulcher', 'Mulcher zwischen den Reihen', 'Nur bei Reihenpflanzung mit genug Reihenabstand und befahrbarem Boden.'],
];
const EINGRIFFE = [
  ['mischung', 'Mischwuchsregulierung', 'Seltene und konkurrenzschwache Zielbaumarten (z. B. Eiche, Tanne, Kirsche) freistellen.'],
  ['protzen', 'Protzen und Vorwüchse entnehmen', 'Sehr grobe, breitkronige Bäume, die die Nachbarn bedrängen.'],
  ['zwiesel', 'Zwiesel, kranke und beschädigte Bäume', 'Nur, wenn sie bessere Nachbarn bedrängen.'],
  ['weichlaub', 'Weichlaubholz zurücknehmen', 'Birke, Aspe, Weide nur dort köpfen oder entnehmen, wo sie Zielbäume peitschen oder überwachsen.'],
  ['standraum', 'Standraumregulierung', 'In sehr dichten Partien die Stammzahl verringern (z. B. bei Naturverjüngung).'],
  ['pfade', 'Pflegepfade anlegen', 'Alle 20–40 m einen schmalen Pfad freischneiden – daraus werden später die Rückegassen.'],
];
const AESTUNG = [
  ['2,5', 'Erste Stufe bis 2,5 m', 'vom Boden mit Astsäge'],
  ['6', 'Bis 6 m', 'zweite Stufe mit Stangensäge oder Leiter'],
  ['10', 'Bis 8–10 m', 'dritte Stufe, Steiggerät oder Hubarbeitsbühne'],
];
// Empfohlene Zahl der Z-Bäume je ha (Wertästung)
const Z_BAEUME = { Fichte: '150–200', Kiefer: '150–200', Lärche: '100–150', Douglasie: '100–150', Tanne: '150–200', Buche: '60–80', Eiche: '60–80', Bergahorn: '50–70', Esche: '50–70', Birke: '50–70', Erle: '50–70' };

export async function openPflegePlanung({ parcelId = null, foerdern = false, onSaved, onAbbruch = null, art = null } = {}) {
  let gespeichert = false;
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id] && passtFlurstueck(p));
  const s = {
    art, parcelId: parcelId || mine[0]?.id || null, teil: false, pts: [], kulturId: null,
    pflanzjahr: '', vegetation: [], verfahren: 'freischneider', umfang: 'pflanzen', durchgaenge: 1,
    mittelhoehe: '', bhd: '', species: 'Fichte', eingriffe: ['mischung', 'protzen'], stammzahl: '',
    zBaeume: '', hoehe: '2,5', aestungArt: 'trocken',
    ausfuehrung: 'eigen', preis: null, date: '', note: '',
  };
  const body = h('div', { class: 'zaun pflege' });
  const page = openPage('Pflege planen', body, { onClose: () => { umlauf?.stop(); karte?.remove(); if (!gespeichert) onAbbruch?.(); } });
  let karte = null, umlauf = null;
  const lyr = L.layerGroup();
  const mapEl = h('div', { class: 'mini-map zaun-map' });
  const status = h('p', { class: 'draw-status', 'aria-live': 'polite' });
  const umlaufHost = h('div');
  const teilHost = h('div');

  const flst = () => byId[s.parcelId] || null;
  const kulturen = () => (store.get().measures || []).filter((m) => m.type === 'pflanzung' && m.parcelId && m.parcelId === s.parcelId);
  const ha = () => (s.teil ? (s.pts.length >= 3 ? areaHa(s.pts) : 0) : (flst() ? amtlicheFlaecheHa(flst()) || 0 : 0));
  // Neu zeichnen, ohne dass die Seite nach oben springt
  const ruhig = (fn) => { const pb = body.closest('.page-body'); const y = pb?.scrollTop || 0; fn(); if (pb) pb.scrollTop = y; };

  function karteNeu() {
    umlauf?.stop(); karte?.remove();
    karte = miniKarte(mapEl, flst(), { zoom: 17 });
    karte.map.doubleClickZoom.disable();
    lyr.addTo(karte.map);
    karte.map.on('click', (e) => { if (!s.teil) return; s.pts.push([e.latlng.lat, e.latlng.lng]); zeichne(); navAkt(); });
    umlauf = umlaufSteuerung({ map: karte.map, text: 'Teilfläche umlaufen',
      onPunkt: (ll) => { s.pts.push(ll); zeichne(); },
      onEnde: () => { s.pts = vereinfachen(s.pts, 1.5); zeichne(); navAkt(); } });
    zeichne();
  }
  function zeichne() {
    lyr.clearLayers();
    if (s.teil) {
      if (s.pts.length >= 3) L.polygon(s.pts, { color: '#2E7D32', weight: 3, fillOpacity: 0.25, interactive: false }).addTo(lyr);
      else if (s.pts.length === 2) L.polyline(s.pts, { color: '#2E7D32', weight: 3, interactive: false }).addTo(lyr);
      s.pts.forEach((ll) => L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: '#2E7D32', fillOpacity: 1, interactive: false }).addTo(lyr));
      status.textContent = s.pts.length < 3 ? `${s.pts.length} von mindestens 3 Eckpunkten – tippe die Pflegefläche in die Karte oder lauf sie mit dem GPS ab.` : `Pflegefläche ${formatHa(areaHa(s.pts))} · ${s.pts.length} Eckpunkte`;
    } else status.textContent = flst() ? `Ganzes Flurstück: ${formatHa(ha())}` : 'Ohne Flurstück: Fläche unten von Hand eintragen.';
    fill(umlaufHost, s.teil ? umlauf?.el : null);
    fill(teilHost, s.teil ? h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.pts.pop(); zeichne(); navAkt(); } }, 'Letzten Punkt entfernen'),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => { s.pts = []; zeichne(); navAkt(); } }, 'Neu beginnen')) : null);
  }

  // Kultur übernehmen: Pflanzjahr und Pflanzfläche
  function kulturWaehlen(m) {
    s.kulturId = m?.id || null;
    if (m) {
      const t = m.finishedAt || m.date || m.createdAt;
      if (t) s.pflanzjahr = String(new Date(t).getFullYear());
      if (m.flaeche?.ring?.length >= 3) { s.teil = true; s.pts = m.flaeche.ring.map((x) => [...x]); karteVeraltet = true; }
    }
  }

  const chips = (liste, aktiv, onToggle, mehrfach = true) => h('div', { class: 'q-chips' }, liste.map((x) => {
    const [k, l] = Array.isArray(x) ? x : [x, x];
    const an = mehrfach ? aktiv.includes(k) : aktiv === k;
    return h('button', { type: 'button', class: `q-option ${an ? 'on' : ''}`, 'aria-pressed': String(an), onclick: () => { onToggle(k); ruhig(render); } }, l);
  }));
  const umschalten = (arr, k) => { const i = arr.indexOf(k); if (i >= 0) arr.splice(i, 1); else arr.push(k); };
  const feld = (label, key, { einheit = '', placeholder = '', inputmode = 'decimal', type = 'text', neu = true } = {}) => h('label', {}, label,
    h('span', { class: 'mit-einheit' }, h('input', { type, inputmode, value: s[key] ?? '', placeholder,
      oninput: (e) => { s[key] = e.target.value; }, onchange: () => { if (neu) ruhig(render); } }), einheit ? h('span', {}, einheit) : null));

  function hinweise() {
    const a = s.art, out = [];
    if (a === 'sicherung') {
      out.push('Nur so viel freischneiden wie nötig: um die Pflanzen (Trichter- oder Reihenpflege) statt ganzflächig – die Begleitvegetation schützt vor Hitze, Frost und Verbiss.');
      out.push('Vor dem Schneiden die Pflanzen markieren oder aufsuchen (z. B. mit Stab), damit sie nicht mit abgeschnitten werden.');
      if (s.vegetation.includes('Adlerfarn')) out.push('Adlerfarn: Niedertreten oder Knicken im Frühsommer wirkt länger als Abschneiden.');
      if (s.vegetation.includes('Brombeere / Himbeere')) out.push('Brombeere: Freischneider mit Dickichtmesser oder Kreissägeblatt; meist zweimal im Jahr nötig.');
      if (s.vegetation.includes('Mäuse (Wühlmaus, Rötelmaus)')) out.push('Mäuse: Gras kurz halten, Sitzkrücken für Greifvögel aufstellen; Fraßköder nur nach Prognose und Zulassung (Pflanzenschutz-Sachkunde).');
      out.push('Auf Bodenbrüter und Rehkitze achten: Fläche vorher langsam abgehen.');
    } else if (a === 'jungwuchs' || a === 'dickung') {
      out.push('Nur eingreifen, wo es nötig ist („negative Auslese“): Pflegeziel ist eine stabile, gemischte Dickung – nicht ein aufgeräumter Bestand.');
      out.push('Geschnittenes Material bleibt auf der Fläche (Nährstoffe, Schutz).');
      if (s.eingriffe.includes('pfade')) out.push('Pflegepfade vorher im Gelände markieren (Farbe oder Band), möglichst gerade und hangabwärts – sie werden später Rückegassen.');
      const mh = zahl(s.mittelhoehe);
      if (mh != null && a === 'jungwuchs' && mh > 2) out.push(`Bei ${zt(mh)} m Mittelhöhe ist es Dickungspflege – oben die Art wechseln.`);
      if (mh != null && a === 'dickung' && mh <= 2) out.push(`Bis 2 m Mittelhöhe ist es Jungwuchspflege – oben die Art wechseln.`);
      if (a === 'dickung' && zahl(s.bhd) >= 7) out.push('Ab 7 cm BHD ist es keine geförderte Dickungspflege mehr, sondern Erstdurchforstung.');
    } else if (a === 'wertastung') {
      out.push(`Nur Z-Bäume ästen: vital, gerade, gut bekront, ohne Schäden – ${s.species}: etwa ${Z_BAEUME[s.species] || '50–150'} je ha, gleichmäßig verteilt.`);
      out.push('Höchstens ein Drittel der grünen Krone wegnehmen; ideal bei 10–15 cm BHD, damit die Äste schnell überwallen.');
      out.push('Sauber am Astring schneiden, keine Stummel und keine Rindenverletzung. Z-Bäume dauerhaft markieren.');
      out.push('Ästung dokumentieren (Datum, Höhe, Bäume) – das steigert beim Verkauf den Wert.');
    }
    return out;
  }

  function foerderung() {
    const a = s.art, f = ha();
    if (!a || a === 'wertastung') return null;
    const satzG = a === 'sicherung' ? SAETZE.GANW.sicherung : SAETZE.GANW.jwp;
    const satzL = a === 'sicherung' ? SAETZE.LABE.sicherung : null;
    const jahr = Number(s.pflanzjahr), alt = jahr ? new Date().getFullYear() - jahr : null;
    const gruende = [];
    if (a === 'sicherung' && alt != null && alt > 5) gruende.push(`Die Kultur ist ${alt} Jahre alt – Sicherung der Kultur wird nur in den ersten fünf Jahren gefördert.`);
    if (a === 'dickung' && zahl(s.bhd) >= 7) gruende.push('Ab 7 cm BHD keine Förderung als Dickungspflege.');
    const g = f * satzG, l = satzL ? f * satzL : null;
    // Bagatellgrenze: Sicherung der Kultur allein 700 €, sonst 1.000 € (Landesprogramm 700 €)
    return { satzG, satzL, g, l, gruende, bagatelle: a === 'sicherung' ? 700 : 1000 };
  }

  function kosten() {
    if (s.ausfuehrung !== 'unternehmer' || !s.art) return null;
    // Kein vorgegebener Preis – den trägt man selbst ein (Angebot von FBG oder Unternehmer)
    const preis = s.preis;
    if (s.art === 'wertastung') {
      const n = zahl(s.zBaeume) || 0;
      return { preis, menge: n, summe: preis != null ? n * preis : null, einheit: 'Baum' };
    }
    const d = s.art === 'sicherung' ? Number(s.durchgaenge) || 1 : 1;
    return { preis, menge: ha(), summe: preis != null ? ha() * preis * d : null, durchgaenge: d, einheit: 'ha' };
  }

  // ---------- Schritte (wie bei der Durchforstung: Fortschrittsleiste oben, Weiter/Zurück unten) ----------
  const SCHRITTE = ['art', 'flaeche', 'bestand', 'ausfuehrung', 'foerderung', 'termin'];
  let schritt = s.art ? 1 : 0, zuletzt = null, karteVeraltet = true;
  const titel = (q) => ({ art: 'Welche Pflege?', flaeche: 'Wo wird gepflegt?', bestand: s.art === 'sicherung' ? 'Kultur und Bewuchs' : s.art === 'wertastung' ? 'Bäume und Ästungshöhe' : 'Bestand und Eingriff',
    ausfuehrung: 'Wer macht es?', foerderung: 'Förderung', termin: 'Termin und Notiz' })[q];
  const kulturHost = h('div');
  function kulturAuswahl() {
    const ks = s.art === 'sicherung' ? kulturen() : [];
    fill(kulturHost, ks.length ? h('div', {}, h('p', { class: 'sheet-label' }, 'Welche Pflanzung wird gepflegt?'),
      h('div', { class: 'q-chips' }, [...ks.map((m) => [m.id, `${m.details?.species || 'Pflanzung'}${m.date || m.finishedAt ? ` ${new Date(m.finishedAt || m.date).getFullYear()}` : ''}${m.flaeche?.ha ? `, ${formatHa(m.flaeche.ha)}` : ''}`]), ['', 'Andere / ältere Kultur']].map(([id, l]) =>
        h('button', { type: 'button', class: `q-option ${(s.kulturId || '') === id ? 'on' : ''}`, onclick: () => { kulturWaehlen(ks.find((m) => m.id === id) || null); if (!id) s.kulturId = null; ruhig(render); } }, l))),
      h('small', { class: 'muted' }, 'Pflanzjahr und Pflanzfläche werden übernommen.')) : null);
  }
  const flaecheEl = h('div', { class: 'form' },
    h('label', {}, 'Fläche', h('select', { onchange: (e) => { s.parcelId = e.target.value || null; s.pts = []; s.kulturId = null; kulturAuswahl(); karteNeu(); navAkt(); } },
      h('option', { value: '' }, 'ohne Flächenzuordnung'), mine.map((p) => h('option', { value: p.id, selected: p.id === s.parcelId }, `Flurstück ${p.nr}, ${p.gemarkung}`)))),
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Umfang der Fläche' },
      [[false, 'Ganzes Flurstück'], [true, 'Teilfläche einzeichnen']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.teil === k),
        onclick: (e) => { s.teil = k; e.currentTarget.parentElement.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-checked', String(i === (k ? 1 : 0)))); mapEl.classList.toggle('malt', k); zeichne(); navAkt(); } }, l))),
    kulturHost, mapEl, status, umlaufHost, teilHost);
  let nextBtn = null;
  const kannWeiter = (q) => (q === 'art' ? !!s.art : q === 'flaeche' ? (!s.teil || s.pts.length >= 3) : true);
  function navAkt() { if (nextBtn) nextBtn.disabled = !kannWeiter(SCHRITTE[schritt]); }

  function inhalt(q) {
    const A = PFLEGE_ARTEN[s.art] || {};
    const ks = kulturen();
    const f = foerderung(), k = kosten();
    const hw = hinweise();
    if (q === 'art') return [
      foerdern ? h('div', { class: 'lrt-hinweis ok' }, h('strong', {}, 'Mit Förderantrag'), h('p', {}, 'Nach dem Buchen geht es direkt mit dem Förderantrag weiter. Gefördert werden Kulturpflege, Jungwuchs- und Dickungspflege – die Wertästung nicht.')) : null,
      h('div', { class: 'q-cards' }, Object.entries(PFLEGE_ARTEN).map(([kk, a]) => h('button', { type: 'button', class: `q-option ${s.art === kk ? 'on' : ''}`, 'aria-pressed': String(s.art === kk),
        onclick: () => { if (s.art !== kk && (kk === 'wertastung' || s.art === 'wertastung')) s.preis = null; s.art = kk; ruhig(render); } },
        h('span', { class: 'q-text' }, h('strong', {}, a.label), h('small', {}, a.text), h('small', { class: kk === 'wertastung' ? 'muted' : 'pos' }, a.foerder)))))];
    if (q === 'flaeche') return [flaecheEl];
    if (q === 'bestand') return [
      s.art === 'sicherung' ? [
        feld('Jahr der Pflanzung', 'pflanzjahr', { inputmode: 'numeric', placeholder: 'z. B. 2024' }),
        h('p', { class: 'sheet-label' }, 'Was bedrängt die Pflanzen?'),
        chips(VEGETATION, s.vegetation, (x) => umschalten(s.vegetation, x)),
        h('p', { class: 'sheet-label' }, 'Wie wird gepflegt?'),
        h('div', { class: 'q-cards' }, VERFAHREN_KULTUR.map(([kk, l, t]) => h('button', { type: 'button', class: `q-option ${s.verfahren === kk ? 'on' : ''}`, onclick: () => { s.verfahren = kk; ruhig(render); } },
          h('span', { class: 'q-text' }, h('strong', {}, l), h('small', {}, t))))),
        h('p', { class: 'sheet-label' }, 'Umfang'),
        chips([['pflanzen', 'Nur um die Pflanzen / Reihen'], ['ganz', 'Ganzflächig']], s.umfang, (x) => { s.umfang = x; }, false),
        h('p', { class: 'sheet-label' }, 'Durchgänge in diesem Jahr'),
        chips([[1, '1× (Frühsommer)'], [2, '2× (Juni und August)']], s.durchgaenge, (x) => { s.durchgaenge = x; }, false),
      ] : null,
      s.art === 'jungwuchs' || s.art === 'dickung' ? [
        h('label', {}, 'Hauptbaumart', h('select', { onchange: (e) => { s.species = e.target.value; } }, SPECIES.map((o) => h('option', { selected: o === s.species }, o)))),
        feld('Mittelhöhe des Bestands', 'mittelhoehe', { einheit: 'm', placeholder: s.art === 'jungwuchs' ? 'bis 2' : 'über 2' }),
        s.art === 'dickung' ? feld('Stärkster BHD der Hauptbäume (ungefähr)', 'bhd', { einheit: 'cm', placeholder: 'unter 7' }) : null,
        feld('Stammzahl je ha (geschätzt, optional)', 'stammzahl', { inputmode: 'numeric', placeholder: 'z. B. 8000', neu: false }),
        h('p', { class: 'sheet-label' }, 'Was wird gemacht?'),
        h('div', { class: 'q-cards' }, EINGRIFFE.map(([kk, l, t]) => { const an = s.eingriffe.includes(kk); return h('button', { type: 'button', class: `q-option ${an ? 'on' : ''}`, 'aria-pressed': String(an), onclick: () => { umschalten(s.eingriffe, kk); ruhig(render); } },
          h('span', { class: 'q-text' }, h('strong', {}, l), h('small', {}, t))); })),
      ] : null,
      s.art === 'wertastung' ? [
        h('label', {}, 'Baumart', h('select', { onchange: (e) => { s.species = e.target.value; ruhig(render); } }, SPECIES.map((o) => h('option', { selected: o === s.species }, o)))),
        feld('Anzahl Z-Bäume', 'zBaeume', { inputmode: 'numeric', placeholder: ha() ? `z. B. ${Math.round(ha() * (parseInt(Z_BAEUME[s.species], 10) || 100))}` : 'Stück' }),
        h('p', { class: 'sheet-label' }, 'Ästungshöhe'),
        h('div', { class: 'q-cards' }, AESTUNG.map(([kk, l, t]) => h('button', { type: 'button', class: `q-option ${s.hoehe === kk ? 'on' : ''}`, onclick: () => { s.hoehe = kk; ruhig(render); } },
          h('span', { class: 'q-text' }, h('strong', {}, l), h('small', {}, t))))),
        chips([['trocken', 'Trockenästung (tote Äste)'], ['gruen', 'Grünästung (lebende Äste)']], s.aestungArt, (x) => { s.aestungArt = x; }, false),
      ] : null,
      hw.length ? h('div', { class: 'lrt-hinweis' }, h('strong', {}, 'So geht es fachgerecht'), h('ul', {}, hw.map((t) => h('li', {}, t)))) : null,

    ];
    if (q === 'ausfuehrung') return [
      chips([['eigen', 'Ich selbst (Eigenleistung)'], ['unternehmer', 'Forstunternehmer / FBG']], s.ausfuehrung, (x) => { s.ausfuehrung = x; }, false),
      s.ausfuehrung === 'eigen' ? h('p', { class: 'hint' }, `Eigenleistung ist förderfähig – der Festbetrag je ha wird auch gezahlt, wenn du selbst arbeitest. ${s.art === 'dickung' || s.art === 'jungwuchs' ? 'Rechne mit etwa 15–20 Arbeitsstunden je ha. ' : ''}Arbeite nie allein mit Motorsäge oder Freischneider; Schutzausrüstung tragen.`) : null,
      k ? h('div', { class: 'calc-box' },
        h('label', {}, `Preis je ${k.einheit === 'ha' ? `ha${k.durchgaenge > 1 ? ' und Durchgang' : ''}` : 'Baum'} (netto)`, h('span', { class: 'mit-einheit' }, h('input', { type: 'text', inputmode: 'decimal', value: k.preis != null ? String(k.preis).replace('.', ',') : '', placeholder: 'Preis laut Angebot',
          onchange: (e) => { const v = zahl(e.target.value); s.preis = v; ruhig(render); } }), h('span', {}, '€'))),
        h('small', { class: 'muted' }, 'Trag den Preis aus dem Angebot deiner FBG oder des Unternehmers ein.'),
        k.preis == null ? null : k.einheit === 'ha'
          ? h('small', {}, `${formatHa(k.menge)} × ${euro(k.preis)}${k.durchgaenge > 1 ? ` × ${k.durchgaenge} Durchgänge` : ''} = `, h('b', {}, euro(k.summe)))
          : h('small', {}, `${zt(k.menge, 0)} Bäume × ${euro(k.preis)} = `, h('b', {}, euro(k.summe)))) : null,

    ];
    if (q === 'foerderung') return [
      s.art === 'wertastung'
        ? h('p', { class: 'muted' }, 'Wertästung wird in Thüringen nicht gefördert.')
        : h('div', { class: 'calc-box foerder-box' },
          h('small', {}, `Richtlinie Teil A (${s.art === 'sicherung' ? 'A 2.2.1 f Sicherung der Kultur' : 'A 2.3 Jungwuchs- und Dickungspflege'}): ${euro(f.satzG)} je ha → `, h('b', {}, ha() ? euro(f.g) : '–')),
          f.satzL ? h('small', {}, `Landesprogramm (bis 20 ha Waldbesitz, Schadfläche): ${euro(f.satzL)} je ha → `, h('b', {}, ha() ? euro(f.l) : '–')) : h('small', { class: 'muted' }, 'Im Landesprogramm wird keine Jungwaldpflege gefördert.'),
          ha() && f.g < f.bagatelle && !(f.l >= 700) ? h('small', { class: 'warn-line' }, `Unter der Bagatellgrenze von ${euro(f.bagatelle)} – mit weiteren Maßnahmen (z. B. Pflanzung, Zaun) in einem Antrag kombinieren.`) : null,
          f.gruende.map((t) => h('small', { class: 'warn-line' }, t)),
          k?.summe != null ? h('small', {}, 'Eigenanteil nach Förderung (Richtlinie): ', h('b', {}, euro(Math.max(0, k.summe - f.g)))) : null,
          h('small', { class: 'hint' }, `${s.art === 'sicherung' ? 'Jedes Jahr ein eigener Antrag, höchstens fünf Mal je Kultur. ' : 'Nur über die Richtlinie Teil A. '}Erst nach dem Bewilligungsbescheid beginnen. Fördersätze bitte bei FBG oder Forstamt prüfen.`)),

    ];
    return [
      h('p', { class: 'muted' }, `Beste Zeit: ${A.monate}.`),
      h('label', {}, 'Geplanter Termin', h('input', { type: 'date', value: s.date, onchange: (e) => { s.date = e.target.value; } })),
      h('label', {}, 'Notiz', h('textarea', { rows: 3, value: s.note, oninput: (e) => { s.note = e.target.value; } })),
    ];
  }

  function render() {
    const q = SCHRITTE[schritt];
    nextBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large', disabled: !kannWeiter(q),
      onclick: () => { if (!kannWeiter(q)) return; if (schritt === SCHRITTE.length - 1) speichern(); else { schritt++; render(); } } }, schritt === SCHRITTE.length - 1 ? 'Pflege buchen' : 'Weiter');
    const zurueck = h('button', { type: 'button', class: 'btn', onclick: () => { if (schritt === 0) page.close(); else { schritt--; render(); } } }, schritt === 0 ? 'Abbrechen' : 'Zurück');
    fill(body,
      h('div', { class: 'q-progress', 'aria-label': `Schritt ${schritt + 1} von ${SCHRITTE.length}` }, SCHRITTE.map((_, i) => h('span', { class: i < schritt ? 'done' : i === schritt ? 'now' : '' }))),
      s.art && schritt > 0 ? h('p', { class: 'sheet-label' }, `${PFLEGE_ARTEN[s.art].label}${ha() && schritt > 1 ? ` · ${formatHa(ha())}` : ''}`) : null,
      h('h2', { class: 'step-title' }, titel(q)),
      h('div', { class: 'polter-inhalt' }, inhalt(q)),
      h('div', { class: 'q-nav' }, zurueck, nextBtn));
    if (q === 'flaeche') {
      kulturAuswahl();
      flaecheEl.querySelectorAll('.segmented button').forEach((b, i) => b.setAttribute('aria-checked', String(i === (s.teil ? 1 : 0)))); mapEl.classList.toggle('malt', s.teil);
      if (!karte || karteVeraltet) { karteVeraltet = false; setTimeout(karteNeu, 0); }
      else setTimeout(() => karte.map.invalidateSize(), 0);
    }
    if (q !== zuletzt) { zuletzt = q; body.closest('.page-body')?.scrollTo?.(0, 0); }
  }

  function speichern() {
    if (!s.art) { toast('Bitte die Art der Pflege wählen.'); return; }
    if (s.teil && s.pts.length < 3) { toast('Bitte mindestens 3 Eckpunkte der Pflegefläche einzeichnen.'); return; }
    const A = PFLEGE_ARTEN[s.art], f = ha(), k = kosten();
    const vorgehen = s.art === 'sicherung'
      ? [VERFAHREN_KULTUR.find((x) => x[0] === s.verfahren)?.[1], s.umfang === 'ganz' ? 'ganzflächig' : 'um die Pflanzen', `${s.durchgaenge}× im Jahr`, s.vegetation.length ? `gegen ${s.vegetation.join(', ')}` : ''].filter(Boolean).join(', ')
      : s.art === 'wertastung' ? `${s.zBaeume || '?'} Z-Bäume, ${AESTUNG.find((x) => x[0] === s.hoehe)?.[1]}, ${s.aestungArt === 'gruen' ? 'Grünästung' : 'Trockenästung'}`
        : s.eingriffe.map((x) => EINGRIFFE.find((y) => y[0] === x)?.[1]).filter(Boolean).join(', ');
    const neuId = uid();
    store.update((st) => st.measures.push({
      id: neuId, type: 'pflege', parcelId: s.parcelId, date: s.date ? new Date(s.date).getTime() : null, status: 'geplant', createdAt: Date.now(), note: s.note.trim(),
      details: { art: A.label, area: f ? String(Math.round(f * 100) / 100).replace('.', ',') : '', vorgehen, species: s.art === 'sicherung' ? '' : s.species, mittelhoehe: s.mittelhoehe, pflanzjahr: s.pflanzjahr, zBaeume: s.zBaeume, ausfuehrung: s.ausfuehrung === 'eigen' ? 'Eigenleistung' : 'Unternehmer' },
      ...(s.teil ? { flaeche: { ring: [...s.pts], ha: f } } : {}),
      pflege: { art: s.art, kulturId: s.kulturId, pflanzjahr: s.pflanzjahr, vegetation: s.vegetation, verfahren: s.verfahren, umfang: s.umfang, durchgaenge: s.durchgaenge,
        mittelhoehe: s.mittelhoehe, bhd: s.bhd, eingriffe: s.eingriffe, stammzahl: s.stammzahl, zBaeume: s.zBaeume, hoehe: s.hoehe, aestungArt: s.aestungArt, vorgehen },
      kosten: k?.summe != null ? Math.round(k.summe * 100) / 100 : null,
    }));
    toast(`${A.kurz} gebucht${f ? `: ${formatHa(f)}` : ''}`);
    gespeichert = true;
    page.close();
    onSaved?.(neuId);
  }
  render();
  return page;
}
