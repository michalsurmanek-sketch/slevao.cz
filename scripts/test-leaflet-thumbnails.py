import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fitz
from PIL import Image

spec = importlib.util.spec_from_file_location('covers', Path(__file__).with_name('build-leaflet-thumbnails.py'))
covers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(covers)


class CoverTests(unittest.TestCase):
    def test_pdf_cover_is_small_reusable_and_date_specific(self):
        with tempfile.TemporaryDirectory() as directory:
            covers.OUT = Path(directory)
            with fitz.open() as pdf:
                page = pdf.new_page()
                page.insert_text((72, 72), 'Current leaflet')
                raw = pdf.tobytes()
            row = {'store_slug': 'test', 'preview_url': 'https://example.com/current.pdf', 'leaflet_key': 'test-1', 'valid_from': covers.TODAY, 'valid_to': covers.TODAY}
            with patch.object(covers, 'document', return_value=raw) as download:
                first = covers.cover(row)
                again = covers.cover(row)
                self.assertEqual(first['cover_url'], again['cover_url'])
                self.assertEqual(download.call_count, 1)
                image = Image.open(first['cover_url'])
                self.assertLessEqual(image.width, 400)
                self.assertLessEqual(image.height, 600)
                self.assertLess(first['cover_bytes'], len(raw) + 20000)
                different = covers.cover(dict(row, leaflet_key='test-2'))
                self.assertNotEqual(first['cover_url'], different['cover_url'])
    def test_expired_and_future_covers_are_not_current(self):
        self.assertFalse(covers.current({'valid_to': '2000-01-01'}))
        self.assertFalse(covers.current({'valid_from': '2999-01-01'}))
        self.assertTrue(covers.current({'valid_from': covers.TODAY, 'valid_to': covers.TODAY}))


if __name__ == '__main__':
    unittest.main()
