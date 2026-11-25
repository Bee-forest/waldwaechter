// Schadensmeldung (Borkenkäfer, Windwurf, Bruch …) und „Holz verkaufen“: erfassen, als Maßnahme speichern und
// als Meldung an die Forstbetriebsgemeinschaft (FBG) schicken – per Teilen (mit Fotos) oder E-Mail.
import { h, fill, openPage, toast, dialog } from './ui.js';
import { store, uid } from './store.js';
import { source } from './data/source.js';
import { centroid, polysOf, formatHa } from './geo.js';
import { flaechenWahl } from './flaeche.js';
import { SPECIES } from './thinning/plan.js';
import { fotoListe, openFotos } from './fotos.js';
import { dateiLaden } from './dateien.js';
import { passtFlurstueck, ordnerFuerNeu } from './profi.js';
import { openProfile } from './profile.js';
import { schadstellenKarte, SCHADEN_SYMBOLE } from './map/schadenpunkte.js';

export const SCHADEN_TYPEN = [
  ['kaefer', 'Borkenkäfer', 'Bohrmehl, Harzfluss, rote oder abfallende Nadeln, abfallende Rinde'],
  ['windwurf', 'Windwurf', 'Geworfene Bäume mit Wurzelteller'],
  ['bruch', 'Schnee- oder Windbruch', 'Abgebrochene Stämme oder Kronen'],
  ['trocken', 'Trockenschaden', 'Absterbende Kronen, vorzeitiger Laubfall'],
  ['sonstig', 'Sonstiger Schaden', 'z. B. Pilz, Feuer, Wild'],
];
export const schadenText = (k) => SCHADEN_TYPEN.find(([x]) => x === k)?.[1] || 'Schaden';

const fbg = () => { const p = store.get().profile || {}; return { name: p.fbg || 'Forstbetriebsgemeinschaft', mail: p.fbgMail || '', absender: p.name || '', tel: p.telefon || '' }; };
const kartenLink = ([lat, lng]) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;

/** Meldung verschicken: mit Fotos über „Teilen“, sonst als E-Mail an die FBG */
export async function meldungSenden({ betreff, text, fotoKey = null }) {
  const f = fbg();
  const dateien = [];
  if (fotoKey) {
    for (const x of fotoListe(fotoKey).slice(0, 6)) {
      const b = await dateiLaden(x.id).catch(() => null);
      if (b) dateien.push(new File([b], `foto-${dateien.length + 1}.jpg`, { type: 'image/jpeg' }));
    }
  }
  const wahl = await dialog({
    title: 'Meldung an die FBG',
    body: h('div', { class: 'form' },
      f.mail ? h('p', {}, `Empfänger: ${f.name} (${f.mail})`) : h('p', { class: 'warn-line' }, 'Im Profil ist noch keine E-Mail-Adresse der FBG eingetragen.'),
      h('pre', { class: 'meldung-text' }, text),
      dateien.length ? h('p', { class: 'muted' }, `${dateien.length} Foto${dateien.length > 1 ? 's' : ''} ${navigator.canShare?.({ files: dateien }) ? 'werden über „Teilen“ mitgeschickt.' : 'können per E-Mail nicht automatisch angehängt werden – bitte von Hand anhängen.'}`) : null),
    actions: [
      ...(f.mail ? [] : [{ label: 'E-Mail im Profil eintragen', value: 'profil' }]),
      { label: 'Abbrechen', value: null },
      ...(navigator.share ? [{ label: 'Teilen …', value: 'teilen' }] : []),
      { label: 'Per E-Mail senden', value: 'mail', primary: true },
    ],
  });
  if (wahl === 'profil') { openProfile(); return false; }
  if (wahl === 'teilen') {
    const daten = { title: betreff, text: `${f.mail ? `An: ${f.mail}\n` : ''}${text}` };
    if (dateien.length && navigator.canShare?.({ ...daten, files: dateien })) daten.files = dateien;
    try { await navigator.share(daten); return true; } catch { return false; }
  }
  if (wahl === 'mail') {
    location.href = `mailto:${encodeURIComponent(f.mail)}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`;
    return true;
  }
  return false;
}

function flaechenText(p, fl) {
  if (!p) return 'ohne Flurstück';
  return `Flurstück ${p.nr}, Flur ${p.flur}, Gemarkung ${p.gemarkung}${fl?.modus === 'teil' ? ` (Teilfläche ${formatHa(fl.ha)})` : ''}`;
}

// ---------- Schadensmeldung ----------
export async function openSchadensmeldung({ parcelId = null, onSaved, typ = 'kaefer', baeume = '' } = {}) {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id] && passtFlurstueck(p));
  const id = uid();
  const punkte = [];
  const w = { typ, parcelId: parcelId || mine[0]?.id || null, pos: null, genau: null, species: 'Fichte', menge: '', baeume: baeume ? String(baeume) : '', datum: new Date().toISOString().slice(0, 10), text: '' };
  let wahl = null;
  const body = h('div', { class: 'form schaden' });
  const page = openPage('Schaden melden', body, { onClose: () => { wahl?.entferne(); stellen.entferne(); } });
  // Schadstellen auf der Karte: je Schadensart ein eigenes Symbol
  const stellen = schadstellenKarte({ punkte, typ: () => w.typ });
  let stellenFlst = undefined;
  const flHost = h('div');
  const zeigeWahl = () => { wahl?.entferne(); wahl = null; fill(flHost); if (w.parcelId && byId[w.parcelId]) { wahl = flaechenWahl(byId[w.parcelId]); flHost.append(wahl.el); } };
  const gps = () => {
    if (!navigator.geolocation) { toast('Kein GPS verfügbar'); return; }
    toast('Standort wird bestimmt …');
    navigator.geolocation.getCurrentPosition((p) => { w.pos = [p.coords.latitude, p.coords.longitude]; w.genau = Math.round(p.coords.accuracy); zeichne(); }, () => toast('Standort nicht verfügbar'), { enableHighAccuracy: true, timeout: 20000 });
  };
  const fotoKey = `m:${id}`;
  function zeichne() {
    const n = fotoListe(fotoKey).length;
    fill(body,
      h('p', { class: 'muted' }, 'Kalamitätsholz muss schnell aus dem Wald. Erfasse den Schaden und schicke die Meldung direkt an deine FBG.'),
      h('p', { class: 'sheet-label' }, 'Art des Schadens'),
      h('div', { class: 'q-cards' }, SCHADEN_TYPEN.map(([k, l, t]) => h('button', { type: 'button', class: `q-option ${w.typ === k ? 'on' : ''}`, 'aria-pressed': String(w.typ === k), onclick: () => { w.typ = k; punkte.forEach((pp) => { pp.typ = k; }); if (k === 'kaefer' && !/fichte|kiefer|lärche/i.test(w.species)) w.species = 'Fichte'; zeichne(); } },
        h('span', { class: 'schaden-symbol schaden-mini', html: `<span>${SCHADEN_SYMBOLE[k]}</span>` }), h('span', { class: 'q-text' }, h('strong', {}, l), h('small', {}, t))))),
      h('label', {}, 'Flurstück', h('select', { onchange: (e) => { w.parcelId = e.target.value || null; zeigeWahl(); } },
        h('option', { value: '' }, 'ohne Flurstück'), mine.map((p) => h('option', { value: p.id, selected: p.id === w.parcelId }, `Flurstück ${p.nr}, ${p.gemarkung}`)))),
      h('p', { class: 'sheet-label' }, 'Wo genau? Schadstellen auf der Karte setzen'),
      stellen.el,
      h('details', { class: 'bzt-mehr' }, h('summary', {}, 'Betroffene Fläche (optional)'), flHost),
      h('div', { class: 'form-row' },
        h('label', {}, 'Baumart', h('select', { onchange: (e) => { w.species = e.target.value; } }, SPECIES.map((s) => h('option', { selected: s === w.species }, s)))),
        h('label', {}, 'Festgestellt am', h('input', { type: 'date', value: w.datum, onchange: (e) => { w.datum = e.target.value; } }))),
      h('div', { class: 'form-row' },
        h('label', {}, 'Menge grob (Fm)', h('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: w.menge, placeholder: 'z. B. 30', oninput: (e) => { w.menge = e.target.value; } })),
        h('label', {}, 'Anzahl Bäume (ca.)', h('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: w.baeume, oninput: (e) => { w.baeume = e.target.value; } }))),
      h('small', { class: 'muted' }, 'Faustwert: eine 80-jährige Fichte hat etwa 1 Fm.'),
      h('label', {}, 'Beschreibung', h('textarea', { rows: 2, placeholder: 'z. B. Käfernest am Südrand, Zufahrt über Forstweg', oninput: (e) => { w.text = e.target.value; } }, w.text)),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: () => openFotos(fotoKey, `Schaden: ${schadenText(w.typ)}`) }, n ? `Fotos (${n})` : 'Fotos hinzufügen')),
      h('div', { class: 'q-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => speichern(false) }, 'Nur speichern'),
        h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => speichern(true) }, 'Speichern und melden')));
    if (w.parcelId && !wahl) zeigeWahl(); else if (wahl) flHost.append(wahl.el);
    if (stellenFlst !== w.parcelId) { stellenFlst = w.parcelId; stellen.setFlurstueck(w.parcelId ? byId[w.parcelId] : null); } else stellen.neuZeichnen();
  }
  const abo = store.subscribe(() => { const btn = body.querySelector('.btn-row .btn'); if (btn) { const n = fotoListe(fotoKey).length; btn.textContent = n ? `Fotos (${n})` : 'Fotos hinzufügen'; } });
  async function speichern(melden) {
    if (melden && !punkte.length) { toast('Bitte mindestens eine Schadstelle in der Karte setzen – sonst ist die Meldung zu ungenau.'); stellen.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    if (punkte.length) { w.pos = punkte[0].at; w.genau = punkte[0].genau || null; }
    const fl = wahl ? wahl.wert() : null;
    if (wahl && !fl) { toast('Bitte die Teilfläche fertig einzeichnen (mindestens 3 Eckpunkte) oder „Ganzes Flurstück“ wählen.'); return; }
    const p = w.parcelId ? byId[w.parcelId] : null;
    const pt = w.pos || (fl?.ring ? centroid(fl.ring) : p ? centroid(p.ring) : null);
    const details = { schaden: schadenText(w.typ), species: w.species, menge: w.menge, baeume: w.baeume, gps: w.pos ? `${w.pos[0].toFixed(6)}, ${w.pos[1].toFixed(6)}` : '', text: w.text.trim() };
    const m = { id, type: 'schaden', parcelId: w.parcelId, ordnerId: w.parcelId ? undefined : ordnerFuerNeu(), date: new Date(`${w.datum}T12:00`).getTime(), status: 'geplant', createdAt: Date.now(), note: w.text.trim(), details,
      flaeche: fl?.modus === 'teil' ? { ring: fl.ring, ha: fl.ha } : undefined, schaden: { typ: w.typ, pos: w.pos, genau: w.genau, punkte: punkte.map((x) => ({ at: x.at, typ: x.typ, genau: x.genau || null })), gemeldet: null } };
    store.update((s) => { s.measures.push(m); });
    abo(); stellen.entferne(); page.close();
    toast('Schaden gespeichert');
    if (melden) await schadenMelden(m.id);
    onSaved?.(m.id);
  }
  zeichne();
  return page;
}

export async function schadenMelden(measureId) {
  const m = store.get().measures.find((x) => x.id === measureId);
  if (!m) return;
  const all = await source.allParcels();
  const p = all.find((x) => x.id === m.parcelId);
  const d = m.details || {};
  const pt = m.schaden?.pos || (m.flaeche?.ring ? centroid(m.flaeche.ring) : p ? centroid(p.ring) : null);
  const f = fbg();
  const text = [
    `Schadensmeldung: ${d.schaden}`,
    `Ort: ${flaechenText(p, m.flaeche ? { modus: 'teil', ha: m.flaeche.ha } : null)}`,
    ...(m.schaden?.punkte?.length > 1
      ? [`Schadstellen (${m.schaden.punkte.length}):`, ...m.schaden.punkte.map((x, i) => `  ${i + 1}. ${x.at[0].toFixed(6)}, ${x.at[1].toFixed(6)}${x.genau ? ` (± ${x.genau} m)` : ''} – ${kartenLink(x.at)}`)]
      : [pt ? `Karte: ${kartenLink(pt)}` : null, d.gps ? `GPS: ${d.gps}${m.schaden?.genau ? ` (± ${m.schaden.genau} m)` : ''}` : null]),
    `Baumart: ${d.species}`,
    d.menge ? `Menge grob: ca. ${d.menge} Fm` : null,
    d.baeume ? `Anzahl Bäume: ca. ${d.baeume}` : null,
    `Festgestellt am: ${new Date(m.date).toLocaleDateString('de-DE')}`,
    d.text ? `Beschreibung: ${d.text}` : null,
    '',
    'Bitte um Rückmeldung zur Aufarbeitung und Vermarktung.',
    f.absender ? `${f.absender}${f.tel ? `, Tel. ${f.tel}` : ''}` : null,
    '(gesendet mit der WaldWächter-App)',
  ].filter((x) => x != null).join('\n');
  const ok = await meldungSenden({ betreff: `Schadensmeldung ${d.schaden}${p ? ` – Flst. ${p.nr} ${p.gemarkung}` : ''}`, text, fotoKey: `m:${m.id}` });
  if (ok) store.update((s) => { const x = s.measures.find((y) => y.id === measureId); if (x) { x.schaden = { ...(x.schaden || {}), gemeldet: Date.now() }; x.details = { ...x.details, gemeldet: new Date().toLocaleDateString('de-DE') }; } });
}

// ---------- Holz verkaufen ----------
export async function openHolzVerkaufen({ parcelId = null, species = '', menge = '' } = {}) {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter((p) => byId[p.id] && passtFlurstueck(p));
  const w = { parcelId: parcelId || mine[0]?.id || null, species: species || 'Fichte', menge: menge || '', stand: 'stehend', wann: 'bald', text: '' };
  const ok = await dialog({
    title: 'Holz verkaufen',
    body: h('div', { class: 'form' },
      h('p', { class: 'muted' }, `Die Anfrage geht an ${fbg().name}. Sie meldet sich mit einem Angebot oder Termin.`),
      h('label', {}, 'Flurstück', h('select', { onchange: (e) => { w.parcelId = e.target.value || null; } }, h('option', { value: '' }, 'ohne Flurstück'), mine.map((p) => h('option', { value: p.id, selected: p.id === w.parcelId }, `Flurstück ${p.nr}, ${p.gemarkung}`)))),
      h('div', { class: 'form-row' },
        h('label', {}, 'Baumart', h('select', { onchange: (e) => { w.species = e.target.value; } }, SPECIES.map((s) => h('option', { selected: s === w.species }, s)))),
        h('label', {}, 'Menge geschätzt (Fm)', h('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: w.menge, oninput: (e) => { w.menge = e.target.value; } }))),
      h('label', {}, 'Das Holz ist', h('select', { onchange: (e) => { w.stand = e.target.value; } },
        [['stehend', 'noch stehend (Einschlag nötig)'], ['liegend', 'schon gefällt / gepoltert'], ['kalamitaet', 'Schadholz (Käfer, Sturm)']].map(([k, l]) => h('option', { value: k }, l)))),
      h('label', {}, 'Wann', h('select', { onchange: (e) => { w.wann = e.target.value; } }, [['bald', 'so bald wie möglich'], ['saison', 'in der nächsten Einschlagsaison'], ['offen', 'zeitlich offen']].map(([k, l]) => h('option', { value: k }, l)))),
      h('label', {}, 'Bemerkung', h('textarea', { rows: 2, oninput: (e) => { w.text = e.target.value; } }))),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'Anfrage senden', value: true, primary: true }],
  });
  if (!ok) return;
  const p = w.parcelId ? byId[w.parcelId] : null;
  const standText = { stehend: 'noch stehend', liegend: 'gefällt / gepoltert', kalamitaet: 'Schadholz' }[w.stand];
  const wannText = { bald: 'so bald wie möglich', saison: 'nächste Einschlagsaison', offen: 'zeitlich offen' }[w.wann];
  const text = [`Anfrage Holzverkauf`, `Ort: ${flaechenText(p)}`, p ? `Karte: ${kartenLink(centroid(p.ring))}` : null, `Baumart: ${w.species}`,
    w.menge ? `Menge geschätzt: ca. ${w.menge} Fm` : null, `Zustand: ${standText}`, `Zeitraum: ${wannText}`, w.text ? `Bemerkung: ${w.text}` : null, '',
    fbg().absender ? `${fbg().absender}${fbg().tel ? `, Tel. ${fbg().tel}` : ''}` : null, '(gesendet mit der WaldWächter-App)'].filter((x) => x != null).join('\n');
  const gesendet = await meldungSenden({ betreff: `Holzverkauf ${w.species}${p ? ` – Flst. ${p.nr} ${p.gemarkung}` : ''}`, text });
  if (gesendet) {
    store.update((s) => s.measures.push({ id: uid(), type: 'holzverkauf', parcelId: w.parcelId, date: Date.now(), status: 'geplant', createdAt: Date.now(), note: w.text.trim(),
      details: { species: w.species, menge: w.menge, zustand: standText, wann: wannText, gemeldet: new Date().toLocaleDateString('de-DE') } }));
    toast('Anfrage gespeichert – sie steht unter Maßnahmen');
  }
}
