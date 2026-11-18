// Ebene „Standort × Baumart“: färbt die eigenen Flurstücke nach der Ampel (geeignet / Risiko / ungeeignet).
// Je Fläche: vorherrschende Baumart (eigene Angaben, Pflanzung oder Waldverzeichnis) gegen das Tabellenwerk
// am Mittelpunkt. Ergebnisse werden 30 Tage im Gerät zwischengespeichert, weil jede Fläche den Geodienst abfragt.
import { store } from '../store.js';
import { source } from '../data/source.js';
import { centroid, polysOf } from '../geo.js';
import { bestandInFlaeche, pflanzungAm } from './bestand.js';
import { empfehlungMitErsatz } from '../bzt.js';
import { queryPoint } from './geoinfo.js';
import { standortAmpel, AMPEL } from '../empfehlung.js';
import { passtFlurstueck } from '../profi.js';

const KEY = 'waldwaechter.ampel';
const TAGE30 = 30 * 864e5;
const lade = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const merke = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* voll */ } };

async function ampelFuer(p) {
  const pt = centroid(p.ring);
  const k = store.get().bestandKorrektur?.[p.id];
  const pf = pflanzungAm(pt);
  const b = pf || k?.haupt?.art ? null : await bestandInFlaeche(p.ring, polysOf(p)).catch(() => null);
  const art = pf?.arten?.[0]?.name || k?.haupt?.art || b?.art || '';
  if (!art) return { stufe: 'grau', art: '', text: 'Keine Baumart bekannt.' };
  const info = await queryPoint(pt);
  if (info.failed) throw new Error('offline');
  const sp = info.standort || {};
  const { r } = await empfehlungMitErsatz(pt, { einheit: String(sp.Standortseinheiten || '').trim(), gruppe: String(sp.Standortsguppe || sp.Standortsgruppe || '').trim() });
  const a = standortAmpel(art, r);
  return { stufe: a.stufe, art, text: a.text };
}

export function createStandortAmpelLayer() {
  const gruppe = L.layerGroup();
  let laeuft = false;
  async function zeichne() {
    if (laeuft) return; laeuft = true;
    try {
      const alle = await source.allParcels();
      const byId = Object.fromEntries(alle.map((p) => [p.id, p]));
      const eigene = store.get().parcels.filter((p) => byId[p.id] && passtFlurstueck(p) && (byId[p.id].category === 'Wald' || p.category === 'Wald')).map((p) => byId[p.id]);
      const cache = lade();
      gruppe.clearLayers();
      for (const p of eigene) {
        const sig = `${store.get().bestandKorrektur?.[p.id]?.erfasst || 0}`;
        let e = cache[p.id];
        if (!e || Date.now() - e.ts > TAGE30 || e.sig !== sig) {
          try { e = { ...(await ampelFuer(p)), ts: Date.now(), sig }; cache[p.id] = e; merke(cache); } catch { e = e || { stufe: 'grau', art: '', text: 'Geodienst nicht erreichbar.' }; }
        }
        const f = AMPEL[e.stufe] || AMPEL.grau;
        L.polygon(polysOf(p), { color: f.farbe, weight: 3, fillColor: f.farbe, fillOpacity: 0.35, interactive: false }).addTo(gruppe);
      }
    } finally { laeuft = false; }
  }
  gruppe.on('add', zeichne);
  return gruppe;
}
