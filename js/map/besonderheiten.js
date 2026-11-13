// Besonderheiten eines Flurstücks als „i“-Punkte auf der Karte:
//  • Verkehrssicherungspflicht: Wald grenzt an eine öffentliche Verkehrsfläche
//    (Nachbarflurstücke mit ALKIS-Nutzung Straßenverkehr, Platz oder Bahnverkehr)
//  • Biotope: Punkt-, Linien- und Flächenbiotope aus Waldbiotop- und Offenlandbiotopkartierung
//    (Kartendienste des Geoportals, live abgefragt, nichts gespeichert)
import { bbox, polysOf, inPolys, centroid, distance } from '../geo.js';
import { parcelsNear, scanWmsLayer, nutzungAnteile, FORST, GP } from './thueringen.js';
import { umlaut } from './geoinfo.js';
import { biotopWichtig, lrtCode, lrtWichtig, LRT } from './lrt.js';

export const BESONDERHEIT = {
  vsp: {
    title: 'Verkehrssicherungspflicht',
    text: 'Hier grenzt dein Wald an eine öffentliche Straße, einen Platz oder eine Bahnstrecke. Du musst dafür sorgen, dass von deinen Bäumen keine erkennbare Gefahr ausgeht, etwa durch tote Äste oder kranke Bäume. Kontrolliere den Waldrand deshalb zweimal im Jahr – belaubt und unbelaubt – und schreib die Kontrolle auf.',
  },
  punktbiotop: {
    title: 'Punktbiotop',
    text: 'Hier ist ein kleines, besonders wertvolles Biotop kartiert, zum Beispiel eine Quelle, ein Felsen, ein Tümpel oder ein Höhlenbaum. Es ist meist gesetzlich geschützt: bei Holzernte und Rücken großräumig umfahren und nichts ablagern.',
  },
  lrt: {
    title: 'Wald-Lebensraumtyp',
    text: 'Hier ist ein FFH-Wald-Lebensraumtyp kartiert. Für ihn gilt das Verschlechterungsverbot: keine Kahlschläge, lebensraumtypische Baumarten fördern, Biotopbäume und starkes Totholz erhalten. Die genauen Hinweise stehen in der Infobox unter „Biotope und Lebensraumtypen“.',
  },
  biotop: {
    title: 'Biotop',
    text: 'Hier liegt ein kartiertes Biotop, also ein besonders wertvoller Lebensraum wie ein naturnaher Bachlauf oder ein alter Laubwald. Viele Biotope sind gesetzlich geschützt und dürfen nicht beeinträchtigt werden – plane Maßnahmen hier im Zweifel mit dem Forstamt.',
  },
};

const VERKEHR = /straßenverkehr|strassenverkehr|platz|bahnverkehr/i;
const NAH_M = 4;          // so nah muss die Grenze an der Verkehrsfläche liegen
const PUNKT_ALLE_M = 120; // ein „i“ je angefangene 120 m Grenze

// Abstand Punkt–Strecke in Metern (lokal eben)
function distSeg(p, a, b) {
  const k = Math.cos((p[0] * Math.PI) / 180) * 111320, m = 110540;
  const px = p[1] * k, py = p[0] * m, ax = a[1] * k, ay = a[0] * m, bx = b[1] * k, by = b[0] * m;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const nearRing = (p, ring) => { for (let i = 0; i < ring.length - 1; i++) if (distSeg(p, ring[i], ring[i + 1]) <= NAH_M) return true; return false; };

// Grenze des Flurstücks in ~10-m-Schritten
function grenzpunkte(polys) {
  const out = [];
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1], n = Math.max(1, Math.ceil(distance(a, b) / 10));
      for (let k = 0; k < n; k++) out.push({ at: [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], seg: out.length });
    }
    out.push(null); // Ringende
  }
  return out;
}

export async function verkehrssicherung(p) {
  const teile = nutzungAnteile(p);
  if (teile && !(teile.Wald > 0)) return []; // kein Wald auf dem Flurstück
  const polys = polysOf(p);
  const b = bbox(polys.flat(2));
  const nachbarn = (await parcelsNear(b)).filter((x) => x.id !== p.id && VERKEHR.test(x.nutzungText || ''));
  if (!nachbarn.length) return [];
  const pts = grenzpunkte(polys);
  // zusammenhängende Grenzabschnitte, die an Verkehrsflächen liegen
  const strecken = [];
  let cur = null;
  for (const gp of pts) {
    const hit = gp && nachbarn.find((nb) => polysOf(nb).some((poly) => poly.some((ring) => nearRing(gp.at, ring))));
    if (hit) {
      if (!cur) { cur = { pts: [], art: new Set() }; strecken.push(cur); }
      cur.pts.push(gp.at);
      cur.art.add(/bahn/i.test(hit.nutzungText) ? 'Bahnstrecke' : /platz/i.test(hit.nutzungText) ? 'Platz' : 'Straße');
    } else cur = null;
  }
  const out = [];
  for (const s of strecken) {
    if (s.pts.length < 2) continue;
    const laenge = s.pts.length * 10;
    const n = Math.max(1, Math.ceil(laenge / PUNKT_ALLE_M));
    for (let k = 0; k < n; k++) {
      const at = s.pts[Math.min(s.pts.length - 1, Math.round(((k + 0.5) / n) * (s.pts.length - 1)))];
      out.push({ type: 'vsp', at, line: k === 0 ? s.pts : null, laenge, art: [...s.art].join(', '), ...BESONDERHEIT.vsp });
    }
  }
  return out;
}

/**
 * Bezeichnung des Biotops aus den Sachdaten der Kartierung: zuerst ein Klartext zum Biotoptyp,
 * dann eine allgemeine Bezeichnung; ein Biotoptyp-Code wird vorangestellt, wenn er getrennt vorliegt.
 */
export function biotopName(props = {}) {
  const eintraege = Object.entries(props).filter(([, x]) => x && String(x).trim() && !/^(missing|null|-)$/i.test(String(x).trim()));
  const text = (x) => !/^\d+([.,]\d+)?$/.test(String(x).trim()) && /[a-zäöüß]{3}/i.test(String(x));
  const finde = (...res) => { for (const re of res) { const e = eintraege.find(([k, x]) => re.test(k) && text(x)); if (e) return String(e[1]).trim(); } return ''; };
  const name = finde(/biotop.?typ.*(text|name|bez|lang)/i, /(btyp|bt).*(text|name|bez|lang)/i, /typ.?(text|name|bez)/i, /^(biotop.?)?bezeichnung$/i, /biotop.?name|^name$/i, /bezeich|beschreib|text|name/i, /biotop.?typ|btyp/i);
  const code = eintraege.find(([k, x]) => /(biotop.?typ|btyp|bt).?(code|nr|schl|kz)?$|code|schl(u|ü)ssel/i.test(k) && /^[0-9A-Z.\-/]{2,12}$/i.test(String(x).trim()) && /\d/.test(String(x)) && !String(name).includes(String(x).trim()))?.[1];
  return umlaut([code, name].filter(Boolean).join(' – '));
}
/** Weitere Angaben der Kartierung für die Anzeige (Schutzstatus, Kartierjahr, Größe …) */
export function biotopAngaben(props = {}) {
  const out = [];
  for (const [k, v] of Object.entries(props)) {
    const t = String(v).trim();
    if (!t || /^(missing|null|-)$/i.test(t) || /(^|_)(id|objectid|fid|gid|shape|geom|the_geom|ogc_fid)$/i.test(k) || t.length > 160) continue;
    if (/schutz|§|status|jahr|datum|kartier|flaeche|fläche|wert|lrt|ffh|bewert|zustand|beschreib|typ|bezeich|name|code/i.test(k)) out.push([umlaut(k.replace(/_/g, ' ')), umlaut(t)]);
    if (out.length >= 8) break;
  }
  return out;
}

export async function biotope(p) {
  const polys = polysOf(p);
  const b = bbox(polys.flat(2));
  const quellen = [
    { url: GP, layer: 'obk1_punkte', typ: 'punktbiotop' },
    { url: FORST, layer: 'waldbiotope', typ: 'biotop' },
    { url: GP, layer: 'obk1_flaechen', typ: 'biotop' },
    { url: GP, layer: 'obk1_linien', typ: 'biotop' },
  ];
  const res = await Promise.all(quellen.map(async (q) => {
    try { return (await scanWmsLayer(q.url, q.layer, b, { innerhalb: polys })).map((f) => ({ ...f, q })); } catch { return []; }
  }));
  const out = [];
  for (const f of res.flat()) {
    if (!inPolys(f.at, polys)) continue;
    // sehr kleine Flecken aus Flächenlayern sind meist Punktsymbole
    const typ = f.q.typ === 'biotop' && f.px < 400 ? 'punktbiotop' : f.q.typ;
    const name = biotopName(f.props);
    if (!biotopWichtig(name, f.props)) continue;
    out.push({ type: typ, at: f.at, name, props: f.props, angaben: biotopAngaben(f.props), ...BESONDERHEIT[typ], title: name ? `${BESONDERHEIT[typ].title}: ${name}` : BESONDERHEIT[typ].title });
  }
  return out;
}

/** FFH-Wald-Lebensraumtypen als „i“-Punkte – mit Code und Namen des Lebensraumtyps */
export async function lebensraumtypen(p) {
  const polys = polysOf(p);
  const b = bbox(polys.flat(2));
  const funde = await scanWmsLayer(FORST, 'waldlebensraumtypen', b, { innerhalb: polys, max: 10 }).catch(() => []);
  const out = [];
  for (const f of funde) {
    const c = lrtCode(f.props);
    if (c && !lrtWichtig(c)) continue; // Nadelholz-LRT ohne §18 sind für die Bewirtschaftung unwichtig
    const name = c ? `${c}${LRT[c].prioritaer ? '*' : ''} ${LRT[c].name}` : biotopName(f.props);
    out.push({ type: 'lrt', at: f.at, name, code: c, props: f.props, angaben: biotopAngaben(f.props), ...BESONDERHEIT.lrt, title: name ? `${BESONDERHEIT.lrt.title} ${name}` : BESONDERHEIT.lrt.title });
  }
  return out;
}

const cache = new Map();
/** Alle Besonderheiten eines Flurstücks (zwischengespeichert für die Sitzung) */
export function besonderheiten(p) {
  if (!p || p.source !== 'alkis') return Promise.resolve(p?.features || []);
  if (!cache.has(p.id)) {
    const job = Promise.all([verkehrssicherung(p).catch(() => []), biotope(p).catch(() => []), lebensraumtypen(p).catch(() => [])]).then(([a, b2, c]) => [...a, ...b2, ...c]);
    cache.set(p.id, job);
    job.catch(() => cache.delete(p.id));
  }
  return cache.get(p.id);
}
export { centroid };

/** FFH-Wald-Lebensraumtypen innerhalb einer Fläche (Kartendienst ThüringenForst, live) → [Hinweis je LRT] */
export async function lrtInFlaeche(sel) {
  const { lrtCode, lrtHinweis } = await import('./lrt.js');
  const polys = polysOf(sel);
  const b = bbox(polys.flat(2));
  const funde = await scanWmsLayer(FORST, 'waldlebensraumtypen', b, { max: 10 }).catch(() => []);
  const codes = new Map();
  for (const f of funde) {
    if (!inPolys(f.at, polys)) continue;
    const c = lrtCode(f.props);
    if (c && !codes.has(c)) { const hw = lrtHinweis(c); if (hw) codes.set(c, hw); }
  }
  return [...codes.values()];
}
