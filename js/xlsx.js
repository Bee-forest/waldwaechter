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

// ---------- Schreiben ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** ZIP-Archiv ohne Kompression aus { name: text } */
function zip(dateien) {
  const enc = new TextEncoder();
  const teile = [], verzeichnis = [];
  let off = 0;
  for (const [name, text] of Object.entries(dateien)) {
    const n = enc.encode(name), d = enc.encode(text), crc = crc32(d);
    const kopf = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, d.length, 4], [22, d.length, 4], [26, n.length, 2], [28, 0, 2]]
      .forEach(([o, v, l]) => (l === 4 ? kopf.setUint32(o, v, true) : kopf.setUint16(o, v, true)));
    const z = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, d.length, 4], [24, d.length, 4], [28, n.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]]
      .forEach(([o, v, l]) => (l === 4 ? z.setUint32(o, v, true) : z.setUint16(o, v, true)));
    teile.push(new Uint8Array(kopf.buffer), n, d);
    verzeichnis.push(new Uint8Array(z.buffer), n);
    off += 30 + n.length + d.length;
  }
  const vgr = verzeichnis.reduce((a, x) => a + x.length, 0);
  const ende = new DataView(new ArrayBuffer(22));
  const anzahl = Object.keys(dateien).length;
  [[0, 0x06054b50, 4], [8, anzahl, 2], [10, anzahl, 2], [12, vgr, 4], [16, off, 4]].forEach(([o, v, l]) => (l === 4 ? ende.setUint32(o, v, true) : ende.setUint16(o, v, true)));
  return new Blob([...teile, ...verzeichnis, new Uint8Array(ende.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const spaltenName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/**
 * Einfache .xlsx-Datei mit einem Tabellenblatt; alle Zellen als Text (PLZ mit führender Null bleibt erhalten).
 * @param {string[][]} zeilen  erste Zeile = Kopfzeile (fett)
 * @param {{ blatt?: string, breiten?: number[] }} o
 */
export function schreibeXlsx(zeilen, { blatt = 'Tabelle1', breiten = [] } = {}) {
  const rows = zeilen.map((z, r) => `<row r="${r + 1}">${z.map((v, c) => `<c r="${spaltenName(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('')}</row>`).join('');
  const cols = breiten.length ? `<cols>${breiten.map((b, i) => `<col min="${i + 1}" max="${i + 1}" width="${b}" customWidth="1"/>`).join('')}</cols>` : '';
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(blatt).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`,
  });
}
