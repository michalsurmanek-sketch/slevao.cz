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
    def fake_api(stores, imports):
        def api(method, path, body=None, extra_headers=None):
            if method == "GET" and path.startswith("/rest/v1/stores?"):
                return stores
            if method == "GET" and path.startswith("/rest/v1/leaflet_imports?"):
                return imports
            raise AssertionError(f"Unexpected API call: {method} {path}")

        return api

    def test_selects_first_current_official_terno_import(self):
        today = direct.datetime.now(direct.PRAGUE).date()
        rows = [
            {
                "id": "wrong-adapter",
                "status": "ready",
                "metadata": {
                    "adapter": "store:other-v1",
                    "page_image_urls": ["https://example.invalid/wrong.jpg"],
                },
                "detected_valid_from": today.isoformat(),
                "detected_valid_to": (today + timedelta(days=3)).isoformat(),
                "created_at": "2026-09-06T18:00:00Z",
            },
            {
                "id": "terno-current",
                "status": "ready",
                "metadata": {
                    "adapter": direct.TERNO_ADAPTER,
                    "page_image_urls": [
                        "https://example.invalid/1.jpg",
                        "https://example.invalid/2.jpg",
                    ],
                },
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
        self.assertEqual(len(target["page_image_urls"]), 2)

    def test_rejects_expired_future_and_pageless_imports(self):
        today = direct.datetime.now(direct.PRAGUE).date()
        rows = [
            {
                "id": "pageless",
                "status": "ready",
                "metadata": {"adapter": direct.TERNO_ADAPTER, "page_image_urls": []},
                "detected_valid_from": today.isoformat(),
                "detected_valid_to": (today + timedelta(days=2)).isoformat(),
                "created_at": "2026-09-06T18:00:00Z",
            },
            {
                "id": "expired",
                "status": "ready",
                "metadata": {
                    "adapter": direct.TERNO_ADAPTER,
                    "page_image_urls": ["https://example.invalid/expired.jpg"],
                },
                "detected_valid_from": (today - timedelta(days=7)).isoformat(),
                "detected_valid_to": (today - timedelta(days=1)).isoformat(),
                "created_at": "2026-09-06T17:00:00Z",
            },
            {
                "id": "too-far-future",
                "status": "ready",
                "metadata": {
                    "adapter": direct.TERNO_ADAPTER,
                    "page_image_urls": ["https://example.invalid/future.jpg"],
                },
                "detected_valid_from": (today + timedelta(days=2)).isoformat(),
                "detected_valid_to": (today + timedelta(days=8)).isoformat(),
                "created_at": "2026-09-06T16:00:00Z",
            },
        ]
        direct._original_api = self.fake_api([{"id": "store-terno"}], rows)

        target = direct.terno_target()

        self.assertFalse(target["ok"])
        self.assertEqual(target["reason"], "no-current-official-terno-flyer")

    def test_missing_terno_store_is_explicit_failure(self):
        direct._original_api = self.fake_api([], [])

        with self.assertRaisesRegex(RuntimeError, "Terno store not found"):
            direct.terno_target()


if __name__ == "__main__":
    unittest.main()
