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
TERNO_TITLE = "Akční nabídka"
PRAGUE = ZoneInfo("Europe/Prague")


def _parse_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _complete_page_counts(import_ids):
    ids = [str(value) for value in import_ids if value]
    if not ids:
        return {}
    params = {
        "import_id": f"in.({','.join(ids)})",
        "engine": f"eq.{worker.ENGINE}",
        "word_count": "gt.0",
        "select": "import_id,page_number",
        "limit": "5000",
    }
    rows = _original_api(
        "GET",
        "/rest/v1/leaflet_ocr_pages?" + urllib.parse.urlencode(params),
    ) or []
    counts = {}
    for row in rows:
        import_id = str(row.get("import_id") or "")
        if not import_id:
            continue
        counts[import_id] = counts.get(import_id, 0) + 1
    return counts


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
        "detected_valid_from": f"lte.{tomorrow.isoformat()}",
        "detected_valid_to": f"gte.{today.isoformat()}",
        "select": "id,metadata,detected_valid_from,detected_valid_to,created_at",
        "order": "detected_valid_from.desc,created_at.desc",
        "limit": "100",
    }
    imports = _original_api(
        "GET",
        "/rest/v1/leaflet_imports?" + urllib.parse.urlencode(params),
    ) or []

    candidates = []
    for row in imports:
        metadata = row.get("metadata") or {}
        page_urls = metadata.get("page_image_urls")
        if metadata.get("adapter") != TERNO_ADAPTER:
            continue
        if metadata.get("title") != TERNO_TITLE:
            continue
        if not isinstance(page_urls, list) or not page_urls:
            continue

        valid_from = _parse_date(row.get("detected_valid_from"))
        valid_to = _parse_date(row.get("detected_valid_to"))
        if valid_from is None or valid_to is None:
            continue
        if valid_from > tomorrow or valid_to < today:
            continue

        candidates.append({
            "row": row,
            "valid_from": valid_from,
            "valid_to": valid_to,
            "page_urls": page_urls,
        })

    if not candidates:
        return {
            "ok": False,
            "reason": "no-current-official-terno-flyer",
            "business_date": today.isoformat(),
        }

    complete_counts = _complete_page_counts(item["row"]["id"] for item in candidates)
    for item in candidates:
        row = item["row"]
        complete_pages = complete_counts.get(str(row["id"]), 0)
        incomplete = complete_pages < len(item["page_urls"])
        if item["valid_from"] <= today <= item["valid_to"] and incomplete:
            priority = 0
        elif item["valid_from"] <= tomorrow <= item["valid_to"] and incomplete:
            priority = 1
        else:
            priority = 2
        item["priority"] = priority
        item["complete_pages"] = complete_pages

    # Match get_terno_ocr_target(): incomplete current flyer first, then an
    # incomplete tomorrow flyer, then everything else; within a group prefer
    # the latest validity start and import creation time.
    candidates.sort(key=lambda item: str(item["row"].get("created_at") or ""), reverse=True)
    candidates.sort(key=lambda item: item["valid_from"], reverse=True)
    candidates.sort(key=lambda item: item["priority"])
    preferred = candidates[0]
    row = preferred["row"]
    page_urls = preferred["page_urls"]

    return {
        "ok": True,
        "import_id": row["id"],
        "page_image_urls": page_urls,
        "valid_from": row.get("detected_valid_from"),
        "valid_to": row.get("detected_valid_to"),
        "expected_pages": len(page_urls),
        "ocr_complete_pages": preferred["complete_pages"],
        "target_date": tomorrow.isoformat() if preferred["valid_from"] > today else today.isoformat(),
    }


def api(method, path, body=None, extra_headers=None):
    if method == "POST" and path == "/rest/v1/rpc/get_terno_ocr_target":
        return terno_target()
    return _original_api(method, path, body, extra_headers)


worker.api = api


if __name__ == "__main__":
    worker.main()
