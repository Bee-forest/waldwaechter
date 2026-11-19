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
    stand = time.strftime('%Y-%m-%d')
    json.dump({'stand': stand, 'quelle': 'Wikipedia-Artikel und deren Einzelnachweise', 'gebiete': daten}, open('data/schutzgebiet-verordnungen.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    for art, d in daten.items():
        print(art, len(d), 'Gebiete,', sum(1 for x in d.values() if x['vo']), 'mit Verordnungslink')

main()
