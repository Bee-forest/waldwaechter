// Verträglichkeits-Vorprüfung (FFH, § 34 BNatSchG) für Einschläge in der Brut- und Setzzeit,
// gespeichert als Anhang der Maßnahme und über den Maßnahmenverlauf jederzeit aufrufbar.
import { h, openPage, toast } from './ui.js';
import { store, uid } from './store.js';
import { schutzzeitText, schutzzeitVon } from './schutzgebiete.js';

export function protokoll(measureId, text) {
  store.update((s) => {
    const m = s.measures.find((x) => x.id === measureId);
    if (m) (m.historie ||= []).push({ ts: Date.now(), text });
  });
}

const GRUENDE = ['Borkenkäfer oder andere Kalamität – Holz muss schnell raus', 'Verkehrssicherung – Gefahr für Straße oder Weg', 'Bodenschutz – nur bei trockenem Boden befahrbar', 'Unternehmer nur jetzt verfügbar', 'Sonstiges (siehe Begründung)'];
const MASSNAHMEN = [
  'Horst- und Höhlenbäume vorher erfasst und markiert',
  'Fläche unmittelbar vor Arbeitsbeginn auf Brutvorkommen kontrolliert',
  'Biotop- und Altbäume bleiben stehen',
  'Arbeiten nur von Rückegassen aus',
  'Ruhezonen um bekannte Brut- und Setzplätze (mind. 100 m, Horste 300 m)',
  'Abschnittsweises Arbeiten, nicht die ganze Fläche auf einmal',
  'Kurze Einsatzdauer, keine Arbeiten in der Dämmerung',
];

/** Formular öffnen. measure: Maßnahme aus dem Store; anhangId: vorhandenen Anhang bearbeiten/ansehen */
export function openVertraeglichkeit(measureId, { anhangId = null, nurLesen = false, kontext = {}, onSaved } = {}) {
  const m = store.get().measures.find((x) => x.id === measureId);
  const alt = anhangId ? m?.anhaenge?.find((a) => a.id === anhangId) : null;
  const v = alt?.daten || vorbelegen(m, kontext);
  const body = h('form', { class: 'form vp-form', onsubmit: (e) => { e.preventDefault(); speichern(); } });
  const page = openPage(nurLesen ? 'Verträglichkeits-Vorprüfung' : 'Verträglichkeits-Vorprüfung ausfüllen', body);
  const feld = (label, key, attrs = {}) => h('label', {}, label, h(attrs.rows ? 'textarea' : 'input', { name: key, value: v[key] ?? '', disabled: nurLesen, ...attrs }, attrs.rows ? (v[key] ?? '') : null));
  const box = (key, opt) => h('label', { class: 'check-row' }, h('input', { type: 'checkbox', name: key, value: opt, checked: (v[key] || []).includes(opt), disabled: nurLesen }), h('span', {}, opt));
  const radio = (key, opt, label) => h('label', { class: 'check-row' }, h('input', { type: 'radio', name: key, value: opt, checked: v[key] === opt, disabled: nurLesen }), h('span', {}, label));

  body.append(
    h('p', { class: 'hint' }, `Der Einschlag liegt in einem Schutzgebiet (Natura 2000 bzw. Naturschutzgebiet) und in der Brut- und Setzzeit (${schutzzeitText(schutzzeitVon(m))}). Ist er nicht zu verschieben, halte hier fest, warum und wie Störungen vermieden werden. Ist eine erhebliche Beeinträchtigung nicht auszuschließen, muss die Untere Naturschutzbehörde eine FFH-Verträglichkeitsprüfung durchführen (§ 34 BNatSchG).`),
    h('fieldset', {}, h('legend', {}, '1. Maßnahme'),
      feld('Art der Maßnahme', 'massnahme'), feld('Fläche', 'flaeche'), feld('Größe (ha)', 'ha', { inputmode: 'decimal' }),
      h('div', { class: 'form-row' }, feld('Geplant von', 'von', { type: 'date' }), feld('bis', 'bis', { type: 'date' })),
      feld('Geplante Entnahme', 'entnahme'), feld('Technik (z. B. motormanuell, Harvester, Rückung mit Seilwinde)', 'technik')),
    h('fieldset', {}, h('legend', {}, '2. Natura 2000-Gebiet'),
      feld('Gebiet (Name)', 'gebiet'), feld('Gebietsnummer', 'gebietsnr'),
      feld('Betroffene Lebensraumtypen', 'lrt'), feld('Bekannte Arten (z. B. Schwarzstorch, Rotmilan, Fledermäuse)', 'arten', { rows: 2 })),
    h('fieldset', {}, h('legend', {}, '3. Warum nicht außerhalb der Brut- und Setzzeit?'),
      GRUENDE.map((g) => box('gruende', g)), feld('Begründung', 'begruendung', { rows: 3, required: !nurLesen })),
    h('fieldset', {}, h('legend', {}, '4. Vermeidung und Minderung'),
      MASSNAHMEN.map((g) => box('vermeidung', g)), feld('Weitere Maßnahmen', 'vermeidung_text', { rows: 2 })),
    h('fieldset', {}, h('legend', {}, '5. Einschätzung'),
      radio('ergebnis', 'keine', 'Eine erhebliche Beeinträchtigung der Erhaltungsziele ist nicht zu erwarten.'),
      radio('ergebnis', 'offen', 'Eine erhebliche Beeinträchtigung ist nicht auszuschließen → Untere Naturschutzbehörde einschalten.'),
      feld('Begründung der Einschätzung', 'ergebnis_text', { rows: 2 })),
    h('fieldset', {}, h('legend', {}, '6. Abstimmung'),
      feld('Forstamt / Untere Naturschutzbehörde informiert am', 'abstimmung_datum', { type: 'date' }),
      feld('Ansprechperson', 'abstimmung_person'), feld('Ergebnis der Abstimmung', 'abstimmung_ergebnis', { rows: 2 })),
    h('fieldset', {}, h('legend', {}, '7. Erstellt'),
      h('div', { class: 'form-row' }, feld('Name', 'name'), feld('Datum', 'datum', { type: 'date' }))),
    alt ? h('p', { class: 'muted' }, `Gespeichert am ${new Date(alt.erstellt).toLocaleString('de-DE')}${alt.geaendert ? `, zuletzt geändert ${new Date(alt.geaendert).toLocaleString('de-DE')}` : ''}.`) : null,
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, 'Drucken / als PDF'),
      nurLesen ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { page.close(); openVertraeglichkeit(measureId, { anhangId, onSaved }); } }, 'Bearbeiten')
        : h('button', { type: 'submit', class: 'btn btn-primary' }, 'Speichern und an Maßnahme anhängen')),
  );

  function speichern() {
    const fd = new FormData(body);
    const daten = {};
    for (const [k, val] of fd.entries()) {
      if (k === 'gruende' || k === 'vermeidung') (daten[k] ||= []).push(val); else daten[k] = String(val).trim();
    }
    store.update((s) => {
      const x = s.measures.find((y) => y.id === measureId);
      if (!x) return;
      x.anhaenge ||= [];
      if (alt) { const a = x.anhaenge.find((y) => y.id === alt.id); a.daten = daten; a.geaendert = Date.now(); }
      else x.anhaenge.push({ id: uid(), typ: 'vertraeglichkeit', titel: 'Verträglichkeits-Vorprüfung (Brut- und Setzzeit, Schutzgebiet)', erstellt: Date.now(), daten });
    });
    protokoll(measureId, alt ? 'Verträglichkeits-Vorprüfung geändert' : 'Verträglichkeits-Vorprüfung angehängt');
    toast('Verträglichkeits-Vorprüfung gespeichert');
    page.close();
    onSaved?.();
  }
}

function vorbelegen(m, k) {
  const ymd = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const pl = m?.thinning?.plan;
  const ffh = m?.thinning?.natura2000 || k.natura2000 || [];
  return {
    massnahme: pl?.eingriffe?.anzahl > 1 ? `Durchforstung, Eingriff ${pl.eingriffe.nr} von ${pl.eingriffe.anzahl}` : 'Durchforstung',
    flaeche: m?.thinning?.label || '', ha: pl ? pl.areaHa.toFixed(2).replace('.', ',') : '',
    von: ymd(m?.date || Date.now()), bis: '',
    entnahme: pl ? `ca. ${Math.round(pl.eingriffe?.vEingriff || 0)} Fm/ha, ${pl.total} Bäume (${pl.regel} je Rasterpunkt)` : '',
    gebiet: ffh.map((g) => `${g.art}: ${g.name}`).join('; '), gebietsnr: ffh.map((g) => g.code).filter(Boolean).join(', '),
    lrt: (m?.thinning?.lrt || k.lrt || []).map((l) => l.titel).join('; '),
    name: store.get().profile.name || '', datum: ymd(Date.now()),
  };
}

/** Verlauf und Anhänge einer Maßnahme */
export function openVerlauf(measureId) {
  const body = h('div', { class: 'verlauf' });
  let unsub = null;
  const page = openPage('Verlauf und Anhänge', body, { onClose: () => unsub?.() });
  const render = () => {
    const m = store.get().measures.find((x) => x.id === measureId);
    if (!m) { page.close(); return; }
    const eintraege = [{ ts: m.createdAt, text: 'Maßnahme angelegt' }, ...(m.historie || [])].sort((a, b) => b.ts - a.ts);
    body.replaceChildren(
      h('h2', { class: 'section-title' }, 'Anhänge'),
      m.anhaenge?.length
        ? h('ul', { class: 'anhang-list' }, m.anhaenge.map((a) => h('li', {},
            h('div', {}, h('strong', {}, a.titel), h('small', {}, `erstellt ${new Date(a.erstellt).toLocaleDateString('de-DE')}${a.daten?.ergebnis === 'offen' ? ' · Behörde einschalten' : ''}`)),
            h('button', { class: 'btn btn-small', onclick: () => (a.typ === 'foerderantrag' ? import('./foerderung.js').then((f) => f.openFoerderantrag({ antragId: a.antragId, nurLesen: true })) : openVertraeglichkeit(measureId, { anhangId: a.id, nurLesen: true })) }, 'Öffnen'))))
        : h('p', { class: 'muted' }, 'Keine Anhänge.'),
      h('h2', { class: 'section-title' }, 'Verlauf'),
      h('ul', { class: 'verlauf-list' }, eintraege.map((e) => h('li', {}, h('span', { class: 'cal-date' }, new Date(e.ts).toLocaleDateString('de-DE')), h('span', {}, e.text)))),
    );
  };
  render();
  unsub = store.subscribe(render);
}
