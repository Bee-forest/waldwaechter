// Der Waldwächter: eine freundliche Baumwanze als Guide.
import { h } from './ui.js';
import { store } from './store.js';

// Die Wanze aus dem WaldWächter-Logo (img/wanze.png, freigestellt)
export const WANZE_SVG = '<img src="img/wanze.svg" alt="" class="wanze-img" draggable="false">';
window.__wanzeSvg = WANZE_SVG;

let bubble, hideTimer;

/** Wanze mit Sprechblase einblenden. */
export function say(text, { duration = 5200, actions } = {}) {
  bubble?.remove();
  clearTimeout(hideTimer);
  bubble = h('div', { class: 'mascot-say', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'mascot-figure', html: WANZE_SVG }),
    h('div', { class: 'mascot-bubble' },
      h('p', {}, text),
      actions ? h('div', { class: 'mascot-actions' }, actions) : null,
      h('button', { class: 'mascot-close', 'aria-label': 'Hinweis schließen', onclick: () => hide() }, '×'),
    ),
  );
  document.getElementById('app').append(bubble);
  if (duration) hideTimer = setTimeout(hide, duration);
  return bubble;
}

export function hide() {
  if (!bubble) return;
  const b = bubble; bubble = null;
  b.classList.add('closing');
  setTimeout(() => b.remove(), 180);
}

const TOUR = [
  'Hallo, ich bin der WaldWächter! Ich zeige dir kurz, wie die App funktioniert.',
  'Tippe in der Karte auf ein Flurstück. Unter der Karte siehst du dann Größe, Rettungspunkte und Besonderheiten.',
  'Mit „Flurstück suchen“ findest du Flächen nach Gemarkung, Flur und Nummer. Unter „Weitere Layer“ blendest du Standortkarte, Rettungspunkte und Schutzgebiete ein.',
  'Unter „Aufgaben“ planst du Maßnahmen. Bei einer Durchforstung führe ich dich im Bestand von Rasterpunkt zu Rasterpunkt.',
];

export function startTour(step = 0) {
  if (step >= TOUR.length) {
    hide();
    store.update((s) => { s.onboardingDone = true; });
    return;
  }
  const last = step === TOUR.length - 1;
  say(TOUR[step], {
    duration: 0,
    actions: [
      h('button', { class: 'btn btn-small btn-primary', onclick: () => startTour(step + 1) }, last ? 'Los geht’s' : 'Weiter'),
      !last ? h('button', { class: 'btn btn-small btn-ghost', onclick: () => startTour(TOUR.length) }, 'Überspringen') : null,
    ],
  });
}
