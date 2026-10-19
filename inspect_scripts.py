import re

for fname in ['mtrade_source/signal.js', 'mtrade_source/cabinet.js']:
    with open(fname, 'r', encoding='utf-8') as f:
        content = f.read()
    endpoints = set(re.findall(r'[`"\'](/api/[^`"\']*)', content))
    print(f'=== {fname} endpoints ===')
    for ep in sorted(endpoints):
        print(ep)
