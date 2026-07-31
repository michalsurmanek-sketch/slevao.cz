from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')
css = '<link rel="stylesheet" href="assets/search-suggest.css">'
js = '<script src="assets/search-suggest.js"></script>'

if css not in text:
    text = text.replace('</head>', f'{css}\n</head>', 1)
if js not in text:
    text = text.replace('</body>', f'{js}\n</body>', 1)

path.write_text(text, encoding='utf-8')
print('Našeptávač je připojený k index.html')
