#!/usr/bin/env python3
"""
Prüft Eigenschaften der Thüringer Dienste, die die App braucht – ohne Fachdaten
zu speichern: nur Feldnamen, Formate, CORS-Freigaben und ob Ebenen etwas zeichnen.
Ergebnis: data/geodienste/check.txt
"""
import math, os, re, struct, urllib.parse, urllib.request, zlib

GP = 'https://www.geoproxy.geoportal-th.de/geoproxy/services'
FORST = f'{GP}/forst/FORST'
ORIGIN = 'https://bee-forest.github.io'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'geodienste', 'check.txt')
LOG = []


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)


def req(url):
    r = urllib.request.Request(url, headers={'User-Agent': 'Waldwaechter-Check/1.0', 'Origin': ORIGIN})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return resp.status, dict(resp.headers), resp.read()


def merc(lat, lon):
    R = 6378137
    return lon * math.pi / 180 * R, math.log(math.tan(math.pi / 4 + lat * math.pi / 360)) * R


def bbox(lat, lon, span):
    x, y = merc(lat, lon)
    h = span / 2 / math.cos(math.radians(lat))
    return f'{x - h},{y - h},{x + h},{y + h}'


def png_nontransparent(data):
    """Anteil nicht transparenter Pixel eines RGBA-PNG (einfacher Decoder, nur Filter 0–4)."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    pos, idat, w = 8, b'', 0
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', body[:10])
            if bd != 8 or ct not in (2, 6):
                return f'Farbtyp {ct}/{bd}'
            bpp = 4 if ct == 6 else 3
        elif typ == b'IDAT':
            idat += body
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * bpp
    prev = bytearray(stride)
    filled = total = 0
    i = 0
    while i < len(raw):
        f = raw[i]; line = bytearray(raw[i + 1:i + 1 + stride]); i += 1 + stride
        for k in range(stride):
            a = line[k - bpp] if k >= bpp else 0
            b = prev[k]; c = prev[k - bpp] if k >= bpp else 0
            if f == 1: line[k] = (line[k] + a) & 255
            elif f == 2: line[k] = (line[k] + b) & 255
            elif f == 3: line[k] = (line[k] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[k] = (line[k] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = line
        for px in range(w):
            total += 1
            if bpp == 4 and line[px * 4 + 3] > 0:
                filled += 1
    return f'{filled / total:.2%} gefüllt'


def getmap(name, url, layers, lat, lon, span):
    q = urllib.parse.urlencode({'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': layers, 'STYLES': '',
                                'CRS': 'EPSG:3857', 'BBOX': bbox(lat, lon, span), 'WIDTH': 512, 'HEIGHT': 512,
                                'FORMAT': 'image/png', 'TRANSPARENT': 'true'})
    try:
        st, hd, body = req(f'{url}?{q}')
        log(f'GetMap {name} ({span / 1000:.0f} km): HTTP {st} {hd.get("Content-Type")} {png_nontransparent(body) if "png" in hd.get("Content-Type", "") else body[:200]}')
    except Exception as e:  # noqa: BLE001
        log(f'GetMap {name}: Fehler {e}')


def fields_of(body):
    t = body.decode('utf-8', 'replace')
    tags = sorted(set(re.findall(r'<(?:[\w-]+:)?([A-Za-z_][\w-]*)[\s>/]', t)))
    keys = sorted(set(re.findall(r'^\s*([A-Za-z_][\w ]{0,40}?)\s*=', t, re.M)))
    coords = bool(re.search(r'<(?:\w+:)?(pos|coordinates|posList|Point)\b', t))
    return tags, keys, coords


def main():
    lat, lon = 50.5785, 11.8100  # Schleiz
    getmap('rettungswege (services)', GP, 'rettungswege', lat, lon, 8000)
    getmap('rettungswege (services)', GP, 'rettungswege', lat, lon, 30000)
    getmap('rettungspunkte (forst)', FORST, 'rettungspunkte', lat, lon, 8000)
    for fmt in ('application/vnd.ogc.gml', 'text/xml', 'application/json', 'text/plain', 'text/html'):
        q = urllib.parse.urlencode({'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetFeatureInfo', 'LAYERS': 'rettungspunkte',
                                    'QUERY_LAYERS': 'rettungspunkte', 'STYLES': '', 'CRS': 'EPSG:3857', 'BBOX': bbox(lat, lon, 6000),
                                    'WIDTH': 1, 'HEIGHT': 1, 'I': 0, 'J': 0, 'INFO_FORMAT': fmt, 'FEATURE_COUNT': 5})
        try:
            st, hd, body = req(f'{FORST}?{q}')
            tags, keys, coords = fields_of(body)
            n = len(re.findall(rb'rettungspunkte', body))
            log(f'GetFeatureInfo [{fmt}]: HTTP {st} {hd.get("Content-Type")} | CORS: {hd.get("Access-Control-Allow-Origin")} | '
                f'Bytes {len(body)} | Treffer~{n} | Koordinaten-Elemente: {coords}')
            log(f'   Elemente: {tags[:60]}')
            if keys:
                log(f'   Schlüssel: {keys[:40]}')
        except Exception as e:  # noqa: BLE001
            log(f'GetFeatureInfo [{fmt}]: Fehler {e}')
    for name, url in (('WFS ALKIS', f'{GP}/adv_alkis_wfs?SERVICE=WFS&REQUEST=GetCapabilities'),
                      ('GetMap DOP', f'{GP}/DOP?SERVICE=WMS&REQUEST=GetCapabilities')):
        try:
            st, hd, _ = req(url)
            log(f'CORS {name}: Access-Control-Allow-Origin = {hd.get("Access-Control-Allow-Origin")}')
        except Exception as e:  # noqa: BLE001
            log(f'CORS {name}: Fehler {e}')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(LOG) + '\n')


if __name__ == '__main__':
    main()
