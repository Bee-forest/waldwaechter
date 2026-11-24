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
import { ARTEN, JAGD_ZUSTAND, SYMBOLE } from './map/punkte.js';
import { passtFlurstueck } from './profi.js';
import { amtlicheWegeEbenen } from './map/waldwege.js';

const GRUEN = [27, 77, 46], GRAU = [90, 100, 90];
const FARBE_TYP = { kanzel: [122, 63, 32], bock: [196, 98, 30], erdsitz: [95, 110, 60] };
const typText = (t) => ARTEN.jagd.typen.find(([k]) => k === t)?.[1] || 'Einrichtung';
/** App-Symbol (farbiges Kästchen mit weißem Rand und Piktogramm) als JPEG fürs PDF */
async function symbolBild(art, typ, grau = false) {
  const A = ARTEN[art], g = 96, cv = document.createElement('canvas');
  cv.width = cv.height = g;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, g, g);
  c.fillStyle = grau ? '#8A8A8A' : A.farbe;
  const r = A.form === 'rund' ? g / 2 - 8 : 16;
  c.beginPath(); c.roundRect(8, 8, g - 16, g - 16, r); c.fill();
  const svg = (SYMBOLE[typ] || SYMBOLE[A.typen[0][0]]).replace('width="22" height="22"', `xmlns="http://www.w3.org/2000/svg" width="${g * 0.6}" height="${g * 0.6}"`);
  await new Promise((ok) => { const img = new Image(); img.onload = () => { c.drawImage(img, g * 0.2, g * 0.2, g * 0.6, g * 0.6); ok(); }; img.onerror = ok; img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.92));
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), w: g, h: g };
}
const zustandText = (k) => JAGD_ZUSTAND.find(([x]) => x === k)?.[1] || '–';

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
        check('wege', 'Wege (Geoportal Thüringen)', 'Straßen und Fahrwege (ATKIS), Erholungswege von ThüringenForst'),
        check('habitat', 'Habitatbäume')),
      h('fieldset', {}, h('legend', {}, 'Beschriftung'),
        check('beschriftung', 'Bezeichnung an jeder Einrichtung', 'der eingetragene Name, z. B. „Eichenkanzel“'),
        check('liste', 'Liste aller Einrichtungen', 'neben der Karte, mit Zustand und letzter Kontrolle'))),
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
  const pts = polysAlle.flat(3);
  const { s: s0, w: w0, n: n0, e: e0 } = bbox(pts);
  const doc = new Pdf();
  doc.B = 841.89; doc.H = 595.28; // Querformat
  const L = 36, R = 806;
  const mitListe = w.liste && jagd.length;
  const kw = mitListe ? 560 : R - L, kh = 470;
  doc.text(L, 40, 'Revierkarte – jagdliche Einrichtungen', { bold: true, size: 16, farbe: GRUEN });
  doc.text(L, 55, `${flst.map((p) => `Flurstück ${p.nr}, ${p.gemarkung}`).join(' · ').slice(0, 150)} · ${jagd.length} ${jagd.length === 1 ? 'Einrichtung' : 'Einrichtungen'} · Stand ${new Date().toLocaleDateString('de-DE')}`, { size: 9, farbe: GRAU });
  const wegeWms = w.wege ? (await amtlicheWegeEbenen()).map((e) => ({ ...e, fein: 2.5 })) : [];
  if (w.wege && !wegeWms.length) w.wegeFehler = true;
  const k = await pdfKarte(doc, { x: L, y: 66, w: kw, h: kh, pts, basemap: w.basemap, rand: 24, wms: wegeWms });
  if (wegeWms.some((e) => e.fehler)) w.wegeFehler = true;
  polysAlle.forEach((pl) => ringeZeichnen(doc, k.tr, pl, { stroke: [246, 211, 45], w: 2 }));
  if (w.gassen) {
    const E = s.erschliessung || {};
    (E.gassen || []).forEach((g) => linieImRahmen(doc, k, g.line || [], { w: 2, farbe: [141, 90, 43], strich: [5, 3] }));
    (E.lager || []).forEach((l) => l.at && k.drin(l.at) && punkt(doc, k.tr(l.at), [181, 101, 29], 4));
  }
  // Symbole wie in der App
  const cache = {};
  const sym = async (art, typ, grau) => (cache[`${art}${typ}${grau}`] ||= await symbolBild(art, typ, grau));
  if (w.habitat) for (const x of s.punkte?.habitat || []) {
    if (!x.at || !k.drin(x.at)) continue;
    const [a, b] = k.tr(x.at); doc.bild(a - 7, b - 7, 14, 14, await sym('habitat', x.typ));
  }
  const gr = 18;
  for (const x of jagd) {
    if (!k.drin(x.at)) continue;
    const [a, b] = k.tr(x.at);
    doc.bild(a - gr / 2, b - gr / 2, gr, gr, await sym('jagd', x.typ, x.zustand === 'gesperrt'));
    if (w.beschriftung && x.name) {
      const t = x.name.slice(0, 40);
      doc.rechteck(a + gr / 2 + 2, b - 6, t.length * 4.4 + 6, 12, { fill: [255, 255, 255] });
      doc.text(a + gr / 2 + 5, b + 3, t, { size: 7.5, bold: true });
    }
  }
  // Legende unter der Karte, mit den Symbolen
  let y = 66 + kh + 14, x0 = L;
  for (const [t, l] of ARTEN.jagd.typen) { doc.bild(x0, y - 9, 11, 11, await sym('jagd', t)); doc.text(x0 + 14, y, l, { size: 8 }); x0 += 24 + l.length * 4.4; }
  if (w.habitat) { doc.bild(x0, y - 9, 11, 11, await sym('habitat', 'stehend')); doc.text(x0 + 14, y, 'Habitatbaum', { size: 8 }); x0 += 70; }
  doc.text(x0, y, `grau = gesperrt · gelb = Flurstück${w.gassen ? ' · braun gestrichelt = Rückegasse' : ''}`, { size: 8, farbe: GRAU });
  y += 13;
  doc.text(L, y, `Hintergrund: ${KARTEN_QUELLE[w.basemap]}${w.wege ? (w.wegeFehler ? ' · Wege konnten nicht geladen werden' : ' · Wege © GDI-Th (ATKIS Basis-DLM) / ThüringenForst') : ''}`, { size: 7, farbe: GRAU });
  // Liste rechts neben der Karte
  if (mitListe) {
    const lx = L + kw + 16, lr = R;
    let ly = 76;
    doc.text(lx, ly, 'Einrichtungen', { bold: true, size: 11, farbe: GRUEN }); ly += 16;
    for (const x of jagd) {
      if (ly > 560) { doc.neueSeite(); ly = 50; }
      doc.bild(lx, ly - 9, 11, 11, await sym('jagd', x.typ, x.zustand === 'gesperrt'));
      doc.text(lx + 15, ly, (x.name || typText(x.typ)).slice(0, 34), { bold: true, size: 8.5 }); ly += 11;
      const info = [x.name ? typText(x.typ) : null, zustandText(x.zustand), x.kontrolle ? `Kontrolle ${new Date(x.kontrolle).toLocaleDateString('de-DE')}` : null].filter(Boolean).join(' · ');
      doc.umbrechen(info, lr - lx - 15, { size: 7.5 }).forEach((z) => { doc.text(lx + 15, ly, z, { size: 7.5, farbe: GRAU }); ly += 9.5; });
      if (x.text) doc.umbrechen(x.text, lr - lx - 15, { size: 7.5 }).slice(0, 2).forEach((z) => { doc.text(lx + 15, ly, z, { size: 7.5, farbe: GRAU }); ly += 9.5; });
      ly += 5;
    }
  } else if (!jagd.length) doc.text(L, y + 16, 'Auf den gewählten Flurstücken sind noch keine jagdlichen Einrichtungen erfasst.', { size: 9 });
  herunterladen(doc.blob(), `Revierkarte_${new Date().toISOString().slice(0, 10)}.pdf`, { titel: 'Revierkarte ist fertig' });
}
