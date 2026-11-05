// Füllt die Original-Antragsformulare (AcroForm-PDF) im Browser aus.
// Das Original bleibt unverändert; die Werte werden als inkrementelle Aktualisierung angehängt
// (neue Feld-Objekte mit /V, fertige Darstellungen /AP und ein Querverweis-Stream). So erkennt jedes
// PDF-Programm das Formular weiterhin als ausfüllbar und die Angaben bleiben änderbar.
import { breite, esc } from './pdf.js';

const cache = {};
export async function ladeFormular(kurz) {
  if (!cache[kurz]) {
    cache[kurz] = Promise.all([
      fetch(`data/formulare/${kurz}.json`).then((r) => { if (!r.ok) throw new Error('Formular-Daten fehlen'); return r.json(); }),
      fetch(`data/formulare/${kurz}.pdf`).then((r) => { if (!r.ok) throw new Error('Formular fehlt'); return r.arrayBuffer(); }),
    ]).then(([meta, pdf]) => ({ meta, pdf: new Uint8Array(pdf) }));
    cache[kurz].catch(() => delete cache[kurz]);
  }
  return cache[kurz];
}

export async function formularAusfuellen(kurz, werte) {
  const { meta, pdf } = await ladeFormular(kurz);
  return fuelle(meta, pdf, werte);
}

const zahl = (v) => (Math.round(v * 100) / 100).toString();
const deZahl = (v, d) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** PDF-Textstring (UTF-16BE, hex) für /V */
function pdfString(s) {
  let h = 'FEFF';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c > 0xFFFF) { const v = c - 0x10000; h += (0xD800 + (v >> 10)).toString(16).padStart(4, '0') + (0xDC00 + (v & 0x3FF)).toString(16).padStart(4, '0'); } else h += c.toString(16).padStart(4, '0');
  }
  return `<${h.toUpperCase()}>`;
}

/** Fügt Schlüssel in ein serialisiertes Dictionary ein (vor dem letzten >>) */
const mitSchluesseln = (d, extra) => d.replace(/>>\s*$/, `${extra}\n>>`);

function schriftGroesse(da) {
  const m = /([\d.]+)\s+Tf/.exec(da || '');
  return m ? Number(m[1]) : 0;
}

/** Zeilen umbrechen */
function umbrechen(s, maxB, size) {
  const out = [];
  for (const absatz of String(s).split('\n')) {
    let z = '';
    for (const wort of absatz.split(/\s+/)) {
      const t = z ? `${z} ${wort}` : wort;
      if (breite(t, false, size) <= maxB || !z) z = t; else { out.push(z); z = wort; }
    }
    out.push(z);
  }
  return out;
}

/** Darstellungs-Stream (Inhalt) für ein Textfeld */
function textDarstellung(text, f, w) {
  const [x1, y1, x2, y2] = w.r;
  const B = Math.abs(x2 - x1), H = Math.abs(y2 - y1);
  const pad = 2;
  const mehrzeilig = (f.ff & 4096) !== 0;
  const kamm = (f.ff & (1 << 24)) !== 0 && f.ml;
  const daSize = schriftGroesse(w.da || f.da);
  let size = daSize > 0 ? Math.min(daSize, 11) : 10;
  const ops = ['/Tx BMC', 'q', `${zahl(1)} ${zahl(1)} ${zahl(B - 2)} ${zahl(H - 2)} re W n`, 'BT', '0 g'];
  if (kamm) {
    size = Math.min(size, H * 0.7);
    const zelle = B / f.ml;
    const y = (H - size * 0.72) / 2;
    ops.push(`/Helv ${zahl(size)} Tf`);
    [...String(text)].slice(0, f.ml).forEach((ch, i) => {
      const x = i * zelle + (zelle - breite(ch, false, size)) / 2;
      ops.push(`1 0 0 1 ${zahl(x)} ${zahl(y)} Tm (${esc(ch)}) Tj`);
    });
  } else if (mehrzeilig) {
    let zeilen;
    for (;;) {
      zeilen = umbrechen(text, B - 2 * pad, size);
      if (zeilen.length * size * 1.15 <= H - 2 || size <= 6) break;
      size -= 0.5;
    }
    ops.push(`/Helv ${zahl(size)} Tf`);
    zeilen.forEach((z, i) => {
      const y = H - pad - size * (i + 0.85) * 1.15;
      ops.push(`1 0 0 1 ${zahl(pad)} ${zahl(y)} Tm (${esc(z)}) Tj`);
    });
  } else {
    size = Math.min(size, (H - 2) * 0.78);
    while (breite(text, false, size) > B - 2 * pad && size > 6) size -= 0.25;
    const tw = breite(text, false, size);
    const x = f.q === 1 ? (B - tw) / 2 : f.q === 2 ? B - pad - tw : pad;
    const y = (H - size * 0.72) / 2;
    ops.push(`/Helv ${zahl(size)} Tf`, `1 0 0 1 ${zahl(Math.max(pad, x))} ${zahl(y)} Tm (${esc(text)}) Tj`);
  }
  ops.push('ET', 'Q', 'EMC');
  return { inhalt: ops.join('\n'), B, H };
}

/** Kern: hängt die Werte an das Original an und liefert einen Blob */
export function fuelle(meta, pdf, werte) {
  const neu = [];           // { nr, gen, text }
  let naechste = meta.size;
  const ref = (s) => s.split(' ').map(Number);
  const fehlend = [];

  for (const [name, wert] of Object.entries(werte)) {
    if (wert == null || wert === '' || wert === false) continue;
    const f = meta.felder[name];
    if (!f) { fehlend.push(name); continue; }
    const [fnr, fgen] = ref(f.o);
    const zusammen = f.w.length === 1 && f.w[0].o === f.o;
    if (f.t === 'btn') {
      const ziel = typeof wert === 'string' ? wert : wert ? (f.w[0].on || 'Ja') : null;
      const v = ziel ? `/${ziel}` : '/Off';
      if (zusammen) {
        neu.push({ nr: fnr, gen: fgen, text: mitSchluesseln(f.d, `/V ${v}\n/AS ${f.w[0].on === ziel ? v : '/Off'}`) });
      } else {
        neu.push({ nr: fnr, gen: fgen, text: mitSchluesseln(f.d, `/V ${v}`) });
        for (const w of f.w) {
          const [wn, wg] = ref(w.o);
          neu.push({ nr: wn, gen: wg, text: mitSchluesseln(w.d, `/AS ${ziel && w.on === ziel ? v : '/Off'}`) });
        }
      }
      continue;
    }
    // Textfeld
    let anzeige = String(wert), roh = String(wert);
    if (f.fmt != null && typeof wert === 'number' && isFinite(wert)) {
      roh = wert.toFixed(f.fmt); anzeige = deZahl(wert, f.fmt);
    } else if (typeof wert === 'number' && isFinite(wert)) {
      roh = anzeige = deZahl(wert, Number.isInteger(wert) ? 0 : 2);
    }
    const apNr = (w) => {
      const { inhalt, B, H } = textDarstellung(anzeige, f, w);
      const nr = naechste++;
      neu.push({ nr, gen: 0, text: `<< /Type /XObject /Subtype /Form /BBox [0 0 ${zahl(B)} ${zahl(H)}] /Resources << /Font << /Helv ${meta.helv} >> >> /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream` });
      return nr;
    };
    if (zusammen) {
      const ap = apNr(f.w[0]);
      neu.push({ nr: fnr, gen: fgen, text: mitSchluesseln(f.d, `/V ${pdfString(roh)}\n/AP << /N ${ap} 0 R >>`) });
    } else {
      neu.push({ nr: fnr, gen: fgen, text: mitSchluesseln(f.d, `/V ${pdfString(roh)}`) });
      for (const w of f.w) {
        const [wn, wg] = ref(w.o);
        const ap = apNr(w);
        neu.push({ nr: wn, gen: wg, text: mitSchluesseln(w.d, `/AP << /N ${ap} 0 R >>`) });
      }
    }
  }
  if (fehlend.length) console.warn('Unbekannte Formularfelder:', fehlend);

  // Schreiben
  const enc = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF; return b; };
  const teile = [pdf];
  let pos = pdf.length;
  if (pdf[pdf.length - 1] !== 0x0A) { teile.push(enc('\n')); pos += 1; }
  const offs = new Map();
  for (const o of neu) {
    const s = `${o.nr} ${o.gen} obj\n${o.text}\nendobj\n`;
    offs.set(o.nr, { off: pos, gen: o.gen });
    const b = enc(s); teile.push(b); pos += b.length;
  }
  const xrefNr = naechste++;
  offs.set(xrefNr, { off: pos, gen: 0 });
  const nummern = [...offs.keys()].sort((a, b) => a - b);
  const index = [];
  for (const n of nummern) {
    const letzte = index[index.length - 1];
    if (letzte && letzte[0] + letzte[1] === n) letzte[1]++; else index.push([n, 1]);
  }
  const daten = new Uint8Array(nummern.length * 7);
  nummern.forEach((n, i) => {
    const { off, gen } = offs.get(n);
    const p = i * 7;
    daten[p] = 1;
    daten[p + 1] = (off >>> 24) & 0xFF; daten[p + 2] = (off >>> 16) & 0xFF; daten[p + 3] = (off >>> 8) & 0xFF; daten[p + 4] = off & 0xFF;
    daten[p + 5] = (gen >> 8) & 0xFF; daten[p + 6] = gen & 0xFF;
  });
  const id = meta.id ? ` /ID [<${meta.id[0]}> <${meta.id[1]}>]` : '';
  const kopf = `${xrefNr} 0 obj\n<< /Type /XRef /Size ${naechste} /Root ${meta.root}${meta.info ? ` /Info ${meta.info}` : ''}${id} /Prev ${meta.startxref} /W [1 4 2] /Index [${index.flat().join(' ')}] /Length ${daten.length} >>\nstream\n`;
  teile.push(enc(kopf), daten, enc(`\nendstream\nendobj\nstartxref\n${pos}\n%%EOF\n`));
  return new Blob(teile, { type: 'application/pdf' });
}

/** Feldliste eines Formulars (für Tests/Fehlersuche) */
export async function felder(kurz) { return Object.keys((await ladeFormular(kurz)).meta.felder); }
