// Schutzgebiete für alle Maßnahmen prüfen (nicht nur bei der Durchforstung mit GPS):
// Läuft im Hintergrund, sobald eine Maßnahme gebucht oder ihre Fläche geändert wurde. Das Ergebnis steht an der
// Maßnahme (m.schutzgebiete). Liegt ein Eingriff (Durchforstung, Pflege) in einem FFH-, Vogelschutz- oder
// Naturschutzgebiet und in der Brut- und Setzzeit, fragt die App: verschieben oder Verträglichkeits-Vorprüfung.
import { h, dialog, toast } from './ui.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { schutzgebieteInFlaeche, vorpruefungNoetig, strengeGebiete, gebieteText, schutzzeitVon, schutzzeitText, nachBrutzeit, datumText } from './schutzgebiete.js';

const schluessel = (m) => {
  const r = m.flaeche?.ring;
  return r?.length ? `t:${r.length}:${r[0].map((x) => x.toFixed(5)).join(',')}` : m.parcelId ? `p:${m.parcelId}` : null;
};
const zuPruefen = (m) => m.type !== 'durchforstung' && m.status !== 'fertig' && !m.serie && schluessel(m) && m.schutzKey !== schluessel(m);

let laeuft = false, nochmal = false;
const gefragt = new Set();

async function pruefeAlle() {
  if (laeuft) { nochmal = true; return; }
  laeuft = true;
  try {
    const offen = store.get().measures.filter(zuPruefen);
    if (!offen.length) return;
    const parcels = Object.fromEntries((await source.allParcels()).map((p) => [p.id, p]));
    for (const m of offen) {
      const key = schluessel(m);
      const sel = m.flaeche?.ring?.length ? { ring: m.flaeche.ring, polys: (m.flaeche.ringe?.length ? m.flaeche.ringe : [m.flaeche.ring]).map((r) => [r]) } : parcels[m.parcelId];
      if (!sel?.ring?.length) continue;
      let erreichbar = false;
      const gebiete = await schutzgebieteInFlaeche(sel, { meldeErreichbar: (x) => { erreichbar = x; } }).catch(() => []);
      if (!erreichbar) continue; // offline oder Dienst gestört: später erneut versuchen
      const kurz = gebiete.map(({ layer, art, name, code, props }) => ({ layer, art, name, code, props: { siteName: props?.siteName, legalFoundationDocument: props?.legalFoundationDocument, legalFoundationDate: props?.legalFoundationDate, localId: props?.localId } }));
      store.update((s) => { const x = s.measures.find((y) => y.id === m.id); if (x) { x.schutzgebiete = kurz; x.schutzKey = key; x.schutzGeprueft = Date.now(); } });
      const neu = store.get().measures.find((y) => y.id === m.id);
      // Frisch gebucht und Termin in der Brut- und Setzzeit: gleich nachfragen
      if (neu && vorpruefungNoetig(neu) && Date.now() - (neu.geaendert || neu.createdAt || 0) < 10 * 60 * 1000 && !gefragt.has(neu.id)) {
        gefragt.add(neu.id);
        brutzeitDialog(neu);
      }
    }
  } finally {
    laeuft = false;
    if (nochmal) { nochmal = false; setTimeout(pruefeAlle, 500); }
  }
}

/** Nachfrage: Termin verschieben oder Vorprüfung ausfüllen */
export async function brutzeitDialog(m) {
  const sz = schutzzeitVon(m);
  const w = await dialog({
    title: 'Termin in der Brut- und Setzzeit',
    body: h('div', {},
      h('p', {}, `Die Fläche liegt im ${gebieteText(strengeGebiete(m.schutzgebiete || m.thinning?.natura2000))}. Der geplante Termin fällt in die Brut- und Setzzeit (${schutzzeitText(sz)}).`),
      h('p', {}, 'Lege den Eingriff am besten außerhalb dieser Zeit. Ist das nicht zu umgehen, ist eine Verträglichkeits-Vorprüfung nötig.')),
    actions: [{ label: 'Später', value: null }, { label: `Auf ${datumText(nachBrutzeit(m.date, sz))} verschieben`, value: 'verschieben' }, { label: 'Vorprüfung ausfüllen', value: 'pruefung', primary: true }],
  });
  if (w === 'verschieben') { store.update((s) => { const x = s.measures.find((y) => y.id === m.id); if (x) x.date = nachBrutzeit(m.date, sz); }); toast('Termin verschoben'); }
  else if (w === 'pruefung') import('./vertraeglichkeit.js').then((v) => v.openVertraeglichkeit(m.id));
}

// Frisch gebuchte Maßnahme: Arbeitsauftrag mit Karte gleich erstellen und anhängen (Verlauf und Anhänge).
// Wartet kurz auf die Schutzgebietsprüfung, damit Schutzgebiete im Auftrag stehen.
const versucht = new Set();
const auftragFaellig = (m) => !m.auftragStand && !m.serie && !versucht.has(m.id) && !['schaden', 'holzverkauf', 'polter'].includes(m.type)
  && Date.now() - (m.createdAt || 0) < 10 * 60 * 1000 && (m.parcelId || m.flaeche?.ring);
function auftraegeErstellen() {
  for (const m of store.get().measures.filter(auftragFaellig)) {
    versucht.add(m.id);
    setTimeout(() => import('./berichte.js').then((b) => b.unternehmerAuftrag(m.id, { anhaengen: true })).catch(() => {}), m.schutzKey || m.type === 'durchforstung' ? 0 : 6000);
  }
}

export function schutzpruefungStarten() {
  let t = null;
  const anstossen = () => { clearTimeout(t); t = setTimeout(pruefeAlle, 800); };
  store.subscribe(() => { if (store.get().measures.some(zuPruefen)) anstossen(); if (store.get().measures.some(auftragFaellig)) auftraegeErstellen(); });
  window.addEventListener('online', anstossen);
  anstossen();
}

/** Hinweisbox beim Anlegen: welche Schutzgebiete liegen auf der Fläche? (füllt sich, sobald die Abfrage fertig ist) */
export function schutzHinweis(sel, { eingriff = false } = {}) {
  const box = h('div', { class: 'schutz-hinweis' }, h('p', { class: 'muted small' }, 'Schutzgebiete werden geprüft …'));
  if (!sel?.ring?.length) { box.replaceChildren(); return box; }
  let erreichbar = false;
  import('./schutzgebiete.js').then(async ({ schutzgebieteInFlaeche, strengeGebiete, gebieteText, zeigeVerordnung, schutzzeitText }) => {
    const g = await schutzgebieteInFlaeche(sel, { meldeErreichbar: (x) => { erreichbar = x; } }).catch(() => []);
    if (!erreichbar) { box.replaceChildren(h('p', { class: 'muted small' }, 'Schutzgebiete konnten gerade nicht geprüft werden (offline?). Die App prüft später automatisch.')); return; }
    if (!g.length) { box.replaceChildren(h('p', { class: 'muted small' }, 'Kein Schutzgebiet auf dieser Fläche.')); return; }
    const streng = strengeGebiete(g);
    box.replaceChildren(h('div', { class: `lrt-hinweis brutzeit ${streng.length && eingriff ? '' : 'ok'}` },
      h('strong', {}, `Die Fläche liegt im ${gebieteText(g)}.`),
      h('p', {}, streng.length && eingriff
        ? `Die Verordnung kann Eingriffe einschränken. Fällungen und Pflege möglichst außerhalb der Brut- und Setzzeit (${schutzzeitText()}) legen – sonst ist eine Verträglichkeits-Vorprüfung nötig.`
        : 'Die Verordnung kann Erlaubnispflichten oder Verbote enthalten (z. B. für Kahlschlag, Wegebau, Baumartenwahl). Bitte vorher lesen.'),
      h('div', { class: 'btn-row' }, g.map((x) => h('button', { type: 'button', class: 'btn btn-small', onclick: () => zeigeVerordnung({ label: x.art, layer: x.layer, props: x.props, text: '' }) }, `Verordnung: ${x.name || x.art}`)))));
  });
  return box;
}
