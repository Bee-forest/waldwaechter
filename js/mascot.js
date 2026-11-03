// Der Waldwächter: eine freundliche Baumwanze als Guide.
import { h } from './ui.js';
import { store } from './store.js';

export const WANZE_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Waldwächter-Wanze">
  <g stroke="#1E3A1A" stroke-width="3.2" stroke-linecap="round" fill="none">
    <path d="M22 50 L8 44"/><path d="M19 62 L5 64"/><path d="M24 74 L12 84"/>
    <path d="M78 50 L92 44"/><path d="M81 62 L95 64"/><path d="M76 74 L88 84"/>
    <path d="M44 16 C40 8 34 6 28 7"/><path d="M56 16 C60 8 66 6 72 7"/>
  </g>
  <circle cx="27" cy="7" r="3.4" fill="#1E3A1A"/><circle cx="73" cy="7" r="3.4" fill="#1E3A1A"/>
  <path d="M50 34 C78 34 87 45 85 58 C83 74 65 91 50 95 C35 91 17 74 15 58 C13 45 22 34 50 34 Z" fill="#4E9A3F" stroke="#1E3A1A" stroke-width="3"/>
  <path d="M19 50 C26 42 74 42 81 50" stroke="#2F6E2A" stroke-width="2.5" fill="none"/>
  <path d="M37 52 L63 52 L50 82 Z" fill="#3A7F32" stroke="#2F6E2A" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="30" cy="66" r="3" fill="#7CC261"/><circle cx="70" cy="66" r="3" fill="#7CC261"/>
  <circle cx="50" cy="28" r="16" fill="#62B04E" stroke="#1E3A1A" stroke-width="3"/>
  <path d="M50 12 C47 6 50 2 55 1 C56 6 54 10 50 12 Z" fill="#9BD36C" stroke="#1E3A1A" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="43.5" cy="26" r="5.6" fill="#fff" stroke="#1E3A1A" stroke-width="2"/>
  <circle cx="56.5" cy="26" r="5.6" fill="#fff" stroke="#1E3A1A" stroke-width="2"/>
  <circle cx="44.5" cy="27" r="2.8" fill="#1E3A1A"/><circle cx="57.5" cy="27" r="2.8" fill="#1E3A1A"/>
  <circle cx="45.4" cy="25.8" r="0.9" fill="#fff"/><circle cx="58.4" cy="25.8" r="0.9" fill="#fff"/>
  <ellipse cx="38.5" cy="33.5" rx="3.2" ry="2" fill="#F26B1D" opacity=".6"/>
  <ellipse cx="61.5" cy="33.5" rx="3.2" ry="2" fill="#F26B1D" opacity=".6"/>
  <path d="M45 34 C48 37.5 52 37.5 55 34" stroke="#1E3A1A" stroke-width="2.4" fill="none" stroke-linecap="round"/>
</svg>`;
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
  'Hallo, ich bin der Waldwächter! Ich zeige dir kurz, wie die App funktioniert.',
  'Tippe in der Karte auf ein Flurstück. Unter der Karte siehst du dann Größe, Rettungspunkte und Besonderheiten.',
  'Mit der Lupe oben suchst du Flurstücke nach Gemarkung, Flur und Nummer. Gefundene Flächen kannst du deinen Flächen hinzufügen.',
  'Unter „Maßnahmen“ planst du Arbeiten. Bei einer Durchforstung führe ich dich im Bestand von Rasterpunkt zu Rasterpunkt.',
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
