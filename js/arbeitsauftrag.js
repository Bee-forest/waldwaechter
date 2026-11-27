// Arbeitsauftrag nach der Vorlage „Arbeitsauftrag“ (Auftraggeber/-nehmer, Arbeitsvorhaben, Fläche,
// Naturschutz, Notfall, Arbeitssicherheit, Abrechnung, Unterschriften) – im WaldWächter-Design.
// Die App füllt vor, was sie weiß; der Rest lässt sich vor dem Erstellen ergänzen und wird an der
// Maßnahme gespeichert (m.auftrag). Seite 1: ausgefülltes Formular, ab Seite 2: Karte und Arbeitsanweisung.
import { h, fill, openPage, toast } from './ui.js';
import { store } from './store.js';
import { source } from './data/source.js';
import { flaecheVon } from './flaeche.js';
import { polysOf, centroid, formatHa } from './geo.js';
import { amtlicheFlaecheHa } from './map/thueringen.js';
import { breite } from './pdf.js';

const GRUEN = [31, 77, 58], GRUEN_HELL = [226, 237, 230], LINIE = [196, 202, 194], TEXT = [27, 42, 33], GRAU = [110, 120, 112], ROT = [185, 58, 46];
const HOLZ = ['holzernte_df', 'holzernte_bs', 'durchforstung', 'verkehrssicherung'];
const ABRECHNUNG = ['Waldmaß', 'Werksmaß', 'Fläche (ha)', 'Stückzahl', 'Laufmeter', 'Stunden', 'Pauschal'];
const NATUR = [['keine', 'keine'], ['ffh', 'FFH'], ['spa', 'SPA'], ['nsg', 'NSG'], ['biotop', 'Biotope nach WBK'], ['lrt', 'LRT'], ['denkmal', 'Boden- und Kulturdenkmale'], ['arten', 'Geschützte Arten, Fortpflanzungs-/Ruhestätten']];
const ERSCH = [['grob', 'Groberschließung'], ['fein', 'Feinerschließung'], ['keine', 'keine Erschließung vorhanden'], ['vorgeschaedigt', 'Rückegassen vorgeschädigt']];
const MARK = [['grenzen', 'Flurstücksgrenzen'], ['ernteholz', 'Ernteholz'], ['gassen', 'Gassen']];
const kurzKoord = (ll) => `${ll[0].toFixed(5)} N, ${ll[1].toFixed(5)} O`;
const datum = (t) => (t ? new Date(t).toLocaleDateString('de-DE') : '');

/** Was die App über Fläche und Umgebung weiß (Karte, Rettungspunkte, Zuständigkeit) – live, nichts davon wird gespeichert */
export async function umfeld(m) {
  const s = store.get();
  const all = await source.allParcels();
  const p = all.find((x) => x.id === m.parcelId) || m.flurstueck || null;
  const fl = flaecheVon(m, p);
  const polys = fl?.polys?.length ? fl.polys : p ? polysOf(p) : [];
  const mitte = polys.length ? centroid(polys[0][0]) : m.schaden?.pos || null;
  const E = s.erschliessung || { gassen: [], lager: [] };
  const nahe = (ll, r) => mitte && Math.abs(ll[0] - mitte[0]) < r && Math.abs(ll[1] - mitte[1]) < r * 1.6;
  const gassen = (E.gassen || []).filter((g) => g.line?.some((ll) => nahe(ll, 0.012)));
  const lager = (E.lager || []).filter((l) => l.at && nahe(l.at, 0.015));
  const mitZeit = (pr, ms) => Promise.race([pr, new Promise((r) => setTimeout(() => r(null), ms))]);
  let rett = [], info = null, rl = null;
  if (mitte) {
    const [{ nearestRescue }, geo, profi] = await Promise.all([import('./map/thueringen.js'), import('./map/geoinfo.js'), import('./profi.js')]);
    [rett, info] = await Promise.all([
      nearestRescue ? mitZeit(nearestRescue(mitte, 2).catch(() => []), 8000).then((x) => x || []) : [],
      mitZeit(geo.queryPoint(mitte).catch(() => null), 8000),
    ]);
    if (info?.zustaendig) rl = profi.revierleiterVon(await profi.ladeRevierleiter(), info.zustaendig);
  }
  return { p, fl, polys, mitte, gassen, lager, rett, info, rl };
}

// Gefährdungen und Schutzmaßnahmen je Maßnahmenart (Vorschlag, frei änderbar)
const SICHER = {
  holz: ['Fällarbeiten: Hänger, Totholz und Dürrständer, Kronenbruch; Rückeverkehr und Seilarbeit', 'Fallbereich (2 Baumlängen) freihalten, Wege absperren und beschildern, Sicht- oder Rufkontakt, nicht allein mit der Motorsäge, PSA mit Schnittschutz'],
  pflege: ['Motorsäge bzw. Freischneider, Rückschlag, Lärm; Arbeiten in dichtem Bewuchs', 'Abstand zu anderen Personen (mind. 15 m beim Freischneider), PSA mit Schnittschutz und Gesichtsschutz, Pausen einhalten'],
  pflanzung: ['Hanglage, Stolpergefahr auf der Fläche, Werkzeug (Hohlspaten, Pflanzhaue)', 'Festes Schuhwerk, Handschuhe, Abstand beim Arbeiten mit der Pflanzhaue'],
  zaun: ['Spanndraht unter Zug, Werkzeug (Pfahlramme, Akkuschrauber), Hanglage', 'Schutzbrille und Handschuhe, Draht nur mit geeignetem Spanngerät spannen, Pfahlramme mit Gehörschutz'],
  maschine: ['Maschineneinsatz (Bagger, Forstmulcher): Steinschlag, wegfliegende Teile, Rückwärtsfahren', 'Gefahrenbereich (mind. 50 m beim Mulcher) absperren, nur nach Sichtkontakt nähern, Fahrer meldet Pausen'],
};
const SICHER_TYP = { holzernte_df: 'holz', holzernte_bs: 'holz', durchforstung: 'holz', verkehrssicherung: 'holz', pflege: 'pflege', pflanzung: 'pflanzung', saat: 'pflanzung', einzelschutz: 'pflanzung', zaunbau: 'zaun', raeumung: 'maschine', mulchen: 'maschine', bodenverwundung: 'maschine' };

/** Vorschlag für alle Felder aus Maßnahme, Profil, früheren Aufträgen und Umfeld */
export async function vorschlag(m, u) {
  const s = store.get();
  const { MEASURE_TYPES } = await import('./measures.js');
  const T = MEASURE_TYPES[m.type];
  const pr = s.profile || {};
  const d = m.details || {};
  const holz = HOLZ.includes(m.type);
  const az = m.auszeichnung;
  const { auszeichnungZeilen } = await import('./auszeichnen.js');
  const azZ = Object.fromEntries(auszeichnungZeilen(az));
  const zahl = (x) => String(x).replace('.', ',');
  // Auftraggeber: Profil, dazu Anschrift aus dem letzten Arbeitsauftrag oder Förderantrag
  const fa = [...(s.foerderantraege || [])].reverse().find((x) => x.daten?.strasse || x.daten?.telefon)?.daten || {};
  const agAlt = s.settings?.auftraggeber || {};
  const ag = { name: agAlt.name || pr.name || fa.name || '', adresse: agAlt.adresse || [fa.strasse, fa.ort].filter(Boolean).join(', '), tel: agAlt.tel || fa.telefon || '' };
  // Auftragnehmer: der zuletzt beauftragte
  const an = { name: '', adresse: '', tel: '', ...(s.settings?.auftragnehmer?.[0] || {}) };
  // Mandant/in: Eigentümer des Flurstücks (Profimodus), wenn es nicht der Auftraggeber ist
  let mandant = { name: '', adresse: '' };
  try {
    const { eigentuemerVon, istProfi } = await import('./profi.js');
    const e = istProfi() && u.p ? eigentuemerVon(u.p) : null;
    const n = e ? (e.waldbesitzer || [e.vorname, e.nachname].filter(Boolean).join(' ')) : '';
    if (n && n !== ag.name) mandant = { name: n, adresse: [[e.strasse, e.hausnummer].filter(Boolean).join(' '), [e.plz, e.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') };
  } catch { /* ohne Profimodus */ }
  // Menge, Verfahren, Preis, Abrechnung je Maßnahmenart
  const flHa = u.fl?.ha || (u.p ? amtlicheFlaecheHa(u.p) : 0);
  const haText = d.area ? `${d.area} ha` : flHa ? formatHa(flHa) : '';
  let menge = haText, abrechnung = flHa || d.area ? 'Fläche (ha)' : '', preis = '';
  if (holz) {
    const fm = az?.ergebnis?.gesamt ?? (d.menge ? Number(String(d.menge).replace(',', '.')) : null);
    const n = az?.baeume?.length || d.baeume;
    menge = fm ? `${zahl(Number(fm).toFixed(1))} Fm${n ? ` (${n} Bäume)` : ''}${haText ? ` auf ${haText}` : ''}` : haText;
    abrechnung = 'Waldmaß';
    if (s.settings?.ernteKosten) preis = `${s.settings.ernteKosten} €/fm`;
  } else if (['pflanzung', 'einzelschutz'].includes(m.type) && d.count) {
    menge = `${d.count} Stück${d.species ? ` ${d.species}` : ''}${haText ? ` auf ${haText}` : ''}`; abrechnung = 'Stückzahl';
    if (m.type === 'einzelschutz' && d.preis) preis = `${d.preis} €/Stück`;
  } else if (m.type === 'zaunbau' && d.length) {
    menge = `${d.length} lfm${d.tore ? `, Tore: ${d.tore}` : ''}`; abrechnung = 'Laufmeter';
  } else if (m.type === 'sonstiges' && d.amount) menge = d.amount;
  if (!preis && m.kosten && !holz) {
    const ha = Number(String(d.area || '').replace(',', '.')) || flHa;
    preis = abrechnung === 'Fläche (ha)' && ha ? `ca. ${Math.round(m.kosten / ha)} €/ha (Kalkulation)` : abrechnung === 'Stückzahl' && d.count ? `ca. ${zahl((m.kosten / Number(d.count)).toFixed(2))} €/Stück (Kalkulation)` : abrechnung === 'Laufmeter' && d.length ? `ca. ${zahl((m.kosten / Number(d.length)).toFixed(2))} €/lfm (Kalkulation)` : '';
  }
  const verfahren = [d.verfahren || d.technik || (m.type === 'einzelschutz' ? d.art : '') || m.pflege?.vorgehen || d.vorgehen || (m.thinning?.plan ? (m.thinning.plan.methode === 'f4' ? 'Durchforstung nach Durchforstungshilfe' : 'Z-Baum-Durchforstung') : ''),
    m.type === 'pflanzung' && d.verband ? `Verband ${d.verband}` : '', m.type === 'zaunbau' && d.zaun ? d.zaun : '', m.type === 'mulchen' && d.streifenbreite ? `Streifen ${d.streifenbreite} m, Abstand ${d.abstand || '?'} m` : '',
    m.type === 'raeumung' && d.material ? d.material : '', m.type === 'bodenverwundung' && d.anteil ? `${d.anteil} % der Fläche` : ''].filter(Boolean).join(', ');
  // Schutzgebiete, Biotope, LRT, Habitatbäume
  const sg = [...(m.schutzgebiete || []), ...(m.thinning?.natura2000 || []), ...(u.info?.schutz || []).map((x) => ({ layer: x.layer, art: x.label, name: x.props?.NAME || x.props?.name || x.props?.Name || '' }))];
  const hat = (l) => sg.some((g) => g.layer === l);
  const wald = u.info?.wald || [];
  const { inPolys } = await import('./geo.js');
  const habitat = (s.punkte?.habitat || []).filter((x) => x.at && u.polys.length && inPolys(x.at, u.polys));
  const naturBem = [
    sg.filter((g) => ['ffh_geb', 'spa', 'nsg', 'nationalpark', 'biosreserv'].includes(g.layer)).map((g) => `${g.art}${g.name ? ` „${g.name}“` : ''}`).filter((x, i, a) => a.indexOf(x) === i).join(', '),
    wald.filter((w) => ['waldbiotope', 'waldlebensraumtypen'].includes(w.layer)).map((w) => w.label).filter((x, i, a) => a.indexOf(x) === i).join(', '),
    habitat.length ? `${habitat.length} Habitatbaum${habitat.length > 1 ? 'bäume' : ''} markiert – erhalten (siehe Karte)` : '',
  ].filter(Boolean).join('; ');
  const streng = ['ffh_geb', 'spa', 'nsg'].some(hat);
  // Waldfunktionen und Erschließung als Bemerkung zur Fläche
  const funktionen = (u.info?.funktion || []).map((f) => `${f.label}${f.layer === 'bodenschutzfunktion' ? ' (Rückegassen hangparallel, Kahlschlag vermeiden)' : ['erholungswald', 'erholungsfunktion'].includes(f.layer) ? ' (Waldbesucher – Wege absperren)' : ''}`);
  const flaecheBem = [
    funktionen.filter((x, i, a) => a.indexOf(x) === i).join('; '),
    u.gassen.length ? `${u.gassen.length} Rückegasse${u.gassen.length > 1 ? 'n' : ''} eingezeichnet${d.gassenabstand ? `, Abstand ${d.gassenabstand} m` : ''} (siehe Karte)` : '',
    u.lager[0]?.befahrbar ? `Lagerplatz: ${({ ganzjaehrig: 'ganzjährig mit LKW befahrbar', trocken: 'nur bei trockenem Wetter befahrbar', frost: 'nur bei Frost befahrbar', traktor: 'nur Traktor/Forwarder, kein LKW' })[u.lager[0].befahrbar] || u.lager[0].befahrbar}${u.lager[0].lkw ? ', LKW kann wenden' : ''}` : '',
  ].filter(Boolean).join('. ');
  const sonstiges = [
    m.note || '',
    az?.baeume?.length ? 'Die ausgezeichneten Bäume sind mit GPS-Punkten in der Karte der Anlage eingetragen.' : '',
    m.type === 'pflanzung' && d.species ? `Baumart(en): ${d.species}${m.pflanzplan ? ' – Verteilung laut Pflanzplan' : ''}` : '',
    streng && (holz || m.type === 'pflege' || SICHER_TYP[m.type] === 'maschine') ? 'Schutzgebiet: Arbeiten möglichst außerhalb der Brut- und Setzzeit (1.3.–30.9.); Horst- und Höhlenbäume erhalten.' : '',
  ].filter(Boolean).join('\n');
  // Revierleiter: Liste von ThüringenForst, sonst selbst hinterlegter Kontakt
  const rev = u.rl?.revier;
  let telRL = rev ? `${rev.name || ''}${rev.mobil || rev.tel ? `, ${rev.mobil || rev.tel}` : ''}` : '';
  if (!telRL && u.info?.zustaendig) { try { const { revierKontakt } = await import('./profi.js'); const k = revierKontakt(u.info.zustaendig); if (k?.name || k?.tel) telRL = [k.name, k.tel].filter(Boolean).join(', '); } catch { /* */ } }
  const { BA_NAMEN } = await import('./sortimente.js');
  const baArten = [...new Set((az?.baeume || []).map((b) => b.ba).filter((x) => x && x !== 'avg'))];
  const baName = baArten.map((k) => BA_NAMEN[k] || k).join(', ');
  const rp = (r) => (r ? `${r.id}${r.name ? ` (${r.name})` : ''} – ${kurzKoord(r.at)}` : '');
  const [gefahren, massnahmen] = SICHER[SICHER_TYP[m.type]] || ['', ''];
  const orte = (m.parcelIds?.length > 1 ? m.parcelIds : []).map((id) => s.parcels.find((x) => x.id === id) || (s.fremdFlurstuecke || []).find((x) => x.id === id)).filter(Boolean);
  return {
    nr: `AA-${new Date().getFullYear()}-${String(m.id).slice(-4).toUpperCase()}`,
    datum: new Date().toISOString().slice(0, 10),
    ag, an, mandant,
    zeitraum: m.date ? `ab ${datum(m.date)}` : '',
    ort: orte.length ? orte.map((p) => `${p.gemarkung}, Flur ${p.flur}, Flst. ${p.nr}`).join('; ')
      : u.p ? `Gemarkung ${u.p.gemarkung}${u.p.gemeinde ? ` (${u.p.gemeinde})` : ''}, Flur ${u.p.flur}, Flurstück ${u.p.nr}${u.fl && !u.fl.ganz && u.fl.ha ? ` – Teilfläche ${formatHa(u.fl.ha)}` : ''}` : m.ort || '',
    leistungsart: `${T?.label || m.type}${d.species && !['pflanzung', 'einzelschutz'].includes(m.type) ? ` (${d.species})` : baName ? ` (${baName})` : ''}`,
    verfahren, menge, preis,
    rvr: holz, qualitaet: '',
    aushaltung: azZ.Sortimente ? azZ.Sortimente.split(' · ').join('\n') : '',
    sonstiges,
    ersch: { grob: !!u.lager.length, fein: !!u.gassen.length, keine: false, vorgeschaedigt: false },
    flaecheBem,
    natur: {
      ffh: hat('ffh_geb'), spa: hat('spa'), nsg: hat('nsg'),
      biotop: wald.some((w) => w.layer === 'waldbiotope'), lrt: wald.some((w) => w.layer === 'waldlebensraumtypen'), denkmal: false, arten: habitat.length > 0,
      keine: false,
    },
    _naturGeprueft: (!!m.schutzGeprueft || (!!u.info && !u.info.failed)) && !habitat.length,
    naturBem,
    polter: u.lager[0] ? `${u.lager[0].name ? `${u.lager[0].name}: ` : ''}${kurzKoord(u.lager[0].at)}` : '',
    polterDurch: u.lager.length ? ag.name : '', grenzenDurch: ag.name,
    mark: { grenzen: false, ernteholz: !!(az?.baeume?.length || m.thinning?.plan), gassen: !!u.gassen.length },
    rp1: rp(u.rett[0]), rp2: rp(u.rett[1]),
    telAG: ag.tel, telRL, telAN: an.tel || '',
    gefahren, massnahmen,
    abrechnung,
  };
}
const natursumme = (n) => NATUR.slice(1).some(([k]) => n[k]);

/** Formular zum Ausfüllen – danach wird das PDF erstellt */
export async function arbeitsauftragAusfuellen(measureId) {
  const m0 = store.get().measures.find((x) => x.id === measureId);
  if (!m0) return;
  toast('Arbeitsauftrag wird vorbereitet …');
  const u = await umfeld(m0);
  if (!u.mitte) { toast('Für diese Maßnahme ist keine Fläche hinterlegt – bitte zuerst eine Fläche hinterlegen.'); return; }
  const vs = await vorschlag(m0, u);
  const a = mischen(vs, m0.auftrag);
  if (!m0.auftrag && vs._naturGeprueft && !natursumme(a.natur)) a.natur.keine = true;
  const liste = store.get().settings?.auftragnehmer || [];
  const body = h('div', { class: 'form aa-form' });
  const seite = openPage('Arbeitsauftrag ausfüllen', body);
  const feld = (obj, k, label, { lang = false, typ = 'text', ph = '' } = {}) => h('label', {}, label,
    lang ? h('textarea', { rows: 3, placeholder: ph, oninput: (e) => { obj[k] = e.target.value; } }, obj[k] || '')
      : h('input', { type: typ, value: obj[k] || '', placeholder: ph, oninput: (e) => { obj[k] = e.target.value; } }));
  const haken = (obj, paare) => h('div', { class: 'aa-haken' }, paare.map(([k, l]) => h('label', { class: 'jk-check' },
    h('input', { type: 'checkbox', checked: !!obj[k], onchange: (e) => { obj[k] = e.target.checked; } }), h('span', {}, l))));
  const kopf = (t) => h('h3', { class: 'aa-kopf' }, t);
  const anFelder = h('div');
  function anRender() {
    fill(anFelder,
      liste.length ? h('label', {}, 'Gespeicherter Auftragnehmer', h('select', { onchange: (e) => { const x = liste[Number(e.target.value)]; if (x) { a.an = { ...x }; a.telAN = x.tel || a.telAN; anRender(); } } },
        h('option', { value: '' }, '– auswählen –'), liste.map((x, i) => h('option', { value: i, selected: x.name === a.an.name }, x.name)))) : null,
      feld(a.an, 'name', 'Auftragnehmer'), feld(a.an, 'adresse', 'Adresse'), feld(a.an, 'tel', 'Telefon', { typ: 'tel' }));
  }
  anRender();
  fill(body,
    h('p', { class: 'hint' }, 'Die App hat ausgefüllt, was sie weiß. Ergänze den Rest – alles kannst du später ändern. Leere Felder bleiben im PDF zum Ausfüllen von Hand frei.'),
    kopf('Auftrag'),
    h('div', { class: 'so-zwei' }, feld(a, 'nr', 'Nr.'), feld(a, 'datum', 'Auftragsdatum', { typ: 'date' })),
    feld(a.ag, 'name', 'Auftraggeber'), feld(a.ag, 'adresse', 'Adresse'),
    anFelder,
    h('details', {}, h('summary', {}, 'Mandant/in (falls im Auftrag eines anderen Waldbesitzers)'), feld(a.mandant, 'name', 'Mandant/in'), feld(a.mandant, 'adresse', 'Adresse')),
    feld(a, 'zeitraum', 'Leistungszeitraum', { ph: 'z. B. 01.12.–20.12.' }),
    feld(a, 'ort', 'Leistungsort (Gemarkung/Flur/Flurstück)'),
    kopf('Arbeitsvorhaben'),
    feld(a, 'leistungsart', 'Leistungsart'), feld(a, 'verfahren', 'Arbeitsverfahren'),
    h('div', { class: 'so-zwei' }, feld(a, 'menge', 'Auftragsmenge'), feld(a, 'preis', 'Preis je Einheit', { ph: '€/fm, €/rm, €/ha …' })),
    h('div', { class: 'aa-haken' }, h('label', { class: 'jk-check' }, h('input', { type: 'checkbox', checked: !!a.rvr, onchange: (e) => { a.rvr = e.target.checked; } }), h('span', {}, 'Qualität nach RVR'))),
    feld(a, 'qualitaet', 'Qualität sonst'),
    feld(a, 'aushaltung', 'Aushaltung', { lang: true }), feld(a, 'sonstiges', 'Sonstiges', { lang: true }),
    kopf('Informationen zur Fläche'),
    h('span', { class: 'sheet-label' }, 'Erschließung'), haken(a.ersch, ERSCH),
    feld(a, 'flaecheBem', 'Weitere Bemerkungen zur Fläche', { lang: true }),
    h('span', { class: 'sheet-label' }, 'Naturschutz und Denkmale'), haken(a.natur, NATUR),
    feld(a, 'naturBem', 'Weitere Bemerkungen', { lang: true }),
    h('div', { class: 'so-zwei' }, feld(a, 'polter', 'Polterplatz (Koordinaten)'), feld(a, 'polterDurch', 'eingewiesen durch')),
    feld(a, 'grenzenDurch', 'Flurstücksgrenzen eingewiesen durch'),
    h('span', { class: 'sheet-label' }, 'Markierungen'), haken(a.mark, MARK),
    kopf('Notfall'),
    feld(a, 'rp1', 'Rettungspunkt 1'), feld(a, 'rp2', 'Rettungspunkt 2'),
    h('div', { class: 'so-zwei' }, feld(a, 'telAG', 'Telefon Auftraggeber', { typ: 'tel' }), feld(a, 'telAN', 'Telefon Auftragnehmer', { typ: 'tel' })),
    feld(a, 'telRL', 'Revierleiter (Name, Telefon)'),
    kopf('Arbeitssicherheit'),
    feld(a, 'gefahren', 'Besondere Gefährdungen', { lang: true, ph: 'z. B. Hangneigung, Stromleitung, Straße, Totholz, Käferbäume' }),
    feld(a, 'massnahmen', 'Maßnahmen', { lang: true, ph: 'z. B. Absperrung, Seilwinde, Sicherungsposten' }),
    h('label', {}, 'Abrechnung nach', h('select', { onchange: (e) => { a.abrechnung = e.target.value; } }, h('option', { value: '' }, '– offen –'), ABRECHNUNG.map((x) => h('option', { value: x, selected: a.abrechnung === x }, x)))),
    h('button', { type: 'button', class: 'btn btn-primary btn-block btn-large', onclick: async () => {
      store.update((st) => {
        const x = st.measures.find((y) => y.id === measureId); if (x) x.auftrag = JSON.parse(JSON.stringify(a));
        if (a.an.name) { const l = (st.settings.auftragnehmer || []).filter((y) => y.name !== a.an.name); l.unshift({ ...a.an, tel: a.an.tel || a.telAN }); st.settings.auftragnehmer = l.slice(0, 20); }
        if (a.ag.name || a.ag.adresse || a.telAG) st.settings.auftraggeber = { name: a.ag.name, adresse: a.ag.adresse, tel: a.telAG || a.ag.tel || '' };
      });
      seite.close();
      const b = await import('./berichte.js'); b.unternehmerAuftrag(measureId);
    } }, 'Arbeitsauftrag erstellen (PDF)'));
}
export function mischen(vs, gesp) {
  if (!gesp) return vs;
  const out = { ...vs, ...gesp };
  for (const k of ['ag', 'an', 'mandant', 'ersch', 'natur', 'mark']) out[k] = { ...vs[k], ...(gesp[k] || {}) };
  return out;
}

// ---------- PDF-Seite ----------
let logoP = null;
function logo() {
  logoP ??= (async () => {
    const img = await createImageBitmap(await (await fetch('icons/icon-192.png')).blob());
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128); x.drawImage(img, 0, 0, 128, 128);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), w: 128, h: 128 };
  })().catch(() => null);
  return logoP;
}

/** Zeichnet Seite 1 des Arbeitsauftrags in das PDF */
export async function auftragSeite(doc, a) {
  const L = 36, R = 559, B = R - L;
  let y = 30;
  const t = (x, yy, s, o = {}) => doc.text(x, yy, s, { size: 8.5, farbe: TEXT, ...o });
  const box = (x, yy, w, hh) => doc.rechteck(x, yy, w, hh, { stroke: LINIE, w: 0.6 });
  const kurz = (s, w, size = 8.5, bold = false) => { s = String(s ?? ''); if (breite(s, bold, size) <= w) return s; while (s && breite(`${s}…`, bold, size) > w) s = s.slice(0, -1); return `${s}…`; };
  // Feld: Beschriftung fett, Wert daneben
  const feld = (x, yy, w, label, wert, { hh = 15, lw = null } = {}) => {
    box(x, yy, w, hh);
    const lb = lw ?? breite(label, true, 8) + 8;
    t(x + 4, yy + 10.5, label, { bold: true, size: 8, farbe: GRUEN });
    if (wert) t(x + 4 + lb, yy + 10.5, kurz(wert, w - lb - 8));
  };
  const mehr = (x, yy, w, hh, label, wert) => {
    box(x, yy, w, hh);
    t(x + 4, yy + 10.5, label, { bold: true, size: 8, farbe: GRUEN });
    const z = doc.umbrechen(wert || '', w - 12, { size: 8.5 }).slice(0, Math.floor((hh - 14) / 10.5));
    z.forEach((s, i) => t(x + 6, yy + 22 + i * 10.5, kurz(s, w - 12)));
  };
  const haken = (x, yy, an, label, size = 7.5) => {
    doc.rechteck(x, yy - 7, 8, 8, { stroke: GRUEN, w: 0.7, fill: [255, 255, 255] });
    if (an) { doc.linie(x + 1.6, yy - 3, x + 3.4, yy - 0.8, { w: 1.3, farbe: GRUEN }); doc.linie(x + 3.4, yy - 0.8, x + 7, yy - 6, { w: 1.3, farbe: GRUEN }); }
    t(x + 11, yy, label, { size });
    return x + 11 + breite(label, false, size) + 10;
  };
  const abschnitt = (titel, zusatz = '') => {
    doc.rechteck(L, y, B, 15, { fill: GRUEN_HELL });
    t(L + 4, y + 11, titel, { bold: true, size: 9.5, farbe: GRUEN });
    if (zusatz) t(L + 8 + breite(titel, true, 9.5), y + 11, zusatz, { size: 7.5, farbe: GRAU });
    y += 15;
  };

  // Kopf
  doc.rechteck(L, y, B, 36, { fill: GRUEN });
  const lg = await logo();
  if (lg) { doc.rechteck(L + 6, y + 4, 28, 28, { fill: [255, 255, 255] }); doc.bild(L + 7, y + 5, 26, 26, lg); }
  t(L + (lg ? 42 : 10), y + 24, 'Arbeitsauftrag', { bold: true, size: 17, farbe: [255, 255, 255] });
  t(L + 200, y + 15, 'WaldWächter', { bold: true, size: 9, farbe: [210, 230, 215] });
  t(L + 200, y + 27, 'Wald- und Flächenbewirtschaftung', { size: 7.5, farbe: [210, 230, 215] });
  t(R - 130, y + 15, 'Nr.:', { bold: true, size: 8, farbe: [210, 230, 215] });
  t(R - 130, y + 28, kurz(a.nr, 124, 10, true), { bold: true, size: 10, farbe: [255, 255, 255] });
  y += 42;

  const sp = L + B * 0.58, w1 = sp - L, w2 = R - sp;
  feld(L, y, w1, 'Auftraggeber:', a.ag.name, { lw: 72 }); feld(sp, y, w2, 'Adresse:', a.ag.adresse); y += 15;
  feld(L, y, w1, 'Auftragnehmer:', a.an.name, { lw: 72 }); feld(sp, y, w2, 'Adresse:', a.an.adresse); y += 15;
  feld(L, y, w1, 'Mandant/in:', a.mandant.name, { lw: 72 }); feld(sp, y, w2, 'Adresse:', a.mandant.adresse); y += 19;
  feld(L, y, w1, 'Auftragsdatum:', a.datum ? datum(a.datum) : '', { lw: 72 }); feld(sp, y, w2, 'Leistungszeitraum:', a.zeitraum); y += 15;
  feld(L, y, B, 'Leistungsort (Gemarkung/Flur/Flurstück):', a.ort); y += 21;

  abschnitt('Arbeitsvorhaben');
  feld(L, y, w1, 'Leistungsart:', a.leistungsart, { lw: 72 }); feld(sp, y, w2, 'Auftragsmenge:', a.menge); y += 15;
  feld(L, y, w1, 'Arbeitsverfahren:', a.verfahren, { lw: 72 }); feld(sp, y, w2, 'Preis je Einheit:', a.preis); y += 15;
  box(L, y, B, 15); t(L + 4, y + 10.5, 'Qualität:', { bold: true, size: 8, farbe: GRUEN });
  { let x = haken(L + 76, y + 11, a.rvr, 'nach RVR'); x = haken(x, y + 11, !!a.qualitaet, a.qualitaet ? kurz(a.qualitaet, R - x - 30) : ''); }
  y += 15;
  mehr(L, y, B, 78, 'Aushaltung:', a.aushaltung); y += 78;
  mehr(L, y, B, 56, 'Sonstiges:', a.sonstiges); y += 62;

  abschnitt('Informationen zur Fläche');
  box(L, y, B, 15); t(L + 4, y + 10.5, 'Erschließung:', { bold: true, size: 8, farbe: GRUEN });
  { let x = L + 76; ERSCH.forEach(([k, l]) => { x = haken(x, y + 11, a.ersch[k], l); }); }
  y += 15;
  mehr(L, y, B, 42, 'Weitere Bemerkungen zur Fläche:', a.flaecheBem); y += 42;
  doc.umbrechen('Bei Gefährdung des Grenzwertes (verbreitet instabile Fahrspur, z. B. Vertiefung bei jeder Überfahrt ±10 cm, und/oder Traktionsverlust) ist die Arbeit konsequent zu unterbrechen und Kontakt zum Auftraggeber aufzunehmen!', B - 8, { size: 7.5, bold: true })
    .forEach((s, i) => t(L + 4, y + 10 + i * 9, s, { bold: true, size: 7.5, farbe: ROT }));
  y += 24;
  box(L, y, B, 26); t(L + 4, y + 10.5, 'Naturschutz und Denkmale:', { bold: true, size: 8, farbe: GRUEN });
  { let x = L + 128, z = y + 11; NATUR.forEach(([k, l]) => { const w = breite(l, false, 7.5) + 21; if (x + w > R - 4) { x = L + 128; z += 11; } x = haken(x, z, a.natur[k], l); }); }
  y += 26;
  feld(L, y, B, 'Weitere Bemerkungen:', a.naturBem); y += 15;
  feld(L, y, w1, 'Polterplatz Koordinaten:', a.polter, { lw: 112 }); feld(sp, y, w2, 'eingewiesen durch:', a.polterDurch); y += 15;
  feld(L, y, B, 'Flurstücksgrenzen eingewiesen durch:', a.grenzenDurch); y += 15;
  box(L, y, B, 15); t(L + 4, y + 10.5, 'Markierungen:', { bold: true, size: 8, farbe: GRUEN });
  { let x = L + 76; MARK.forEach(([k, l]) => { x = haken(x, y + 11, a.mark[k], l); }); }
  y += 21;

  // Notfall
  const nh = 45;
  doc.rechteck(L, y, B, nh, { stroke: ROT, w: 1.2 });
  doc.rechteck(L, y, 46, 15, { fill: ROT });
  t(L + 5, y + 11, 'Notfall', { bold: true, size: 9.5, farbe: [255, 255, 255] });
  const nx = L + 52, tx = L + B * 0.55;
  t(nx, y + 11, 'Rettungspunkt 1:', { bold: true, size: 8 }); t(nx + 70, y + 11, kurz(a.rp1, tx - nx - 76));
  t(nx, y + 25, 'Rettungspunkt 2:', { bold: true, size: 8 }); t(nx + 70, y + 25, kurz(a.rp2, tx - nx - 76));
  t(nx, y + 39, 'Notruf:', { bold: true, size: 9, farbe: ROT }); t(nx + 70, y + 39, '112', { bold: true, size: 10, farbe: ROT });
  t(tx, y + 11, 'Telefon Auftraggeber:', { bold: true, size: 8 }); t(tx + 92, y + 11, kurz(a.telAG, R - tx - 96));
  t(tx, y + 25, 'Revierleiter:', { bold: true, size: 8 }); t(tx + 92, y + 25, kurz(a.telRL, R - tx - 96));
  t(tx, y + 39, 'Auftragnehmer:', { bold: true, size: 8 }); t(tx + 92, y + 39, kurz(a.telAN || a.an.tel, R - tx - 96));
  y += nh + 6;

  abschnitt('Arbeitssicherheit', '(Gefährdungsbeurteilung nach §§ 3, 5, 6 ArbSchG)');
  const gh = 96;
  mehr(L, y, B / 2, gh, 'Besondere Gefährdungen:', a.gefahren); mehr(L + B / 2, y, B / 2, gh, 'Maßnahmen:', a.massnahmen); y += gh + 6;
  doc.rechteck(L, y, B, 16, { fill: GRUEN_HELL });
  t(L + 4, y + 11.5, 'Abrechnung nach:', { bold: true, size: 9.5, farbe: GRUEN }); t(L + 100, y + 11.5, a.abrechnung || '', { size: 9 });
  y += 22;
  t(L, y, 'Der Auftragnehmer verpflichtet sich, die VSG-Forsten und die PEFC-Standards einzuhalten.', { size: 7.5, farbe: GRAU });
  y += 44;
  doc.linie(L, y, L + 230, y, { w: 0.7, farbe: TEXT }); doc.linie(R - 230, y, R, y, { w: 0.7, farbe: TEXT });
  t(L, y + 10, 'Auftraggeber – Ort, Datum, Unterschrift', { size: 7.5, farbe: GRAU }); t(R - 230, y + 10, 'Auftragnehmer/in – Ort, Datum, Unterschrift', { size: 7.5, farbe: GRAU });
  t(L, 828, `Erstellt mit der WaldWächter-App am ${new Date().toLocaleDateString('de-DE')} · Seite 1 – Karte und Arbeitsanweisung ab Seite 2`, { size: 6.5, farbe: GRAU });
}
