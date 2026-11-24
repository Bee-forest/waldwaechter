// Eigene Flurstücke (bzw. die des gerade gewählten Ordners im Profimodus) farbig hinterlegt –
// zur Orientierung in Karten, in denen man etwas einträgt. Nicht anklickbar, liegt unter den Symbolen.
import { store } from '../store.js';
import { polysOf } from '../geo.js';
import { CATEGORIES } from './basemap.js';
import { passtFlurstueck } from '../profi.js';

export function eigeneFlaechenLayer(map) {
  const grp = L.layerGroup();
  let letzte = null;
  const zeichne = () => {
    const liste = store.get().parcels.filter(passtFlurstueck);
    const sig = liste.map((p) => `${p.id}:${p.category}`).join('|');
    if (sig === letzte) return;
    letzte = sig;
    grp.clearLayers();
    for (const p of liste) {
      const polys = polysOf(p);
      if (!polys.length) continue;
      const farbe = CATEGORIES[p.category]?.color || '#1F4D3A';
      L.polygon(polys, { color: farbe, weight: 2, opacity: 0.9, fillColor: farbe, fillOpacity: 0.22, interactive: false }).addTo(grp);
    }
  };
  zeichne();
  const ab = store.subscribe(zeichne);
  grp.on('remove', () => ab());
  grp.addTo(map);
  return grp;
}
