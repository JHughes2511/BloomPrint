#!/usr/bin/env python3
"""Rebuild a language pack from the translator's numbered reply.

Structure comes from en.json, so key parity is guaranteed by construction —
missing/extra keys are impossible. Lines the translator omitted fall back to
English and are reported.
"""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import flatten, BASE

def main(code):
    en = json.load(open(os.path.join(BASE, 'en.json')))
    leaves = flatten(en)
    work = os.environ.get('I18N_WORK', '/tmp')
    raw = open(os.path.join(work, f'pack-{code}-out.txt')).read()

    trans = {}
    for line in raw.splitlines():
        line = line.rstrip('\r')
        if not line or line.startswith('##') or '\t' not in line:
            continue
        num, val = line.split('\t', 1)
        if num.strip().isdigit():
            trans[int(num.strip())] = val.replace('\\n', '\n')

    missing = [i for i in range(1, len(leaves) + 1) if i not in trans]

    out = {}
    for i, (path, idx, en_val) in enumerate(leaves, 1):
        val = trans.get(i, en_val)              # English fallback for any gap
        node = out
        for p in path[:-1]:
            node = node.setdefault(p, {})
        if idx is None:
            node[path[-1]] = val
        else:
            node.setdefault(path[-1], []).append(val)

    json.dump(out, open(os.path.join(BASE, f'{code}.json'), 'w'), indent=2, ensure_ascii=False)
    print(f'wrote {code}.json | translated {len(leaves)-len(missing)}/{len(leaves)}'
          + (f' | MISSING {len(missing)}: {missing[:10]}' if missing else ' | complete'))

if __name__ == '__main__':
    main(sys.argv[1])
