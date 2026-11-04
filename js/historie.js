// Flurstückhistorie: alle eigenen Flurstücke und je Flurstück alle Maßnahmen (Vollzug) mit Fläche und Angaben.
import { h, fill, icon, openPage, fmtDate, toast } from './ui.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { formatHa } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { miniKarte, flaecheVon, betrifftFlurstueck } from './flaeche.js';
import { openVerlauf } from './vertraeglichkeit.js';
import { openThinningWizard } from './thinning/wizard.js';
import { fmt, bLabel, HOEHENKLASSEN } from './thinning/methode.js';

const STATUS = { geplant: 'Geplant', arbeit: 'In Arbeit', fertig: 'Abgeschlossen' };
const euro = (v) => `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const datumVon = (m) => m.finishedAt || m.date || m.createdAt;

let typen = null;
async function measureTypes() { typen ??= (await import('./measures.js')).MEASURE_TYPES; return typen; }

export async function openFlurstueckHistorie() {
  const [all, T] = await Promise.all([source.allParcels(), measureTypes()]);
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = store.get().parcels.map((p) => byId[p.id] || p).filter((p) => p?.ring);
  const body = h('div', { class: 'historie' });
  openPage('Flurstückhistorie', body);
  const ms = store.get().measures;
  fill(body,
    h('p', { class: 'muted' }, 'Alle Flurstücke, die du zu deinen Flächen hinzugefügt hast – mit allen Maßnahmen, die darauf geplant oder erledigt wurden.'),
    mine.length
      ? h('ul', { class: 'parcel-list historie-list' }, mine.map((p) => {
          const eig = ms.filter((m) => betrifftFlurstueck(m, p));
          const fertig = eig.filter((m) => m.status === 'fertig').length;
          const letzte = eig.map(datumVon).filter(Boolean).sort((a, b) => b - a)[0];
          return h('li', {}, h('button', { class: 'historie-item', onclick: () => openDetail(p, T) },
            h('span', { class: 'hi-main' }, h('strong', {}, `Flurstück ${p.nr}`), h('span', {}, `${p.gemarkung}, Flur ${p.flur} · ${formatHa(amtlicheFlaecheHa(p))}`)),
            h('span', { class: 'hi-side' }, h('b', {}, eig.length), h('small', {}, eig.length === 1 ? 'Maßnahme' : 'Maßnahmen'),
              eig.length ? h('small', {}, `${fertig} erledigt${letzte ? ` · zuletzt ${fmtDate(letzte)}` : ''}`) : null),
            h('span', { class: 'hi-arrow', html: icon.chevron || '›' })));
        }))
      : h('div', { class: 'empty' }, h('p', {}, 'Du hast noch keine Flurstücke zu deinen Flächen hinzugefügt. Füge sie auf der Startseite über die Karte oder die Suche hinzu.')),
  );
}

function openDetail(p, T) {
  const body = h('div', { class: 'historie-detail' });
  const mapEl = h('div', { class: 'mini-map historie-map' });
  const listHost = h('div');
  const page = openPage(`Flurstück ${p.nr}`, body, { onClose: () => karte?.remove() });
  body.append(
    h('div', { class: 'historie-kopf' }, mapEl,
      h('p', { class: 'muted map-legende' }, h('span', { class: 'sw sw-flst' }), 'Flurstück ', h('span', { class: 'sw sw-mn' }), 'Fläche der gewählten Maßnahme')),
    h('dl', { class: 'parcel-facts' },
      h('div', {}, h('dt', {}, 'Gemarkung / Flur'), h('dd', {}, `${p.gemarkung}, Flur ${p.flur}`)),
      h('div', {}, h('dt', {}, 'Fläche (amtlich)'), h('dd', {}, formatHa(amtlicheFlaecheHa(p)))),
      p.nutzungText ? h('div', {}, h('dt', {}, 'Nutzung laut ALKIS'), h('dd', {}, p.nutzungText)) : null),
    listHost);
  const karte = miniKarte(mapEl, p);
  let offen = null;

  function render() {
    const eig = store.get().measures.filter((m) => betrifftFlurstueck(m, p)).sort((a, b) => (datumVon(b) || 0) - (datumVon(a) || 0));
    const summeKosten = eig.reduce((s, m) => s + (Number(m.kosten) || 0), 0);
    fill(listHost,
      h('h2', { class: 'section-title' }, 'Maßnahmen nach Datum'),
      summeKosten ? h('p', { class: 'muted' }, `Kosten aller Maßnahmen: ${euro(summeKosten)}`) : null,
      eig.length
        ? h('ul', { class: 'measure-list historie-massnahmen' }, eig.map((m) => {
            const auf = offen === m.id;
            return h('li', { class: `measure measure-${m.status} ${auf ? 'offen' : ''}` },
              h('button', { class: 'hm-kopf', 'aria-expanded': String(auf), onclick: () => { offen = auf ? null : m.id; karte.zeige(auf ? null : flaecheVon(m, p)); render(); } },
                h('span', { class: 'hm-datum' }, datumVon(m) ? fmtDate(datumVon(m)) : 'ohne Datum'),
                h('strong', {}, T[m.type]?.label || m.type),
                h('span', { class: `badge badge-${m.status}` }, STATUS[m.status])),
              auf ? details(m, p, T) : null);
          }))
        : h('div', { class: 'empty' }, h('p', {}, 'Auf diesem Flurstück gibt es noch keine Maßnahmen.')),
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
      const einheit = /\(([^)]{1,4})\)$/.exec(label)?.[1];
      z(label === 'Fläche (ha)' ? 'Angegebene Fläche' : label.replace(/ \(.*\)/, ''), einheit ? `${v} ${einheit}` : v);
    }
    const t = m.thinning, pl = t?.plan;
    if (pl) {
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
    if (m.serie) {
      const done = Object.entries(m.erledigt || {}).sort((a, b) => b[1] - a[1]);
      z('Kontrollen erledigt', done.length ? done.map(([k, ts]) => `${k.startsWith('winter') ? 'unbelaubt' : 'belaubt'} ${k.split('-').slice(1).join('/')}: ${fmtDate(ts)}`).join('; ') : 'noch keine');
    }
    if (m.note) z('Notiz', m.note);
    const kostenIn = h('input', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01', value: m.kosten ?? '', placeholder: '0,00',
      onchange: (e) => { const v = e.target.value === '' ? null : Number(e.target.value); store.update((s) => { const x = s.measures.find((y) => y.id === m.id); if (x) x.kosten = v; }); toast('Kosten gespeichert'); } });
    return h('div', { class: 'hm-details' },
      h('dl', { class: 'parcel-facts' }, zeilen),
      h('label', { class: 'kosten-feld' }, 'Kosten (€)', kostenIn),
      h('div', { class: 'measure-actions' },
        m.type === 'durchforstung' ? h('button', { class: 'btn', onclick: () => { page.close(); openThinningWizard({ measureId: m.id }); } }, m.status === 'fertig' ? 'Durchforstung ansehen' : 'Durchforstung öffnen') : null,
        h('button', { class: 'btn', onclick: () => openVerlauf(m.id) }, m.anhaenge?.length ? `Verlauf · ${m.anhaenge.length} Anhang${m.anhaenge.length > 1 ? 'e' : ''}` : 'Verlauf')));
  }
}
