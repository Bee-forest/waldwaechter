// Kleiner Leser für Excel-Dateien (.xlsx) ohne Fremdbibliothek: entpackt das ZIP-Archiv mit der
// Browser-Funktion DecompressionStream und liest das erste Tabellenblatt als Zeilen von Texten.
// Auch .csv (Trennzeichen ; oder ,) wird verstanden.

const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Liest das Inhaltsverzeichnis eines ZIP-Archivs; liefert { name → async () => Uint8Array } */
function zipEintraege(d) {
  let eocd = -1;
  for (let i = d.length - 22; i >= Math.max(0, d.length - 65558); i--) if (u32(d, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Keine gültige Excel-Datei (ZIP-Verzeichnis fehlt).');
  const anzahl = u16(d, eocd + 10);
  let p = u32(d, eocd + 16);
  const out = {};
  const dec = new TextDecoder();
  for (let i = 0; i < anzahl; i++) {
    if (u32(d, p) !== 0x02014b50) break;
    const methode = u16(d, p + 10), groesse = u32(d, p + 20), nl = u16(d, p + 28), el = u16(d, p + 30), cl = u16(d, p + 32), lokal = u32(d, p + 42);
    const name = dec.decode(d.subarray(p + 46, p + 46 + nl));
    out[name] = async () => {
      const start = lokal + 30 + u16(d, lokal + 26) + u16(d, lokal + 28);
      const roh = d.subarray(start, start + groesse);
      if (methode === 0) return roh;
      if (methode === 8) return inflate(roh);
      throw new Error(`Komprimierung ${methode} wird nicht unterstützt.`);
    };
    p += 46 + nl + el + cl;
  }
  return out;
}

const xml = (bytes) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
const byTag = (el, tag) => [...el.getElementsByTagNameNS('*', tag)];
const spalte = (ref) => { let n = 0; for (const c of String(ref).replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };

/** Erstes Tabellenblatt einer .xlsx-Datei als Array von Zeilen (Arrays von Texten) */
export async function leseXlsx(buffer) {
  const d = new Uint8Array(buffer);
  const z = zipEintraege(d);
  // Erstes Blatt laut Arbeitsmappe bestimmen (Reihenfolge der Reiter)
  let blatt = 'xl/worksheets/sheet1.xml';
  try {
    const wb = xml(await z['xl/workbook.xml']());
    const erstes = byTag(wb, 'sheet')[0];
    const rid = erstes?.getAttribute('r:id') || erstes?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rels = xml(await z['xl/_rels/workbook.xml.rels']());
    const ziel = byTag(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (ziel) blatt = ziel.startsWith('/') ? ziel.slice(1) : `xl/${ziel.replace(/^\.\//, '')}`;
  } catch { /* Standardname verwenden */ }
  if (!z[blatt]) blatt = Object.keys(z).find((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  if (!blatt) throw new Error('Kein Tabellenblatt gefunden.');
  const texte = [];
  if (z['xl/sharedStrings.xml']) {
    const ss = xml(await z['xl/sharedStrings.xml']());
    for (const si of byTag(ss, 'si')) texte.push(byTag(si, 't').map((t) => t.textContent).join(''));
  }
  const sh = xml(await z[blatt]());
  const zeilen = [];
  for (const row of byTag(sh, 'row')) {
    const r = Number(row.getAttribute('r')) - 1;
    const zeile = [];
    byTag(row, 'c').forEach((c, i) => {
      const ref = c.getAttribute('r');
      const k = ref ? spalte(ref) : i;
      const t = c.getAttribute('t');
      const v = byTag(c, 'v')[0]?.textContent ?? '';
      let wert;
      if (t === 's') wert = texte[Number(v)] ?? '';
      else if (t === 'inlineStr') wert = byTag(c, 't').map((x) => x.textContent).join('');
      else if (t === 'b') wert = v === '1' ? 'wahr' : 'falsch';
      else wert = v;
      // Zahlen wie 7.0 oder 1.2E+3 lesbar machen
      if (t !== 's' && t !== 'inlineStr' && /^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(wert)) { const n = Number(wert); if (Number.isFinite(n)) wert = Number.isInteger(n) ? String(n) : String(n); }
      zeile[k] = String(wert ?? '').trim();
    });
    zeilen[Number.isFinite(r) && r >= 0 ? r : zeilen.length] = Array.from(zeile, (x) => x ?? '');
  }
  return zeilen.filter((z2) => z2 && z2.some((x) => x));
}

/** CSV mit ; oder , als Trennzeichen (Anführungszeichen erlaubt) */
export function leseCsv(text) {
  text = text.replace(/^﻿/, '');
  const erste = text.split(/\r?\n/)[0] || '';
  const sep = (erste.match(/;/g) || []).length >= (erste.match(/,/g) || []).length ? ';' : ',';
  const zeilen = []; let zeile = [], feld = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { feld += '"'; i++; } else inQ = false; } else feld += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { zeile.push(feld.trim()); feld = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; zeile.push(feld.trim()); zeilen.push(zeile); zeile = []; feld = ''; }
    else feld += c;
  }
  if (feld || zeile.length) { zeile.push(feld.trim()); zeilen.push(zeile); }
  return zeilen.filter((z) => z.some((x) => x));
}

/** Datei (xlsx oder csv) → Zeilen */
export async function leseTabelle(datei) {
  const name = (datei.name || '').toLowerCase();
  if (name.endsWith('.csv') || datei.type === 'text/csv') return leseCsv(await datei.text());
  return leseXlsx(await datei.arrayBuffer());
}
