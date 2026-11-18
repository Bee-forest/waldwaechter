// Wetter- und Risikowarnungen für die eigene Region: Sturm, Trockenheit und Käferflug-Ampel.
// Daten: Open-Meteo (frei, ohne Schlüssel; Modelle u. a. DWD ICON). Die Käfer-Ampel folgt der Faustregel,
// dass der Buchdrucker ab etwa 16,5 °C Tageshöchsttemperatur schwärmt, verstärkt ab etwa 20 °C.
import { h } from './ui.js';

const CACHE = 'waldwaechter.risiko';
export async function ladeRisiko([lat, lng]) {
  try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c && Date.now() - c.ts < 3 * 3600e3 && Math.abs(c.lat - lat) < 0.05 && Math.abs(c.lng - lng) < 0.05) return c.d; } catch { /* egal */ }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&daily=temperature_2m_max,precipitation_sum,wind_gusts_10m_max&past_days=30&forecast_days=7&timezone=Europe%2FBerlin`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Wetterdienst ${r.status}`);
  const d = (await r.json()).daily;
  try { localStorage.setItem(CACHE, JSON.stringify({ ts: Date.now(), lat, lng, d })); } catch { /* egal */ }
  return d;
}

const tagText = (iso) => new Date(`${iso}T12:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });

/** Bewertung aus den Tageswerten: vergangene 30 Tage und die nächsten 7 */
export function bewerte(d, heute = new Date()) {
  const idx = d.time.findIndex((t) => t >= heute.toISOString().slice(0, 10));
  const i0 = idx < 0 ? d.time.length - 7 : idx;
  const zukunft = d.time.slice(i0).map((t, k) => ({ t, tmax: d.temperature_2m_max[i0 + k], boe: d.wind_gusts_10m_max[i0 + k], regen: d.precipitation_sum[i0 + k] }));
  const regen30 = d.precipitation_sum.slice(Math.max(0, i0 - 30), i0).reduce((s, v) => s + (v || 0), 0);
  const monat = heute.getMonth() + 1;
  // Sturm: Böen ab 75 km/h (Bft 9) Warnung, ab 60 km/h Hinweis
  const sturm = zukunft.reduce((a, x) => (x.boe > (a?.boe || 0) ? x : a), null);
  const sturmStufe = sturm?.boe >= 75 ? 'rot' : sturm?.boe >= 60 ? 'gelb' : 'gruen';
  // Trockenheit (nur April–September): unter 25 mm in 30 Tagen
  const trockenStufe = monat >= 4 && monat <= 9 ? (regen30 < 25 ? 'rot' : regen30 < 50 ? 'gelb' : 'gruen') : 'gruen';
  // Käferflug (April–September)
  const warm = zukunft.filter((x) => x.tmax >= 16.5);
  const heiss = zukunft.filter((x) => x.tmax >= 20);
  const kaeferStufe = monat < 4 || monat > 9 ? 'gruen' : heiss.length >= 2 ? 'rot' : warm.length ? 'gelb' : 'gruen';
  return { zukunft, regen30, monat, sturm, sturmStufe, trockenStufe, kaeferStufe, warm, heiss };
}

const FARBE = { gruen: '#2E7D32', gelb: '#F9A825', rot: '#C62828' };
const zeile = (stufe, titel, text) => h('li', { class: `risiko-${stufe}` }, h('span', { class: 'ampel-punkt', style: `background:${FARBE[stufe]}` }), h('span', {}, h('strong', {}, titel), h('small', {}, text)));

export function risikoInhalt(b) {
  const z = [];
  z.push(zeile(b.sturmStufe, b.sturmStufe === 'rot' ? 'Sturmwarnung' : b.sturmStufe === 'gelb' ? 'Starke Böen möglich' : 'Kein Sturm in Sicht',
    b.sturm ? `Stärkste Böe in den nächsten 7 Tagen: ${Math.round(b.sturm.boe)} km/h am ${tagText(b.sturm.t)}.${b.sturmStufe === 'rot' ? ' Wald meiden, nach dem Sturm Bestände und Wege auf Würfe und Hänger kontrollieren.' : b.sturmStufe === 'gelb' ? ' Bei Arbeiten im Wald auf Totholz in den Kronen achten.' : ''}` : ''));
  if (b.monat >= 4 && b.monat <= 9) {
    z.push(zeile(b.kaeferStufe, b.kaeferStufe === 'rot' ? 'Käferflug: hoch – jetzt Fichten kontrollieren' : b.kaeferStufe === 'gelb' ? 'Käferflug möglich' : 'Käferflug: kaum',
      b.kaeferStufe === 'gruen' ? 'Tageshöchstwerte bleiben unter 16,5 °C – der Buchdrucker fliegt kaum.'
        : `${b.heiss.length || b.warm.length} Tag${(b.heiss.length || b.warm.length) > 1 ? 'e' : ''} mit ${b.kaeferStufe === 'rot' ? 'mindestens 20' : 'über 16,5'} °C in den nächsten 7 Tagen. Fichten auf Bohrmehl am Stammfuß und Harzfluss prüfen, befallene Bäume schnell aufarbeiten und aus dem Wald bringen.`));
    z.push(zeile(b.trockenStufe, b.trockenStufe === 'rot' ? 'Trockenheit' : b.trockenStufe === 'gelb' ? 'Eher trocken' : 'Genug Niederschlag',
      `${Math.round(b.regen30)} mm Regen in den letzten 30 Tagen.${b.trockenStufe !== 'gruen' ? ' Trockenheit schwächt die Bäume und begünstigt Käfer; Kulturen wenn möglich wässern, Waldbrandgefahr beachten.' : ''}`));
  } else {
    z.push(zeile('gruen', 'Käferflug: Winterruhe', 'Von Oktober bis März fliegt der Buchdrucker nicht. Jetzt Fichten auf rote Kronen und abfallende Rinde prüfen – befallene Bäume vor dem Frühjahr aufarbeiten.'));
  }
  return h('ul', { class: 'risiko-liste' }, z);
}
