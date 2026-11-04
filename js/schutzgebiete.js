// Schutzgebiete: Verordnungen als Info, FFH-Prüfung einer Fläche, Brut- und Setzzeit.
import { h, dialog } from './ui.js';
import { gfiUrl, parseFeatures, SCHUTZ, umlaut } from './map/geoinfo.js';
import { generateGrid, polysOf, centroid } from './geo.js';

// Brut- und Setzzeit im Wald (ThüringenForst): 1. März bis 30. Juni
export const BRUTZEIT = { von: [3, 1], bis: [6, 30], text: '1. März bis 30. Juni' };
export function inBrutzeit(ts) {
  const d = new Date(ts); const m = d.getMonth() + 1, t = d.getDate();
  const nach = (a) => m > a[0] || (m === a[0] && t >= a[1]);
  const vor = (b) => m < b[0] || (m === b[0] && t <= b[1]);
  return nach(BRUTZEIT.von) && vor(BRUTZEIT.bis);
}
/** Nächster Tag nach der Brut- und Setzzeit (1. Juli) ab dem Datum */
export function nachBrutzeit(ts = Date.now()) {
  const d = new Date(ts);
  return new Date(d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear(), 6, 1, 9).getTime();
}

const GEBIETS_ART = {
  nsg: 'Naturschutzgebiet', lsg: 'Landschaftsschutzgebiet', ffh_geb: 'FFH-Gebiet', spa: 'Vogelschutzgebiet',
  naturpark: 'Naturpark', nationalpark: 'Nationalpark', biosreserv: 'Biosphärenreservat',
};

/** FFH- (und Vogelschutz-)Gebiete, die eine Fläche berühren – Stichprobe über die Fläche, live */
export async function natura2000InFlaeche(sel, { layers = ['ffh_geb', 'spa'] } = {}) {
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
