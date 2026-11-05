#!/usr/bin/env python3
"""Prüft, welche forstlichen Open-Data-Downloads des Geoportals Thüringen es gibt
(Klimabereiche, Wuchseinheiten …), und beschreibt Felder und Werte der Shapefiles.
Ergebnis: data/geodienste/opendata.txt"""
import io, os, re, urllib.request, zipfile

BASE = 'https://www.geoproxy.geoportal-th.de/download-service/opendata/forst/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'geodienste', 'opendata.txt')
NAMEN = ['KLIMASTUFEN', 'KLIMABEREICHE', 'KLIMABEREICH', 'KLIMABEREICHE_2041_2070', 'KLIMABEREICHE_2070', 'KLIMABEREICHE_1971_2000',
         'WUCHSGEBIETE', 'WUCHSBEZIRKE', 'WUCHSEINHEITEN', 'TEILWUCHSBEZIRKE', 'WUCHSRAUM', 'STANDORT', 'STANDORTE', 'FORSTAEMTER', 'BAUMARTEN']
L = []
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); L.append(s)
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Waldwaechter/1.0'}), timeout=300) as r:
        return r.read()
for u in [BASE, BASE.replace('/forst/', '/')]:
    try:
        t = get(u).decode('utf-8', 'replace')
        log('LISTE', u, len(t)); log('\n'.join(sorted(set(re.findall(r'href="([^"]+)"', t))))[:6000])
    except Exception as e:  # noqa: BLE001
        log('LISTE', u, 'Fehler', e)
try:
    import shapefile  # pyshp
except ImportError:
    shapefile = None
for n in NAMEN:
    u = f'{BASE}{n}.zip'
    try:
        b = get(u)
    except Exception as e:  # noqa: BLE001
        log(n, 'nicht vorhanden', e); continue
    log(n, 'OK', len(b), 'Bytes')
    z = zipfile.ZipFile(io.BytesIO(b))
    log('  Dateien:', z.namelist())
    if not shapefile:
        continue
    for shp in [x for x in z.namelist() if x.lower().endswith('.shp')]:
        base = shp[:-4]
        try:
            r = shapefile.Reader(shp=io.BytesIO(z.read(shp)), dbf=io.BytesIO(z.read(base + '.dbf')), shx=io.BytesIO(z.read(base + '.shx')), encoding='latin-1')
            prj = z.read(base + '.prj').decode('latin-1')[:120] if base + '.prj' in z.namelist() else ''
            log(' ', shp, r.numRecords, 'Objekte', r.shapeTypeName, r.bbox, prj)
            fields = [f[0] for f in r.fields[1:]]
            log('  Felder:', fields)
            recs = r.records()
            for i, f in enumerate(fields):
                vals = sorted({str(x[i]) for x in recs})
                log(f'   {f}: {len(vals)} Werte, z. B. {vals[:25]}')
        except Exception as e:  # noqa: BLE001
            log('  Fehler beim Lesen', e)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
