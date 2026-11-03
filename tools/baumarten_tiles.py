#!/usr/bin/env python3
"""
Baumarten und Alter (ThüringenForst, Thüringer Waldverzeichnis, © GDI-Th, dl-de/by-2-0)
für die Regionen aus data/regionen.txt als Kacheln (Zoom 14) für die App.
Ausgabe: data/baumarten/14/<x>/<y>.json, data/baumarten/index.json
Benötigt: pyshp (pip install pyshp)
"""
import io, json, os, sys, time, urllib.request, zipfile
import shapefile
sys.path.insert(0, os.path.dirname(__file__))
from alkis_tiles import from_utm, to_utm, lon2x, lat2y, REGIONS_FILE, Z  # noqa: E402

URL = 'https://www.geoproxy.geoportal-th.de/download-service/opendata/forst/BAUMARTEN.zip'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'baumarten')


def regions():
    out = []
    for line in open(REGIONS_FILE, encoding='utf-8'):
        line = line.split('#', 1)[0].strip()
        if ';' in line:
            nm, bb = [p.strip() for p in line.split(';', 1)]
            out.append((nm, [float(v) for v in bb.split(',')]))
    return out


def encode(pts):
    out, pl, pn = [], 0, 0
    for la, lo in pts:
        a, b = round(la * 1e6), round(lo * 1e6)
        out += [a - pl, b - pn]; pl, pn = a, b
    return out


def main():
    regs = regions()
    utm_boxes = []
    for nm, (w, s, e, n) in regs:
        xs, ys = zip(*[to_utm(la, lo) for la in (s, n) for lo in (w, e)])
        utm_boxes.append((min(xs), min(ys), max(xs), max(ys)))
    t0 = time.time()
    req = urllib.request.Request(URL, headers={'User-Agent': 'Waldwaechter-Daten/1.0'})
    raw = urllib.request.urlopen(req, timeout=900).read()
    print(f'Download {len(raw)/1e6:.0f} MB in {time.time()-t0:.0f} s', flush=True)
    z = zipfile.ZipFile(io.BytesIO(raw))
    names = {os.path.splitext(n)[1].lower(): n for n in z.namelist()}
    r = shapefile.Reader(shp=io.BytesIO(z.read(names['.shp'])), shx=io.BytesIO(z.read(names['.shx'])),
                         dbf=io.BytesIO(z.read(names['.dbf'])), encoding='latin-1')
    fields = [f[0] for f in r.fields[1:]]
    tiles = {}
    n = 0
    for sr in r.iterShapeRecords():
        bb = sr.shape.bbox
        if not any(bb[0] < b[2] and bb[2] > b[0] and bb[1] < b[3] and bb[3] > b[1] for b in utm_boxes):
            continue
        rec = dict(zip(fields, sr.record))
        parts = list(sr.shape.parts) + [len(sr.shape.points)]
        rings = []
        for i in range(len(parts) - 1):
            pts = [from_utm(x, y) for x, y in sr.shape.points[parts[i]:parts[i + 1]]]
            if len(pts) > 1 and pts[0] == pts[-1]:
                pts = pts[:-1]
            if len(pts) >= 3:
                rings.append(encode([(round(a, 6), round(b, 6)) for a, b in pts]))
        if not rings:
            continue
        stichtag = rec.get('STICHTAG')
        jahr = stichtag.year if hasattr(stichtag, 'year') else int(str(stichtag)[:4]) if stichtag else None
        try:
            alter = round(float(rec.get('ALTER'))) if rec.get('ALTER') not in (None, '') else None
        except (TypeError, ValueError):
            alter = None
        def txt(v):
            if v is None:
                return ''
            if isinstance(v, float) and v.is_integer():
                return str(int(v))
            return str(v).strip()
        # Beschriftung wie im QGIS-Stil von ThüringenForst: ABT || ' ' || UABT || TFL, z. B. „1234 a1“
        kennung = f"{txt(rec.get('ABT'))} {txt(rec.get('UABT'))}{txt(rec.get('TFL'))}".strip()
        try:
            flaeche = round(float(rec.get('AREA'))) if rec.get('AREA') not in (None, '') else None
        except (TypeError, ValueError):
            flaeche = None
        item = {'b': rec.get('BA_KURZ'), 't': rec.get('KLARTEXT'), 'a': alter, 'j': jahr, 'k': kennung,
                'f': txt(rec.get('FOA')), 'v': txt(rec.get('REV')), 'q': flaeche, 'r': rings}
        lat1, lon1 = from_utm(bb[0], bb[1]); lat2, lon2 = from_utm(bb[2], bb[3])
        for x in range(lon2x(min(lon1, lon2)), lon2x(max(lon1, lon2)) + 1):
            for y in range(lat2y(max(lat1, lat2)), lat2y(min(lat1, lat2)) + 1):
                tiles.setdefault((x, y), []).append(item)
        n += 1
    for (x, y), items in tiles.items():
        d = os.path.join(OUT, str(Z), str(x)); os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f'{y}.json'), 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'quelle': 'ThüringenForst, Thüringer Waldverzeichnis (© GDI-Th, dl-de/by-2-0)', 'bestaende': n, 'kacheln': len(tiles),
                   'regionen': [r[0] for r in regs], 'stand': time.strftime('%Y-%m-%d')}, f, ensure_ascii=False, indent=1)
    print(f'Fertig: {n} Bestände in {len(tiles)} Kacheln', flush=True)


if __name__ == '__main__':
    main()
