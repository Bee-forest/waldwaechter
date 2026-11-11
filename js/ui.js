// Kleine UI-Bausteine: DOM-Helfer, Icons, Dialoge, Hinweise.

/** Ersetzt Kinder; null/false werden ignoriert (statt als Text „null“ zu erscheinen). */
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // nur für eigene, statische Inhalte (Icons)
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const svg = (p, extra = '') => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${p}</svg>`;

export const icon = {
  tree: svg('<path d="M12 3 6.5 11h3L6 16h12l-3.5-5h3L12 3Z" fill="currentColor" stroke="none"/><path d="M12 16v5"/>'),
  checkmark: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'stroke-width="2.6"'),
  alert: svg('<path d="M12 4v10"/><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/>', 'stroke-width="3"'),
  calc: svg('<rect x="5" y="3" width="14" height="18" rx="2.5"/><rect x="8" y="6" width="8" height="4" rx="1"/><path d="M8.5 14h.01M12 14h.01M15.5 14h.01M8.5 17.5h.01M12 17.5h.01M15.5 17.5h.01"/>', 'stroke-width="2.4"'),
  sparkle: svg('<path d="M12 3c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8Z" fill="currentColor" stroke="none"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>', 'stroke-width="3"'),
  map: svg('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>'),
  tasks: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5 2.5-2.5"/>'),
  euro: svg('<path d="M18 6.5A7 7 0 1 0 18 17.5"/><path d="M4 10h9M4 14h9"/>'),
  news: svg('<path d="M4 5h13v14H6a2 2 0 0 1-2-2V5Z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5M8 17h3"/>'),
  ai: svg('<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><rect x="7" y="7" width="10" height="10" rx="3"/><path d="M10.5 11h.01M13.5 11h.01M10.5 14h3"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  zoom: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6M11 8v6"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  layers: svg('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>'),
  locate: svg('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  nav: svg('<path d="m3 11 18-8-8 18-2-8-8-2Z"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  draw: svg('<path d="M4 19 9 5l6 9 5-6"/><circle cx="4" cy="19" r="1.5"/><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="14" r="1.5"/><circle cx="20" cy="8" r="1.5"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
};

/** Modaler Dialog. Gibt ein Promise mit dem Wert des gewählten Buttons zurück. */
export function dialog({ title, body, actions = [{ label: 'OK', value: true, primary: true }], mascot = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (v) => {
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 160);
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    if (typeof body === 'function') body = body(close);
    const box = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t' },
      mascot ? h('div', { class: 'dialog-mascot', html: window.__wanzeSvg || '' }) : null,
      h('h2', { id: 'dlg-t', class: 'dialog-title' }, title),
      body ? (body instanceof Node ? body : h('p', { class: 'dialog-body' }, body)) : null,
      h('div', { class: 'dialog-actions' },
        actions.map((a) => h('button', { class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`, onclick: () => close(a.value) }, a.label)),
      ),
    );
    const wrap = h('div', { class: 'scrim', onclick: (e) => { if (e.target === wrap) close(null); } }, box);
    document.body.append(wrap);
    document.addEventListener('keydown', onKey);
    (box.querySelector('input, select') || box.querySelector('.btn-primary, .btn'))?.focus();
  });
}

export const confirmDialog = (title, { ok = 'Ja', cancel = 'Abbrechen', danger = false, body } = {}) =>
  dialog({ title, body, actions: [{ label: cancel, value: false }, { label: ok, value: true, primary: !danger, danger }] });

let toastTimer;
export function toast(text) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/** Vollbild-Seite (z. B. Profil, Assistent), die von rechts hereinkommt. */
// Offene Seiten als Stapel – die Zurück-Taste bzw. Wischgeste des Handys schließt die oberste Seite
// (oder geht in einer Planung mit Schritten einen Schritt zurück), statt die App zu verlassen.
const SEITEN = [];
let seitenNr = 0;
window.addEventListener('popstate', () => {
  const top = SEITEN[SEITEN.length - 1];
  if (!top) return;
  // offenes Fenster (Dialog): nur dieses schließen
  const scrim = [...document.querySelectorAll('.scrim:not(.closing)')].pop();
  if (scrim) { scrim.click(); history.pushState({ ww: top.id }, ''); return; }
  if (top.onBack?.()) { history.pushState({ ww: top.id }, ''); return; }
  top.close(true);
});
export function openPage(title, content, { onClose, onBack } = {}) {
  const id = ++seitenNr;
  const zurueck = () => { if (!onBack?.()) close(); };
  const page = h('section', { class: 'page', role: 'dialog', 'aria-label': title },
    h('header', { class: 'page-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Zurück', html: icon.back, onclick: zurueck }),
      h('h1', {}, title),
    ),
    h('div', { class: 'page-body' }, content),
  );
  let zu = false;
  function close() {
    if (zu) return; zu = true;
    const i = SEITEN.findIndex((x) => x.id === id);
    if (i >= 0) SEITEN.splice(i, 1);
    page.classList.add('closing');
    setTimeout(() => page.remove(), 200);
    onClose?.();
  }
  const eintrag = { id, close, onBack };
  SEITEN.push(eintrag);
  try { history.pushState({ ww: id }, ''); } catch { /* z. B. in eingebetteten Ansichten */ }
  document.getElementById('app').append(page);
  page.querySelector('.icon-btn').focus();
  return { el: page, close };
}

export const fmtDate = (ts) => new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
