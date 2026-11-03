// Reiter 3–5: Platzhalter für spätere Ausbaustufen.
import { h, fill } from './ui.js';
import { WANZE_SVG } from './mascot.js';

const CONTENT = {
  finanzen: {
    title: 'Finanzen',
    text: 'Hier siehst du bald Holzerlöse, Kosten deiner Maßnahmen und mögliche Fördermittel auf einen Blick.',
    soon: ['Einnahmen und Ausgaben je Fläche', 'Abrechnungen der FBG', 'Förderprogramme für deinen Wald'],
  },
  aktuelles: {
    title: 'Aktuelles',
    text: 'Hier erfährst du bald, was in deiner Region im Wald los ist.',
    soon: ['Borkenkäfer-Warnstufe und Waldbrandgefahr', 'Termine deiner FBG', 'Holzmarkt und Preise'],
  },
  ki: {
    title: 'KI-Assistent',
    text: 'Bald kannst du mir hier Fragen zu deinem Wald stellen, zum Beispiel welche Baumart auf deinen Standort passt.',
    soon: ['Fragen zu Waldbau und Pflege', 'Baumarten und Schädlinge per Foto erkennen', 'Hilfe bei Förderanträgen'],
  },
};

export function renderPlaceholder(root, key) {
  const c = CONTENT[key];
  fill(root, 
    h('header', { class: 'view-head' }, h('h1', {}, c.title)),
    h('div', { class: 'placeholder' },
      h('div', { class: 'placeholder-bug', html: WANZE_SVG }),
      h('p', { class: 'placeholder-text' }, c.text),
      h('h2', {}, 'Geplant'),
      h('ul', { class: 'soon-list' }, c.soon.map((s) => h('li', {}, s))),
    ),
  );
}
