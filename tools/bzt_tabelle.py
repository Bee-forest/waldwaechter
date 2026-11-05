#!/usr/bin/env python3
"""Liest das Thüringer Tabellenwerk „Standortgerechte Baumarten- und Bestandeszieltypenwahl für die Wälder
des Freistaates Thüringen“ (Anlage 6 zur DO Waldbau, Fassung Juni 2015) und schreibt data/bzt/katalog.json.

Aufruf: python3 tools/bzt_tabelle.py Tabellenwerk.pdf   (braucht pdfplumber)
Die Tabellenseiten sind um 90° gedreht; die Zeichen werden in Spalten (Standortseinheit, Bodentyp,
Waldgesellschaft, Baumarten, drei BZT-Blöcke) einsortiert.
Ergebnis: { klimabereiche: {Ziffer: Name}, wuchseinheiten: {Nummer: {name, kb: {Ziffer: {Standortseinheit: {...}}}}} }
"""
import json, os, re, sys
import pdfplumber

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'bzt', 'katalog.json')
# Spaltengrenzen (gedrehte Seite, Abstand vom linken Rand in pt)
REG = [('name', 40, 105), ('boden', 105, 169), ('wald', 169, 237), ('arten', 237, 336), ('b0', 336, 426), ('b1', 426, 505), ('b2', 505, 600)]
TOP = ['BU', 'EI', 'LB']; BOT = ['FI', 'KI', 'NB']

def norm(t):
    t = t.replace('–', '-').replace('—', '-')
    t = re.sub(r'\s+', ' ', t).strip()
    return re.sub(r'(\w)- (\w+)', lambda m: m.group(0) if m.group(2) in ('oder', 'und', 'bis', 'bzw') else m.group(1) + ('-' if m.group(2)[0].isupper() else '') + m.group(2), t)

def zeilen(page):
    H = page.height
    cs = [c for c in page.chars if not c['upright']]
    for c in cs:
        c['row'] = (c['x0'] + c['x1']) / 2
        c['col'] = H - c['bottom']
    cs.sort(key=lambda c: c['row'])
    rows, cur = [], []
    for c in cs:
        if cur and c['row'] - cur[-1]['row'] > 1.6:
            rows.append(cur); cur = []
        cur.append(c)
    if cur:
        rows.append(cur)
    out = []
    for r in rows:
        r.sort(key=lambda c: c['col'])
        seg = {}
        for name, a, b in REG:
            part = [c for c in r if a <= c['col'] < b]
            if part:
                seg[name] = part
        out.append({'row': sum(c['row'] for c in r) / len(r), 'seg': seg, 'text': ''.join(c['text'] for c in r)})
    return out

def text2(chars):
    return ''.join(c['text'] for c in chars)

kat = {'quelle': 'Standortgerechte Baumarten- und Bestandeszieltypenwahl für die Wälder des Freistaates Thüringen, Tabellenwerk, Anlage 6 zur DO Waldbau, Fassung Juni 2015 (ThüringenForst)',
       'klimabereiche': {}, 'wuchseinheiten': {}}
we = kl = None
e = None

def schliessen():
    global e
    if not e:
        return
    arten = {'B': [], 'C': [], 'D': []}
    cur = None
    for t in e['arten']:
        m = re.match(r'^([ABCD]):\s*(.*)$', t)
        if m:
            cur = m.group(1); t = m.group(2)
        if cur in arten:
            arten[cur] += [x.strip() for x in t.split(',') if x.strip() and x.strip() not in '-']
    bzt = {}
    for j in range(3):
        for k, teile in ((TOP[j], e['b'][j]['oben']), (BOT[j], e['b'][j]['unten'])):
            t = norm(' '.join(teile))
            bzt[k] = [] if (not t or 'keine' in t.lower()) else [x.strip() for x in t.split(',') if x.strip()]
    ziel = kat['wuchseinheiten'][we]['kb'].setdefault(kl, {})
    code = e['code']
    if code in ziel:
        code = code + '*'
    ziel[code] = {'name': norm(' '.join(e['name'])), 'boden': norm(' '.join(e['boden'])), 'wald': norm(' '.join(e['wald'])), **arten, 'bzt': bzt}
    e = None

with pdfplumber.open(SRC) as pdf:
    for pno, page in enumerate(pdf.pages, 1):
        if page.rotation != 90:
            continue
        for z in zeilen(page):
            t = z['text']
            m = re.search(r'WUCHSEINHEIT:\s*(.+?)\s*\((\d+\.\d+\.\d+)\)', t)
            if m:
                schliessen()
                we = m.group(2)
                kat['wuchseinheiten'].setdefault(we, {'name': norm(m.group(1)), 'kb': {}})
                continue
            m = re.search(r'KLIMABEREICH:\s*(.+?)\s*\(Ziffer:\s*(\d+)\)', t)
            if m:
                schliessen()
                kl = m.group(2); kat['klimabereiche'][kl] = norm(m.group(1))
                continue
            if 'STANDORTS-' in t or 'EINHEIT' in t and 'BODENTYPEN' in t or re.fullmatch(r'\s*-?\s*\d+\s*-?\s*', t):
                continue
            if we is None or kl is None:
                continue
            seg = z['seg']
            nm = seg.get('name')
            if nm and all('Bold' in c['fontname'] for c in nm if c['text'].strip()) and nm[0]['col'] < 47:
                schliessen()
                e = {'code': ''.join(c['text'] for c in nm).strip(), 'name': [], 'boden': [], 'wald': [], 'arten': [], 'b': [{'oben': [], 'unten': [], 'teil': 'oben'} for _ in range(3)]}
                nm = None
            if not e:
                continue
            if nm: e['name'].append(text2(nm))
            if seg.get('boden'): e['boden'].append(text2(seg['boden']))
            if seg.get('wald'): e['wald'].append(text2(seg['wald']))
            if seg.get('arten'): e['arten'].append(text2(seg['arten']).strip())
            for j in range(3):
                part = seg.get(f'b{j}')
                if not part:
                    continue
                start = REG[4 + j][1]
                label = [c for c in part if c['col'] < start + 7 and c['text'].strip()]
                rest = [c for c in part if c['col'] >= start + 7]
                if label and label[0]['text'] in 'FKN' and e['b'][j]['teil'] == 'oben':
                    e['b'][j]['teil'] = 'unten'
                if rest:
                    e['b'][j][e['b'][j]['teil']].append(text2(rest))
schliessen()
n = sum(len(c) for w in kat['wuchseinheiten'].values() for c in w['kb'].values())
print('Wuchseinheiten', len(kat['wuchseinheiten']), 'Klimabereiche', kat['klimabereiche'], 'Einträge', n)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(kat, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
