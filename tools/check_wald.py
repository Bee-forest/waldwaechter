#!/usr/bin/env python3
"""Prüft, wie der ALKIS-Nutzungsdienst Wald/Gehölz darstellt (für die Waldmaske der Durchforstung)."""
import math, os, re, urllib.parse, urllib.request
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'geodienste', 'wald')
GP = 'https://www.geoproxy.geoportal-th.de/geoproxy/services'
LOG = []
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.append(s)
def get(u):
    r = urllib.request.Request(u, headers={'User-Agent': 'Waldwaechter-Check/1.0'})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return resp.headers, resp.read()
R = 6378137
mx = lambda lng: lng * math.pi / 180 * R
my = lambda lat: math.log(math.tan(math.pi / 4 + lat * math.pi / 360)) * R
TESTS = {'gertewitz': (50.678595, 11.651981, 50.681461, 11.655935), 'doebritz': (50.680359, 11.656181, 50.681515, 11.659122)}
def main():
    os.makedirs(OUT, exist_ok=True)
    try:
        _, cap = get(f'{GP}?REQUEST=GetCapabilities&SERVICE=WMS&VERSION=1.3.0')
        t = cap.decode('utf-8', 'replace')
        for name in ('TatsaechlicheNutzung', 'Wald', 'Gehoelz', 'Vegetation'):
            i = t.find(f'<Name>{name}</Name>')
            log(f'CAP {name}:', re.sub(r'\s+', ' ', t[i:i + 900]) if i >= 0 else 'fehlt')
    except Exception as e: log('CAP Fehler', e)
    for key, (s, w, n, e) in TESTS.items():
        bb = [mx(w) - 30, my(s) - 30, mx(e) + 30, my(n) + 30]
        W, H = round((bb[2] - bb[0]) / 1.0), round((bb[3] - bb[1]) / 1.0)
        for svc, layers in ((f'{GP}/forst/FORST', 'waldflaeche'), (GP, 'Vegetation')):
            q = dict(SERVICE='WMS', VERSION='1.3.0', REQUEST='GetMap', LAYERS=layers, STYLES='', CRS='EPSG:3857', BBOX=','.join(f'{v:.2f}' for v in bb), WIDTH=W, HEIGHT=H, FORMAT='image/png', TRANSPARENT='true')
            try:
                h, b = get(f'{svc}?{urllib.parse.urlencode(q)}')
                fn = f'{key}_{layers.replace(",", "+")}.png'
                open(os.path.join(OUT, fn), 'wb').write(b)
                log(f'{key} {layers}: {len(b)} Bytes {h.get("Content-Type")} {W}x{H} -> {fn}')
            except Exception as ex: log(f'{key} {layers}: Fehler {ex}')
        # Sachdaten an der Mitte
        q = dict(SERVICE='WMS', VERSION='1.3.0', REQUEST='GetFeatureInfo', LAYERS='waldflaeche', QUERY_LAYERS='waldflaeche', STYLES='', CRS='EPSG:3857', BBOX=','.join(f'{v:.2f}' for v in bb), WIDTH=W, HEIGHT=H, I=W // 2, J=H // 2, INFO_FORMAT='application/vnd.ogc.gml', FEATURE_COUNT=3)
        try:
            h, b = get(f'{GP}/forst/FORST?{urllib.parse.urlencode(q)}'); log(f'{key} GFI:', re.sub(r'\s+', ' ', b.decode('utf-8', 'replace'))[:1200])
        except Exception as ex: log(f'{key} GFI Fehler {ex}')
    try:
        _, cap = get(f'{GP}/forst/FORST?REQUEST=GetCapabilities&SERVICE=WMS&VERSION=1.3.0'); t = cap.decode('utf-8', 'replace'); i = t.find('<Name>waldflaeche</Name>')
        log('CAP waldflaeche:', re.sub(r'\s+', ' ', t[i:i + 2500]))
    except Exception as ex: log('CAP forst Fehler', ex)
    open(os.path.join(OUT, 'log.txt'), 'w').write('\n'.join(LOG) + '\n')
main()
