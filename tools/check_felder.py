#!/usr/bin/env python3
"""Feldnamen und Beispielwerte der öffentlichen Forst-/Naturschutzebenen (Open Data, dl-de/by-2-0)
und Format der Legenden – für eine verständliche Darstellung in der App."""
import math, os, re, urllib.parse, urllib.request
GP = 'https://www.geoproxy.geoportal-th.de/geoproxy/services'
FORST = f'{GP}/forst/FORST'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'geodienste', 'felder.txt')
LOG = []
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.append(s)
def get(url):
    r = urllib.request.Request(url, headers={'User-Agent': 'Waldwaechter-Check/1.0'})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return resp.headers.get('Content-Type', ''), resp.read()
def bbox(lat, lon, span):
    R = 6378137; x = lon * math.pi / 180 * R; y = math.log(math.tan(math.pi / 4 + lat * math.pi / 360)) * R
    h = span / 2 / math.cos(math.radians(lat)); return f'{x - h},{y - h},{x + h},{y + h}'
LAYERS = [(FORST, l) for l in ['standort_fl', 'waldflaeche', 'hoheitsstruktur', 'bodenschutzfunktion', 'erholungswald', 'erholungsfunktion',
          'klimaschutzfunktion', 'immissionsschutzfunktion', 'laermschutzfunktion', 'sichtschutzfunktion', 'waldbiotope',
          'waldlebensraumtypen', 'waldschaeden', 'naturwaldparzelle', 'hochprod_waelder']] + \
         [(f'{GP}/SCHUTZGEB', l) for l in ['nsg', 'lsg', 'ffh_geb', 'spa', 'naturpark']]
PTS = [(50.5600, 11.7500), (50.5200, 11.6500), (50.4550, 11.6000), (50.6500, 11.5800), (50.4200, 11.7400), (50.7300, 12.0300),
       (50.6200, 12.1500), (50.5000, 11.5300), (50.3900, 11.6800), (50.6800, 11.9000), (50.6000, 11.4700), (50.7700, 11.9400)]
def main():
    for url, layer in LAYERS:
        found = 0
        for lat, lon in PTS:
            q = urllib.parse.urlencode({'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetFeatureInfo', 'LAYERS': layer, 'QUERY_LAYERS': layer,
                                        'STYLES': '', 'CRS': 'EPSG:3857', 'BBOX': bbox(lat, lon, 200), 'WIDTH': 101, 'HEIGHT': 101, 'I': 50, 'J': 50,
                                        'INFO_FORMAT': 'application/vnd.ogc.gml', 'FEATURE_COUNT': 3})
            try:
                ct, body = get(f'{url}?{q}')
            except Exception as e:  # noqa: BLE001
                log(f'{layer}: Fehler {e}'); break
            t = body.decode('utf-8', 'replace')
            vals = [(k, v.strip()) for k, v in re.findall(r'<(?:[\w-]+:)?([A-Za-z_][\w-]*)>([^<]*)</', t) if k not in ('coordinates',)]
            if vals:
                found += 1
                log(f'{layer} @ {lat},{lon}: {vals[:30]}')
                if found >= 2:
                    break
        if not found:
            log(f'{layer}: an den Testpunkten keine Treffer')
    for url, layer in [(FORST, 'standort_fl'), (FORST, 'rettungspunkte'), (f'{GP}/SCHUTZGEB', 'nsg')]:
        q = urllib.parse.urlencode({'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetLegendGraphic', 'FORMAT': 'image/png', 'LAYER': layer, 'SLD_VERSION': '1.1.0'})
        try:
            ct, body = get(f'{url}?{q}')
            log(f'Legende {layer}: {ct} {len(body)} Bytes {body[:8]!r}')
        except Exception as e:  # noqa: BLE001
            log(f'Legende {layer}: Fehler {e}')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write('\n'.join(LOG) + '\n')
if __name__ == '__main__':
    main()
