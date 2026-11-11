// Datenadapter: einzige Stelle, die weiß, woher Flurstücke, Bestände und
// Rettungspunkte kommen. Die Oberfläche nutzt nur diese Funktionen.
//
// Flurstücke: echte ALKIS-Daten über den WFS des Geoproxy Thüringen.
// Zusätzlich (Einstellung „Demo-Daten“) erfundene Beispielflächen mit
// Besonderheiten, Beständen und Rettungspunkten zum Ausprobieren.
// Noch nicht angebunden: Schutzgebiete/Biotope/Waldfunktionen (TLUBN,
// ThüringenForst), KWF-Rettungspunkte, Forsteinrichtung/Baumartenkarte.

import { parcels as demoParcels, stands, rescuePoints, gemarkungen, DEMO_CENTER } from './demo-data.js';
import { pointInPolygon, inPolys, polysOf, distance } from '../geo.js';
import { bestaendeImFlurstueck } from '../map/bestand.js';
import { wfsParcelAt, wfsSearch, localParcelAt, localSearch } from '../map/thueringen.js';
import { store } from '../store.js';

const cache = new Map(); // per WFS geladene Flurstücke dieser Sitzung
const demoOn = () => store.get().settings.demo;
const stored = () => store.get().parcels.filter((p) => p.ring);

function remember(list) { for (const p of list) cache.set(p.id, p); return list; }

export const source = {
  get isDemo() { return demoOn(); },
  center: DEMO_CENTER,
  gemarkungen: () => (demoOn() ? gemarkungen : []),
  lastError: null,

  /** Alle bekannten Flurstücke: eigene (gespeichert), in dieser Sitzung geladene, ggf. Demo */
  async allParcels() {
    const map = new Map();
    if (demoOn()) demoParcels.forEach((p) => map.set(p.id, p));
    cache.forEach((p, id) => map.set(id, p));
    stored().forEach((p) => { if (!map.has(p.id)) map.set(p.id, p); });
    return [...map.values()];
  },

  async parcelById(id) {
    return cache.get(id) || stored().find((p) => p.id === id) || demoParcels.find((p) => p.id === id) || null;
  },

  async parcelAt(latlng) {
    if (demoOn()) {
      const d = demoParcels.find((p) => pointInPolygon(latlng, p.ring));
      if (d) return d;
    }
    const own = stored().find((p) => inPolys(latlng, polysOf(p)));
    // mitgelieferte ALKIS-Daten (data/alkis); hängt das Laden, nach 8 s mit dem Dienst weitermachen
    const loc = await Promise.race([localParcelAt(latlng).catch(() => null), new Promise((r) => setTimeout(() => r(null), 8000))]);
    if (loc) { source.lastError = null; remember([loc]); return loc; }
    try {
      const p = await wfsParcelAt(latlng);
      source.lastError = null;
      if (p) { remember([p]); return p; }
      return own || null;
    } catch (e) {
      source.lastError = e;
      return own || null;
    }
  },

  async search(q) {
    const out = [];
    if (demoOn()) {
      const norm = (s) => String(s ?? '').trim().toLowerCase();
      out.push(...demoParcels.filter((p) =>
        (!q.gemarkung || norm(p.gemarkung).includes(norm(q.gemarkung))) &&
        (!q.flur || String(p.flur) === String(q.flur).trim()) &&
        (!q.nr || norm(p.nr) === norm(q.nr))));
    }
    const loc = await localSearch(q);
    if (loc?.length) { source.lastError = null; return [...out, ...remember(loc)]; }
    try {
      out.push(...remember(await wfsSearch(q)));
      source.lastError = null;
    } catch (e) {
      source.lastError = e;
      if (!out.length) throw e;
    }
    return out;
  },

  async standsForParcels(ids) {
    const demo = demoOn() ? stands.filter((s) => ids.includes(s.parcelId)) : [];
    const real = [];
    for (const id of ids) {
      const p = cache.get(id) || stored().find((x) => x.id === id);
      if (p?.source === 'alkis') real.push(...(await bestaendeImFlurstueck(p).catch(() => [])));
    }
    return [...demo, ...real];
  },

  /** Rettungspunkte nur aus den Demo-Daten – für echte Flächen bewusst keine erfundenen Punkte */
  async nearestRescuePoints(latlng, n = 2, parcel) {
    if (!demoOn() || parcel?.source === 'alkis') return [];
    return rescuePoints
      .map((rp) => ({ ...rp, dist: distance(latlng, rp.at) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, n);
  },

  async allRescuePoints() { return demoOn() ? rescuePoints : []; },
};
