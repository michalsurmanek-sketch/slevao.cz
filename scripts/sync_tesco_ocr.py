#!/usr/bin/env python3
"""Discover the current official Tesco hypermarket leaflet and OCR all proxy pages."""
import datetime
import hashlib
import html
import json
import os
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request

import sync_terno_ocr as worker

LANDING = "https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36"
worker.ENGINE = "tesseract-cli-ces-tesco-v1"
worker.SUPABASE_USER_AGENT = "slevao-github-actions-tesco-ocr/1.0"
_api = worker.api
_target = None


def request(url: str):
    return urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,image/avif,image/webp,image/jpeg,*/*;q=0.8",
            "Accept-Language": "cs-CZ,cs;q=0.9",
            "Referer": LANDING,
            "Cache-Control": "no-cache",
        },
    )


def landing_html():
    url = f"{LANDING}?_slevao={int(datetime.datetime.now().timestamp())}"
    with urllib.request.urlopen(request(url), timeout=60) as response:
        return response.read().decode("utf-8", "replace")


def find_cover(content: str):
    decoded = html.unescape(content).replace("\\u002F", "/").replace("\\/", "/")
    candidates = re.findall(r'https://digitalcontent\.api\.tesco\.com/[^"\'<> ]+?_CZ_HM-CHM\.1\.jpeg', decoded, re.I)
    if not candidates:
        encoded = re.findall(r'https%3A%2F%2Fdigitalcontent\.api\.tesco\.com%2F[^"\'<> ]+?_CZ_HM-CHM\.1\.jpeg', decoded, re.I)
        candidates = [urllib.parse.unquote(value) for value in encoded]
    if not candidates:
        raise RuntimeError("Current Tesco hypermarket cover was not found")
    return candidates[0]


def find_validity(content: str):
    text = re.sub(r"<[^>]+>", " ", html.unescape(content))
    text = re.sub(r"\s+", " ", text)
    match = re.search(r"Tesco Hypermarket\s+(\d{1,2})\.(\d{1,2})\.\s*-\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})", text, re.I)
    if not match:
        raise RuntimeError("Current Tesco hypermarket validity was not found")
    year = int(match.group(5))
    return (
        datetime.date(year, int(match.group(2)), int(match.group(1))).isoformat(),
        datetime.date(year, int(match.group(4)), int(match.group(3))).isoformat(),
    )


def proxy_url(image_url: str):
    return (
        "https://www.itesco.cz/customer-leaflets-fe-assets/_next/image?"
        + urllib.parse.urlencode({"url": image_url, "w": "1600", "q": "100"})
    )


def discover_pages(cover: str):
    pages = []
    misses = 0
    for number in range(1, 81):
        image = re.sub(r"\.1\.jpeg$", f".{number}.jpeg", cover, flags=re.I)
        url = proxy_url(image)
        try:
            with urllib.request.urlopen(request(url), timeout=45) as response:
                content_type = (response.headers.get("content-type") or "").lower()
                prefix = response.read(32)
                if response.status == 200 and content_type.startswith("image/") and len(prefix) >= 16:
                    pages.append(url)
                    misses = 0
                    continue
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            pass
        misses += 1
        if misses >= 3:
            break
    if len(pages) < 8:
        raise RuntimeError(f"Tesco proxy exposed only {len(pages)} pages")
    return pages


def ensure_import():
    content = landing_html()
    cover = find_cover(content)
    valid_from, valid_to = find_validity(content)
    pages = discover_pages(cover)
    stores = _api("GET", "/rest/v1/stores?" + urllib.parse.urlencode({"slug": "eq.tesco", "select": "id", "limit": "1"})) or []
    if not stores:
        raise RuntimeError("Tesco store not found")
    sources = _api("GET", "/rest/v1/leaflet_sources?" + urllib.parse.urlencode({"store_id": f"eq.{stores[0]['id']}", "is_active": "eq.true", "select": "id", "limit": "1"})) or []
    if not sources:
        raise RuntimeError("Active Tesco source not found")
    source_hash = hashlib.sha256(f"{sources[0]['id']}|{cover}|{valid_from}|{valid_to}|tesco-proxy-pages-v1".encode()).hexdigest()
    params = urllib.parse.urlencode({"source_hash": f"eq.{source_hash}", "select": "id", "limit": "1"})
    existing = _api("GET", f"/rest/v1/leaflet_imports?{params}") or []
    metadata = {
        "adapter": "tesco-proxy-pages-v1",
        "title": f"Tesco Hypermarket {valid_from} – {valid_to}",
        "viewer_url": LANDING,
        "cover_image_url": pages[0],
        "page_image_urls": pages,
        "page_count": len(pages),
        "ocr_required": True,
        "ocr_source": "official_tesco_next_image_proxy",
        "last_seen_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    values = {
        "source_id": sources[0]["id"],
        "store_id": stores[0]["id"],
        "source_document_url": LANDING,
        "source_hash": source_hash,
        "status": "published",
        "product_count": 0,
        "confidence": 0.99,
        "coverage_scope": "national",
        "detected_valid_from": valid_from,
        "detected_valid_to": valid_to,
        "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "error_message": None,
        "metadata": metadata,
    }
    if existing:
        import_id = existing[0]["id"]
        _api("PATCH", "/rest/v1/leaflet_imports?" + urllib.parse.urlencode({"id": f"eq.{import_id}"}), values, {"Prefer": "return=minimal"})
    else:
        inserted = _api("POST", "/rest/v1/leaflet_imports", values, {"Prefer": "return=representation"}) or []
        if not inserted:
            raise RuntimeError("Tesco import could not be created")
        import_id = inserted[0]["id"]
    return {"ok": True, "import_id": import_id, "page_image_urls": pages, "valid_from": valid_from, "valid_to": valid_to}


def api(method, path, body=None, extra_headers=None):
    if method == "POST" and path == "/rest/v1/rpc/get_terno_ocr_target":
        return _target
    return _api(method, path, body, extra_headers)


def direct_download(image_url: str, destination: str):
    parsed = urllib.parse.urlparse(image_url)
    if parsed.scheme != "https" or parsed.hostname != "www.itesco.cz" or "/customer-leaflets-fe-assets/_next/image" not in parsed.path:
        raise RuntimeError("Disallowed Tesco image URL")
    with urllib.request.urlopen(request(image_url), timeout=90) as response, open(destination, "wb") as output:
        content_type = (response.headers.get("content-type") or "").lower()
        if not content_type.startswith("image/"):
            raise RuntimeError(f"Tesco page is not an image: {content_type}")
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)


worker.api = api
worker.download = direct_download

if __name__ == "__main__":
    _target = ensure_import()
    print(json.dumps({"worker": "tesco", "engine": worker.ENGINE, "import_id": _target["import_id"], "pages": len(_target["page_image_urls"])}), flush=True)
    worker.main()
