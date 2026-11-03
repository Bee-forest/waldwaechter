// Profil: Flächenübersicht, persönliche Flurstücksliste, Konto, FBG, Einstellungen.
import { h, fill, icon, openPage, confirmDialog, toast } from './ui.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { CATEGORIES } from './map/basemap.js';
import { areaHa, formatHa } from './geo.js';
import { focusParcel, removeParcel, parcelTitle } from './home.js';
import { startTour } from './mascot.js';
import { applyTheme, installApp, canInstall, isIOS, isStandalone } from './app.js';
import { buzz } from './thinning/feedback.js';

export async function openProfile() {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const body = h('div', { class: 'profile' });
  const page = openPage('Mein Profil', body);

  function render() {
    const s = store.get();
    const list = s.parcels.filter((p) => byId[p.id]);
    const sums = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, { n: 0, ha: 0 }]));
    for (const p of list) { const a = areaHa(byId[p.id].ring); sums[p.category].n++; sums[p.category].ha += a; }
    const total = Object.values(sums).reduce((t, x) => t + x.ha, 0);

    const field = (label, key, attrs = {}) => h('label', {}, label,
      h('input', { value: s.profile[key] || '', ...attrs, onchange: (e) => store.update((st) => { st.profile[key] = e.target.value.trim(); }) }));

    fill(body, 
      h('section', { class: 'card summary' },
        h('div', { class: 'summary-total' }, h('span', { class: 'summary-ha' }, formatHa(total)), h('span', {}, `${list.length} ${list.length === 1 ? 'Fläche' : 'Flächen'} insgesamt`)),
        total > 0 ? h('div', { class: 'summary-bar', 'aria-hidden': 'true' },
          Object.entries(sums).filter(([, v]) => v.ha > 0).map(([k, v]) => h('span', { style: `flex:${v.ha};background:${CATEGORIES[k].color}` }))) : null,
        h('ul', { class: 'summary-list' }, Object.entries(sums).map(([k, v]) => h('li', {},
          h('span', { class: 'swatch', style: `background:${CATEGORIES[k].color}` }),
          h('span', { class: 'summary-cat' }, CATEGORIES[k].label),
          h('span', { class: 'summary-n' }, `${v.n}×`),
          h('span', { class: 'summary-v' }, formatHa(v.ha)),
        ))),
      ),

      h('section', { class: 'card' },
        h('h2', {}, 'Meine Flurstücke'),
        list.length
          ? h('ul', { class: 'parcel-list' }, list.map((p) => {
              const full = byId[p.id];
              return h('li', { class: 'parcel-item' },
                h('span', { class: 'swatch tall', style: `background:${CATEGORIES[p.category].color}` }),
                h('div', { class: 'parcel-text' }, h('strong', {}, `Flurstück ${p.nr}`), h('span', {}, `${p.gemarkung}, Flur ${p.flur}`), h('span', { class: 'muted' }, `${CATEGORIES[p.category].label}, ${formatHa(areaHa(full.ring))}`)),
                h('button', { class: 'icon-btn', 'aria-label': `Auf ${parcelTitle(full)} zoomen`, html: icon.zoom, onclick: () => { page.close(); focusParcel(p.id); } }),
                h('button', { class: 'icon-btn danger', 'aria-label': `${parcelTitle(full)} löschen`, html: icon.trash, onclick: async () => { if (await removeParcel(p.id)) render(); } }),
              );
            }))
          : h('div', { class: 'empty' }, h('p', {}, 'Noch keine Flächen. Tippe in der Karte auf ein Flurstück oder suche es über die Lupe.'),
              h('button', { class: 'btn btn-primary', onclick: () => page.close() }, 'Zur Karte')),
      ),

      h('section', { class: 'card' },
        h('h2', {}, 'Persönliche Daten'),
        h('div', { class: 'form' },
          field('Name', 'name', { autocomplete: 'name' }),
          field('E-Mail', 'email', { type: 'email', autocomplete: 'email' }),
          field('Forstbetriebsgemeinschaft (FBG)', 'fbg', { placeholder: 'z. B. FBG Ilm-Saale' }),
        ),
      ),

      h('section', { class: 'card' },
        h('h2', {}, 'Kontodaten'),
        h('p', { class: 'hint' }, 'Für spätere Auszahlungen über die FBG. Die Daten bleiben nur auf diesem Gerät gespeichert.'),
        h('div', { class: 'form' },
          field('Kontoinhaber', 'accountHolder', { autocomplete: 'off' }),
          field('IBAN', 'iban', { autocomplete: 'off', inputmode: 'text', spellcheck: 'false', placeholder: 'DE00 0000 0000 0000 0000 00' }),
        ),
      ),

      h('section', { class: 'card' },
        h('h2', {}, 'Einstellungen'),
        h('div', { class: 'form' },
          h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Darstellung' },
            [['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, l]) => h('button', {
              role: 'radio', 'aria-checked': String(s.settings.theme === k),
              onclick: () => { store.update((st) => { st.settings.theme = k; }); applyTheme(); render(); },
            }, l))),
          h('label', {}, 'Ankunftsradius an Rasterpunkten (Meter)',
            h('input', { type: 'number', min: 3, max: 30, step: 1, value: s.settings.arrivalRadius, inputmode: 'numeric',
              onchange: (e) => store.update((st) => { st.settings.arrivalRadius = Math.min(30, Math.max(3, Number(e.target.value) || 8)); }) })),
          h('label', { class: 'switch-row' }, h('span', { class: 'switch-label' }, 'GPS simulieren (zum Testen am Schreibtisch)'),
            h('input', { type: 'checkbox', role: 'switch', checked: s.settings.simulateGps, onchange: (e) => store.update((st) => { st.settings.simulateGps = e.target.checked; }) })),
          h('button', { class: 'btn', onclick: () => { const ok = buzz('arrive'); toast(ok ? 'Vibration ausgelöst' : 'Keine Vibration verfügbar, stattdessen Signalton'); } }, 'Vibration testen'),
          h('button', { class: 'btn', onclick: () => { page.close(); startTour(); } }, 'Einführung noch einmal zeigen'),
          canInstall() ? h('button', { class: 'btn btn-primary', onclick: installApp }, h('span', { html: icon.download }), 'App installieren') : null,
          !isStandalone() && isIOS() ? h('p', { class: 'hint' }, 'Auf dem iPhone: In Safari auf „Teilen“ tippen und „Zum Home-Bildschirm“ wählen.') : null,
          h('button', { class: 'btn btn-danger-ghost', onclick: async () => {
            if (await confirmDialog('Alle Daten auf diesem Gerät löschen?', { ok: 'Alles löschen', danger: true, body: 'Flächen, Maßnahmen und Einstellungen werden entfernt.' })) { store.reset(); applyTheme(); render(); toast('Alle Daten gelöscht'); }
          } }, 'Alle Daten löschen'),
        ),
      ),
      h('p', { class: 'hint center' }, 'Karten und Flurstücke: Geoportal Thüringen (© GDI-Th, dl-de/by-2-0), TopPlusOpen (© BKG), OpenStreetMap.'),
    );
  }
  render();
}
