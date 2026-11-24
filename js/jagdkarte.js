// Revierkarte: jagdliche Einrichtungen auf ausgewählten Flurstücken als PDF-Karte.
// Wählbar: Flurstücke, Hintergrund (Luftbild/OSM), weitere Ebenen (Rückegassen und Lagerplätze,
// Waldwege aus OpenStreetMap, Habitatbäume) und ob die Bezeichnungen der Einrichtungen beschriftet werden.
import { h, dialog, toast } from './ui.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { Pdf, herunterladen } from './pdf.js';
import { KARTEN_QUELLE } from './kartenbild.js';
import { polysOf, inPolys, bbox } from './geo.js';
import { pdfKarte, ringeZeichnen, linieZeichnen, punkt } from './berichte.js';
import { ARTEN, JAGD_ZUSTAND } from './map/punkte.js';
import { passtFlurstueck } from './profi.js';

const GRUEN = [27, 77, 46], GRAU = [90, 100, 90];
const FARBE_TYP = { kanzel: [122, 63, 32], bock: [196, 98, 30], erdsitz: [95, 110, 60] };
const KUERZEL = { kanzel: 'K', bock: 'B', erdsitz: 'E' };
const typText = (t) => ARTEN.jagd.typen.find(([k]) => k === t)?.[1] || 'Einrichtung';
const zustandText = (k) => JAGD_ZUSTAND.find(([x]) => x === k)?.[1] || '–';

/** Waldwege (OSM: track, path, service, unclassified) im Ausschnitt; null bei Fehler */
/** Linie in feine Stücke teilen und nur die Teile im Kartenrahmen zeichnen (auch wenn die Endpunkte außerhalb liegen) */
function linieImRahmen(doc, k, pts, stil) {
  let lauf = [];
  const ende = () => { if (lauf.length > 1) linieZeichnen(doc, k.tr, lauf, stil); lauf = []; };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.00004)); // ~4 m
    for (let j = 0; j <= n; j++) {
      const q = [a[0] + (b[0] - a[0]) * (j / n), a[1] + (b[1] - a[1]) * (j / n)];
      if (k.drin(q)) lauf.push(q); else ende();
    }
  }
  ende();
}

async function osmWege([s, w, n, e]) {
  const q = `[out:json][timeout:20];way["highway"~"^(track|path|service|unclassified|residential|tertiary|secondary)$"](${s},${w},${n},${e});out geom;`;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return (j.elements || []).filter((x) => x.geometry).map((x) => ({ typ: x.tags?.highway, pts: x.geometry.map((g) => [g.lat, g.lon]) }));
  } catch { return null; }
}

export async function openJagdkarte() {
  const s = store.get();
  const alle = s.parcels.filter(passtFlurstueck);
  if (!alle.length) { toast('Lege zuerst Flurstücke an – die Karte zeigt die Einrichtungen auf deinen Flurstücken.'); return; }
  const jagd = (s.punkte?.jagd || []).filter((x) => x.at);
  const anzahlIn = (p) => jagd.filter((x) => inPolys(x.at, polysOf(p))).length;
  const w = {
    flst: new Set(alle.filter((p) => anzahlIn(p) > 0).map((p) => p.id)),
    basemap: s.settings?.basemap === 'osm' ? 'osm' : 'dop',
    gassen: true, wege: true, habitat: false, beschriftung: true, liste: true,
  };
  const check = (k, l, sub) => h('label', { class: 'jk-check' }, h('input', { type: 'checkbox', checked: w[k], onchange: (e) => { w[k] = e.target.checked; } }), h('span', {}, l, sub ? h('small', {}, sub) : null));
  const seg = () => h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Hintergrund' },
    [['dop', 'Luftbild'], ['osm', 'OSM-Karte']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(w.basemap === k), onclick: (e) => { w.basemap = k; [...e.currentTarget.parentNode.children].forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget))); } }, l)));
  const ok = await dialog({
    title: 'Revierkarte erstellen',
    body: h('div', { class: 'form jagdkarte-form' },
      h('p', { class: 'muted' }, 'Wähle die Flurstücke – alle dort erfassten jagdlichen Einrichtungen kommen auf die Karte.'),
      h('fieldset', { class: 'jk-flst' }, h('legend', {}, 'Flurstücke'),
        alle.map((p) => { const n = anzahlIn(p); return h('label', { class: 'jk-check' },
          h('input', { type: 'checkbox', checked: w.flst.has(p.id), onchange: (e) => { if (e.target.checked) w.flst.add(p.id); else w.flst.delete(p.id); } }),
          h('span', {}, `Flurstück ${p.nr}, ${p.gemarkung}`, h('small', {}, n ? `${n} ${n === 1 ? 'Einrichtung' : 'Einrichtungen'}` : 'keine Einrichtung'))); })),
      h('fieldset', {}, h('legend', {}, 'Hintergrund'), seg()),
      h('fieldset', {}, h('legend', {}, 'Weitere Ebenen'),
        check('gassen', 'Rückegassen und Lagerplätze', 'aus deiner Erschließung'),
        check('wege', 'Wege', 'Waldwege und Straßen aus OpenStreetMap'),
        check('habitat', 'Habitatbäume')),
      h('fieldset', {}, h('legend', {}, 'Beschriftung'),
        check('beschriftung', 'Bezeichnung an jeder Einrichtung', 'Name oder Art mit Nummer'),
        check('liste', 'Liste aller Einrichtungen', 'mit Zustand und letzter Kontrolle'))),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'PDF erstellen', value: true, primary: true }],
  });
  if (!ok) return;
  if (!w.flst.size) { toast('Bitte mindestens ein Flurstück wählen.'); return; }
  toast('Revierkarte wird erstellt …');
  try { await erstellen(w); } catch (e) { console.error(e); toast('Die Karte konnte nicht erstellt werden.'); }
}

async function erstellen(w) {
  const s = store.get();
  const all = await source.allParcels();
  const flst = [...w.flst].map((id) => all.find((p) => p.id === id) || s.parcels.find((p) => p.id === id)).filter(Boolean);
  const polysAlle = flst.map((p) => polysOf(p));
  const drinIrgendwo = (at) => polysAlle.some((pl) => inPolys(at, pl));
  const jagd = (s.punkte?.jagd || []).filter((x) => x.at && drinIrgendwo(x.at));
  // Nummern je Art: K1, K2 … B1 … E1
  const zaehler = {};
  const nummeriert = jagd.map((x) => { const k = KUERZEL[x.typ] || 'J'; zaehler[k] = (zaehler[k] || 0) + 1; return { ...x, nr: `${k}${zaehler[k]}` }; });
  const pts = polysAlle.flat(3);
  const { s: s0, w: w0, n: n0, e: e0 } = bbox(pts);
  const doc = new Pdf();
  const L = 40, R = 555;
  doc.text(L, 46, 'Revierkarte – jagdliche Einrichtungen', { bold: true, size: 17, farbe: GRUEN });
  doc.text(L, 62, `${flst.length} ${flst.length === 1 ? 'Flurstück' : 'Flurstücke'} · ${nummeriert.length} ${nummeriert.length === 1 ? 'Einrichtung' : 'Einrichtungen'} · Stand ${new Date().toLocaleDateString('de-DE')}`, { size: 9.5, farbe: GRAU });
  const kh = w.liste ? 560 : 700;
  const k = await pdfKarte(doc, { x: L, y: 74, w: R - L, h: kh, pts, basemap: w.basemap, rand: 24 });
  // Wege zuerst (unten), dann Flurstücke, Gassen, Punkte
  if (w.wege) {
    const pad = 0.004;
    const wege = await osmWege([s0 - pad, w0 - pad, n0 + pad, e0 + pad]);
    if (wege) for (const x of wege) {
      const breit = /secondary|tertiary|unclassified|residential/.test(x.typ);
      linieImRahmen(doc, k, x.pts, { w: breit ? 2.4 : 1.4, farbe: breit ? [255, 255, 255] : [250, 240, 200], strich: x.typ === 'path' ? [3, 2] : null });
    }
    else w.wegeFehler = true;
  }
  polysAlle.forEach((pl) => ringeZeichnen(doc, k.tr, pl, { stroke: [246, 211, 45], w: 2 }));
  if (w.gassen) {
    const E = s.erschliessung || {};
    (E.gassen || []).forEach((g) => linieImRahmen(doc, k, g.line || [], { w: 2, farbe: [141, 90, 43], strich: [5, 3] }));
    (E.lager || []).forEach((l) => l.at && k.drin(l.at) && punkt(doc, k.tr(l.at), [181, 101, 29], 4));
  }
  if (w.habitat) (s.punkte?.habitat || []).forEach((x) => x.at && k.drin(x.at) && punkt(doc, k.tr(x.at), [47, 143, 85], 3.2));
  for (const x of nummeriert) {
    if (!k.drin(x.at)) continue;
    const [a, b] = k.tr(x.at);
    const f = FARBE_TYP[x.typ] || [122, 63, 32];
    doc.rechteck(a - 6, b - 6, 12, 12, { fill: x.zustand === 'gesperrt' ? [150, 150, 150] : f, stroke: [255, 255, 255] });
    doc.text(a - 3.2, b + 3, KUERZEL[x.typ] || 'J', { bold: true, size: 7.5, farbe: [255, 255, 255] });
    if (w.beschriftung) {
      const t = x.name ? `${x.nr} ${x.name}` : x.nr;
      doc.rechteck(a + 8, b - 6, Math.min(160, t.length * 4.3 + 6), 12, { fill: [255, 255, 255] });
      doc.text(a + 11, b + 3, t.slice(0, 36), { size: 7.5, bold: true });
    }
  }
  let y = 74 + kh + 12;
  const leg = ['K = Kanzel', 'B = Drückjagdbock', 'E = Erdsitz', 'grau = gesperrt', 'gelb = Flurstück', ...(w.gassen ? ['braun gestrichelt = Rückegasse', 'braun = Lagerplatz'] : []), ...(w.habitat ? ['grün = Habitatbaum'] : [])];
  doc.text(L, y, `Legende: ${leg.join(' · ')}`, { size: 7.5, farbe: GRAU }); y += 11;
  doc.text(L, y, `Hintergrund: ${KARTEN_QUELLE[w.basemap]}${w.wege ? (w.wegeFehler ? ' · Wege konnten nicht geladen werden' : ' · Wege © OpenStreetMap-Mitwirkende (ODbL)') : ''}`, { size: 7, farbe: GRAU }); y += 16;
  if (w.liste && nummeriert.length) {
    const zeile = (cols, bold = false) => {
      if (y > 805) { doc.neueSeite(); y = 50; }
      const xs = [L, L + 34, L + 120, L + 290, L + 400];
      cols.forEach((c, i) => doc.text(xs[i], y, String(c ?? '–').slice(0, i === 2 ? 34 : 26), { size: 8.5, bold }));
      y += 13;
    };
    doc.text(L, y, 'Einrichtungen', { bold: true, size: 11, farbe: GRUEN }); y += 14;
    zeile(['Nr.', 'Art', 'Bezeichnung / Notiz', 'Zustand', 'Kontrolle / Lage'], true);
    for (const x of nummeriert) zeile([x.nr, typText(x.typ), x.name || x.text || '', zustandText(x.zustand), x.kontrolle ? new Date(x.kontrolle).toLocaleDateString('de-DE') : `${x.at[0].toFixed(5)}, ${x.at[1].toFixed(5)}`]);
  } else if (!nummeriert.length) doc.text(L, y, 'Auf den gewählten Flurstücken sind noch keine jagdlichen Einrichtungen erfasst.', { size: 9 });
  herunterladen(doc.blob(), `Revierkarte_${new Date().toISOString().slice(0, 10)}.pdf`, { titel: 'Revierkarte ist fertig' });
}
