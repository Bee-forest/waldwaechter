// Besonderheiten eines Flurstücks als „i“-Punkte auf der Karte:
//  • Verkehrssicherungspflicht: Wald liegt bis 60 m an öffentlichen Straßen/Wegen/Plätzen, Bahnstrecken
//    oder Gebäuden (OpenStreetMap über Overpass, live abgefragt) – ein Punkt je Straße bzw. Gebäudegruppe
//  • Biotope: Punkt-, Linien- und Flächenbiotope aus Waldbiotop- und Offenlandbiotopkartierung
//    (Kartendienste des Geoportals, live abgefragt, nichts gespeichert)
import { bbox, polysOf, inPolys, centroid } from '../geo.js';
import { scanWmsLayer, nutzungAnteile, FORST, GP } from './thueringen.js';
import { umlaut } from './geoinfo.js';
import { biotopWichtig, lrtCode, lrtWichtig, LRT } from './lrt.js';

export const BESONDERHEIT = {
  vsp: {
    title: 'Verkehrssicherungspflicht',
    text: 'Dein Wald liegt hier bis 60 m an einer öffentlichen Straße, einem öffentlichen Weg oder Platz, einer Bahnstrecke oder an Gebäuden. Bäume, die beim Umfallen dorthin reichen können, musst du kontrollieren: Von ihnen darf keine erkennbare Gefahr ausgehen, etwa durch tote Äste oder kranke Bäume. Kontrolliere diesen Streifen zweimal im Jahr – belaubt und unbelaubt – und schreib die Kontrolle auf. Waldwege und private Wege lösen diese Pflicht nicht aus.',
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

// ---------- Verkehrssicherung: öffentliche Verkehrswege, Bahn und Gebäude bis 60 m ----------
// Rechtsgrundlage ist die allgemeine Verkehrssicherungspflicht (§ 823 BGB, Rechtsprechung): Der Waldbesitzer
// muss Bäume kontrollieren, die beim Umfallen öffentliche Straßen, Wege, Plätze, Bahnanlagen oder Gebäude
// treffen können – üblich ist ein Streifen von mindestens einer Baumlänge. Hier: 60 m (Vorgabe).
// Waldwege und private Wege lösen keine Pflicht aus (Betreten des Waldes auf eigene Gefahr, § 14 BWaldG / § 6 ThürWaldG).
export const VSP_ABSTAND_M = 60;
const OEFFENTLICH = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road|pedestrian|cycleway|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$/;
const PRIVAT = /^(private|no|agricultural|forestry|delivery|customers|permit)$/;
const GEBAEUDE_ART = { house: 'Wohnhaus', residential: 'Wohngebäude', detached: 'Wohnhaus', semidetached_house: 'Wohnhaus', apartments: 'Wohngebäude', terrace: 'Reihenhaus', farm: 'Bauernhaus', garage: 'Garage', garages: 'Garagen', barn: 'Scheune', shed: 'Schuppen', hut: 'Hütte', cabin: 'Hütte', farm_auxiliary: 'Nebengebäude', industrial: 'Gewerbegebäude', commercial: 'Gewerbegebäude', church: 'Kirche', school: 'Schule' };

/** Ist ein OSM-Weg ein öffentlicher Verkehrsweg (bzw. Bahn/öffentlicher Platz)? */
export function oeffentlich(tags = {}) {
  if (PRIVAT.test(tags.access || '') || PRIVAT.test(tags['motor_vehicle'] || '') && !tags.highway?.match(/cycleway|pedestrian/)) return false;
  if (tags.railway) return /^(rail|light_rail|tram|narrow_gauge)$/.test(tags.railway) && !tags.disused && !tags.abandoned;
  if (tags.amenity === 'parking') return !PRIVAT.test(tags.access || '');
  if (tags.highway === 'service') return /^(yes|public|permissive|destination)$/.test(tags.access || '') && tags.service !== 'driveway';
  return OEFFENTLICH.test(tags.highway || '');
}

async function overpass(b, rand) {
  const k = 111320 * Math.cos(((b.s + b.n) / 2) * Math.PI / 180);
  const bb = [b.s - rand / 110540, b.w - rand / k, b.n + rand / 110540, b.e + rand / k].map((v) => v.toFixed(6)).join(',');
  // „out geom“ liefert Tags, Knoten (für das Zusammenfassen von Straßenstücken) und Geometrie
  const q = `[out:json][timeout:25];(way["highway"](${bb});way["railway"](${bb});way["building"](${bb});way["amenity"="parking"](${bb}););out geom;`;
  // Der Hauptserver ist oft ausgelastet (429/504) – dann kurz warten und Ausweichserver probieren
  const server = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  let fehler = null;
  for (let versuch = 0; versuch < server.length * 2; versuch++) {
    const url = server[versuch % server.length];
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: ctl.signal });
      clearTimeout(t);
      // X-Offline: Ersatzantwort des Service-Workers ohne Netz – das ist kein „keine Straße“, sondern „nicht geprüft“
      if (res.ok && !res.headers.get('X-Offline')) { const j = await res.json(); if (Array.isArray(j.elements)) return j.elements; }
      fehler = new Error(`Overpass ${res.status}`);
    } catch (e) { fehler = e; }
    await new Promise((r) => setTimeout(r, 800 * (versuch + 1)));
  }
  throw fehler || new Error('Overpass nicht erreichbar');
}

/**
 * Pure Auswertung: welche Objekte liegen bis maxM an der Fläche? Je Objekt-Gruppe (eine Straße, eine Bahnstrecke,
 * eine Gebäudegruppe) genau EIN Punkt – an der Stelle der Fläche, die dem Objekt am nächsten liegt.
 */
export function vspAuswerten(polys, elemente, maxM = VSP_ABSTAND_M) {
  const alle = polys.flat(2);
  const lat0 = alle.reduce((a, q) => a + q[0], 0) / alle.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const xy = ([la, lo]) => [lo * kx, la * ky];
  const ll = ([x, y]) => [y / ky, x / kx];
  // Flächenrand in 5-m-Schritten
  const rand = [];
  for (const poly of polys) for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) {
    const a = xy(ring[i]), b = xy(ring[i + 1]), n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5));
    for (let t = 0; t < n; t++) rand.push([a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n]);
  }
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const minAbstand = (linien) => {
    let best = { d: Infinity, at: null };
    for (const L of linien) {
      // Objekt liegt in der Fläche → Abstand 0 an diesem Objektpunkt
      for (const q of L) if (inPolys(ll(q), polys)) return { d: 0, at: ll(q) };
      for (const r of rand) for (let i = 0; i < L.length - 1; i++) { const d = segDist(r, L[i], L[i + 1]); if (d < best.d) best = { d, at: ll(r) }; }
    }
    // verläuft das Objekt parallel zum Rand, sind viele Randpunkte gleich nah → die Mitte dieses Abschnitts nehmen
    if (best.at) {
      const gleich = rand.filter((r) => linien.some((L) => L.some((_, i) => i < L.length - 1 && segDist(r, L[i], L[i + 1]) <= best.d + 1)));
      if (gleich.length > 2) best.at = ll(gleich[Math.floor(gleich.length / 2)]);
    }
    return best;
  };
  // Gruppen bilden
  const wege = [], gebaeude = [];
  for (const el of elemente) {
    if (el.type !== 'way' || !el.geometry?.length) continue;
    const t = el.tags || {}, linie = el.geometry.map((g) => xy([g.lat, g.lon]));
    if (t.building) gebaeude.push({ el, linie, mitte: linie.reduce((a, q) => [a[0] + q[0] / linie.length, a[1] + q[1] / linie.length], [0, 0]) });
    else if (oeffentlich(t)) wege.push({ el, linie, key: t.railway ? `bahn:${t.name || t.ref || el.id}` : t.amenity === 'parking' ? `platz:${el.id}` : (t.ref || t.name) ? `str:${t.ref || ''}|${t.name || ''}` : null, knoten: new Set(el.nodes || []) });
  }
  // unbenannte Wege über gemeinsame Knoten zu einem Weg zusammenfassen
  const gruppen = new Map();
  for (const w of wege) {
    if (!w.key) {
      const nachbar = wege.find((v) => v !== w && v.gruppe && [...w.knoten].some((n) => v.knoten.has(n)));
      w.key = nachbar ? nachbar.gruppe : `weg:${w.el.id}`;
    }
    w.gruppe = w.key;
    (gruppen.get(w.key) || gruppen.set(w.key, []).get(w.key)).push(w);
  }
  const out = [];
  for (const [key, ws] of gruppen) {
    const m = minAbstand(ws.map((w) => w.linie));
    if (!(m.d <= maxM)) continue;
    const t = ws[0].el.tags || {};
    const art = key.startsWith('bahn') ? 'Bahnstrecke' : key.startsWith('platz') ? 'öffentlicher Parkplatz' : t.highway === 'cycleway' ? 'Radweg' : 'öffentliche Straße';
    const name = [t.ref, t.name].filter(Boolean).join(' ');
    // Abschnitt des Objekts, der näher als maxM an der Fläche liegt (für die Linie auf der Karte)
    const linie = [];
    for (const w of ws) for (const q of w.linie) if (rand.some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) <= maxM)) linie.push(ll(q));
    out.push({ type: 'vsp', at: m.at, art, objekt: name ? `${art} ${name}` : art, abstand: Math.round(m.d), line: linie.length > 1 ? linie : null });
  }
  // Gebäude: Gruppen (bis 40 m auseinander) → ein Punkt je Gruppe
  const nah = gebaeude.map((g) => ({ ...g, m: minAbstand([g.linie]) })).filter((g) => g.m.d <= maxM);
  const frei = new Set(nah);
  for (const g of nah) {
    if (!frei.has(g)) continue;
    const gruppe = [g]; frei.delete(g);
    for (let i = 0; i < gruppe.length; i++) for (const h2 of [...frei]) if (Math.hypot(gruppe[i].mitte[0] - h2.mitte[0], gruppe[i].mitte[1] - h2.mitte[1]) <= 40) { gruppe.push(h2); frei.delete(h2); }
    const naechstes = gruppe.reduce((a, b) => (b.m.d < a.m.d ? b : a));
    const arten = [...new Set(gruppe.map((x) => GEBAEUDE_ART[x.el.tags.building] || 'Gebäude'))];
    out.push({ type: 'vsp', at: naechstes.m.at, art: 'Gebäude', objekt: gruppe.length > 1 ? `${gruppe.length} Gebäude (${arten.join(', ')})` : arten[0], abstand: Math.round(naechstes.m.d), line: null });
  }
  return out;
}

export async function verkehrssicherung(p) {
  const teile = nutzungAnteile(p);
  if (teile && !(teile.Wald > 0)) return []; // kein Wald auf dem Flurstück
  const polys = polysOf(p);
  const b = bbox(polys.flat(2));
  const elemente = await overpass(b, VSP_ABSTAND_M + 10);
  return vspAuswerten(polys, elemente).map((f) => ({ ...f, ...BESONDERHEIT.vsp, title: `${BESONDERHEIT.vsp.title}: ${f.objekt}` }));
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
    const fehler = [];
    const job = Promise.all([
      verkehrssicherung(p).catch((e) => { console.warn('Verkehrssicherung', e); fehler.push('vsp'); return []; }),
      biotope(p).catch(() => { fehler.push('biotop'); return []; }),
      lebensraumtypen(p).catch(() => { fehler.push('lrt'); return []; }),
    ]).then(([a, b2, c]) => {
      const alle = [...a, ...b2, ...c];
      alle.fehler = fehler;
      if (fehler.length) cache.delete(p.id); // beim nächsten Antippen erneut versuchen
      return alle;
    });
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
