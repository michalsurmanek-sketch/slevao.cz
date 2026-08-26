#!/usr/bin/env python3
"""JIP OCR worker reusing the proven Terno Tesseract implementation.
Runs only against the current official 12-page JIP Maloobchod source used by
sync-jip-pack-products and becomes a no-op once that import is OCR-complete.
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

import sync_terno_ocr as worker

# Tesseract TSV is a raw tab-separated format; OCR text can legitimately be a
# quote character. csv.DictReader's default quote handling would otherwise
# merge many subsequent TSV rows into one corrupted word after an unmatched ".
_original_dict_reader = worker.csv.DictReader

def _tsv_dict_reader_no_quotes(*args, **kwargs):
    kwargs.setdefault("quoting", worker.csv.QUOTE_NONE)
    return _original_dict_reader(*args, **kwargs)

worker.csv.DictReader = _tsv_dict_reader_no_quotes
worker.ENGINE = "tesseract-cli-ces-jip-v2"
worker.SUPABASE_USER_AGENT = "slevao-github-actions-jip-ocr/2.0"

_original_api = worker.api
_target_cache = None


def prague_today() -> str:
    return datetime.now(ZoneInfo("Europe/Prague")).date().isoformat()


def jip_target():
    global _target_cache
    if _target_cache is not None:
        return _target_cache

    stores = _original_api(
        "GET",
        "/rest/v1/stores?"
        + urllib.parse.urlencode({"slug": "eq.jip", "select": "id", "limit": "1"}),
    ) or []
    if not stores:
        raise RuntimeError("JIP store not found")

    today = prague_today()
    params = {
        "store_id": f"eq.{stores[0]['id']}",
        "detected_valid_from": f"lte.{today}",
        "detected_valid_to": f"gte.{today}",
        "status": "eq.published",
        "select": "id,source_document_url,metadata,detected_valid_from,detected_valid_to,created_at",
        "order": "detected_valid_from.desc,created_at.desc",
        "limit": "20",
    }
    imports = _original_api("GET", "/rest/v1/leaflet_imports?" + urllib.parse.urlencode(params)) or []

    candidates = []
    for row in imports:
        metadata = row.get("metadata") or {}
        page_urls = metadata.get("page_image_urls")
        source_url = str(row.get("source_document_url") or "")
        if metadata.get("ocr_required") is not True:
            continue
        if metadata.get("ocr_complete") is True and metadata.get("ocr_engine") == worker.ENGINE:
            continue
        if not isinstance(page_urls, list) or len(page_urls) != 12:
            continue
        if int(metadata.get("page_count") or 0) != 12:
            continue
        if not re.search(r"/MO-\d{1,2}-\d{1,2}-\d{4}/$", source_url, re.I):
            continue
        candidates.append(row)

    preferred = candidates[0] if candidates else None
    if not preferred:
        _target_cache = {
            "ok": False,
            "reason": "no_pending_current_jip_maloobchod_ocr",
            "business_date": today,
        }
        return _target_cache

    metadata = preferred.get("metadata") or {}
    _target_cache = {
        "ok": True,
        "import_id": preferred["id"],
        "page_image_urls": metadata["page_image_urls"],
        "valid_from": preferred.get("detected_valid_from"),
        "valid_to": preferred.get("detected_valid_to"),
        "business_date": today,
        "source_document_url": preferred.get("source_document_url"),
    }
    return _target_cache


def api(method, path, body=None, extra_headers=None):
    if method == "POST" and path == "/rest/v1/rpc/get_terno_ocr_target":
        return jip_target()
    return _original_api(method, path, body, extra_headers)


def direct_download(image_url: str, destination: str):
    parsed = urllib.parse.urlparse(image_url)
    if parsed.scheme != "https" or parsed.hostname != "www.jip-potraviny.cz":
        raise RuntimeError("Disallowed JIP image URL")

    last_error = None
    for attempt in range(1, 5):
        request = urllib.request.Request(
            image_url,
            headers={
                "User-Agent": worker.SUPABASE_USER_AGENT,
                "Accept": "image/jpeg,image/png,image/webp,*/*",
                "Cache-Control": "no-cache",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response, open(destination, "wb") as output:
                content_type = (response.headers.get("content-type") or "").lower()
                if not content_type.startswith("image/"):
                    raise RuntimeError(f"JIP page is not an image: {content_type}")
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
            if os.path.getsize(destination) <= 0:
                raise RuntimeError("JIP page download returned an empty file")
            return
        except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError, RuntimeError) as exc:
            last_error = exc
            try:
                os.remove(destination)
            except FileNotFoundError:
                pass
            if attempt >= 4:
                break
            delay = min(15, attempt * 4)
            print(f"JIP image retry {attempt}/4 after {type(exc).__name__}: {exc}; sleep {delay}s", flush=True)
            worker.time.sleep(delay)

    raise RuntimeError(f"JIP image download failed after 4 attempts: {last_error}")


worker.api = api
worker.download = direct_download

if __name__ == "__main__":
    target = jip_target()
    if not target.get("ok"):
        print(json.dumps({"ok": True, "worker": "jip", "engine": worker.ENGINE, "skipped": True, **target}, ensure_ascii=False), flush=True)
        raise SystemExit(0)
    print(json.dumps({"worker": "jip", "engine": worker.ENGINE, "target": target["import_id"], "business_date": target["business_date"]}, ensure_ascii=False), flush=True)
    worker.main()
