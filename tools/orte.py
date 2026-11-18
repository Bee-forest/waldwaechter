"""Ortsnamen Thüringens (OpenStreetMap, place=*) als kompakte Datei data/orte.json für die Beschriftung des Luftbilds."""
import json, urllib.request, urllib.parse, os, time
Q = '[out:json][timeout:180];node["place"~"^(city|town|village|suburb|hamlet|isolated_dwelling|locality)$"]["name"](50.15,9.85,51.70,12.70);out;'
ART = {'city': 0, 'town': 1, 'village': 2, 'suburb': 3, 'hamlet': 4, 'isolated_dwelling': 5, 'locality': 5}
for url in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']:
    try:
        req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': Q}).encode(), headers={'User-Agent': 'Waldwaechter/1.0 (github.com/Bee-forest/waldwaechter)'})
        d = json.load(urllib.request.urlopen(req, timeout=240))
        break
    except Exception as e:
        print('Fehler', url, e); time.sleep(5)
else:
    raise SystemExit('kein Overpass-Server erreichbar')
orte = sorted(([round(x['lat'], 5), round(x['lon'], 5), x['tags']['name'], ART[x['tags']['place']]] for x in d['elements']), key=lambda o: o[3])
out = os.path.join(os.path.dirname(__file__), '..', 'data', 'orte.json')
json.dump({'quelle': '© OpenStreetMap-Mitwirkende (ODbL)', 'stand': time.strftime('%Y-%m-%d'), 'orte': orte}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(orte), 'Orte gespeichert')
