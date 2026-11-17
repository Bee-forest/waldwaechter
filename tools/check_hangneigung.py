"""Prüft die Ebenen „hangneigung“ und „exposition“ im Sammeldienst des Geoproxy Thüringen.
Schreibt Capabilities-Auszug, Legende, GetFeatureInfo-Antworten und ein Probebild nach data/geodienste/."""
import re, urllib.request, urllib.parse, os
from pyproj import Transformer
GP = 'https://www.geoproxy.geoportal-th.de/geoproxy/services'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'geodienste')
log = []
def get(url, binary=False):
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'Origin': 'https://bee-forest.github.io', 'User-Agent': 'Waldwaechter'}), timeout=60)
    b = r.read()
    return r, (b if binary else b.decode('utf-8', 'replace'))
try:
    r, cap = get(GP + '?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0')
    for name in ('hangneigung', 'exposition'):
        i = cap.find(f'<Name>{name}</Name>')
        j = cap.rfind('<Layer', 0, i)
        k = cap.find('</Layer>', i)
        log.append(f'== Capabilities {name}\n' + re.sub(r'\s+', ' ', cap[j:k])[:3000])
except Exception as e:
    log.append(f'Capabilities Fehler: {e}')
for name in ('hangneigung', 'exposition'):
    try:
        r, b = get(GP + '?' + urllib.parse.urlencode({'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetLegendGraphic', 'LAYER': name, 'FORMAT': 'image/png'}), True)
        open(os.path.join(OUT, f'legende_{name}.png'), 'wb').write(b)
        log.append(f'Legende {name}: {r.headers.get("Content-Type")} {len(b)} Byte')
    except Exception as e:
        log.append(f'Legende {name} Fehler: {e}')
t = Transformer.from_crs(4326, 25832, always_xy=True)
PUNKTE = {'Kickelhahn Steilhang': (50.6505, 10.9085), 'Schwarzatal Steilhang': (50.6630, 11.2050), 'Greiz Wald': (50.6555, 12.1880), 'Gotha flach': (50.9497, 10.7085), 'Suhl Domberg': (50.6060, 10.6840)}
for name, (lat, lon) in PUNKTE.items():
    x, y = t.transform(lon, lat)
    for fmt in ('text/plain', 'text/xml', 'text/html'):
        q = urllib.parse.urlencode({'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetFeatureInfo', 'LAYERS': 'hangneigung,exposition', 'QUERY_LAYERS': 'hangneigung,exposition', 'STYLES': '',
                                    'CRS': 'EPSG:25832', 'BBOX': f'{x-50},{y-50},{x+50},{y+50}', 'WIDTH': 101, 'HEIGHT': 101, 'I': 50, 'J': 50, 'INFO_FORMAT': fmt, 'FEATURE_COUNT': 5})
        try:
            r, b = get(GP + '?' + q)
            log.append(f'== GFI {name} [{fmt}] CORS={r.headers.get("Access-Control-Allow-Origin")}\n' + re.sub(r'\s+', ' ', b)[:1500])
        except Exception as e:
            log.append(f'== GFI {name} [{fmt}] Fehler: {e}')
    q = urllib.parse.urlencode({'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': 'hangneigung', 'STYLES': '', 'CRS': 'EPSG:25832', 'BBOX': f'{x-600},{y-600},{x+600},{y+600}', 'WIDTH': 400, 'HEIGHT': 400, 'FORMAT': 'image/png', 'TRANSPARENT': 'true'})
    try:
        r, b = get(GP + '?' + q, True)
        open(os.path.join(OUT, f'hangneigung_{name.split()[0].lower()}.png'), 'wb').write(b)
        log.append(f'GetMap {name}: {r.headers.get("Content-Type")} {len(b)} Byte')
    except Exception as e:
        log.append(f'GetMap {name} Fehler: {e}')
open(os.path.join(OUT, 'hangneigung.txt'), 'w', encoding='utf-8').write('\n'.join(log) + '\n')
print('\n'.join(log))

# ---- Alternativen: Höhe aus Terrarium-Kacheln (AWS Open Data) und INSPIRE-Höhendienst
import math, io
log2 = []
try:
    from PIL import Image
    def tile(lat, lon, z):
        n = 2 ** z
        return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    for name, (lat, lon) in PUNKTE.items():
        for z in (14, 15):
            x, y = tile(lat, lon, z)
            url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
            r, b = get(url, True)
            im = Image.open(io.BytesIO(b)).convert('RGB')
            px = im.load()
            hgt = [[px[i, j][0] * 256 + px[i, j][1] + px[i, j][2] / 256 - 32768 for i in range(256)] for j in range(256)]
            res = 40075016.686 * math.cos(math.radians(lat)) / (256 * 2 ** z)
            sl = []
            for j in range(1, 255):
                for i in range(1, 255):
                    dx = (hgt[j][i + 1] - hgt[j][i - 1]) / (2 * res); dy = (hgt[j + 1][i] - hgt[j - 1][i]) / (2 * res)
                    sl.append(math.hypot(dx, dy) * 100)
            sl.sort()
            log2.append(f'Terrarium {name} z{z}: CORS={r.headers.get("Access-Control-Allow-Origin")} Pixel {res:.1f} m, Höhe {min(map(min, hgt)):.0f}–{max(map(max, hgt)):.0f} m, Neigung Median {sl[len(sl)//2]:.0f} %, 90% {sl[int(len(sl)*.9)]:.0f} %, max {sl[-1]:.0f} %')
except Exception as e:
    log2.append(f'Terrarium Fehler: {e}')
for dienst in ('INSPIREel', 'DGM'):
    try:
        r, cap = get(f'{GP}/{dienst}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0')
        names = re.findall(r'<Layer queryable="(\d)"[^>]*>\s*<Name>([^<]+)</Name>\s*<Title>([^<]*)', cap)
        log2.append(f'{dienst} Ebenen: {names[:20]}')
        x, y = t.transform(10.9085, 50.6505)
        for q_, nm, ti in names[:6]:
            if q_ != '1':
                continue
            q = urllib.parse.urlencode({'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetFeatureInfo', 'LAYERS': nm, 'QUERY_LAYERS': nm, 'STYLES': '', 'CRS': 'EPSG:25832', 'BBOX': f'{x-50},{y-50},{x+50},{y+50}', 'WIDTH': 101, 'HEIGHT': 101, 'I': 50, 'J': 50, 'INFO_FORMAT': 'text/plain'})
            r, b = get(f'{GP}/{dienst}?{q}')
            log2.append(f'  GFI {nm}: ' + re.sub(r'\s+', ' ', b)[:400])
    except Exception as e:
        log2.append(f'{dienst} Fehler: {e}')
open(os.path.join(OUT, 'hangneigung.txt'), 'a', encoding='utf-8').write('\n== Alternativen\n' + '\n'.join(log2) + '\n')
print('\n'.join(log2))
