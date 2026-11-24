// Ausgaben für andere: Unternehmer-Auftrag (PDF mit Karte, Zufahrt, Rückegassen, Lagerplatz, Rettungspunkt),
// Waldbericht (PDF für Förster, Erben oder Verkauf) und GeoJSON-Export. Dazu Offline-Karten für die eigenen Flächen.
import { h, toast } from './ui.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { Pdf, herunterladen } from './pdf.js';
import { kartenBild, KARTEN_QUELLE } from './kartenbild.js';
import { polysOf, centroid, makeProjector, formatHa, formatDist, compassLabel, bbox } from './geo.js';
import { flaecheVon } from './flaeche.js';
import { nearestRescue, amtlicheFlaecheHa } from './map/thueringen.js';
import { tileUrls } from './map/basemap.js';
import { passtFlurstueck } from './profi.js';

const GRUEN = [27, 77, 46], GRAU = [90, 100, 90];
const datum = (t) => (t ? new Date(t).toLocaleDateString('de-DE') : '–');
const kartenLink = ([lat, lng]) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
const dateiname = (s) => s.replace(/[^\wäöüÄÖÜß-]+/g, '_');

/** Kartenrahmen mit Hintergrund; liefert tr([lat,lng]) → [x,y] auf der Seite */
async function pdfKarte(doc, { x, y, w, h, pts, rand = 18, basemap = 'osm' }) {
  const c = centroid(pts);
  const P = makeProjector(c);
  const XY = pts.map(P.toXY);
  const minX = Math.min(...XY.map((q) => q[0])), maxX = Math.max(...XY.map((q) => q[0])), minY = Math.min(...XY.map((q) => q[1])), maxY = Math.max(...XY.map((q) => q[1]));
  const sk = Math.min((w - 2 * rand) / Math.max(20, maxX - minX), (h - 2 * rand) / Math.max(20, maxY - minY));
  const ox = x + (w - (maxX - minX) * sk) / 2, oy = y + (h - (maxY - minY) * sk) / 2;
  const tr = (ll) => { const [a, b] = P.toXY(ll); return [ox + (a - minX) * sk, oy + (maxY - b) * sk]; };
  const ecke = (u, v) => P.toLatLng([(u - ox) / sk + minX, maxY - (v - oy) / sk]);
  const [nord, west] = ecke(x, y), [sued, ost] = ecke(x + w, y + h);
  const hg = await kartenBild({ nord, sued, west, ost, basemap, breitePx: Math.round(w * 2.6) }).catch(() => null);
  doc.rechteck(x, y, w, h, { fill: [248, 250, 246] });
  if (hg) doc.bild(x, y, w, h, hg);
  doc.rechteck(x, y, w, h, { stroke: [170, 180, 170] });
  doc.linie(x + w - 18, y + 38, x + w - 18, y + 16, { w: 1.4, farbe: [40, 50, 40] }); doc.text(x + w - 21, y + 12, 'N', { bold: true, size: 9 });
  const m = [10, 20, 50, 100, 200, 500, 1000, 2000].find((v) => v * sk >= 45) || 2000;
  doc.rechteck(x + 8, y + h - 24, m * sk + 8, 16, { fill: [255, 255, 255] });
  doc.linie(x + 12, y + h - 12, x + 12 + m * sk, y + h - 12, { w: 2, farbe: [40, 50, 40] }); doc.text(x + 12, y + h - 15, `${m.toLocaleString('de-DE')} m`, { size: 7 });
  const drin = (ll) => { const [a, b] = tr(ll); return a >= x && a <= x + w && b >= y && b <= y + h; };
  return { tr, drin, hg };
}
const ringeZeichnen = (doc, tr, polys, stil) => doc.polygon(polys.flat().map((r) => r.map(tr)), stil);
const linieZeichnen = (doc, tr, pts, stil) => { for (let i = 0; i + 1 < pts.length; i++) { const [a, b] = tr(pts[i]), [c, d] = tr(pts[i + 1]); doc.linie(a, b, c, d, stil); } };
function punkt(doc, [x, y], farbe, r = 4) { doc.polygon([Array.from({ length: 12 }, (_, i) => [x + r * Math.cos((i * Math.PI) / 6), y + r * Math.sin((i * Math.PI) / 6)])], { fill: farbe, stroke: [255, 255, 255], w: 1.2 }); }

class Schreiber {
  constructor(doc) { this.doc = doc; this.y = 50; this.L = 50; this.R = 545; }
  platz(n) { if (this.y + n > 800) { this.doc.neueSeite(); this.y = 50; } }
  titel(t, sub) { this.doc.text(this.L, this.y, t, { bold: true, size: 18, farbe: GRUEN }); this.y += 18; if (sub) { this.doc.text(this.L, this.y, sub, { size: 10, farbe: GRAU }); this.y += 16; } }
  kopf(t) { this.platz(30); this.y += 8; this.doc.text(this.L, this.y, t, { bold: true, size: 12, farbe: GRUEN }); this.y += 4; this.doc.linie(this.L, this.y, this.R, this.y, { w: 0.5 }); this.y += 12; }
  zeile(k, v) { const z = this.doc.umbrechen(v ?? '–', this.R - this.L - 140, { size: 10 }); this.platz(z.length * 13); this.doc.text(this.L, this.y, k, { bold: true, size: 10 }); z.forEach((t, i) => this.doc.text(this.L + 140, this.y + i * 13, t, { size: 10 })); this.y += z.length * 13 + 2; }
  absatz(t, { size = 10, farbe } = {}) { const z = this.doc.umbrechen(t, this.R - this.L, { size }); this.platz(z.length * (size + 3)); z.forEach((x) => { this.doc.text(this.L, this.y, x, { size, farbe }); this.y += size + 3; }); }
}

// ---------- Unternehmer-Auftrag ----------
// Arbeitsanweisung je Maßnahme (fachliche Standards, kurz für den Auftragnehmer)
const SICHERHEIT = 'Arbeitssicherheit nach DGUV-Regeln (PSA, Schnittschutz, nie allein mit Motorsäge); Rettungspunkt siehe unten.';
const HOLZERNTE = ['Befahrung nur auf den Rückegassen – keine Fahrten in den Bestand.', 'Markierte Bäume (Habitat- und Z-Bäume) und Grenzsteine schonen; keine Rücke- und Fällschäden am verbleibenden Bestand.', 'Holz nur am Lagerplatz poltern, nicht an stehende Bäume; Wege und Gräben frei halten und nach Abschluss wiederherstellen.', 'Bei Nässe oder Frostaufgang Arbeit unterbrechen, um tiefe Spuren zu vermeiden.'];
const ANWEISUNG = {
  raeumung: ['Schlagabraum nicht verbrennen; je nach Auftrag in Schwaden legen oder abfahren.', 'Oberboden nicht abschieben, nicht flächig befahren; Stubben bleiben stehen.', 'Vorhandene Naturverjüngung, Totholz und Habitatbäume erhalten.'],
  bodenverwundung: ['Nur den Oberboden aufreißen, Humus nicht abschieben.', 'Verwundeter Anteil wie vereinbart; Naturverjüngung aussparen.', 'Nicht bei Nässe arbeiten.'],
  mulchen: ['Nur die vereinbarten Streifen mulchen; Zwischenstreifen bleiben stehen.', 'Mulchtiefe gering halten, Mineralboden nicht großflächig freilegen.', 'Vorhandene Verjüngung und Grenzsteine schonen; auf Bodenbrüter achten.'],
  pflanzung: ['Wurzeln nie austrocknen lassen (Pflanzensack, Schatten); Pflanzen am Tag der Lieferung setzen.', 'Pflanzverfahren und -verband laut Pflanzplan; Wurzeln nicht stauchen, Pflanzen fest antreten.', 'Herkunftsnachweis (Lieferschein) aufbewahren.'],
  saat: ['Saatgut kühl und feucht lagern; Saattiefe je Baumart (Eicheln 3–5 cm, Buchecker 2–3 cm).', 'Saatplätze bzw. -streifen markieren.', 'Herkunftsnachweis aufbewahren.'],
  zaunbau: ['Zaun straff spannen, Bodenabschluss dicht (Untergrabungsschutz), Tore schließbar.', 'Zaunverlauf laut Karte; Grenzabstand beachten.'],
  einzelschutz: ['Schutz senkrecht und fest am Stab, Pflanze mittig; Stäbe an der Wetterseite.'],
  pflege: ['Nur so viel eingreifen wie nötig; Zielbaumarten und Mischung erhalten.', 'Geschnittenes Material bleibt auf der Fläche.', 'Gepflanzte Bäume vorher markieren und nicht beschädigen.'],
  holzernte_df: HOLZERNTE, durchforstung: HOLZERNTE,
  holzernte_bs: [...HOLZERNTE, 'Verfahren wie vereinbart (Seilkran, Rückepferd, Seilwinde oder Bänder) – Befahrung auf das notwendige Maß beschränken.'],
};

export async function unternehmerAuftrag(measureId, { anhaengen = false } = {}) {
  const s = store.get();
  const m = s.measures.find((x) => x.id === measureId);
  if (!m) return;
  if (!anhaengen) toast('Arbeitsauftrag wird erstellt …');
  const { MEASURE_TYPES } = await import('./measures.js');
  const all = await source.allParcels();
  const p = all.find((x) => x.id === m.parcelId) || null;
  const fl = flaecheVon(m, p);
  const polys = fl?.polys?.length ? fl.polys : p ? polysOf(p) : [];
  const mitte = polys.length ? centroid(polys[0][0]) : m.schaden?.pos || null;
  if (!mitte) { if (!anhaengen) toast('Für diese Maßnahme ist keine Fläche hinterlegt – bitte zuerst eine Fläche hinterlegen.'); return; }
  const E = s.erschliessung || { gassen: [], lager: [] };
  const nahe = (ll, r) => Math.abs(ll[0] - mitte[0]) < r && Math.abs(ll[1] - mitte[1]) < r * 1.6;
  const gassen = (E.gassen || []).filter((g) => g.line?.some((ll) => nahe(ll, 0.012)));
  const lager = (E.lager || []).filter((l) => l.at && nahe(l.at, 0.015));
  const rett = await nearestRescue(mitte, 1).catch(() => []);
  const rp = rett[0];
  const pr = s.profile || {};
  const doc = new Pdf();
  const W = new Schreiber(doc);
  const typ = MEASURE_TYPES[m.type]?.label || m.type;
  W.titel(`Arbeitsauftrag: ${typ}`, `Erstellt am ${datum(Date.now())} mit der WaldWächter-App`);
  W.kopf('Auftraggeber');
  W.zeile('Name', pr.name || '–'); W.zeile('Telefon', pr.telefon || '–'); W.zeile('E-Mail', pr.email || '–');
  if (pr.strasse || pr.ort) W.zeile('Anschrift', [pr.strasse, pr.ort].filter(Boolean).join(', '));
  W.kopf('Fläche und Maßnahme');
  if (p) W.zeile('Flurstück', `${p.nr}, Flur ${p.flur}, Gemarkung ${p.gemarkung}${p.gemeinde ? ` (${p.gemeinde})` : ''}`);
  W.zeile('Fläche', `${fl?.art || 'Flurstück'}${fl?.ha ? `, ${formatHa(fl.ha)}` : p ? `, ${formatHa(amtlicheFlaecheHa(p))}` : ''}`);
  W.zeile('Termin', m.date ? datum(m.date) : 'nach Absprache');
  const T = MEASURE_TYPES[m.type];
  for (const [k, v] of Object.entries(m.details || {})) { if (v === '' || v == null) continue; const f = T?.fields?.find((x) => x[0] === k); if (f) W.zeile(f[1].replace(/ \(.*\)/, ''), String(v)); }
  if (m.thinning?.plan) W.zeile('Durchforstung', `${m.thinning.plan.methode === 'f4' ? `${Math.round(m.thinning.plan.planung?.budget || 0)} m³ Menge laut Durchforstungshilfe` : `${m.thinning.plan.total} Bäume Entnahme geplant`}; Bäume sind ausgezeichnet`);
  if (m.note) W.zeile('Hinweise', m.note);
  const sg = m.thinning?.natura2000 || m.schutzgebiete || [];
  if (sg.length) W.zeile('Schutzgebiet', `${sg.map((g) => `${g.art} „${g.name || 'ohne Namen'}“`).join(', ')} – Verordnung beachten${['ffh_geb', 'spa', 'nsg'].some((l) => sg.some((g) => g.layer === l)) ? '; Brut- und Setzzeit 1.3.–30.9. beachten' : ''}.`);
  W.kopf('Arbeitsanweisung');
  [...(ANWEISUNG[m.type] || []), SICHERHEIT].forEach((t) => W.absatz(`• ${t}`, { size: 10 }));
  W.kopf('Zufahrt, Lagerplatz und Rettung');
  W.zeile('Treffpunkt / Fläche', `${mitte[0].toFixed(5)} N, ${mitte[1].toFixed(5)} O – ${kartenLink(mitte)}`);
  lager.slice(0, 3).forEach((l, i) => W.zeile(i ? '' : 'Lagerplatz', `${l.name || `Lagerplatz ${i + 1}`}: ${l.at[0].toFixed(5)} N, ${l.at[1].toFixed(5)} O${l.befahrbar ? ` · ${l.befahrbar}` : ''}${l.lkw ? ' · LKW kann wenden' : ''}${l.text ? ` · ${l.text}` : ''}`));
  if (!lager.length) W.zeile('Lagerplatz', 'nicht eingetragen – bitte vor Ort absprechen');
  W.zeile('Rückegassen', gassen.length ? `${gassen.length} eingezeichnet (siehe Karte)${gassen.some((g) => g.befahrbar) ? '; ' + gassen.filter((g) => g.befahrbar).map((g) => `${g.name || 'Gasse'}: ${g.befahrbar}`).slice(0, 4).join(', ') : ''}` : 'nicht eingezeichnet');
  W.zeile('Rettungspunkt', rp ? `${rp.id}${rp.name ? ` (${rp.name})` : ''}, ${formatDist(rp.dist)} ${compassLabel(rp.brg)} – ${rp.at[0].toFixed(5)} N, ${rp.at[1].toFixed(5)} O. Im Notfall 112 anrufen und die Nummer des Rettungspunkts nennen.` : 'kein Rettungspunkt gefunden (Geoportal nicht erreichbar)');
  // Karte
  W.platz(360);
  const kartePts = [...polys.flat(2), ...lager.map((l) => l.at), ...(rp && rp.dist < 2500 ? [rp.at] : [])];
  const basemap = s.settings?.basemap === 'dop' ? 'dop' : 'osm';
  const k = await pdfKarte(doc, { x: W.L, y: W.y, w: W.R - W.L, h: 340, pts: kartePts, basemap });
  if (polys.length) ringeZeichnen(doc, k.tr, polys, { stroke: [242, 107, 29], w: 2.2 });
  if (p && fl && !fl.ganz) ringeZeichnen(doc, k.tr, polysOf(p), { stroke: [246, 211, 45], w: 1.2 });
  gassen.forEach((g) => linieZeichnen(doc, k.tr, g.line.filter(k.drin), { w: 2, farbe: [141, 90, 43], strich: [5, 3] }));
  lager.forEach((l) => k.drin(l.at) && punkt(doc, k.tr(l.at), [181, 101, 29], 5));
  if (rp && k.drin(rp.at)) { punkt(doc, k.tr(rp.at), [0, 150, 70], 6); const [a, b] = k.tr(rp.at); doc.text(a + 8, b + 3, rp.id, { bold: true, size: 8 }); }
  W.y += 346;
  doc.text(W.L, W.y, `Legende: orange = Arbeitsfläche · braun gestrichelt = Rückegasse · braun = Lagerplatz · grün = Rettungspunkt. Hintergrund: ${KARTEN_QUELLE[basemap]}`, { size: 7, farbe: GRAU });
  W.y += 22;
  W.kopf('Vereinbarung');
  W.absatz('Preis / Abrechnung: ______________________________________________');
  W.absatz('Ausführungszeitraum: _____________________________________________');
  W.y += 24;
  doc.linie(W.L, W.y, W.L + 200, W.y); doc.linie(W.R - 200, W.y, W.R, W.y); W.y += 12;
  doc.text(W.L, W.y, 'Ort, Datum, Auftraggeber', { size: 8, farbe: GRAU }); doc.text(W.R - 200, W.y, 'Ort, Datum, Auftragnehmer', { size: 8, farbe: GRAU });
  const name = `Arbeitsauftrag_${dateiname(typ)}${p ? `_${dateiname(`${p.gemarkung}_${p.nr}`)}` : ''}.pdf`;
  const blob = doc.blob();
  // Am Auftrag ablegen (Verlauf und Anhänge) – der jeweils neueste ersetzt den alten
  const anhangId = `auftrag-${m.id}`;
  try {
    const { dateiSpeichern } = await import('./dateien.js');
    await dateiSpeichern(anhangId, blob);
    store.update((st) => { const x = st.measures.find((y) => y.id === m.id); if (!x) return; x.anhaenge = (x.anhaenge || []).filter((a) => a.typ !== 'auftrag'); x.anhaenge.push({ id: anhangId, typ: 'auftrag', titel: 'Arbeitsauftrag mit Karte (PDF)', erstellt: Date.now(), datei: anhangId, name }); x.auftragStand = Date.now(); });
  } catch { /* Speicher voll: nur herunterladen */ }
  if (!anhaengen) herunterladen(blob, name, { titel: 'Arbeitsauftrag ist fertig' });
}

// ---------- Waldbericht ----------
export async function waldbericht() {
  const s = store.get();
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = s.parcels.filter((p) => byId[p.id] && passtFlurstueck(p)).map((p) => byId[p.id]);
  if (!mine.length) { toast('Noch keine Flächen gespeichert.'); return; }
  toast('Waldbericht wird erstellt …');
  const { MEASURE_TYPES } = await import('./measures.js');
  const doc = new Pdf();
  const W = new Schreiber(doc);
  const pr = s.profile || {};
  const gesamt = mine.reduce((a, p) => a + amtlicheFlaecheHa(p), 0);
  W.titel('Waldbericht', `${pr.name ? `${pr.name} · ` : ''}${mine.length} Flurstücke, ${formatHa(gesamt)} · Stand ${datum(Date.now())}`);
  W.absatz('Zusammenstellung aus der WaldWächter-App: Flächen, Bestand, Maßnahmen und Tagebuch. Flurstücksdaten ALKIS © GDI-Th; keine amtliche Auskunft.', { size: 9, farbe: GRAU });
  const basemap = s.settings?.basemap === 'dop' ? 'dop' : 'osm';
  for (const p of mine) {
    doc.neueSeite(); W.y = 50;
    W.titel(`Flurstück ${p.nr}`, `Flur ${p.flur}, Gemarkung ${p.gemarkung}${p.gemeinde ? `, ${p.gemeinde}` : ''} · ${formatHa(amtlicheFlaecheHa(p))}`);
    const polys = polysOf(p);
    const k = await pdfKarte(doc, { x: W.L, y: W.y, w: W.R - W.L, h: 240, pts: polys.flat(2), basemap });
    ringeZeichnen(doc, k.tr, polys, { stroke: [242, 107, 29], w: 2 });
    (s.erschliessung?.gassen || []).filter((g) => g.line?.some(k.drin)).forEach((g) => linieZeichnen(doc, k.tr, g.line.filter(k.drin), { w: 1.6, farbe: [141, 90, 43], strich: [5, 3] }));
    for (const [art, farbe] of [['habitat', [46, 125, 50]], ['jagd', [93, 64, 55]]]) (s.punkte?.[art] || []).filter((x) => x.at && k.drin(x.at)).forEach((x) => punkt(doc, k.tr(x.at), farbe, 3.5));
    W.y += 250;
    const kk = s.bestandKorrektur?.[p.id];
    if (kk?.haupt?.art) { W.kopf('Bestand (eigene Angaben)'); ['haupt', 'misch', 'neben'].forEach((x, i) => kk[x]?.art && W.zeile(['Hauptbaumart', 'Mischbaumart', 'Nebenbaumart'][i], `${kk[x].art}${kk[x].alter ? `, ${kk[x].alter} Jahre (Stand ${kk.jahr})` : ''}`)); }
    const ms = s.measures.filter((m) => m.parcelId === p.id).sort((a, b) => (b.finishedAt || b.date || b.createdAt) - (a.finishedAt || a.date || a.createdAt));
    W.kopf(`Maßnahmen (${ms.length})`);
    if (!ms.length) W.absatz('Keine Maßnahmen erfasst.', { size: 9, farbe: GRAU });
    for (const m of ms.slice(0, 25)) {
      const T = MEASURE_TYPES[m.type];
      const det = Object.entries(m.details || {}).filter(([, v]) => v !== '' && v != null).map(([kk2, v]) => { const f = T?.fields?.find((x) => x[0] === kk2); return f ? `${f[1].replace(/ \(.*\)/, '')}: ${v}` : null; }).filter(Boolean).join('; ');
      W.zeile(datum(m.finishedAt || m.date || m.createdAt), `${T?.label || m.type} (${m.status === 'fertig' ? 'erledigt' : m.status === 'arbeit' ? 'in Arbeit' : 'geplant'})${det ? ` – ${det}` : ''}${m.note ? ` – ${m.note}` : ''}`);
    }
    const tb = (s.tagebuch || []).filter((e) => e.parcelId === p.id).sort((a, b) => b.datum - a.datum);
    if (tb.length) { W.kopf(`Tagebuch (${tb.length})`); tb.slice(0, 30).forEach((e) => W.zeile(datum(e.datum), e.text || '–')); }
  }
  herunterladen(doc.blob(), `Waldbericht_${datum(Date.now()).replace(/\./g, '-')}.pdf`, { titel: 'Waldbericht ist fertig' });
}

// ---------- GeoJSON ----------
export async function geojsonExport() {
  const s = store.get();
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const { MEASURE_TYPES } = await import('./measures.js');
  const lnglat = ([lat, lng]) => [Number(lng.toFixed(7)), Number(lat.toFixed(7))];
  const ring = (r) => { const x = r.map(lnglat); if (x.length && (x[0][0] !== x.at(-1)[0] || x[0][1] !== x.at(-1)[1])) x.push(x[0]); return x; };
  const mp = (polys) => ({ type: 'MultiPolygon', coordinates: polys.map((rings) => rings.map(ring)) });
  const F = [];
  for (const sp of s.parcels.filter(passtFlurstueck)) {
    const p = byId[sp.id]; if (!p?.ring) continue;
    F.push({ type: 'Feature', geometry: mp(polysOf(p)), properties: { ebene: 'Flurstück', gemarkung: p.gemarkung, flur: p.flur, flurstueck: p.nr, flaeche_ha: Number(amtlicheFlaecheHa(p).toFixed(4)), nutzung: p.category || '' } });
  }
  for (const m of s.measures) {
    const p = byId[m.parcelId] || null;
    const fl = flaecheVon(m, p);
    const geom = fl?.polys?.length && !fl.ganz ? mp(fl.polys) : m.schaden?.pos ? { type: 'Point', coordinates: lnglat(m.schaden.pos) } : null;
    if (!geom) continue;
    F.push({ type: 'Feature', geometry: geom, properties: { ebene: 'Maßnahme', art: MEASURE_TYPES[m.type]?.label || m.type, status: m.status, datum: datum(m.finishedAt || m.date || m.createdAt), flurstueck: p ? `${p.gemarkung} ${p.flur}/${p.nr}` : '', ...Object.fromEntries(Object.entries(m.details || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])) } });
  }
  for (const g of s.erschliessung?.gassen || []) if (g.line?.length > 1) F.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: g.line.map(lnglat) }, properties: { ebene: 'Rückegasse', name: g.name || '', richtung_grad: g.grad ?? '', befahrbarkeit: g.befahrbar || '', breite_m: g.breite ?? '' } });
  for (const l of s.erschliessung?.lager || []) if (l.at) F.push({ type: 'Feature', geometry: { type: 'Point', coordinates: lnglat(l.at) }, properties: { ebene: 'Lagerplatz', name: l.name || '', befahrbarkeit: l.befahrbar || '', beschreibung: l.text || '' } });
  for (const [art, ebene] of [['habitat', 'Habitatbaum'], ['jagd', 'Jagdliche Einrichtung']]) for (const x of s.punkte?.[art] || []) if (x.at) F.push({ type: 'Feature', geometry: { type: 'Point', coordinates: lnglat(x.at) }, properties: { ebene, typ: x.typ, name: x.name || x.baumart || '', beschreibung: x.text || '' } });
  for (const f of s.fotopunkte || []) F.push({ type: 'Feature', geometry: { type: 'Point', coordinates: lnglat(f.at) }, properties: { ebene: 'Fotopunkt', name: f.name, blickrichtung_grad: f.blick } });
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', name: 'WaldWaechter', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features: F }, null, 1)], { type: 'application/geo+json' });
  herunterladen(blob, `WaldWaechter_${datum(Date.now()).replace(/\./g, '-')}.geojson`);
  toast(`${F.length} Objekte exportiert – lässt sich z. B. in QGIS öffnen`);
}

// ---------- Offline-Karten ----------
const x2 = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const y2 = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
export async function offlineKacheln({ zMin = 13, zMax = 18 } = {}) {
  const s = store.get();
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const mine = s.parcels.filter((p) => byId[p.id] && passtFlurstueck(p)).map((p) => byId[p.id]);
  const basemap = s.settings?.basemap === 'osm' ? 'osm' : 'dop';
  const set = new Set();
  for (const p of mine) {
    const b = bbox(polysOf(p).flat(2));
    for (let z = zMin; z <= zMax; z++) for (let tx = x2(b.w, z) - 1; tx <= x2(b.e, z) + 1; tx++) for (let ty = y2(b.n, z) - 1; ty <= y2(b.s, z) + 1; ty++) tileUrls(basemap, z, tx, ty, { alkis: true }).forEach((u) => set.add(u));
  }
  return { urls: [...set], flaechen: mine.length, basemap };
}
const swNachricht = (msg) => new Promise((ok, fehler) => {
  const ctl = navigator.serviceWorker?.controller;
  if (!ctl) { fehler(new Error('Offline-Speicher braucht die installierte bzw. einmal neu geladene App.')); return; }
  const ch = new MessageChannel();
  ch.port1.onmessage = (e) => { if (e.data?.fortschritt != null) msg.onFortschritt?.(e.data); else ok(e.data); };
  const { onFortschritt, ...rest } = msg;
  ctl.postMessage(rest, [ch.port2]);
});
export const offlineSpeichern = (urls, onFortschritt) => swNachricht({ typ: 'OFFLINE_SAVE', urls, onFortschritt });
export const offlineInfo = () => swNachricht({ typ: 'OFFLINE_INFO' }).catch(() => ({ anzahl: 0 }));
export const offlineLoeschen = () => swNachricht({ typ: 'OFFLINE_CLEAR' });

/** Karte im Profil: Offline-Karten und Export */
export function exportKarte() {
  const status = h('p', { class: 'muted', 'aria-live': 'polite' }, 'Prüfe gespeicherte Offline-Karten …');
  const zeigeInfo = () => offlineInfo().then((i) => { status.textContent = i.anzahl ? `${i.anzahl.toLocaleString('de-DE')} Kartenkacheln offline gespeichert${i.mb ? ` (ca. ${i.mb} MB)` : ''}.` : 'Noch keine Offline-Karten gespeichert.'; });
  zeigeInfo();
  const speichernBtn = h('button', { class: 'btn btn-primary', onclick: async () => {
    const { urls, flaechen, basemap } = await offlineKacheln();
    if (!flaechen) { toast('Noch keine Flächen gespeichert.'); return; }
    const MAX = 6000;
    if (urls.length > MAX) toast(`Sehr viele Kacheln – gespeichert werden die ersten ${MAX.toLocaleString('de-DE')}.`);
    speichernBtn.disabled = true;
    try {
      const r = await offlineSpeichern(urls.slice(0, MAX), (f) => { speichernBtn.textContent = `Speichere … ${Math.round((f.fortschritt / f.gesamt) * 100)} %`; });
      toast(r.fehler ? `Gespeichert, ${r.fehler} Kacheln fehlen` : `Karten für ${flaechen} Flächen offline gespeichert (${basemap === 'dop' ? 'Luftbild' : 'Karte'})`);
    } catch (e) { toast(e.message); }
    speichernBtn.disabled = false; speichernBtn.textContent = 'Karten meiner Flächen offline speichern';
    zeigeInfo();
  } }, 'Karten meiner Flächen offline speichern');
  return h('section', { class: 'card' },
    h('h2', {}, 'Offline-Karten und Export'),
    h('div', { class: 'form' },
      status,
      speichernBtn,
      h('p', { class: 'hint' }, 'Speichert den aktuellen Hintergrund (Luftbild oder Karte) mit Flurstücksgrenzen für alle deine Flächen bis Zoomstufe 18 – für Gebiete ohne Netz. Vorher im WLAN machen.'),
      h('button', { class: 'btn', onclick: async () => { await offlineLoeschen().catch(() => {}); toast('Offline-Karten gelöscht'); zeigeInfo(); } }, 'Offline-Karten löschen'),
      h('button', { class: 'btn', onclick: () => waldbericht().catch(() => toast('Waldbericht konnte nicht erstellt werden.')) }, 'Waldbericht als PDF'),
      h('button', { class: 'btn', onclick: () => geojsonExport().catch(() => toast('Export fehlgeschlagen.')) }, 'Daten für den Förster (GeoJSON)'),
      h('p', { class: 'hint' }, 'Der Waldbericht fasst Flächen, Bestand, Maßnahmen und Tagebuch zusammen – z. B. für den Förster, Erben oder einen Verkauf. GeoJSON öffnet jedes GIS (z. B. QGIS) mit Flurstücken, Maßnahmenflächen, Rückegassen und Punkten.')));
}
