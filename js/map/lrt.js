// Wald-Lebensraumtypen (FFH-RL Anhang I) in Thüringen – Kurzfassung der Steckbriefe der TLWJF
// (Boddenberg, Seiler, Henkel, Stand 08.12.2003). Baumarten-Kürzel wie im Steckbrief.
// nadel: Nadelholz-LRT – für die Bewirtschaftung in der Regel ohne Bedeutung (Festlegung Auftraggeberin).
// Bewertung nach „Bewertungsmatrices für die Wald-LRT in Thüringen“ (TLWJF, 03.05.2004), Stufe B = gute Ausprägung.

export const LRT = {
  '9110': { name: 'Hainsimsen-Buchenwald', haupt: 'Buche, z. T. Eiche', misch: 'Eiche, Kiefer (Ostthüringen), Fichte, Tanne', begleit: 'Tanne, Birke, Aspe, Fichte, Bergahorn, Eberesche, Kiefer', p18: 'kein §18-Biotop' },
  '9130': { name: 'Waldmeister-Buchenwald', haupt: 'Buche, z. T. Eiche', misch: 'Eiche, Esche; in Berglagen Fichte, Tanne, Bergahorn, Bergulme', begleit: 'Bergahorn, Winterlinde, Hainbuche, Spitzahorn, Sommerlinde, Elsbeere, Ulme, Kirsche', p18: 'kein §18-Biotop' },
  '9150': { name: 'Orchideen-Kalk-Buchenwald', haupt: 'Buche, z. T. Eiche', misch: 'Hainbuche, Eiche, Berg-, Spitz- und Feldahorn, Esche', begleit: 'Eibe, Elsbeere, Sommerlinde, Mehlbeere, Speierling, Birke, Wildapfel, Eberesche, Kirsche', p18: 'auf trockenen Standorten §18-Biotop (Trockenwald)' },
  '9160': { name: 'Sternmieren-Eichen-Hainbuchenwald', haupt: 'Eiche, Hainbuche', misch: 'Winterlinde', begleit: 'Buche, Berg-, Spitz- und Feldahorn, Esche, Sommerlinde, Ulmen, Roterle, Kirsche', p18: 'kein §18-Biotop' },
  '9170': { name: 'Labkraut-Eichen-Hainbuchenwald', haupt: 'Eiche, Hainbuche', misch: 'Winterlinde, Esche', begleit: 'Buche, Berg-, Spitz- und Feldahorn, Sommerlinde, Elsbeere, Mehlbeere, Speierling, Ulmen, Kirsche', p18: 'auf trockenen Standorten §18-Biotop (Trockenwald)' },
  '9180': { name: 'Schlucht- und Hangmischwald', prioritaer: true, haupt: 'Bergahorn, Esche, Sommer- und Winterlinde, Bergulme (z. T. Buche oder Fichte, immer in Mischung)', misch: 'Spitzahorn, Feldahorn, Ulme, Buche; Fichte in Berglagen', begleit: 'Hainbuche, Eiche, Tanne, Roterle, Eberesche, Elsbeere, Mehlbeere, Eibe, Birke', p18: 'immer §18-Biotop (Schlucht-, Felsschutt- und Blockwälder)' },
  '9410': { name: 'Bodensaurer Fichtenwald (montan bis hochmontan)', nadel: true, haupt: 'Fichte', misch: 'Eberesche, Birke, Tanne, Kiefer', begleit: 'Buche, Bergahorn, Esche, Erle', p18: 'nur auf nassen/sehr feuchten oder Block-Standorten §18-Biotop' },
  '91D0': { name: 'Moorwald', prioritaer: true, nadel: true, haupt: 'Birke, Fichte, Kiefer, Roterle', misch: 'Birke', begleit: 'Eberesche', p18: 'immer §18-Biotop (Moor-, Bruch- und Sumpfwälder)' },
  '91E0': { name: 'Erlen- und Eschen-Auenwald', prioritaer: true, haupt: 'Esche, Roterle, Weiden, Schwarzpappel', misch: 'Bergahorn; Fichte in höheren Berglagen', begleit: 'Traubenkirsche, Eiche, Ulmen, Fichte (mittlere/untere Berglagen)', p18: 'immer §18-Biotop (Auwälder)' },
  '91F0': { name: 'Eichen-Ulmen-Eschen-Hartholzauenwald', haupt: 'Esche, Eiche, Feld- und Flatterulme', misch: '–', begleit: 'Bergahorn, Hainbuche, Winterlinde, Feldahorn, Bergulme, Wildapfel, Birke, Traubenkirsche, Kirsche, Eberesche, Schwarzpappel, Roterle', p18: 'immer §18-Biotop (Auwälder)' },
};

/** LRT-Code in den Sachdaten eines Geoportal-Objekts finden (z. B. „9130“, „*91E0“) */
export function lrtCode(props = {}) {
  for (const v of Object.values(props)) {
    const m = String(v).match(/\*?\b(9[1-4][0-9][0-9A-F]|91[D-F]0)\b/i);
    if (m && LRT[m[1].toUpperCase()]) return m[1].toUpperCase();
  }
  return null;
}

/** Ist der LRT für die Bewirtschaftung wichtig? Nadelholz-LRT nur, wenn sie immer §18-Biotop sind (Moorwald). */
export const lrtWichtig = (code) => { const l = LRT[code]; return !!l && (!l.nadel || /immer §18/.test(l.p18)); };

// Biotope aus der Waldbiotopkartierung, die nur Nadelholzbestände beschreiben, sind für die Bewirtschaftung unwichtig
export const biotopWichtig = (name = '', props = {}) => {
  const t = name || Object.entries(props).filter(([k]) => /name|bezeich|typ|text/i.test(k)).map(([, v]) => v).join(' ');
  return !/^(\S+\s)?(fichten|kiefern|lärchen|laerchen|douglasien|nadel)/i.test(t.trim()) && !/nadel(holz|wald|forst)/i.test(t);
};

// Was einen guten Erhaltungszustand (Stufe B) ausmacht – Bewertungsmatrix TLWJF 2004
export const ERHALTUNG_B = [
  'Mindestens 3 Biotop- oder Altbäume je Hektar stehen lassen (hervorragend: mehr als 6). Biotopbäume sind Höhlen- und Horstbäume sowie Bäume ab 35 cm BHD mit Faulstellen, Pilzkonsolen, abgebrochener Krone oder abfallender Rinde.',
  'Mindestens 1 starkes Totholz je Hektar liegen oder stehen lassen (hervorragend: mehr als 3, liegend und stehend). Starkes Totholz: ab 3 m Länge und bei Buche/Eiche ab 50 cm, Edellaubholz ab 40 cm, sonstigem Laubholz ab 30 cm Durchmesser.',
  'Lebensraumtypische Gehölze über 80 % der Kronen, davon lebensraumtypische Haupt- und Mischbaumarten über 60 %.',
  'Waldboden schonen: auf höchstens einem Drittel der Fläche Spuren durch Befahren, nur auf Rückegassen fahren.',
];

/** Was der LRT für Durchforstung und Nutzung bedeutet – in einfachen Worten (nur für wichtige LRT) */
export function lrtHinweis(code) {
  const l = LRT[code];
  if (!l || !lrtWichtig(code)) return null;
  const punkte = [];
  if (l.nadel) {
    punkte.push(`${l.p18[0].toUpperCase()}${l.p18.slice(1)}: Wasserhaushalt nicht verändern (keine Gräben), nasse Bereiche nicht befahren.`);
  } else {
    punkte.push(`Lebensraumtypische Baumarten fördern: Hauptbaumarten ${l.haupt}; Mischbaumarten ${l.misch}.`);
    punkte.push('Gesellschaftsfremde Baumarten (z. B. Douglasie, Lärche; in Laubwald-LRT oft auch Fichte) bevorzugt entnehmen.');
    punkte.push(...ERHALTUNG_B);
    punkte.push('Keine Kahlschläge (Verschlechterungsverbot).');
    if (l.prioritaer || /immer §18/.test(l.p18)) punkte.push(`${l.prioritaer ? 'Prioritärer Lebensraum. ' : ''}${l.p18[0].toUpperCase()}${l.p18.slice(1)}: Maßnahmen vorher mit dem Forstamt bzw. der Unteren Naturschutzbehörde abstimmen.`);
    else if (/§18/.test(l.p18) && !/kein/.test(l.p18)) punkte.push(`${l.p18[0].toUpperCase()}${l.p18.slice(1)}.`);
  }
  return { code, ...l, punkte, titel: `LRT ${l.prioritaer ? '*' : ''}${code} ${l.name}` };
}
