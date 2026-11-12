// Zählerstand der Durchforstung lokal speichern (IndexedDB) – nach jedem Tippen, offline und über mehrere Tage.
function db() {
  return new Promise((res, rej) => { const r = indexedDB.open('waldwaechter-durchforstung', 1); r.onupgradeneeded = () => r.result.createObjectStore('zaehler'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx(modus, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction('zaehler', modus); const req = fn(t.objectStore('zaehler')); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
export const standSpeichern = (measureId, stand) => tx('readwrite', (s) => s.put(JSON.parse(JSON.stringify(stand)), measureId));
export const standLaden = (measureId) => tx('readonly', (s) => s.get(measureId));
