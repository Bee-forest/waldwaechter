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
[0.059, 0.368, 1.089, 2.506].forEach((v, s) => gleich(`Dgl Stufe ${s}`, F.zaehlvolumenStufe('Fi/Ta/Dgl', s, 39.27), v));
// 3 dicke Bäume
gleich('Dgl dick 58', F.zaehlvolumenDick('Fi/Ta/Dgl', 58, 39.27), 4.842);
gleich('Dgl dick 72', F.zaehlvolumenDick('Fi/Ta/Dgl', 72, 39.27), 8.736);
// 4 Folgeeingriff
gleich('Dgl M2', F.mengeEingriff(55.8, 25.9, 2, 2), 29.9);
// Hinweis: Die Beschreibung nennt 1,158 = 1,089 × 1,063 (mit gerundetem Stufenwert). Ohne Zwischenrundung
// (Vorgabe „keine Werte runden außer für die Anzeige“) ergibt sich 1,08884 × 1,063 = 1,157.
gleich('Dgl Stufe 25–35 im 2. Eingriff', F.zaehlvolumenStufe('Fi/Ta/Dgl', 2, 39.27, 2, d.feld), F.zaehlvolumenStufe('Fi/Ta/Dgl', 2, 39.27) * 1.063);
gleich('Dgl Stufe 25–35 im 2. Eingriff (exakt)', F.zaehlvolumenStufe('Fi/Ta/Dgl', 2, 39.27, 2, d.feld), 1.157);
gleich('… mit gerundetem Stufenwert wie in der Beschreibung', r3(F.zaehlvolumenStufe('Fi/Ta/Dgl', 2, 39.27)) * d.feld.faktor_zaehlvolumen_folgeeingriff, 1.158);
// 5 Buche, ho 22, B° 0,93, Szenario 3
const bu = F.planung({ art: 'Buche', ho: 22, b: 0.93, sz: 3, flaecheHa: 1 });
gleich('Bu Feld', [bu.gruppe, bu.hoehenklasse, bu.bstufe, bu.szenario], ['Bu/Laub', '<25', '0,9', 3]);
gleich('Bu Zielmenge', bu.zielmenge, 35.7);
gleich('Bu Eingriffe', bu.eingriffe, 1);
gleich('Bu M1', bu.mengeHa, 35.7);
gleich('Bu Klassen', [bu.hauptklasse, bu.anteilHaupt, bu.nebenklasse], ['duenn', 0.84, 'mittel']);
// 6 Buche, Stufen und Tarif
[0.083, 0.294, 0.833, 1.808].forEach((v, s) => gleich(`Bu Stufe ${s}`, F.zaehlvolumenStufe('Bu/Laub', s, 22), v));
gleich('Bu Tarif 54', F.zaehlvolumenDick('Bu/Laub', 54, 22), 4.335);
// 7 Traubeneiche, ho 27, B° 0,42, Szenario 2
const ei = F.planung({ art: 'Traubeneiche', ho: 27, b: 0.42, sz: 2, flaecheHa: 1 });
gleich('Ei Feld', [ei.gruppe, ei.hoehenklasse, ei.bstufe, ei.szenario], ['Eiche', '25-30', '<0,5', 2]);
gleich('Ei Zielmenge', ei.zielmenge, 7.4);
gleich('Ei Eingriffe', ei.eingriffe, 1);
// 8 Zähler-Sperre
const z = new F.Zaehler({ budget: 13.95, punkte: 8, hauptklasse: 'dick', nebenklasse: 'mittel', anteilHaupt: 0.8, vKlasse: d.vKlasse });
z.auszeichnen({ v: 13.5, klasse: 'dick' });
gleich('Sperre darf', z.darfAuszeichnen(0.833), false);
gleich('Sperre auszeichnen', z.auszeichnen({ v: 0.833, klasse: 'mittel' }), null);
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

console.log(`${ok} Tests bestanden, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
