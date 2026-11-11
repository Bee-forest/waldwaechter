// Dateien zu Maßnahmen (z. B. Pflanzplan-PDF) im Gerät speichern – IndexedDB, weil localStorage für PDFs zu klein ist.
function db() {
  return new Promise((res, rej) => { const r = indexedDB.open('waldwaechter-dateien', 1); r.onupgradeneeded = () => r.result.createObjectStore('dateien'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx(modus, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction('dateien', modus); const req = fn(t.objectStore('dateien')); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
export const dateiSpeichern = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
export const dateiLaden = (id) => tx('readonly', (s) => s.get(id));
export const dateiLoeschen = (id) => tx('readwrite', (s) => s.delete(id));
