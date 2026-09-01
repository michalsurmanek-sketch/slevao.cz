#!/usr/bin/env python3
"""Dr. Max OCR worker reusing the proven Terno Tesseract implementation.
Runs only against current official Dr. Max page images.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

import sync_terno_ocr as worker

worker.ENGINE = "tesseract-cli-ces-drmax-v1"
worker.SUPABASE_USER_AGENT = "slevao-github-actions-drmax-ocr/1.0"

_original_api = worker.api


def completed_ocr_pages(import_id: str, expected_pages: int) -> int:
    if expected_pages <= 0:
        return 0
    params = urllib.parse.urlencode({
        "import_id": f"eq.{import_id}",
        "engine": f"eq.{worker.ENGINE}",
        "select": "page_number,word_count",
    })
    rows = _original_api("GET", "/rest/v1/leaflet_ocr_pages?" + params) or []
    completed = {
        int(row["page_number"])
        for row in rows
        if int(row.get("word_count") or 0) > 0
        and 1 <= int(row.get("page_number") or 0) <= expected_pages
    }
    return len(completed)


def drmax_target():
    stores = _original_api(
        "GET",
        "/rest/v1/stores?"
        + urllib.parse.urlencode({"slug": "eq.dr-max", "select": "id", "limit": "1"}),
    ) or []
    if not stores:
        raise RuntimeError("Dr. Max store not found")

    today = __import__("datetime").date.today().isoformat()
    params = {
        "store_id": f"eq.{stores[0]['id']}",
        "detected_valid_to": f"gte.{today}",
        "status": "eq.published",
        "select": "id,metadata,detected_valid_from,detected_valid_to",
        "order": "detected_valid_to.asc,created_at.desc",
        "limit": "20",
    }
    imports = _original_api("GET", "/rest/v1/leaflet_imports?" + urllib.parse.urlencode(params)) or []
    candidates = [
        row for row in imports
        if isinstance((row.get("metadata") or {}).get("page_image_urls"), list)
        and (row.get("metadata") or {}).get("ocr_required") is True
    ]
    preferred = next(
        (row for row in candidates if "Leták Dr. Max" in str((row.get("metadata") or {}).get("title", ""))),
        candidates[0] if candidates else None,
    )
    if not preferred:
        return {
            "ok": False,
            "reason": "no-current-official-flyer",
            "business_date": today,
        }

    metadata = preferred.get("metadata") or {}
    page_image_urls = metadata.get("page_image_urls") or []
    expected_pages = len(page_image_urls)
    completed_pages = completed_ocr_pages(str(preferred["id"]), expected_pages)
    if expected_pages > 0 and completed_pages >= expected_pages:
        return {
            "ok": False,
            "reason": "ocr-already-complete",
            "business_date": today,
            "import_id": preferred["id"],
            "completed_pages": completed_pages,
            "expected_pages": expected_pages,
            "valid_from": preferred.get("detected_valid_from"),
            "valid_to": preferred.get("detected_valid_to"),
        }

    return {
        "ok": True,
        "import_id": preferred["id"],
        "page_image_urls": page_image_urls,
        "valid_from": preferred.get("detected_valid_from"),
        "valid_to": preferred.get("detected_valid_to"),
        "completed_pages": completed_pages,
        "expected_pages": expected_pages,
    }


def api(method, path, body=None, extra_headers=None):
    if method == "POST" and path == "/rest/v1/rpc/get_terno_ocr_target":
        return drmax_target()
    return _original_api(method, path, body, extra_headers)


def direct_download(image_url: str, destination: str):
    parsed = urllib.parse.urlparse(image_url)
    if parsed.scheme != "https" or parsed.hostname != "triobodistribution.blob.core.windows.net":
        raise RuntimeError("Disallowed Dr. Max image URL")
    request = urllib.request.Request(
        image_url,
        headers={
            "User-Agent": worker.SUPABASE_USER_AGENT,
            "Accept": "image/jpeg,image/png,image/webp,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=90) as response, open(destination, "wb") as output:
        content_type = (response.headers.get("content-type") or "").lower()
        if not content_type.startswith("image/"):
            raise RuntimeError(f"Dr. Max page is not an image: {content_type}")
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)


worker.api = api
worker.download = direct_download


def render_target(target: dict) -> dict:
    if not target.get("ok"):
        return {
            "ok": False,
            "worker": "drmax",
            "engine": worker.ENGINE,
            "skipped": True,
            **target,
        }
    return {
        "ok": True,
        "worker": "drmax",
        "engine": worker.ENGINE,
        "target": target["import_id"],
        "valid_from": target.get("valid_from"),
        "valid_to": target.get("valid_to"),
        "completed_pages": target.get("completed_pages", 0),
        "expected_pages": target.get("expected_pages", len(target.get("page_image_urls") or [])),
    }


if __name__ == "__main__":
    target = drmax_target()
    if "--probe" in sys.argv[1:]:
        print(json.dumps(render_target(target), ensure_ascii=False), flush=True)
        raise SystemExit(0)
    if not target.get("ok"):
        print(json.dumps(render_target(target), ensure_ascii=False), flush=True)
        raise SystemExit(0)
    print(json.dumps(render_target(target), ensure_ascii=False), flush=True)
    worker.main()
