#!/usr/bin/env python3
"""Oberhöhe aus LiDAR-Höhenmodellen des TLBG (DOM1 − DGM1) für die Waldflächen der App-Regionen.

Ablauf (läuft täglich über GitHub Actions, bis alle Kacheln fertig sind):
  1. Prüfen, ob der Höhendaten-Download (ATOM-Feeds DOM/DGM) erreichbar ist. Bei Wartungsseite: Ende.
  2. Aus den Feeds die Download-Links der 1×1-km-Kacheln lesen (neuester Jahrgang je Kachel).
  3. Nur Kacheln mit Wald (laut data/baumarten) in den Regionen aus data/regionen.txt bearbeiten.
  4. Je Kachel: nDOM = DOM1 − DGM1, je 10-m-Zelle das 95-%-Perzentil (≈ Höhe der höchsten Bäume),
     als Byte in 0,2-m-Schritten → data/oberhoehe/<E-km>_<N-km>.bin (100 × 100, Zeile 0 = Norden).
Lizenz der Höhendaten: © GDI-Th, dl-de/by-2-0 bzw. CC BY 4.0 (laut Feed).
"""
import argparse, glob, io, json, math, os, re, sys, time, urllib.request, zipfile
from html import unescape

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'data', 'oberhoehe')
LOGF = os.path.join(OUT, 'log.txt')
FEEDS = {
    'dom': 'https://geoportal.geoportal-th.de/dienste/atom_th_hoehendaten_dom?type=service&id=597871e8-45ef-4436-b747-ddba363251e8',
    'dgm': 'https://geoportal.geoportal-th.de/dienste/atom_th_hoehendaten_dgm?type=service&id=076b4473-7334-4ce5-bee4-13651807b58b',
}
KNOWN_DATASETS = {
    'dom': ['https://geoportal.geoportal-th.de/dienste/atom_th_hoehendaten_dom?type=dataset&id=3b5d8d9c-775d-4617-8dfe-71480d6472a6'],
    'dgm': ['https://geoportal.geoportal-th.de/dienste/atom_th_hoehendaten_dgm?type=dataset&id=14418d25-fcd7-4a3f-99a9-e3059a2772af'],
}
# Dateinamen wie dom1_32_636_5621_1_th_2020-2025.zip / dgm1_32_636_5621_1_th_2014-2019.tif
NAME = re.compile(r'(dom|dgm)1_32_?(\d{3})_(\d{4})_\d+_th_(\d{4})-(\d{4})[^"\'<>\s]*?\.(zip|tif|tiff|xyz)', re.I)
LINES = []


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s, flush=True)
    LINES.append(f'{time.strftime("%Y-%m-%d %H:%M")} {s}')


def get(url, timeout=300, tries=3):
    last = None
    for i in range(tries):
        try:
            r = urllib.request.Request(url, headers={'User-Agent': 'Waldwaechter-Oberhoehe/1.0 (GitHub Actions)'})
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return resp.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(5 * (i + 1))
    raise last


def wartung(text):
    return 'Serviceinformation' in text and 'nicht verf' in text


# ---------- UTM 32 (GRS80) ----------
_A, _F = 6378137.0, 1 / 298.257222101
_E2 = _F * (2 - _F); _EP2 = _E2 / (1 - _E2); _K0, _E0, _L0 = 0.9996, 500000.0, math.radians(9)


def to_utm(lat, lon):
    phi, lam = math.radians(lat), math.radians(lon)
    n = _A / math.sqrt(1 - _E2 * math.sin(phi) ** 2)
    t = math.tan(phi) ** 2; c = _EP2 * math.cos(phi) ** 2; a = math.cos(phi) * (lam - _L0)
    e4, e6 = _E2 ** 2, _E2 ** 3
    m = _A * ((1 - _E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * _E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
              + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi) - (35 * e6 / 3072) * math.sin(6 * phi))
    x = _E0 + _K0 * n * (a + (1 - t + c) * a ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * _EP2) * a ** 5 / 120)
    y = _K0 * (m + n * math.tan(phi) * (a * a / 2 + (5 - t + 9 * c + 4 * c * c) * a ** 4 / 24 + (61 - 58 * t + t * t + 600 * c - 330 * _EP2) * a ** 6 / 720))
    return x, y


# ---------- Waldkacheln ----------
def regionen():
    out = []
    for line in open(os.path.join(ROOT, 'data', 'regionen.txt'), encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#') or ';' not in line:
            continue
        name, bb = line.split(';', 1)
        out.append((name.strip(), [float(v) for v in bb.split(',')]))
    return out


def waldkacheln():
    """km-Kacheln (E, N), die Bestände aus data/baumarten berühren und in einer Region liegen."""
    regs = regionen()
    tiles = set()
    for f in glob.glob(os.path.join(ROOT, 'data', 'baumarten', '14', '*', '*.json')):
        for it in json.load(open(f, encoding='utf-8')):
            for q in it.get('r', []):
                la = lo = 0; lats = []; lons = []
                for i in range(0, len(q) - 1, 2):
                    la += q[i]; lo += q[i + 1]; lats.append(la / 1e6); lons.append(lo / 1e6)
                if not lats:
                    continue
                cla, clo = sum(lats) / len(lats), sum(lons) / len(lons)
                if not any(b[0] <= clo <= b[2] and b[1] <= cla <= b[3] for _, b in regs):
                    continue
                xs, ys = zip(*(to_utm(a, o) for a, o in zip(lats, lons)))
                for e in range(int(min(xs) // 1000), int(max(xs) // 1000) + 1):
                    for n in range(int(min(ys) // 1000), int(max(ys) // 1000) + 1):
                        tiles.add((e, n))
    return tiles


# ---------- Feeds ----------
def links_aus_feeds(kind, max_feeds=60):
    """Sammelt Download-Links je Kachel: {(E, N): (jahr_bis, url)} – neuester Jahrgang gewinnt."""
    seen, queue, files = set(), [FEEDS[kind]] + KNOWN_DATASETS[kind], {}
    while queue and len(seen) < max_feeds:
        u = queue.pop(0)
        if u in seen:
            continue
        seen.add(u)
        try:
            t = get(u, timeout=600).decode('utf-8', 'replace')
        except Exception as e:  # noqa: BLE001
            log(f'{kind}: Feed {u} nicht lesbar: {e}')
            continue
        if wartung(t):
            log(f'{kind}: Wartungsseite bei {u}')
            return None
        hrefs = [unescape(h) for h in re.findall(r'href=["\']([^"\']+)["\']', t)]
        for h in hrefs:
            m = NAME.search(h)
            if m and m.group(1).lower() == kind:
                key = (int(m.group(2)), int(m.group(3)))
                year = int(m.group(5))
                if key not in files or year > files[key][0]:
                    files[key] = (year, h)
            elif 'atom' in h and ('type=dataset' in h or h.endswith('.xml')) and h not in seen:
                queue.append(h)
        log(f'{kind}: {u[:110]} → {len(hrefs)} Links, bisher {len(files)} Kacheln')
    return files


# ---------- Raster lesen ----------
def lies_raster(blob, name, e, n):
    """Gibt ein 1000×1000-Array (1 m, Zeile 0 = Norden) für die Kachel E/N zurück; NaN = keine Daten."""
    import numpy as np
    if name.lower().endswith('.zip'):
        z = zipfile.ZipFile(io.BytesIO(blob))
        inner = [x for x in z.namelist() if re.search(r'\.(tif|tiff|xyz|txt)$', x, re.I)]
        if not inner:
            raise ValueError(f'kein Raster in {name}: {z.namelist()[:5]}')
        inner.sort(key=lambda x: (not x.lower().endswith(('.tif', '.tiff')), x))
        return lies_raster(z.read(inner[0]), inner[0], e, n)
    grid = np.full((1000, 1000), np.nan, dtype=np.float32)
    x0, ytop = e * 1000, n * 1000 + 1000
    if name.lower().endswith(('.tif', '.tiff')):
        import rasterio
        with rasterio.MemoryFile(blob) as mf, mf.open() as ds:
            a = ds.read(1).astype(np.float32)
            nod = ds.nodata
            if nod is not None:
                a[a == nod] = np.nan
            a[a < -1000] = np.nan
            tr = ds.transform
            rx, ry = tr.a, -tr.e
            cols = np.floor((x0 + np.arange(1000) + 0.5 - tr.c) / rx).astype(int)
            rows = np.floor((tr.f - (ytop - np.arange(1000) - 0.5)) / ry).astype(int)
            okc = (cols >= 0) & (cols < a.shape[1]); okr = (rows >= 0) & (rows < a.shape[0])
            sub = a[np.ix_(rows.clip(0, a.shape[0] - 1), cols.clip(0, a.shape[1] - 1))]
            sub[~okr, :] = np.nan; sub[:, ~okc] = np.nan
            return sub
    # XYZ: Rechtswert Hochwert Höhe
    data = np.loadtxt(io.BytesIO(blob), usecols=(0, 1, 2), dtype=np.float64)
    c = np.floor(data[:, 0] - x0).astype(int); r = np.floor(ytop - data[:, 1]).astype(int)
    ok = (c >= 0) & (c < 1000) & (r >= 0) & (r < 1000)
    grid[r[ok], c[ok]] = data[ok, 2]
    return grid


def kachel_rechnen(e, n, dom, dgm):
    import numpy as np
    (yd, ud), (yg, ug) = dom, dgm
    a = lies_raster(get(ud, timeout=900), ud.split('?')[0], e, n)
    b = lies_raster(get(ug, timeout=900), ug.split('?')[0], e, n)
    ndom = a - b
    ndom[(ndom < -2) | (ndom > 70)] = np.nan
    cells = ndom.reshape(100, 10, 100, 10).transpose(0, 2, 1, 3).reshape(100, 100, 100)
    with np.errstate(all='ignore'):
        import warnings
        warnings.simplefilter('ignore')
        p95 = np.nanpercentile(cells, 95, axis=2)
    p95 = np.nan_to_num(p95, nan=0.0)
    out = np.clip(np.round(p95 / 0.2), 0, 255).astype(np.uint8)
    path = os.path.join(OUT, f'{e}_{n}.bin')
    out.tofile(path)
    return f'{yd}', float(np.nanmax(p95)) if out.any() else 0.0


def selbsttest():
    """Prüft das Lesen von GeoTIFF (ZIP) mit einer künstlichen Kachel: Nordhälfte 28 m hoch."""
    import numpy as np, rasterio
    from rasterio.transform import from_origin
    global get, OUT
    e, n = 702, 5621
    def tif(arr):
        mf = rasterio.MemoryFile()
        with mf.open(driver='GTiff', height=1000, width=1000, count=1, dtype='float32', crs='EPSG:25832',
                     transform=from_origin(e * 1000, n * 1000 + 1000, 1, 1), nodata=-9999, compress='lzw') as ds:
            ds.write(arr, 1)
        return mf.read()
    dgm = np.full((1000, 1000), 300, np.float32); dom = dgm.copy(); dom[:500] += 28; dom[0, 0] = -9999
    z = io.BytesIO(); zf = zipfile.ZipFile(z, 'w'); zf.writestr('dom1.tif', tif(dom)); zf.close()
    get = lambda u, timeout=0, tries=0: z.getvalue() if 'dom' in u else tif(dgm)  # noqa: E731
    OUT = '/tmp'
    kachel_rechnen(e, n, (2025, 'x/dom1.zip'), (2025, 'x/dgm1.tif'))
    b = np.fromfile(f'/tmp/{e}_{n}.bin', np.uint8).reshape(100, 100)
    nord, sued = b[:50].mean() * 0.2, b[50:].mean() * 0.2
    print(f'Selbsttest: Nord {nord:.1f} m, Süd {sued:.1f} m')
    assert abs(nord - 28) < 0.3 and sued < 0.5, 'Selbsttest fehlgeschlagen'


def main():
    if '--selbsttest' in sys.argv:
        return selbsttest()
    ap = argparse.ArgumentParser()
    ap.add_argument('--minuten', type=float, default=300)
    ap.add_argument('--max', type=int, default=4000)
    args = ap.parse_args()
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    idx_path = os.path.join(OUT, 'index.json')
    idx = json.load(open(idx_path, encoding='utf-8')) if os.path.exists(idx_path) else {'kacheln': {}, 'quelle': 'TLBG DOM1/DGM1, © GDI-Th'}
    try:
        status = get(FEEDS['dom'], timeout=120).decode('utf-8', 'replace')
    except Exception as e:  # noqa: BLE001
        status = f'Fehler {e}'
    if wartung(status) or status.startswith('Fehler'):
        log('Höhendaten-Download nicht verfügbar (Wartung oder Fehler) – nächster Versuch beim nächsten Lauf.', status[:120] if status.startswith('Fehler') else '')
        idx['letzte_pruefung'] = time.strftime('%Y-%m-%d %H:%M'); idx['status'] = 'Download nicht verfügbar'
        json.dump(idx, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        return finish()
    wald = waldkacheln()
    log(f'Waldkacheln in den Regionen: {len(wald)}')
    dom = links_aus_feeds('dom'); dgm = links_aus_feeds('dgm')
    if not dom or not dgm:
        log('Keine Kachel-Links gefunden.'); idx['status'] = 'keine Links'
        json.dump(idx, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        return finish()
    offen = sorted(k for k in wald if f'{k[0]}_{k[1]}' not in idx['kacheln'] and k in dom and k in dgm)
    log(f'DOM-Kacheln im Feed: {len(dom)}, DGM: {len(dgm)}, offen: {len(offen)} (ohne Daten: {len([k for k in wald if k not in dom or k not in dgm])})')
    done = err = 0
    for e, n in offen[: args.max]:
        if (time.time() - t0) / 60 > args.minuten:
            log('Zeitbudget erreicht – Rest im nächsten Lauf.')
            break
        try:
            jahr, hmax = kachel_rechnen(e, n, dom[(e, n)], dgm[(e, n)])
            idx['kacheln'][f'{e}_{n}'] = jahr
            done += 1
            if done % 25 == 0:
                log(f'  {done} Kacheln fertig (zuletzt {e}_{n}, max. {hmax:.1f} m)')
                json.dump(idx, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        except Exception as ex:  # noqa: BLE001
            err += 1
            log(f'  Kachel {e}_{n}: Fehler {str(ex)[:200]}')
            if err > 50 and done == 0:
                log('Zu viele Fehler ohne Erfolg – Abbruch.'); break
    idx['status'] = 'fertig' if len(idx['kacheln']) >= len([k for k in wald if k in dom and k in dgm]) else 'in Arbeit'
    idx['letzte_pruefung'] = time.strftime('%Y-%m-%d %H:%M')
    idx['wald_kacheln'] = len(wald)
    json.dump(idx, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    log(f'Lauf beendet: {done} neu, {err} Fehler, gesamt {len(idx["kacheln"])} Kacheln.')
    finish()


def finish():
    os.makedirs(OUT, exist_ok=True)
    old = open(LOGF, encoding='utf-8').read().splitlines()[-300:] if os.path.exists(LOGF) else []
    open(LOGF, 'w', encoding='utf-8').write('\n'.join(old + LINES) + '\n')


if __name__ == '__main__':
    sys.exit(main())
