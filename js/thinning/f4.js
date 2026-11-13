// Durchforstungshilfe Fassung 4 – Rechenkern als reine Funktionen (ohne Oberfläche, mit Unit-Tests).
// Alle Zahlen, Tabellen und Koeffizienten stammen aus data/durchforstung_parameter_f4.json und werden
// nur von dort gelesen. Garantiert: je Eingriff nie mehr als obergrenze_je_eingriff_m3ha (harte Sperre).

let P = null;

/** Parameter setzen (Tests) bzw. einmalig laden (App) */
export function setzeParameter(p) { P = p; return P; }
export async function ladeParameter(url = './data/durchforstung_parameter_f4.json') {
  if (P) return P;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Parameter der Durchforstungshilfe konnten nicht geladen werden');
  return setzeParameter(await res.json());
}
export const parameter = () => { if (!P) throw new Error('Parameter nicht geladen'); return P; };

const KLASSEN = ['duenn', 'mittel', 'dick'];
export const KLASSE_NAME = { duenn: 'dünn', mittel: 'mittel', dick: 'dick' };
const norm = (s) => String(s || '').trim().toLowerCase();

// ---------- Bestand ----------

/**
 * Baumartengruppe der Hauptbaumart nach baumartengruppen.
 * FESTLEGUNG: Nicht gelistete Nadelbaumarten (z. B. Strobe, Küstentanne) → „Fi/Ta/Dgl“, Kiefernarten → „Ki/Lä“.
 * Nicht gelistete Laubbaumarten → „Bu/Laub“ (laut Beschreibung).
 * Kurzbezeichnungen aus dem Waldverzeichnis („Eiche“, „Lärche“, „Tanne“) werden ihrer Gruppe zugeordnet.
 */
export function gruppe(hauptbaumart, { nadel = null } = {}) {
  const a = norm(hauptbaumart);
  for (const [g, arten] of Object.entries(parameter().baumartengruppen)) if (arten.some((x) => norm(x) === a)) return g;
  if (/kiefer|lärche|laerche/.test(a)) return 'Ki/Lä';
  if (/eiche/.test(a)) return 'Eiche';
  if (/fichte|tanne|douglas|strobe|hemlock|zeder|mammut|eibe|thuja|lebensbaum/.test(a)) return 'Fi/Ta/Dgl'; // FESTLEGUNG: Nadelbaum ohne Gruppe
  if (nadel === true) return 'Fi/Ta/Dgl'; // FESTLEGUNG: Nadelbaum ohne Gruppe
  return 'Bu/Laub';
}
/** Höhenklasse nach hoehenklassen: ho < 25 | 25 ≤ ho < 30 | ho ≥ 30 */
export function hoehenklasse(ho) {
  const k = parameter().hoehenklassen.map((x) => x.name);
  return ho < 25 ? k[0] : ho < 30 ? k[1] : k[2];
}
/** B°-Stufe nach bstufe_regel: auf Zehntel abrunden, Intervalle links geschlossen */
export function bstufe(b) {
  const s = parameter().bstufen;
  if (b < 0.5) return s[0];
  if (b >= 1.2) return s[s.length - 1];
  const z = Math.floor(b * 10 + 1e-9); // 5 … 11
  return s.find((x) => x === `${Math.floor(z / 10)},${z % 10}`);
}
/** Szenario aus der Probezählung: Klasse mit ≥ 40 % Anteil und ≥ 10 Prozentpunkten Vorsprung (dick → 1, mittel → 2, dünn → 3), sonst null */
export function szenario(nDuenn, nMittel, nDick) {
  const n = nDuenn + nMittel + nDick;
  if (!(n > 0)) return null;
  const anteile = [['dick', nDick / n], ['mittel', nMittel / n], ['duenn', nDuenn / n]].sort((x, y) => y[1] - x[1]);
  const [[k, a], [, b]] = anteile;
  if (a >= 0.4 && a - b >= 0.1 - 1e-12) return { dick: 1, mittel: 2, duenn: 3 }[k];
  return null;
}
/** FESTLEGUNG: kein eindeutiges Szenario → Szenario der Klasse mit dem größten Stammzahlanteil (Hinweis an den Nutzer) */
export function szenarioMitRueckfall(nDuenn, nMittel, nDick) {
  const s = szenario(nDuenn, nMittel, nDick);
  if (s) return { szenario: s, eindeutig: true };
  const n = nDuenn + nMittel + nDick;
  if (!(n > 0)) return { szenario: null, eindeutig: false };
  const k = [['dick', nDick], ['mittel', nMittel], ['duenn', nDuenn]].sort((x, y) => y[1] - x[1])[0][0];
  return { szenario: { dick: 1, mittel: 2, duenn: 3 }[k], eindeutig: false };
}
/** Feld der feldtabelle */
export function feld(g, hk, bs, sz) {
  return parameter().feldtabelle.find((f) => f.gruppe === g && f.hoehe === hk && f.bstufe === bs && f.szenario === Number(sz)) || null;
}

// ---------- Planung ----------

/** Zahl der Eingriffe nach eingriffe_regel */
export function anzahlEingriffe(zielmenge) {
  for (const r of parameter().eingriffe_regel) {
    if (r.unter != null && zielmenge < r.unter) return r.eingriffe;
    if (r.ab != null && zielmenge >= r.ab) return r.eingriffe;
  }
  return parameter().eingriffe_regel[parameter().eingriffe_regel.length - 1].eingriffe;
}
/** Menge des Eingriffs Nr. eingriffNr (m³/ha): min(Obergrenze; (Zielmenge − bisher gezählt) / verbleibende Eingriffe), nicht unter 0 */
export function mengeEingriff(zielmenge, bisherGezaehlt, eingriffeGesamt, eingriffNr) {
  const verbleibend = eingriffeGesamt - eingriffNr + 1;
  if (!(verbleibend > 0)) return 0;
  return Math.max(0, Math.min(parameter().obergrenze_je_eingriff_m3ha, (zielmenge - bisherGezaehlt) / verbleibend));
}
/** Rasterabstand: 25 m, in Szenario 3 (viele dünne Bäume) 12,5 m */
export const rasterAbstand = (sz) => (Number(sz) === 3 ? parameter().raster.abstand_m_szenario_3 : parameter().raster.abstand_m);
/** Abstand zwischen den Eingriffen in Jahren: 10 / E */
export const abstandJahre = (eingriffe) => 10 / eingriffe;

// ---------- Zählvolumen ----------

/** Wachstumsfaktor im Folgeeingriff: beim 2. Eingriff einmal, beim 3. ein weiteres Mal (dicke Bäume ausgenommen) */
const faktor = (eingriffNr, f) => (eingriffNr > 1 && f?.faktor_zaehlvolumen_folgeeingriff ? f.faktor_zaehlvolumen_folgeeingriff ** (eingriffNr - 1) : 1);
/** Stufen-Zählvolumen (m³ je Baum): exp(a + b·ln ho) × Sicherheit, im Folgeeingriff × Faktor */
export function zaehlvolumenStufe(g, stufe, ho, eingriffNr = 1, f = null) {
  const z = parameter().zaehlvolumen_stufe;
  const k = z.koeffizienten[g][String(stufe)];
  return Math.exp(k.a + k.b * Math.log(ho)) * z.sicherheit * faktor(eingriffNr, f);
}
/** Dicker Baum mit gemessenem BHD: exp(b0 + b1·ln BHD + b2·ln ho) × Sicherheit (kein Folgefaktor) */
export function zaehlvolumenDick(g, bhd, ho) {
  const t = parameter().tarif_dick_gemessen;
  const k = t.koeffizienten[g];
  return Math.exp(k.b0 + k.b1 * Math.log(bhd) + k.b2 * Math.log(ho)) * t.sicherheit;
}
/**
 * Klassen-Zählvolumen nur für den Vorschlag (zaehlvolumen_klasse_fuer_vorschlag).
 * FESTLEGUNG: Im Folgeeingriff wird der Wachstumsfaktor wie bei den Stufen auf dünn und mittel angewendet, nicht auf dick.
 */
export function vKlasse(g, klasse, ho, eingriffNr = 1, f = null) {
  const z = parameter().zaehlvolumen_klasse_fuer_vorschlag;
  const k = z.koeffizienten[g][klasse];
  const sicherheit = Number(/\*\s*([\d.]+)\s*$/.exec(z.formel)?.[1]) || 1; // Sicherheitsfaktor steht in der Formel der JSON
  return Math.exp(k.a + k.b * Math.log(ho)) * sicherheit * (klasse === 'dick' ? 1 : faktor(eingriffNr, f));
}
/** Stärkeklasse einer Zählstufe (7–15 und 15–25 → dünn, 25–35 und 35–50 → mittel) */
export function klasseDerStufe(stufe) {
  const s = parameter().zaehlstufen_unter_50cm.find((x) => x.id === Number(stufe));
  return s.bis <= 25 ? 'duenn' : 'mittel';
}
/** Zählstufe zu einem BHD unter 50 cm (15 ≤ BHD < 25 → Stufe „15–25“ usw.) */
export function stufeZuBhd(bhd) {
  const st = parameter().zaehlstufen_unter_50cm;
  if (!(bhd >= st[0].von) || bhd > st[st.length - 1].bis) return null;
  const s = st.find((x) => bhd < x.bis) || st[st.length - 1]; // genau 50 cm gehört noch zur Stufe 35–50 (dick erst über 50)
  return s.id;
}

// ---------- Grundfläche (Mindestnutzung) ----------

/** Grundfläche eines Baums (m²): Stufe → angerechneter BHD (Untergrenze), dick → gemessener BHD; g = π/4 · (BHD/100)² */
export function grundflaecheBaum(b) {
  const m = parameter().mindestnutzung;
  const bhd = b.klasse === 'dick' || b.stufe == null ? Number(b.bhd) : Number(m.angerechneter_bhd_je_stufe_cm[String(b.stufe)]);
  return bhd > 0 ? (Math.PI / 4) * (bhd / 100) ** 2 : 0;
}
/** Mindestnutzung erfüllt? gezählte Grundfläche ≥ 0,5 m²/ha × Fläche */
export function mindestnutzungErfuellt(gezaehltG, flaecheHa) {
  return gezaehltG >= parameter().mindestnutzung.grundflaeche_m2ha_je_jahrzehnt * flaecheHa - 1e-12;
}
/** Höchstzahl Bäume je Rasterpunkt und Eingriff */
export const maxBaeumeJePunkt = () => parameter().raster.max_baeume_je_punkt;

// ---------- Zähler (verbindlich) ----------

/**
 * Mengenzähler eines Eingriffs. Die Sperre „gezählt + v ≤ Budget“ ist die einzige Stelle, an der Bäume
 * hinzukommen – auch beim Laden eines gespeicherten Stands (ausJSON) wird jeder Baum erneut geprüft.
 */
export class Zaehler {
  /**
   * @param {{ budget: number, punkte: number, hauptklasse: string, nebenklasse: string, anteilHaupt: number, vKlasse: Record<string, number> }} o
   */
  constructor({ budget, punkte, hauptklasse, nebenklasse, anteilHaupt, vKlasse: vk, obergrenze = null, maxJePunkt = null }) {
    this.budget = budget;
    this.obergrenze = obergrenze ?? budget; // 50 m³/ha × Fläche – nur für die Mindestnutzung relevant
    this.maxJePunkt = maxJePunkt ?? maxBaeumeJePunkt();
    this.mindest = false;
    this.punkte = punkte;
    this.hauptklasse = hauptklasse;
    this.nebenklasse = nebenklasse;
    this.anteilHaupt = anteilHaupt;
    this.vk = vk;
    this.baeume = [];
    this.defizit = Object.fromEntries(KLASSEN.map((k) => [k, 0]));
    this.angekommen = [];
    this.nr = 0;
  }
  get gezaehlt() { return this.baeume.reduce((a, b) => a + b.v, 0); }
  get rest() { return Math.max(0, this.budget - this.gezaehlt); }
  /** Geltende Grenze: Budget; bei der Mindestnutzung höchstens 50 m³/ha × Fläche */
  get grenze() { return this.mindest ? Math.max(this.budget, this.obergrenze) : this.budget; }
  /** Zahl der ausgezeichneten Bäume an einem Rasterpunkt */
  amPunkt(punkt) { return punkt == null ? 0 : this.baeume.filter((b) => b.punkt === punkt).length; }
  /** Gezählte Grundfläche (m²) – Stufen-Untergrenze bzw. gemessener BHD */
  grundflaecheGezaehlt() { return this.baeume.reduce((a, b) => a + grundflaecheBaum(b), 0); }
  /** Warum ein Baum nicht passt: 'menge' | 'punkt' | null */
  sperre(v, punkt = null) {
    if (!(v > 0) || this.gezaehlt + v > this.grenze) return 'menge';
    if (punkt != null && this.amPunkt(punkt) >= this.maxJePunkt) return 'punkt';
    return null;
  }
  /** Harte Sperre: gezählt + v ≤ Budget UND höchstens 3 Bäume am Punkt */
  darfAuszeichnen(v, punkt = null) { return this.sperre(v, punkt) === null; }
  /**
   * Baum auszeichnen. Gibt den Baum zurück oder null, wenn er nicht mehr in die Menge passt.
   * baum: { v, klasse, stufe?, bhd?, punkt?, art? }
   */
  auszeichnen(baum) {
    const v = Number(baum.v);
    if (!this.darfAuszeichnen(v, baum.punkt ?? null)) return null;
    const b = { ...baum, v, id: baum.id || `b${++this.nr}`, t: baum.t || Date.now() };
    this.baeume.push(b);
    if (b.klasse in this.defizit) this.defizit[b.klasse] -= v;
    return b;
  }
  /** Baum rückgängig machen: gezählt sinkt um sein Zählvolumen */
  rueckgaengig(id) {
    const i = this.baeume.findIndex((b) => b.id === id);
    if (i < 0) return null;
    const [b] = this.baeume.splice(i, 1);
    if (b.klasse in this.defizit) this.defizit[b.klasse] += b.v;
    return b;
  }
  /** Eintreffen am Punkt j (1-basiert): Zuteilung = (Budget − gezählt) / (P − j + 1), auf Haupt- und Nebenklasse verteilt */
  ankunft(punktId, j) {
    if (this.angekommen.includes(punktId)) return this.vorschlag(punktId);
    const zuteilung = this.rest / Math.max(1, this.punkte - j + 1);
    this.defizit[this.hauptklasse] += zuteilung * this.anteilHaupt;
    this.defizit[this.nebenklasse] += zuteilung * (1 - this.anteilHaupt);
    this.angekommen.push(punktId);
    return this.vorschlag(punktId);
  }
  /** Vorschlag: wiederholt die Klasse mit dem größten defizit / v_klasse wählen, solange defizit ≥ 0,5 × v_klasse – höchstens 3 Bäume je Punkt */
  vorschlag(punkt = null) {
    const d = { ...this.defizit }, n = {};
    const frei = this.maxJePunkt - this.amPunkt(punkt);
    for (let i = 0; i < frei; i++) {
      const c = KLASSEN.filter((k) => this.vk[k] > 0).sort((x, y) => d[y] / this.vk[y] - d[x] / this.vk[x])[0];
      if (!c || d[c] < 0.5 * this.vk[c]) break;
      n[c] = (n[c] || 0) + 1;
      d[c] -= this.vk[c];
    }
    return KLASSEN.filter((k) => n[k]).map((k) => ({ klasse: k, anzahl: n[k] }));
  }
  /** Kopie zum Vorausrechnen (ohne erneute Prüfung, verändert den echten Stand nicht) */
  kopie() {
    const z = new Zaehler({ budget: this.budget, punkte: this.punkte, hauptklasse: this.hauptklasse, nebenklasse: this.nebenklasse, anteilHaupt: this.anteilHaupt, vKlasse: this.vk, obergrenze: this.obergrenze, maxJePunkt: this.maxJePunkt });
    z.mindest = this.mindest;
    z.baeume = this.baeume.map((b) => ({ ...b })); z.defizit = { ...this.defizit }; z.angekommen = [...this.angekommen]; z.nr = this.nr;
    return z;
  }
  /**
   * Welche der noch anzulaufenden Punkte (in Laufreihenfolge) bekommen keinen Baum?
   * FESTLEGUNG: Vorausrechnung unter der Annahme, dass am Punkt genau der Vorschlag mit v_klasse
   * ausgezeichnet wird. Für den nächsten Punkt ist das Ergebnis exakt (hängt nur vom jetzigen Stand ab),
   * für spätere Punkte eine Vorschau, die nach jedem Punkt neu gerechnet wird.
   */
  leerePunkte(ids) {
    const z = this.kopie(), leer = new Set();
    for (const id of ids) {
      if (z.angekommen.includes(id)) continue;
      const vs = z.ankunft(id, z.angekommen.length + 1);
      if (!vs.length) { leer.add(id); continue; }
      for (const { klasse, anzahl } of vs) for (let i = 0; i < anzahl; i++) z.auszeichnen({ v: z.vk[klasse], klasse, punkt: id });
    }
    return leer;
  }
  toJSON() {
    return { mindest: this.mindest, budget: this.budget, punkte: this.punkte, hauptklasse: this.hauptklasse, nebenklasse: this.nebenklasse, anteilHaupt: this.anteilHaupt, vKlasse: this.vk, baeume: this.baeume, defizit: this.defizit, angekommen: this.angekommen, nr: this.nr };
  }
  /** Gespeicherten Stand laden – jeder Baum durchläuft erneut die Sperre (kein Umgehen über Import) */
  static ausJSON(o, budgetVorgabe = null, obergrenzeVorgabe = null) {
    // Budget und Obergrenze kommen aus dem Plan, nie aus dem gespeicherten Stand
    const budget = budgetVorgabe ?? o.budget;
    const z = new Zaehler({ budget, punkte: o.punkte, hauptklasse: o.hauptklasse, nebenklasse: o.nebenklasse, anteilHaupt: o.anteilHaupt, vKlasse: o.vKlasse, obergrenze: obergrenzeVorgabe ?? budget });
    z.mindest = !!o.mindest;
    z.nr = o.nr || 0;
    for (const b of o.baeume || []) z.auszeichnen(b);
    z.defizit = { ...z.defizit, ...(o.defizit || {}) };
    z.angekommen = [...(o.angekommen || [])];
    return z;
  }
}

// ---------- Hilfen für die Planung ----------

/** Alles, was die Planung (Schritt 4) anzeigt */
export function planung({ art, nadel = null, ho, b, sz, flaecheHa, eingriffNr = 1, bisherGezaehltHa = 0 }) {
  const g = gruppe(art, { nadel });
  const hk = hoehenklasse(ho), bs = bstufe(b);
  const f = feld(g, hk, bs, sz);
  if (!f) return { gruppe: g, hoehenklasse: hk, bstufe: bs, szenario: sz, feld: null };
  const E = anzahlEingriffe(f.zielmenge_m3ha);
  const mHa = mengeEingriff(f.zielmenge_m3ha, bisherGezaehltHa, E, eingriffNr);
  const stufen = parameter().zaehlstufen_unter_50cm.map((s) => ({ ...s, klasse: klasseDerStufe(s.id), v: zaehlvolumenStufe(g, s.id, ho, eingriffNr, f) }));
  const vk = Object.fromEntries(KLASSEN.map((k) => [k, vKlasse(g, k, ho, eingriffNr, f)]));
  return {
    gruppe: g, hoehenklasse: hk, bstufe: bs, szenario: Number(sz), feld: f,
    zielmenge: f.zielmenge_m3ha, eingriffe: E, eingriffNr, abstandJahre: abstandJahre(E),
    mengeHa: mHa, budget: mHa * flaecheHa, flaecheHa,
    hauptklasse: f.hauptklasse, nebenklasse: f.nebenklasse, anteilHaupt: f.anteil_haupt,
    stufen, vKlasse: vk, kleinstesStufenVolumen: Math.min(...stufen.map((s) => s.v)),
    obergrenzeBestand: parameter().obergrenze_je_eingriff_m3ha * flaecheHa,
    mindestG: parameter().mindestnutzung.grundflaeche_m2ha_je_jahrzehnt * flaecheHa,
    letzterEingriff: eingriffNr >= E,
    rasterAbstand: rasterAbstand(sz),
  };
}
