// Pflanzenpreise: Preisliste der Waldbesitzer Service GmbH (Stückpreise zzgl. MwSt.) als Vorgabe,
// dazu eigene Preise und eigene Baumarten (im Gerät gespeichert).
export const WBS_QUELLE = 'Preisliste der Waldbesitzer Service GmbH';
// nr, Baumart (wie in der App), Alter (Sämling/verschult), Höhe (cm), Preis €/Stück netto, Herkunftsgebiet, Quickpot
const W = (nr, art, alter, hoehe, preis, hkg = '', quickpot = false) => ({ nr, art, alter, hoehe, preis, hkg, quickpot });
export const WBS = [
  W(501, 'Weißtanne', '2/2', '15–30', 0.90, '827 07'), W(502, 'Weißtanne', '2/1', '12–20', 1.75, '827 07', true),
  W(533, 'Colorado-Tanne', '2/2', '', 2.23),
  W(507, 'Küstentanne', '2/0', '', 0.60, '830 02'), W(508, 'Küstentanne', '1/1', '', 1.85, '830 02', true),
  W(509, 'Nordmannstanne', '2/1', '', 0.92),
  W(518, 'Atlaszeder', '1/1', '', 4.55, '', true), W(519, 'Libanonzeder', '1/1', '20–40', 4.55, '', true),
  W(505, 'Europäische Lärche', '1/1', '25–50', 0.73, '837 03'), W(593, 'Europäische Lärche', '1/1', '', 1.85, '837 03', true),
  W(511, 'Gemeine Fichte', '2/2', '25–50', 0.47, '840 13'),
  W(512, 'Blaufichte', '2/2', '20–40', 0.72),
  W(584, 'Schwarzkiefer', '1/1', '', 0.77, '847 02'),
  W(559, 'Gemeine Kiefer', '1/1', '', 0.51, '851 12'),
  W(503, 'Douglasie', '1/1', '20–40', 0.85, '853 05'), W(504, 'Douglasie', '1/1', '15–30', 1.75, '853 05', true),
  W(529, 'Mammutbaum', '1/1', '', 7.05),
  W(548, 'Hemlocktanne', '2/1', '12–20', 1.05),
  W(568, 'Feldahorn', '1/0', '30–50', 1.05),
  W(532, 'Spitzahorn', '1/1', '30–50', 1.05, '800 04'),
  W(514, 'Bergahorn', '1/0', '30–50', 0.47, '801 06'),
  W(535, 'Schwarzerle', '1/1', '30–50', 0.78, '802 06'),
  W(515, 'Sandbirke', '1/1', '50–80', 0.93, '804 03'),
  W(516, 'Hainbuche', '2/0', '30–50', 0.87, '806 04'),
  W(517, 'Esskastanie', '1/0', '30–50', 1.05, '808 02'), W(572, 'Esskastanie', '1/0', '', 2.55, '808 02', true),
  W(530, 'Baumhasel', '1/0', '30–50', 1.05),
  W(520, 'Rotbuche', '1/0', '30–50', 0.75, '810 11'),
  W(521, 'Vogelkirsche', '1/0', '50–80', 0.90),
  W(522, 'Traubeneiche', '2/0', '30–50', 1.00, '818 05'),
  W(523, 'Stieleiche', '1/0', '30–50', 1.00, '817 06'),
  W(524, 'Roteiche', '2/0', '30–50', 0.94, '816 02'),
  W(525, 'Robinie', '1/0', '50–80', 0.60, '819 02'),
  W(527, 'Winterlinde', '2/0', '30–50', 0.94, '823 07'),
  W(528, 'Bergulme', '1/0', '30–50', 1.45),
  W(569, 'Flatterulme', '1/0', '30–50', 1.05),
];
export const angebote = (art) => WBS.filter((a) => a.art === art);
export const standardAngebot = (art) => angebote(art).find((a) => !a.quickpot) || angebote(art)[0] || null;
export const angebot = (nr) => WBS.find((a) => a.nr === Number(nr)) || null;
export const sortimentText = (a) => `${a.alter}${a.hoehe ? `, ${a.hoehe} cm` : ''}${a.quickpot ? ', Quickpot' : ''}`;
export const angebotText = (a) => `Nr. ${a.nr} · ${sortimentText(a)}${a.hkg ? ` · HKG ${a.hkg}` : ''} · ${a.preis.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`;

// ---------- eigene Preise: Schlüssel „Baumart|Sortiment“ ----------
const PREIS_KEY = 'waldwaechter.pflanzpreise';
const lies = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? d; } catch { return d; } };
const schreib = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* Speicher voll oder gesperrt */ } };
export function eigenerPreis(art, sortiment) {
  const p = lies(PREIS_KEY, {});
  return p[`${art}|${sortiment || ''}`] ?? null;
}
export function eigenenPreisMerken(art, sortiment, preis) {
  const p = lies(PREIS_KEY, {});
  if (preis == null) delete p[`${art}|${sortiment || ''}`]; else p[`${art}|${sortiment || ''}`] = preis;
  schreib(PREIS_KEY, p);
}
/** Vorgabe für eine neu gewählte Baumart: WBS-Standardsortiment, eigener Preis vor WBS-Preis */
export function vorgabe(art) {
  const a = standardAngebot(art);
  const eigen = lies(EIGENE_KEY, []).find((e) => e.name === art);
  const sortiment = a ? sortimentText(a) : eigen?.sortiment || '';
  const preis = eigenerPreis(art, sortiment) ?? a?.preis ?? eigen?.preis ?? null;
  return { wbsNr: a?.nr ?? null, sortiment, preis };
}

// ---------- eigene Baumarten ----------
const EIGENE_KEY = 'waldwaechter.eigeneBaumarten';
export const eigeneBaumarten = () => lies(EIGENE_KEY, []);
export function eigeneBaumartMerken(a) { schreib(EIGENE_KEY, [...eigeneBaumarten().filter((e) => e.name !== a.name), a]); }
export function eigeneBaumartLoeschen(name) { schreib(EIGENE_KEY, eigeneBaumarten().filter((e) => e.name !== name)); }
