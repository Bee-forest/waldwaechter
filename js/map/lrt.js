// Wald-Lebensraumtypen (FFH-RL Anhang I) in Thüringen – Kurzfassung der Steckbriefe der TLWJF
// (Boddenberg, Seiler, Henkel, Stand 08.12.2003). Baumarten-Kürzel wie im Steckbrief.
// nadel: Nadelholz-LRT – in der Regel keine Einschränkung der Nutzung (Festlegung Auftraggeberin).

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

/** Was der LRT für Durchforstung und Nutzung bedeutet – in einfachen Worten */
export function lrtHinweis(code) {
  const l = LRT[code];
  if (!l) return null;
  const punkte = [];
  if (l.nadel) {
    punkte.push('Nadelholz-Lebensraumtyp: Die Nutzung ist in der Regel nicht eingeschränkt. Die Durchforstung kann wie geplant laufen.');
    if (/immer §18/.test(l.p18)) punkte.push(`Achtung, ${l.p18}: Wasserhaushalt nicht verändern (keine Gräben), nasse Bereiche nicht befahren.`);
    else if (/nass/.test(l.p18)) punkte.push('Auf nassen, sehr feuchten oder Block-Standorten ist er zugleich §18-Biotop: dort Wasserhaushalt nicht verändern, nasse Bereiche nicht befahren.');
  } else {
    punkte.push(`Lebensraumtypische Baumarten fördern: Hauptbaumarten ${l.haupt}; Mischbaumarten ${l.misch}. Sie müssen zusammen mehr als die Hälfte der Kronen stellen.`);
    punkte.push('Gesellschaftsfremde Baumarten (z. B. Douglasie, Lärche; in Laubwald-LRT oft auch Fichte) bevorzugt entnehmen – ihr Anteil muss unter 30 % bleiben.');
    punkte.push('Verschlechterungsverbot: keine Kahlschläge, Biotop- und Höhlenbäume sowie stehendes und liegendes Totholz erhalten.');
    if (l.prioritaer || /immer §18/.test(l.p18)) punkte.push(`${l.prioritaer ? 'Prioritärer Lebensraum. ' : ''}${l.p18[0].toUpperCase()}${l.p18.slice(1)}: Maßnahmen vorher mit dem Forstamt bzw. der Unteren Naturschutzbehörde abstimmen.`);
    else if (/§18/.test(l.p18) && !/kein/.test(l.p18)) punkte.push(`${l.p18[0].toUpperCase()}${l.p18.slice(1)}.`);
  }
  return { code, ...l, punkte, titel: `LRT ${l.prioritaer ? '*' : ''}${code} ${l.name}` };
}
