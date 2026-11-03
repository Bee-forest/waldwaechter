#!/usr/bin/env python3
"""Sucht Dienste für Baumarten/Altersklassen und Höhenmodelle (DOM/DGM/nDOM) in Thüringen
und testet, ob sich Höhenwerte an einem Punkt abfragen lassen. Ergebnis: data/geodienste/hoehe.txt"""
import math, os, re, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
GP = 'https://www.geoproxy.geoportal-th.de/geoproxy/services'
GEOMIS = 'https://geomis.geoportal-th.de/geonetwork/srv'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'geodienste', 'hoehe.txt')
LOG = []
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.append(s)
def get(url, n=None):
    r = urllib.request.Request(url, headers={'User-Agent': 'Waldwaechter-Check/1.0'})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return resp.headers.get('Content-Type', ''), resp.read(n) if n else resp.read()
def local(t): return t.rsplit('}', 1)[-1]
URLRE = r'https?://[^\s"<>]+'

def record(name, rid):
    try:
        _, raw = get(f'{GEOMIS}/api/records/{rid}/formatters/xml')
        urls = sorted(set(u for u in re.findall(URLRE, raw.decode('utf-8', 'replace')) if 'geoproxy' in u or 'download' in u))
        log(f'GeoMIS {name}: {urls}')
        return urls
    except Exception as e:  # noqa: BLE001
        log(f'GeoMIS {name}: Fehler {e}'); return []

def search(term):
    q = urllib.parse.urlencode({'service': 'CSW', 'version': '2.0.2', 'request': 'GetRecords', 'typeNames': 'csw:Record', 'resultType': 'results',
                                'elementSetName': 'full', 'constraintLanguage': 'CQL_TEXT', 'constraint_language_version': '1.1.0',
                                'constraint': f"AnyText like '%{term}%'", 'maxRecords': '30'})
    try:
        _, raw = get(f'{GEOMIS}/ger/csw?{q}'); t = raw.decode('utf-8', 'replace')
        recs = re.findall(r'<csw:Record>(.*?)</csw:Record>', t, re.S)
        for r in recs:
            title = (re.findall(r'<dc:title>([^<]+)</dc:title>', r) or ['?'])[0]
            ident = (re.findall(r'<dc:identifier>([^<]+)</dc:identifier>', r) or ['?'])[0]
            urls = sorted(set(u for u in re.findall(URLRE, r) if 'geoproxy' in u))
            log(f'  [{term}] {title} | {ident} | {urls[:6]}')
    except Exception as e:  # noqa: BLE001
        log(f'Suche {term}: Fehler {e}')

def caps(url):
    try:
        ct, raw = get(f'{url}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0')
        root = ET.fromstring(raw)
        out = []
        for lyr in root.iter():
            if local(lyr.tag) != 'Layer': continue
            nm = next((c.text for c in lyr if local(c.tag) == 'Name'), None)
            ti = next((c.text for c in lyr if local(c.tag) == 'Title'), '')
            if nm: out.append((nm, ti, lyr.get('queryable', '0')))
        fmts = sorted(set(e.text for e in root.iter() if local(e.tag) == 'Format' and e.text))
        log(f'WMS {url}: {out[:40]}'); log(f'   Formate: {fmts[:20]}')
        return out
    except Exception as e:  # noqa: BLE001
        log(f'WMS {url}: Fehler {str(e)[:150]}'); return []

def gfi(url, layer, lat, lon):
    R = 6378137; x = lon * math.pi / 180 * R; y = math.log(math.tan(math.pi / 4 + lat * math.pi / 360)) * R
    h = 25 / math.cos(math.radians(lat))
    for fmt in ('text/plain', 'application/vnd.ogc.gml', 'text/xml', 'text/html'):
        q = urllib.parse.urlencode({'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetFeatureInfo', 'LAYERS': layer, 'QUERY_LAYERS': layer, 'STYLES': '',
                                    'CRS': 'EPSG:3857', 'BBOX': f'{x-h},{y-h},{x+h},{y+h}', 'WIDTH': 51, 'HEIGHT': 51, 'I': 25, 'J': 25, 'INFO_FORMAT': fmt, 'FEATURE_COUNT': 3})
        try:
            ct, raw = get(f'{url}?{q}')
            t = re.sub(r'\s+', ' ', raw.decode('utf-8', 'replace'))[:500]
            log(f'   GFI {layer} [{fmt}]: {ct} | {t}')
        except Exception as e:  # noqa: BLE001
            log(f'   GFI {layer} [{fmt}]: Fehler {str(e)[:120]}')

def main():
    urls = record('Baumarten', '1f690892-d1c3-436a-819e-a26d207e17d7')
    record('DGM25', '2ebce934-5b10-4741-aab9-81f094763f8e')
    for term in ('Oberflächenmodell', 'nDOM', 'Baumarten', 'Altersklasse', 'Laserscanning'):
        search(term)
    cands = {f'{GP}/{n}' for n in ('DGM', 'DOM', 'nDOM', 'NDOM', 'geobasis/DGM', 'geobasis/DOM', 'geobasis/nDOM', 'forst/FORST', 'forst/BAUMARTEN', 'forst/baumarten')}
    cands |= {u.split('?')[0].rstrip('/') for u in urls if 'geoproxy/services' in u}
    lat, lon = 50.5600, 11.7500  # Wald bei Schleiz
    for u in sorted(cands):
        layers = caps(u)
        for nm, ti, q in layers:
            if q == '1' and re.search(r'dom|dgm|hoehe|höhe|baum|alter|best', nm + ti, re.I):
                gfi(u, nm, lat, lon)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write('\n'.join(LOG) + '\n')

if __name__ == '__main__':
    main()
