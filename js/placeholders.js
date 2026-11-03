// Reiter 3–5: Platzhalter für spätere Ausbaustufen.
import { h, fill } from './ui.js';
import { WANZE_SVG } from './mascot.js';

const CONTENT = {
  schaeden: {
    title: 'Schäden',
    text: 'Hier meldest und verfolgst du bald Schäden auf deinen Flächen, mit Foto und Standort direkt aus dem Wald.',
    soon: ['Borkenkäfer, Sturm- und Schneebruch melden', 'Waldschadflächen von ThüringenForst auf der Karte', 'Meldung an die FBG oder den Revierförster'],
  },
  rechner: {
    title: 'Rechner',
    text: 'Hier rechnest du bald Holzmengen, Kosten und Erlöse für deine Flächen aus.',
    soon: ['Holzvolumen und Sortimente schätzen', 'Kosten und Erlöse einer Maßnahme', 'Fördermittel für deinen Wald'],
  },
  silvana: {
    title: 'Silvana',
    text: 'Silvana ist bald deine KI-Assistentin für den Wald. Frag sie zum Beispiel, welche Baumart auf deinen Standort passt.',
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
