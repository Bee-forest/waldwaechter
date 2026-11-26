// Holzernte: Bäume auszeichnen ohne Vorgaben. Je Baum die Durchmesserstufe antippen – der Zähler
// rechnet die Menge mit und ein GPS-Punkt hält fest, wo der Baum steht. Am Ende: Übersicht,
// Sortimente, Mengen je Sortiment, Preise und Kalkulation, Arbeitsauftrag mit Karte.
import { h, fill, openPage, toast, confirmDialog } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { miniKarte, flaecheVon } from './flaeche.js';
import { polysOf, formatHa } from './geo.js';

export const STUFEN = [
  { k: 's1', label: '7–15 cm', mitte: 11, farbe: '#8FB35A' },
  { k: 's2', label: '15–25 cm', mitte: 20, farbe: '#4F8A3A' },
  { k: 's3', label: '25–35 cm', mitte: 30, farbe: '#D9A21B' },
  { k: 's4', label: '35–50 cm', mitte: 42.5, farbe: '#C8661E' },
  { k: 's5', label: '50–60 cm', mitte: 55, farbe: '#A8432A' },
  { k: 's6', label: '60–70 cm', mitte: 65, farbe: '#7E2A1E' },
  { k: 's7', label: '70–80 cm', mitte: 75, farbe: '#6B3A6E' },
  { k: 's8', label: '80–90 cm', mitte: 85, farbe: '#3E3F86' },
];
// Näherungswerte: Volumen je Baum in Vorratsfestmeter mit Rinde (Vfm m.R.) für den Stufenmittelwert,
// angelehnt an übliche Massentafeln bei mittlerer Wuchsleistung. Nur zur Orientierung beim Auszeichnen.
export const BAUMARTEN = {
  avg: { name: 'Durchschnitt', v: null },
  fi: { name: 'Fichte', v: [0.07, 0.33, 0.85, 1.75, 3.0], nadel: true },
  ki: { name: 'Kiefer', v: [0.06, 0.28, 0.72, 1.5, 2.6], nadel: true },
  lae: { name: 'Lärche', v: [0.06, 0.30, 0.78, 1.6, 2.7], nadel: true },
  dgl: { name: 'Douglasie', v: [0.07, 0.36, 0.95, 1.95, 3.3], nadel: true },
  bu: { name: 'Buche', v: [0.06, 0.30, 0.80, 1.7, 2.9] },
  ei: { name: 'Eiche', v: [0.05, 0.27, 0.75, 1.6, 2.8] },
  elb: { name: 'Ahorn / Esche', v: [0.06, 0.29, 0.76, 1.6, 2.75] },
  wlb: { name: 'Birke / Weichlaub', v: [0.05, 0.24, 0.62, 1.3, 2.2] },
};
// Starke Stufen (60–90 cm) aus dem 55-cm-Wert hochgerechnet (Volumen etwa ~ BHD^2,3)
Object.values(BAUMARTEN).forEach((b) => { if (b.v) b.v.push(...[65, 75, 85].map((d) => Math.round(b.v[4] * (d / 55) ** 2.3 * 100) / 100)); });
const DURCHSCHNITT = STUFEN.map((_, i) => i).map((i) => ['fi', 'ki', 'bu', 'ei'].reduce((s, k) => s + BAUMARTEN[k].v[i], 0) / 4);
const EFM = 0.8; // Vfm m.R. → Erntefestmeter ohne Rinde (Rinde und Ernteverlust ca. 20 %)
export const vfm = (stufe, ba) => (BAUMARTEN[ba]?.v || DURCHSCHNITT)[STUFEN.findIndex((s) => s.k === stufe)] || 0;
export const efm = (stufe, ba) => vfm(stufe, ba) * EFM;

// Sortimente und grobe Anteile je Durchmesserstufe (Stammholz / Industrieholz / Rest für Brenn- oder Energieholz)
export const SORTIMENTE = [
  { k: 'stamm', name: 'Stammholz (Abschnitte / lang)' },
  { k: 'industrie', name: 'Industrieholz' },
  { k: 'brenn', name: 'Brennholz' },
  { k: 'energie', name: 'Energieholz / Hackschnitzel' },
];
const ANTEILE = { s1: [0, 0.85, 0.15], s2: [0.25, 0.6, 0.15], s3: [0.6, 0.3, 0.1], s4: [0.75, 0.18, 0.07], s5: [0.8, 0.12, 0.08], s6: [0.82, 0.1, 0.08], s7: [0.83, 0.09, 0.08], s8: [0.83, 0.09, 0.08] };
/** Menge je Sortiment (Efm o.R.) – nicht gewählte Sortimente fallen auf das nächst schwächere gewählte */
export function sortimentMengen(baeume, gewaehlt) {
  const r = Object.fromEntries(SORTIMENTE.map((s) => [s.k, 0]));
  const rest = ['brenn', 'energie'].filter((k) => gewaehlt.includes(k));
  for (const b of baeume) {
    const v = efm(b.k, b.ba);
    let [st, ind, rs] = ANTEILE[b.k].map((a) => a * v);
    if (!gewaehlt.includes('stamm')) { ind += st; st = 0; }
    if (!gewaehlt.includes('industrie')) { if (rest.length) rs += ind; else st += ind; ind = 0; }
    if (!rest.length) { if (gewaehlt.includes('industrie')) ind += rs; else st += rs; rs = 0; }
    r.stamm += st; r.industrie += ind;
    rest.forEach((k) => { r[k] += rs / rest.length; });
  }
  return r;
}
const fmt = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const euro = (x) => `${Math.round(x).toLocaleString('de-DE')} €`;

export async function openAuszeichnen(measureId) {
  const m0 = store.get().measures.find((x) => x.id === measureId);
  if (!m0) return;
  const all = await source.allParcels();
  const p = all.find((x) => x.id === m0.parcelId) || store.get().parcels.find((x) => x.id === m0.parcelId) || null;
  const fl = flaecheVon(m0, p);
  const az = { baeume: [], ba: 'avg', sortimente: ['stamm', 'industrie', 'brenn'], ...(m0.auszeichnung || {}) };
  az.baeume = (az.baeume || []).map((b) => ({ ...b }));
  if (!m0.auszeichnung && m0.details?.species) { const t = String(m0.details.species).toLowerCase(); const k = Object.keys(BAUMARTEN).find((x) => x !== 'avg' && BAUMARTEN[x].name.toLowerCase().split(/[ /]+/).some((w) => w.length > 3 && t.includes(w))); if (k) az.ba = k; }
  let ansicht = 'zaehlen', pos = null, genau = null, watch = null, karte = null, baumLyr = null, ichLyr = null;

  const body = h('div', { class: 'auszeichnen' });
  const seite = openPage(`Auszeichnen · ${MEASURE_LABEL(m0)}`, body, { onClose: () => { if (watch != null) navigator.geolocation?.clearWatch(watch); karte?.map.remove(); speichern(false); } });

  // GPS läuft die ganze Zeit mit, damit jeder Baum sofort seinen Punkt bekommt
  if (navigator.geolocation) watch = navigator.geolocation.watchPosition((g) => { pos = [g.coords.latitude, g.coords.longitude]; genau = Math.round(g.coords.accuracy); gpsZeile(); ichZeichnen(); }, () => { pos = null; gpsZeile(); }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });

  const summe = () => az.baeume.reduce((s, b) => s + efm(b.k, b.ba), 0);
  const zaehlerEl = h('div', { class: 'az-zaehler', role: 'status', 'aria-live': 'polite' });
  const gpsEl = h('p', { class: 'az-gps muted' });
  function zaehler() {
    const n = az.baeume.length;
    fill(zaehlerEl,
      h('div', { class: 'az-summe' }, h('strong', {}, `${fmt(summe())} Fm`), h('span', {}, `${n} ${n === 1 ? 'Baum' : 'Bäume'} ausgezeichnet`)),
      h('div', { class: 'az-stufen-mini' }, STUFEN.map((s) => { const c = az.baeume.filter((b) => b.k === s.k).length; return h('span', { style: `--c:${s.farbe}` }, `${s.label.replace(' cm', '')}: ${c}`); })));
  }
  function gpsZeile() { gpsEl.textContent = pos ? `GPS bereit · ± ${genau} m – jeder Baum bekommt einen Punkt` : 'Warte auf GPS … (ohne GPS wird der Baum ohne Punkt gezählt)'; }
  function baeumeZeichnen() {
    if (!baumLyr) return;
    baumLyr.clearLayers();
    az.baeume.forEach((b, i) => { if (!b.at) return; const s = STUFEN.find((x) => x.k === b.k); L.circleMarker(b.at, { radius: 4 + STUFEN.indexOf(s) * 0.8, color: '#fff', weight: 1.5, fillColor: s.farbe, fillOpacity: 1 }).bindTooltip(`${i + 1}: ${s.label}, ${BAUMARTEN[b.ba]?.name || 'Durchschnitt'}`).addTo(baumLyr); });
  }
  function ichZeichnen() {
    if (!ichLyr || !pos) return;
    ichLyr.clearLayers();
    L.circle(pos, { radius: genau || 5, color: '#2F6FB0', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(ichLyr);
    L.circleMarker(pos, { radius: 6, color: '#fff', weight: 2, fillColor: '#2F6FB0', fillOpacity: 1, interactive: false }).addTo(ichLyr);
  }
  function baumDazu(k) {
    delete az.abgeschlossen; // wieder geöffnet und weiter ausgezeichnet → wieder „offen“
    az.baeume.push({ id: uid(), k, ba: az.ba, at: pos ? [Number(pos[0].toFixed(7)), Number(pos[1].toFixed(7))] : null, genau: pos ? genau : null, t: Date.now() });
    navigator.vibrate?.(25);
    zaehler(); baeumeZeichnen(); knoepfe(); aktiv();
    speichern(false);
  }
  // Knöpfe, die erst mit dem ersten Baum gehen, nach jedem Tipp freischalten
  const undoBtn = h('button', { type: 'button', class: 'btn btn-small', onclick: () => { const b = az.baeume.pop(); if (!b) return; toast(`Baum ${az.baeume.length + 1} (${STUFEN.find((s) => s.k === b.k).label}) entfernt`); zaehler(); baeumeZeichnen(); knoepfe(); aktiv(); speichern(false); } }, 'Letzten Baum rückgängig');
  const fertigBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block btn-large', onclick: () => { ansicht = 'uebersicht'; render(); } }, 'Auszeichnen abschließen – Übersicht');
  function aktiv() { undoBtn.disabled = !az.baeume.length; fertigBtn.disabled = !az.baeume.length; }
  const knoepfeEl = h('div', { class: 'az-knoepfe' });
  function knoepfe() {
    fill(knoepfeEl, STUFEN.map((s) => {
      const c = az.baeume.filter((b) => b.k === s.k).length;
      return h('button', { type: 'button', class: 'az-stufe', style: `--c:${s.farbe}`, onclick: () => baumDazu(s.k), 'aria-label': `Baum mit ${s.label} Durchmesser auszeichnen` },
        h('strong', {}, s.label), h('small', {}, `${c} · je ${fmt(efm(s.k, az.ba), 2)} Fm`));
    }));
  }

  function speichern(abschliessen) {
    const n = az.baeume.length;
    if (abschliessen) az.abgeschlossen = Date.now();
    store.update((st) => {
      const x = st.measures.find((y) => y.id === measureId);
      if (!x) return;
      x.auszeichnung = { ...az, stand: Date.now() };
      if (n) x.details = { ...(x.details || {}), baeume: String(n), menge: fmt(summe()) };
      if (n && x.status === 'geplant') x.status = 'arbeit';

    });
  }

  function zaehlAnsicht() {
    fill(body,
      zaehlerEl,
      h('div', { class: 'az-schutz' }),
      h('p', { class: 'sheet-label' }, 'Baumart (für eine genauere Menge)'),
      h('div', { class: 'schnell-chips az-ba' }, Object.entries(BAUMARTEN).map(([k, b]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(az.ba === k), onclick: () => { az.ba = k; zaehlAnsicht(); } }, b.name))),
      h('p', { class: 'sheet-label' }, 'Durchmesser in Brusthöhe (BHD) antippen – je Baum einmal'),
      knoepfeEl,
      h('div', { class: 'btn-row' },
        undoBtn),
      gpsEl,
      h('div', { class: 'mini-map az-karte' }),
      fertigBtn,
      h('p', { class: 'hint' }, `Mengen sind Näherungswerte in Erntefestmetern ohne Rinde (Efm o.R.), aus mittleren Massentafelwerten je Durchmesserstufe${az.ba === 'avg' ? ' – mit Baumart wird es genauer' : ''}. Bitte mit eigener Erfahrung abgleichen.`));
    zaehler(); knoepfe(); gpsZeile(); aktiv();
    const mapEl = body.querySelector('.az-karte');
    karte?.map.remove();
    karte = miniKarte(mapEl, p, { zoom: 17 });
    if (fl?.polys?.length && fl.art !== 'Flurstück') L.polygon(fl.polys, { color: '#F26B1D', weight: 2, fillOpacity: 0.08, interactive: false }).addTo(karte.map);
    baumLyr = L.layerGroup().addTo(karte.map); ichLyr = L.layerGroup().addTo(karte.map);
    baeumeZeichnen(); ichZeichnen();
    // Schutzgebiete / FFH auf der Fläche – vor dem Auszeichnen wissen, was gilt
    const sel = fl?.polys?.length ? { ring: fl.polys[0][0], polys: fl.polys } : p ? { ring: (polysOf(p)[0] || [])[0], polys: polysOf(p) } : null;
    if (sel?.ring) import('./schutzpruefung.js').then(({ schutzHinweis }) => body.querySelector('.az-schutz')?.replaceChildren(schutzHinweis(sel, { eingriff: true }))).catch(() => {});
  }

  function uebersicht() {
    const preise = store.get().settings?.sortimentPreise || {};
    const kosten = store.get().settings?.ernteKosten ?? '';
    const menge = sortimentMengen(az.baeume, az.sortimente);
    const gesamt = summe();
    const erloes = az.sortimente.reduce((s, k) => s + (menge[k] || 0) * (Number(preise[k]) || 0), 0);
    const kost = gesamt * (Number(kosten) || 0);
    const preisSetzen = (k, v) => store.update((st) => { st.settings.sortimentPreise = { ...(st.settings.sortimentPreise || {}), [k]: v }; });
    const nachBa = {};
    az.baeume.forEach((b) => { const n = BAUMARTEN[b.ba]?.name || 'Durchschnitt'; nachBa[n] = (nachBa[n] || 0) + efm(b.k, b.ba); });
    fill(body,
      h('div', { class: 'az-summe-gross' }, h('strong', {}, `${fmt(gesamt)} Fm`), h('span', {}, `${az.baeume.length} Bäume ausgezeichnet${fl?.ha ? ` auf ${formatHa(fl.ha)}` : ''} · ${az.baeume.filter((b) => b.at).length} mit GPS-Punkt`)),
      h('table', { class: 'az-tabelle' }, h('thead', {}, h('tr', {}, h('th', {}, 'BHD'), h('th', {}, 'Stück'), h('th', {}, 'Fm'))),
        h('tbody', {}, STUFEN.map((s) => { const bs = az.baeume.filter((b) => b.k === s.k); return bs.length ? h('tr', {}, h('td', {}, h('span', { class: 'az-punkt', style: `--c:${s.farbe}` }), s.label), h('td', {}, String(bs.length)), h('td', {}, fmt(bs.reduce((x, b) => x + efm(b.k, b.ba), 0)))) : null; }))),
      Object.keys(nachBa).length > 1 || !nachBa.Durchschnitt ? h('p', { class: 'muted' }, Object.entries(nachBa).map(([n, v]) => `${n}: ${fmt(v)} Fm`).join(' · ')) : null,
      h('p', { class: 'sheet-label' }, 'Welche Sortimente sollen geschnitten werden?'),
      h('div', { class: 'az-sortimente' }, SORTIMENTE.map((s) => h('label', { class: 'jk-check' },
        h('input', { type: 'checkbox', checked: az.sortimente.includes(s.k), onchange: (e) => { az.sortimente = e.target.checked ? [...az.sortimente, s.k] : az.sortimente.filter((x) => x !== s.k); if (!az.sortimente.length) az.sortimente = ['industrie']; speichern(false); render(); } }),
        h('span', {}, s.name, az.sortimente.includes(s.k) ? h('small', {}, `${fmt(menge[s.k])} Fm`) : null)))),
      h('p', { class: 'sheet-label' }, 'Preise und Kosten (für die Kalkulation)'),
      h('div', { class: 'az-preise' },
        az.sortimente.map((k) => h('label', {}, `${SORTIMENTE.find((s) => s.k === k).name} – €/Fm`, h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 1, value: preise[k] ?? '', placeholder: 'Preis', onchange: (e) => { preisSetzen(k, e.target.value); render(); } }))),
        h('label', {}, 'Erntekosten (Einschlag und Rücken) – €/Fm', h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 1, value: kosten, placeholder: 'Kosten', onchange: (e) => { store.update((st) => { st.settings.ernteKosten = e.target.value; }); render(); } }))),
      erloes || kost ? h('div', { class: 'az-kalk' },
        h('div', {}, h('span', {}, 'Erlös'), h('strong', {}, euro(erloes))),
        h('div', {}, h('span', {}, 'Erntekosten'), h('strong', {}, `– ${euro(kost)}`)),
        h('div', { class: 'az-ergebnis' }, h('span', {}, 'Ergebnis'), h('strong', {}, euro(erloes - kost))),
        h('p', { class: 'hint' }, 'Die Preise werden gespeichert und bei der nächsten Holzernte vorgeschlagen.')) : h('p', { class: 'hint' }, 'Trage Preise je Sortiment und die Erntekosten ein – dann rechnet die App das Ergebnis der Maßnahme aus.'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => { ansicht = 'zaehlen'; render(); } }, 'Weiter auszeichnen'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
          store.update((st) => { const x = st.measures.find((y) => y.id === measureId); if (x) x.auszeichnung = { ...az, ergebnis: { gesamt, menge, erloes, kosten: kost } }; });
          speichern(true); seite.close();
          import('./berichte.js').then((b) => b.unternehmerAuftrag(measureId));
        } }, 'Fertig – Arbeitsauftrag mit Karte')));
    store.update((st) => { const x = st.measures.find((y) => y.id === measureId); if (x) x.auszeichnung = { ...(x.auszeichnung || az), ...az, ergebnis: { gesamt, menge, erloes, kosten: kost } }; });
  }
  function render() { if (ansicht === 'zaehlen') zaehlAnsicht(); else { karte?.map.remove(); karte = null; uebersicht(); } seite.el.querySelector('.page-body')?.scrollTo?.(0, 0); }
  render();
}

function MEASURE_LABEL(m) { return m.type === 'holzernte_bs' ? 'Bodenschonende Holzernte' : 'Holzernte'; }

/** Für den Arbeitsauftrag: Text mit Mengen je Stufe und Sortiment */
export function auszeichnungZeilen(az) {
  if (!az?.baeume?.length) return [];
  const gesamt = az.baeume.reduce((s, b) => s + efm(b.k, b.ba), 0);
  const menge = sortimentMengen(az.baeume, az.sortimente || ['stamm', 'industrie', 'brenn']);
  return [
    ['Ausgezeichnet', `${az.baeume.length} Bäume, ca. ${fmt(gesamt)} Fm (Efm o.R., Näherung)`],
    ['Durchmesser', STUFEN.map((s) => { const c = az.baeume.filter((b) => b.k === s.k).length; return c ? `${s.label}: ${c}` : null; }).filter(Boolean).join(' · ')],
    ['Sortimente', (az.sortimente || []).map((k) => `${SORTIMENTE.find((s) => s.k === k)?.name}: ca. ${fmt(menge[k])} Fm`).join(' · ')],
  ];
}
