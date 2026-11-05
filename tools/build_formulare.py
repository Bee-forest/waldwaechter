"""Erzeugt aus den Original-Antragsformularen (AcroForm) Metadaten für den Formular-Ausfüller im Browser.

Aufruf: python3 tools/build_formulare.py <pdf> <kurz>
Schreibt data/formulare/<kurz>.pdf (Kopie) und data/formulare/<kurz>.json.
Die JSON enthält je Feld die Objektnummer, das Original-Dictionary (ohne /V, /AS, /AP) und die Widgets,
damit der Browser eine inkrementelle Aktualisierung an das unveränderte Original anhängen kann.
"""
import io, json, re, shutil, sys
from pypdf import PdfReader
from pypdf.generic import DictionaryObject, NameObject, IndirectObject

src, kurz = sys.argv[1], sys.argv[2]
raw = open(src, 'rb').read()
r = PdfReader(src)
startxref = int(re.findall(rb'startxref\s+(\d+)', raw)[-1])

def ser(d, weg=('/V', '/AS', '/AP')):
    dd = DictionaryObject({k: v for k, v in d.items() if k not in weg})
    b = io.BytesIO(); dd.write_to_stream(b); return b.getvalue().decode('latin-1')

def ref(o): return f'{o.idnum} {o.generation} R'

root = r.trailer.raw_get('/Root')
af_ref = r.trailer['/Root'].raw_get('/AcroForm')
assert isinstance(af_ref, IndirectObject), 'AcroForm muss indirekt sein'
af = af_ref.get_object()
helv = af['/DR']['/Font'].raw_get('/Helv')

seite = {}
for i, p in enumerate(r.pages, 1):
    for a in p.get('/Annots') or []:
        seite[a.idnum] = i

felder = {}
def fmt_von(n):
    aa = n.get('/AA')
    if aa and '/F' in aa:
        m = re.search(r'AFNumber_Format\((\d+)', str(aa['/F'].get_object().get('/JS', '')))
        if m: return int(m.group(1))
    return None

def walk(ref_, name, erbe):
    n = ref_.get_object()
    t = n.get('/T'); nm = f'{name}.{t}' if name and t else (str(t) if t else name)
    e = dict(erbe)
    for k in ('/FT', '/DA', '/Ff', '/MaxLen', '/Q'):
        if k in n: e[k] = n[k]
    kids = n.get('/Kids')
    if kids and any('/T' in k.get_object() for k in kids):
        for k in kids: walk(k, nm, e)
        return
    widgets = [k for k in kids] if kids else [ref_]
    ft = str(e.get('/FT'))
    weg = ('/V', '/AS') if ft == '/Btn' else ('/V', '/AS', '/AP')
    f = {'o': ref(ref_), 'd': ser(n, weg), 't': 'btn' if ft == '/Btn' else 'tx' if ft == '/Tx' else ft,
         'ml': int(e['/MaxLen']) if '/MaxLen' in e else None, 'q': int(e.get('/Q', 0)),
         'ff': int(e.get('/Ff', 0)), 'fmt': fmt_von(n), 'da': str(e.get('/DA', af.get('/DA', ''))), 'w': []}
    for w in widgets:
        wo = w.get_object()
        on = None
        ap = wo.get('/AP')
        if ft == '/Btn' and ap and '/N' in ap and hasattr(ap['/N'], 'keys'):
            on = next((k for k in ap['/N'].keys() if k != '/Off'), None)
        wd = {'o': ref(w), 'r': [round(float(v), 2) for v in wo['/Rect']], 'p': seite.get(w.idnum)}
        if w.idnum != ref_.idnum: wd['d'] = ser(wo, weg)
        if on: wd['on'] = on[1:]
        if '/DA' in wo: wd['da'] = str(wo['/DA'])
        f['w'].append(wd)
    if nm in felder:  # gleicher Name zweimal (sollte nicht vorkommen)
        nm = nm + '#2'
    felder[nm] = f

for fr in af['/Fields']:
    walk(fr, '', {})

ids = r.trailer.get('/ID')
meta = {
    'size': int(r.trailer['/Size']), 'startxref': startxref, 'root': ref(root),
    'info': ref(r.trailer.raw_get('/Info')) if '/Info' in r.trailer else None,
    'id': [bytes(x.original_bytes if hasattr(x, 'original_bytes') else x.encode('latin-1')).hex() for x in ids] if ids else None,
    'acroform': {'o': ref(af_ref), 'd': ser(af, ('/NeedAppearances',))},
    'helv': ref(helv), 'laenge': len(raw), 'felder': felder,
}
shutil.copy(src, f'data/formulare/{kurz}.pdf')
json.dump(meta, open(f'data/formulare/{kurz}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(kurz, len(felder), 'Felder')
