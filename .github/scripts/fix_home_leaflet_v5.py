from pathlib import Path

js_path = Path('assets/home-leaflet-covers.js')
js = js_path.read_text(encoding='utf-8')
replacements = [
    ("select: 'id,slug,name,logo_url,sort_order',", "select: 'id,slug,name,logo_url',"),
    ("order: 'sort_order.asc.nullslast,name.asc',", "order: 'name.asc',"),
    ("          || Number(a.sort_order ?? 9999) - Number(b.sort_order ?? 9999)\n", ""),
]
for old, new in replacements:
    if old not in js:
        raise SystemExit(f'Missing JS marker: {old!r}')
    js = js.replace(old, new, 1)
js_path.write_text(js, encoding='utf-8')

index_path = Path('index.html')
html = index_path.read_text(encoding='utf-8')
for old, new in [
    ('assets/home-leaflet-covers.js?v=20260802-4', 'assets/home-leaflet-covers.js?v=20260802-5'),
    ('"query-input":"required name=query"', '"query-input":"required name=search_term_string"'),
]:
    if old not in html:
        raise SystemExit(f'Missing index marker: {old!r}')
    html = html.replace(old, new, 1)
index_path.write_text(html, encoding='utf-8')
