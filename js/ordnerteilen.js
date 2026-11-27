// Profimodus: einen Ordner (Flurstücke, Maßnahmen, Buchungen, Einträge in der Karte, Eigentümer, Fotos)
// als Datei an Kolleginnen und Kollegen schicken – und eine empfangene Datei in die App übernehmen.
// Die Datei geht direkt von Gerät zu Gerät (Teilen-Menü, Messenger, E-Mail); es gibt keinen Server dazwischen.
import { h, openPage, dialog, toast } from './ui.js';
import { store } from './store.js';
import { polysOf, inPolys } from './geo.js';
import { ordnerVon, ordnerListe, ordnerWaehlen, eigentuemerEintraege, eigentuemerUebernehmen } from './profi.js';
import { dateiLaden, dateiSpeichern } from './dateien.js';

const FORMAT = 'waldwaechter-ordner';
const kopie = (x) => JSON.parse(JSON.stringify(x));
const blobZuText = (b) => new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = err; r.readAsDataURL(b); });
const textZuBlob = (t, typ = 'image/jpeg') => { const bin = atob(t); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: typ }); };
const mb = (n) => `${(n / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;

/** Alles einsammeln, was zum Ordner gehört */
function inhalt(ordnerId) {
  const s = store.get();
  const ordner = (s.ordner || []).find((o) => o.id === ordnerId);
  const parcels = s.parcels.filter((p) => p.ordnerId === ordnerId);
  const pIds = new Set(parcels.map((p) => p.id));
  const polys = parcels.filter((p) => p.ring).map((p) => polysOf(p));
  const drin = (ll) => ll && polys.some((pp) => inPolys(ll, pp));
  const measures = (s.measures || []).filter((m) => ordnerVon(m) === ordnerId);
  const mIds = new Set(measures.map((m) => m.id));
  const buchungen = (s.finanzen?.buchungen || []).filter((b) => ordnerVon(b) === ordnerId);
  const habitat = (s.punkte?.habitat || []).filter((x) => drin(x.at));
  const jagd = (s.punkte?.jagd || []).filter((x) => drin(x.at));
  const gassen = (s.erschliessung?.gassen || []).filter((g) => g.line?.some(drin));
  const lager = (s.erschliessung?.lager || []).filter((l) => drin(l.at));
  const fotopunkte = (s.fotopunkte || []).filter((f) => pIds.has(f.parcelId) || drin(f.at));
  const tagebuch = (s.tagebuch || []).filter((t) => pIds.has(t.parcelId));
  const antraege = (s.foerderantraege || []).filter((a) => (a.massnahmen || []).some((id) => mIds.has(id)));
  const fremdIds = new Set(measures.map((m) => m.parcelId).filter((id) => id && !pIds.has(id)));
  const fremd = (s.fremdFlurstuecke || []).filter((p) => fremdIds.has(p.id));
  const nachId = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => pIds.has(k)));
  const ids = new Set([...mIds, ...habitat.map((x) => x.id), ...jagd.map((x) => x.id), ...gassen.map((x) => x.id), ...lager.map((x) => x.id), ...fotopunkte.map((x) => x.id)]);
  const fotos = Object.fromEntries(Object.entries(s.fotos || {}).filter(([k]) => ids.has(k.slice(k.indexOf(':') + 1))));
  return { ordner, parcels, measures, buchungen, habitat, jagd, gassen, lager, fotopunkte, tagebuch, antraege, fremd, fotos,
    bestandPhase: nachId(s.bestandPhase), bestandKorrektur: nachId(s.bestandKorrektur), eigentuemer: eigentuemerEintraege(parcels) };
}

/** Teilen-Dialog für einen Ordner */
export async function ordnerTeilen(ordnerId) {
  const x = inhalt(ordnerId);
  if (!x.ordner) return;
  const fotoIds = Object.values(x.fotos).flat().map((f) => f.id);
  let mitFotos = fotoIds.length > 0;
  const ok = await dialog({
    title: `Ordner „${x.ordner.name}“ teilen`,
    body: h('div', { class: 'form' },
      h('p', {}, `${x.parcels.length} Flurstücke · ${x.measures.length} Maßnahmen · ${x.buchungen.length} Buchungen · ${x.habitat.length + x.jagd.length} Punkte · ${x.gassen.length} Gassen · ${x.lager.length} Lagerplätze${Object.keys(x.eigentuemer).length ? ` · Eigentümerdaten zu ${Object.keys(x.eigentuemer).length} Flurstücken` : ''}`),
      fotoIds.length ? h('label', { class: 'jk-check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { mitFotos = e.target.checked; } }), h('span', {}, `${fotoIds.length} Fotos mitschicken`, h('small', {}, 'macht die Datei deutlich größer'))) : null,
      h('p', { class: 'hint' }, 'Die App erstellt eine Datei, die du über das Teilen-Menü (Messenger, E-Mail, Cloud) an deine Kollegin oder deinen Kollegen schickst. Dort unter Profimodus → „Ordner verwalten“ → „Ordner empfangen“ laden. Schickt ihr den Ordner später noch einmal, wird er beim Empfänger aktualisiert.'),
      h('p', { class: 'lrt-hinweis' }, 'Die Datei enthält personenbezogene Daten (Eigentümer, Anschriften). Nur an berechtigte Personen schicken.')),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'Datei erstellen und teilen', value: true, primary: true }],
  });
  if (!ok) return;
  toast('Datei wird erstellt …');
  const bilder = {};
  if (mitFotos) for (const id of fotoIds) for (const k of [id, `${id}-v`]) { try { const b = await dateiLaden(k); if (b) bilder[k] = await blobZuText(b); } catch { /* fehlt */ } }
  const s = store.get();
  const paket = {
    format: FORMAT, version: 1, erstellt: Date.now(), von: s.profile?.name || '',
    ordner: kopie(x.ordner),
    daten: kopie({ parcels: x.parcels, measures: x.measures, buchungen: x.buchungen, punkte: { habitat: x.habitat, jagd: x.jagd }, erschliessung: { gassen: x.gassen, lager: x.lager },
      fotopunkte: x.fotopunkte, tagebuch: x.tagebuch, foerderantraege: x.antraege, fremdFlurstuecke: x.fremd, bestandPhase: x.bestandPhase, bestandKorrektur: x.bestandKorrektur,
      fotos: mitFotos ? x.fotos : {} }),
    eigentuemer: x.eigentuemer,
    bilder,
  };
  const name = `Ordner_${x.ordner.name.replace(/[^\wäöüÄÖÜß-]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.waldwaechter.json`;
  const datei = new File([JSON.stringify(paket)], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [datei] })) { await navigator.share({ files: [datei], title: `WaldWächter-Ordner „${x.ordner.name}“`, text: `Ordner „${x.ordner.name}“ aus der WaldWächter-App – in der App unter Profimodus → Ordner verwalten → „Ordner empfangen“ laden.` }); toast(`Ordner geteilt (${mb(datei.size)})`); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  const a = h('a', { href: URL.createObjectURL(datei), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast(`Datei gespeichert (${mb(datei.size)}) – jetzt an den Kollegen schicken`);
}

/** Datei auswählen und Ordner übernehmen */
export function ordnerEmpfangen() {
  const inp = h('input', { type: 'file', accept: '.json,application/json,.waldwaechter', hidden: true });
  document.body.append(inp);
  inp.onchange = async () => {
    const f = inp.files?.[0]; inp.remove();
    if (!f) return;
    let p;
    try { p = JSON.parse(await f.text()); } catch { toast('Die Datei ist kein WaldWächter-Ordner.'); return; }
    if (p?.format !== FORMAT || !p.ordner?.id) { toast('Die Datei ist kein WaldWächter-Ordner.'); return; }
    await uebernehmen(p);
  };
  inp.click();
}

async function uebernehmen(p) {
  const s = store.get(), d = p.daten || {};
  const vorhanden = (s.ordner || []).find((o) => o.id === p.ordner.id);
  const doppelt = (d.parcels || []).filter((x) => s.parcels.some((y) => y.id === x.id && y.ordnerId !== p.ordner.id));
  let verschieben = true;
  const ok = await dialog({
    title: vorhanden ? `Ordner „${p.ordner.name}“ aktualisieren?` : `Ordner „${p.ordner.name}“ übernehmen?`,
    body: h('div', { class: 'form' },
      h('p', {}, `${p.von ? `Von ${p.von}, ` : ''}erstellt am ${new Date(p.erstellt).toLocaleDateString('de-DE')}`),
      h('p', {}, `${(d.parcels || []).length} Flurstücke · ${(d.measures || []).length} Maßnahmen · ${(d.buchungen || []).length} Buchungen · ${((d.punkte?.habitat || []).length + (d.punkte?.jagd || []).length)} Punkte · ${(d.erschliessung?.gassen || []).length} Gassen · ${(d.erschliessung?.lager || []).length} Lagerplätze · ${Object.keys(p.bilder || {}).filter((k) => !k.endsWith('-v')).length} Fotos`),
      vorhanden ? h('p', { class: 'hint' }, 'Diesen Ordner hast du schon. Einträge aus der Datei ersetzen die gleichen Einträge bei dir; was du selbst zusätzlich angelegt hast, bleibt erhalten.') : null,
      doppelt.length ? h('label', { class: 'jk-check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { verschieben = e.target.checked; } }),
        h('span', {}, `${doppelt.length} dieser Flurstücke hast du schon in einem anderen Ordner – in diesen Ordner verschieben`, h('small', {}, doppelt.slice(0, 4).map((x) => `${x.gemarkung} ${x.nr}`).join(', ') + (doppelt.length > 4 ? ' …' : '')))) : null),
    actions: [{ label: 'Abbrechen', value: false }, { label: vorhanden ? 'Aktualisieren' : 'Übernehmen', value: true, primary: true }],
  });
  if (!ok) return;
  // Fotos zuerst in den Gerätespeicher
  let bilderFehler = 0;
  for (const [k, t] of Object.entries(p.bilder || {})) { try { await dateiSpeichern(k, textZuBlob(t)); } catch { bilderFehler++; } }
  const oid = p.ordner.id;
  const upsert = (liste, neu) => { for (const x of neu || []) { const i = liste.findIndex((y) => y.id === x.id); if (i >= 0) liste[i] = x; else liste.push(x); } };
  store.update((st) => {
    st.ordner ||= [];
    const i = st.ordner.findIndex((o) => o.id === oid);
    if (i >= 0) st.ordner[i] = { ...st.ordner[i], ...p.ordner }; else st.ordner.push({ ...p.ordner, empfangen: Date.now(), von: p.von || '' });
    for (const x of d.parcels || []) {
      const j = st.parcels.findIndex((y) => y.id === x.id);
      if (j < 0) st.parcels.push({ ...x, ordnerId: oid });
      else if (st.parcels[j].ordnerId === oid || verschieben) st.parcels[j] = { ...st.parcels[j], ...x, ordnerId: oid };
    }
    upsert(st.measures ||= [], (d.measures || []).map((m) => (m.parcelId ? m : { ...m, ordnerId: oid })));
    st.finanzen ||= { buchungen: [], quote: 25 };
    upsert(st.finanzen.buchungen ||= [], (d.buchungen || []).map((b) => (b.parcelId ? b : { ...b, ordnerId: oid })));
    st.punkte ||= { habitat: [], jagd: [] };
    upsert(st.punkte.habitat ||= [], d.punkte?.habitat); upsert(st.punkte.jagd ||= [], d.punkte?.jagd);
    st.erschliessung ||= { gassen: [], lager: [] };
    upsert(st.erschliessung.gassen ||= [], d.erschliessung?.gassen); upsert(st.erschliessung.lager ||= [], d.erschliessung?.lager);
    upsert(st.fotopunkte ||= [], d.fotopunkte); upsert(st.tagebuch ||= [], d.tagebuch); upsert(st.foerderantraege ||= [], d.foerderantraege);
    upsert(st.fremdFlurstuecke ||= [], d.fremdFlurstuecke);
    st.bestandPhase = { ...(st.bestandPhase || {}), ...(d.bestandPhase || {}) };
    st.bestandKorrektur = { ...(st.bestandKorrektur || {}), ...(d.bestandKorrektur || {}) };
    st.fotos ||= {};
    for (const [k, l] of Object.entries(d.fotos || {})) { const alt = st.fotos[k] || []; st.fotos[k] = [...alt.filter((f) => !l.some((n) => n.id === f.id)), ...l]; }
  });
  const et = eigentuemerUebernehmen(p.eigentuemer);
  ordnerWaehlen(oid);
  toast(`Ordner „${p.ordner.name}“ ${vorhanden ? 'aktualisiert' : 'übernommen'}${et ? ` – mit Eigentümerdaten` : ''}${bilderFehler ? ` (${bilderFehler} Fotos ohne Bild – Speicher voll?)` : ''}`);
}

export { ordnerListe };
