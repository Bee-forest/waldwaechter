// Förderrecht Thüringen als Daten: Fördersätze, Bedingungen und die Zuordnung der App-Angaben zu den
// Feldern der amtlichen Antragsformulare (GANW 26 = Richtlinie Teil A, LABE 25 = Landesprogramm).
// Quellen: Thüringer Richtlinie zur Förderung forstwirtschaftlicher Maßnahmen 2025 (Teil A, Anlage 1),
// Thüringer Landesprogramm zur Bewältigung der Folgen von Extremwetterereignissen im Wald (Nr. 2.2, Anlage).
// Reine Funktionen ohne DOM – im Browser und in Tests nutzbar.

/** Fördersätze (Festbeträge in €, Anteile als Faktor) */
export const SAETZE = {
  GANW: { pflanzgut: 0.75, pflanzgutHeimisch: 0.85, wildlinge: 0.21, staebe: 0.60, raeumung: 530, mulchen: 1300, pflanzung: 0.47,
    zaun: { reh: 5.40, rot: 7.70, horden: 10.30 }, es: { klein: 3.50, gross: 4.50 }, sicherung: 550, jwp: 475,
    pferd: { abfuhr: 10.40, vorliefern: 5.60 }, seilkran: 0.65 },
  LABE: { pflanzgut: 1.0, pflanzgutHeimisch: 1.0, wildlinge: 0.25, staebe: 0.80, raeumung: 700, mulchen: 1750, pflanzung: 0.60,
    zaun: { reh: 7.00, rot: 10.00, horden: 13.50 }, es: { klein: 4.60, gross: 6.00 }, sicherung: 700 },
};
/** Bagatellgrenzen: Zuwendungen darunter werden nicht bewilligt */
export function bagatelle(prog, kats) {
  if (prog === 'LABE') return 700;
  return kats.length && kats.every((k) => ['sicherung', 'pferd', 'seilkran'].includes(k)) ? 700 : 1000;
}

/** Baumarten mit Einordnung Laub/Nadel und standortheimisch (Thüringen) */
export const BAUMARTEN = [
  ['Rotbuche', 'L', 1], ['Traubeneiche', 'L', 1], ['Stieleiche', 'L', 1], ['Hainbuche', 'L', 1], ['Bergahorn', 'L', 1], ['Spitzahorn', 'L', 1],
  ['Feldahorn', 'L', 1], ['Winterlinde', 'L', 1], ['Sommerlinde', 'L', 1], ['Vogelkirsche', 'L', 1], ['Elsbeere', 'L', 1], ['Speierling', 'L', 1],
  ['Wildbirne', 'L', 1], ['Wildapfel', 'L', 1], ['Bergulme', 'L', 1], ['Flatterulme', 'L', 1], ['Esche', 'L', 1], ['Schwarzerle', 'L', 1],
  ['Sandbirke', 'L', 1], ['Aspe', 'L', 1], ['Eberesche', 'L', 1], ['Edelkastanie', 'L', 0], ['Roteiche', 'L', 0], ['Baumhasel', 'L', 0],
  ['Weißtanne', 'N', 1], ['Gemeine Kiefer', 'N', 1], ['Europäische Lärche', 'N', 0], ['Japanische Lärche', 'N', 0], ['Gemeine Fichte', 'N', 1],
  ['Douglasie', 'N', 0], ['Küstentanne', 'N', 0], ['Eibe', 'N', 1], ['Robinie', 'L', 0], ['Nordmannstanne', 'N', 0], ['Colorado-Tanne', 'N', 0],
  ['Hemlocktanne', 'N', 0], ['Schwarzkiefer', 'N', 0], ['Atlaszeder', 'N', 0], ['Libanonzeder', 'N', 0], ['Blaufichte', 'N', 0], ['Mammutbaum', 'N', 0],
].map(([name, typ, heimisch]) => ({ name, laub: typ === 'L', heimisch: !!heimisch }));
const ALIAS = { Buche: 'Rotbuche', Eiche: 'Traubeneiche', Tanne: 'Weißtanne', Kiefer: 'Gemeine Kiefer', Fichte: 'Gemeine Fichte', Lärche: 'Europäische Lärche', Erle: 'Schwarzerle', Birke: 'Sandbirke', Ahorn: 'Bergahorn', Linde: 'Winterlinde', Esskastanie: 'Edelkastanie', Roterle: 'Schwarzerle', 'Wald-Kiefer': 'Gemeine Kiefer' };
export const normBaumart = (n = '') => ALIAS[n] || n;
// Eigene Baumarten aus der Pflanzplanung (im Gerät gespeichert)
const eigene = (n) => { try { const e = JSON.parse(localStorage.getItem('waldwaechter.eigeneBaumarten') || '[]').find((x) => x.name === n); return e ? { name: e.name, laub: !e.nadel, heimisch: !!e.heimisch } : null; } catch { return null; } };
export const alleBaumarten = () => { try { return [...BAUMARTEN, ...JSON.parse(localStorage.getItem('waldwaechter.eigeneBaumarten') || '[]').filter((e) => !BAUMARTEN.some((b) => b.name === e.name)).map((e) => ({ name: e.name, laub: !e.nadel, heimisch: !!e.heimisch }))]; } catch { return BAUMARTEN; } };
export const baumart = (n) => BAUMARTEN.find((b) => b.name === normBaumart(n)) || eigene(n) || null;

/** Zahl aus deutscher Eingabe („1.234,5“ oder „1234.5“) */
export function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v ?? '').trim().replace(/\s|€/g, '');
  if (!s) return 0;
  const t = /,/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = parseFloat(t);
  return isFinite(n) ? n : 0;
}
export const rund2 = (v) => Math.round(v * 100) / 100;
export const euro = (v) => `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const monatText = (ym) => (ym ? `${ym.slice(5, 7)}/${ym.slice(0, 4)}` : '');

/** Höhe des Einzelschutzes in cm aus Freitext („1,20 m“, „120 cm“, „1.5“) */
export function hoeheCm(t) {
  const v = num(String(t || '').replace(/[^\d.,]/g, ''));
  if (!v) return 0;
  return /cm/i.test(t) || v > 10 ? v : v * 100;
}

/** Förderfähiger Teil einer Maßnahme */
export function kategorie(m, x = {}) {
  const det = m.details || {};
  switch (m.type) {
    case 'pflanzung': return x.art === 'nachbesserung' ? 'nachbesserung' : 'kultur';
    case 'zaunbau': return 'zaun';
    case 'einzelschutz': return 'einzelschutz';
    case 'pflege': {
      const a = x.pflegeArt || ({ Freischneiden: 'sicherung', Jungwuchspflege: 'jungwuchs', Jungbestandspflege: 'dickung', Wertastung: 'wertastung' })[det.art] || 'sicherung';
      return a === 'wertastung' ? null : a;
    }
    case 'holzernte_df': return det.verfahren === 'Rückepferd' ? 'pferd' : det.verfahren === 'Seilkran' ? 'seilkran' : null;
    default: return null;
  }
}
export const KAT_TEXT = {
  kultur: 'A 2.2.1 Wiederaufforstung / Voranbau', nachbesserung: 'A 2.2.2 Nachbesserung', zaun: 'A 2.2.1 e) Schutz der Kultur – Zaun',
  einzelschutz: 'A 2.2.1 e) Schutz der Kultur – Einzelschutz', sicherung: 'A 2.2.1 f) Sicherung der Kultur', jungwuchs: 'A 2.3 Jungwuchspflege',
  dickung: 'A 2.3 Dickungspflege', pferd: 'A 2.4 Holzrücken mit Pferden', seilkran: 'A 2.4 Seilkraneinsatz',
};
export const KAT_TEXT_LABE = {
  kultur: 'Nr. 2.2.1 Wiederaufforstung / Voranbau', nachbesserung: 'Nr. 2.2.2 Nachbesserung', zaun: 'Nr. 2.2.1 Schutz der Kultur – Zaun',
  einzelschutz: 'Nr. 2.2.1 Schutz der Kultur – Einzelschutz', sicherung: 'Nr. 2.2.1 Sicherung der Kultur',
};
export const LABE_KATS = ['kultur', 'nachbesserung', 'zaun', 'einzelschutz', 'sicherung'];
const A22 = ['kultur', 'nachbesserung', 'zaun', 'einzelschutz', 'sicherung'];

/** Fläche einer Maßnahme in ha */
export function haVon(m, ctx) {
  return m.flaeche?.ha ?? (num(m.details?.area) || (m.parcelId ? ctx.parcelHa(m.parcelId) || 0 : 0));
}
/** Pflanzenliste einer Pflanzung (Baumart, Stückzahl, Herkunft) */
export function pflanzen(m, x = {}) {
  if (x.baumarten?.length) return x.baumarten.filter((b) => b.art);
  return m.details?.species ? [{ art: normBaumart(m.details.species), stueck: num(m.details.count), hsn: x.herkunft || '' }] : [];
}
export function zaunArt(m, x = {}) {
  if (x.hordengatter) return 'horden';
  return (m.zaun?.hoehe || 160) >= 180 ? 'rot' : 'reh';
}
export const zaunLaenge = (m) => num(m.zaun?.laenge ?? m.details?.length);

/** Flächenverzeichnis für Nr. 2.2: eine Zeile je Flurstück */
export function flaechenZeilen(liste, d, ctx) {
  const zeilen = [];
  for (const m of liste) {
    const x = d.m[m.id] || {};
    const k = kategorie(m, x);
    if (!A22.includes(k)) continue;
    const key = m.parcelId || m.id;
    let z = zeilen.find((r) => r.key === key);
    if (!z) zeilen.push(z = { key, parcel: m.parcelId ? ctx.parcel(m.parcelId) : null, ha: 0, ms: [], beginn: '', ende: '', abr: '' });
    z.ms.push(m);
    const ha = haVon(m, ctx);
    if (k === 'kultur' || k === 'nachbesserung' || k === 'sicherung') z.ha = Math.max(z.ha, ha);
    z.haSonst = Math.max(z.haSonst || 0, ha);
    if (x.beginn && (!z.beginn || x.beginn < z.beginn)) z.beginn = x.beginn;
    if (x.ende && (!z.ende || x.ende > z.ende)) z.ende = x.ende;
    if (x.abrechnung && (!z.abr || x.abrechnung > z.abr)) z.abr = x.abrechnung;
  }
  zeilen.forEach((z, i) => { z.nr = i + 1; if (!z.ha) z.ha = z.haSonst || 0; z.ha = rund2(z.ha); });
  return zeilen;
}

/** Erwartete Förderung: Posten und Summe */
export function berechne(prog, d, liste, ctx) {
  const S = SAETZE[prog] || SAETZE.GANW;
  const posten = [];
  const p = (mid, text, betrag, extra = {}) => { if (betrag > 0) posten.push({ mid, text, betrag: rund2(betrag), ...extra }); };
  for (const m of liste) {
    const x = d.m[m.id] || {};
    const k = kategorie(m, x);
    if (!k || (prog === 'LABE' && !LABE_KATS.includes(k))) continue;
    const ha = haVon(m, ctx);
    if (k === 'kultur' || k === 'nachbesserung') {
      const pf = pflanzen(m, x);
      const stueck = pf.reduce((a, b) => a + num(b.stueck), 0);
      const wild = Math.min(num(x.wildlinge), stueck);
      if (k === 'kultur') {
        const vha = num(x.vorbereitungHa) || ha;
        if (x.vorbereitung === 'raeumung') p(m.id, `Kulturvorbereitung (Räumung/Bodenverwundung) ${fmt(vha)} ha × ${euro(S.raeumung)}`, vha * S.raeumung);
        if (x.vorbereitung === 'mulchen') p(m.id, `Streifenweises Mulchen ${fmt(vha)} ha × ${euro(S.mulchen)}`, vha * S.mulchen);
        p(m.id, `Markierungsstäbe ${num(x.staebe)} Stück × ${euro(S.staebe)}`, num(x.staebe) * S.staebe);
      }
      p(m.id, `Pflanzung ${stueck} Stück × ${euro(S.pflanzung)}`, stueck * S.pflanzung);
      p(m.id, `Werbung von Wildlingen ${wild} Stück × ${euro(S.wildlinge)}`, wild * S.wildlinge);
      const kosten = num(x.pflanzgutKosten);
      const satz = x.standortheimisch === 'ja' ? S.pflanzgutHeimisch : S.pflanzgut;
      p(m.id, `Pflanzgut ${euro(kosten)} × ${Math.round(satz * 100)} %`, kosten * satz, { anteil: true, ausgaben: kosten });
    } else if (k === 'zaun') {
      const art = zaunArt(m, x);
      const l = zaunLaenge(m);
      p(m.id, `${art === 'horden' ? 'Hordengatter' : `Wildschutzzaun ${art === 'rot' ? 'Rotwild (2,00 m)' : 'Rehwild (1,60 m)'}`} ${fmt(l)} lfm × ${euro(S.zaun[art])}`, l * S.zaun[art]);
    } else if (k === 'einzelschutz') {
      const cm = hoeheCm(m.details?.hoehe);
      const n = num(m.details?.count);
      if (cm >= 120) { const g = cm >= 180 ? 'gross' : 'klein'; p(m.id, `Einzelschutz ${g === 'gross' ? 'ab 180 cm' : '120–150 cm'} ${n} Stück × ${euro(S.es[g])}`, n * S.es[g]); }
    } else if (k === 'sicherung') {
      p(m.id, `Sicherung der Kultur ${fmt(ha)} ha × ${euro(S.sicherung)}`, ha * S.sicherung);
    } else if (k === 'jungwuchs' || k === 'dickung') {
      p(m.id, `${k === 'jungwuchs' ? 'Jungwuchspflege' : 'Dickungspflege'} ${fmt(ha)} ha × ${euro(S.jwp)}`, ha * S.jwp);
    } else if (k === 'pferd') {
      const fm = num(x.fm || m.details?.menge);
      const art = x.pferdArt === 'vorliefern' ? 'vorliefern' : 'abfuhr';
      p(m.id, `${art === 'abfuhr' ? 'Abfuhrbereites Rücken' : 'Vorliefern'} mit Pferden ${fmt(fm)} fm × ${euro(S.pferd[art])}`, fm * S.pferd[art]);
    } else if (k === 'seilkran') {
      const mk = num(x.mehrkosten);
      p(m.id, `Mehrausgaben Seilkran ${euro(mk)} × 65 %`, mk * S.seilkran, { anteil: true, ausgaben: mk });
    }
  }
  return { posten, summe: rund2(posten.reduce((a, b) => a + b.betrag, 0)) };
}
const fmt = (v) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: 2 });

/** Baumartenmischung prüfen; liefert Hinweise */
export function pruefeMischung(prog, liste, d, ctx) {
  const out = [];
  for (const m of liste) {
    const x = d.m[m.id] || {};
    if (kategorie(m, x) !== 'kultur') continue;
    const pf = pflanzen(m, x);
    const ges = pf.reduce((a, b) => a + num(b.stueck), 0);
    if (!ges) continue;
    const laub = pf.filter((b) => baumart(b.art)?.laub).reduce((a, b) => a + num(b.stueck), 0) / ges;
    const fichte = pf.filter((b) => /fichte/i.test(b.art)).reduce((a, b) => a + num(b.stueck), 0) / ges;
    const max = Math.max(...pf.map((b) => num(b.stueck))) / ges;
    const unbekannt = pf.filter((b) => !baumart(b.art)).map((b) => b.art);
    const pc = (v) => `${Math.round(v * 100)} %`;
    if (unbekannt.length) out.push(`Pflanzung: Bei ${unbekannt.join(', ')} kann die App Laub/Nadel nicht einordnen – den Laubbaumanteil bitte selbst prüfen.`);
    if (prog === 'LABE') {
      const nurTanne = pf.every((b) => /tanne/i.test(b.art) && !/küsten/i.test(b.art));
      if (laub < 0.3 && !(nurTanne && x.art === 'voranbau')) out.push(`Pflanzung: Laubbaumanteil ${pc(laub)} – das Landesprogramm verlangt mindestens 30 % Laubbäume (reine Nadelbaumkultur nur als Weißtannen-Voranbau).`);
      if (fichte > 0.3) out.push(`Pflanzung: Fichtenanteil ${pc(fichte)} – im Landesprogramm sind höchstens 30 % Fichte erlaubt.`);
    } else {
      if (laub < 0.4) out.push(`Pflanzung: Laubbaumanteil ${pc(laub)} – nach der Richtlinie (A 3 a) sind reine Nadelbaumkulturen und Mischungen unter 40 % Laubbäumen ausgeschlossen.`);
      const heimisch = pf.filter((b) => baumart(b.art)?.heimisch).reduce((a, b) => a + num(b.stueck), 0) / ges;
      if (heimisch <= 0.5) out.push(`Pflanzung: Standortheimische Baumarten nur ${pc(heimisch)} – die Richtlinie (A 4.3) verlangt einen überwiegenden Anteil standortheimischer Baumarten.`);
      if (x.standortheimisch === 'ja' && pf.some((b) => baumart(b.art) && !baumart(b.art).heimisch)) out.push('Pflanzung: Für den Fördersatz von 85 % dürfen ausschließlich standortheimische Baumarten gepflanzt werden – sonst gelten 75 %.');
    }
    if (haVon(m, ctx) > 1 && max > 0.75) out.push(`Pflanzung: Eine Baumart hat ${pc(max)} – auf Flächen über 1 ha darf eine Baumart höchstens 75 % ausmachen.`);
  }
  return out;
}

// ---------- Formularfelder ----------
export const datum = (t) => (t ? new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const heute = () => datum(Date.now());
const ortVon = (s = '') => String(s).replace(/^\s*\d{5}\s*/, '').trim();
const foerderjahr = (zeilen, d) => {
  const j = [...zeilen.map((z) => z.beginn), ...Object.values(d.m).map((x) => x.beginn)].filter(Boolean).sort()[0];
  return j ? j.slice(0, 4) : String(new Date().getFullYear());
};
const abrText = (j) => (j ? `15.11.${j}` : '');

function antragstellerGemeinsam(d, prog) {
  const ort = ortVon(d.ort);
  return {
    Antragsteller: d.name, Wohnort: d.ort, Straße: d.strasse, Telefon: d.telefon,
    'Ort, Datum': `${ort ? `${ort}, ` : ''}${heute()}`,
    Forstamt: d.forstamt?.replace(/^Forstamt\s+/i, '') || '',
    ...(prog === 'GANW' ? {} : {}),
  };
}

/** Werte für „Antrag GANW 26 – Naturnahe Waldbewirtschaftung“ */
export function werteGANW(d, liste, ctx) {
  const v = antragstellerGemeinsam(d, 'GANW');
  const zeilen = flaechenZeilen(liste, d, ctx);
  const kats = liste.map((m) => kategorie(m, d.m[m.id] || {}));
  const jahr = foerderjahr(zeilen, d);
  Object.assign(v, {
    Förderjahr: jahr,
    'zu Händen nicht bei Privatpersonen': d.rechtsform !== 'natuerlich' ? d.zuHaenden : '',
    EMailAdresse: d.email,
    'Geburtsdatum  Gründungsdatum': datum(d.geburtsdatum),
    'Geburtsort  Unternehmenssitz': d.geburtsort,
    'Personenident PI soweit vorhanden ggf Betriebsnummer auch aus anderen Bundesländern': d.pi,
    'Gesamtwaldfläche in Thüringen ha': d.besitzHa ? fmt(num(d.besitzHa)) : '',
    1: d.rechtsform === 'natuerlich', 2: d.rechtsform === 'privat', 3: d.rechtsform === 'oeffentlich',
    4: d.eigentum === 'ja', 5: d.eigentum === 'nein', 6: d.eigentum === 'ja' && d.alleinig === 'ja', 7: d.eigentum === 'ja' && d.alleinig === 'nein',
    8: d.ust === 'regel', 9: d.ust === 'pauschal' || d.ust === 'kein',
    33: !!d.ffh, FFH: d.ffh, 34: !!d.spa, SPA: d.spa,
    // Teil 2: beantragte Maßnahmen
    11: kats.some((k) => ['kultur', 'zaun', 'einzelschutz', 'sicherung'].includes(k)), 12: kats.includes('nachbesserung'),
    16: kats.some((k) => k === 'jungwuchs' || k === 'dickung'), 17: kats.some((k) => k === 'pferd' || k === 'seilkran'),
    // Teil 3: Anlagen
    18: d.alleinig === 'nein' || d.rolle === 'bevollmaechtigt', 19: d.eigentum === 'nein', 20: true,
    21: d.rechtsform === 'oeffentlich', 22: d.rechtsform !== 'oeffentlich' && kats.some((k) => k === 'kultur' || k === 'nachbesserung' || k === 'seilkran'),
    // 414 Website, 418 vorzeitiger Beginn
    24: !d.website, 25: !!d.website, Webseite: d.website,
    26: d.vorzeitig === 'ja', 27: d.vorzeitig !== 'ja',
    'vorz. Beginn Mantelbogen': d.vorzeitig === 'ja' && datum(d.vorzeitigAb),
    'Begründung Mantelbogen': d.vorzeitig === 'ja' ? d.vorzeitigGrund : '',
    // Erklärung zum Vorsteuerabzug
    'An das Forstamt': d.forstamt, Steuernummer: d.ust !== 'kein' ? d.steuernummer : '',
    28: true, Datum1: heute(), 30: d.ust === 'regel', 31: d.ust === 'pauschal', 32: d.ust === 'kein',
  });
  // Anlage A 2.2.1/A 2.2.2 – Flächenverzeichnis
  const S = ['_3', '_3', '_3', '_2', '_2', '_2', ''];
  zeilen.slice(0, 7).forEach((z, i) => {
    const n = i + 1, s = S[i];
    Object.assign(v, {
      [`Gemeinde${n}${s}`]: z.parcel?.gemeinde && z.parcel.gemeinde !== '–' ? z.parcel.gemeinde : '', [`Gemarkung${n}${s}`]: z.parcel?.gemarkung,
      [`Flur${n}${s}`]: z.parcel?.flur, [`Flurstück${n}${s}`]: z.parcel?.nr, [`Antrags fläche ha${n}`]: z.ha || null,
      [`Beginn${n}${s}`]: monatText(z.beginn), [`Ende000${n}`]: monatText(z.ende),
    });
  });
  v['Antrags fläche haSumme'] = rund2(zeilen.slice(0, 7).reduce((a, z) => a + z.ha, 0)) || null;
  const sich = liste.find((m) => kategorie(m, d.m[m.id] || {}) === 'sicherung');
  if (sich) { const x = d.m[sich.id] || {}; const mal = Math.min(5, Math.max(1, num(x.mal) || 1)); v[String(48 + mal)] = true; v['VorNr.001'] = x.vorgang; }
  const nb = liste.find((m) => kategorie(m, d.m[m.id] || {}) === 'nachbesserung');
  if (nb) { const x = d.m[nb.id] || {}; v[48] = true; v.AusProtzent = x.ausfallProzent ? `${x.ausfallProzent} %` : ''; v['VorNr.002'] = x.vorgang; }
  // Naturaldaten Kulturbegründung und Schutz
  const sum = {}; const add = (k, w) => { sum[k] = (sum[k] || 0) + w; };
  let rK = 0, rS = 0;
  zeilen.forEach((z) => {
    const kult = z.ms.filter((m) => ['kultur', 'nachbesserung'].includes(kategorie(m, d.m[m.id] || {})));
    if (kult.length && rK < 7) {
      const n = ++rK;
      let raeum = 0, mulch = 0, st = 0, wild = 0, staebe = 0, saat = 0, ziel = 0, zielH = 0, abr = '';
      kult.forEach((m) => {
        const x = d.m[m.id] || {}; const ha = haVon(m, ctx);
        const stk = pflanzen(m, x).reduce((a, b) => a + num(b.stueck), 0);
        if (kategorie(m, x) === 'kultur') { if (x.vorbereitung === 'raeumung') raeum += num(x.vorbereitungHa) || ha; if (x.vorbereitung === 'mulchen') mulch += num(x.vorbereitungHa) || ha; staebe += num(x.staebe); }
        st += stk; wild += Math.min(num(x.wildlinge), stk);
        if (x.standortheimisch === 'ja') zielH += ha; else ziel += ha;
        if (x.abrechnung > abr) abr = x.abrechnung;
      });
      const F = { 'Handräumung oder maschinelle Verfahren': raeum, 'streifen weise Mulchen': mulch, 'mittels geeignetem Pflanzver fahren': st, 'davon Wildlinge': wild,
        'Ausbringung von Saatgut auf der Waldhläche ha': saat, 'standortsund herkunftsger Baumarten': ziel, 'ausschl standortheimi scher Baumarten': zielH,
        'Markierung der Pflanzen zum Wiedeauffin den Stück': staebe };
      v[`zu ZeileRow${n}`] = String(z.nr);
      for (const [k, w] of Object.entries(F)) if (w) { v[`${k}Row${n}`] = rund2(w); add(k, w); }
      v[`geplanter Abrechnungstermin bis spät 1511 des JahresRow${n}`] = abrText(abr || z.abr);
    }
    const schutz = z.ms.filter((m) => ['zaun', 'einzelschutz'].includes(kategorie(m, d.m[m.id] || {})));
    if (schutz.length && rS < 7) {
      const n = ++rS;
      const F = { 'Rehwild abwehr': 0, 'Rotwild abwehr': 0, 'Horden gatter': 0, 'Höhe 120 bis 150 cm': 0, 'Höhe ab 180 cm': 0 };
      let abr = '';
      schutz.forEach((m) => {
        const x = d.m[m.id] || {};
        if (m.type === 'zaunbau') { const a = zaunArt(m, x); F[a === 'horden' ? 'Horden gatter' : a === 'rot' ? 'Rotwild abwehr' : 'Rehwild abwehr'] += zaunLaenge(m); }
        else { const cm = hoeheCm(m.details?.hoehe); if (cm >= 120) F[cm >= 180 ? 'Höhe ab 180 cm' : 'Höhe 120 bis 150 cm'] += num(m.details?.count); }
        if (x.abrechnung > abr) abr = x.abrechnung;
      });
      v[`zu ZeileRow${n}_2`] = String(z.nr);
      for (const [k, w] of Object.entries(F)) if (w) { v[`${k}Row${n}`] = rund2(w); add(k, w); }
      v[`geplanter Abrechnungstermin bis spät 1511 des JahresRow${n}_2`] = abrText(abr || z.abr);
    }
  });
  for (const [k, w] of Object.entries(sum)) v[`${k}Summe`] = rund2(w);
  // Pflanzgut
  const pfl = [];
  let ausgaben = 0, zuschuss = 0, firma = null;
  zeilen.forEach((z) => z.ms.forEach((m) => {
    const x = d.m[m.id] || {};
    if (!['kultur', 'nachbesserung'].includes(kategorie(m, x))) return;
    pflanzen(m, x).forEach((b) => pfl.push({ ...b, zeile: z.nr, bem: x.sortiment || '' }));
    const k = num(x.pflanzgutKosten);
    ausgaben += k; zuschuss += k * (x.standortheimisch === 'ja' ? SAETZE.GANW.pflanzgutHeimisch : SAETZE.GANW.pflanzgut);
    if (!firma && x.firma) firma = x;
  }));
  pfl.slice(0, 13).forEach((b, i) => {
    const n = i + 1;
    Object.assign(v, { [n <= 7 ? `zu ZeileRow${n}_3` : `zu ZeileRow${n}`]: String(b.zeile), [`BaumartRow${n}`]: b.art, [`StückzahlRow${n}`]: num(b.stueck) || null,
      [`HSNRow${n}`]: b.hsn, [`Bemerkungen zu PflanzenRow${n}`]: b.bem });
  });
  if (pfl.length) {
    v.StückzahlSa = pfl.reduce((a, b) => a + num(b.stueck), 0) || null;
    if (ausgaben) Object.assign(v, { 'Gesamtausgaben EURSa': rund2(ausgaben), 'beantragter Zuschuss EURSa': rund2(zuschuss), 'Eigenanteil EURSa': rund2(ausgaben - zuschuss) });
    if (firma) Object.assign(v, { 'Name der Firma': firma.firma, Datum_4: datum(firma.angebotDatum) });
  }
  // A 2.3 Jungwaldpflege
  const FL = ['Flur1_5', 'Flur2_5', 'Flur3_5', 'Flur4_4', 'Flur5_3'], FS = ['Flurstück1_5', 'Flurstück2_5', 'Flurstück3_5', 'Flurstück4_4', 'Flurstück5_3'];
  const BE = ['Beginn1_5', 'Beginn2_5', 'Beginn3_5', 'Beginn4_4', 'Beginn5_3'], EN = ['Ende1_4', 'Ende2_4', 'Ende3_4', 'Ende4_3', 'Ende5_2'];
  const jwp = liste.filter((m) => ['jungwuchs', 'dickung'].includes(kategorie(m, d.m[m.id] || {})));
  let jSum = 0;
  jwp.slice(0, 5).forEach((m, i) => {
    const x = d.m[m.id] || {}; const pc = m.parcelId ? ctx.parcel(m.parcelId) : null; const ha = rund2(haVon(m, ctx)); jSum += ha;
    Object.assign(v, { [`Gemeinde   Gemarkung${i + 1}`]: pc ? [pc.gemeinde !== '–' ? pc.gemeinde : '', pc.gemarkung].filter(Boolean).join(' / ') : '', [FL[i]]: pc?.flur, [FS[i]]: pc?.nr,
      [`Arbeitsgröße1 ha${i + 1}`]: ha || null, [`Mittelhöhe bei JW u D${i + 1}`]: x.mittelhoehe ? `${x.mittelhoehe} m` : '', [BE[i]]: monatText(x.beginn), [EN[i]]: monatText(x.ende),
      [`geplanter Abrechnungstermin bis spätestens zum 1511 des Jahres${i + 1}`]: abrText(x.abrechnung) });
  });
  if (jwp.length) v['Arbeitsgröße1 haSumme'] = rund2(jSum);
  // A 2.4 Seilkran
  const seil = liste.filter((m) => kategorie(m, d.m[m.id] || {}) === 'seilkran');
  let sSum = 0, sAus = 0;
  seil.slice(0, 3).forEach((m, i) => {
    const x = d.m[m.id] || {}; const pc = m.parcelId ? ctx.parcel(m.parcelId) : null; const n = i + 1; const ha = rund2(haVon(m, ctx)); sSum += ha; sAus += num(x.mehrkosten);
    Object.assign(v, { [`Gemeinde${n}_5`]: pc?.gemeinde !== '–' ? pc?.gemeinde : '', [`Gemarkung${n}_5`]: pc?.gemarkung, [`Flur${n}_6`]: pc?.flur, [`Flurstück${n}_6`]: pc?.nr,
      [`Antragsfläche ha${n}_4`]: ha || null, [`Beginn${n}_6`]: monatText(x.beginn), [`Ende${n}_5`]: monatText(x.ende) });
  });
  if (seil.length) Object.assign(v, { 'Antragsfläche haSa_3': rund2(sSum), 'Gegenstand der Förderung Art der AusgabenRow1_3': 'Mehrausgaben Seilkraneinsatz',
    'Gesamtausgaben EURRow1_4': sAus ? rund2(sAus) : null, 'beantragter Zuschuss EURRow1_3': sAus ? rund2(sAus * 0.65) : null, 'Eigenanteil EURRow1_3': sAus ? rund2(sAus * 0.35) : null });
  // A 2.4 Rückepferde
  const P = [['1_6', '1_6', '1_7', '1_5', '1_7', '1_6'], ['2_6', '2_6', '2_7', '2_5', '2_7', '2_6'], ['3_6', '3_6', '3_7', '3_5', '3_7', '3_6'],
    ['4_4', '4_4', '4_5', '4_3', '4_5', '4_4'], ['5_3', '5_3', '5_4', '5_2', '5_4', '5_3'], ['6_3', '6_3', '6_3', '6_2', '6_3', '6_2']];
  const pferd = liste.filter((m) => kategorie(m, d.m[m.id] || {}) === 'pferd');
  let pSum = 0;
  pferd.slice(0, 6).forEach((m, i) => {
    const x = d.m[m.id] || {}; const pc = m.parcelId ? ctx.parcel(m.parcelId) : null; const [g, gm, f, a, b, e] = P[i]; const ha = rund2(haVon(m, ctx)); pSum += ha;
    Object.assign(v, { [`Gemeinde${g}`]: pc?.gemeinde !== '–' ? pc?.gemeinde : '', [`Gemarkung${gm}`]: pc?.gemarkung, [`Flur${f}`]: pc?.flur, [`Flurstück${f}`]: pc?.nr,
      [`Antragsfläche ha${a}`]: ha || null, [`Beginn${b}`]: monatText(x.beginn), [`Ende${e}`]: monatText(x.ende) });
    if (x.pferdArt === 'vorliefern') v[101] = true; else v[100] = true;
  });
  if (pferd.length) Object.assign(v, { 'Antragsfläche haSa_4': rund2(pSum), Datum_10: heute() });
  return v;
}

/** Werte für „Antrag LABE 25 – Landesprogramm“ */
export function werteLABE(d, liste, ctx) {
  const v = antragstellerGemeinsam(d, 'LABE');
  const zeilen = flaechenZeilen(liste, d, ctx);
  const kats = liste.map((m) => kategorie(m, d.m[m.id] || {}));
  Object.assign(v, {
    Förderjahr: foerderjahr(zeilen, d), 'zu Händen': d.rechtsform !== 'natuerlich' ? d.zuHaenden : '', Mail: d.email,
    Geburtsdatum: datum(d.geburtsdatum), Geburtsort: d.geburtsort, PI: d.pi,
    GesFlTh: d.besitzHa ? fmt(num(d.besitzHa)) : '',
    s1: d.rechtsform === 'natuerlich', s2: d.rechtsform === 'privat', s3: d.rechtsform === 'oeffentlich',
    s4: d.eigentum === 'ja', s5: d.eigentum === 'nein', s6: d.eigentum === 'ja' && d.alleinig === 'ja', s7: d.eigentum === 'ja' && d.alleinig === 'nein',
    s8: d.ust === 'regel', s9: d.ust === 'pauschal' || d.ust === 'kein',
    s13: kats.some((k) => ['kultur', 'zaun', 'einzelschutz', 'sicherung'].includes(k)), s14: kats.includes('nachbesserung'),
    L11: d.alleinig === 'nein' || d.rolle === 'bevollmaechtigt', L12: d.eigentum === 'nein', L13: true, L14: true, L15: d.rechtsform === 'oeffentlich',
    L16: d.rechtsform !== 'oeffentlich' && kats.some((k) => k === 'kultur' || k === 'nachbesserung'),
    K1: d.vorzeitig === 'ja', K2: d.vorzeitig !== 'ja',
    vorzBeginn: d.vorzeitig === 'ja' && datum(d.vorzeitigAb), LaBegr: d.vorzeitig === 'ja' ? d.vorzeitigGrund : '',
    50: true, 55: heute(), 52: d.ust === 'regel', 53: d.ust === 'pauschal', 54: d.ust === 'kein', Steuernummer: d.ust !== 'kein' ? d.steuernummer : '',
    'aktuelle Schadfläche im Forstbetrieb in ha': d.schadHa ? fmt(num(d.schadHa)) : '',
  });
  const FS = ['Flurstück1ü', 'Flurstück2ü', 'Flurstück3ü', 'Flurstück4'], EN = ['Ende1ü', 'Ende2ü', 'Ende3', 'Ende4ü'];
  zeilen.slice(0, 4).forEach((z, i) => {
    const n = i + 1;
    Object.assign(v, { [`Gemeinde${n}ü`]: z.parcel?.gemeinde && z.parcel.gemeinde !== '–' ? z.parcel.gemeinde : '', [`Gemarkung${n}ü`]: z.parcel?.gemarkung, [`Flur${n}ü`]: z.parcel?.flur,
      [FS[i]]: z.parcel?.nr, [`Antragsfläche ha${n}ü`]: z.ha || null, [`Beginn${n}ü`]: monatText(z.beginn), [EN[i]]: monatText(z.ende) });
  });
  v['Antragsfläche haSaü'] = rund2(zeilen.slice(0, 4).reduce((a, z) => a + z.ha, 0)) || null;
  const sich = liste.find((m) => kategorie(m, d.m[m.id] || {}) === 'sicherung');
  if (sich) { const x = d.m[sich.id] || {}; const mal = Math.min(5, Math.max(1, num(x.mal) || 1)); v[`ü1${mal - 1}`] = true; v.Vorg1Ü = x.vorgang; }
  const nb = liste.find((m) => kategorie(m, d.m[m.id] || {}) === 'nachbesserung');
  if (nb) { const x = d.m[nb.id] || {}; v.NBü = x.ausfallProzent ? `${x.ausfallProzent} %` : ''; v.Vorg2Ü = x.vorgang; }
  // Naturaldaten (eine Tabelle für Kultur und Schutz)
  const sum = {};
  zeilen.slice(0, 4).forEach((z, i) => {
    const n = i + 1;
    const F = { 'Handräumung maschVerfahren ha': 0, 'Mulchen ha': 0, 'insgesamt Stückzahl': 0, 'davon Wildlinge Stückzahl': 0, 'Markierung der Pflanzen mit Stäben Stück': 0,
      'Rehwild abwehr lfm': 0, 'Rotwild abwehr lfm': 0, 'Hordengatter lfm': 0, '120 bis 150 cm': 0, 'ab 180 cm': 0 };
    let abr = '';
    z.ms.forEach((m) => {
      const x = d.m[m.id] || {}; const k = kategorie(m, x); const ha = haVon(m, ctx);
      if (k === 'kultur' || k === 'nachbesserung') {
        const stk = pflanzen(m, x).reduce((a, b) => a + num(b.stueck), 0);
        if (k === 'kultur') { if (x.vorbereitung === 'raeumung') F['Handräumung maschVerfahren ha'] += num(x.vorbereitungHa) || ha; if (x.vorbereitung === 'mulchen') F['Mulchen ha'] += num(x.vorbereitungHa) || ha; F['Markierung der Pflanzen mit Stäben Stück'] += num(x.staebe); }
        F['insgesamt Stückzahl'] += stk; F['davon Wildlinge Stückzahl'] += Math.min(num(x.wildlinge), stk);
      } else if (k === 'zaun') { const a = zaunArt(m, x); F[a === 'horden' ? 'Hordengatter lfm' : a === 'rot' ? 'Rotwild abwehr lfm' : 'Rehwild abwehr lfm'] += zaunLaenge(m); }
      else if (k === 'einzelschutz') { const cm = hoeheCm(m.details?.hoehe); if (cm >= 120) F[cm >= 180 ? 'ab 180 cm' : '120 bis 150 cm'] += num(m.details?.count); }
      if (x.abrechnung > abr) abr = x.abrechnung;
    });
    v[`zu ZeileRow${n}ü`] = String(z.nr);
    for (const [k, w] of Object.entries(F)) if (w) { v[`${k}Row${n}`] = rund2(w); sum[k] = (sum[k] || 0) + w; }
    v[`Abrechnungs jahr bis spät 1511 des JahresRow${n}`] = abrText(abr || z.abr);
  });
  for (const [k, w] of Object.entries(sum)) v[`${k}Sa`] = rund2(w);
  // Pflanzgut
  const pfl = []; let ausgaben = 0, firma = null;
  zeilen.forEach((z) => z.ms.forEach((m) => {
    const x = d.m[m.id] || {};
    if (!['kultur', 'nachbesserung'].includes(kategorie(m, x))) return;
    pflanzen(m, x).forEach((b) => pfl.push({ ...b, zeile: z.nr, bem: x.sortiment || '' }));
    ausgaben += num(x.pflanzgutKosten); if (!firma && x.firma) firma = x;
  }));
  pfl.slice(0, 10).forEach((b, i) => {
    const n = i + 1;
    Object.assign(v, { [n <= 4 ? `zu ZeileRow${n}_2ü` : `zu ZeileRow${n}ü`]: String(b.zeile), [`BA${n}`]: b.art, [`Zahl${10 + n}`]: num(b.stueck) ? String(num(b.stueck)) : '', [`HSN${n}`]: b.hsn, [`Bem${n}`]: b.bem });
  });
  if (ausgaben) v['förderfähige Gesamtausgaben EUR'] = rund2(ausgaben);
  if (firma) Object.assign(v, { 'Name der Firma': firma.firma, DatumÜ: datum(firma.angebotDatum) });
  return v;
}

/** Welche Seiten des Formulars einzureichen sind */
export function seitenHinweis(prog, kats) {
  if (prog === 'LABE') return 'Mantelbogen (Seite 1–6) und die Anlage nach Nr. 2.2 (Seite 15–17)';
  const t = ['Mantelbogen (Seite 1–6)'];
  if (kats.some((k) => A22.includes(k))) t.push('Anlage A 2.2.1/A 2.2.2 (Seite 15–18)');
  if (kats.some((k) => k === 'jungwuchs' || k === 'dickung')) t.push('Anlage A 2.3 (Seite 20)');
  if (kats.some((k) => k === 'pferd' || k === 'seilkran')) t.push('Anlage A 2.4 (Seite 21–22)');
  return t.join(', ');
}
