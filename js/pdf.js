// Kleiner PDF-Erzeuger ohne Fremdbibliothek: A4, Standardschrift Helvetica (WinAnsi), Text, Linien, Polygone.
// Zeichenbreiten (Helvetica / Helvetica-Bold, Zeichen 32–255 in CP1252) aus den Adobe-AFM-Metriken.
const W = [[278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500], [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 761, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556]];
const CP = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '×': 0xD7 };
const code = (ch) => { const c = ch.codePointAt(0); if (CP[ch] != null) return CP[ch]; return c >= 32 && c <= 255 && !(c >= 0x80 && c < 0xA0) ? c : 0x3F; };
export const breite = (s, bold, size) => [...String(s)].reduce((a, ch) => a + (W[bold ? 1 : 0][code(ch) - 32] || 556), 0) * size / 1000;
export const esc = (s) => [...String(s)].map((ch) => { const c = code(ch); const t = String.fromCharCode(c); return t === '(' || t === ')' || t === '\\' ? '\\' + t : c > 126 ? '\\' + c.toString(8).padStart(3, '0') : t; }).join('');
const n = (v) => (Math.round(v * 100) / 100).toString();

export class Pdf {
  constructor() { this.seiten = []; this.bilder = []; this.B = 595.28; this.H = 841.89; this.neueSeite(); }
  neueSeite() { this.ops = []; this.seiten.push(this.ops); return this; }
  farbe([r, g, b], fill = false) { this.ops.push(`${n(r / 255)} ${n(g / 255)} ${n(b / 255)} ${fill ? 'rg' : 'RG'}`); }
  text(x, y, s, { bold = false, size = 10, farbe = [20, 30, 20] } = {}) {
    this.farbe(farbe, true);
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(x)} ${n(this.H - y)} Td (${esc(s)}) Tj ET`);
  }
  /** Zeilenumbruch nach Breite */
  umbrechen(s, maxB, { bold = false, size = 10 } = {}) {
    const out = [];
    for (const absatz of String(s ?? '').split('\n')) {
      let z = '';
      for (const wort of absatz.split(/\s+/)) {
        const t = z ? `${z} ${wort}` : wort;
        if (breite(t, bold, size) <= maxB || !z) z = t; else { out.push(z); z = wort; }
      }
      out.push(z);
    }
    return out;
  }
  linie(x1, y1, x2, y2, { w = 0.6, farbe = [160, 170, 160], strich = null } = {}) {
    this.farbe(farbe);
    this.ops.push(`${n(w)} w ${strich ? `[${strich.join(' ')}] 0 d` : '[] 0 d'} ${n(x1)} ${n(this.H - y1)} m ${n(x2)} ${n(this.H - y2)} l S`);
  }
  rechteck(x, y, b, h, { fill = null, stroke = null, w = 0.6 } = {}) {
    if (fill) this.farbe(fill, true);
    if (stroke) this.farbe(stroke);
    this.ops.push(`${n(w)} w [] 0 d ${n(x)} ${n(this.H - y - h)} ${n(b)} ${n(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
  }
  /** Polygon(e) aus Punkten [x, y] (Seitenkoordinaten, y nach unten) */
  polygon(ringe, { fill = null, stroke = [0, 0, 0], w = 1 } = {}) {
    if (fill) this.farbe(fill, true);
    if (stroke) this.farbe(stroke);
    const p = ringe.map((r) => r.map(([x, y], i) => `${n(x)} ${n(this.H - y)} ${i ? 'l' : 'm'}`).join(' ') + ' h').join(' ');
    this.ops.push(`${n(w)} w [] 0 d ${p} ${fill && stroke ? 'B*' : fill ? 'f*' : 'S'}`);
  }
  /** JPEG-Bild einfügen: bild = { jpeg: Uint8Array, w, h } (Pixel); x, y, b, h in Punkten (y nach unten) */
  bild(x, y, b, h, bild) {
    const k = this.bilder.push(bild);
    this.ops.push(`q ${n(b)} 0 0 ${n(h)} ${n(x)} ${n(this.H - y - h)} cm /Im${k} Do Q`);
  }
  blob() {
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    // Bilder als binäre Zeichenkette (jedes Zeichen ein Byte)
    const bildIds = this.bilder.map((b) => {
      let bin = '';
      for (let i = 0; i < b.jpeg.length; i += 8192) bin += String.fromCharCode.apply(null, b.jpeg.subarray(i, i + 8192));
      return add(`<< /Type /XObject /Subtype /Image /Width ${b.w} /Height ${b.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${b.jpeg.length} >>\nstream\n${bin}\nendstream`);
    });
    const xobj = bildIds.length ? ` /XObject << ${bildIds.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ')} >>` : '';
    const pagesId = objs.length + 1; objs.push(null);
    const kids = [];
    for (const ops of this.seiten) {
      const s = ops.join('\n');
      const c = add(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(this.B)} ${n(this.H)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xobj} >> /Contents ${c} 0 R >>`));
    }
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    let out = '%PDF-1.4\n';
    const off = [];
    objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${x}\n%%EOF`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
    return new Blob([bytes], { type: 'application/pdf' });
  }
}

export function herunterladen(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
