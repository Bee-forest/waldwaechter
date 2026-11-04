// Schutzgebiete: Verordnungen als Info, FFH-Prüfung einer Fläche, Brut- und Setzzeit.
import { h, dialog } from './ui.js';
import { gfiUrl, parseFeatures, SCHUTZ, umlaut } from './map/geoinfo.js';
import { generateGrid, polysOf, centroid } from './geo.js';

// Brut- und Setzzeit: gesetzlich 1. März bis 30. September (§ 39 Abs. 5 BNatSchG). Weicht die
// Schutzgebietsverordnung ab, wird der Zeitraum je Maßnahme übernommen (thinning.schutzzeit).
export const BRUTZEIT_GESETZ = { von: [3, 1], bis: [9, 30], quelle: '§ 39 Abs. 5 BNatSchG' };
export const BRUTZEIT = { ...BRUTZEIT_GESETZ, text: '1. März bis 30. September' };
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const schutzzeitText = (sz = BRUTZEIT_GESETZ) => `${sz.von[1]}. ${MONATE[sz.von[0] - 1]} bis ${sz.bis[1]}. ${MONATE[sz.bis[0] - 1]}`;
export const schutzzeitVon = (m) => m?.thinning?.schutzzeit || m?.schutzzeit || BRUTZEIT_GESETZ;
export function inBrutzeit(ts, sz = BRUTZEIT_GESETZ) {
  const d = new Date(ts); const m = d.getMonth() + 1, t = d.getDate();
  const nach = (a) => m > a[0] || (m === a[0] && t >= a[1]);
  const vor = (b) => m < b[0] || (m === b[0] && t <= b[1]);
  return nach(sz.von) && vor(sz.bis);
}
/** Erster Tag nach der Schutzzeit (bei Termin in der Schutzzeit im selben Jahr) */
export function nachBrutzeit(ts = Date.now(), sz = BRUTZEIT_GESETZ) {
  const d = new Date(ts);
  let n = new Date(d.getFullYear(), sz.bis[0] - 1, sz.bis[1] + 1, 9);
  if (n.getTime() < ts) n = new Date(d.getFullYear() + 1, sz.bis[0] - 1, sz.bis[1] + 1, 9);
  return n.getTime();
}
export const datumText = (ts) => new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

const GEBIETS_ART = {
  nsg: 'Naturschutzgebiet', lsg: 'Landschaftsschutzgebiet', ffh_geb: 'FFH-Gebiet', spa: 'Vogelschutzgebiet',
  naturpark: 'Naturpark', nationalpark: 'Nationalpark', biosreserv: 'Biosphärenreservat',
};

/** FFH-, Vogelschutz- und Naturschutzgebiete, die eine Fläche berühren – Stichprobe über die Fläche, live */
export async function natura2000InFlaeche(sel, { layers = ['ffh_geb', 'spa', 'nsg'] } = {}) {
  const polys = polysOf(sel);
  const pts = [centroid(sel.ring), ...generateGrid(sel.ring, 60, { polys }).filter((_, i) => i % 2 === 0).slice(0, 8)];
  const found = new Map();
  await Promise.all(layers.flatMap((layer) => pts.map(async (pt) => {
    try {
      const res = await fetch(gfiUrl(SCHUTZ, layer, pt), { mode: 'cors' });
      if (!res.ok) return;
      for (const f of parseFeatures(await res.text())) {
        const name = umlaut(f.siteName || f.name || f.NAME || '');
        const key = `${layer}|${name || f.localId || ''}`;
        if (!found.has(key)) found.set(key, { layer, art: GEBIETS_ART[layer], name, code: gebietsCode(f), props: f });
      }
    } catch { /* Punkt nicht abfragbar */ }
  })));
  return [...found.values()];
}

export function gebietsCode(props = {}) {
  for (const v of Object.values(props)) { const m = String(v).match(/\bDE[ _-]?(\d{4})[ _-]?(\d{3})\b/); if (m) return `DE${m[1]}${m[2]}`; }
  return null;
}

/** Info-Dialog zur Schutzgebietsverordnung */
export function zeigeVerordnung(x) {
  const name = x.props?.siteName ? umlaut(x.props.siteName) : x.label;
  const vo = x.props?.legalFoundationDocument ? umlaut(x.props.legalFoundationDocument) : null;
  const datum = x.props?.legalFoundationDate || null;
  const natura = x.layer === 'ffh_geb' || x.layer === 'spa';
  const code = gebietsCode(x.props);
  const suche = (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
  const links = [];
  if (natura) {
    links.push(['Thüringer Natura 2000-Erhaltungsziele-Verordnung (ThürNat2000ErhZVO)', 'https://umwelt-online.de/recht/natursch/laender/th/natura.htm']);
    if (code) links.push([`Standarddatenbogen ${code} (Europäische Umweltagentur)`, `https://natura2000.eea.europa.eu/Natura2000/SDF.aspx?site=${code}`]);
    links.push(['Managementplan (Fachbeitrag Wald) suchen', suche(`${name} FFH Managementplan Fachbeitrag Wald Thüringen`)]);
  } else {
    links.push(['Verordnung im Internet suchen', suche(`${vo || ''} ${x.label} ${name} Verordnung Thüringen`.trim())]);
  }
  dialog({
    title: `${x.label}: ${name}`,
    body: h('div', { class: 'legend-box' },
      h('p', {}, x.text),
      vo ? h('p', {}, h('strong', {}, 'Rechtsgrundlage: '), vo, datum ? ` (${datum})` : '') : null,
      natura ? h('p', {}, 'Für Natura 2000-Gebiete gelten die Erhaltungsziele der ThürNat2000ErhZVO und der Managementplan. Maßnahmen, die das Gebiet erheblich beeinträchtigen könnten, brauchen eine Verträglichkeitsprüfung (§ 34 BNatSchG).') : null,
      h('ul', { class: 'link-list' }, links.map(([t, u]) => h('li', {}, h('a', { href: u, target: '_blank', rel: 'noopener' }, t)))),
      h('p', { class: 'hint' }, 'Verbindlich ist der Text der Verordnung. Im Zweifel bei der Unteren Naturschutzbehörde des Landkreises oder beim Forstamt nachfragen.'),
    ),
    actions: [{ label: 'Schließen', value: true, primary: true }],
  });
}
