// Ortsnamen über dem Luftbild auch in großen Zoomstufen (OpenStreetMap, live über Overpass).
// Die CARTO-Beschriftung blendet Orte beim Hineinzoomen aus – im Wald ist dann oft kein Name mehr zu sehen.
// Abgefragt wird in Zellen von 0,1°, die einmal je Sitzung geladen werden.
const SERVER = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ZELLE = 0.1;
const zellen = new Map(); // key → Promise<orte[]>
const ART = { city: 0, town: 1, village: 2, suburb: 3, hamlet: 4, isolated_dwelling: 5, locality: 5 };
// darunter zeigt die CARTO-Beschriftung die Orte selbst
const MIN_ZOOM = { city: 15.5, town: 15.5, village: 15.5, suburb: 15.5, hamlet: 15.5, isolated_dwelling: 16, locality: 16 };

async function ladeZelle(i, j) {
  const k = `${i}/${j}`;
  if (!zellen.has(k)) {
    const s = i * ZELLE, w = j * ZELLE, n = s + ZELLE, e = w + ZELLE;
    const q = `[out:json][timeout:20];node["place"~"^(city|town|village|suburb|hamlet|isolated_dwelling|locality)$"]["name"](${s},${w},${n},${e});out;`;
    const p = (async () => {
      for (const url of SERVER) {
        try {
          const r = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(q)}` });
          if (!r.ok) continue;
          const j2 = await r.json();
          return (j2.elements || []).map((x) => ({ id: x.id, at: [x.lat, x.lon], name: x.tags.name, art: x.tags.place }));
        } catch { /* nächster Server */ }
      }
      zellen.delete(k); // später erneut versuchen
      return [];
    })();
    zellen.set(k, p);
  }
  return zellen.get(k);
}

export function createOrtsnamenLayer(map) {
  const group = L.layerGroup();
  let timer = 0, lauf = 0;
  async function zeichne() {
    if (!map.hasLayer(group)) return;
    const z = map.getZoom();
    if (z < 15.5) { group.clearLayers(); return; }
    const t = ++lauf;
    const b = map.getBounds().pad(0.2);
    const i0 = Math.floor(b.getSouth() / ZELLE), i1 = Math.floor(b.getNorth() / ZELLE);
    const j0 = Math.floor(b.getWest() / ZELLE), j1 = Math.floor(b.getEast() / ZELLE);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 9) { group.clearLayers(); return; }
    const listen = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) listen.push(ladeZelle(i, j));
    const orte = [...new Map((await Promise.all(listen)).flat().map((o) => [o.id, o])).values()];
    if (t !== lauf) return;
    group.clearLayers();
    for (const o of orte) {
      if (z < (MIN_ZOOM[o.art] ?? 15) || !b.contains(o.at)) continue;
      group.addLayer(L.marker(o.at, { interactive: false, keyboard: false, pane: 'beschriftung',
        icon: L.divIcon({ className: `ortsname ortsname-${ART[o.art] ?? 5}`, html: `<span>${o.name.replace(/[<>&]/g, '')}</span>`, iconSize: null }) }));
    }
  }
  map.on('moveend', () => { clearTimeout(timer); timer = setTimeout(zeichne, 300); });
  group.on('add', zeichne);
  return group;
}
