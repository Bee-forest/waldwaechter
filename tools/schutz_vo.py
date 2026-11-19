"""Direkte Links zu Schutzgebietsverordnungen in Thüringen sammeln (data/schutzgebiet-verordnungen.json).

Quelle: Wikipedia-Artikel der Schutzgebiete (Kategorien Naturschutzgebiet/Landschaftsschutzgebiet/Naturpark in
Thüringen) und deren Einzelnachweise. Übernommen werden nur Links, die nach einer Verordnung aussehen
(PDF oder Seite mit „verordnung“, „VO“, „Staatsanzeiger“ o. ä. im Link oder Linktext) – keine Suchseiten.
Zusätzlich wird der Wikipedia-Artikel selbst gespeichert (als Beschreibung des Gebiets).
"""
import json, re, sys, time, urllib.parse, urllib.request

API = 'https://de.wikipedia.org/w/api.php'
UA = {'User-Agent': 'WaldWaechter/1.0 (https://bee-forest.github.io/waldwaechter/; Schutzgebietsverordnungen)'}
KATEGORIEN = {
    'nsg': ['Kategorie:Naturschutzgebiet in Thüringen'],
    'lsg': ['Kategorie:Landschaftsschutzgebiet in Thüringen'],
    'naturpark': ['Kategorie:Naturpark in Thüringen'],
    'ffh_geb': ['Kategorie:FFH-Gebiet in Thüringen'],
    'spa': ['Kategorie:Vogelschutzgebiet in Thüringen'],
}

def api(**p):
    p.update(format='json', formatversion='2')
    for versuch in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + '?' + urllib.parse.urlencode(p), headers=UA), timeout=40) as r:
                return json.load(r)
        except Exception as e:
            print('  Wiederholung', versuch, e, file=sys.stderr); time.sleep(3 * (versuch + 1))
    return {}

def mitglieder(kat, tiefe=0):
    out, weiter = [], {}
    while True:
        d = api(action='query', list='categorymembers', cmtitle=kat, cmlimit='500', cmtype='page|subcat', **weiter)
        for m in d.get('query', {}).get('categorymembers', []):
            if m['ns'] == 14 and tiefe < 2: out += mitglieder(m['title'], tiefe + 1)
            elif m['ns'] == 0: out.append(m['title'])
        if 'continue' not in d: return out
        weiter = d['continue']

GUT = re.compile(r'verordnung|[-_/]vo[-_.]|vo_|nsg[-_]?vo|staatsanzeiger|thuerstanz|thürstanz|landesrecht|bsth|jportal|amtsblatt', re.I)
SCHLECHT = re.compile(r'wikipedia|wikidata|wikimedia|openstreetmap|geohack|protectedplanet|google\.|bing\.|duckduckgo|archive\.org/web/\d+/?$|youtube|facebook', re.I)

def links_von(titel):
    d = api(action='parse', page=titel, prop='externallinks|wikitext', redirects='1')
    p = d.get('parse', {})
    wt = p.get('wikitext', '') if isinstance(p.get('wikitext'), str) else ''
    links = p.get('externallinks', []) or []
    # Linktexte aus dem Wikitext ([url text])
    texte = {m.group(1): m.group(2) for m in re.finditer(r'\[(https?://[^\s\]]+)\s+([^\]]*)\]', wt)}
    treffer = []
    for u in links:
        if SCHLECHT.search(u): continue
        t = texte.get(u, '')
        if GUT.search(u) or GUT.search(t) or (u.lower().endswith('.pdf') and re.search(r'naturschutz|schutzgebiet|nsg|lsg|naturpark', u + t, re.I)):
            treffer.append({'url': u, 'text': re.sub(r"''+|<[^>]+>", '', t).strip()[:160]})
    return treffer

def norm(t):
    t = t.lower().replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue').replace('ß', 'ss')
    t = re.sub(r'\(.*?\)', '', t)
    t = re.sub(r'^(naturschutzgebiet|landschaftsschutzgebiet|naturpark|ffh-gebiet|vogelschutzgebiet)\s+', '', t)
    return re.sub(r'[^a-z0-9]+', '', t)

LISTEN = ['Liste der Naturschutzgebiete in Thüringen', 'Liste der Landschaftsschutzgebiete in Thüringen']

def listen_titel():
    # Kreis-Listen: „Liste der Naturschutzgebiete im Landkreis …“ / „… in der Stadt …“
    out = set(LISTEN)
    for prefix in ['Liste der Naturschutzgebiete im ', 'Liste der Naturschutzgebiete in ', 'Liste der Landschaftsschutzgebiete im ', 'Liste der Landschaftsschutzgebiete in ']:
        d = api(action='query', list='prefixsearch', pssearch=prefix, pslimit='100')
        for m in d.get('query', {}).get('prefixsearch', []): out.add(m['title'])
    thue = re.compile(r'Thüringen|Altenburger|Eichsfeld|Gotha|Greiz|Hildburghausen|Ilm-Kreis|Kyffhäuser|Nordhausen|Saale-Holzland|Saale-Orla|Saalfeld|Schmalkalden|Sömmerda|Sonneberg|Unstrut-Hainich|Wartburg|Weimarer Land|Erfurt|Gera|Jena|Suhl|Weimar|Eisenach')
    return sorted(t for t in out if thue.search(t))

def zeilen_links(titel):
    d = api(action='parse', page=titel, prop='wikitext', redirects='1')
    wt = d.get('parse', {}).get('wikitext', '')
    if not isinstance(wt, str): return []
    benannt = {m.group(1): m.group(2) for m in re.finditer(r'<ref name="?([^">/]+)"?\s*>(.*?)</ref>', wt, re.S)}
    out = []
    for zeile in re.split(r'\n\|-', wt):
        m = re.search(r'\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]', zeile)
        if not m: continue
        name = (m.group(2) or m.group(1)).strip()
        if re.match(r'(Datei|File|Bild|Kategorie):', m.group(1)): continue
        refs = re.findall(r'<ref[^>/]*>(.*?)</ref>', zeile, re.S) + [benannt.get(n, '') for n in re.findall(r'<ref name="?([^">/]+)"?\s*/>', zeile)]
        treffer = []
        for r in refs:
            for u, t in re.findall(r'\[(https?://[^\s\]]+)\s*([^\]]*)\]', r) + [(u, '') for u in re.findall(r'url\s*=\s*(https?://[^\s|}]+)', r)]:
                titel_r = re.search(r'titel\s*=\s*([^|}]+)', r)
                t = t or (titel_r.group(1) if titel_r else '')
                if SCHLECHT.search(u): continue
                if GUT.search(u) or GUT.search(t) or u.lower().endswith('.pdf'):
                    treffer.append({'url': u, 'text': re.sub(r"''+|<[^>]+>|\{\{.*?\}\}", '', t).strip()[:160]})
        nr = re.search(r'\|\s*(?:NSG[- ]?)?(\d{1,3})\s*(?:\n|\|\|)', zeile)
        if treffer: out.append((name, treffer, nr.group(1) if nr else None))
    return out

def main():
    daten = {}
    for art, kats in KATEGORIEN.items():
        titel = sorted({t for k in kats for t in mitglieder(k)})
        print(art, len(titel), 'Artikel', file=sys.stderr)
        for i, t in enumerate(titel):
            l = links_von(t)
            daten.setdefault(art, {})[norm(t)] = {'name': t, 'wiki': 'https://de.wikipedia.org/wiki/' + urllib.parse.quote(t.replace(' ', '_')), 'vo': l[:4]}
            if i % 50 == 0: print(' ', art, i, t, len(l), file=sys.stderr)
            time.sleep(0.15)
    # Einzelnachweise aus den Listen der Landkreise ergänzen
    for t in listen_titel():
        art = 'lsg' if 'Landschaftsschutz' in t else 'nsg'
        z = zeilen_links(t)
        print('Liste', t, len(z), file=sys.stderr)
        for name, treffer, nr in z:
            e = daten.setdefault(art, {}).setdefault(norm(name), {'name': name, 'wiki': None, 'vo': []})
            bekannt = {v['url'] for v in e['vo']}
            e['vo'] = (e['vo'] + [v for v in treffer if v['url'] not in bekannt])[:4]
            if nr and not e.get('nr'): e['nr'] = nr
        time.sleep(0.3)
    # TLUBN-Lesefassungen zuerst (amtliche Quelle)
    for g in daten.values():
        for e in g.values():
            e['vo'].sort(key=lambda v: (0 if 'tlubn.thueringen.de' in v['url'] and 'Rechtsgrundlagen' in v['url'] else 1 if 'landesrecht.thueringen.de' in v['url'] else 2))
    stand = time.strftime('%Y-%m-%d')
    json.dump({'stand': stand, 'quelle': 'Wikipedia-Artikel und deren Einzelnachweise', 'gebiete': daten}, open('data/schutzgebiet-verordnungen.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    for art, d in daten.items():
        print(art, len(d), 'Gebiete,', sum(1 for x in d.values() if x['vo']), 'mit Verordnungslink')

main()
