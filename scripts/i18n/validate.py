#!/usr/bin/env python3
"""Check one or more language packs against en.json.

Verifies key parity, interpolation placeholders, value types, and empty values
(an empty string silently falls back to English at runtime, so it's a defect).
Usage: python3 validate.py [code ...]   (no args = every pack)
"""
import json, os, re, sys, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import BASE

PH = re.compile(r'\{\{(\w+)\}\}')

def flat(node, prefix=''):
    out = {}
    for k, v in node.items():
        out.update(flat(v, prefix + k + '.') if isinstance(v, dict) else {prefix + k: v})
    return out

def phset(v):
    if isinstance(v, list):
        return set().union(*[set(PH.findall(str(x))) for x in v]) if v else set()
    return set(PH.findall(str(v)))

def check(code, en):
    tr = flat(json.load(open(os.path.join(BASE, f'{code}.json'))))
    missing = set(en) - set(tr)
    extra = set(tr) - set(en)
    ph_bad = [k for k in en if k in tr and phset(en[k]) != phset(tr[k])]
    type_bad = [k for k in en if k in tr and type(en[k]) != type(tr[k])]
    len_bad = [k for k in en if k in tr and isinstance(en[k], list) and len(en[k]) != len(tr[k])]
    # Only a truly empty string falls back to English at runtime
    # (i18next `returnEmptyString: false`); whitespace is a deliberate choice.
    empty = [k for k in en if k in tr and isinstance(tr[k], str)
             and tr[k] == '' and str(en[k]) != '']
    brand = [k for k in en if 'BloomPrint' in str(en[k]) and 'BloomPrint' not in str(tr.get(k, ''))]
    ok = not (missing or extra or ph_bad or type_bad or len_bad or empty or brand)
    print(f"{code}: {'OK' if ok else 'ISSUES'} | missing {len(missing)} extra {len(extra)} "
          f"placeholders {len(ph_bad)} types {len(type_bad)} listlen {len(len_bad)} "
          f"empty {len(empty)} brand {len(brand)}")
    for label, items in (('missing', missing), ('placeholder', ph_bad), ('empty', empty),
                         ('brand', brand), ('listlen', len_bad)):
        if items:
            print(f"    {label}: {sorted(items)[:5]}")
    return ok

if __name__ == '__main__':
    en = flat(json.load(open(os.path.join(BASE, 'en.json'))))
    codes = sys.argv[1:] or sorted(
        os.path.basename(p)[:-5] for p in glob.glob(os.path.join(BASE, '*.json'))
        if not p.endswith('en.json'))
    sys.exit(0 if all([check(c, en) for c in codes]) else 1)
