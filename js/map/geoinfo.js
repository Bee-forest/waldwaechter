// Fachinformationen zum angetippten Punkt (Geoportal Thüringen, live, ohne Speicherung)
// und ihre verständliche Aufbereitung.

const GP = 'https://www.geoproxy.geoportal-th.de/geoproxy/services';
const FORST = `${GP}/forst/FORST`;
const SCHUTZ = `${GP}/SCHUTZGEB`;

const QUERIES = [
  { key: 'standort', url: FORST, layer: 'standort_fl' },
  { key: 'zustaendig', url: FORST, layer: 'hoheitsstruktur' },
  { key: 'funktion', url: FORST, layer: 'bodenschutzfunktion', label: 'Bodenschutzwald', icon: '⛰', text: 'Schützt den Boden am Hang vor Abtrag. Kahlschläge vermeiden, Rückegassen hangparallel anlegen.' },
  { key: 'funktion', url: FORST, layer: 'erholungswald', label: 'Erholungswald', icon: '🚶', text: 'Rechtlich ausgewiesener Erholungswald. Wege freihalten, Arbeiten deutlich absperren, Verkehrssicherung besonders ernst nehmen.' },
  { key: 'funktion', url: FORST, layer: 'erholungsfunktion', label: 'Erholungsfunktion', icon: '🌳', text: 'Wird viel zur Erholung genutzt. Auf Waldbild und Wege Rücksicht nehmen.' },
  { key: 'funktion', url: FORST, layer: 'klimaschutzfunktion', label: 'Klimaschutzwald', icon: '🌡', text: 'Gleicht das örtliche Klima aus (z. B. Kaltluft, Frischluft für Siedlungen). Dauerhaft geschlossenen Wald erhalten.' },
  { key: 'funktion', url: FORST, layer: 'immissionsschutzfunktion', label: 'Immissionsschutzwald', icon: '🏭', text: 'Filtert Staub und Schadstoffe, z. B. an Straßen oder Industrie. Dichte, stufige Waldränder erhalten.' },
  { key: 'funktion', url: FORST, layer: 'laermschutzfunktion', label: 'Lärmschutzwald', icon: '🔇', text: 'Dämpft Lärm von Straßen oder Gewerbe. Dichte Bestockung zur Lärmquelle hin erhalten.' },
  { key: 'funktion', url: FORST, layer: 'sichtschutzfunktion', label: 'Sichtschutzwald', icon: '👁', text: 'Verdeckt z. B. Steinbrüche oder Anlagen. Sichtschutz bei Eingriffen nicht öffnen.' },
  { key: 'wald', url: FORST, layer: 'waldbiotope', label: 'Waldbiotop', text: 'Besonders wertvoller Bereich, teilweise gesetzlich geschützt (§ 30 BNatSchG). Nicht beeinträchtigen.' },
  { key: 'wald', url: FORST, layer: 'waldlebensraumtypen', label: 'FFH-Waldlebensraumtyp', text: 'Geschützte Waldgesellschaft im FFH-Gebiet. Typische Baumarten erhalten, Verschlechterungsverbot.' },
  { key: 'wald', url: FORST, layer: 'naturwaldparzelle', label: 'Naturwaldparzelle', text: 'Wald, der sich ohne Bewirtschaftung entwickelt. Keine Holznutzung.' },
  { key: 'wald', url: FORST, layer: 'waldschaeden', label: 'Waldschadfläche', text: 'Abgestorbener oder geräumter Wald. Wiederbewaldung nötig, Förderung möglich.' },
  { key: 'schutz', url: SCHUTZ, layer: 'nsg', label: 'Naturschutzgebiet', short: 'NSG', level: 3, text: 'Strenger Schutz. Holzernte, Wegebau und Befahren sind oft eingeschränkt – vor Maßnahmen die Verordnung lesen und die Untere Naturschutzbehörde fragen.' },
  { key: 'schutz', url: SCHUTZ, layer: 'ffh_geb', label: 'FFH-Gebiet', short: 'FFH', level: 2, text: 'Europäisches Schutzgebiet. Verschlechterungsverbot für Lebensräume und Arten; Managementplan beachten.' },
  { key: 'schutz', url: SCHUTZ, layer: 'spa', label: 'Vogelschutzgebiet', short: 'SPA', level: 2, text: 'Schutz seltener Vogelarten. Brut- und Horstbäume erhalten, Arbeiten möglichst außerhalb der Brutzeit (März–August).' },
  { key: 'schutz', url: SCHUTZ, layer: 'nationalpark', label: 'Nationalpark', short: 'NLP', level: 3, text: 'Natur soll sich weitgehend selbst überlassen bleiben. Bewirtschaftung stark eingeschränkt.' },
  { key: 'schutz', url: SCHUTZ, layer: 'biosreserv', label: 'Biosphärenreservat', short: 'BR', level: 2, text: 'Modellregion für nachhaltiges Wirtschaften. Je nach Zone unterschiedliche Regeln.' },
  { key: 'schutz', url: SCHUTZ, layer: 'lsg', label: 'Landschaftsschutzgebiet', short: 'LSG', level: 1, text: 'Schützt das Landschaftsbild. Ordnungsgemäße Forstwirtschaft ist in der Regel erlaubt; Umwandlung oder Bebauung nicht.' },
  { key: 'schutz', url: SCHUTZ, layer: 'naturpark', label: 'Naturpark', short: 'NP', level: 0, text: 'Großräumige Erholungslandschaft. Für die Waldbewirtschaftung meist ohne besondere Auflagen.' },
];

function gfiUrl(url, layer, [lat, lng]) {
  const R = 6378137;
  const x = (lng * Math.PI / 180) * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
  const half = 100 / Math.cos(lat * Math.PI / 180); // 200-m-Fenster, 101 px → Maßstab ≈ 1:7.000
  return `${url}?${new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: layer, QUERY_LAYERS: layer, STYLES: '', CRS: 'EPSG:3857',
    BBOX: [x - half, y - half, x + half, y + half].join(','), WIDTH: '101', HEIGHT: '101', I: '50', J: '50',
    INFO_FORMAT: 'application/vnd.ogc.gml', FEATURE_COUNT: '3',
  })}`;
}

const SKIP = new Set(['boundedBy', 'Box', 'coordinates', 'Point', 'pos', 'posList', 'gml_id', 'localId', 'null', 'Flaeche', 'Shape_Area', 'Shape_Length', 'OBJECTID', 'FID', 'id']);

function parseFeatures(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const members = [...doc.getElementsByTagNameNS('*', 'featureMember'), ...doc.getElementsByTagNameNS('*', 'member')];
  const roots = members.length ? members : [doc.documentElement];
  const out = [];
  for (const m of roots) {
    const props = {};
    for (const el of m.getElementsByTagName('*')) {
      if (el.children.length) continue;
      const k = el.localName, v = el.textContent.trim();
      if (!v || v === 'missing' || SKIP.has(k)) continue;
      if (!(k in props)) props[k] = v;
    }
    if (Object.keys(props).length) out.push(props);
  }
  return out;
}

// Die Dienste schreiben ohne Umlaute. Nur bekannte Wortteile ersetzen, damit z. B. „Quelle“ nicht zu „Qülle“ wird.
const UML = [['maessig', 'mäßig'], ['mässig', 'mäßig'], ['kraeftig', 'kräftig'], ['naehr', 'nähr'], ['Naehr', 'Nähr'], ['waeld', 'wäld'], ['Waeld', 'Wäld'],
  ['boed', 'böd'], ['Boed', 'Böd'], ['hoeh', 'höh'], ['Hoeh', 'Höh'], ['ueber', 'über'], ['Ueber', 'Über'], ['gruen', 'grün'], ['Gruen', 'Grün'],
  ['staerk', 'stärk'], ['saeur', 'säur'], ['laess', 'läss'], ['Gewaess', 'Gewäss'], ['gewaess', 'gewäss'], ['Flaech', 'Fläch'], ['flaech', 'fläch'],
  ['schuetz', 'schütz'], ['Schuetz', 'Schütz'], ['Hoehl', 'Höhl'], ['Gehoelz', 'Gehölz'], ['moeglich', 'möglich'], ['Oed', 'Öd']];
export const umlaut = (t = '') => UML.reduce((s, [a, b]) => s.split(a).join(b), t);

/** Fragt alle Fachebenen am Punkt ab. Ergebnis gruppiert, nichts wird gespeichert. */
export async function queryPoint(latlng) {
  const results = await Promise.all(QUERIES.map(async (q) => {
    try {
      const res = await fetch(gfiUrl(q.url, q.layer, latlng), { mode: 'cors' });
      if (!res.ok) return { q, feats: [], error: true };
      return { q, feats: parseFeatures(await res.text()) };
    } catch { return { q, feats: [], error: true }; }
  }));
  const out = { standort: null, zustaendig: null, funktion: [], wald: [], schutz: [], failed: results.every((r) => r.error) };
  for (const { q, feats } of results) {
    if (!feats.length) continue;
    if (q.key === 'standort') out.standort = feats[0];
    else if (q.key === 'zustaendig') out.zustaendig = feats[0];
    else for (const f of feats) out[q.key].push({ ...q, props: f });
  }
  out.schutz.sort((a, b) => b.level - a.level);
  return out;
}

// ---------- Standort verständlich machen ----------
// Schlüssel der Standortsformengruppe (forstliche Standortserkundung Thüringen):
// [Feuchtebereich] Nährkraftstufe Feuchtestufe [C = carbonatisch], z. B. M2, WM1, R2C, NZ2
export const NAEHRKRAFT = [
  { k: 'A', label: 'arm' }, { k: 'Z', label: 'ziemlich arm' }, { k: 'M', label: 'mäßig nährstoffhaltig' }, { k: 'K', label: 'kräftig' }, { k: 'R', label: 'reich' },
];
export const WASSER_SKALA = ['sehr trocken', 'trockener', 'mittelfrisch', 'frisch', 'feucht', 'nass'];

const BEREICH = {
  '': { label: 'unvernässter (normaler) Standort', stufen: { 1: ['frischere', 3], 2: ['mittelfrische', 2], 3: ['trockenere', 1] } },
  T: { label: 'unvernässter (normaler) Standort', stufen: { 1: ['frischere', 3], 2: ['mittelfrische', 2], 3: ['trockenere', 1] } },
  W: { label: 'Standort mit Wechselfeuchte', wechsel: true, stufen: { 1: ['wechselfeucht', 4], 2: ['wechselfrisch', 3], 3: ['wechseltrocken', 1] } },
  N: { label: 'mineralischer Nassstandort', stufen: { 1: ['nass', 5], 2: ['feucht', 4] } },
  O: { label: 'organischer Nassstandort (Moor)', stufen: { 1: ['nass (Moor)', 5], 2: ['nass (Moor)', 5], 3: ['feucht (Moor)', 4] } },
  B: { label: 'Bachtälchen-Standort', stufen: { 1: ['feucht', 4], 2: ['frisch', 3] } },
  Ü: { label: 'auenähnlicher Standort', stufen: { 1: ['feucht', 4], 2: ['frisch', 3] } },
  X: { label: 'unvernässter, schwer bewirtschaftbarer bzw. schutzwürdiger Standort', stufen: { F: ['sehr frisch, kühlfeucht', 4], S1: ['frischere', 3], S2: ['mittelfrische', 2], S3: ['trockenere', 1], X: ['sehr trockene', 0] } },
};
const ROMAN = { I: '1', II: '2', III: '3' };

/** Entschlüsselt z. B. „WM1“ → wechselfeucht, mäßig nährstoffhaltig */
export function decodeGruppe(code = '') {
  let c = code.trim().toUpperCase().replace('UE', 'Ü');
  const out = { code: code.trim(), bereich: '', nk: -1, stufe: null, wasser: -1, carbonat: false };
  if (!c) return out;
  if (c.endsWith('C')) { out.carbonat = true; c = c.slice(0, -1); }
  const nkIdx = (ch) => NAEHRKRAFT.findIndex((n) => n.k === ch);
  if (/^[TWNOBÜX]/.test(c) && nkIdx(c[1]) >= 0) { out.bereich = c[0]; c = c.slice(1); }
  if (nkIdx(c[0]) >= 0) { out.nk = nkIdx(c[0]); c = c.slice(1); }
  let st = c.replace(/^\(|\)$/g, '');
  st = ROMAN[st] || st;
  const b = BEREICH[out.bereich] || BEREICH[''];
  const hit = b.stufen[st] || b.stufen[st.replace(/\D/g, '')];
  if (hit) { out.stufe = hit[0]; out.wasser = hit[1]; }
  out.bereichLabel = b.label;
  out.wechsel = !!b.wechsel;
  return out;
}

export function explainStandort(p) {
  const desc = umlaut(p.Beschreibung || '');
  const gruppe = (p.Standortsguppe || p.Standortsgruppe || '').trim();
  const d = decodeGruppe(gruppe);
  const tips = [];
  const nk = d.nk;
  if (nk >= 0 && nk <= 1) tips.push('Nährstoffarm: genügsame Baumarten wie Kiefer, Birke, Traubeneiche. Nadelstreu und Totholz im Bestand lassen.');
  if (nk === 2) tips.push('Mäßige Nährstoffversorgung: Buche, Fichte, Lärche, Douglasie, Tanne und Mischungen wachsen hier gut.');
  if (nk >= 3) tips.push('Gut nährstoffversorgt: auch anspruchsvolle Laubbäume wie Bergahorn, Kirsche, Esche, Eiche und Linde möglich.');
  if (d.wechsel) tips.push('Wechselfeucht: im Frühjahr nass, im Sommer oft trocken. Tiefwurzler wie Eiche, Tanne und Hainbuche bevorzugen; Fichte ist hier sturmgefährdet. Nur bei Frost oder Trockenheit befahren.');
  else if (d.wasser >= 4) tips.push('Feucht bis nass: Boden ist empfindlich – nur bei Frost oder Trockenheit befahren, Rückegassen nutzen. Geeignet sind z. B. Erle, Esche, Stieleiche, Moorbirke.');
  else if (d.wasser >= 0 && d.wasser <= 1) tips.push('Eher trocken: trockenheitsertragende Baumarten bevorzugen (Kiefer, Traubeneiche, Elsbeere, Douglasie); Fichte meiden.');
  if (d.carbonat) tips.push('Kalkhaltiger Boden: Buche, Elsbeere, Feldahorn und Kiefer geeignet; Douglasie und Fichte meiden.');
  if (d.bereich === 'X') tips.push('Schwer bewirtschaftbar bzw. schutzwürdig (z. B. Steilhang, Blockschutt): nur vorsichtige Eingriffe, Bodenschutz hat Vorrang.');
  return { desc, gruppe, d, einheit: p.Standortseinheiten || '', bodenform: p.Bodenform || '', wasserStufe: p.Wasserhaushaltsstufe || '', tips };
}
