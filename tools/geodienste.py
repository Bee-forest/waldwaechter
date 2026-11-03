#!/usr/bin/env python3
"""
Liest die Ebenen der Thüringer Fachdienste aus (für die Konfiguration der App)
und lädt die Rettungspunkte (ThüringenForst / GDI-Th) als data/rettungspunkte.json.
Nur Standardbibliothek. Ergebnisse: data/geodienste/*.txt, data/rettungspunkte.json
"""
import json, os, re, sys, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(__file__))
from alkis_tiles import from_utm  # noqa: E402

GP = 'https://www.geoproxy.geoportal-th.de/geoproxy/services'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
os.makedirs(os.path.join(OUT, 'geodienste'), exist_ok=True)
LOG = []


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Waldwaechter-Geodienste/1.0'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def local(t): return t.rsplit('}', 1)[-1]


def wms_layers(name, url):
    try:
        root = ET.fromstring(get(f'{url}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0'))
    except Exception as e:  # noqa: BLE001
        log(f'{name}: Fehler {e}')
        return
    lines = []
    for lyr in root.iter():
        if local(lyr.tag) != 'Layer':
            continue
        nm = next((c.text for c in lyr if local(c.tag) == 'Name'), None)
        ti = next((c.text for c in lyr if local(c.tag) == 'Title'), '')
        mn = next((c.text for c in lyr if local(c.tag) == 'MinScaleDenominator'), '')
        mx = next((c.text for c in lyr if local(c.tag) == 'MaxScaleDenominator'), '')
        lines.append(f"{nm or '-'}\t{ti}\tq={lyr.get('queryable', '0')}\t{mn}-{mx}")
    with open(os.path.join(OUT, 'geodienste', f'{name}.txt'), 'w', encoding='utf-8') as f:
        f.write(f'# {url}\n' + '\n'.join(lines) + '\n')
    log(f'{name}: {len(lines)} Ebenen')


def wfs_types(name, url, pattern):
    try:
        raw = get(f'{url}?SERVICE=WFS&REQUEST=GetCapabilities&VERSION=2.0.0')
    except Exception as e:  # noqa: BLE001
        log(f'{name} WFS: Fehler {e}')
        return []
    names = re.findall(rb'<(?:wfs:)?Name>([^<]+)</(?:wfs:)?Name>', raw)
    names = [n.decode() for n in names]
    hits = [n for n in names if re.search(pattern, n, re.I)]
    with open(os.path.join(OUT, 'geodienste', f'{name}-wfs.txt'), 'w', encoding='utf-8') as f:
        f.write(f'# {url}\n' + '\n'.join(names) + '\n')
    log(f'{name} WFS: {len(names)} Typen, Treffer: {hits[:20]}')
    return hits


def rettungspunkte(url, typename):
    q = urllib.parse.urlencode({'SERVICE': 'WFS', 'VERSION': '2.0.0', 'REQUEST': 'GetFeature', 'TYPENAMES': typename,
                                'SRSNAME': 'urn:ogc:def:crs:EPSG::25832', 'COUNT': '20000'})
    raw = get(f'{url}?{q}')
    root = ET.fromstring(raw)
    if local(root.tag) == 'ExceptionReport':
        raise RuntimeError(raw[:300])
    pts = []
    for m in root.iter():
        if local(m.tag) not in ('member', 'featureMember'):
            continue
        feat = next(iter(m), None)
        if feat is None:
            continue
        props, pos = {}, None
        for el in feat.iter():
            tag = local(el.tag)
            if tag in ('pos', 'coordinates') and el.text:
                pos = [float(v) for v in re.split(r'[\s,]+', el.text.strip())[:2]]
            elif len(el) == 0 and el.text and el.text.strip() and tag not in ('pos', 'coordinates'):
                props[tag] = el.text.strip()
        if not pos:
            continue
        a, b = pos
        lat, lon = from_utm(a, b) if a < 1e6 else from_utm(b, a)
        pts.append({'lat': round(lat, 6), 'lon': round(lon, 6), 'p': props})
    return pts


GEOMIS = 'https://geomis.geoportal-th.de/geonetwork/srv'
RECORDS = {  # GeoMIS-Datensätze → Dienst-URLs auslesen
    'Standortskartierung': '98024be1-7c82-463e-b358-46e24918d100',
    'Waldbiotope': 'c70f0858-af9b-4395-9a0d-1b577e6d09e6',
    'Waldlebensraumtypen': 'cf94acf6-a09a-4588-95c4-91b607c60a90',
    'Waldflaechen': 'e0933608-2a3a-49f5-9028-69317a82c23a',
    'WMS-FORST': '5d4999ba-b26a-446e-ba4f-0356e66c5a38',
    'Offenlandbiotope': 'BEDA6822-A838-11D5-9EA4-009027776ED8',
}


def geomis_urls():
    urls = {}
    for name, rid in RECORDS.items():
        try:
            raw = get(f'{GEOMIS}/api/records/{rid}/formatters/xml').decode('utf-8', 'replace')
        except Exception as e:  # noqa: BLE001
            log(f'GeoMIS {name}: Fehler {e}')
            continue
        found = sorted(set(re.findall(r'https?://www\.geoproxy\.geoportal-th\.de/geoproxy/services[^\s"<>?]*', raw)))
        log(f'GeoMIS {name}: {found}')
        for u in found:
            urls[u.replace('http://', 'https://')] = name
    # Volltextsuche nach Rettungspunkten
    for term in ('Rettungspunkt', 'Standort'):
        try:
            q = urllib.parse.urlencode({'service': 'CSW', 'version': '2.0.2', 'request': 'GetRecords', 'typeNames': 'csw:Record',
                                        'resultType': 'results', 'elementSetName': 'full', 'constraintLanguage': 'CQL_TEXT',
                                        'constraint_language_version': '1.1.0', 'constraint': f"AnyText like '%{term}%'", 'maxRecords': '25'})
            raw = get(f'{GEOMIS}/ger/csw?{q}').decode('utf-8', 'replace')
            titles = re.findall(r'<dc:title>([^<]+)</dc:title>', raw)
            found = sorted(set(re.findall(r'https?://www\.geoproxy\.geoportal-th\.de/geoproxy/services[^\s"<>?]*', raw)))
            log(f'GeoMIS-Suche {term}: {titles[:25]}')
            log(f'GeoMIS-Suche {term} URLs: {found}')
            for u in found:
                urls.setdefault(u.replace('http://', 'https://'), f'Suche {term}')
        except Exception as e:  # noqa: BLE001
            log(f'GeoMIS-Suche {term}: Fehler {e}')
    return urls


def main():
    for u, name in geomis_urls().items():
        if u.rstrip('/').endswith('/services'):
            continue
        wms_layers(re.sub(r'[^A-Za-z0-9]+', '_', u.split('/services/', 1)[-1]) or name, u.rstrip('/'))
    wms_layers('FORST', f'{GP}/FORST')
    wms_layers('SCHUTZGEB', f'{GP}/SCHUTZGEB')
    hits = wfs_types('services', GP, r'rettung')
    hits += wfs_types('FORST', f'{GP}/FORST', r'rettung|standort')
    done = False
    for url in (GP, f'{GP}/FORST'):
        for t in ([h for h in hits if 'punkt' in h.lower()] or ['tmlnu:rettungspunkte']):
            try:
                pts = rettungspunkte(url, t)
            except Exception as e:  # noqa: BLE001
                log(f'Rettungspunkte {url} {t}: Fehler {str(e)[:200]}')
                continue
            if pts:
                with open(os.path.join(OUT, 'rettungspunkte.json'), 'w', encoding='utf-8') as f:
                    json.dump({'quelle': '© GDI-Th / ThüringenForst, dl-de/by-2-0', 'punkte': pts}, f, ensure_ascii=False, separators=(',', ':'))
                log(f'Rettungspunkte: {len(pts)} aus {url} {t}. Beispiel: {pts[0]}')
                done = True
                break
        if done:
            break
    with open(os.path.join(OUT, 'geodienste', 'log.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(LOG) + '\n')


if __name__ == '__main__':
    main()
