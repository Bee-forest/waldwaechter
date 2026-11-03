#!/usr/bin/env python3
"""Untersucht BAUMARTEN.zip (Felder, Beispiele) und Download-Angebote für DOM/DGM (LiDAR)."""
import io, os, re, struct, urllib.request, zipfile, urllib.parse
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'geodienste', 'baumarten.txt')
LOG = []
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.append(s)
def get(url):
    r = urllib.request.Request(url, headers={'User-Agent': 'Waldwaechter-Check/1.0'})
    with urllib.request.urlopen(r, timeout=600) as resp:
        return resp.headers, resp.read()

def dbf(data, n=8):
    nrec, hlen, rlen = struct.unpack('<IHH', data[4:12])
    fields = []
    pos = 32
    while data[pos] != 0x0D:
        name = data[pos:pos + 11].split(b'\0')[0].decode('latin-1'); typ = chr(data[pos + 11]); ln = data[pos + 16]
        fields.append((name, typ, ln)); pos += 32
    log(f'DBF: {nrec} Datensätze, Felder: {fields}')
    rows = []
    for i in range(min(n, nrec)):
        off = hlen + i * rlen + 1; vals = {}
        for name, typ, ln in fields:
            vals[name] = data[off:off + ln].decode('latin-1', 'replace').strip(); off += ln
        rows.append(vals)
    for r in rows: log('  ', r)
    # Wertebereiche einzelner Felder
    from collections import Counter
    for name, typ, ln in fields:
        c = Counter()
        for i in range(0, nrec, max(1, nrec // 3000)):
            off = hlen + i * rlen + 1
            for nm, t, l in fields:
                if nm == name:
                    c[data[off:off + l].decode('latin-1', 'replace').strip()] += 1
                    break
                off += l
        log(f'  Feld {name}: {len(c)} Werte, häufig: {c.most_common(15)}')

def main():
    try:
        hd, raw = get('https://www.geoproxy.geoportal-th.de/download-service/opendata/forst/BAUMARTEN.zip')
        log(f'BAUMARTEN.zip: {len(raw)/1e6:.1f} MB')
        z = zipfile.ZipFile(io.BytesIO(raw))
        for i in z.infolist(): log(f'  {i.filename} {i.file_size/1e6:.1f} MB')
        for i in z.infolist():
            if i.filename.lower().endswith('.dbf'): dbf(z.read(i))
            if i.filename.lower().endswith('.prj'): log('PRJ', z.read(i)[:200])
    except Exception as e:  # noqa: BLE001
        log(f'BAUMARTEN: Fehler {e}')
    # Download-Angebote Höhendaten
    for u in ['https://www.geoportal-th.de/de-de/Downloadbereiche/Download-Offene-Geodaten-Th%C3%BCringen/Download-H%C3%B6hendaten',
              'https://geoportal.geoportal-th.de/hoehendaten/',
              'https://www.geoproxy.geoportal-th.de/download-service/opendata/',
              'https://geoportal.geoportal-th.de/gaialight-th/_apps/dladownload/dl-dom.html',
              'https://geoportal.geoportal-th.de/gaialight-th/_apps/dladownload/dl-hoehendaten-info.html']:
        try:
            hd, raw = get(u); t = raw.decode('utf-8', 'replace')
            links = sorted(set(re.findall(r'(?:href|src)=["\']([^"\']+)["\']', t)))
            interesting = [l for l in links if re.search(r'dom|dgm|hoeh|höh|laz|xyz|tif|zip|atom|download', l, re.I)]
            log(f'Seite {u}: {len(t)} Zeichen; Links: {interesting[:40]}')
            snippet = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t))
            for m in re.finditer(r'(DOM|nDOM|bDOM|Oberfl[aä]chenmodell)[^.]{0,200}', snippet):
                log('   …', m.group(0)[:220]); break
        except Exception as e:  # noqa: BLE001
            log(f'Seite {u}: Fehler {e}')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write('\n'.join(LOG) + '\n')

if __name__ == '__main__':
    main()
