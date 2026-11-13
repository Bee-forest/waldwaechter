// Einfacher, lokaler Zustandsspeicher (localStorage) mit Abonnements.
// Später austauschbar gegen ein Backend (z. B. REST-API + IndexedDB-Sync).

const KEY = 'waldwaechter.v1';

const defaults = () => ({
  parcels: [],      // { id, gemarkung, flur, nr, category, addedAt, ring, … } – ALKIS-Flurstücke mit Geometrie
  measures: [],     // siehe measures.js
  foerderantraege: [],
  finanzen: { buchungen: [], quote: 25 }, // siehe finanzen.js – Rechnungen, Einnahmen, Rücklagenquote für den Wald
  termine: [],      // eigene Termine (Aktuelles → FBG-Termine)
  bestandKorrektur: {}, // eigene Angaben zum Bestand je Flurstück: { haupt, misch, neben: { art, alter }, jahr } // siehe foerderung.js – Entwürfe für Förderanträge (ThüringenForst)
  profile: { name: '', email: '', fbg: '', accountHolder: '', iban: '', strasse: '', ort: '', telefon: '', pi: '' },
  settings: {
    theme: 'auto',          // auto | light | dark
    arrivalRadius: 8,       // m – ab dieser Entfernung gilt ein Rasterpunkt als erreicht
    simulateGps: false,     // Entwicklermodus: Standort per Tippen auf die Karte
    basemap: 'osm',         // osm | dop (Luftbild TH)
    demo: false,            // Demo-Flurstücke (Raum Ilmenau) zusätzlich zeigen
    layers: { alkis: true, demo: false, rettung: true, schutz: false, natura: false, biotope: false, schaden: false, standort: false, Wald: true, Landwirtschaft: true, Gewässer: true, Gebäude: true, info: true, rescue: false },
  },
  onboardingDone: false,
});

let state = load();
const subs = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = defaults();
    const s = JSON.parse(raw);
    return { ...d, ...s, profile: { ...d.profile, ...s.profile }, settings: { ...d.settings, ...s.settings, simulateGps: false /* Testschalter im Profil entfernt */, layers: { ...d.settings.layers, ...(s.settings?.layers || {}) } } };
  } catch {
    return defaults();
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* Speicher voll oder gesperrt */ }
}

export const store = {
  get: () => state,
  update(fn) {
    fn(state);
    persist();
    subs.forEach((s) => s(state));
  },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  reset() { state = defaults(); persist(); subs.forEach((s) => s(state)); },
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
