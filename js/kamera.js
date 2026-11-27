// Kamera mit Kompass für Fotopunkte: zeigt, wie weit man sich drehen muss (und wie weit es noch
// bis zum Fotopunkt ist). Stimmen Richtung (± 6°) und Standort, wird die Anzeige grün.
// Auf Wunsch wird das letzte Foto halbdurchsichtig eingeblendet, damit der Bildausschnitt passt.
import { h, toast } from './ui.js';
import { distance, bearing } from './geo.js';

const TOL_GRAD = 6;
const richtungName = (g) => ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(((g % 360) + 360) % 360 / 45) % 8];
const diff = (a, b) => ((b - a + 540) % 360) - 180; // −180…180: wie weit von a nach b drehen

// Richtung der Rückkamera aus der Lage des Handys (W3C-Formel, gilt auch bei aufrecht gehaltenem Handy)
function kameraRichtung(alpha, beta, gamma) {
  const d = Math.PI / 180, x = beta * d, y = gamma * d, z = alpha * d;
  const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z), sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
  const Vx = -cZ * sY - sZ * sX * cY, Vy = -sZ * sY + cZ * sX * cY;
  let hd = Math.atan(Vx / Vy);
  if (Vy < 0) hd += Math.PI; else if (Vx < 0) hd += 2 * Math.PI;
  return (hd * 180) / Math.PI;
}

/** Erlaubnis für den Kompass (iOS) – muss direkt aus einem Tipp heraus aufgerufen werden */
export async function kompassErlauben() {
  try { if (typeof DeviceOrientationEvent?.requestPermission === 'function') return (await DeviceOrientationEvent.requestPermission()) === 'granted'; } catch { return false; }
  return true;
}
export const kameraMoeglich = () => !!navigator.mediaDevices?.getUserMedia;

/**
 * Öffnet die Kamera bildschirmfüllend. Ergebnis: Foto als File, oder null bei Abbruch.
 * @param {{ blick?: number, at?: [number, number], name?: string, geist?: Blob|null }} ziel
 */
export function kompassKamera({ blick = null, at = null, name = 'Fotopunkt', geist = null } = {}) {
  return new Promise(async (fertig) => {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false }); }
    catch { toast('Kamera nicht verfügbar – Zugriff erlauben oder „Aus Galerie“ nutzen.'); fertig(null); return; }
    const video = h('video', { class: 'kk-video', autoplay: true, muted: true, playsinline: true });
    video.srcObject = stream;
    const geistUrl = geist ? URL.createObjectURL(geist) : null;
    const geistImg = geistUrl ? h('img', { class: 'kk-geist', src: geistUrl, alt: '' }) : null;
    let geistAn = !!geistImg;
    const pfeil = h('div', { class: 'kk-pfeil', 'aria-hidden': 'true' });
    const text = h('div', { class: 'kk-text', 'aria-live': 'polite' }, blick == null ? 'Keine Blickrichtung hinterlegt' : 'Kompass wird gestartet …');
    const ortText = h('div', { class: 'kk-ort' });
    const band = h('div', { class: 'kk-band' }, h('div', { class: 'kk-band-skala' }), h('div', { class: 'kk-band-ziel' }), h('div', { class: 'kk-band-mitte' }));
    const ausloeser = h('button', { type: 'button', class: 'kk-ausloeser', 'aria-label': 'Foto aufnehmen' });
    const schliessen = h('button', { type: 'button', class: 'kk-zu', 'aria-label': 'Kamera schließen' }, '✕');
    const geistKnopf = geistImg ? h('button', { type: 'button', class: 'kk-geist-knopf', 'aria-pressed': 'true' }, 'Letztes Foto') : null;
    const el = h('div', { class: 'kk', role: 'dialog', 'aria-label': `Kamera – ${name}` },
      video, geistImg, h('div', { class: 'kk-oben' }, schliessen, h('div', { class: 'kk-titel' }, name), geistKnopf),
      h('div', { class: 'kk-hud' }, pfeil, text, blick != null ? band : null, ortText),
      h('div', { class: 'kk-unten' }, ausloeser));
    document.body.append(el);
    document.body.classList.add('kk-offen');

    // Kompass
    let richtung = null, letzteZeit = 0, ok = false, gpsOk = at == null;
    const glatt = (neu) => { if (richtung == null) return neu; return (richtung + diff(richtung, neu) * 0.25 + 360) % 360; };
    const aufLage = (e) => {
      let hd = null;
      if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) hd = e.webkitCompassHeading; // iOS
      else if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha != null) hd = kameraRichtung(e.alpha, e.beta || 0, e.gamma || 0);
      if (hd == null) return;
      const winkel = screen.orientation?.angle || window.orientation || 0;
      richtung = glatt((hd + winkel + 360) % 360); letzteZeit = Date.now();
      zeige();
    };
    // iOS liefert webkitCompassHeading über „deviceorientation“, Android die Nordausrichtung über „deviceorientationabsolute“
    const EV = ['deviceorientationabsolute', 'deviceorientation'];
    EV.forEach((n) => window.addEventListener(n, aufLage, true));
    const ohneKompass = setTimeout(() => { if (richtung == null && blick != null) { text.textContent = `Kein Kompass verfügbar – Richtung ${Math.round(blick)}° (${richtungName(blick)}) nach Gefühl`; } }, 2500);

    // GPS: wie weit noch bis zum Fotopunkt?
    let wid = null;
    if (at && navigator.geolocation) {
      wid = navigator.geolocation.watchPosition((p) => {
        const hier = [p.coords.latitude, p.coords.longitude], acc = p.coords.accuracy || 0;
        const m = distance(hier, at);
        gpsOk = m <= Math.max(5, Math.min(acc, 15));
        ortText.textContent = gpsOk ? `Am Fotopunkt (± ${Math.round(acc)} m)` : `Noch ${Math.round(m)} m bis zum Fotopunkt – Richtung ${richtungName(bearing(hier, at))}`;
        ortText.classList.toggle('gut', gpsOk);
        zeige();
      }, () => { ortText.textContent = ''; gpsOk = true; }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    }

    function zeige() {
      if (blick == null) { ok = gpsOk; el.classList.toggle('kk-gut', ok); return; }
      if (richtung == null) return;
      const d = diff(richtung, blick);
      const richtungOk = Math.abs(d) <= TOL_GRAD;
      ok = richtungOk && gpsOk;
      pfeil.style.transform = `rotate(${d}deg)`;
      text.textContent = richtungOk ? `Richtung stimmt (${Math.round(blick)}° ${richtungName(blick)})${gpsOk ? ' – jetzt auslösen' : ''}` : `${Math.abs(Math.round(d))}° nach ${d > 0 ? 'rechts' : 'links'} drehen`;
      band.style.setProperty('--versatz', `${Math.max(-90, Math.min(90, d))}`);
      el.classList.toggle('kk-gut', ok);
      el.classList.toggle('kk-richtung-gut', richtungOk);
    }

    function ende(datei) {
      window.removeEventListener('popstate', zurueck);
      clearTimeout(ohneKompass);
      EV.forEach((n) => window.removeEventListener(n, aufLage, true));
      if (wid != null) navigator.geolocation.clearWatch(wid);
      stream.getTracks().forEach((t) => t.stop());
      if (geistUrl) URL.revokeObjectURL(geistUrl);
      el.remove(); document.body.classList.remove('kk-offen');
      fertig(datei);
    }
    schliessen.onclick = () => ende(null);
    if (geistKnopf) geistKnopf.onclick = () => { geistAn = !geistAn; geistImg.hidden = !geistAn; geistKnopf.setAttribute('aria-pressed', String(geistAn)); };
    ausloeser.onclick = async () => {
      if (!video.videoWidth) return;
      if (blick != null && richtung != null && !ok) toast('Noch nicht ganz ausgerichtet – Foto trotzdem aufgenommen.');
      const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      ende(new File([blob], `fotopunkt-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
    };
    // Zurück-Taste schließt die Kamera
    function zurueck() { ende(null); }
    window.addEventListener('popstate', zurueck);
  });
}
