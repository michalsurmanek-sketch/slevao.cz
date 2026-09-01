#!/usr/bin/env python3
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")

import sync_drmax_ocr as drmax  # noqa: E402

IMPORT_ID = "00000000-0000-0000-0000-000000000001"
PAGE_URLS = [
    f"https://triobodistribution.blob.core.windows.net/iss-test/page-{index}.jpg"
    for index in range(1, 17)
]


def fake_api_with_completed_pages(completed_pages):
    def fake_api(method, path, body=None, extra_headers=None):
        assert method == "GET"
        if path.startswith("/rest/v1/stores?"):
            return [{"id": "store-dr-max"}]
        if path.startswith("/rest/v1/leaflet_imports?"):
            return [{
                "id": IMPORT_ID,
                "detected_valid_from": "2099-01-01",
                "detected_valid_to": "2099-01-31",
                "metadata": {
                    "title": "Leták Dr. Max test",
                    "ocr_required": True,
                    "page_image_urls": PAGE_URLS,
                },
            }]
        if path.startswith("/rest/v1/leaflet_ocr_pages?"):
            return [
                {"page_number": index, "word_count": 100}
                for index in range(1, completed_pages + 1)
            ]
        raise AssertionError(f"Unexpected API call: {method} {path}")

    return fake_api


def test_complete_import_skips_before_download():
    drmax._original_api = fake_api_with_completed_pages(16)
    target = drmax.drmax_target()
    assert target["ok"] is False
    assert target["reason"] == "ocr-already-complete"
    assert target["completed_pages"] == 16
    assert target["expected_pages"] == 16
    assert "page_image_urls" not in target


def test_incomplete_import_remains_target():
    drmax._original_api = fake_api_with_completed_pages(15)
    target = drmax.drmax_target()
    assert target["ok"] is True
    assert target["import_id"] == IMPORT_ID
    assert target["completed_pages"] == 15
    assert target["expected_pages"] == 16
    assert target["page_image_urls"] == PAGE_URLS


if __name__ == "__main__":
    test_complete_import_skips_before_download()
    test_incomplete_import_remains_target()
    print("Dr. Max OCR target regression OK")
