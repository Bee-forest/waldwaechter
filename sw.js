// Service Worker für Waldwächter.
// - App-Shell wird beim Installieren vorgeladen → App startet auch ohne Netz.
// - Kartenkacheln: „Cache first“, damit gespeicherte Bestände im Wald offline sichtbar sind.
// - Overpass-Daten: „Network first“ mit Cache als Rückfall.
// Bei jeder Änderung an App-Dateien VERSION erhöhen.

const VERSION = 'v2.43.0';
const SHELL = `ww-shell-${VERSION}`;
const TILES = 'ww-tiles-v2';
const DATA = 'ww-data-v1';
const MAX_TILES = 3000;

const SHELL_FILES = [
  './', './index.html', './manifest.json', './css/app.css',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png', './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png', './vendor/leaflet/images/marker-icon-2x.png', './vendor/leaflet/images/marker-shadow.png',
  './fonts/AtkinsonHyperlegible-Regular.woff', './fonts/AtkinsonHyperlegible-Bold.woff',
  './img/logo.svg', './img/wanze.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './js/app.js', './js/ui.js', './js/store.js', './js/geo.js', './js/mascot.js',
  './js/home.js', './js/profile.js', './js/measures.js', './js/placeholders.js',
  './js/map/basemap.js', './js/map/thueringen.js', './js/data/source.js', './js/data/demo-data.js',
  './js/thinning/wizard.js', './js/thinning/plan.js', './js/thinning/wald.js', './js/thinning/gps.js', './js/thinning/feedback.js', './js/thinning/methode.js', './js/thinning/ertragstafeln.js', './js/map/geoinfo.js', './js/map/bestand.js', './js/map/besonderheiten.js', './js/map/baumartenkarte.js', './js/map/lrt.js', './js/schutzgebiete.js', './js/vertraeglichkeit.js', './js/flaeche.js', './js/historie.js', './js/polter.js', './js/zaun.js', './js/pflanzung.js', './js/umlauf.js', './js/foerderung.js', './js/foerder-formular.js', './js/bzt.js', './js/formfill.js', './js/pdf.js', './js/pflanzlayout.js', './js/pflanzpreise.js', './js/erinnerung.js', './js/einzelschutz.js', './js/kartenbild.js', './js/dateien.js', './js/thinning/f4.js', './js/thinning/speicher.js', './data/durchforstung_parameter_f4.json',
];

const TILE_HOSTS = ['tile.openstreetmap.org', 'sgx.geodatenzentrum.de', 'basemaps.cartocdn.com'];
const WMS_HOSTS = ['geoproxy.geoportal-th.de'];

// WMS-Kacheln: Parameter sortieren und BBOX auf Meter runden, damit vorab
// geladene und von Leaflet angeforderte Kacheln denselben Cache-Schlüssel haben.
function tileKey(u) {
  if (!WMS_HOSTS.some((h) => u.hostname.endsWith(h))) return u.href;
  const p = [...u.searchParams.entries()].map(([k, v]) => {
    k = k.toLowerCase();
    if (k === 'bbox') v = v.split(',').map((n) => Math.round(Number(n))).join(',');
    return [k, v];
  }).sort(([a], [b]) => a.localeCompare(b));
  return `${u.origin}${u.pathname}?${p.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

self.addEventListener('install', (e) => {
  // cache: 'reload' umgeht den HTTP-Cache, sonst landen nach einem Update alte Dateien im neuen Cache
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = [SHELL, TILES, DATA];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  const isGetMap = WMS_HOSTS.some((h) => url.hostname.endsWith(h)) && /getmap/i.test(url.searchParams.get('REQUEST') || url.searchParams.get('request') || '');
  if (TILE_HOSTS.some((h) => url.hostname.endsWith(h)) || isGetMap) {
    e.respondWith(tileFirst(e.request, tileKey(url)));
    return;
  }
  if (WMS_HOSTS.some((h) => url.hostname.endsWith(h))) return; // WFS-Abfragen direkt ans Netz
  if (url.hostname.includes('overpass')) {
    e.respondWith(networkFirst(e.request, DATA));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/geoproxy/')) return; // Umleitung zum Geoproxy nie cachen

  // Seitenaufrufe: Netz zuerst, offline die App-Shell
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  // Flurstücksdaten (data/…): Netz zuerst, offline aus dem Cache
  if (url.pathname.includes('/data/')) { e.respondWith(networkFirst(e.request, DATA)); return; }

  // App-Dateien: online immer die aktuelle Version, offline aus dem Cache
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res.ok) (await caches.open(SHELL)).put(e.request, res.clone());
      return res;
    } catch {
      return (await caches.match(e.request)) || new Response('offline', { status: 503 });
    }
  })());
});

async function tileFirst(req, key) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      await cache.put(key, res.clone());
      trim(cache);
    }
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function networkFirst(req, name) {
  const cache = await caches.open(name);
  // Overpass-Anfragen sind POST → Schlüssel aus dem Anfrageinhalt bilden
  const key = req.method === 'POST' ? new Request(req.url + '?q=' + encodeURIComponent(await req.clone().text())) : req;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch {
    return (await cache.match(key)) || new Response('{"elements":[]}', { headers: { 'Content-Type': 'application/json' } });
  }
}

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
  } finally { trimming = false; }
}

// ---------- Erinnerungen an anstehende Maßnahmen ----------
// Die App legt die offenen Termine in IndexedDB ab („erinnerungen“); bereits gemeldete stehen unter „gesehen“.
function kvDb() {
  return new Promise((res, rej) => { const r = indexedDB.open('waldwaechter-sw', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function kv(key, wert) {
  const d = await kvDb();
  return new Promise((res, rej) => {
    const tx = d.transaction('kv', wert === undefined ? 'readonly' : 'readwrite');
    const req = wert === undefined ? tx.objectStore('kv').get(key) : tx.objectStore('kv').put(wert, key);
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}
async function erinnern() {
  const d = await kv('erinnerungen');
  if (!d?.an || !d.liste?.length) return;
  const gesehen = (await kv('gesehen')) || [];
  const jetzt = Date.now();
  for (const x of d.liste) {
    if (gesehen.includes(x.id) || x.ts - d.vorlauf * 864e5 > jetzt || x.ts < jetzt - 7 * 864e5) continue;
    await self.registration.showNotification(x.titel, { body: [x.text, x.note].filter(Boolean).join(' · '), tag: x.id, icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: './#/massnahmen' } });
    gesehen.push(x.id);
  }
  await kv('gesehen', gesehen.slice(-500));
}
self.addEventListener('periodicsync', (e) => { if (e.tag === 'ww-erinnerung') e.waitUntil(erinnern()); });
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of fenster) { if ('focus' in c) { await c.focus(); if ('navigate' in c) c.navigate(url).catch(() => {}); return; } }
    await self.clients.openWindow(url);
  })());
});
