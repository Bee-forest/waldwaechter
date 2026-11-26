// Maßnahmen nachträglich bearbeiten (solange nicht erledigt) und Abschlussprotokoll nach dem Erledigen:
// Schäden am verbleibenden Bestand, Auffälligkeiten, Bewertung des Unternehmers.
import { h, fill, openPage, toast, fmtDate } from './ui.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { formatHa } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { CATEGORIES } from './map/basemap.js';
import { SPECIES } from './thinning/plan.js';
import { flaechenWahl, flaecheAutomatisch, flaecheVon, haText } from './flaeche.js';
import { passtFlurstueck } from './profi.js';
import { openFotos, fotoAnzahl } from './fotos.js';

const ymd = (t) => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Gebuchte Maßnahme bearbeiten: Fläche, Angaben, Termin, Kosten, Notiz */
export async function openMassnahmeBearbeiten(measureId) {
  const { MEASURE_TYPES } = await import('./measures.js');
  const m = store.get().measures.find((x) => x.id === measureId);
  if (!m) return;
  if (m.status === 'fertig') { toast('Erledigte Maßnahmen lassen sich nicht mehr bearbeiten.'); return; }
  const t = MEASURE_TYPES[m.type] || { label: m.type, fields: [] };
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id] && passtFlurstueck(p));
  if (m.parcelId && !mine.some((p) => p.id === m.parcelId) && byId[m.parcelId]) mine.unshift(byId[m.parcelId]);
  const flHost = h('div', { class: 'flaeche-host' });
  let wahl = null;
  let setzeHa = () => {};
  const zeigeWahl = (id, start = null) => { wahl?.entferne(); wahl = null; flHost.replaceChildren(); if (!id) setzeHa(null); if (id && byId[id]) { wahl = flaechenWahl(byId[id], start, { onChange: (f) => setzeHa(f?.ha) }); flHost.append(wahl.el); } };
  const feld = ([k, label, kind]) => {
    const v = m.details?.[k] ?? '';
    if (Array.isArray(kind) || kind === 'species') {
      const opts = Array.isArray(kind) ? kind : SPECIES;
      return h('label', {}, label, h('select', { name: k }, (v && !opts.includes(v) ? [v, ...opts] : opts).map((o) => h('option', { selected: o === v }, o))));
    }
    return h('label', {}, label, h('input', { name: k, value: v, type: kind === 'number' ? 'number' : 'text', inputmode: kind === 'decimal' ? 'decimal' : kind === 'number' ? 'numeric' : null, min: kind === 'number' ? 0 : null }));
  };
  // nur Felder zeigen, die für diese Art gelten oder schon befüllt sind
  const felder = t.fields.filter(([k]) => m.type !== 'pflege' || m.details?.[k] !== undefined || ['art', 'area'].includes(k));
  let page = null;
  const form = h('form', { class: 'form', onsubmit: (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const fl = wahl ? wahl.wert() : null;
    if (wahl && !fl) { toast('Bitte mindestens 3 Eckpunkte der Teilfläche einzeichnen.'); return; }
    const kosten = String(fd.get('kosten') || '').trim();
    store.update((s) => {
      const x = s.measures.find((y) => y.id === m.id);
      if (!x) return;
      x.parcelId = fd.get('parcel') || null;
      x.date = m.serie ? x.date : fd.get('date') ? new Date(fd.get('date')).getTime() : null;
      x.details = { ...(x.details || {}), ...Object.fromEntries(felder.map(([k]) => [k, String(fd.get(k) ?? '').trim()])) };
      x.kosten = kosten ? Number(kosten.replace(',', '.')) : null;
      x.note = String(fd.get('note') || '').trim();
      if (fl?.modus === 'teil') x.flaeche = { ring: fl.ring, ringe: fl.ringe, ha: fl.ha };
      else if (fl?.modus === 'ganz' || !x.parcelId) delete x.flaeche;
      x.geaendert = Date.now();
    });
    toast('Änderungen gespeichert');
    page.close();
    import('./berichte.js').then((b) => b.unternehmerAuftrag(m.id, { anhaengen: true })).catch(() => {});
    // Termin jetzt in der Brut- und Setzzeit eines Schutzgebiets? Gleich nachfragen.
    import('./schutzgebiete.js').then(async ({ vorpruefungNoetig }) => {
      const neu = store.get().measures.find((y) => y.id === m.id);
      if (neu && neu.date !== m.date && vorpruefungNoetig(neu)) (await import('./schutzpruefung.js')).brutzeitDialog(neu);
    });
  } },
    h('p', { class: 'hint' }, `Gebucht am ${fmtDate(m.createdAt)}. Solange die Maßnahme nicht erledigt ist, kannst du alles ändern.`),
    h('label', {}, 'Fläche',
      h('select', { name: 'parcel', onchange: (e) => zeigeWahl(e.target.value) },
        h('option', { value: '' }, 'ohne Flächenzuordnung'),
        mine.map((p) => h('option', { value: p.id, selected: p.id === m.parcelId }, `Flurstück ${p.nr}, ${p.gemarkung} (${CATEGORIES[p.category]?.label || ''}, ${formatHa(amtlicheFlaecheHa(byId[p.id]))})`)))),
    flHost,
    felder.map(feld),
    m.serie ? null : h('label', {}, 'Geplanter Termin', h('input', { type: 'date', name: 'date', value: ymd(m.date) })),
    h('label', {}, 'Kosten (€, optional)', h('input', { name: 'kosten', type: 'number', inputmode: 'decimal', min: 0, step: '0.01', value: m.kosten ?? '' })),
    h('label', {}, 'Notiz', h('textarea', { name: 'note', rows: 3, value: m.note || '' })),
    h('button', { class: 'btn btn-primary btn-block btn-large', type: 'submit' }, 'Änderungen speichern'));
  page = openPage(`${t.label} bearbeiten`, h('div', { class: 'new-measure' }, form), { onClose: () => wahl?.entferne() });
  setzeHa = flaecheAutomatisch(form, flaecheVon(m, byId[m.parcelId] || m.flurstueck)?.ha ?? null);
  if (m.parcelId) zeigeWahl(m.parcelId, m.flaeche || null);
}

// ---------- Abschlussprotokoll ----------
export const SCHAEDEN = [
  ['rinde', 'Rindenschäden an stehenden Bäumen', 'beim Fällen oder Rücken angefahren, geschält'],
  ['wurzel', 'Wurzel- und Stammfußschäden', 'überfahren, angerissen'],
  ['krone', 'Kronen- oder Stammbruch', 'durch fallende Bäume'],
  ['verjuengung', 'Verjüngung beschädigt', 'Naturverjüngung oder Kultur umgefahren, zugeschüttet'],
  ['boden', 'Bodenschäden', 'tiefe Spurrinnen, Verdichtung außerhalb der Gassen'],
  ['gassen', 'Rückegassen nicht eingehalten', 'Befahrung zwischen den Gassen'],
  ['wege', 'Wege, Gräben oder Durchlässe beschädigt', ''],
  ['einrichtungen', 'Zaun, Grenzsteine oder Einrichtungen beschädigt', 'z. B. Wildschutzzaun, Hochsitz'],
  ['reste', 'Müll, Öl oder Reste liegen gelassen', ''],
];
export const KRITERIEN = [
  ['qualitaet', 'Qualität der Arbeit'],
  ['schonung', 'Schonung von Bestand und Boden'],
  ['termin', 'Termintreue'],
  ['absprache', 'Absprache und Erreichbarkeit'],
  ['sauberkeit', 'Ordnung und Sauberkeit'],
  ['sicherheit', 'Arbeitssicherheit'],
];
export const schnittVon = (b) => { const w = Object.values(b || {}).filter((x) => x > 0); return w.length ? w.reduce((a, x) => a + x, 0) / w.length : null; };
const sterne = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

/**
 * Abschlussprotokoll: nach dem Erledigen ausfüllen (abschliessen = true setzt die Maßnahme auf erledigt),
 * später ansehen oder ergänzen.
 */
export async function openProtokoll(measureId, { abschliessen = false } = {}) {
  const { MEASURE_TYPES } = await import('./measures.js');
  const m = store.get().measures.find((x) => x.id === measureId);
  if (!m) return;
  const alt = m.protokoll || {};
  const unternehmerVorschlag = m.details?.ausfuehrung === 'Eigenleistung' ? 'eigen' : (m.details?.ausfuehrung || m.auftrag?.unternehmer) ? 'unternehmer' : null;
  const s = {
    datum: ymd(alt.datum || m.finishedAt || Date.now()),
    ausfuehrung: alt.ausfuehrung || unternehmerVorschlag || 'unternehmer',
    unternehmer: alt.unternehmer || m.auftrag?.unternehmer || '',
    schadenStufe: alt.schadenStufe || 'keine',
    schaeden: [...(alt.schaeden || [])],
    baeume: alt.baeume ?? '',
    bewertung: { ...(alt.bewertung || {}) },
    wieder: alt.wieder || '',
    auffaellig: alt.auffaellig || '',
    nacharbeit: alt.nacharbeit || '',
  };
  const bekannte = [...new Set(store.get().measures.map((x) => x.protokoll?.unternehmer).filter(Boolean))].sort();
  const body = h('div', { class: 'protokoll form' });
  let page = null, gespeichert = false;
  const ruhig = (fn) => { const pb = body.closest('.page-body'); const y = pb?.scrollTop || 0; fn(); if (pb) pb.scrollTop = y; };
  const wahl = (liste, aktiv, onWahl) => h('div', { class: 'q-chips' }, liste.map(([k, l]) => h('button', { type: 'button', class: `q-option ${aktiv === k ? 'on' : ''}`, 'aria-pressed': String(aktiv === k), onclick: () => { onWahl(k); ruhig(render); } }, l)));

  function speichern(abschluss) {
    const p = { ...s, baeume: s.baeume === '' ? null : Number(s.baeume), unternehmer: s.ausfuehrung === 'unternehmer' ? s.unternehmer.trim() : '', bewertung: s.ausfuehrung === 'unternehmer' ? s.bewertung : {}, erstellt: alt.erstellt || Date.now(), geaendert: Date.now() };
    store.update((st) => {
      const x = st.measures.find((y) => y.id === m.id);
      if (!x) return;
      x.protokoll = p;
      if (abschluss && x.status !== 'fertig') { x.status = 'fertig'; x.finishedAt = s.datum ? new Date(s.datum).getTime() : Date.now(); }
    });
    gespeichert = true;
    toast(abschluss ? 'Maßnahme erledigt – Protokoll gespeichert' : 'Protokoll gespeichert');
    page.close();
  }

  function render() {
    const schnitt = schnittVon(s.bewertung);
    fill(body,
      abschliessen ? h('p', { class: 'hint' }, 'Halte fest, wie die Maßnahme gelaufen ist. Das hilft bei Reklamationen und bei der Wahl des nächsten Unternehmers. Du kannst das Protokoll auch später ausfüllen.') : null,
      h('label', {}, 'Erledigt am', h('input', { type: 'date', value: s.datum, onchange: (e) => { s.datum = e.target.value; } })),
      h('h2', { class: 'step-title' }, 'Wer hat die Arbeit gemacht?'),
      wahl([['unternehmer', 'Unternehmer / Dienstleister'], ['fbg', 'FBG'], ['eigen', 'Eigenleistung']], s.ausfuehrung, (k) => { s.ausfuehrung = k; }),
      s.ausfuehrung !== 'eigen' ? h('label', {}, s.ausfuehrung === 'fbg' ? 'Ausgeführt von (Name, optional)' : 'Name des Unternehmers',
        h('input', { value: s.unternehmer, list: 'unternehmer-liste', placeholder: 'z. B. Forstservice Müller', oninput: (e) => { s.unternehmer = e.target.value; } }),
        h('datalist', { id: 'unternehmer-liste' }, bekannte.map((n) => h('option', { value: n })))) : null,

      h('h2', { class: 'step-title' }, 'Schäden am verbleibenden Bestand'),
      wahl([['keine', 'Keine'], ['gering', 'Gering'], ['erheblich', 'Erheblich']], s.schadenStufe, (k) => { s.schadenStufe = k; if (k === 'keine') s.schaeden = []; }),
      s.schadenStufe !== 'keine' ? [
        h('div', { class: 'q-cards' }, SCHAEDEN.map(([k, l, t]) => { const an = s.schaeden.includes(k); return h('button', { type: 'button', class: `q-option ${an ? 'on' : ''}`, 'aria-pressed': String(an),
          onclick: () => { const i = s.schaeden.indexOf(k); if (i >= 0) s.schaeden.splice(i, 1); else s.schaeden.push(k); ruhig(render); } },
          h('span', { class: 'q-text' }, h('strong', {}, l), t ? h('small', {}, t) : null)); })),
        h('label', {}, 'Beschädigte Bäume (ungefähr, optional)', h('input', { type: 'number', inputmode: 'numeric', min: 0, value: s.baeume, oninput: (e) => { s.baeume = e.target.value; } })),
        h('p', { class: 'hint' }, 'Schäden mit Fotos belegen (unten „Fotos“) und dem Unternehmer zeitnah schriftlich melden – je früher, desto besser lässt sich eine Minderung oder Nachbesserung durchsetzen.'),
      ] : null,

      s.ausfuehrung !== 'eigen' ? [
        h('h2', { class: 'step-title' }, s.ausfuehrung === 'fbg' ? 'Bewertung der Ausführung' : 'Bewertung des Unternehmers'),
        h('div', { class: 'bewertung' }, KRITERIEN.map(([k, l]) => h('div', { class: 'bew-zeile' },
          h('span', {}, l),
          h('span', { class: 'sterne', role: 'radiogroup', 'aria-label': l }, [1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.bewertung[k] === n), 'aria-label': `${n} von 5`,
            class: (s.bewertung[k] || 0) >= n ? 'an' : '', onclick: () => { s.bewertung[k] = s.bewertung[k] === n ? 0 : n; ruhig(render); } }, '★')))))),
        schnitt ? h('p', {}, h('strong', {}, `Gesamt: ${schnitt.toLocaleString('de-DE', { maximumFractionDigits: 1 })} von 5 `), h('span', { class: 'sterne-text' }, sterne(schnitt))) : h('p', { class: 'muted' }, 'Tippe die Sterne an: 1 = schlecht, 5 = sehr gut.'),
        h('p', { class: 'sheet-label' }, 'Würdest du wieder beauftragen?'),
        wahl([['ja', 'Ja'], ['vielleicht', 'Vielleicht'], ['nein', 'Nein']], s.wieder, (k) => { s.wieder = s.wieder === k ? '' : k; }),
      ] : null,

      h('h2', { class: 'step-title' }, 'Auffälligkeiten'),
      h('label', {}, 'Was ist aufgefallen?', h('textarea', { rows: 3, placeholder: 'z. B. Kronen nicht aufgearbeitet, Gasse 3 stark zerfahren, sehr sauber gearbeitet …', value: s.auffaellig, oninput: (e) => { s.auffaellig = e.target.value; } })),
      h('label', {}, 'Nacharbeit / Vereinbarungen', h('textarea', { rows: 2, placeholder: 'z. B. Weg bis 15.12. wieder herrichten, 10 % Abzug vereinbart', value: s.nacharbeit, oninput: (e) => { s.nacharbeit = e.target.value; } })),
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => openFlaecheHinterlegen(m.id) }, m.flaeche?.ring ? `Durchgeführte Fläche ändern (${formatHa(m.flaeche.ha)})` : 'Durchgeführte Fläche hinterlegen'),
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => openFotos(`m:${m.id}`, `${MEASURE_TYPES[m.type]?.label || 'Maßnahme'} – Fotos nachher`, { hinweis: 'Fotos von Schäden oder vom Ergebnis als „nachher“ ablegen.' }) },
        `Fotos${fotoAnzahl(`m:${m.id}`) ? ` (${fotoAnzahl(`m:${m.id}`)})` : ''}`),
      h('div', { class: 'btn-row protokoll-aktionen' },
        abschliessen ? h('button', { type: 'button', class: 'btn', onclick: () => { store.update((st) => { const x = st.measures.find((y) => y.id === m.id); if (x && x.status !== 'fertig') { x.status = 'fertig'; x.finishedAt = Date.now(); } }); gespeichert = true; toast('Maßnahme erledigt – Protokoll kannst du später ausfüllen'); page.close(); } }, 'Später ausfüllen') : null,
        h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => speichern(abschliessen) }, abschliessen ? 'Erledigt und speichern' : 'Protokoll speichern')));
  }
  render();
  page = openPage(`Abschlussprotokoll · ${MEASURE_TYPES[m.type]?.label || 'Maßnahme'}`, body, { onClose: () => { if (abschliessen && !gespeichert) toast('Nicht als erledigt markiert'); } });
}

/** Kurzfassung für die Maßnahmenkarte */
export function protokollKurz(p) {
  if (!p) return null;
  const teile = [];
  teile.push(p.schadenStufe === 'keine' ? 'keine Schäden am Bestand' : `${p.schadenStufe === 'erheblich' ? 'erhebliche' : 'geringe'} Schäden${p.schaeden?.length ? ` (${p.schaeden.map((k) => SCHAEDEN.find((x) => x[0] === k)?.[1]).filter(Boolean).join(', ')})` : ''}`);
  const sch = schnittVon(p.bewertung);
  if (p.unternehmer || sch) teile.push(`${p.unternehmer || 'Unternehmer'}${sch ? ` ${sch.toLocaleString('de-DE', { maximumFractionDigits: 1 })}/5 ★` : ''}`);
  return teile.join(' · ');
}

/** Bewertungen je Unternehmer (für das Profil) */
export function unternehmerUebersicht() {
  const map = new Map();
  for (const m of store.get().measures || []) {
    const p = m.protokoll;
    if (!p?.unternehmer) continue;
    const k = p.unternehmer.trim();
    const e = map.get(k.toLowerCase()) || { name: k, n: 0, summe: 0, bewertet: 0, schaeden: 0, nein: 0, letzte: 0 };
    e.n++;
    const sch = schnittVon(p.bewertung);
    if (sch) { e.summe += sch; e.bewertet++; }
    if (p.schadenStufe === 'erheblich') e.schaeden++;
    if (p.wieder === 'nein') e.nein++;
    e.letzte = Math.max(e.letzte, m.finishedAt || 0);
    map.set(k.toLowerCase(), e);
  }
  return [...map.values()].map((e) => ({ ...e, schnitt: e.bewertet ? e.summe / e.bewertet : null })).sort((a, b) => (b.schnitt ?? 0) - (a.schnitt ?? 0));
}

/** Fläche einer Maßnahme hinterlegen oder ändern – in jedem Stand, auch beim Durchführen und danach
 *  (Teilfläche einzeichnen oder mit GPS ablaufen). Danach wird der Arbeitsauftrag mit Karte neu erstellt. */
export async function openFlaecheHinterlegen(measureId) {
  const m = store.get().measures.find((x) => x.id === measureId);
  if (!m) return;
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id] && (passtFlurstueck(p) || p.id === m.parcelId));
  const flHost = h('div', { class: 'flaeche-host' });
  let wahl = null, parcelId = m.parcelId || mine[0]?.id || null, page = null;
  const zeige = (id, start = null) => { wahl?.entferne(); wahl = null; flHost.replaceChildren(); if (id && byId[id]) { wahl = flaechenWahl(byId[id], start); flHost.append(wahl.el); } };
  const body = h('div', { class: 'form' },
    h('p', { class: 'hint' }, m.status === 'fertig' ? 'Halte fest, auf welcher Fläche die Maßnahme tatsächlich durchgeführt wurde.' : 'Lege fest, wo die Maßnahme durchgeführt wird – ganzes Flurstück oder Teilfläche. Du kannst die Fläche auch vor Ort mit GPS ablaufen.'),
    h('label', {}, 'Flurstück', h('select', { onchange: (e) => { parcelId = e.target.value || null; zeige(parcelId); } },
      mine.map((p) => h('option', { value: p.id, selected: p.id === parcelId }, `Flurstück ${p.nr}, ${p.gemarkung} (${formatHa(amtlicheFlaecheHa(byId[p.id]))})`)))),
    flHost,
    h('button', { type: 'button', class: 'btn btn-primary btn-block btn-large', onclick: () => {
      if (!parcelId) { toast('Bitte ein Flurstück wählen.'); return; }
      const fl = wahl?.wert();
      if (wahl && !fl) { toast('Bitte mindestens 3 Eckpunkte einzeichnen.'); return; }
      store.update((s) => {
        const x = s.measures.find((y) => y.id === m.id); if (!x) return;
        x.parcelId = parcelId;
        // „Fläche (ha)“ mitziehen, wenn sie leer war oder automatisch eingetragen wurde
        if (fl?.ha && 'area' in (x.details || {})) { const alt = flaecheVon(m, byId[m.parcelId] || m.flurstueck)?.ha; const v = x.details?.area || ''; if (!v || (alt != null && v === haText(alt))) x.details = { ...(x.details || {}), area: haText(fl.ha) }; }
        if (fl?.modus === 'teil') x.flaeche = { ring: fl.ring, ringe: fl.ringe, ha: fl.ha, ...(m.status === 'fertig' ? { ist: true } : {}) };
        else delete x.flaeche;
        x.geaendert = Date.now();
      });
      toast('Fläche gespeichert');
      page.close();
      import('./berichte.js').then((b) => b.unternehmerAuftrag(m.id, { anhaengen: true })).catch(() => {});
    } }, 'Fläche speichern'));
  page = openPage('Fläche der Maßnahme', h('div', { class: 'new-measure' }, body), { onClose: () => wahl?.entferne() });
  if (parcelId) zeige(parcelId, m.parcelId === parcelId ? m.flaeche || null : null);
}
