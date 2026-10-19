import re

with open('mtrade_source/styles.css', 'r', encoding='utf-8') as f:
    css = f.read()

ids = set(re.findall(r'#([a-zA-Z0-9_\-]+)', css))
print("IDs in styles.css:", sorted(ids))
