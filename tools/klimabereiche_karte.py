#!/usr/bin/env python3
"""Erzeugt data/bzt/klimabereiche.png: Raster der forstlichen Klimabereiche Thüringens 2041–2070
aus der Karte im Anhang A des Tabellenwerks „Standortgerechte Baumarten- und Bestandeszieltypenwahl“
(ThüringenForst, 2015). Die Karte ist nur als Bild veröffentlicht; sie wird über die Grenzen der
Wuchseinheiten (Open Data) georeferenziert (affine Transformation, mittlere Abweichung < 1 Pixel ≈ 150 m).
Grauwert je Zelle = Ziffer des Klimabereichs (0 = außerhalb). Zellgröße 150 m, UTM 32.

Aufruf: python3 tools/klimabereiche_karte.py anhang_a.png   (Bild: pdfimages -f 173 -l 173 -png Tabellenwerk.pdf)
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, optimize

SRC = sys.argv[1]
HIER = os.path.dirname(__file__)
OUT = os.path.join(HIER, '..', 'data', 'bzt')
LEGENDE = {24: (202, 232, 255), 25: (118, 173, 222), 26: (0, 51, 105), 32: (205, 204, 205), 33: (203, 255, 201),
           34: (52, 181, 51), 35: (1, 95, 0), 42: (255, 205, 0), 43: (255, 235, 173)}
E0, N0, CELL = 560000.0, 5725000.0, 150.0
W, H = 1334, 1100  # bis E 760100, N 5560000

im = np.asarray(Image.open(SRC).convert('RGB')).astype(int)
R, G, B = im[..., 0], im[..., 1], im[..., 2]
we = json.load(open(os.path.join(OUT, 'wuchseinheiten.json'), encoding='utf-8'))

# 1) Georeferenzierung über die Grenzlinien der Wuchseinheiten (dunkelrot in der Karte)
grenze = (R > 70) & (R < 200) & (G < 90) & (B < 110) & (R - G > 40)
grenze[:400, 900:] = False
dick = ndimage.binary_opening(grenze, structure=np.ones((3, 3)))
grenze &= ~ndimage.binary_dilation(dick, iterations=2)
dist = ndimage.distance_transform_edt(~grenze)
P = np.array([p for w in we for r in w['rings'] for p in r[::2]], float)
def proj(a, Q):
    dx = (Q[:, 0] - E0) / 1000; dy = (N0 - Q[:, 1]) / 1000
    return a[0] + a[1] * dx + a[2] * dy, a[3] + a[4] * dx + a[5] * dy
def score(a, cap):
    x, y = proj(a, P)
    xi = np.clip(np.round(x).astype(int), 0, im.shape[1] - 1); yi = np.clip(np.round(y).astype(int), 0, im.shape[0] - 1)
    return np.mean(np.minimum(dist[yi, xi], cap))
best = None
for s in np.linspace(6.3, 7.0, 15):
    for x0 in range(60, 130, 3):
        for y0 in range(0, 70, 3):
            for rot in (-0.04, -0.02, 0, 0.02, 0.04):
                a = [x0, s * np.cos(rot), -s * np.sin(rot), y0, s * np.sin(rot), s * np.cos(rot)]
                v = score(a, 12)
                if best is None or v < best[0]: best = (v, a)
a = best[1]
for cap in (12, 6, 3):
    a = optimize.minimize(lambda q: score(q, cap), a, method='Nelder-Mead', options={'xatol': 1e-5, 'fatol': 1e-5, 'maxiter': 20000, 'maxfev': 20000}).x
print('Georeferenzierung, mittlere Abweichung (Pixel):', round(score(a, 3), 3), list(np.round(a, 5)))

# 2) Farben den Klimabereichen zuordnen
cols = np.array(list(LEGENDE.values()), float); keys = np.array(list(LEGENDE.keys()))
flat = im.reshape(-1, 3).astype(float)
d = ((flat[:, None, :] - cols[None, :, :]) ** 2).sum(-1)
nearest = d.argmin(1); dmin = d.min(1)
klasse = np.where(dmin < 30 ** 2, keys[nearest], 0).reshape(im.shape[:2])
klasse[:400, 900:] = 0  # Legende

# 3) Zellen in UTM abtasten
ee = E0 + (np.arange(W) + 0.5) * CELL; nn = N0 - (np.arange(H) + 0.5) * CELL
EE, NN = np.meshgrid(ee, nn)
x, y = proj(a, np.stack([EE.ravel(), NN.ravel()], 1))
xi = np.round(x).astype(int); yi = np.round(y).astype(int)
ok = (xi >= 0) & (xi < im.shape[1]) & (yi >= 0) & (yi < im.shape[0])
grid = np.zeros(W * H, np.uint8)
grid[ok] = klasse[yi[ok], xi[ok]]
grid = grid.reshape(H, W)

# 4) Thüringen-Maske aus den Wuchseinheiten; Lücken (Grenzlinien, Beschriftung) mit dem nächsten Klimabereich füllen
mask_img = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(mask_img)
for w in we:
    for r in w['rings']:
        dr.polygon([((e - E0) / CELL, (N0 - n) / CELL) for e, n in r], fill=255)
inside = np.asarray(mask_img) > 0
leer = (grid == 0)
_, (iy, ix) = ndimage.distance_transform_edt(leer, return_indices=True)
grid = grid[iy, ix]
grid[~inside] = 0
# vereinzelte Störpixel (Kompressionsartefakte) glätten: Modus im 3×3-Fenster
def modus(v):
    v = v[v > 0].astype(int)
    return np.bincount(v).argmax() if v.size else 0
grid = ndimage.generic_filter(grid, modus, size=3).astype(np.uint8)
grid[~inside] = 0
Image.fromarray(grid, 'L').save(os.path.join(OUT, 'klimabereiche.png'), optimize=True)
# Wuchseinheiten im selben Raster (Grauwert = laufende Nummer in der Liste „wuchseinheiten“).
# Maßgeblich ist die Nummerierung der Karte im Anhang A (= Tabellenwerk). Die Open-Data-Polygone liefern nur
# die Geometrie; ihre Nummern folgen teils einer anderen Gliederung (z. B. Vogtland, Ronneburger Schieferplatte).
# Deshalb wird jedes Polygon über die Beschriftung der Karte benannt (tools/wuchseinheiten_anhang_a.json).
from collections import defaultdict
Mi = np.linalg.inv(np.array([[a[1], a[2]], [a[4], a[5]]]))
def utm(x, y):
    dx, dy = Mi @ np.array([x - a[0], y - a[3]]); return E0 + dx * 1000, N0 - dy * 1000
def im_poly(p, rings):
    x, y = p; c = False
    for r in rings:
        for i in range(len(r)):
            x1, y1 = r[i]; x2, y2 = r[i - 1]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
labels = json.load(open(os.path.join(HIER, 'wuchseinheiten_anhang_a.json'), encoding='utf-8'))['labels']
kandidat = defaultdict(list)  # Polygon-Index -> [(Stimmen, Kartenbeschriftung)]
for lab, lx, ly in labels:
    votes = defaultdict(int)
    for dx in range(-30, 31, 6):
        for dy in range(-14, 15, 7):
            P_ = utm(lx + dx, ly + dy)
            for i, w in enumerate(we):
                if im_poly(P_, w['rings']): votes[i] += 1
    if votes:
        i = max(votes, key=votes.get); kandidat[i].append((votes[i], lab))
nummer = {}
for i, w in enumerate(we):
    labs = {l for _, l in kandidat.get(i, [])}
    nummer[i] = w['we'] if (not labs or w['we'] in labs) else max(kandidat[i])[1]
umbenannt = {w['we']: nummer[i] for i, w in enumerate(we) if nummer[i] != w['we']}
print('Nummern nach Karte Anhang A geändert:', umbenannt)
assert len(set(nummer.values())) == len(we), 'Wuchseinheit doppelt vergeben'
we_liste = sorted(set(nummer.values()), key=lambda t: [int(x) for x in t.split('.')])
we_img = Image.new('L', (W, H), 0); dw = ImageDraw.Draw(we_img)
for i, w in enumerate(we):
    for r in w['rings']:
        dw.polygon([((e - E0) / CELL, (N0 - n) / CELL) for e, n in r], fill=we_liste.index(nummer[i]) + 1)
we_img.save(os.path.join(OUT, 'wuchseinheiten.png'), optimize=True)
json.dump({'quelle_wuchseinheiten': 'Wuchseinheiten Thüringen, Open Data ThüringenForst (dl-de/by-2-0)', 'quelle': 'Forstliche Klimabereiche 2041–2070, Anhang A im Tabellenwerk Baumarten- und Bestandeszieltypenwahl (ThüringenForst 2015), georeferenziert',
           'E0': E0, 'N0': N0, 'zelle': CELL, 'breite': W, 'hoehe': H, 'genauigkeit_m': 150, 'wuchseinheiten': we_liste, 'umbenannt_gegenueber_open_data': umbenannt,
           'werte': {str(k): int((grid == k).sum()) for k in LEGENDE}}, open(os.path.join(OUT, 'klimabereiche.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print('Zellen je Klimabereich:', {k: int((grid == k).sum()) for k in LEGENDE})
