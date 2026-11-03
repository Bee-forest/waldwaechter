#!/usr/bin/env python3
"""Liest die ATOM-Feeds der Höhendaten (DOM/DGM) aus, um das Download-Schema der Kacheln zu kennen."""
import os, re, urllib.request
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'geodienste', 'dom.txt')
LOG = []
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.append(s)
def get(u):
    r = urllib.request.Request(u, headers={'User-Agent': 'Waldwaechter-Check/1.0'})
    with urllib.request.urlopen(r, timeout=300) as resp:
        return resp.headers, resp.read()
def main():
    for kind, sid in (('dom', '597871e8-45ef-4436-b747-ddba363251e8'), ('dgm', '076b4473-7334-4ce5-bee4-13651807b58b')):
        try:
            _, raw = get(f'https://geoportal.geoportal-th.de/dienste/atom_th_hoehendaten_{kind}?type=service&id={sid}')
            t = raw.decode('utf-8', 'replace')
            log(f'{kind} ROH: ' + re.sub(r'\s+', ' ', t)[:2500])
            ds = sorted(set(re.findall(r'(https?://[^"\'<> ]*type=dataset[^"\'<> ]*)', t)))
            if kind == 'dgm':
                ds.append('https://geoportal.geoportal-th.de/dienste/atom_th_hoehendaten_dgm?type=dataset&id=14418d25-fcd7-4a3f-99a9-e3059a2772af')
            titles = re.findall(r'<title>([^<]+)</title>', t)
            log(f'{kind} Service: Titel {titles[:12]}'); log(f'  Datasets: {ds[:10]}')
            for d in ds[:4]:
                d = d.replace('&amp;', '&')
                _, raw2 = get(d); t2 = raw2.decode('utf-8', 'replace')
                links = re.findall(r'href=["\']([^"\']+)["\']', t2)
                tifs = [l for l in links if re.search(r'\.(tif|zip|xyz)', l, re.I)]
                log('    ROH: ' + re.sub(r'\s+', ' ', t2)[:1800])
                log(f'  Dataset {d}: {len(t2)} Zeichen, {len(links)} Links, {len(tifs)} Dateien; Titel {re.findall(r"<title>([^<]+)</title>", t2)[:4]}')
                log(f'    Beispiele: {tifs[:6]}')
                if tifs:
                    h, b = get(tifs[0].replace('&amp;', '&')) if len(tifs) else (None, b'')
                    log(f'    Testdownload {tifs[0]}: {len(b)/1e6:.1f} MB, {h.get("Content-Type")}')
                    break
        except Exception as e:  # noqa: BLE001
            log(f'{kind}: Fehler {e}')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write('\n'.join(LOG) + '\n')
if __name__ == '__main__':
    main()
