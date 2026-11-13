// node tests/bhdkamera.test.mjs – Rechenkern der Kameramessung (ohne Oberfläche)
globalThis.document = { getElementById: () => null, addEventListener() {}, createElement: () => ({}) };
globalThis.window = globalThis; globalThis.history = { pushState() {} }; globalThis.addEventListener = () => {};
const K = await import('../js/thinning/bhdkamera.js');
let ok = 0, fehler = 0;
const gleich = (name, ist, soll, tol = 1e-3) => { const g = Math.abs(ist - soll) <= tol; g ? ok++ : fehler++; console.log(`${g ? '✓' : 'FEHLER'} ${name}: ${ist}${g ? '' : ` (soll ${soll})`}`); };
// Zylinder: Ds = D·√(a/(a+D)) – Rückrechnung ergibt D
for (const [D, a] of [[50, 200], [30, 150], [80, 300], [12, 100]]) gleich(`Korrektur D=${D}, a=${a}`, K.zylinderKorrektur(D * Math.sqrt(a / (a + D)), a), D);
gleich('ohne Abstand keine Korrektur', K.zylinderKorrektur(40, 0), 40);
// Abstand aus 35-mm-Brennweite: 26 mm KB, 4000×3000 px, Karte 85,6 mm erscheint 200 px
gleich('Abstand aus Brennweite (cm)', K.abstandAusBrennweite({ f35: 26, diagPx: 5000, refPx: 200, refMm: 85.6 }), 26 * 5000 / Math.hypot(36, 24) * 85.6 / 200 / 10);
// Messung: Karte 200 px, Stamm 1000 px → scheinbar 42,8 cm; bei 2 m → aufgerundet
const m = K.bhdAusMessung({ refPx: 200, stammPx: 1000, refMm: 85.6, abstandCm: 200 });
gleich('scheinbar', m.scheinbar, 42.8); gleich('aufgerundet', m.bhd, Math.ceil(m.roh)); gleich('Korrektur > scheinbar', m.roh > m.scheinbar ? 1 : 0, 1);
// EXIF: minimales JPEG mit Exif-IFD und Tag 0xA405 = 26
function jpeg(le) {
  const t = []; const u16 = (v) => le ? t.push(v & 255, v >> 8) : t.push(v >> 8, v & 255); const u32 = (v) => le ? t.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24) : t.push(v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255);
  t.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d])); u16(42); u32(8);
  u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0); // IFD0 → Exif-IFD bei 26
  u16(1); u16(0xa405); u16(3); u32(1); u16(26); u16(0); u32(0); // Exif-IFD
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t]; const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xd9]).buffer;
}
gleich('EXIF big endian', K.exifBrennweite35(jpeg(false)), 26); gleich('EXIF little endian', K.exifBrennweite35(jpeg(true)), 26);
gleich('kein JPEG', K.exifBrennweite35(new Uint8Array([1, 2, 3, 4]).buffer) ?? -1, -1);
console.log(`${ok} Tests bestanden, ${fehler} Fehler`); if (fehler) process.exit(1);
