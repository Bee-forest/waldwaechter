// Preisliste eines Holzkäufers (PDF) auf dem Gerät auslesen und in die Sortimente übernehmen.
// Die Datei verlässt das Gerät nicht: pdf.js liest sie im Browser, gespeichert werden nur die Preise
// in den Einstellungen dieses Geräts.
import { h, fill, openPage, toast } from './ui.js';
import { store, uid } from './store.js';
import { sortimente, speichern, BA_NAMEN, KLASSEN_STANDARD, preisAnzeige } from './sortimente.js';

const BA_WORT = { fichte: 'fi', kiefer: 'ki', lärche: 'lae', laerche: 'lae', douglasie: 'dgl', buche: 'bu', eiche: 'ei', ahorn: 'elb', esche: 'elb', birke: 'wlb', tanne: 'fi' };
const PREIS = /^\d{1,4}(?:[.,]\d{1,2})?\s*(?:€\s*)?(?:[-–]\s*\d{1,4}(?:[.,]\d{1,2})?)?\s*(?:€)?$/;
const STKL = /^(?:\d[ab]?(?:\s*[-–]\s*\d[ab]?)?\+?|ÜS\*?|UES\*?|US\*?|NSF\*?)$/i;
const zahl = (t) => Number(String(t).replace(',', '.'));
/** „103,00 - 108,00“ → „103-108“ (kurz, damit es in die Felder passt) */
const kurz = (t) => (String(t).match(/\d+(?:[.,]\d+)?/g) || []).slice(0, 2).map((x) => String(Number(x.replace(',', '.'))).replace('.', ',')).join('-');

/** PDF → Zeilen mit Zellen { s, x } (oben nach unten) */
export async function pdfZeilen(datei) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await datei.arrayBuffer()) }).promise;
  const zeilen = [];
  for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
    const seite = await doc.getPage(n);
    const tc = await seite.getTextContent();
    zeilen.push(...zeilenAus(tc.items.map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] - n * 2000 }))));
  }
  return zeilen;
}
export function zeilenAus(items) {
  const rows = [];
  items.filter((i) => i.s && i.s.trim()).sort((a, b) => b.y - a.y).forEach((i) => {
    const r = rows.find((z) => Math.abs(z.y - i.y) <= 3);
    if (r) r.cells.push({ s: i.s.trim(), x: i.x }); else rows.push({ y: i.y, cells: [{ s: i.s.trim(), x: i.x }] });
  });
  rows.forEach((r) => r.cells.sort((a, b) => a.x - b.x));
  return rows;
}

/** Zeilen → erkannte Preise: Stärkeklassen-Tabellen und einzelne Sortimente */
export function preislisteLesen(rows) {
  const text = (r) => r.cells.map((c) => c.s).join(' ');
  // 1) Stärkeklassen-Zeilen: Stkl.-Kürzel gefolgt von Preisen (auch mehrere Tabellen nebeneinander)
  const segs = [];
  rows.forEach((r, ri) => {
    r.cells.forEach((c, ci) => {
      if (!STKL.test(c.s)) return;
      const preise = [];
      for (let j = ci + 1; j < r.cells.length && !STKL.test(r.cells[j].s); j++) { if (PREIS.test(r.cells[j].s)) preise.push(r.cells[j]); else break; }
      if (preise.length) segs.push({ ri, y: r.y, x: c.x, key: c.s.replace(/\*/g, '').replace(/–/g, '-').replace(/^UE?S$/i, 'ÜS').trim(), preise });
    });
  });
  // nach Spalte (x) gruppieren
  const tabellen = [];
  segs.forEach((s) => {
    let t = tabellen.find((x) => Math.abs(x.x - s.x) < 45 && s.ri - x.letzte <= 2);
    if (!t) { t = { x: s.x, erste: s.ri, letzte: s.ri, zeilen: [] }; tabellen.push(t); }
    t.letzte = s.ri; t.zeilen.push(s);
  });
  const echte = tabellen.filter((t) => t.zeilen.length >= 2);
  const inTabelle = new Set(echte.flatMap((t) => t.zeilen.map((z) => z.ri)));
  const ergebnis = { tabellen: [], einfach: [] };
  echte.forEach((t) => {
    const nachbarn = echte.filter((u) => u !== t && Math.abs(u.erste - t.erste) <= 2);
    const xEnde = Math.min(...nachbarn.filter((u) => u.x > t.x).map((u) => u.x), Infinity);
    const imBereich = (c) => c.x >= t.x - 60 && c.x < xEnde - 20;
    const oben = rows.slice(Math.max(0, t.erste - 8), t.erste).reverse(); // von der Tabelle nach oben
    let baumart = null, name = null, einheit = 'fm', laenge = null, zugabe = 0;
    const spaltenX = t.zeilen[0].preise.map((p) => p.x);
    const spalten = spaltenX.map(() => []);
    let kopfErreicht = false; // ab der Zeile mit Sortimentsname/Hauptsortiment keine Gütespalten mehr sammeln
    for (const r of oben) {
      const cs = r.cells.filter(imBereich);
      for (const c of cs) {
        const w = c.s.toLowerCase();
        if (BA_WORT[w]) baumart = c.s; // die oberste Baumart-Überschrift gewinnt
        if (/€\s*\/\s*rm/i.test(c.s)) einheit = 'rm';
        const m = c.s.match(/(\d+),(\d{1,2})\s*m\b/);
        if (m && laenge == null) { const v = zahl(`${m[1]}.${m[2]}`); if (Number(m[2]) <= 20 && Number(m[1]) >= 3) { laenge = Number(m[1]); zugabe = Math.round((v - laenge) * 100); } else laenge = v; }
        if (!name && /holz|las\b|abschnitt|stamm/i.test(c.s) && !/preis|hauptsortiment|stärkeklasse/i.test(c.s)) name = c.s;
      }
      if (cs.some((c) => /hauptsortiment|holz|abschnitt/i.test(c.s))) kopfErreicht = true;
      if (!kopfErreicht) {
        cs.forEach((c) => {
          if (/preis|stärkeklasse/i.test(c.s) || BA_WORT[c.s.toLowerCase()]) return;
          const j = spaltenX.findIndex((x) => Math.abs(c.x - x) < 50);
          if (j >= 0) spalten[j].unshift(c.s);
        });
      }
    }
    const klassen = {};
    t.zeilen.forEach((z) => { const p = z.preise.map((c) => kurz(c.s)); klassen[z.key] = [p[0], p[1] ?? p[0]]; });
    ergebnis.tabellen.push({ baumart, ba: baumart ? BA_WORT[baumart.toLowerCase()] : null, name, einheit, laenge, zugabe, spalten: spalten.map((s) => s.join(' ')).filter(Boolean), klassen });
  });
  // 2) Einzelne Sortimente: Name, Preis, Bemerkung in einer Zeile
  let einheit = 'fm';
  rows.forEach((r, ri) => {
    const t = text(r);
    if (/€\s*\/\s*rm/i.test(t)) einheit = 'rm'; else if (/€\s*\/\s*fm/i.test(t)) einheit = 'fm';
    if (inTabelle.has(ri)) return;
    const pi = r.cells.findIndex((c, i) => i > 0 && PREIS.test(c.s));
    if (pi < 1) return;
    const name = r.cells.slice(0, pi).map((c) => c.s).join(' ');
    if (!/[a-zäöü]{2,}/i.test(name) || /^sortiment$|preis|stärkeklasse|tel|fax|iban/i.test(name) || name.length > 50) return;
    const bem = r.cells.slice(pi + 1).map((c) => c.s).join(' ');
    const alles = `${name} ${bem}`;
    const l = name.match(/(\d+(?:,\d+)?)\s*m\b/), zo = alles.match(/Zopf\s*(\d+)\s*cm/i), bis = alles.match(/bis\s*(\d+)\s*cm/i), urf = alles.match(/URF\s*=?\s*(\d+[.,]\d+)/i);
    ergebnis.einfach.push({ name: name.replace(/\s*(\d+(?:,\d+)?)\s*m\b/, '').trim() || name, einheit, preis: kurz(r.cells[pi].s), laenge: l ? zahl(l[1]) : null, zopf: zo ? Number(zo[1]) : null, max: bis ? Number(bis[1]) : null, rmFaktor: urf ? zahl(urf[1]) : null, bemerkung: bem });
  });
  // 3) Hinweise: Zopf je Baumart, Skonto, Titel
  const alle = rows.map(text).join('\n');
  ergebnis.zopf = {};
  for (const m of alle.matchAll(/(Fichte|Kiefer|Lärche|Douglasie|Buche|Eiche)\s*:\s*Zopf[^\n]*?(\d{1,2})\s*cm/gi)) ergebnis.zopf[BA_WORT[m[1].toLowerCase()]] = Number(m[2]);
  const sk = alle.match(/(\d+(?:,\d+)?)\s*%\s*Skonto/i);
  ergebnis.skonto = sk ? zahl(sk[1]) : null;
  const kopf = rows.slice(0, 4).map((r) => r.cells[r.cells.length - 1].s).filter((s) => /quartal|preis|ab\s|20\d\d|partner/i.test(s));
  ergebnis.titel = kopf.join(' ').replace(/\s+/g, ' ').replace(/&\s*$/, '').trim() || null;
  return ergebnis;
}

// ---------- Zuordnung zu den Sortimenten ----------
function zielTabelle(liste, t) {
  if (t.ba) { const s = liste.find((x) => x.preisArt === 'klassen' && Array.isArray(x.fuer) && x.fuer.includes(t.ba)); if (s) return s.k; }
  return 'neu';
}
function zielEinfach(liste, e) {
  const n = e.name;
  const such = (re, k) => (re.test(n) && liste.some((x) => x.k === k) ? k : null);
  return such(/\bIS\b|industrie/i, 'is') || such(/\bPAL\b|palett/i, 'pal') || such(/pfahl|zaun/i, 'pfahl') || such(/brenn/i, 'brenn') || such(/energie|hack/i, 'energie') || 'neu';
}

export function preislisteLaden({ onFertig } = {}) {
  const inp = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
  document.body.append(inp);
  inp.onchange = async () => {
    const f = inp.files?.[0]; inp.remove();
    if (!f) return;
    toast('Preisliste wird gelesen …');
    let erg;
    try { erg = preislisteLesen(await pdfZeilen(f)); } catch (e) { console.error(e); toast('Die PDF-Datei konnte nicht gelesen werden.'); return; }
    if (!erg.tabellen.length && !erg.einfach.length) { toast('In der Datei wurden keine Preise erkannt – bitte von Hand eintragen.'); return; }
    pruefen(erg, f.name, onFertig);
  };
  inp.click();
}

function pruefen(erg, dateiname, onFertig) {
  const liste = sortimente().map((x) => JSON.parse(JSON.stringify(x)));
  const posten = [
    ...erg.tabellen.map((t) => ({ art: 't', d: t, ziel: zielTabelle(liste, t), an: true })),
    ...erg.einfach.map((e) => ({ art: 'e', d: e, ziel: zielEinfach(liste, e), an: true })),
  ];
  const body = h('div', { class: 'pl-pruefen' });
  const seite = openPage('Preisliste prüfen', body);
  const optionen = (p) => [h('option', { value: 'neu', selected: p.ziel === 'neu' }, '+ als neues Sortiment'),
    ...liste.filter((s) => (p.art === 't' ? true : true)).map((s) => h('option', { value: s.k, selected: p.ziel === s.k }, s.name))];
  function render() {
    fill(body,
      h('p', {}, h('strong', {}, erg.titel || dateiname)),
      h('p', { class: 'hint' }, 'Das hat die App in der Preisliste erkannt. Prüfe die Zuordnung zu deinen Sortimenten und tippe auf „Übernehmen“. Die Preise bleiben nur auf diesem Gerät.'),
      posten.map((p) => h('div', { class: 'kachel pl-posten' },
        h('label', { class: 'jk-check' }, h('input', { type: 'checkbox', checked: p.an, onchange: (e) => { p.an = e.target.checked; } }),
          h('span', {}, p.art === 't' ? `${p.d.name || 'Stammholz'}${p.d.baumart ? ` – ${p.d.baumart}` : ''}` : p.d.name,
            h('small', {}, p.art === 't'
              ? `${Object.keys(p.d.klassen).length} Stärkeklassen · ${p.d.spalten.slice(0, 2).join(' / ') || 'Preise'} · €/${p.d.einheit === 'rm' ? 'Rm' : 'Fm'}${p.d.laenge ? ` · ${String(p.d.laenge).replace('.', ',')} m${p.d.zugabe ? ` + ${p.d.zugabe} cm` : ''}` : ''}`
              : `${preisAnzeige(p.d.preis)} €/${p.d.einheit === 'rm' ? 'Rm' : 'Fm'}${p.d.laenge ? ` · ${String(p.d.laenge).replace('.', ',')} m` : ''}${p.d.zopf ? ` · Zopf ${p.d.zopf} cm` : ''}${p.d.max ? ` bis ${p.d.max} cm` : ''}${p.d.rmFaktor ? ` · URF ${String(p.d.rmFaktor).replace('.', ',')}` : ''}`))),
        p.art === 't' ? h('table', { class: 'so-tabelle pl-tabelle' }, h('tbody', {}, Object.entries(p.d.klassen).map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, preisAnzeige(v[0])), h('td', {}, preisAnzeige(v[1])))))) : null,
        h('label', {}, 'Übernehmen in', h('select', { onchange: (e) => { p.ziel = e.target.value; } }, optionen(p))))),
      erg.skonto ? h('p', { class: 'hint' }, `Skonto laut Liste: ${String(erg.skonto).replace('.', ',')} % – wird als Abzug vom Erlös übernommen.`) : null,
      Object.keys(erg.zopf || {}).length ? h('p', { class: 'hint' }, `Zopf laut Liste: ${Object.entries(erg.zopf).map(([k, v]) => `${BA_NAMEN[k]} ${v} cm`).join(', ')} – wird bei den passenden Stammholz-Sortimenten eingetragen.`) : null,
      h('button', { type: 'button', class: 'btn btn-primary btn-block btn-large', onclick: () => { uebernehmen(); seite.close(); } }, 'Übernehmen'),
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => seite.close() }, 'Abbrechen'));
  }
  function uebernehmen() {
    const restI = () => { const i = liste.findIndex((x) => x.rest); return i < 0 ? liste.length : i; };
    let n = 0;
    for (const p of posten) {
      if (!p.an) continue;
      let s = liste.find((x) => x.k === p.ziel);
      if (!s) {
        s = p.art === 't'
          ? { k: uid(), name: `${p.d.name || 'Stammholz'}${p.d.baumart ? ` ${p.d.baumart}` : ''}`, laenge: 5, zugabe: 10, zopf: 14, max: '', fuer: p.d.ba ? [p.d.ba] : 'alle', einheit: 'fm', preisArt: 'klassen' }
          : { k: uid(), name: p.d.name, laenge: 2, zugabe: 0, zopf: 8, max: '', fuer: 'alle', einheit: 'fm', preisArt: 'einfach' };
        liste.splice(p.art === 't' ? liste.findIndex((x) => x.preisArt !== 'klassen') : restI(), 0, s);
      }
      if (p.art === 't') {
        s.preisArt = 'klassen'; s.einheit = p.d.einheit; s.klassen = p.d.klassen;
        if (p.d.spalten.length) s.spalten = p.d.spalten.slice(0, 2);
        if (p.d.laenge) { s.laenge = p.d.laenge; s.zugabe = p.d.zugabe; }
        const zo = (Array.isArray(s.fuer) ? s.fuer : []).map((b) => erg.zopf?.[b]).filter(Boolean);
        if (zo.length) s.zopf = Math.max(...zo);
      } else {
        s.preisArt = 'einfach'; s.einheit = p.d.einheit; s.preis = p.d.preis;
        if (p.d.laenge) s.laenge = p.d.laenge;
        if (p.d.zopf) s.zopf = p.d.zopf;
        if (p.d.max) s.max = p.d.max;
        if (p.d.rmFaktor) s.rmFaktor = p.d.rmFaktor;
      }
      n++;
    }
    speichern(liste);
    store.update((st) => { st.settings.preisliste = { titel: erg.titel || dateiname.replace(/\.pdf$/i, ''), am: Date.now() }; if (erg.skonto != null) st.settings.skonto = String(erg.skonto); });
    toast(`${n} Preise übernommen – nur auf diesem Gerät gespeichert`);
    onFertig?.();
  }
  render();
}
export { KLASSEN_STANDARD };
