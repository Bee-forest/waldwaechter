#!/usr/bin/env python3
"""
Lädt ALKIS-Flurstücke (offene Geobasisdaten Thüringen, © GDI-Th, dl-de/by-2-0)
über den WFS des Geoproxy und legt sie als kleine JSON-Kacheln ab, die die
Waldwächter-App ohne CORS-Probleme von ihrer eigenen Adresse laden kann.

Aufruf:
  python3 tools/alkis_tiles.py                 # alle Regionen aus data/regionen.txt
  python3 tools/alkis_tiles.py --bbox 10.80,50.62,10.98,50.74 --name Ilmenau

Ausgabe (data/alkis/):
  14/<x>/<y>.json    Flurstücke je Kachel (Web-Mercator, Zoomstufe 14)
  gem/<slug>.json    Suchindex je Gemarkung: "flur/nummer" -> [x, y]
  index.json         Übersicht: Regionen, Gemarkungen, Kachelanzahl
  log.txt            Protokoll des letzten Laufs
Nur Python-Standardbibliothek.
"""
import argparse, json, math, os, re, sys, time, unicodedata
import urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

Z = 14
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'alkis')
REGIONS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'regionen.txt')
WFS = [
    ('https://www.geoproxy.geoportal-th.de/geoproxy/services/adv_alkis_wfs',
     'http://repository.gdi-de.org/schemas/adv/produkt/alkis-vereinfacht/1.0'),
    ('https://www.geoproxy.geoportal-th.de/geoproxy/services/adv_alkis_v2_wfs',
     'http://repository.gdi-de.org/schemas/adv/produkt/alkis-vereinfacht/2.0'),
]
PAGE = 1000
LOG = []


def log(*a):
    line = ' '.join(str(x) for x in a)
    print(line, flush=True)
    LOG.append(line)


def lon2x(lon): return int((lon + 180) / 360 * 2 ** Z)
def lat2y(lat): return int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** Z)
def x2lon(x): return x / 2 ** Z * 360 - 180
def y2lat(y): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** Z))))


def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-') or 'unbekannt'


def local(tag): return tag.rsplit('}', 1)[-1]


def parse(xml_bytes):
    root = ET.fromstring(xml_bytes)
    if local(root.tag) == 'ExceptionReport':
        raise RuntimeError(ET.tostring(root, encoding='unicode')[:300])
    out = []
    for el in root.iter():
        if local(el.tag) != 'Flurstueck':
            continue
        vals = {}
        for c in el:
            vals[local(c.tag)] = (c.text or '').strip()
        ext = next((e for e in el.iter() if local(e.tag) == 'exterior'), el)
        pl = next((e for e in ext.iter() if local(e.tag) == 'posList'), None)
        nums = [float(v) for v in (pl.text.split() if pl is not None else [])]
        if len(nums) < 6:
            continue
        pts = list(zip(nums[0::2], nums[1::2]))
        if pts[0][0] < 30 < pts[0][1]:          # Achsreihenfolge (lon, lat) → (lat, lon)
            pts = [(b, a) for a, b in pts]
        if pts[0] == pts[-1]:
            pts = pts[:-1]
        zae, nen = vals.get('flstnrzae', ''), vals.get('flstnrnen', '')
        try:
            flur = str(int(vals.get('flur', '')))
        except ValueError:
            flur = vals.get('flur', '')
        try:
            area = round(float(vals.get('flaeche', '') or 0))
        except ValueError:
            area = 0
        out.append({
            'i': vals.get('flstkennz') or el.get('{http://www.opengis.net/gml/3.2}id') or f'{zae}-{nen}',
            'g': vals.get('gemarkung', ''), 'f': flur, 'n': f'{zae}/{nen}' if nen else zae,
            'm': vals.get('gemeinde', ''), 'l': vals.get('lagebeztxt', ''), 't': vals.get('tntxt', ''), 'a': area,
            'r': [round(c, 6) for p in pts for c in p],
        })
    return out


def get(url, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Waldwaechter-ALKIS-Kacheln/1.0'})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            time.sleep(3 * (k + 1))


WORKING = None


def fetch_bbox(s, w, n, e):
    global WORKING
    order = [WORKING] + [x for x in WFS if x != WORKING] if WORKING else WFS
    last = None
    for url, ns in order:
        feats, start = [], 0
        try:
            while True:
                q = urllib.parse.urlencode({
                    'SERVICE': 'WFS', 'VERSION': '2.0.0', 'REQUEST': 'GetFeature', 'TYPENAMES': 'ave:Flurstueck',
                    'NAMESPACES': f'xmlns(ave,{ns})', 'SRSNAME': 'urn:ogc:def:crs:EPSG::4326',
                    'BBOX': f'{s},{w},{n},{e},urn:ogc:def:crs:EPSG::4326', 'COUNT': PAGE, 'STARTINDEX': start,
                })
                page = parse(get(f'{url}?{q}'))
                feats += page
                if len(page) < PAGE:
                    break
                start += PAGE
            WORKING = (url, ns)
            return feats
        except Exception as ex:  # noqa: BLE001
            last = ex
    raise RuntimeError(f'WFS fehlgeschlagen: {last}')


def run_region(name, bbox, gem_index, stats):
    minlon, minlat, maxlon, maxlat = bbox
    xs = range(lon2x(minlon), lon2x(maxlon) + 1)
    ys = range(lat2y(maxlat), lat2y(minlat) + 1)
    tiles = [(x, y) for x in xs for y in ys]
    log(f'Region {name}: {len(tiles)} Kacheln')

    def job(t):
        x, y = t
        n, s = y2lat(y), y2lat(y + 1)
        w, e = x2lon(x), x2lon(x + 1)
        try:
            feats = fetch_bbox(s, w, n, e)
        except Exception as ex:  # noqa: BLE001
            return t, None, str(ex)[:300]
        return t, feats, None

    done = 0
    with ThreadPoolExecutor(max_workers=3) as pool:
        for (x, y), feats, err in pool.map(job, tiles):
            done += 1
            if err:
                stats['errors'] += 1
                log(f'  Fehler Kachel {x}/{y}: {err}')
                if stats['errors'] >= 5 and stats['tiles'] == 0:
                    raise RuntimeError('Abbruch: WFS nicht erreichbar')
                continue
            if feats:
                d = os.path.join(OUT, str(Z), str(x))
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, f'{y}.json'), 'w', encoding='utf-8') as f:
                    json.dump(feats, f, ensure_ascii=False, separators=(',', ':'))
                stats['tiles'] += 1
                stats['parcels'] += len(feats)
                for p in feats:
                    lat = sum(p['r'][0::2]) / (len(p['r']) / 2)
                    lon = sum(p['r'][1::2]) / (len(p['r']) / 2)
                    if lon2x(lon) == x and lat2y(lat) == y:   # Suchindex: Kachel des Schwerpunkts
                        gem_index.setdefault(p['g'], {})[f"{p['f']}/{p['n']}"] = [x, y]
            if done % 25 == 0:
                log(f'  {done}/{len(tiles)} Kacheln, {stats["parcels"]} Flurstücke')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bbox', help='minLon,minLat,maxLon,maxLat')
    ap.add_argument('--name', default='Region')
    a = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    idx_path = os.path.join(OUT, 'index.json')
    index = json.load(open(idx_path, encoding='utf-8')) if os.path.exists(idx_path) else {'regionen': {}, 'gemarkungen': {}}

    regions = []
    if a.bbox:
        regions.append((a.name, [float(v) for v in a.bbox.split(',')]))
    elif os.path.exists(REGIONS_FILE):
        for line in open(REGIONS_FILE, encoding='utf-8'):
            line = line.split('#', 1)[0].strip()
            if not line or ';' not in line:
                continue
            nm, bb = [p.strip() for p in line.split(';', 1)]
            regions.append((nm, [float(v) for v in bb.split(',')]))

    gem_index = {}
    for g, f in index.get('gemarkungen', {}).items():
        path = os.path.join(OUT, 'gem', f)
        if os.path.exists(path):
            gem_index[g] = json.load(open(path, encoding='utf-8'))

    stats = {'tiles': 0, 'parcels': 0, 'errors': 0}
    for nm, bb in regions:
        if index['regionen'].get(nm, {}).get('bbox') == bb and index['regionen'][nm].get('ok'):
            log(f'Region {nm}: bereits vorhanden, übersprungen')
            continue
        before = dict(stats)
        try:
            run_region(nm, bb, gem_index, stats)
            ok = True
        except Exception as ex:  # noqa: BLE001
            log(f'Region {nm} abgebrochen: {ex}')
            ok = False
        index['regionen'][nm] = {'bbox': bb, 'ok': ok and stats['errors'] == before['errors'],
                                 'flurstuecke': stats['parcels'] - before['parcels'], 'stand': time.strftime('%Y-%m-%d')}

    os.makedirs(os.path.join(OUT, 'gem'), exist_ok=True)
    for g, entries in gem_index.items():
        f = f'{slug(g)}.json'
        index['gemarkungen'][g] = f
        with open(os.path.join(OUT, 'gem', f), 'w', encoding='utf-8') as fh:
            json.dump(entries, fh, ensure_ascii=False, separators=(',', ':'))
    index['zoom'] = Z
    index['quelle'] = '© GDI-Th, dl-de/by-2-0 (ALKIS vereinfacht, Geoproxy Thüringen)'
    with open(idx_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    log(f'Fertig: {stats["tiles"]} Kacheln, {stats["parcels"]} Flurstücke, {stats["errors"]} Fehler')
    with open(os.path.join(OUT, 'log.txt'), 'w', encoding='utf-8') as f:
        f.write(time.strftime('%Y-%m-%d %H:%M UTC\n') + '\n'.join(LOG) + '\n')


if __name__ == '__main__':
    sys.exit(main())
