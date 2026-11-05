#!/usr/bin/env python3
"""Lädt die forstlichen Wuchseinheiten Thüringens (Open Data ThüringenForst, dl-de/by-2-0) und schreibt
data/bzt/wuchseinheiten.json: [{we, name, rings: [[[E, N], …]]}] in UTM 32 (ganze Meter), vereinfacht auf 10 m."""
import io, json, os, urllib.request, zipfile
import shapefile

U = 'https://www.geoproxy.geoportal-th.de/download-service/opendata/forst/WUCHSEINHEITEN.zip'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'bzt', 'wuchseinheiten.json')

def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1; L = (dx * dx + dy * dy) ** 0.5 or 1e-9
        best, bi = 0, -1
        for i in range(a + 1, b):
            x, y = pts[i]
            d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L
            if d > best: best, bi = d, i
        if best > tol:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

b = urllib.request.urlopen(urllib.request.Request(U, headers={'User-Agent': 'Waldwaechter/1.0'}), timeout=300).read()
z = zipfile.ZipFile(io.BytesIO(b))
r = shapefile.Reader(shp=io.BytesIO(z.read('WUCHSEINHEITEN.shp')), dbf=io.BytesIO(z.read('WUCHSEINHEITEN.dbf')), shx=io.BytesIO(z.read('WUCHSEINHEITEN.shx')), encoding='latin-1')
out = []
for sr in r.shapeRecords():
    rec = sr.record.as_dict()
    pts, parts = sr.shape.points, list(sr.shape.parts) + [len(sr.shape.points)]
    rings = []
    for i in range(len(parts) - 1):
        ring = [(round(x), round(y)) for x, y in pts[parts[i]:parts[i + 1]]]
        ring = dp(ring, 10)
        if len(ring) >= 4:
            rings.append([list(p) for p in ring])
    out.append({'we': str(rec['WE_NR']).strip(), 'name': str(rec['W_EINHEIT']).strip(), 'gebiet': str(rec['W_GEBIET']).strip(), 'rings': rings})
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'Wuchseinheiten', sum(len(x['rings']) for x in out), 'Ringe')
