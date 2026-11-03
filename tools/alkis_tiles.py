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
LOG_KEYS = []


def log(*a):
    line = ' '.join(str(x) for x in a)
    print(line, flush=True)
    LOG.append(line)


def lon2x(lon): return int((lon + 180) / 360 * 2 ** Z)
def lat2y(lat): return int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** Z)
def x2lon(x): return x / 2 ** Z * 360 - 180
def y2lat(y): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** Z))))


# --- ETRS89/UTM 32N (EPSG:25832) <-> geografisch, GRS80 ---
_A, _F, _K0, _E0 = 6378137.0, 1 / 298.257222101, 0.9996, 500000.0
_E2 = _F * (2 - _F)
_EP2 = _E2 / (1 - _E2)
_L0 = math.radians(9)


def to_utm(lat, lon):
    la, lo = math.radians(lat), math.radians(lon)
    n = _A / math.sqrt(1 - _E2 * math.sin(la) ** 2)
    t, c = math.tan(la) ** 2, _EP2 * math.cos(la) ** 2
    a = math.cos(la) * (lo - _L0)
    m = _A * ((1 - _E2 / 4 - 3 * _E2 ** 2 / 64 - 5 * _E2 ** 3 / 256) * la - (3 * _E2 / 8 + 3 * _E2 ** 2 / 32 + 45 * _E2 ** 3 / 1024) * math.sin(2 * la)
              + (15 * _E2 ** 2 / 256 + 45 * _E2 ** 3 / 1024) * math.sin(4 * la) - (35 * _E2 ** 3 / 3072) * math.sin(6 * la))
    x = _E0 + _K0 * n * (a + (1 - t + c) * a ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * _EP2) * a ** 5 / 120)
    y = _K0 * (m + n * math.tan(la) * (a * a / 2 + (5 - t + 9 * c + 4 * c * c) * a ** 4 / 24 + (61 - 58 * t + t * t + 600 * c - 330 * _EP2) * a ** 6 / 720))
    return x, y


def from_utm(x, y):
    m = y / _K0
    mu = m / (_A * (1 - _E2 / 4 - 3 * _E2 ** 2 / 64 - 5 * _E2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))
    p = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu) \
        + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu)
    n1 = _A / math.sqrt(1 - _E2 * math.sin(p) ** 2)
    t1, c1 = math.tan(p) ** 2, _EP2 * math.cos(p) ** 2
    r1 = _A * (1 - _E2) / (1 - _E2 * math.sin(p) ** 2) ** 1.5
    d = (x - _E0) / (n1 * _K0)
    lat = p - (n1 * math.tan(p) / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * _EP2) * d ** 4 / 24
                                         + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * _EP2 - 3 * c1 * c1) * d ** 6 / 720)
    lon = _L0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * _EP2 + 24 * t1 * t1) * d ** 5 / 120) / math.cos(p)
    return math.degrees(lat), math.degrees(lon)


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
        if pts[0][0] > 1000:                     # UTM (Rechtswert, Hochwert) → (lat, lon)
            pts = [from_utm(a, b) if a < 1e6 else from_utm(b, a) for a, b in pts]
        elif pts[0][0] < 30 < pts[0][1]:         # Achsreihenfolge (lon, lat) → (lat, lon)
            pts = [(b, a) for a, b in pts]
        if pts[0] == pts[-1]:
            pts = pts[:-1]
        kennz = vals.get('flstkennz', '')
        zae, nen = vals.get('flstnrzae', ''), vals.get('flstnrnen', '')
        if not zae and re.match(r'^\d{14}', kennz):   # LL GGGG FFF ZZZZZ NNNN|____ __
            zae = str(int(kennz[9:14]))
            nen = str(int(kennz[14:18])) if kennz[14:18].isdigit() and int(kennz[14:18]) else ''
        fm = re.search(r'\d+', vals.get('flur', '')) or (re.match(r'^\d{9}', kennz) and re.search(r'\d+', str(int(kennz[6:9]))))
        flur = str(int(fm.group())) if fm else vals.get('flur', '')
        try:
            area = round(float(vals.get('flaeche', '') or 0))
        except ValueError:
            area = 0
        if not LOG_KEYS:
            LOG_KEYS.append(1)
            log('  Felder: ' + ', '.join(f'{k}={v[:30]}' for k, v in vals.items() if k != 'geometrie'))
        out.append({
            'i': vals.get('flstkennz') or el.get('{http://www.opengis.net/gml/3.2}id') or f'{zae}-{nen}',
            'g': vals.get('gemarkung', ''), 'f': flur, 'n': f'{zae}/{nen}' if nen else zae,
            'm': vals.get('gemeinde', ''), 'l': vals.get('lagebeztxt', ''), 't': nutzung_text(vals.get('tntxt', '')), 'a': area,
            'q': encode(pts),
        })
    return out


def encode(pts):
    """Koordinaten als Ganzzahlen in Mikrograd, ab dem 2. Punkt als Differenz → kleine Dateien"""
    out, pl, pn = [], 0, 0
    for la, lo in pts:
        a, b = round(la * 1e6), round(lo * 1e6)
        out += [a - pl, b - pn]
        pl, pn = a, b
    return out


def centroid(q):
    la = lo = 0
    cl = cn = 0
    for i in range(0, len(q), 2):
        cl += q[i]; cn += q[i + 1]
        la += cl; lo += cn
    k = len(q) / 2
    return la / k / 1e6, lo / k / 1e6


def nutzung_text(raw):
    """'Wald; 3200|Grünland; 400' → 'Wald 0,32 ha, Grünland 400 m²' (größte zuerst)"""
    sums = {}
    for seg in raw.split('|'):
        name, _, a = seg.partition(';')
        try:
            a = float(a.strip())
        except ValueError:
            a = 0
        if name.strip():
            k = name.strip().replace('Strassen', 'Straßen')
            sums[k] = sums.get(k, 0) + a
    parts = sorted(((a, n) for n, a in sums.items()), reverse=True)

    def fmt(a):
        return f"{a / 10000:.2f} ha".replace('.', ',') if a >= 10000 else f"{a:,.0f} m²".replace(',', '.')
    return ', '.join(f'{n} {fmt(a)}' if a else n for a, n in parts)


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


WORKING = None   # (url, ns, variante)
VARIANTS = ['utm', 'urn', 'lonlat']


def variant_params(v, s, w, n, e):
    if v == 'urn':
        return {'SRSNAME': 'urn:ogc:def:crs:EPSG::4326', 'BBOX': f'{s},{w},{n},{e},urn:ogc:def:crs:EPSG::4326'}
    if v == 'lonlat':
        return {'SRSNAME': 'EPSG:4326', 'BBOX': f'{w},{s},{e},{n},EPSG:4326'}
    xs, ys = zip(*[to_utm(la, lo) for la in (s, n) for lo in (w, e)])
    return {'SRSNAME': 'urn:ogc:def:crs:EPSG::25832',
            'BBOX': f'{min(xs):.1f},{min(ys):.1f},{max(xs):.1f},{max(ys):.1f},urn:ogc:def:crs:EPSG::25832'}


def query(url, ns, v, s, w, n, e):
    feats, start = [], 0
    while True:
        q = urllib.parse.urlencode({
            'SERVICE': 'WFS', 'VERSION': '2.0.0', 'REQUEST': 'GetFeature', 'TYPENAMES': 'ave:Flurstueck',
            'NAMESPACES': f'xmlns(ave,{ns})', 'COUNT': PAGE, 'STARTINDEX': start, **variant_params(v, s, w, n, e),
        })
        raw = get(f'{url}?{q}')
        page = parse(raw)
        if start == 0 and not page and not WORKING:
            log(f'  Probe {url.rsplit("/", 1)[-1]} [{v}]: 0 Treffer. Antwort: {raw[:400]!r}')
        feats += page
        if len(page) < PAGE:
            return feats
        start += PAGE


def probe(s, w, n, e):
    """Findet Endpunkt und Koordinaten-Variante, die Flurstücke liefert."""
    global WORKING
    for url, ns in WFS:
        for v in VARIANTS:
            try:
                f = query(url, ns, v, s, w, n, e)
            except Exception as ex:  # noqa: BLE001
                log(f'  Probe {url.rsplit("/", 1)[-1]} [{v}]: Fehler {str(ex)[:200]}')
                continue
            if f:
                WORKING = (url, ns, v)
                log(f'  Verwende {url.rsplit("/", 1)[-1]} mit Variante {v} ({len(f)} Flurstücke in der Probe)')
                return True
    return False


def fetch_bbox(s, w, n, e):
    url, ns, v = WORKING
    return query(url, ns, v, s, w, n, e)


def run_region(name, bbox, gem_index, stats):
    minlon, minlat, maxlon, maxlat = bbox
    xs = range(lon2x(minlon), lon2x(maxlon) + 1)
    ys = range(lat2y(maxlat), lat2y(minlat) + 1)
    tiles = [(x, y) for x in xs for y in ys]
    log(f'Region {name}: {len(tiles)} Kacheln')
    if not WORKING:
        cx, cy = tiles[len(tiles) // 2]
        if not probe(y2lat(cy + 1), x2lon(cx), y2lat(cy), x2lon(cx + 1)):
            raise RuntimeError('Keine Variante liefert Flurstücke (siehe Probe-Zeilen)')

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
                    lat, lon = centroid(p['q'])
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
        if index['regionen'].get(nm, {}).get('bbox') == bb and index['regionen'][nm].get('ok') and index['regionen'][nm].get('flurstuecke'):
            log(f'Region {nm}: bereits vorhanden, übersprungen')
            continue
        before = dict(stats)
        try:
            run_region(nm, bb, gem_index, stats)
            ok = True
        except Exception as ex:  # noqa: BLE001
            log(f'Region {nm} abgebrochen: {ex}')
            ok = False
        index['regionen'][nm] = {'bbox': bb, 'ok': ok and stats['errors'] == before['errors'] and stats['parcels'] > before['parcels'],
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
