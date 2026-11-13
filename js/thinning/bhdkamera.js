// BHD mit der Kamera messen – Referenzverfahren.
// Eine Referenz bekannter Länge (z. B. Bankkarte, Zollstock) liegt in 1,30 m Höhe waagerecht vorn am Stamm.
// Auf dem Foto werden die Kanten der Referenz und die Stammkanten mit senkrechten Linien markiert.
//
//   scheinbarer Durchmesser  Ds = Stammbreite_px / Referenz_px · Referenzlänge
//   Ein Zylinder erscheint in der Ebene seiner Vorderseite schmaler als er ist, weil man von vorn
//   nur bis zu den Tangentenpunkten sieht:  Ds = D · √(a / (a + D)),  a = Abstand Kamera → Stammvorderseite.
//   Aufgelöst:  D = (Ds² + √(Ds⁴ + 4·a²·Ds²)) / (2·a)
//   Den Abstand a liefert die Brennweite aus den Foto-Metadaten (EXIF „35-mm-Brennweite“):
//   f_px = f35 · Bilddiagonale_px / 43,27 mm  →  a = f_px · Referenzlänge / Referenz_px.
//   Fehlt die Angabe, wählt der Nutzer den ungefähren Abstand.
//
// Das Ergebnis wird auf ganze cm AUFGERUNDET – lieber etwas zu dick als zu dünn, damit der
// Mengenzähler das Volumen eher über- als unterschätzt.

import { h, fill, openPage, toast } from '../ui.js';

export const REFERENZEN = [
  { id: 'karte', name: 'Bank- oder EC-Karte', mm: 85.6, tipp: 'quer, flach an die Rinde' },
  { id: 'glied', name: 'Zollstock, 1 Glied', mm: 200, tipp: 'ein Glied waagerecht anlegen' },
  { id: 'zoll50', name: 'Zollstock, 50 cm', mm: 500, tipp: 'am genauesten – von 0 bis 50 markieren' },
  { id: 'a4', name: 'DIN-A4-Blatt quer', mm: 297, tipp: 'z. B. mit einer Reißzwecke befestigt' },
  { id: 'eigen', name: 'Eigene Länge', mm: null, tipp: 'Länge in cm eingeben' },
];

/** Durchmesser (cm) aus scheinbarem Durchmesser und Abstand zur Stammvorderseite (beide in cm) */
export function zylinderKorrektur(dsCm, abstandCm) {
  if (!(dsCm > 0)) return 0;
  if (!(abstandCm > 0)) return dsCm;
  const a = abstandCm, d2 = dsCm * dsCm;
  return (d2 + Math.sqrt(d2 * d2 + 4 * a * a * d2)) / (2 * a);
}

/** Abstand Kamera → Referenz (cm) aus 35-mm-Brennweite, Bilddiagonale und Referenzgröße im Bild */
export function abstandAusBrennweite({ f35, diagPx, refPx, refMm }) {
  if (!(f35 > 0 && diagPx > 0 && refPx > 0 && refMm > 0)) return null;
  const fPx = (f35 * diagPx) / Math.hypot(36, 24);
  return (fPx * refMm) / refPx / 10;
}

/** BHD (cm) aus den Messlinien. px-Werte in Original-Bildpunkten. */
export function bhdAusMessung({ refPx, stammPx, refMm, abstandCm }) {
  if (!(refPx > 0 && stammPx > 0 && refMm > 0)) return null;
  const ds = ((stammPx / refPx) * refMm) / 10;
  const d = zylinderKorrektur(ds, abstandCm);
  return { scheinbar: ds, roh: d, bhd: Math.ceil(d - 1e-9) };
}

/** 35-mm-Brennweite (EXIF-Tag 0xA405) aus einem JPEG lesen; null, wenn nicht vorhanden */
export function exifBrennweite35(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    let o = 2;
    while (o + 4 < v.byteLength) {
      const marker = v.getUint16(o), len = v.getUint16(o + 2);
      if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) { // "Exif"
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const u16 = (p) => v.getUint16(t + p, le), u32 = (p) => v.getUint32(t + p, le);
        const tag = (ifd, id) => {
          const n = u16(ifd);
          for (let i = 0; i < n; i++) {
            const e = ifd + 2 + i * 12;
            if (u16(e) === id) return { typ: u16(e + 2), wert: u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8) };
          }
          return null;
        };
        const ifd0 = u32(4);
        const exifPtr = tag(ifd0, 0x8769);
        if (!exifPtr) return null;
        const f = tag(exifPtr.wert, 0xa405);
        return f && f.wert > 0 ? f.wert : null;
      }
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      o += 2 + len;
    }
  } catch { /* kein gültiges EXIF */ }
  return null;
}

/**
 * Messdialog öffnen. Liefert { bhd, roh, abstandCm, abstandQuelle, referenz } oder null (abgebrochen).
 * pruefe(bhd) darf einen Text zurückgeben, der im Ergebnis angezeigt wird (z. B. Klasse und Volumen).
 */
export function bhdMitKamera({ pruefe } = {}) {
  return new Promise((resolve) => {
    let fertig = false;
    const ende = (wert) => { if (fertig) return; fertig = true; seite.close(); resolve(wert); };
    document.querySelectorAll('.mascot-say').forEach((e) => e.remove()); // Sprechblase verdeckt sonst das Foto
    const body = h('div', { class: 'bhdk' });
    const seite = openPage('BHD mit Kamera messen', body, { onClose: () => { if (!fertig) { fertig = true; resolve(null); } } });

    const s = { ref: 'karte', eigenCm: '', bild: null, url: null, f35: null, abstandWahl: 200, linien: null, zoom: 1, panX: 0, panY: 0 };
    let leinwand, ctx;

    const refMm = () => (s.ref === 'eigen' ? Number(String(s.eigenCm).replace(',', '.')) * 10 : REFERENZEN.find((r) => r.id === s.ref).mm);

    function schritt1() {
      const datei = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => laden(e.target.files?.[0]) });
      fill(body,
        h('ol', { class: 'bhdk-anleitung' },
          h('li', {}, 'Referenz in 1,30 m Höhe waagerecht vorn an den Stamm halten oder klemmen.'),
          h('li', {}, 'Etwa 1,5–3 m zurücktreten, Handy auf Brusthöhe und gerade auf den Stamm richten. Beide Stammkanten müssen im Bild sein.'),
          h('li', {}, 'Foto aufnehmen, dann die Kanten von Referenz und Stamm mit den Linien markieren.')),
        h('p', { class: 'sheet-label' }, 'Referenz'),
        h('div', { class: 'q-chips' }, REFERENZEN.map((r) => h('button', { type: 'button', class: `q-option ${s.ref === r.id ? 'on' : ''}`, 'aria-pressed': String(s.ref === r.id), onclick: () => { s.ref = r.id; schritt1(); } }, r.name))),
        h('p', { class: 'muted' }, REFERENZEN.find((r) => r.id === s.ref).tipp + (s.ref !== 'eigen' ? ` (${(REFERENZEN.find((r) => r.id === s.ref).mm / 10).toLocaleString('de-DE')} cm)` : '')),
        s.ref === 'eigen' ? h('label', { class: 'q-own' }, 'Länge der Referenz in cm',
          h('input', { type: 'text', inputmode: 'decimal', value: s.eigenCm, oninput: (e) => { s.eigenCm = e.target.value; } })) : null,
        h('p', { class: 'hint' }, 'Je größer die Referenz, desto genauer. Bei ovalen Stämmen zweimal messen (über Kreuz) und den größeren Wert nehmen.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: () => ende(null) }, 'Abbrechen'),
          h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => { if (!(refMm() > 0)) { toast('Bitte die Länge der Referenz eingeben.'); return; } datei.click(); } }, 'Foto aufnehmen')),
        datei);
    }

    async function laden(file) {
      if (!file) return;
      s.f35 = exifBrennweite35(await file.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (s.url) URL.revokeObjectURL(s.url);
      s.url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { s.bild = img; s.linien = null; s.zoom = 1; s.panX = 0; s.panY = 0; schritt2(); };
      img.onerror = () => toast('Das Foto konnte nicht geöffnet werden.');
      img.src = s.url;
    }

    // Linien in Bildpunkten des Originals: Referenz links/rechts (orange), Stamm links/rechts (grün)
    function startLinien() {
      const w = s.bild.naturalWidth;
      return [{ x: w * 0.42, art: 'ref' }, { x: w * 0.58, art: 'ref' }, { x: w * 0.25, art: 'stamm' }, { x: w * 0.75, art: 'stamm' }];
    }

    function schritt2() {
      s.linien ||= startLinien();
      leinwand = h('canvas', { class: 'bhdk-canvas', 'aria-label': 'Foto mit Messlinien' });
      ctx = leinwand.getContext('2d');
      const ergebnis = h('div', { class: 'bhdk-ergebnis', 'aria-live': 'polite' });
      const abstandBox = h('div', {});
      fill(body,
        h('p', { class: 'muted' }, 'Ziehe die orangen Linien an die Kanten der Referenz und die grünen an die Stammkanten. Mit + vergrößern, mit einem Finger auf dem Bild verschieben.'),
        h('div', { class: 'bhdk-buehne' }, leinwand,
          h('div', { class: 'bhdk-zoom' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Vergrößern', onclick: () => zoomen(2) }, '+'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Verkleinern', onclick: () => zoomen(0.5) }, '−'))),
        h('div', { class: 'bhdk-legende' }, h('span', { class: 'ref' }, 'Referenz'), h('span', { class: 'stamm' }, 'Stamm')),
        abstandBox, ergebnis,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: schritt1 }, 'Neues Foto'),
          h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => { const r = rechnen(); if (r) ende(r); } }, 'Übernehmen')));

      const zeichneAbstand = () => fill(abstandBox, s.f35
        ? h('p', { class: 'muted' }, `Abstand aus den Fotodaten berechnet (${s.f35} mm Brennweite, KB).`)
        : h('div', {}, h('p', { class: 'sheet-label' }, 'Wie weit standest du vom Stamm entfernt?'),
          h('div', { class: 'q-chips' }, [100, 150, 200, 300].map((cm) => h('button', { type: 'button', class: `q-option ${s.abstandWahl === cm ? 'on' : ''}`, onclick: () => { s.abstandWahl = cm; zeichneAbstand(); zeigen(); } }, `${(cm / 100).toLocaleString('de-DE')} m`))),
          h('small', { class: 'muted' }, 'Das Foto enthält keine Brennweite. Im Zweifel den kleineren Abstand wählen – das rechnet eher zu dick als zu dünn.')));
      zeichneAbstand();

      function rechnen() {
        const L = s.linien, refPx = Math.abs(L[1].x - L[0].x), stammPx = Math.abs(L[3].x - L[2].x);
        if (refPx < 15) { fill(ergebnis, h('p', { class: 'warn-line' }, 'Die Referenz ist zu klein markiert. Linien auseinanderziehen oder näher herangehen.')); return null; }
        const abstandCm = s.f35 ? abstandAusBrennweite({ f35: s.f35, diagPx: Math.hypot(s.bild.naturalWidth, s.bild.naturalHeight), refPx, refMm: refMm() }) : s.abstandWahl;
        const r = bhdAusMessung({ refPx, stammPx, refMm: refMm(), abstandCm });
        if (!r) return null;
        return { ...r, abstandCm, abstandQuelle: s.f35 ? 'exif' : 'geschaetzt', referenz: s.ref, refMm: refMm() };
      }
      function zeigen() {
        const r = rechnen();
        if (!r) return;
        const extra = pruefe?.(r.bhd);
        fill(ergebnis,
          h('p', { class: 'bhdk-wert' }, `BHD ≈ ${r.bhd} cm`),
          h('small', { class: 'muted' }, `Scheinbar ${r.scheinbar.toLocaleString('de-DE', { maximumFractionDigits: 1 })} cm, Abstand ${(r.abstandCm / 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} m, Rundung nach oben.`),
          r.abstandCm < 80 || r.abstandCm > 500 ? h('p', { class: 'warn-line' }, 'Der Abstand wirkt unplausibel. Bitte prüfen, ob die Referenz richtig markiert ist.') : null,
          extra ? h('p', {}, extra) : null);
      }

      function groesse() {
        const breite = Math.max(200, body.clientWidth || 360);
        const hoehe = Math.min(window.innerHeight * 0.55, (breite * s.bild.naturalHeight) / s.bild.naturalWidth);
        const dpr = window.devicePixelRatio || 1;
        leinwand.width = breite * dpr; leinwand.height = hoehe * dpr;
        leinwand.style.width = `${breite}px`; leinwand.style.height = `${hoehe}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      // Bild → Bildschirm
      const basis = () => { const b = leinwand.clientWidth, hh = leinwand.clientHeight; return Math.min(b / s.bild.naturalWidth, hh / s.bild.naturalHeight); };
      const skala = () => basis() * s.zoom;
      const ox = () => (leinwand.clientWidth - s.bild.naturalWidth * skala()) / 2 + s.panX;
      const oy = () => (leinwand.clientHeight - s.bild.naturalHeight * skala()) / 2 + s.panY;
      const zuSchirm = (x) => ox() + x * skala();
      const zuBild = (px) => (px - ox()) / skala();
      function zeichnen() {
        const b = leinwand.clientWidth, hh = leinwand.clientHeight;
        ctx.clearRect(0, 0, b, hh);
        ctx.drawImage(s.bild, ox(), oy(), s.bild.naturalWidth * skala(), s.bild.naturalHeight * skala());
        s.linien.forEach((l, i) => {
          const x = zuSchirm(l.x);
          ctx.strokeStyle = l.art === 'ref' ? '#F26B1D' : '#2E9E4F';
          ctx.lineWidth = i === aktiv ? 3 : 2;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hh); ctx.stroke();
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath(); ctx.arc(x, l.art === 'ref' ? hh * 0.35 : hh * 0.65, 11, 0, Math.PI * 2); ctx.fill();
        });
        // Lupe beim Ziehen
        if (aktiv != null && lupe) {
          const r = 46, lx = Math.min(b - r - 4, Math.max(r + 4, lupe.x)), ly = Math.max(r + 4, lupe.y - 90);
          ctx.save(); ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.clip();
          const f = 3, bx = zuBild(lupe.x), by = (lupe.y - oy()) / skala(), sk = skala() * f;
          ctx.drawImage(s.bild, lx - bx * sk, ly - by * sk, s.bild.naturalWidth * sk, s.bild.naturalHeight * sk);
          const lxx = lx + (s.linien[aktiv].x - bx) * sk;
          ctx.strokeStyle = s.linien[aktiv].art === 'ref' ? '#F26B1D' : '#2E9E4F'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(lxx, ly - r); ctx.lineTo(lxx, ly + r); ctx.stroke();
          ctx.restore();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.stroke();
        }
      }
      function zoomen(f) { s.zoom = Math.min(8, Math.max(1, s.zoom * f)); if (s.zoom === 1) { s.panX = 0; s.panY = 0; } zeichnen(); }

      let aktiv = null, lupe = null, ziehStart = null;
      const pos = (e) => { const r = leinwand.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      leinwand.addEventListener('pointerdown', (e) => {
        const p = pos(e);
        let best = null, bd = 28;
        s.linien.forEach((l, i) => { const d = Math.abs(zuSchirm(l.x) - p.x); if (d < bd) { bd = d; best = i; } });
        leinwand.setPointerCapture(e.pointerId);
        if (best != null) { aktiv = best; lupe = p; } else ziehStart = { ...p, panX: s.panX, panY: s.panY };
        zeichnen();
      });
      leinwand.addEventListener('pointermove', (e) => {
        const p = pos(e);
        if (aktiv != null) { s.linien[aktiv].x = Math.min(s.bild.naturalWidth, Math.max(0, zuBild(p.x))); lupe = p; zeichnen(); }
        else if (ziehStart) { s.panX = ziehStart.panX + (p.x - ziehStart.x); s.panY = ziehStart.panY + (p.y - ziehStart.y); zeichnen(); }
      });
      const los = () => { if (aktiv != null) zeigen(); aktiv = null; lupe = null; ziehStart = null; zeichnen(); };
      leinwand.addEventListener('pointerup', los);
      leinwand.addEventListener('pointercancel', los);
      leinwand.style.touchAction = 'none';
      requestAnimationFrame(() => { groesse(); zeichnen(); zeigen(); });
    }

    schritt1();
  });
}
