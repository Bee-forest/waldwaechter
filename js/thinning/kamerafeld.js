// Eingebettetes Kamerafeld für die Advanced-Zählweise: Livebild direkt am Rasterpunkt,
// Auslösen → Linien an Referenz und Stamm ziehen → BHD, Klasse und Volumen stehen sofort darunter → „Baum zählen“.
// Rechnung wie bei der Fotomessung (bhdkamera.js): Referenzverfahren mit Zylinderkorrektur, Aufrunden auf ganze cm.

import { h, fill, toast } from '../ui.js';
import { REFERENZEN, bhdAusMessung, abstandAusBrennweite, exifBrennweite35 } from './bhdkamera.js';

const SPEICHER = 'waldwaechter.bhdk';
const einst = (() => { try { return { ref: 'karte', eigenCm: '', abstand: 200, ...JSON.parse(localStorage.getItem(SPEICHER) || '{}') }; } catch { return { ref: 'karte', eigenCm: '', abstand: 200 }; } })();
const merken = () => { try { localStorage.setItem(SPEICHER, JSON.stringify(einst)); } catch { /* privat */ } };
const refMm = () => (einst.ref === 'eigen' ? Number(String(einst.eigenCm).replace(',', '.')) * 10 : REFERENZEN.find((r) => r.id === einst.ref)?.mm);

let strom = null;          // MediaStream bleibt zwischen zwei Bäumen offen (keine neue Freigabe nötig)
let aufnahme = null;       // { bild, w, hh, f35, linien } – eingefrorenes Bild, bis gezählt oder verworfen

/** Kamera ausschalten (beim Verlassen des Punkts) */
export function stopKamera() {
  strom?.getTracks().forEach((t) => t.stop());
  strom = null;
  aufnahme = null;
}

const startLinien = (w) => [{ x: w * 0.45, art: 'ref' }, { x: w * 0.55, art: 'ref' }, { x: w * 0.3, art: 'stamm' }, { x: w * 0.7, art: 'stamm' }];

/**
 * Kamerafeld erzeugen.
 * bewerte(bhd) → { text, ok }   Zuordnung (Klasse, Volumen) und ob der Baum passt
 * zaehlen(messung)               zählt den Baum (danach rendert der Aufrufer neu)
 */
export function kameraFeld({ bewerte, zaehlen }) {
  const el = h('div', { class: 'kfeld' });
  const datei = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => vonDatei(e.target.files?.[0]) });

  function zeigen() { aufnahme ? messen() : live(); }

  async function live() {
    const video = h('video', { class: 'kfeld-bild', autoplay: true, muted: true, playsinline: true, 'aria-label': 'Kamerabild' });
    video.setAttribute('playsinline', ''); video.muted = true;
    const status = h('p', { class: 'kfeld-status' }, 'Kamera wird gestartet …');
    fill(el,
      h('div', { class: 'kfeld-buehne' }, video,
        h('div', { class: 'kfeld-hilfe' }, 'Referenz in 1,30 m vorn an den Stamm, ganzer Stamm im Bild'),
        h('button', { type: 'button', class: 'kfeld-ausloeser', 'aria-label': 'Foto aufnehmen', onclick: () => einfrieren(video) })),
      status, einstellungen(), datei);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('keine Kamera');
      strom ||= await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = strom;
      await video.play().catch(() => {});
      status.textContent = 'Stamm mittig ins Bild, dann den runden Knopf antippen.';
    } catch {
      fill(status, 'Kein Livebild möglich. ', h('button', { type: 'button', class: 'link-btn', onclick: () => datei.click() }, 'Foto mit der Kamera-App aufnehmen'));
    }
  }

  function einfrieren(video) {
    const w = video.videoWidth, hh = video.videoHeight;
    if (!w) { toast('Die Kamera liefert noch kein Bild.'); return; }
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    c.getContext('2d').drawImage(video, 0, 0, w, hh);
    aufnahme = { bild: c, w, hh, f35: null, linien: startLinien(w) };
    messen();
  }
  async function vonDatei(file) {
    if (!file) return;
    const f35 = exifBrennweite35(await file.arrayBuffer().catch(() => new ArrayBuffer(0)));
    const img = new Image();
    img.onload = () => { aufnahme = { bild: img, w: img.naturalWidth, hh: img.naturalHeight, f35, linien: startLinien(img.naturalWidth) }; messen(); };
    img.src = URL.createObjectURL(file);
  }

  function rechnen() {
    const L = aufnahme.linien, refPx = Math.abs(L[1].x - L[0].x), stammPx = Math.abs(L[3].x - L[2].x);
    if (!(refMm() > 0)) return { fehler: 'Bitte die Länge der Referenz eingeben.' };
    if (refPx < 12) return { fehler: 'Referenz zu klein markiert – orange Linien an ihre Kanten ziehen.' };
    const abstandCm = aufnahme.f35 ? abstandAusBrennweite({ f35: aufnahme.f35, diagPx: Math.hypot(aufnahme.w, aufnahme.hh), refPx, refMm: refMm() }) : einst.abstand;
    const r = bhdAusMessung({ refPx, stammPx, refMm: refMm(), abstandCm });
    return r ? { ...r, abstandCm, abstandQuelle: aufnahme.f35 ? 'exif' : 'geschaetzt', referenz: einst.ref } : { fehler: 'Bitte die Linien setzen.' };
  }

  function messen() {
    const leinwand = h('canvas', { class: 'kfeld-bild', 'aria-label': 'Foto mit Messlinien' });
    const ctx = leinwand.getContext('2d');
    const zeile = h('div', { class: 'kfeld-ergebnis', 'aria-live': 'polite' });
    const zaehlBtn = h('button', { type: 'button', class: 'btn btn-primary btn-large kfeld-zaehlen' }, 'Baum zählen');
    let zoom = 1, panX = 0, panY = 0, aktiv = null, lupe = null, zieh = null;
    fill(el,
      h('div', { class: 'kfeld-buehne' }, leinwand,
        h('div', { class: 'kfeld-zoom' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Vergrößern', onclick: () => zoomen(2) }, '+'),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Verkleinern', onclick: () => zoomen(0.5) }, '−'))),
      zeile,
      h('div', { class: 'kfeld-knoepfe' },
        h('button', { type: 'button', class: 'btn', onclick: () => { aufnahme = null; live(); } }, 'Neu aufnehmen'),
        zaehlBtn),
      einstellungen(() => auswerten()), datei);

    function auswerten() {
      const r = rechnen();
      if (r.fehler) { fill(zeile, h('span', { class: 'warn-line' }, r.fehler)); zaehlBtn.disabled = true; return; }
      const b = bewerte(r.bhd);
      fill(zeile, h('strong', { class: 'kfeld-wert' }, `BHD ${r.bhd} cm`), h('span', {}, ` → ${b.text}`),
        r.abstandCm < 80 || r.abstandCm > 500 ? h('small', { class: 'warn-line' }, ' Abstand unplausibel – Referenz prüfen') : null);
      zaehlBtn.disabled = !b.ok;
      zaehlBtn.onclick = () => { const m = rechnen(); if (m.fehler) return; aufnahme = null; zaehlen(m); };
    }

    const W = aufnahme.w, H = aufnahme.hh;
    function groesse() {
      const b = Math.max(200, el.clientWidth || 340), hh = Math.min(Math.round(window.innerHeight * 0.38), Math.round((b * H) / W));
      const dpr = window.devicePixelRatio || 1;
      leinwand.width = b * dpr; leinwand.height = hh * dpr; leinwand.style.width = `${b}px`; leinwand.style.height = `${hh}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const sk = () => Math.min(leinwand.clientWidth / W, leinwand.clientHeight / H) * zoom;
    const ox = () => (leinwand.clientWidth - W * sk()) / 2 + panX;
    const oy = () => (leinwand.clientHeight - H * sk()) / 2 + panY;
    const zuSchirm = (x) => ox() + x * sk();
    const zuBild = (px) => (px - ox()) / sk();
    function zeichnen() {
      const b = leinwand.clientWidth, hh = leinwand.clientHeight;
      ctx.clearRect(0, 0, b, hh);
      ctx.drawImage(aufnahme.bild, ox(), oy(), W * sk(), H * sk());
      aufnahme.linien.forEach((l, i) => {
        const x = zuSchirm(l.x);
        ctx.strokeStyle = ctx.fillStyle = l.art === 'ref' ? '#F26B1D' : '#2E9E4F';
        ctx.lineWidth = i === aktiv ? 3 : 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hh); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, l.art === 'ref' ? hh * 0.3 : hh * 0.72, 10, 0, Math.PI * 2); ctx.fill();
      });
      if (aktiv != null && lupe) {
        const r = 40, lx = Math.min(b - r - 4, Math.max(r + 4, lupe.x)), ly = Math.max(r + 4, lupe.y - 80);
        const f = 3, bx = zuBild(lupe.x), by = (lupe.y - oy()) / sk(), s3 = sk() * f;
        ctx.save(); ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(aufnahme.bild, lx - bx * s3, ly - by * s3, W * s3, H * s3);
        const lxx = lx + (aufnahme.linien[aktiv].x - bx) * s3;
        ctx.strokeStyle = aufnahme.linien[aktiv].art === 'ref' ? '#F26B1D' : '#2E9E4F'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(lxx, ly - r); ctx.lineTo(lxx, ly + r); ctx.stroke(); ctx.restore();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.stroke();
      }
    }
    function zoomen(f) { zoom = Math.min(8, Math.max(1, zoom * f)); if (zoom === 1) { panX = 0; panY = 0; } zeichnen(); }
    const pos = (e) => { const r = leinwand.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    leinwand.addEventListener('pointerdown', (e) => {
      const p = pos(e); let best = null, bd = 26;
      aufnahme.linien.forEach((l, i) => { const d = Math.abs(zuSchirm(l.x) - p.x); if (d < bd) { bd = d; best = i; } });
      leinwand.setPointerCapture(e.pointerId);
      if (best != null) { aktiv = best; lupe = p; } else zieh = { ...p, panX, panY };
      zeichnen();
    });
    leinwand.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (aktiv != null) { aufnahme.linien[aktiv].x = Math.min(W, Math.max(0, zuBild(p.x))); lupe = p; zeichnen(); auswerten(); }
      else if (zieh) { panX = zieh.panX + (p.x - zieh.x); panY = zieh.panY + (p.y - zieh.y); zeichnen(); }
    });
    const los = () => { aktiv = null; lupe = null; zieh = null; zeichnen(); };
    leinwand.addEventListener('pointerup', los); leinwand.addEventListener('pointercancel', los);
    requestAnimationFrame(() => { groesse(); zeichnen(); auswerten(); });
  }

  /** Kompakte Einstellungen in einer Zeile: Referenz und (ohne Fotodaten) Abstand – werden gemerkt */
  function einstellungen(nachAenderung) {
    const ohneExif = !aufnahme?.f35;
    return h('div', { class: 'kfeld-einst' },
      h('label', {}, 'Referenz ',
        h('select', { onchange: (e) => { einst.ref = e.target.value; merken(); if (einst.ref === 'eigen') zeigen(); else nachAenderung?.(); } },
          REFERENZEN.map((r) => h('option', { value: r.id, selected: einst.ref === r.id }, r.mm ? `${r.name} (${(r.mm / 10).toLocaleString('de-DE')} cm)` : r.name)))),
      einst.ref === 'eigen' ? h('label', {}, 'Länge ', h('input', { type: 'text', inputmode: 'decimal', size: 4, value: einst.eigenCm, placeholder: 'cm', oninput: (e) => { einst.eigenCm = e.target.value; merken(); nachAenderung?.(); } }), ' cm') : null,
      ohneExif ? h('label', {}, 'Abstand ',
        h('select', { onchange: (e) => { einst.abstand = Number(e.target.value); merken(); nachAenderung?.(); } },
          [100, 150, 200, 300].map((cm) => h('option', { value: cm, selected: einst.abstand === cm }, `${(cm / 100).toLocaleString('de-DE')} m`)))) : h('small', { class: 'muted' }, 'Abstand aus den Fotodaten'));
  }

  zeigen();
  return el;
}
