#!/usr/bin/env python3
"""JIP OCR worker reusing the proven Terno Tesseract implementation.

JIP's FlipBuilder viewer exposes 1284x1800 mobile JPEGs, but it also exposes the
original official MO.pdf. The stylized large prices lose decimal punctuation on
mobile-image OCR (for example 23°° / 69°90), so this worker renders the official
PDF at a fixed 1800 px page width before running the same deterministic
Tesseract pipeline.

Each PDF page is rendered on demand instead of rendering all 12 pages up front.
This keeps peak memory bounded and lets verified OCR rows be persisted
progressively. The PDF OCR uses a new engine id, so the currently published v2
parser remains untouched until the v3 candidate set is explicitly compared.
"""
import json
import os
import re
import subprocess
import tempfile
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
worker.ENGINE = "tesseract-cli-ces-jip-v3-pdf1800"
worker.SUPABASE_USER_AGENT = "slevao-github-actions-jip-ocr/3.1"

_original_api = worker.api
_target_cache = None
_pdf_cache_temp = None
_pdf_cache_path = None


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


def _download_pdf(pdf_url: str, destination: str):
    last_error = None
    for attempt in range(1, 5):
        request = urllib.request.Request(
            pdf_url,
            headers={
                "User-Agent": worker.SUPABASE_USER_AGENT,
                "Accept": "application/pdf,*/*",
                "Cache-Control": "no-cache",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response, open(destination, "wb") as output:
                content_type = (response.headers.get("content-type") or "").lower()
                if "application/pdf" not in content_type:
                    raise RuntimeError(f"JIP download is not a PDF: {content_type}")
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
            with open(destination, "rb") as handle:
                if handle.read(5) != b"%PDF-":
                    raise RuntimeError("JIP PDF magic header is missing")
            if os.path.getsize(destination) < 100_000:
                raise RuntimeError("JIP PDF is implausibly small")
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
            print(f"JIP PDF retry {attempt}/4 after {type(exc).__name__}: {exc}; sleep {delay}s", flush=True)
            worker.time.sleep(delay)
    raise RuntimeError(f"JIP PDF download failed after 4 attempts: {last_error}")


def _ensure_pdf(image_url: str):
    global _pdf_cache_temp, _pdf_cache_path
    if _pdf_cache_path is not None:
        return _pdf_cache_path

    parsed = urllib.parse.urlparse(image_url)
    if parsed.scheme != "https" or parsed.hostname != "www.jip-potraviny.cz":
        raise RuntimeError("Disallowed JIP image URL")
    match = re.match(r"^(https://www\.jip-potraviny\.cz/.+/files/)mobile/\d+\.jpg$", image_url, re.I)
    if not match:
        raise RuntimeError(f"Unexpected JIP page image path: {image_url}")

    pdf_url = match.group(1) + "downloads/MO.pdf"
    _pdf_cache_temp = tempfile.TemporaryDirectory(prefix="jip-pdf1800-")
    _pdf_cache_path = os.path.join(_pdf_cache_temp.name, "MO.pdf")
    print(f"JIP PDF source {pdf_url}", flush=True)
    _download_pdf(pdf_url, _pdf_cache_path)
    print(f"JIP PDF downloaded: {os.path.getsize(_pdf_cache_path)} bytes", flush=True)
    return _pdf_cache_path


def direct_download(image_url: str, destination: str):
    parsed = urllib.parse.urlparse(image_url)
    if parsed.scheme != "https" or parsed.hostname != "www.jip-potraviny.cz":
        raise RuntimeError("Disallowed JIP image URL")
    m = re.search(r"/files/mobile/(\d+)\.jpg$", parsed.path, re.I)
    if not m:
        raise RuntimeError(f"Unexpected JIP page image URL: {image_url}")
    page_number = int(m.group(1))
    if page_number < 1 or page_number > 12:
        raise RuntimeError(f"Unexpected JIP page number: {page_number}")

    pdf_path = _ensure_pdf(image_url)
    output_prefix = destination[:-4] if destination.lower().endswith(".jpg") else destination
    completed = subprocess.run(
        [
            "pdftoppm",
            "-jpeg",
            "-f",
            str(page_number),
            "-l",
            str(page_number),
            "-singlefile",
            "-scale-to-x",
            "1800",
            "-scale-to-y",
            "-1",
            pdf_path,
            output_prefix,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=120,
        check=False,
    )
    rendered = output_prefix + ".jpg"
    if completed.returncode != 0:
        raise RuntimeError(f"pdftoppm page {page_number} failed: {completed.stderr[-1500:]}")
    if not os.path.exists(rendered) or os.path.getsize(rendered) < 50_000:
        raise RuntimeError(f"JIP PDF page {page_number} render is missing or implausibly small")
    if rendered != destination:
        os.replace(rendered, destination)
    print(f"JIP PDF page {page_number} rendered: {os.path.getsize(destination)} bytes", flush=True)


worker.api = api
worker.download = direct_download

if __name__ == "__main__":
    target = jip_target()
    if not target.get("ok"):
        print(json.dumps({"ok": True, "worker": "jip", "engine": worker.ENGINE, "skipped": True, **target}, ensure_ascii=False), flush=True)
        raise SystemExit(0)
    print(json.dumps({"worker": "jip", "engine": worker.ENGINE, "target": target["import_id"], "business_date": target["business_date"], "source": "official_pdf_width_1800"}, ensure_ascii=False), flush=True)
    worker.main()
