#!/usr/bin/env python3
"""Terno OCR entrypoint with a lightweight REST target selector.

The shared OCR worker is also reused by Tesco and Dr. Max. Keep their behavior
untouched and replace only Terno's historically slow get_terno_ocr_target RPC.
"""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
import urllib.parse

import sync_terno_ocr as worker

_original_api = worker.api
TERNO_ADAPTER = "store:terno-zlin-pdf-v1"
PRAGUE = ZoneInfo("Europe/Prague")


def _parse_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def terno_target():
    stores = _original_api(
        "GET",
        "/rest/v1/stores?"
        + urllib.parse.urlencode({"slug": "eq.terno", "select": "id", "limit": "1"}),
    ) or []
    if not stores:
        raise RuntimeError("Terno store not found")

    today = datetime.now(PRAGUE).date()
    tomorrow = today + timedelta(days=1)
    params = {
        "store_id": f"eq.{stores[0]['id']}",
        "detected_valid_to": f"gte.{today.isoformat()}",
        "select": "id,status,metadata,detected_valid_from,detected_valid_to,created_at",
        "order": "created_at.desc",
        "limit": "20",
    }
    imports = _original_api(
        "GET",
        "/rest/v1/leaflet_imports?" + urllib.parse.urlencode(params),
    ) or []

    preferred = None
    for row in imports:
        metadata = row.get("metadata") or {}
        page_urls = metadata.get("page_image_urls")
        if metadata.get("adapter") != TERNO_ADAPTER:
            continue
        if not isinstance(page_urls, list) or not page_urls:
            continue

        valid_from = _parse_date(row.get("detected_valid_from"))
        valid_to = _parse_date(row.get("detected_valid_to"))
        if valid_from is None or valid_to is None:
            continue
        if valid_from > tomorrow or valid_to < today:
            continue

        preferred = row
        break

    if not preferred:
        return {
            "ok": False,
            "reason": "no-current-official-terno-flyer",
            "business_date": today.isoformat(),
        }

    metadata = preferred.get("metadata") or {}
    page_urls = metadata.get("page_image_urls") or []
    return {
        "ok": True,
        "import_id": preferred["id"],
        "page_image_urls": page_urls,
        "valid_from": preferred.get("detected_valid_from"),
        "valid_to": preferred.get("detected_valid_to"),
        "expected_pages": len(page_urls),
    }


def api(method, path, body=None, extra_headers=None):
    if method == "POST" and path == "/rest/v1/rpc/get_terno_ocr_target":
        return terno_target()
    return _original_api(method, path, body, extra_headers)


worker.api = api


if __name__ == "__main__":
    worker.main()
