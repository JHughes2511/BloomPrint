#!/usr/bin/env python3
"""Emit a compact, numbered translation source for one language pack.

Only VALUES go to the translator (grouped under `## namespace` headers for
context) — ~40% smaller than shipping nested JSON, and the reply is numbered
values only. The key structure never leaves this machine, so assemble.py can
rebuild a pack with guaranteed key parity.

Paths are carried as TUPLES, not dotted strings: some real keys contain dots
(e.g. teamGrade.stats."Off. Reb"), which string-splitting would corrupt.
"""
import json, sys, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                    'mobile', 'src', 'i18n', 'locales')

def flatten(node, prefix=()):
    """Ordered (path_tuple, list_index_or_None, value) leaves, in en.json order."""
    out = []
    for k, v in node.items():
        p = prefix + (k,)
        if isinstance(v, dict):
            out += flatten(v, p)
        elif isinstance(v, list):
            out += [(p, i, item) for i, item in enumerate(v)]
        else:
            out.append((p, None, v))
    return out

def main(code):
    en = json.load(open(os.path.join(BASE, 'en.json')))
    leaves = flatten(en)
    lines, last_ns = [], None
    for i, (path, _idx, v) in enumerate(leaves, 1):
        if path[0] != last_ns:
            lines.append(f'## {path[0]}')
            last_ns = path[0]
        lines.append(f'{i}\t{v}'.replace('\n', '\\n'))
    src = '\n'.join(lines)
    out = os.path.join(os.environ.get('I18N_WORK', '/tmp'), f'pack-{code}-source.txt')
    open(out, 'w').write(src)
    print(f'{out}\n{len(leaves)} entries, {len(src)} chars (~{len(src)//4} tokens)')

if __name__ == '__main__':
    main(sys.argv[1])
