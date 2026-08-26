#!/usr/bin/env python3
"""OCR the canonical current Tesco Hypermarket Apollo page-image import."""
import datetime
import json
import os
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

import sync_terno_ocr as worker

LANDING = "https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy"
SOURCE_ADAPTER = "tesco-apollo-page-images-v1"
EXPECTED_PAGES = 32
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36"

worker.ENGINE = "tesseract-cli-ces-tesco-v1"
worker.SUPABASE_USER_AGENT = "slevao-github-actions-tesco-ocr/2.0"
worker.MAX_PAGES = 0
_api = worker.api
_target = None


def prague_today() -> str:
    return datetime.datetime.now(ZoneInfo("Europe/Prague")).date().isoformat()


def request(url: str):
    return urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8",
            "Accept-Language": "cs-CZ,cs;q=0.9",
            "Referer": LANDING,
            "Cache-Control": "no-cache",
        },
    )


def validate_page_url(url: str, page_number: int):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "digitalcontent.api.tesco.com":
        raise RuntimeError(f"Disallowed Tesco page host on page {page_number}")
    if not parsed.path.lower().endswith(f".{page_number}.jpeg"):
        raise RuntimeError(f"Unexpected Tesco page ordering on page {page_number}: {parsed.path}")


def ensure_target():
    synced = _api("POST", "/functions/v1/sync-tesco-ocr-source", {})
    if not isinstance(synced, dict) or not synced.get("ok") or not synced.get("import_id"):
        raise RuntimeError(f"Tesco OCR source sync failed: {synced}")

    import_id = str(synced["import_id"])
    params = urllib.parse.urlencode({
        "id": f"eq.{import_id}",
        "select": "id,status,source_document_url,detected_valid_from,detected_valid_to,metadata",
        "limit": "1",
    })
    rows = _api("GET", f"/rest/v1/leaflet_imports?{params}") or []
    if len(rows) != 1:
        raise RuntimeError(f"Canonical Tesco OCR import {import_id} not found")

    row = rows[0]
    metadata = row.get("metadata") or {}
    pages = list(metadata.get("page_image_urls") or [])
    today = prague_today()

    if metadata.get("adapter") != SOURCE_ADAPTER:
        raise RuntimeError(f"Unexpected Tesco OCR adapter: {metadata.get('adapter')}")
    if row.get("status") != "review":
        raise RuntimeError(f"Tesco OCR source must stay internal review, got {row.get('status')}")
    if row.get("detected_valid_from") > today or row.get("detected_valid_to") < today:
        raise RuntimeError(
            f"Tesco OCR source is not current on {today}: "
            f"{row.get('detected_valid_from')}..{row.get('detected_valid_to')}"
        )
    if int(metadata.get("page_count") or 0) != EXPECTED_PAGES or len(pages) != EXPECTED_PAGES:
        raise RuntimeError(
            f"Tesco OCR source must contain exactly {EXPECTED_PAGES} pages, "
            f"got metadata={metadata.get('page_count')} urls={len(pages)}"
        )
    if len(set(pages)) != EXPECTED_PAGES:
        raise RuntimeError("Tesco OCR source contains duplicate page URLs")
    for number, url in enumerate(pages, start=1):
        validate_page_url(str(url), number)

    pdf = urllib.parse.urlparse(str(row.get("source_document_url") or ""))
    if pdf.scheme != "https" or pdf.hostname != "digitalcontent.api.tesco.com" or not pdf.path.lower().endswith(".pdf"):
        raise RuntimeError("Tesco OCR source does not point to the official Tesco PDF")

    return {
        "ok": True,
        "import_id": import_id,
        "page_image_urls": pages,
        "valid_from": row.get("detected_valid_from"),
        "valid_to": row.get("detected_valid_to"),
    }


def api(method, path, body=None, extra_headers=None):
    if method == "POST" and path == "/rest/v1/rpc/get_terno_ocr_target":
        return _target
    return _api(method, path, body, extra_headers)


def direct_download(image_url: str, destination: str):
    validate_page_url(image_url, int(os.path.basename(destination).split("-")[-1].split(".")[0]))
    with urllib.request.urlopen(request(image_url), timeout=90) as response, open(destination, "wb") as output:
        content_type = (response.headers.get("content-type") or "").lower()
        if response.status != 200 or not content_type.startswith("image/"):
            raise RuntimeError(f"Tesco page is not an image: HTTP {response.status}, {content_type}")
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)


worker.api = api
worker.download = direct_download

if __name__ == "__main__":
    _target = ensure_target()
    print(json.dumps({
        "worker": "tesco",
        "engine": worker.ENGINE,
        "adapter": SOURCE_ADAPTER,
        "import_id": _target["import_id"],
        "pages": len(_target["page_image_urls"]),
        "valid_from": _target["valid_from"],
        "valid_to": _target["valid_to"],
    }, ensure_ascii=False), flush=True)
    worker.main()
