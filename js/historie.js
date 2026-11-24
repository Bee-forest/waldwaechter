// Flurstückhistorie: alle eigenen Flurstücke und je Flurstück alle Maßnahmen (Vollzug) mit Fläche und Angaben.
import { openProtokoll, protokollKurz, openMassnahmeBearbeiten } from './massnahme-protokoll.js';
import { h, fill, icon, openPage, fmtDate, toast } from './ui.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { formatHa } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { miniKarte, flaecheVon, betrifftFlurstueck } from './flaeche.js';
import { openVerlauf, anhangOeffnen } from './vertraeglichkeit.js';
import { openThinningWizard } from './thinning/wizard.js';
import { fmt, bLabel, HOEHENKLASSEN } from './thinning/methode.js';
import { passtFlurstueck } from './profi.js';
import { notizDialog, fotopunktAnlegen, fotopunkteAbschnitt, notizZeile, fotopunktFotos, fotopunktAufKarteVerschieben } from './tagebuch.js';
import { createFotopunktLayer } from './map/fotopunkte.js';
import { openNavigation } from './grenzfinder.js';

const STATUS = { geplant: 'Geplant', arbeit: 'In Arbeit', fertig: 'Abgeschlossen' };
const euro = (v) => `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const datumVon = (m) => m.finishedAt || m.date || m.createdAt;

let typen = null;
async function measureTypes() { typen ??= (await import('./measures.js')).MEASURE_TYPES; return typen; }

export async function openFlurstueckHistorie() {
  const [all, T] = await Promise.all([source.allParcels(), measureTypes()]);
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.filter(passtFlurstueck).map((p) => byId[p.id] || p).filter((p) => p?.ring);
  const body = h('div', { class: 'historie' });
  openPage('Flurstückhistorie', body);
  const ms = store.get().measures;
  fill(body,
    h('p', { class: 'muted' }, 'Alle deine Flurstücke mit ihrer Geschichte: Maßnahmen, Tagebuch-Einträge mit Fotos und Fotopunkte – auch für Erben oder einen Verkauf.'),
    mine.length
      ? h('ul', { class: 'parcel-list historie-list' }, mine.map((p) => {
          const eig = ms.filter((m) => betrifftFlurstueck(m, p));
          const notizen = (store.get().tagebuch || []).filter((e) => e.parcelId === p.id).length;
          const fertig = eig.filter((m) => m.status === 'fertig').length;
          const letzte = eig.map(datumVon).filter(Boolean).sort((a, b) => b - a)[0];
          return h('li', {}, h('button', { class: 'historie-item', onclick: () => openDetail(p, T) },
            h('span', { class: 'hi-main' }, h('strong', {}, `Flurstück ${p.nr}`), h('span', {}, `${p.gemarkung}, Flur ${p.flur} · ${formatHa(amtlicheFlaecheHa(p))}`)),
            h('span', { class: 'hi-side' }, h('b', {}, eig.length), h('small', {}, eig.length === 1 ? 'Maßnahme' : 'Maßnahmen'),
              eig.length ? h('small', {}, `${fertig} erledigt${letzte ? ` · zuletzt ${fmtDate(letzte)}` : ''}`) : null,
              notizen ? h('small', {}, `${notizen} Tagebuch-Eintr${notizen === 1 ? 'ag' : 'äge'}`) : null),
            h('span', { class: 'hi-arrow', html: icon.chevron || '›' })));
        }))
      : h('div', { class: 'empty' }, h('p', {}, 'Du hast noch keine Flurstücke zu deinen Flächen hinzugefügt. Füge sie auf der Startseite über die Karte oder die Suche hinzu.')),
  );
}

/** Flurstückhistorie eines Flurstücks direkt öffnen (z. B. aus der Infobox) */
export async function openHistorieFlurstueck(parcelId, { fotopunkt = null, neuerFotopunkt = null } = {}) {
  const [all, T] = await Promise.all([source.allParcels(), measureTypes()]);
  const p = all.find((x) => x.id === parcelId) || store.get().parcels.find((x) => x.id === parcelId);
  if (!p?.ring) { toast('Flurstück nicht gefunden'); return; }
  openDetail(p, T, { fotopunkt, neuerFotopunkt });
}

function openDetail(p, T, { fotopunkt = null, neuerFotopunkt = null } = {}) {
  const body = h('div', { class: 'historie-detail' });
  const mapEl = h('div', { class: 'mini-map historie-map' });
  const listHost = h('div');
  const fpLeiste = h('div', { class: 'fp-leiste' });
  const page = openPage(`Flurstück ${p.nr}`, body, { onClose: () => { fpLyr?.entfernen?.(); karte?.remove(); } });
  body.append(
    h('div', { class: 'historie-kopf' }, mapEl, fpLeiste,
      h('p', { class: 'muted map-legende' }, h('span', { class: 'sw sw-flst' }), 'Flurstück ', h('span', { class: 'sw sw-mn' }), 'Fläche der gewählten Maßnahme')),
    h('h2', { class: 'section-title flst-titel' }, 'Angaben zum Flurstück'),
    h('dl', { class: 'parcel-facts' },
      h('div', {}, h('dt', {}, 'Gemarkung / Flur'), h('dd', {}, `${p.gemarkung}, Flur ${p.flur}`)),
      h('div', {}, h('dt', {}, 'Fläche (amtlich)'), h('dd', {}, formatHa(amtlicheFlaecheHa(p)))),
      p.nutzungText ? h('div', {}, h('dt', {}, 'Nutzung laut ALKIS'), h('dd', {}, p.nutzungText)) : null),
    listHost);
  const karte = miniKarte(mapEl, p);
  // Fotopunkte direkt in dieser Karte zeigen, setzen und ändern
  let ohneId = null;
  const ort = {
    map: karte.map, leiste: fpLeiste,
    ohne: (id) => { ohneId = id; fpLyr.neuZeichnen(); },
    zeige: (f) => { mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); karte.map.flyTo(f.at, Math.max(karte.map.getZoom(), 18), { duration: 0.6 }); },
  };
  const fpLyr = createFotopunktLayer(karte.map, {
    fotos: (f) => fotopunktFotos(f),
    hinfuehren: (f) => openNavigation({ titel: f.name || 'Fotopunkt', ziel: f.at, zielName: f.name || 'Fotopunkt', blick: f.blick, parcel: p }),
    verschieben: (f) => fotopunktAufKarteVerschieben(f, p, ort),
  }, { ohne: () => ohneId }).addTo(karte.map);
  // direkt einen neuen Fotopunkt setzen (z. B. aus einer Maßnahme heraus); danach Rückmeldung mit der ID
  if (neuerFotopunkt) setTimeout(async () => { const id = await fotopunktAnlegen(p.id, p, ort); if (id) { page.close(); neuerFotopunkt(id); } }, 400);
  if (fotopunkt) { const f = (store.get().fotopunkte || []).find((x) => x.id === fotopunkt); if (f) setTimeout(() => fotopunktAufKarteVerschieben(f, p, ort), 400); }
  let offen = null;

  function render() {
    const eig = store.get().measures.filter((m) => betrifftFlurstueck(m, p)).sort((a, b) => (datumVon(b) || 0) - (datumVon(a) || 0));
    const summeKosten = eig.reduce((s, m) => s + (Number(m.kosten) || 0), 0);
    const notizen = (store.get().tagebuch || []).filter((e) => e.parcelId === p.id);
    const titel = `Flurstück ${p.nr}, ${p.gemarkung}`;
    // Maßnahmen und Tagebuch zusammen nach Datum
    const chronik = [...eig.map((m) => ({ ts: datumVon(m) || 0, m })), ...notizen.map((e) => ({ ts: e.datum, e }))].sort((a, b) => b.ts - a.ts);
    fill(listHost,
      h('div', { class: 'btn-row historie-aktionen' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => notizDialog(p.id) }, 'Tagebuch-Eintrag schreiben'),
        h('button', { type: 'button', class: 'btn', onclick: () => fotopunktAnlegen(p.id, p, ort) }, 'Fotopunkt anlegen')),
      fotopunkteAbschnitt(p, ort),
      h('h2', { class: 'section-title' }, 'Chronik: Maßnahmen und Tagebuch'),
      summeKosten ? h('p', { class: 'muted' }, `Kosten aller Maßnahmen: ${euro(summeKosten)}`) : null,
      chronik.length
        ? h('ul', { class: 'measure-list historie-massnahmen' }, chronik.map(({ m, e }) => {
            if (e) return notizZeile(e, titel);
            const auf = offen === m.id;
            return h('li', { class: `measure measure-${m.status} ${auf ? 'offen' : ''}` },
              h('button', { class: 'hm-kopf', 'aria-expanded': String(auf), onclick: () => { offen = auf ? null : m.id; karte.zeige(auf ? null : flaecheVon(m, p)); render(); } },
                h('span', { class: 'hm-datum' }, datumVon(m) ? fmtDate(datumVon(m)) : 'ohne Datum'),
                h('strong', {}, T[m.type]?.label || m.type),
                h('span', { class: `badge badge-${m.status}` }, STATUS[m.status])),
              auf ? details(m, p, T) : null);
          }))
        : h('div', { class: 'empty' }, h('p', {}, 'Noch keine Maßnahmen und keine Tagebuch-Einträge. Schreib auf, was du im Wald beobachtet oder gemacht hast – mit Fotos.')),
    );
  }
  render();
  store.subscribe(() => { if (body.isConnected) render(); });

  function details(m, parcel, T) {
    const fl = flaecheVon(m, parcel);
    const zeilen = [];
    const z = (k, v) => { if (v != null && v !== '') zeilen.push(h('div', {}, h('dt', {}, k), h('dd', {}, v))); };
    z('Termin', m.date ? fmtDate(m.date) : (m.serie ? 'wiederkehrend' : 'offen'));
    z('Angelegt', fmtDate(m.createdAt));
    if (m.finishedAt) z('Abgeschlossen', fmtDate(m.finishedAt));
    if (fl) z('Fläche', `${fl.art}, ${formatHa(fl.ha)}`);
    for (const [k, label, kind] of T[m.type]?.fields || []) {
      const v = m.details?.[k];
      if (v === '' || v == null) continue;
      const einheit = /\(([^)]{1,8})\)$/.exec(label)?.[1];
      z(label === 'Fläche (ha)' ? 'Angegebene Fläche' : label.replace(/ \(.*\)/, ''), einheit && !/je /.test(einheit) ? `${v} ${einheit}` : v);
    }
    const t = m.thinning, pl = t?.plan;
    if (pl?.methode === 'f4') {
      const pts = pl.points || [], pr = t.params || {}, pg = pl.planung || {}, e = t.f4;
      const m3 = (v, d = 1) => Number(v || 0).toLocaleString('de-DE', { maximumFractionDigits: d });
      z('Baumart', `${pr.art || ''}${pg.gruppe ? ` (Gruppe ${pg.gruppe})` : ''}`);
      z('Angaben', [`Oberhöhe ${m3(pr.ho)} m`, `B° ${m3(pr.b, 2)}`, pg.szenario ? `Szenario ${pg.szenario}` : null].filter(Boolean).join(' · '));
      z('Zielmenge', `${m3(pg.zielmenge)} m³/ha im Jahrzehnt, ${pg.eingriffe} Eingriff${pg.eingriffe > 1 ? 'e' : ''}`);
      if (pl.eingriffe) z('Eingriff', `${pl.eingriffe.nr || 1} von ${pl.eingriffe.anzahl}`);
      z('Menge dieses Eingriffs', `${m3(pg.mengeHa, 2)} m³/ha = ${m3(pg.budget, 2)} m³`);
      z('Rasterpunkte', `${pts.filter((x) => x.status === 'done').length} von ${pts.length} erledigt (Raster ${m3(pl.raster, 0)} m)`);
      if (e) z('Gezählt', `${m3(e.gezaehlt, 2)} m³ (${m3(e.gezaehltHa, 1)} m³/ha), ${e.baeume} Bäume – vorsichtige Schätzung, geerntet wird meist etwas weniger`);
      if (t.natura2000?.length) z('Schutzgebiet', t.natura2000.map((g) => `${g.art} „${g.name || 'ohne Namen'}“`).join(', '));
    } else if (pl) {
      const pts = pl.points || [];
      const erledigt = pts.filter((x) => x.status === 'done').length;
      const entnommen = pts.reduce((s, x) => s + x.removals.reduce((a, r) => a + (r.marked || 0), 0), 0);
      const pr = t.params || {};
      z('Baumart', pr.art || pl.gruppeLabel);
      z('Angaben', [pl.szenario ? `Szenario ${pl.szenario}` : null, pr.b != null ? `B° ${bLabel(pr.b)}` : null, pr.hoKlasse ? `Oberhöhe ${HOEHENKLASSEN.find((x) => x.key === pr.hoKlasse)?.label || ''}` : null].filter(Boolean).join(' · '));
      if (pl.eingriffe) z('Eingriff', `${pl.eingriffe.nr || 1} von ${pl.eingriffe.anzahl}`);
      if (pl.wald?.status === 'teil') z('Davon Waldfläche', `ca. ${formatHa(pl.wald.waldHa)}`);
      z('Rasterpunkte', `${erledigt} von ${pts.length} erledigt (Raster ${fmt(pl.raster || 25, 1)} m)`);
      z('Entnahme geplant', `${pl.total} Bäume${pl.eingriffe?.vEingriff ? `, ca. ${fmt(pl.eingriffe.vEingriff * pl.areaHa)} Fm (${fmt(pl.eingriffe.vEingriff)} Fm/ha)` : ''}`);
      z('Entnommen (markiert)', `${entnommen} Bäume${pl.total ? ` (${Math.round((entnommen / pl.total) * 100)} %)` : ''}`);
      if (pl.stufe) z('Ziel-Entnahme Grundfläche', `${fmt(pl.stufe, 1)} m²/ha`);
      if (t.natura2000?.length) z('Schutzgebiet', t.natura2000.map((g) => `${g.art} „${g.name || 'ohne Namen'}“`).join(', '));
    }
    if (m.zaun?.material?.length) {
      z('Zaunform', `${m.zaun.geschlossen ? 'Gatter (geschlossen)' : 'Zaunlinie (offen)'}, ${m.zaun.ecken} Ecken`);
      z('Material', h('ul', { class: 'mat-kurz' }, m.zaun.material.map((x) => h('li', {}, `${x.menge.toLocaleString('de-DE')} ${x.einheit} ${x.name}${x.preis != null ? ` à ${euro(x.preis)} = ${euro(x.preis * x.menge)}` : ' (ohne Preis)'}`))));
    }
    if (m.serie) {
      const done = Object.entries(m.erledigt || {}).sort((a, b) => b[1] - a[1]);
      z('Kontrollen erledigt', done.length ? done.map(([k, ts]) => `${k.startsWith('winter') ? 'unbelaubt' : 'belaubt'} ${k.split('-').slice(1).join('/')}: ${fmtDate(ts)}`).join('; ') : 'noch keine');
    }
    if (m.note) z('Notiz', m.note);
    if (m.protokoll) z('Abschlussprotokoll', protokollKurz(m.protokoll) + (m.protokoll.auffaellig ? ` – ${m.protokoll.auffaellig}` : ''));
    const kostenIn = h('input', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01', value: m.kosten ?? '', placeholder: '0,00',
      onchange: (e) => { const v = e.target.value === '' ? null : Number(e.target.value); store.update((s) => { const x = s.measures.find((y) => y.id === m.id); if (x) x.kosten = v; }); toast('Kosten gespeichert'); } });
    return h('div', { class: 'hm-details' },
      h('dl', { class: 'parcel-facts' }, zeilen),
      h('label', { class: 'kosten-feld' }, 'Kosten (€)', kostenIn),
      h('div', { class: 'measure-actions' },
        m.type === 'durchforstung' ? h('button', { class: 'btn', onclick: () => { page.close(); openThinningWizard({ measureId: m.id }); } }, m.status === 'fertig' ? 'Durchforstung ansehen' : 'Durchforstung öffnen') : null,
        m.status === 'fertig' && !m.serie ? h('button', { class: 'btn', onclick: () => openProtokoll(m.id) }, m.protokoll ? 'Protokoll ansehen' : 'Protokoll ausfüllen') : null,
        m.status !== 'fertig' && m.type !== 'durchforstung' ? h('button', { class: 'btn', onclick: () => openMassnahmeBearbeiten(m.id) }, 'Bearbeiten') : null,
        h('button', { class: 'btn', onclick: () => openVerlauf(m.id) }, m.anhaenge?.length ? `Verlauf · ${m.anhaenge.length} Anhang${m.anhaenge.length > 1 ? 'e' : ''}` : 'Verlauf'),
        m.anhaenge?.some((a) => a.typ === 'pflanzplan') ? h('button', { class: 'btn', onclick: () => anhangOeffnen(m.id, [...m.anhaenge].reverse().find((a) => a.typ === 'pflanzplan')) }, 'Pflanzplan (PDF)') : null));
  }
}
