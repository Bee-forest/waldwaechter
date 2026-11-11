// Einstiegspunkt: Navigation, Darstellung, PWA-Installation, Service Worker.
import { h, icon, toast } from './ui.js';
import { store } from './store.js';
import { initHome, invalidateMap } from './home.js';
import { initMeasures } from './measures.js';
import { initErinnerungen } from './erinnerung.js';
import { renderPlaceholder } from './placeholders.js';

// Unerwartete Fehler sichtbar machen (statt dass einfach nichts passiert) – je Meldung höchstens alle 20 s
const gemeldet = new Map();
const fehlerZeigen = (e) => {
  const msg = String(e?.message || e || '');
  if (!msg || /abort|Load failed|NetworkError|Failed to fetch|ResizeObserver/i.test(msg)) return;
  if (Date.now() - (gemeldet.get(msg) || 0) < 20000) return;
  gemeldet.set(msg, Date.now());
  toast(`Da ist etwas schiefgegangen: ${msg.slice(0, 140)}`);
};
window.addEventListener('error', (e) => fehlerZeigen(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => fehlerZeigen(e.reason));
import { startTour, say } from './mascot.js';

const TABS = [
  { key: 'home', label: 'Startseite', icon: icon.map },
  { key: 'massnahmen', label: 'Maßnahmen', icon: icon.tasks },
  { key: 'finanzen', label: 'Finanzen', icon: icon.euro },
  { key: 'aktuelles', label: 'Aktuelles', icon: icon.news },
  { key: 'ki', label: 'KI-Assistent', icon: icon.ai },
];

// ---------- Darstellung ----------
export function applyTheme() {
  const pref = store.get().settings.theme;
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0F1A14' : '#EEF2EC');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- Installation ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
window.addEventListener('appinstalled', () => { deferredPrompt = null; say('Installiert! Du findest mich jetzt auf deinem Startbildschirm.'); });
export const canInstall = () => !!deferredPrompt;
export async function installApp() { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- Navigation ----------
const views = {};
function show(key) {
  if (!views[key]) key = 'home';
  for (const [k, el] of Object.entries(views)) el.hidden = k !== key;
  document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === key ? 'page' : 'false'));
  if (location.hash !== `#/${key}`) history.replaceState(null, '', `#/${key}`);
  if (key === 'home') requestAnimationFrame(invalidateMap);
}
window.addEventListener('ww:navigate', (e) => show(e.detail));
window.addEventListener('hashchange', () => show(location.hash.replace('#/', '')));

async function main() {
  applyTheme();
  const app = document.getElementById('app');
  const main = h('main', { class: 'views' });
  for (const t of TABS) {
    views[t.key] = h('div', { class: `view view-${t.key}`, id: `view-${t.key}`, hidden: true });
    main.append(views[t.key]);
  }
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Hauptnavigation' },
    TABS.map((t) => h('button', { 'data-tab': t.key, onclick: () => show(t.key) }, h('span', { class: 'tab-icon', html: t.icon }), h('span', { class: 'tab-label' }, t.label))));
  app.replaceChildren(main, tabbar);

  views.home.hidden = false;
  await initHome(views.home);
  initMeasures(views.massnahmen);
  renderPlaceholder(views.finanzen, 'finanzen');
  renderPlaceholder(views.aktuelles, 'aktuelles');
  renderPlaceholder(views.ki, 'ki');
  const legacy = { rechner: 'finanzen', schaeden: 'aktuelles', silvana: 'ki' };
  const start = location.hash.replace('#/', '');
  show(legacy[start] || start || 'home');

  if (!store.get().onboardingDone) setTimeout(() => startTour(), 600);
  registerSW();
  initErinnerungen();
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  const reload = () => { if (!reloaded) { reloaded = true; location.reload(); } };
  // Nur nach einem echten Update neu laden, nicht bei der allerersten Installation
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) reload(); });

  const offer = (worker) => {
    say('Es gibt eine neue Version der App.', { duration: 0, actions: [h('button', { class: 'btn btn-small btn-primary', onclick: () => {
      worker.postMessage('SKIP_WAITING');
      setTimeout(reload, 1500); // Rückfall, falls der Browser kein controllerchange meldet
    } }, 'Jetzt aktualisieren')] });
  };

  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    if (reg.waiting && hadController) offer(reg.waiting); // Update lag schon bereit
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) offer(sw);
      });
    });
    // Beim Zurückkehren in die App nach Updates schauen
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => { /* z. B. kein HTTPS */ });
}

main();
