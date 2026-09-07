#!/usr/bin/env python3
import os
import sys
import unittest
from datetime import timedelta

# The production worker validates these during import. Unit tests never connect
# to Supabase; dummy values only allow the module to load in isolation.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-key")
sys.path.insert(0, os.path.dirname(__file__))

import sync_terno_ocr_direct as direct


class TernoTargetSelectorTests(unittest.TestCase):
    def setUp(self):
        self.original_api = direct._original_api

    def tearDown(self):
        direct._original_api = self.original_api

    @staticmethod
    def fake_api(stores, imports, ocr_rows=None):
        ocr_rows = ocr_rows or []

        def api(method, path, body=None, extra_headers=None):
            if method == "GET" and path.startswith("/rest/v1/stores?"):
                return stores
            if method == "GET" and path.startswith("/rest/v1/leaflet_imports?"):
                return imports
            if method == "GET" and path.startswith("/rest/v1/leaflet_ocr_pages?"):
                return ocr_rows
            raise AssertionError(f"Unexpected API call: {method} {path}")

        return api

    @staticmethod
    def metadata(page_urls, adapter=None, title=None):
        return {
            "adapter": adapter or direct.TERNO_ADAPTER,
            "title": title or direct.TERNO_TITLE,
            "page_image_urls": page_urls,
        }

    def test_selects_first_current_official_terno_import(self):
        today = direct.datetime.now(direct.PRAGUE).date()
        rows = [
            {
                "id": "wrong-adapter",
                "metadata": self.metadata(
                    ["https://example.invalid/wrong.jpg"], adapter="store:other-v1"
                ),
                "detected_valid_from": today.isoformat(),
                "detected_valid_to": (today + timedelta(days=3)).isoformat(),
                "created_at": "2026-09-06T18:00:00Z",
            },
            {
                "id": "terno-current",
                "metadata": self.metadata([
                    "https://example.invalid/1.jpg",
                    "https://example.invalid/2.jpg",
                ]),
                "detected_valid_from": today.isoformat(),
                "detected_valid_to": (today + timedelta(days=3)).isoformat(),
                "created_at": "2026-09-06T17:00:00Z",
            },
        ]
        direct._original_api = self.fake_api([{"id": "store-terno"}], rows)

        target = direct.terno_target()

        self.assertTrue(target["ok"])
        self.assertEqual(target["import_id"], "terno-current")
        self.assertEqual(target["expected_pages"], 2)
        self.assertEqual(target["ocr_complete_pages"], 0)
        self.assertEqual(len(target["page_image_urls"]), 2)

    def test_rejects_expired_future_pageless_and_wrong_title_imports(self):
        today = direct.datetime.now(direct.PRAGUE).date()
        rows = [
            {
                "id": "pageless",
                "metadata": self.metadata([]),
                "detected_valid_from": today.isoformat(),
                "detected_valid_to": (today + timedelta(days=2)).isoformat(),
                "created_at": "2026-09-06T18:00:00Z",
            },
            {
                "id": "expired",
                "metadata": self.metadata(["https://example.invalid/expired.jpg"]),
                "detected_valid_from": (today - timedelta(days=7)).isoformat(),
                "detected_valid_to": (today - timedelta(days=1)).isoformat(),
                "created_at": "2026-09-06T17:00:00Z",
            },
            {
                "id": "too-far-future",
                "metadata": self.metadata(["https://example.invalid/future.jpg"]),
                "detected_valid_from": (today + timedelta(days=2)).isoformat(),
                "detected_valid_to": (today + timedelta(days=8)).isoformat(),
                "created_at": "2026-09-06T16:00:00Z",
            },
            {
                "id": "wrong-title",
                "metadata": self.metadata(
                    ["https://example.invalid/wrong-title.jpg"], title="Mimořádná nabídka"
                ),
                "detected_valid_from": today.isoformat(),
                "detected_valid_to": (today + timedelta(days=2)).isoformat(),
                "created_at": "2026-09-06T15:00:00Z",
            },
        ]
        direct._original_api = self.fake_api([{"id": "store-terno"}], rows)

        target = direct.terno_target()

        self.assertFalse(target["ok"])
        self.assertEqual(target["reason"], "no-current-official-terno-flyer")

    def test_incomplete_today_beats_newer_tomorrow_import(self):
        today = direct.datetime.now(direct.PRAGUE).date()
        rows = [
            {
                "id": "tomorrow-newer",
                "metadata": self.metadata(["https://example.invalid/tomorrow.jpg"]),
                "detected_valid_from": (today + timedelta(days=1)).isoformat(),
                "detected_valid_to": (today + timedelta(days=7)).isoformat(),
                "created_at": "2026-09-07T18:00:00Z",
            },
            {
                "id": "today-older",
                "metadata": self.metadata([
                    "https://example.invalid/today-1.jpg",
                    "https://example.invalid/today-2.jpg",
                ]),
                "detected_valid_from": today.isoformat(),
                "detected_valid_to": today.isoformat(),
                "created_at": "2026-09-07T17:00:00Z",
            },
        ]
        direct._original_api = self.fake_api([{"id": "store-terno"}], rows)

        target = direct.terno_target()

        self.assertEqual(target["import_id"], "today-older")
        self.assertEqual(target["target_date"], today.isoformat())

    def test_incomplete_tomorrow_beats_completed_today_import(self):
        today = direct.datetime.now(direct.PRAGUE).date()
        rows = [
            {
                "id": "today-complete",
                "metadata": self.metadata([
                    "https://example.invalid/today-1.jpg",
                    "https://example.invalid/today-2.jpg",
                ]),
                "detected_valid_from": today.isoformat(),
                "detected_valid_to": today.isoformat(),
                "created_at": "2026-09-07T18:00:00Z",
            },
            {
                "id": "tomorrow-incomplete",
                "metadata": self.metadata(["https://example.invalid/tomorrow.jpg"]),
                "detected_valid_from": (today + timedelta(days=1)).isoformat(),
                "detected_valid_to": (today + timedelta(days=7)).isoformat(),
                "created_at": "2026-09-07T17:00:00Z",
            },
        ]
        ocr_rows = [
            {"import_id": "today-complete", "page_number": 1},
            {"import_id": "today-complete", "page_number": 2},
        ]
        direct._original_api = self.fake_api([{"id": "store-terno"}], rows, ocr_rows)

        target = direct.terno_target()

        self.assertEqual(target["import_id"], "tomorrow-incomplete")
        self.assertEqual(target["target_date"], (today + timedelta(days=1)).isoformat())

    def test_missing_terno_store_is_explicit_failure(self):
        direct._original_api = self.fake_api([], [])

        with self.assertRaisesRegex(RuntimeError, "Terno store not found"):
            direct.terno_target()


if __name__ == "__main__":
    unittest.main()
