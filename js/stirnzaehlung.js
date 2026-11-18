// Stirnflächen eines Polters auf einem Foto zählen: jede Stirnfläche antippen, ein zweites Antippen entfernt
// die Markierung. Ergebnis: Stückzahl und das Foto mit den nummerierten Markierungen.
import { h, fill, openPage, toast } from './ui.js';

export function openStirnZaehlung({ titel = 'Stämme zählen', onFertig } = {}) {
  let bild = null, marken = [], r = 14;
  const cv = h('canvas', { class: 'stirn-leinwand', 'aria-label': 'Polterfoto – Stirnflächen antippen' });
  const zahl = h('strong', { class: 'stirn-zahl' }, '0');
  const body = h('div', { class: 'stirn' });
  const page = openPage(titel, body);
  const datei = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => laden(e.target.files?.[0]) });
  const galerie = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => laden(e.target.files?.[0]) });
  function start() {
    fill(body,
      h('p', { class: 'muted' }, 'Fotografiere die Stirnseite des Polters möglichst gerade von vorn. Dann tippst du jede Stirnfläche einmal an – die App zählt mit.'),
      h('div', { class: 'btn-row' }, h('label', { class: 'btn btn-primary' }, 'Foto aufnehmen', datei), h('label', { class: 'btn' }, 'Aus Galerie', galerie)));
  }
  async function laden(f) {
    if (!f) return;
    try { bild = await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch { bild = await createImageBitmap(f); }
    const max = 2000, k = Math.min(1, max / Math.max(bild.width, bild.height));
    cv.width = Math.round(bild.width * k); cv.height = Math.round(bild.height * k);
    r = Math.max(10, Math.round(Math.min(cv.width, cv.height) / 70));
    marken = [];
    fill(body,
      h('div', { class: 'stirn-kopf' }, h('span', {}, 'Gezählt: '), zahl),
      h('div', { class: 'stirn-rahmen' }, cv),
      h('div', { class: 'form-row' },
        h('label', {}, 'Markengröße', h('input', { type: 'range', min: 6, max: 60, value: r, oninput: (e) => { r = Number(e.target.value); malen(); } }))),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { marken.pop(); malen(); } }, 'Letzte entfernen'),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { marken = []; malen(); } }, 'Alle entfernen')),
      h('p', { class: 'hint' }, 'Tipp: Reihe für Reihe von links nach rechts zählen. Zum genauen Antippen das Bild mit zwei Fingern vergrößern.'),
      h('div', { class: 'q-nav' }, h('button', { type: 'button', class: 'btn', onclick: start }, 'Anderes Foto'),
        h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: fertig }, 'Zählung übernehmen')));
    malen();
  }
  function malen() {
    const ctx = cv.getContext('2d');
    ctx.drawImage(bild, 0, 0, cv.width, cv.height);
    ctx.lineWidth = Math.max(2, r / 5);
    ctx.font = `bold ${Math.round(r * 0.9)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    marken.forEach(([x, y], i) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(242,107,29,.55)'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), x, y + 1);
    });
    zahl.textContent = String(marken.length);
  }
  cv.addEventListener('click', (e) => {
    if (!bild) return;
    const b = cv.getBoundingClientRect();
    const x = ((e.clientX - b.left) / b.width) * cv.width, y = ((e.clientY - b.top) / b.height) * cv.height;
    const i = marken.findIndex(([mx, my]) => Math.hypot(mx - x, my - y) < r);
    if (i >= 0) marken.splice(i, 1); else marken.push([x, y]);
    malen();
  });
  async function fertig() {
    if (!marken.length) { toast('Noch keine Stirnfläche markiert.'); return; }
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.85));
    page.close();
    onFertig?.(marken.length, blob);
  }
  start();
  return page;
}
