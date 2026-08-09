#!/usr/bin/env python3
"""JIP OCR worker reusing the proven Terno Tesseract implementation."""
import json
import os
import urllib.parse
import urllib.request

import sync_terno_ocr as worker

worker.ENGINE = "tesseract-cli-ces-jip-v1"
worker.SUPABASE_USER_AGENT = "slevao-github-actions-jip-ocr/1.0"

_original_api = worker.api


def jip_target():
    stores = _original_api(
        "GET",
        "/rest/v1/stores?"
        + urllib.parse.urlencode({"slug": "eq.jip", "select": "id", "limit": "1"}),
    ) or []
    if not stores:
        raise RuntimeError("JIP store not found")

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
        (row for row in candidates if "Akční leták JIP potraviny" in str((row.get("metadata") or {}).get("title", ""))),
        candidates[0] if candidates else None,
    )
    if not preferred:
        raise RuntimeError("No current JIP import with official page images")
    metadata = preferred.get("metadata") or {}
    return {
        "ok": True,
        "import_id": preferred["id"],
        "page_image_urls": metadata["page_image_urls"],
        "valid_from": preferred.get("detected_valid_from"),
        "valid_to": preferred.get("detected_valid_to"),
    }


def api(method, path, body=None, extra_headers=None):
    if method == "POST" and path == "/rest/v1/rpc/get_terno_ocr_target":
        return jip_target()
    return _original_api(method, path, body, extra_headers)


def direct_download(image_url: str, destination: str):
    parsed = urllib.parse.urlparse(image_url)
    if parsed.scheme != "https" or parsed.hostname != "www.jip-potraviny.cz":
        raise RuntimeError("Disallowed JIP image URL")
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
            raise RuntimeError(f"JIP page is not an image: {content_type}")
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)


worker.api = api
worker.download = direct_download

if __name__ == "__main__":
    print(json.dumps({"worker": "jip", "engine": worker.ENGINE}), flush=True)
    worker.main()
