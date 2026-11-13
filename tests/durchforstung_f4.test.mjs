// Unit-Tests der Durchforstungshilfe Fassung 4 (node tests/durchforstung_f4.test.mjs)
import { readFileSync } from 'node:fs';
import * as F from '../js/thinning/f4.js';

F.setzeParameter(JSON.parse(readFileSync(new URL('../data/durchforstung_parameter_f4.json', import.meta.url))));
let fehler = 0, ok = 0;
const r3 = (v) => Math.round(v * 1000) / 1000;
const gleich = (name, ist, soll) => {
  const pass = typeof soll === 'number' ? r3(ist) === r3(soll) : JSON.stringify(ist) === JSON.stringify(soll);
  if (pass) ok++; else { fehler++; console.log(`FEHLER ${name}: ist ${JSON.stringify(typeof ist === 'number' ? r3(ist) : ist)}, soll ${JSON.stringify(soll)}`); }
};

// 1 Douglasie, ho 39,27, B° 0,62, Szenario 1, Fläche 0,5 ha
const d = F.planung({ art: 'Douglasie', ho: 39.27, b: 0.62, sz: 1, flaecheHa: 0.5 });
gleich('Dgl Feld', [d.gruppe, d.hoehenklasse, d.bstufe, d.szenario], ['Fi/Ta/Dgl', '>=30', '0,6', 1]);
gleich('Dgl Zielmenge', d.zielmenge, 55.8);
gleich('Dgl Eingriffe', d.eingriffe, 2);
gleich('Dgl M1', d.mengeHa, 27.9);
gleich('Dgl Budget', d.budget, 13.95);
// 2 Stufen-Zählvolumen
[0.060, 0.368, 1.091, 2.513].forEach((v, s) => gleich(`Dgl Stufe ${s}`, F.zaehlvolumenStufe('Fi/Ta/Dgl', s, 39.27), v));
// 3 dicke Bäume
gleich('Dgl dick 58', F.zaehlvolumenDick('Fi/Ta/Dgl', 58, 39.27), 4.842);
gleich('Dgl dick 72', F.zaehlvolumenDick('Fi/Ta/Dgl', 72, 39.27), 8.735);
// 4 Folgeeingriff
gleich('Dgl M2', F.mengeEingriff(55.8, 25.9, 2, 2), 29.9);
// Hinweis: Die Beschreibung nennt 1,158 = 1,089 × 1,063 (mit gerundetem Stufenwert). Ohne Zwischenrundung
// (Vorgabe „keine Werte runden außer für die Anzeige“) ergibt sich 1,08884 × 1,063 = 1,157.
gleich('Dgl Stufe 25–35 im 2. Eingriff', F.zaehlvolumenStufe('Fi/Ta/Dgl', 2, 39.27, 2, d.feld), F.zaehlvolumenStufe('Fi/Ta/Dgl', 2, 39.27) * 1.063);
gleich('Dgl Stufe 25–35 im 2. Eingriff', F.zaehlvolumenStufe('Fi/Ta/Dgl', 2, 39.27, 2, d.feld), 1.160);
// 5 Buche, ho 22, B° 0,93, Szenario 3
const bu = F.planung({ art: 'Buche', ho: 22, b: 0.93, sz: 3, flaecheHa: 1 });
gleich('Bu Feld', [bu.gruppe, bu.hoehenklasse, bu.bstufe, bu.szenario], ['Bu/Laub', '<25', '0,9', 3]);
gleich('Bu Zielmenge', bu.zielmenge, 35.7);
gleich('Bu Eingriffe', bu.eingriffe, 1);
gleich('Bu M1', bu.mengeHa, 35.7);
gleich('Bu Klassen', [bu.hauptklasse, bu.anteilHaupt, bu.nebenklasse], ['duenn', 0.84, 'mittel']);
// 6 Buche, Stufen und Tarif
[0.083, 0.294, 0.831, 1.812].forEach((v, s) => gleich(`Bu Stufe ${s}`, F.zaehlvolumenStufe('Bu/Laub', s, 22), v));
gleich('Bu Tarif 54', F.zaehlvolumenDick('Bu/Laub', 54, 22), 4.343);
// 7 Traubeneiche, ho 27, B° 0,42, Szenario 2
const ei = F.planung({ art: 'Traubeneiche', ho: 27, b: 0.42, sz: 2, flaecheHa: 1 });
gleich('Ei Feld', [ei.gruppe, ei.hoehenklasse, ei.bstufe, ei.szenario], ['Eiche', '25-30', '<0,5', 2]);
gleich('Ei Zielmenge', ei.zielmenge, 7.4);
gleich('Ei Eingriffe', ei.eingriffe, 1);
// 8 Zähler-Sperre
const z = new F.Zaehler({ budget: 13.95, punkte: 8, hauptklasse: 'dick', nebenklasse: 'mittel', anteilHaupt: 0.8, vKlasse: d.vKlasse });
z.auszeichnen({ v: 13.5, klasse: 'dick' });
gleich('Sperre darf', z.darfAuszeichnen(0.831), false);
gleich('Sperre auszeichnen', z.auszeichnen({ v: 0.831, klasse: 'mittel' }), null);
gleich('Sperre gezählt bleibt', z.gezaehlt, 13.5);
// Sperre auch beim Import: gespeicherter Stand mit zu vielen Bäumen
const manipuliert = { ...z.toJSON(), baeume: [...z.toJSON().baeume, { id: 'x', v: 5, klasse: 'dick' }] };
gleich('Sperre beim Import', F.Zaehler.ausJSON(manipuliert).gezaehlt, 13.5);
// Rückgängig
const z2 = new F.Zaehler({ budget: 10, punkte: 4, hauptklasse: 'mittel', nebenklasse: 'dick', anteilHaupt: 0.9, vKlasse: d.vKlasse });
const b1 = z2.auszeichnen({ v: 2, klasse: 'mittel' }); z2.auszeichnen({ v: 3, klasse: 'mittel' });
z2.rueckgaengig(b1.id);
gleich('Rückgängig', z2.gezaehlt, 3);
// 9 B°-Stufen
gleich('B° 0,59', F.bstufe(0.59), '0,5'); gleich('B° 1,25', F.bstufe(1.25), '>=1,2'); gleich('B° 0,45', F.bstufe(0.45), '<0,5');
gleich('B° 0,7', F.bstufe(0.7), '0,7'); gleich('B° 1,0', F.bstufe(1.0), '1,0'); gleich('B° 1,19', F.bstufe(1.19), '1,1');
// 10 Höhenklassen
gleich('ho 25,0', F.hoehenklasse(25.0), '25-30'); gleich('ho 29,99', F.hoehenklasse(29.99), '25-30'); gleich('ho 30,0', F.hoehenklasse(30.0), '>=30');
// Szenario aus der Probezählung
gleich('Szenario dick', F.szenario(10, 20, 45), 1);
gleich('Szenario uneindeutig', F.szenario(35, 30, 35), null);
gleich('Szenario Rückfall', F.szenarioMitRueckfall(35, 30, 36).szenario, 1);
gleich('Szenario dünn', F.szenario(50, 30, 20), 3);
// Eingriffsregel
gleich('E 39,9', F.anzahlEingriffe(39.9), 1); gleich('E 40', F.anzahlEingriffe(40), 2); gleich('E 100', F.anzahlEingriffe(100), 3);
// Vorschlag
const z3 = new F.Zaehler({ budget: 13.95, punkte: 7, hauptklasse: 'dick', nebenklasse: 'mittel', anteilHaupt: 0.8, vKlasse: d.vKlasse });
const vs = z3.ankunft('p1', 1);
gleich('Vorschlag hat Klassen', vs.every((x) => ['dick', 'mittel'].includes(x.klasse)), true);
// Obergrenze: keine Kombination ergibt mehr als 50 m³/ha je Eingriff
const P = F.parameter();
const maxM = Math.max(...P.feldtabelle.map((f) => F.mengeEingriff(f.zielmenge_m3ha, 0, F.anzahlEingriffe(f.zielmenge_m3ha), 1)));
gleich('Obergrenze', maxM <= P.obergrenze_je_eingriff_m3ha, true);
gleich('Gruppe Strobe', F.gruppe('Strobe'), 'Fi/Ta/Dgl'); gleich('Gruppe Schwarzkiefer', F.gruppe('Schwarzkiefer'), 'Ki/Lä'); gleich('Gruppe Hainbuche', F.gruppe('Hainbuche'), 'Bu/Laub');

// Stufe aus gemessenem BHD (Grenzwert zur unteren Stufe)
gleich('BHD 14,9 → Stufe 0', F.stufeZuBhd(14.9), 0); gleich('BHD 15 → Stufe 1', F.stufeZuBhd(15), 1); gleich('BHD 25 → Stufe 2', F.stufeZuBhd(25), 2); gleich('BHD 25,5 → Stufe 2', F.stufeZuBhd(25.5), 2); gleich('BHD 50 → Stufe 3', F.stufeZuBhd(50), 3); gleich('BHD 6 → keine', F.stufeZuBhd(6), null); gleich('BHD 51 → keine', F.stufeZuBhd(51), null);
// Leere Punkte: kleines Budget, viele Punkte → einige Punkte ohne Baum; Vorhersage verändert den Stand nicht
{
  const z = new F.Zaehler({ budget: 1.0, punkte: 10, hauptklasse: 'duenn', nebenklasse: 'mittel', anteilHaupt: 1, vKlasse: { duenn: 0.3, mittel: 1, dick: 3 } });
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const leer = z.leerePunkte(ids);
  gleich('leere Punkte vorhanden', leer.size > 0 && leer.size < 10, true);
  gleich('Vorhersage unverändert', z.angekommen.length + z.baeume.length, 0);
  // exakt für den ersten Punkt
  gleich('erster Punkt exakt', leer.has(1), z.kopie().ankunft(1, 1).length === 0);
}
// Fassung 4 (13.11.2026): höchstens 3 Bäume je Punkt
{
  const z = new F.Zaehler({ budget: 100, punkte: 5, hauptklasse: 'mittel', nebenklasse: 'dick', anteilHaupt: 0.8, vKlasse: { duenn: 0.1, mittel: 0.5, dick: 3 } });
  for (let i = 0; i < 3; i++) z.auszeichnen({ v: 0.5, klasse: 'mittel', punkt: 7 });
  gleich('4. Baum am Punkt gesperrt', z.darfAuszeichnen(0.5, 7), false);
  gleich('4. Baum Grund', z.sperre(0.5, 7), 'punkt');
  gleich('4. Baum nicht gezählt', z.auszeichnen({ v: 0.5, klasse: 'mittel', punkt: 7 }), null);
  gleich('anderer Punkt frei', z.darfAuszeichnen(0.5, 8), true);
  const z3 = new F.Zaehler({ budget: 100, punkte: 2, hauptklasse: 'mittel', nebenklasse: 'dick', anteilHaupt: 0.8, vKlasse: { duenn: 0.1, mittel: 0.5, dick: 3 } });
  const v3 = z3.ankunft(1, 1);
  gleich('Vorschlag höchstens 3', v3.reduce((a, x) => a + x.anzahl, 0), 3);
  const imp = z.toJSON(); imp.baeume.push({ v: 0.5, klasse: 'mittel', punkt: 7, id: 'x' });
  gleich('Import: 4. Baum am Punkt verworfen', F.Zaehler.ausJSON(imp).amPunkt(7), 3);
}
// Mindestnutzung (Grundfläche)
gleich('g Stufe 15–25', F.grundflaecheBaum({ klasse: 'duenn', stufe: 1 }), 0.0177);
gleich('Mindest 0,20 + 2 × 0,0177 < 0,25', [r3(0.20 + 2 * F.grundflaecheBaum({ klasse: 'duenn', stufe: 1 })), F.mindestnutzungErfuellt(0.20 + 2 * F.grundflaecheBaum({ klasse: 'duenn', stufe: 1 }), 0.5)], [0.235, false]);
gleich('Mindest erfüllt bei 0,25', F.mindestnutzungErfuellt(0.25, 0.5), true);
gleich('g dick 60 cm gemessen', F.grundflaecheBaum({ klasse: 'dick', bhd: 60 }), 0.283);
{
  const z = new F.Zaehler({ budget: 1, obergrenze: 25, punkte: 5, hauptklasse: 'duenn', nebenklasse: 'mittel', anteilHaupt: 0.8, vKlasse: { duenn: 0.1, mittel: 0.5, dick: 3 } });
  z.auszeichnen({ v: 0.9, klasse: 'mittel', punkt: 1 });
  gleich('ohne Mindest: Budget gilt', z.darfAuszeichnen(0.5, 2), false);
  z.mindest = true;
  gleich('Mindest: Budget darf überschritten werden', z.darfAuszeichnen(0.5, 2), true);
  gleich('Mindest: nie über 50 m³/ha × Fläche', z.darfAuszeichnen(24.2, 2), false);
  gleich('Mindest-Import: Obergrenze aus dem Plan', F.Zaehler.ausJSON({ ...z.toJSON(), baeume: [...z.baeume, { v: 30, klasse: 'dick', bhd: 90, punkt: 3 }] }, 1, 25).gezaehlt, 0.9);
}
// Raster: Szenario 3 → 12,5 m, sonst 25 m
gleich('Raster Szenario 3', F.rasterAbstand(3), 12.5); gleich('Raster Szenario 1', F.rasterAbstand(1), 25);
console.log(`${ok} Tests bestanden, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
