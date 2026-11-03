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
// Nährkraftstufen der forstlichen Standortserkundung: A arm … R reich
export const NAEHRKRAFT = [
  { k: 'A', label: 'arm' }, { k: 'Z', label: 'ziemlich arm' }, { k: 'M', label: 'mittel' }, { k: 'K', label: 'kräftig' }, { k: 'R', label: 'reich' },
];
// Feuchte aus der Beschreibung ablesen (nass … trocken)
export const FEUCHTE = [
  { re: /trocken/, label: 'trocken', v: 1 }, { re: /mäßig trocken|maessig trocken|mässig trocken/, label: 'mäßig trocken', v: 2 },
  { re: /mäßig frisch|maessig frisch|mässig frisch/, label: 'mäßig frisch', v: 3 }, { re: /ziemlich frisch/, label: 'ziemlich frisch', v: 3.5 },
  { re: /frisch/, label: 'frisch', v: 4 }, { re: /wechselfeucht|feucht/, label: 'feucht', v: 5 }, { re: /nass|sumpf|moor/, label: 'nass', v: 6 },
];

export function explainStandort(p) {
  const desc = umlaut(p.Beschreibung || '');
  const gruppe = p.Standortsguppe || p.Standortsgruppe || '';
  const nk = NAEHRKRAFT.findIndex((n) => n.k === gruppe.trim()[0]?.toUpperCase());
  const lower = desc.toLowerCase();
  // spezifischere Muster zuerst prüfen
  const fe = [...FEUCHTE].sort((a, b) => String(b.re).length - String(a.re).length).find((f) => f.re.test(lower));
  const tips = [];
  if (nk >= 0 && nk <= 1) tips.push('Nährstoffarm: genügsame Baumarten wie Kiefer, Birke, Traubeneiche; Nadelstreu nicht entfernen.');
  if (nk === 2) tips.push('Mittlere Nährstoffversorgung: Buche, Fichte, Lärche, Douglasie und Mischungen wachsen hier gut.');
  if (nk >= 3) tips.push('Gut nährstoffversorgt: anspruchsvolle Laubbäume wie Edellaubholz (Ahorn, Kirsche, Esche) und Eiche möglich.');
  if (fe && fe.v <= 2) tips.push('Eher trocken: trockenheitsertragende Baumarten bevorzugen (Kiefer, Eiche, Elsbeere); Fichte meiden.');
  if (fe && fe.v >= 5) tips.push('Feucht bis nass: Bodenschutz beim Befahren beachten (nur bei Frost oder Trockenheit); Erle, Esche, Stieleiche geeignet.');
  return { desc, gruppe, einheit: p.Standortseinheiten || '', bodenform: p.Bodenform || '', wasser: p.Wasserhaushaltsstufe || '', nk, fe, tips };
}
