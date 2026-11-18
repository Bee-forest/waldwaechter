// Ortsnamen über dem Luftbild (OpenStreetMap). Grundlage ist die vorbereitete Datei data/orte.json
// (alle Orte Thüringens, per GitHub Action aus OpenStreetMap); fehlt sie, wird live über Overpass nachgeladen.
// So bleiben Städte, Dörfer, Ortsteile und Weiler in jeder Zoomstufe lesbar – auch mitten im Wald.
const SERVER = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ART = { city: 0, town: 1, village: 2, suburb: 3, hamlet: 4, isolated_dwelling: 5, locality: 5 };
// ab welcher Zoomstufe eine Ortsart erscheint (0 Stadt, 1 Kleinstadt, 2 Dorf, 3 Ortsteil, 4 Weiler, 5 Einzelsiedlung/Flurname)
const AB_ZOOM = [9, 10.5, 12, 13, 13.5, 15];

let alleP = null;
function alleOrte() {
  alleP ||= fetch('data/orte.json').then((r) => (r.ok ? r.json() : null)).then((d) => (d?.orte?.length ? d.orte : null)).catch(() => null);
  return alleP;
}
// Rückfall: Zellen von 0,1° live über Overpass
const zellen = new Map();
function ladeZelle(i, j) {
  const k = `${i}/${j}`;
  if (!zellen.has(k)) {
    const s = i / 10, w = j / 10;
    const q = `[out:json][timeout:20];node["place"~"^(city|town|village|suburb|hamlet|isolated_dwelling|locality)$"]["name"](${s},${w},${s + 0.1},${w + 0.1});out;`;
    zellen.set(k, (async () => {
      for (const url of SERVER) {
        try {
          const r = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(q)}` });
          if (!r.ok) continue;
          return ((await r.json()).elements || []).map((x) => [x.lat, x.lon, x.tags.name, ART[x.tags.place] ?? 5]);
        } catch { /* nächster Server */ }
      }
      zellen.delete(k);
      return [];
    })());
  }
  return zellen.get(k);
}

export function createOrtsnamenLayer(map) {
  const group = L.layerGroup();
  let timer = 0, lauf = 0;
  async function zeichne() {
    if (!map.hasLayer(group)) return;
    const z = map.getZoom();
    const t = ++lauf;
    const b = map.getBounds().pad(0.15);
    let orte = await alleOrte();
    if (!orte) {
      if (z < 12) { group.clearLayers(); return; }
      const i0 = Math.floor(b.getSouth() * 10), i1 = Math.floor(b.getNorth() * 10), j0 = Math.floor(b.getWest() * 10), j1 = Math.floor(b.getEast() * 10);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 16) { group.clearLayers(); return; }
      const listen = [];
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) listen.push(ladeZelle(i, j));
      orte = (await Promise.all(listen)).flat();
    }
    if (t !== lauf) return;
    group.clearLayers();
    const sichtbar = orte.filter((o) => z >= AB_ZOOM[o[3]] && b.contains([o[0], o[1]])).slice(0, 250);
    for (const [lat, lng, name, art] of sichtbar) {
      group.addLayer(L.marker([lat, lng], { interactive: false, keyboard: false, pane: 'beschriftung',
        icon: L.divIcon({ className: `ortsname ortsname-${art}`, html: `<span>${String(name).replace(/[<>&]/g, '')}</span>`, iconSize: null }) }));
    }
  }
  map.on('moveend', () => { clearTimeout(timer); timer = setTimeout(zeichne, 250); });
  group.on('add', zeichne);
  return group;
}
