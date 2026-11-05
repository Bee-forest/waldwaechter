// Baumarten- und Altersklassenkarte (ThüringenForst, Thüringer Waldverzeichnis) als Vektorlayer
// aus den mitgelieferten Kacheln (data/baumarten). Farben und Beschriftung nach dem QGIS-Stil
// BAUMARTEN.qml von ThüringenForst: Kategorie = KLARTEXT, Beschriftung = ABT UABT TFL.
import { bestandsKachel, artVonKurz, eigenePflanzungen, pflanzungAm, kurzArt, pflanzZeit } from './bestand.js';
import { centroid } from '../geo.js';

export const BAUMARTEN_FARBEN = {
  "Buche > 120 Jahre": "#26FF26",
  "Buche 1-40 Jahre": "#B3FFB3",
  "Buche 41-120 Jahre": "#73FF73",
  "Eiche > 120 Jahre": "#FFFF0D",
  "Eiche 1-40 Jahre": "#FFFFB3",
  "Eiche 41-120 Jahre": "#FFFF66",
  "Fichte > 100 Jahre": "#666666",
  "Fichte 1-40 Jahre": "#D9D9D9",
  "Fichte 41-100 Jahre": "#999999",
  "Kiefer > 100 Jahre": "#BF8034",
  "Kiefer 1-40 Jahre": "#D9BF73",
  "Kiefer 41-100 Jahre": "#CC995A",
  "Lärche > 100 Jahre": "#FF3358",
  "Lärche 1-40 Jahre": "#FFBFD9",
  "Lärche 41-100 Jahre": "#FF8CA7",
  "sonstiges Hartlaubholz > 100 Jahre": "#E0591B",
  "sonstiges Hartlaubholz 1-40 Jahre": "#FFBF40",
  "sonstiges Hartlaubholz 41-100 Jahre": "#FF9834",
  "Weichlaubholz > 60 Jahre": "#4DB2FF",
  "Weichlaubholz 1-40 Jahre": "#AEEBEB",
  "Weichlaubholz 41-60 Jahre": "#99DAFF"
};
export const BAUMARTEN_FARBE_SONST = '#D6374C';
export const farbeVon = (klartext) => BAUMARTEN_FARBEN[klartext] || BAUMARTEN_FARBE_SONST;

const Z = 14;
const tX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const tY = (lat) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** Z);

export function createBaumartenLayer({ minZoom = 13 } = {}) {
  const drawn = new Map();
  const Layer = L.LayerGroup.extend({
    onAdd(m) { L.LayerGroup.prototype.onAdd.call(this, m); this._m = m; this._upd = () => update(this); m.on('moveend', this._upd); update(this); },
    onRemove(m) { m.off('moveend', this._upd); L.LayerGroup.prototype.onRemove.call(this, m); this._m = null; },
  });
  async function update(group) {
    const map = group._m;
    if (!map) return;
    if (map.getZoom() < minZoom) { group.clearLayers(); drawn.clear(); return; }
    const b = map.getBounds();
    const x0 = tX(b.getWest()), x1 = tX(b.getEast()), y0 = tY(b.getNorth()), y1 = tY(b.getSouth());
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 36) return; // zu großer Ausschnitt
    eigeneZeichnen(group);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const list = await bestandsKachel(x, y);
      if (!group._m) return;
      for (const it of list) {
        const key = `${it.k || ''}|${it.r[0].slice(0, 4).join(',')}`;
        if (drawn.has(key)) continue;
        const col = farbeVon(it.t);
        const poly = L.polygon(it.rings, { color: '#3B3B3B', weight: 0.8, fillColor: col, fillOpacity: 0.55, interactive: true, bubblingMouseEvents: true });
        const alterHeute = it.a != null && it.j ? it.a + (new Date().getFullYear() - it.j) : null;
        poly.bindTooltip(`${it.k ? `<b>${it.k}</b> · ` : ''}${it.t || artVonKurz(it.b) || ''}${alterHeute != null ? ` · heute ca. ${alterHeute} J.` : ''}`, { sticky: true, className: 'stand-tip' });
        drawn.set(key, poly);
        group.addLayer(poly);
      }
    }
  }
  // Eigene, abgeschlossene Pflanzungen über dem Waldverzeichnis (Farbe der Altersklasse 1–40 Jahre)
  function eigeneZeichnen(group) {
    for (const m of eigenePflanzungen()) {
      const key = `eigen|${m.id}|${m.finishedAt || ''}`;
      if (drawn.has(key)) continue;
      const pp = m.pflanzplan || {};
      const pf = pflanzungAm(centroid(m.flaeche.ring));
      const teile = [{ ring: m.flaeche.ring, name: pp.grund || pf?.text }, ...(pp.zonen || [])];
      const tip = `<b>Eigene Pflanzung ${new Date(pflanzZeit(m)).getFullYear()}</b> · ${(pf?.arten || []).map((a) => `${a.name} ${Math.round(a.anteil || 0)} %`).join(', ')}${pf?.alter != null ? ` · ca. ${pf.alter} J.` : ''}`;
      for (const t of teile) {
        const poly = L.polygon(t.ring, { color: '#1B5E20', weight: 1.6, dashArray: '4 3', fillColor: farbeVon(`${gruppeFarbe(t.name)} 1-40 Jahre`), fillOpacity: 0.7, interactive: true, bubblingMouseEvents: true });
        poly.bindTooltip(tip, { sticky: true, className: 'stand-tip' });
        group.addLayer(poly);
      }
      drawn.set(key, true);
    }
  }
  return new Layer();
}
const gruppeFarbe = (name) => {
  const k = kurzArt(name || '');
  if (['Buche', 'Eiche', 'Fichte', 'Kiefer', 'Lärche'].includes(k)) return k;
  if (['Birke', 'Erle', 'Aspe', 'Eberesche', 'Winterlinde', 'Sommerlinde'].includes(k)) return 'Weichlaubholz';
  if (['Douglasie', 'Tanne'].includes(k)) return 'Fichte';
  return 'sonstiges Hartlaubholz';
};
