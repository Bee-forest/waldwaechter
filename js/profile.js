// Profil: Flächenübersicht, persönliche Flurstücksliste, Konto, FBG, Einstellungen.
import { h, fill, icon, openPage, confirmDialog, toast, dialog } from './ui.js';
import { zieleAbfrage, zieleText } from './empfehlung.js';
import { exportKarte } from './berichte.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { CATEGORIES } from './map/basemap.js';
import { formatHa } from './geo.js';
import { amtlicheFlaecheHa, nutzungAnteile, parcelExact } from './map/thueringen.js';
import { focusParcel, removeParcel, parcelTitle } from './home.js';
import { startTour, say } from './mascot.js';
import { applyTheme, installApp, canInstall, isIOS, isStandalone } from './app.js';
import { buzz } from './thinning/feedback.js';
import * as erinnerung from './erinnerung.js';
import { amtlichUebernehmen } from './data/source.js';
import { passtFlurstueck, ordnerName, istProfi, eigentuemerImport, eigentuemerAnzahl, eigentuemerAlleLoeschen, eigentuemerExcel, flaechenAusEigentuemern, etDateien, etDateiEntfernen, etDateiAnzahl, tabellenFolgen, ordnerMitInhaltLoeschen, EINSORTIEREN_AN } from './profi.js';

export async function openProfile() {
  const all = await source.allParcels();
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const body = h('div', { class: 'profile' });
  // Ältere gespeicherte Flurstücke (ohne amtliche Fläche oder Teilflächen) einmal nachladen
  (async () => {
    let changed = false;
    for (const sp of store.get().parcels) {
      const p = byId[sp.id];
      if (!p || p.source !== 'alkis' || (p.flaecheAmtlich && p.polys)) continue;
      const fresh = await parcelExact(p).catch(() => p);
      if (fresh && fresh !== p) { byId[sp.id] = fresh; changed = true; store.update((s) => { const x = s.parcels.find((y) => y.id === sp.id); if (x) amtlichUebernehmen(x, p, fresh); }); }
    }
    if (changed) render();
  })();
  const page = openPage('Mein Profil', body);

  function render() {
    const s = store.get();
    const list = s.parcels.filter((p) => byId[p.id] && passtFlurstueck(p));
    // Flächenbilanz: amtliche Fläche je Flurstück, aufgeteilt nach tatsächlicher Nutzung (ALKIS).
    // Ohne Nutzungsangabe zählt das ganze Flurstück zur gewählten Kategorie.
    const KAT = { ...CATEGORIES, Sonstiges: { color: '#B9B2A3', label: 'Wege, Sonstiges' } };
    const sums = Object.fromEntries(Object.keys(KAT).map((k) => [k, { n: 0, ha: 0 }]));
    for (const p of list) {
      const full = byId[p.id];
      const teile = nutzungAnteile(full) || { [p.category]: amtlicheFlaecheHa(full) };
      for (const [k, ha] of Object.entries(teile)) { const key = sums[k] ? k : 'Sonstiges'; sums[key].ha += ha; sums[key].n++; }
    }
    const total = list.reduce((t, p) => t + amtlicheFlaecheHa(byId[p.id]), 0);
    const anyAmtlich = list.some((p) => byId[p.id].flaecheAmtlich);

    const field = (label, key, attrs = {}) => h('label', {}, label,
      h('input', { value: s.profile[key] || '', ...attrs, onchange: (e) => store.update((st) => { st.profile[key] = e.target.value.trim(); }) }));

    fill(body, 
      h('section', { class: 'card summary' },
        h('div', { class: 'summary-total' }, h('span', { class: 'summary-ha' }, formatHa(total)), h('span', {}, `${list.length} ${list.length === 1 ? 'Flurstück' : 'Flurstücke'} insgesamt${anyAmtlich ? ' (amtliche Fläche)' : ''}`)),
        total > 0 ? h('div', { class: 'summary-bar', 'aria-hidden': 'true' },
          Object.entries(sums).filter(([, v]) => v.ha > 0).map(([k, v]) => h('span', { style: `flex:${v.ha};background:${KAT[k].color}` }))) : null,
        h('ul', { class: 'summary-list' }, Object.entries(sums).filter(([k, v]) => k !== 'Sonstiges' || v.ha > 0).map(([k, v]) => h('li', {},
          h('span', { class: 'swatch', style: `background:${KAT[k].color}` }),
          h('span', { class: 'summary-cat' }, KAT[k].label),
          h('span', { class: 'summary-n' }, v.n ? `in ${v.n} ${v.n === 1 ? 'Flurstück' : 'Flurstücken'}` : ''),
          h('span', { class: 'summary-v' }, formatHa(v.ha)),
        ))),
        h('p', { class: 'hint' }, 'Aufteilung nach tatsächlicher Nutzung laut ALKIS. Die Summe entspricht der amtlichen Fläche deiner Flurstücke.'),
        h('button', { class: 'btn btn-block flaechen-btn', onclick: () => meineFlaechen() },
          h('span', {}, `Meine Flächen${list.length ? ` (${list.length})` : ''}`), h('span', { class: 'chev', html: icon.chevron })),
      ),

      h('section', { class: 'card' },
        h('h2', {}, 'Persönliche Daten'),
        h('div', { class: 'form' },
          field('Name', 'name', { autocomplete: 'name' }),
          field('E-Mail', 'email', { type: 'email', autocomplete: 'email' }),
          field('Forstbetriebsgemeinschaft (FBG)', 'fbg', { placeholder: 'z. B. FBG Ilm-Saale' }),
          h('div', { class: 'form-gruppe' },
            field('Ansprechpartner der FBG', 'fbgAnsprech', { autocomplete: 'off' }),
            h('div', { class: 'form-row' },
              field('Telefon der FBG', 'fbgTel', { type: 'tel', autocomplete: 'off' }),
              field('E-Mail der FBG', 'fbgMail', { type: 'email', autocomplete: 'off' }))),
        ),
      ),

      profiKarte(),

      h('section', { class: 'card' },
        h('h2', {}, 'Kontodaten'),
        h('p', { class: 'hint' }, 'Für spätere Auszahlungen über die FBG. Die Daten bleiben nur auf diesem Gerät gespeichert.'),
        h('div', { class: 'form' },
          field('Kontoinhaber', 'accountHolder', { autocomplete: 'off' }),
          field('IBAN', 'iban', { autocomplete: 'off', inputmode: 'text', spellcheck: 'false', placeholder: 'DE00 0000 0000 0000 0000 00' }),
        ),
      ),

      erinnerungKarte(),

      h('section', { class: 'card' },
        h('h2', {}, 'Meine Ziele'),
        h('p', {}, s.settings.ziele ? `Besonders wichtig: ${zieleText(s.settings.ziele)}` : 'Noch nicht festgelegt. Deine Ziele gewichten die Empfehlungen zu deinen Flächen.'),
        h('button', { class: 'btn', onclick: () => zieleAbfrage() }, s.settings.ziele ? 'Ziele ändern' : 'Ziele festlegen')),
      exportKarte(),
      h('section', { class: 'card' },
        h('h2', {}, 'Einstellungen'),
        h('div', { class: 'form' },
          h('button', { class: 'btn', onclick: datenSichern }, 'Daten sichern (Datei)'),
          h('p', { class: 'hint' }, 'Speichert alle Flächen, Maßnahmen und Einstellungen als Datei – zur Sicherung oder um ein Problem nachzustellen.'),
          h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Darstellung' },
            [['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, l]) => h('button', {
              role: 'radio', 'aria-checked': String(s.settings.theme === k),
              onclick: () => { store.update((st) => { st.settings.theme = k; }); applyTheme(); render(); },
            }, l))),
          h('label', {}, 'Ankunftsradius an Rasterpunkten (Meter)',
            h('input', { type: 'number', min: 3, max: 30, step: 1, value: s.settings.arrivalRadius, inputmode: 'numeric',
              onchange: (e) => store.update((st) => { st.settings.arrivalRadius = Math.min(30, Math.max(3, Number(e.target.value) || 4)); }) })),
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

  /** Alle App-Daten als JSON-Datei teilen oder speichern */
  async function datenSichern() {
    const roh = localStorage.getItem('waldwaechter.v1') || '{}';
    const inhalt = JSON.stringify({ app: 'WaldWächter', erstellt: new Date().toISOString(), version: (await caches.keys().catch(() => [])).join(','), daten: JSON.parse(roh) }, null, 1);
    const name = `WaldWaechter-Daten-${new Date().toISOString().slice(0, 10)}.json`;
    const datei = new File([inhalt], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [datei] })) { try { await navigator.share({ files: [datei], title: name }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
    const url = URL.createObjectURL(datei);
    const a = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 600000);
    toast('Daten gespeichert');
  }

  async function sortiereNachWaldbesitzer(dateiId = null) {
    toast('Flurstücke werden gesucht …');
    let r;
    try { r = await flaechenAusEigentuemern({ dateiId, onFortschritt: (i, n) => { if (i % 25 === 0) toast(`Flurstück ${i} von ${n} …`); } }); }
    catch (e) { await dialog({ title: 'Einsortieren abgebrochen', body: h('p', {}, `Fehler: ${e?.message || e}. Bitte diese Meldung an den Support weitergeben.`), actions: [{ label: 'OK', value: true, primary: true }] }); return; }
    render();
    await dialog({ title: 'Flurstücke einsortiert', body: h('div', { class: 'form' },
      h('p', {}, `${r.hinzu} Flurstücke neu hinzugefügt, ${r.vorhanden} waren schon da. ${r.neu} neue Ordner (insgesamt ${r.ordnerGesamt}), ${r.zugeordnet} Flurstücke einsortiert.`),
      r.gespeichert ? null : h('p', { class: 'warn-line' }, 'Der Gerätespeicher der App ist voll – die Ordner sind nur bis zum Neuladen da. Bitte Speicher freimachen (alte Fotos, Offline-Karten) und erneut einsortieren.'),
      r.ordnerGesamt ? h('p', { class: 'hint' }, 'Die Ordner wählst du oben auf der Startseite in der Ordnerleiste (📁) – dort gibt es auch die Suche.') : null,
      r.nicht.length ? h('div', {}, h('p', { class: 'warn-line' }, `${r.nicht.length} Flurstücke nicht gefunden:`),
        h('ul', { class: 'mat-kurz et-nicht' }, r.nicht.slice(0, 60).map((x) => h('li', {}, h('strong', {}, x.text), ` – ${x.grund}`))),
        r.nicht.length > 60 ? h('p', { class: 'muted' }, `… und ${r.nicht.length - 60} weitere.`) : null) : h('p', { class: 'pos' }, 'Alle Flurstücke wurden gefunden.'),
      r.eigene?.length ? h('details', {}, h('summary', {}, `${r.eigene.length} Flurstücke bleiben bei den eigenen Flächen`),
        h('p', { class: 'hint' }, 'Sie stehen in keiner Waldbesitzer-Tabelle (oder die Schreibweise passt nicht eindeutig). In der Flurstücks-Info lassen sie sich über 📁 einem Ordner zuordnen.'),
        h('ul', { class: 'mat-kurz et-nicht' }, r.eigene.slice(0, 80).map((t) => h('li', {}, t))), r.eigene.length > 80 ? h('p', { class: 'muted' }, `… und ${r.eigene.length - 80} weitere.`) : null) : null),
      actions: [{ label: 'OK', value: true, primary: true }] });
  }
  /** Tabelle(n) löschen – mit den Ordnern ihrer Waldbesitzer und deren Flurstücken */
  async function tabelleLoeschen(ids, titel, text) {
    const f = tabellenFolgen(ids);
    const mitInhalt = f.massnahmen.length || f.buchungen.length;
    const v = await dialog({ title: titel, body: h('div', { class: 'form' },
      h('p', {}, text),
      f.ordner.length ? h('p', {}, `Dazu gehören ${f.ordner.length} Ordner mit ${f.flaechen.length} Flurstücken – sie werden mitgelöscht.`) : null,
      mitInhalt ? h('p', { class: 'warn-line' }, `In diesen Ordnern sind ${[f.massnahmen.length ? `${f.massnahmen.length} Maßnahmen` : '', f.buchungen.length ? `${f.buchungen.length} Buchungen` : ''].filter(Boolean).join(' und ')} eingetragen. Sie werden ebenfalls gelöscht. Wer sie behalten will, exportiert vorher den Waldbericht oder die Finanzen.`) : null,
      h('p', { class: 'muted' }, 'Das lässt sich nicht rückgängig machen.')),
      actions: [{ label: 'Abbrechen', value: null }, f.ordner.length ? { label: 'Nur Tabelle', value: 'tabelle' } : null, { label: f.ordner.length ? 'Alles löschen' : 'Löschen', value: 'alles', danger: true }].filter(Boolean) });
    if (!v) return;
    if (v === 'alles' && f.ordner.length) ordnerMitInhaltLoeschen(f);
    if (ids) ids.forEach(etDateiEntfernen); else eigentuemerAlleLoeschen();
    render();
    toast(v === 'alles' && f.ordner.length ? `Tabelle, ${f.ordner.length} Ordner und ${f.flaechen.length} Flurstücke gelöscht` : 'Tabelle gelöscht');
  }
  const excelSpeichern = async (leer, dateiId = null, name = '') => {
    const blob = await eigentuemerExcel({ leer, dateiId });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = leer ? 'Waldbesitzer_Vorlage.xlsx' : `Waldbesitzer_${name ? `${name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}_` : ''}${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  };

  /** Profimodus: zusätzliche Funktionen für Betreuer, FBG und Dienstleister */
  function profiKarte() {
    const an = istProfi();
    const n = eigentuemerAnzahl();
    const eingabe = h('input', { type: 'file', accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv', hidden: true, onchange: async (e) => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      try {
        const vorschlag = (etDateien().find((d) => d.datei === f.name)?.name) || f.name.replace(/\.(xlsx|csv)$/i, '');
        let name = vorschlag;
        const ok = await dialog({ title: 'Tabelle hochladen', body: h('div', { class: 'form' },
          h('label', {}, 'Bezeichnung (z. B. Forstbetrieb oder FBG)', h('input', { value: vorschlag, oninput: (ev) => { name = ev.target.value; } })),
          etDateien().some((d) => d.datei === f.name) ? h('p', { class: 'hint' }, 'Eine Tabelle mit diesem Dateinamen gibt es schon – ihre Einträge werden ersetzt.') : null),
          actions: [{ label: 'Abbrechen', value: false }, { label: 'Einlesen', value: true, primary: true }] });
        if (!ok) return;
        const r = await eigentuemerImport(f, { name: name.trim() || vorschlag });
        toast(`${r.gesamt} Datensätze eingelesen${r.fehler ? `, ${r.fehler} Zeilen ohne Gemarkung/Flur/Flurstück übersprungen` : ''}`);
        render();
        const sortieren = EINSORTIEREN_AN && await confirmDialog('Flurstücke nach Waldbesitzer in Ordner sortieren?', { ok: 'Ja, sortieren',
          body: `${r.gesamt} Datensätze aus „${name.trim() || vorschlag}“. Die App sucht die Flurstücke, holt sie zu deinen Flächen und legt für jeden Waldbesitzer einen Ordner an – alle Flurstücke desselben Waldbesitzers landen im selben Ordner.` });
        if (sortieren) await sortiereNachWaldbesitzer(r.dateiId);
      } catch (err) { toast(`Import fehlgeschlagen: ${err.message || err}`); }
      render();
    } });
    return h('section', { class: 'card profi-karte' },
      h('div', { class: 'profi-kopf' },
        h('h2', {}, 'Profimodus'),
        h('label', { class: 'switch-row compact' }, h('span', { class: 'switch-label' }, an ? 'an' : 'aus'),
          h('input', { type: 'checkbox', role: 'switch', checked: an, 'aria-label': 'Profimodus', onchange: (e) => { store.update((st) => { st.settings.profi = e.target.checked; }); render(); toast(e.target.checked ? 'Profimodus an' : 'Profimodus aus'); } }))),
      h('p', { class: 'hint' }, 'Für Betreuer, FBG und Dienstleister: Ordner je Eigentümer mit getrennten Maßnahmen und Finanzen, Eigentümer je Flurstück (Excel-Import) und Wanderwege in der Flurstücks-Info.'),
      an ? h('div', { class: 'form' },
        h('p', { class: 'sheet-label' }, 'Eigentümer'),
        h('p', {}, n ? `${n} Flurstücke mit Eigentümer hinterlegt.` : 'Noch keine Eigentümer hinterlegt.'),
        etDateien().length ? h('ul', { class: 'et-dateien' }, etDateien().map((d) => h('li', {},
          h('div', {}, h('strong', {}, d.name), h('small', { class: 'muted' }, `${d.datei} · hochgeladen ${new Date(d.datum).toLocaleDateString('de-DE')}`),
            h('small', {}, `${etDateiAnzahl(d.id)} Datensätze${d.gefunden != null ? ` · ${d.gefunden} Flurstücke gefunden${d.nichtGefunden ? `, ${d.nichtGefunden} nicht gefunden` : ''}` : ''}`)),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-small', disabled: !EINSORTIEREN_AN, onclick: () => sortiereNachWaldbesitzer(d.id) }, d.gefunden != null ? 'Erneut einsortieren' : 'Flurstücke einsortieren'),
            h('button', { class: 'btn btn-small', onclick: () => excelSpeichern(false, d.id, d.name) }, 'Als Excel'),
            h('button', { class: 'link-btn', onclick: () => tabelleLoeschen([d.id], `Tabelle „${d.name}“ entfernen?`, `${etDateiAnzahl(d.id)} Eigentümereinträge dieser Tabelle werden gelöscht.`) }, 'entfernen'))))) : null,
        h('label', { class: 'btn btn-primary' }, h('span', { html: icon.plus }), etDateien().length ? 'Weitere Excel-Tabelle hochladen' : 'Excel-Tabelle hochladen (.xlsx)', eingabe),
        h('p', { class: 'hint' }, 'Spalten: Gemarkung · Flur · Flurstück · Waldbesitzer · Straße · Hausnummer · PLZ · Ort · Telefon · E-Mail. Pflicht sind nur Gemarkung, Flur und Flurstück – alles andere darf leer bleiben und kann später in der App ergänzt werden. Mit Kopfzeile ist die Reihenfolge egal; Vorname und Nachname in getrennten Spalten gehen auch. Gleiche Flurstücke werden aktualisiert.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-small', onclick: () => excelSpeichern(true) }, 'Leere Vorlage (Excel)'),
          n ? h('button', { class: 'btn btn-small', onclick: () => excelSpeichern(false) }, 'Alle als Excel speichern') : null),
        n ? h('p', { class: 'hint' }, '„Als Excel“ bzw. „Alle als Excel speichern“ enthält die Einträge mit den Ergänzungen aus der App – damit ersetzt du deine Excel-Datei.') : null,
        n ? h('button', { class: 'btn', disabled: !EINSORTIEREN_AN, onclick: () => sortiereNachWaldbesitzer() }, 'Alle Flurstücke nach Waldbesitzer in Ordner sortieren') : null,
        EINSORTIEREN_AN ? null : h('p', { class: 'hint' }, 'Das Einsortieren der Flurstücke in Ordner ist noch in Arbeit und kommt mit einem späteren Update. Die Eigentümer aus der Tabelle erscheinen schon jetzt in der Flurstücks-Info.'),
        h('p', { class: 'hint' }, 'Eigentümerdaten sind personenbezogen: Sie bleiben nur auf diesem Gerät und sind nicht in „Daten sichern“ enthalten.'),
        n ? h('button', { class: 'btn btn-danger-ghost', onclick: () => tabelleLoeschen(null, 'Alle Eigentümerdaten löschen?', `${n} Einträge werden von diesem Gerät entfernt.`) }, 'Alle Eigentümerdaten löschen') : null) : null);
  }

  /** Erinnerungen an anstehende Maßnahmen */
  function erinnerungKarte() {
    const e = erinnerung.einstellung();
    const perm = erinnerung.erlaubnis();
    const naechste = erinnerung.anstehend(60).filter((x) => x.ts >= new Date().setHours(0, 0, 0, 0)).slice(0, 3);
    const aktiv = e.an && perm === 'granted';
    return h('section', { class: 'card erinnerung' },
      h('h2', {}, 'Erinnerungen an Maßnahmen'),
      h('div', { class: 'form' },
        perm === 'unsupported' ? h('p', { class: 'hint' }, 'Dieser Browser kann keine Benachrichtigungen anzeigen. Nutze die Kalenderdatei unten – dein Kalender erinnert dich dann.')
          : aktiv ? h('div', { class: 'erinnerung-status an' }, h('strong', {}, 'Benachrichtigungen sind an'),
            h('button', { class: 'btn btn-small', onclick: async () => { await erinnerung.ausschalten(); render(); toast('Benachrichtigungen ausgeschaltet'); } }, 'Ausschalten'))
          : h('button', { class: 'btn btn-primary', onclick: async () => {
            const r = await erinnerung.einschalten(); render();
            toast(r === 'granted' ? 'Benachrichtigungen eingeschaltet' : r === 'denied' ? 'Benachrichtigungen sind im Browser blockiert' : 'Benachrichtigungen nicht verfügbar');
          } }, 'Benachrichtigungen einschalten'),
        perm === 'denied' ? h('p', { class: 'warn-line' }, 'Der Browser blockiert Benachrichtigungen für diese Seite. Erlaube sie in den Website-Einstellungen (Schloss-Symbol neben der Adresse) und tippe dann erneut auf „Einschalten“.') : null,
        h('label', {}, 'Erinnern', h('select', { onchange: (ev) => { store.update((st) => { st.settings.erinnerung = { ...erinnerung.einstellung(), vorlauf: Number(ev.target.value) }; }); render(); } },
          erinnerung.VORLAUF.map(([v, l]) => h('option', { value: v, selected: e.vorlauf === v }, l)))),
        aktiv ? h('button', { class: 'btn', onclick: async () => { toast(await erinnerung.testNachricht() ? 'Testbenachrichtigung gesendet' : 'Senden nicht möglich'); } }, 'Testbenachrichtigung senden') : null,
        h('p', { class: 'hint' }, isIOS()
          ? 'iPhone: Benachrichtigungen gibt es nur, wenn die App über „Zum Home-Bildschirm“ installiert ist, und sie erscheinen beim Öffnen der App. Zuverlässig im Hintergrund erinnert dich die Kalenderdatei.'
          : erinnerung.hintergrundMoeglich()
            ? 'Fällige Termine meldet die App beim Öffnen. Ist die App installiert, prüft sie auch im Hintergrund etwa alle paar Stunden – wie oft, entscheidet der Browser. Ganz sicher geht es mit der Kalenderdatei.'
            : 'Fällige Termine meldet die App, sobald du sie öffnest. Im Hintergrund – auch wenn die App geschlossen ist – erinnert dich zuverlässig die Kalenderdatei.'),
        h('button', { class: 'btn', onclick: () => { const n = erinnerung.kalenderDatei(); toast(n ? `${n} Termine als Kalenderdatei gespeichert` : 'Keine offenen Termine mit Datum'); } }, h('span', { html: icon.calendar }), 'Termine in den Kalender übernehmen (.ics)'),
        h('p', { class: 'hint' }, 'Die Datei mit dem Kalender öffnen (Google Kalender, Apple Kalender, Outlook). Jeder Termin hat einen Alarm um 8 Uhr – passend zur Einstellung oben.'),
        naechste.length ? h('div', {}, h('p', { class: 'sheet-label' }, 'Nächste Termine'), h('ul', { class: 'mat-kurz' }, naechste.map((x) => h('li', {}, `${new Date(x.ts).toLocaleDateString('de-DE')}: ${x.titel}${x.ort ? ` · ${x.ort}` : ''}`))))
          : h('p', { class: 'muted' }, 'Zurzeit keine offenen Termine mit Datum. Setze bei einer Maßnahme einen Termin, dann wird erinnert.')));
  }

  /** Eigene Seite mit allen Flächen einzeln */
  function meineFlaechen() {
    const inhalt = h('div', { class: 'meine-flaechen' });
    const seite = openPage('Meine Flächen', inhalt);
    const zeichne = () => {
      const list = store.get().parcels.filter((p) => byId[p.id] && passtFlurstueck(p))
        .sort((a, b) => String(a.gemarkung).localeCompare(String(b.gemarkung), 'de') || String(a.flur).localeCompare(String(b.flur), 'de', { numeric: true }) || String(a.nr).localeCompare(String(b.nr), 'de', { numeric: true }));
      fill(inhalt,
        h('p', { class: 'muted' }, list.length ? `${list.length} ${list.length === 1 ? 'Fläche' : 'Flächen'}, zusammen ${formatHa(list.reduce((t, p) => t + amtlicheFlaecheHa(byId[p.id]), 0))}` : ''),
        list.length
          ? h('ul', { class: 'parcel-list' }, list.map((p) => {
              const full = byId[p.id];
              const kat = CATEGORIES[p.category] || CATEGORIES.Wald;
              return h('li', { class: 'parcel-item' },
                h('span', { class: 'swatch tall', style: `background:${kat.color}` }),
                h('div', { class: 'parcel-text' }, h('strong', {}, `Flurstück ${p.nr}`), h('span', {}, `${full.gemeinde && full.gemeinde !== '–' ? `${full.gemeinde}, ` : ''}${p.gemarkung}, Flur ${p.flur}`), h('span', { class: 'muted' }, `${kat.label}, ${formatHa(amtlicheFlaecheHa(full))}${full.flaecheAmtlich ? ' (amtlich)' : ''}`), full.nutzungText ? h('span', { class: 'muted small' }, full.nutzungText) : null, istProfi() ? h('span', { class: 'ordner-badge' }, `📁 ${ordnerName(p.ordnerId || null)}`) : null),
                h('button', { class: 'icon-btn', 'aria-label': `Auf ${parcelTitle(full)} zoomen`, html: icon.zoom, onclick: () => { seite.close(); page.close(); focusParcel(p.id); } }),
                h('button', { class: 'icon-btn danger', 'aria-label': `${parcelTitle(full)} löschen`, html: icon.trash, onclick: async () => { if (await removeParcel(p.id)) { zeichne(); render(); } } }),
              );
            }))
          : h('div', { class: 'empty' }, h('p', {}, 'Noch keine Flächen. Tippe in der Karte auf ein Flurstück oder suche es über die Lupe.'),
              h('button', { class: 'btn btn-primary', onclick: () => { seite.close(); page.close(); } }, 'Zur Karte')));
    };
    zeichne();
  }
  render();
}
