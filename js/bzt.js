// Baumartenempfehlung und Bestandeszieltypen (BZT) nach dem Thüringer Tabellenwerk
// „Standortgerechte Baumarten- und Bestandeszieltypenwahl für die Wälder des Freistaates Thüringen
// auf Grundlage der forstlichen Standortskartierung unter Beachtung des Klimawandels“ (ThüringenForst,
// Anlage 6 zur DO Waldbau, Fassung Juni 2015).
// Schlüssel: Wuchseinheit + Klimabereich (Bezugsperiode 2041–2070) + Standortseinheit. Nährkraft und
// Wasserhaushalt werden damit immer gemeinsam betrachtet – so wie im Tabellenwerk.
import { toUTM32 } from './geo.js';

let laden = null;
async function raster(url) {
  const img = await createImageBitmap(await (await fetch(url)).blob());
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return out;
}
export function bztDaten() {
  laden ??= Promise.all([
    fetch('data/bzt/katalog.json').then((r) => r.json()),
    fetch('data/bzt/klimabereiche.json').then((r) => r.json()),
    raster('data/bzt/klimabereiche.png'),
    raster('data/bzt/wuchseinheiten.png'),
  ]).then(([katalog, meta, kb, we]) => ({ katalog, meta, kb, we }));
  laden.catch(() => { laden = null; });
  return laden;
}

export const BAUMARTEN_KURZ = {
  BU: 'Rotbuche', EI: 'Eiche', ELB: 'Edellaubbäume (Ahorn, Ulme, Esche)', WTA: 'Weißtanne', TA: 'Weißtanne', FI: 'Fichte', KI: 'Kiefer', LA: 'Lärche',
  DGL: 'Douglasie', LI: 'Linde', WLI: 'Winterlinde', HBU: 'Hainbuche', KB: 'Vogelkirsche', EL: 'Elsbeere', WO: 'Wildobst', EB: 'Eberesche',
  BI: 'Birke', AS: 'Aspe', ER: 'Schwarzerle', WLB: 'Weichlaubbäume (Birke, Eberesche, Weide, Pappel, Linde)', LB: 'Laubbäume', NB: 'Nadelbäume',
};
const name = (k) => BAUMARTEN_KURZ[k] || k;
export const bztName = (code) => code.split('-').map(name).join(' – ');
export const GRUPPEN = [['BU', 'Buche'], ['EI', 'Eiche'], ['LB', 'Edellaubbäume'], ['FI', 'Fichte'], ['KI', 'Kiefer'], ['NB', 'Douglasie und Tanne']];

/** Standortsgruppe aus der Standortseinheit: Bodenfeuchtebereich + Trophie + Feuchtestufe (z. B. MG2 → M2, WMS2 → WM2) */
export function gruppeAusEinheit(code = '') {
  const m = /^([WNOBÜX]?)([ARKMZ])[A-Za-z]*?([0-9X])/.exec(code.replace(/^Q/, ''));
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}
const basis = (code) => code.replace(/[UBPKv]+$/, '').replace(/\*$/, '');

/**
 * Empfehlung für einen Punkt.
 * @param {[number, number]} latlng
 * @param {{ einheit: string, gruppe: string }} standort  aus der Standortskarte (Standortseinheiten, Standortsgruppe)
 */
export async function empfehlung(latlng, { einheit = '', gruppe = '' } = {}) {
  const { katalog, meta, kb, we } = await bztDaten();
  const [E, N] = toUTM32(latlng);
  const col = Math.floor((E - meta.E0) / meta.zelle), row = Math.floor((meta.N0 - N) / meta.zelle);
  if (col < 0 || row < 0 || col >= meta.breite || row >= meta.hoehe) return { status: 'ausserhalb' };
  const at = (c, r) => (c < 0 || r < 0 || c >= meta.breite || r >= meta.hoehe ? [0, 0] : [kb[r * meta.breite + c], we[r * meta.breite + c]]);
  const [kbHier, weIdx] = at(col, row);
  const weNr = meta.wuchseinheiten[weIdx - 1];
  if (!weNr) return { status: 'ausserhalb' };
  const weDaten = katalog.wuchseinheiten[weNr];
  const ergebnis = { wuchseinheit: weNr, wuchseinheitName: weDaten?.name || weNr, klimabereich: String(kbHier), klimabereichName: katalog.klimabereiche[kbHier] || '', einheit, gruppe };
  if (!weDaten) return { ...ergebnis, status: 'keineDaten' };

  // Klimabereiche in der Nähe (bis 1,5 km): an Grenzen sollen auch die Empfehlungen des Nachbarbereichs geprüft werden
  const nah = new Map();
  for (let r = -10; r <= 10; r++) for (let c = -10; c <= 10; c++) {
    const [k, w] = at(col + c, row + r);
    if (!k || w !== weIdx || k === kbHier) continue;
    const d = Math.hypot(r, c) * meta.zelle;
    if (!nah.has(k) || nah.get(k) > d) nah.set(k, d);
  }
  const kbListe = [String(kbHier), ...[...nah.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => String(k))].filter((k, i, a) => a.indexOf(k) === i);
  // Suche: genaue Standortseinheit → gleiche Einheit ohne Zusatz → gleiche Standortsgruppe (ähnliche Standorte)
  const grp = gruppe || gruppeAusEinheit(einheit);
  const suche = (tab) => {
    if (!tab) return null;
    if (einheit && tab[einheit]) return { code: einheit, art: 'genau' };
    const b = basis(einheit);
    const gleich = Object.keys(tab).find((c) => basis(c) === b);
    if (b && gleich) return { code: gleich, art: 'zusatz' };
    const aehnlich = Object.keys(tab).filter((c) => gruppeAusEinheit(c) === grp);
    if (grp && aehnlich.length) return { code: aehnlich[0], art: 'gruppe', alle: aehnlich };
    return null;
  };
  let wahl = null, kbWahl = null;
  for (const k of kbListe) {
    const s = suche(weDaten.kb[k]);
    if (s && (!wahl || (s.art === 'genau' && wahl.art !== 'genau'))) { wahl = s; kbWahl = k; if (s.art === 'genau' || k === String(kbHier)) break; }
  }
  if (!wahl) {
    // andere Klimabereiche derselben Wuchseinheit
    for (const k of Object.keys(weDaten.kb)) { const s = suche(weDaten.kb[k]); if (s) { wahl = s; kbWahl = k; break; } }
  }
  if (!wahl) return { ...ergebnis, status: 'keinEintrag' };
  const eintrag = weDaten.kb[kbWahl][wahl.code];
  const nachbarn = [...nah.entries()].filter(([k]) => String(k) !== kbWahl && weDaten.kb[String(k)]).map(([k, d]) => {
    const s = suche(weDaten.kb[String(k)]);
    return s ? { klimabereich: String(k), name: katalog.klimabereiche[k], abstand: Math.round(d / 100) * 100, eintrag: weDaten.kb[String(k)][s.code] } : null;
  }).filter(Boolean);
  // Liegt der Punkt in einem Klimabereich, den das Tabellenwerk für diese Wuchseinheit nicht führt:
  // Eintrag derselben Standortseinheit und desselben Klimabereichs aus einer benachbarten Wuchseinheit (bis 3 km)
  let andereWE = null;
  if (kbWahl !== String(kbHier) && kbHier) {
    const gesehen = new Set();
    for (let rad = 1; rad <= 20 && !andereWE; rad++) for (let r = -rad; r <= rad && !andereWE; r++) for (let c = -rad; c <= rad && !andereWE; c++) {
      if (Math.max(Math.abs(r), Math.abs(c)) !== rad) continue;
      const [, w] = at(col + c, row + r);
      if (!w || w === weIdx || gesehen.has(w)) continue;
      gesehen.add(w);
      const nr = meta.wuchseinheiten[w - 1];
      const s2 = suche(katalog.wuchseinheiten[nr]?.kb[String(kbHier)]);
      if (s2) andereWE = { wuchseinheit: nr, name: katalog.wuchseinheiten[nr].name, code: s2.code, abstand: Math.round(rad * meta.zelle / 100) * 100, eintrag: katalog.wuchseinheiten[nr].kb[String(kbHier)][s2.code] };
    }
  }
  return { ...ergebnis, status: 'ok', andereWE, klimabereichTabelle: kbWahl, klimabereichTabelleName: katalog.klimabereiche[kbWahl], code: wahl.code, treffer: wahl.art, eintrag, nachbarn, quelle: katalog.quelle };
}

/** Welche Eichenart? (Hinweis aus dem Tabellenwerk) */
export function eichenHinweis(gruppe = '') {
  const m = /^([WNOBÜX]?)([ARKMZ])([0-9X])?/.exec(gruppe);
  if (!m) return null;
  const [, bereich, troph, feuchte] = m;
  if (bereich === 'W') return 'Eiche hier: auf wechselfeuchten Standorten Roteiche, auf hydromorphen (nassen) Standorten Stieleiche.';
  if (bereich || feuchte === '1') return 'Eiche hier: Stieleiche (hydromorphe und frische Standorte).';
  if (['A', 'Z'].includes(troph)) return 'Eiche hier: Roteiche (trockene, arme Standorte).';
  return 'Eiche hier: Traubeneiche (trockene, mäßig nährstoffhaltige bis reiche Standorte).';
}
