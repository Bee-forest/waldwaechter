// Erinnerungen an anstehende Maßnahmen.
// Ohne eigenen Server gibt es keine echten Push-Nachrichten. Stattdessen:
//  1. beim Öffnen der App und beim Zurückkehren in die App: Benachrichtigung für fällige Termine,
//  2. im Hintergrund über „Periodic Background Sync“ (Chrome/Edge auf Android, App installiert; der Browser bestimmt den Takt),
//  3. Kalenderdatei (.ics) mit Weckalarm – funktioniert überall, auch auf dem iPhone.
// Die anstehenden Termine liegen zusätzlich in IndexedDB, damit der Service Worker sie ohne die App lesen kann.
import { store } from './store.js';
import { termine, MEASURE_TYPES } from './measures.js';
import { herunterladen } from './pdf.js';

const TAG = 864e5;
export const VORLAUF = [[0, 'am Tag selbst'], [1, '1 Tag vorher'], [3, '3 Tage vorher'], [7, '1 Woche vorher']];
export const einstellung = () => ({ an: false, vorlauf: 1, ...(store.get().settings?.erinnerung || {}) });
export const unterstuetzt = () => 'Notification' in window && 'serviceWorker' in navigator;
export const erlaubnis = () => (unterstuetzt() ? Notification.permission : 'unsupported');
export const hintergrundMoeglich = () => 'serviceWorker' in navigator && 'periodicSync' in (window.ServiceWorkerRegistration?.prototype || {});

// ---------- IndexedDB (gleiche Struktur im Service Worker) ----------
function db() {
  return new Promise((res, rej) => { const r = indexedDB.open('waldwaechter-sw', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function kv(key, wert) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('kv', wert === undefined ? 'readonly' : 'readwrite');
    const req = wert === undefined ? tx.objectStore('kv').get(key) : tx.objectStore('kv').put(wert, key);
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}

/** Offene Termine von gestern bis in `tage` Tagen: { id, ts, titel, text } */
export function anstehend(tage = 60) {
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const von = new Date(heute.getTime() - 7 * TAG), bis = new Date(heute.getTime() + (tage + 1) * TAG);
  const st = store.get();
  const fl = Object.fromEntries(st.parcels.map((p) => [p.id, p]));
  const out = [];
  for (const m of st.measures) {
    if (m.status === 'fertig') continue;
    for (const t of termine(m, von, bis)) {
      if (t.done) continue;
      const p = fl[m.parcelId];
      const d = new Date(t.date); d.setHours(0, 0, 0, 0);
      out.push({ id: `${m.id}|${t.key}|${d.getTime()}`, measureId: m.id, ts: d.getTime(), titel: `${MEASURE_TYPES[m.type]?.label || 'Maßnahme'}${t.key === 'einmal' ? '' : `: ${t.label}`}`,
        ort: p ? `Flurstück ${p.nr}, ${p.gemarkung}` : '', note: m.note || '' });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}
const wann = (ts) => {
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const tage = Math.round((ts - heute.getTime()) / TAG);
  return tage === 0 ? 'heute' : tage === 1 ? 'morgen' : tage < 0 ? `seit ${new Date(ts).toLocaleDateString('de-DE')} fällig` : `am ${new Date(ts).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })}`;
};

/** Termine in IndexedDB spiegeln, damit der Service Worker im Hintergrund erinnern kann */
export async function spiegeln() {
  if (!('indexedDB' in window)) return;
  const e = einstellung();
  try { await kv('erinnerungen', { an: e.an, vorlauf: e.vorlauf, liste: anstehend(60).map((x) => ({ ...x, text: [`fällig am ${new Date(x.ts).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })}`, x.ort].filter(Boolean).join(' · ') })) }); } catch { /* privat/gesperrt */ }
}

/** Fällige Termine jetzt melden (beim Öffnen der App) */
export async function pruefen() {
  const e = einstellung();
  if (!e.an || erlaubnis() !== 'granted') return 0;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 0;
  let gesehen = [];
  try { gesehen = (await kv('gesehen')) || []; } catch { /* egal */ }
  const jetzt = Date.now();
  const faellig = anstehend(e.vorlauf).filter((x) => x.ts - e.vorlauf * TAG <= jetzt && !gesehen.includes(x.id));
  for (const x of faellig) {
    await reg.showNotification(x.titel, { body: [wann(x.ts), x.ort, x.note].filter(Boolean).join(' · '), tag: x.id, icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: './#/massnahmen' } });
    gesehen.push(x.id);
  }
  try { await kv('gesehen', gesehen.slice(-500)); } catch { /* egal */ }
  return faellig.length;
}

/** Benachrichtigungen einschalten (fragt den Browser um Erlaubnis) */
export async function einschalten() {
  if (!unterstuetzt()) return 'unsupported';
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (p !== 'granted') return p;
  store.update((st) => { st.settings.erinnerung = { ...einstellung(), an: true }; });
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.periodicSync) {
      const status = await navigator.permissions?.query({ name: 'periodic-background-sync' }).catch(() => null);
      if (!status || status.state === 'granted') await reg.periodicSync.register('ww-erinnerung', { minInterval: 6 * 60 * 60 * 1000 });
    }
  } catch { /* nur möglich, wenn die App installiert ist */ }
  await spiegeln();
  await pruefen();
  return 'granted';
}
export async function ausschalten() {
  store.update((st) => { st.settings.erinnerung = { ...einstellung(), an: false }; });
  try { const reg = await navigator.serviceWorker.ready; await reg.periodicSync?.unregister('ww-erinnerung'); } catch { /* egal */ }
  await spiegeln();
}
export async function testNachricht() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg || erlaubnis() !== 'granted') return false;
  const n = anstehend(30)[0];
  await reg.showNotification('WaldWächter – Test', { body: n ? `Nächster Termin: ${n.titel}, ${wann(n.ts)}` : 'So sieht eine Erinnerung aus.', tag: 'test', icon: './icons/icon-192.png', data: { url: './#/massnahmen' } });
  return true;
}

/** Kalenderdatei mit allen offenen Terminen der nächsten 12 Monate und Weckalarm */
export function kalenderDatei() {
  const e = einstellung();
  const z = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const liste = anstehend(365);
  const zeilen = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WaldWaechter//Massnahmen//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:WaldWächter'];
  for (const x of liste) {
    const d = new Date(x.ts), ende = new Date(x.ts + TAG);
    const alarm = new Date(x.ts - e.vorlauf * TAG); alarm.setHours(8, 0, 0, 0);
    zeilen.push('BEGIN:VEVENT', `UID:${x.id.replace(/\|/g, '-')}@waldwaechter`, `DTSTAMP:${utc(new Date())}`, `DTSTART;VALUE=DATE:${z(d)}`, `DTEND;VALUE=DATE:${z(ende)}`,
      `SUMMARY:${esc(x.titel)}`, x.ort || x.note ? `DESCRIPTION:${esc([x.ort, x.note].filter(Boolean).join('\n'))}` : null, x.ort ? `LOCATION:${esc(x.ort)}` : null,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(x.titel)}`, `TRIGGER;VALUE=DATE-TIME:${utc(alarm)}`, 'END:VALARM', 'END:VEVENT');
  }
  zeilen.push('END:VCALENDAR');
  herunterladen(new Blob([zeilen.filter(Boolean).join('\r\n')], { type: 'text/calendar;charset=utf-8' }), 'WaldWaechter-Termine.ics');
  return liste.length;
}

export function initErinnerungen() {
  let t = null;
  store.subscribe(() => { clearTimeout(t); t = setTimeout(spiegeln, 800); });
  spiegeln();
  setTimeout(() => pruefen().catch(() => {}), 2500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pruefen().catch(() => {}); });
}
