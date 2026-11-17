"""Prepare small, current leaflet covers once, outside visitors' browsers."""
import concurrent.futures
import hashlib
import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import fitz
from PIL import Image

BASE = 'https://uhampjdqjxmbhaptgitn.supabase.co'
KEY = os.environ.get('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU')
OUT = Path('assets/leaflet-thumbnails')
PRIORITY = ['penny', 'kaufland', 'lidl', 'tesco', 'makro', 'albert', 'billa', 'globus', 'coop', 'hruska', 'norma', 'terno', 'action', 'dm', 'rossmann', 'teta']
TODAY = datetime.now(ZoneInfo('Europe/Prague')).date().isoformat()


def current(row):
    return (not row.get('valid_from') or row['valid_from'] <= TODAY) and (not row.get('valid_to') or row['valid_to'] >= TODAY)


def document(url):
    if urlparse(url).scheme != 'https':
        raise ValueError('Only HTTPS leaflet documents are supported')
    headers = {'apikey': KEY} if urlparse(url).netloc == urlparse(BASE).netloc else {}
    with urlopen(Request(url, headers=headers), timeout=45) as response:
        raw = response.read()
        content_type = response.headers.get('content-type', '')
    if 'application/json' in content_type:
        target = json.loads(raw).get('url', '')
        if not target or target == url:
            raise ValueError('Missing leaflet document URL')
        if urlparse(target).scheme != 'https':
            raise ValueError('Invalid redirected document URL')
        with urlopen(target, timeout=45) as response:
            raw = response.read()
    return raw


def cover(row):
    identity = '|'.join(str(row.get(k) or '') for k in ['preview_url', 'leaflet_key', 'valid_from', 'valid_to'])
    digest = hashlib.sha256(identity.encode()).hexdigest()[:24]
    target = OUT / (digest + '.webp')
    if not target.exists():
        raw = document(row['preview_url'])
        if raw.startswith(b'%PDF'):
            with fitz.open(stream=raw, filetype='pdf') as pdf:
                page = pdf[0]
                scale = min(2, 400 / page.rect.width)
                pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                image = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
        else:
            image = Image.open(io.BytesIO(raw)).convert('RGB')
        image.thumbnail((400, 600))
        image.save(target, 'WEBP', quality=78, method=5)
    result = {key: row.get(key) for key in ['store_slug', 'store_name', 'logo_url', 'leaflet_key', 'title', 'valid_from', 'valid_to', 'preview_url']}
    result['cover_url'] = target.as_posix()
    result['cover_bytes'] = target.stat().st_size
    return result


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    with urlopen(Request(BASE + '/rest/v1/rpc/get_public_current_leaflets', data=b'{"p_limit":240}', headers={'apikey': KEY, 'Content-Type': 'application/json'}), timeout=30) as response:
        leaflets = json.load(response)
    query = urlencode({'select': 'slug,website_url,logo_url', 'is_active': 'eq.true'})
    with urlopen(Request(BASE + '/rest/v1/stores?' + query, headers={'apikey': KEY}), timeout=30) as response:
        stores = {s['slug']: s for s in json.load(response)}

    def marker(store, key):
        from urllib.parse import parse_qs
        return next((parse_qs(urlparse(store.get(field) or '').fragment).get(key, [''])[0] for field in ['website_url', 'logo_url'] if key in parse_qs(urlparse(store.get(field) or '').fragment)), '')

    selected = {}
    for row in leaflets:
        slug = row.get('store_slug')
        if slug not in stores or slug in selected or not row.get('preview_url') or not current(row):
            continue
        if marker(stores[slug], 'slevao-leaflet-visibility') == 'hidden':
            continue
        selected[slug] = row
    rows = sorted(selected.values(), key=lambda r: (marker(stores[r['store_slug']], 'slevao-leaflet-force') != '1', PRIORITY.index(r['store_slug']) if r['store_slug'] in PRIORITY else 999, r['store_name']))[:12]
    ready = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(cover, row): row for row in rows}
        for future in concurrent.futures.as_completed(futures):
            try:
                ready.append(future.result())
            except Exception as error:
                print('Cover unavailable:', futures[future]['store_slug'], type(error).__name__)
    if rows and not ready:
        raise RuntimeError('No current covers could be prepared; preserve the last manifest')
    order = {r['store_slug']: i for i, r in enumerate(rows)}
    ready.sort(key=lambda r: order[r['store_slug']])
    # Only public, currently published metadata goes into the static manifest.
    payload = {'version': 1, 'day': TODAY, 'generated_at': datetime.now(timezone.utc).isoformat(), 'leaflets': ready}
    (OUT / 'index.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    keep = {Path(r['cover_url']).name for r in ready}
    for path in OUT.glob('*.webp'):
        if path.name not in keep:
            path.unlink()
    print('Prepared', len(ready), 'covers;', sum(r['cover_bytes'] for r in ready), 'bytes total')


if __name__ == '__main__':
    build()
