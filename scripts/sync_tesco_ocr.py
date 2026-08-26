#!/usr/bin/env python3
"""OCR the canonical current Tesco Hypermarket Apollo page-image import."""
import datetime
import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

import sync_terno_ocr as worker

LANDING = "https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy"
SOURCE_ADAPTER = "tesco-apollo-page-images-v1"
EXPECTED_PAGES = 32
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36"

worker.ENGINE = "tesseract-cli-ces-tesco-v2"
worker.SUPABASE_USER_AGENT = "slevao-github-actions-tesco-ocr/2.4"
worker.MAX_PAGES = 0
_api = worker.api
_target = None


def prague_today() -> str:
    return datetime.datetime.now(ZoneInfo("Europe/Prague")).date().isoformat()


def request(url: str, accept: str = "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8"):
    return urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": accept,
            "Accept-Language": "cs-CZ,cs;q=0.9",
            "Referer": LANDING,
            "Cache-Control": "no-cache",
        },
    )


def source_sync():
    url = f"{worker.SUPABASE_URL}/functions/v1/sync-tesco-ocr-source"
    headers = worker.server_headers()
    headers.update({
        "Authorization": f"Bearer {worker.SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    })
    req = urllib.request.Request(url, data=b"{}", headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            raw = response.read().decode("utf-8", "replace")
            payload = json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:2000]
        raise RuntimeError(f"Tesco OCR source sync HTTP {exc.code}: {detail}") from exc
    if not isinstance(payload, dict) or not payload.get("ok") or not payload.get("import_id"):
        raise RuntimeError(f"Tesco OCR source sync failed: {payload}")
    return payload


def validate_page_url(url: str, page_number: int):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "digitalcontent.api.tesco.com":
        raise RuntimeError(f"Disallowed Tesco page host on page {page_number}")
    if not parsed.path.lower().endswith(f".{page_number}.jpeg"):
        raise RuntimeError(f"Unexpected Tesco page ordering on page {page_number}: {parsed.path}")


def validate_pdf_url(url: str):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "digitalcontent.api.tesco.com" or not parsed.path.lower().endswith(".pdf"):
        raise RuntimeError("Tesco OCR source does not point to the official Tesco PDF")


def ensure_target():
    synced = source_sync()
    import_id = str(synced["import_id"])
    params = urllib.parse.urlencode({
        "id": f"eq.{import_id}",
        "select": "id,status,source_document_url,detected_valid_from,detected_valid_to,metadata",
        "limit": "1",
    })
    rows = _api("GET", f"/rest/v1/leaflet_imports?{params}") or []
    if len(rows) != 1:
        raise RuntimeError(f"Canonical Tesco OCR import {import_id} not found")

    row = rows[0]
    metadata = row.get("metadata") or {}
    pages = list(metadata.get("page_image_urls") or [])
    today = prague_today()

    if metadata.get("adapter") != SOURCE_ADAPTER:
        raise RuntimeError(f"Unexpected Tesco OCR adapter: {metadata.get('adapter')}")
    if row.get("status") != "review":
        raise RuntimeError(f"Tesco OCR source must stay internal review, got {row.get('status')}")
    if row.get("detected_valid_from") > today or row.get("detected_valid_to") < today:
        raise RuntimeError(
            f"Tesco OCR source is not current on {today}: "
            f"{row.get('detected_valid_from')}..{row.get('detected_valid_to')}"
        )
    if int(metadata.get("page_count") or 0) != EXPECTED_PAGES or len(pages) != EXPECTED_PAGES:
        raise RuntimeError(
            f"Tesco OCR source must contain exactly {EXPECTED_PAGES} pages, "
            f"got metadata={metadata.get('page_count')} urls={len(pages)}"
        )
    if len(set(pages)) != EXPECTED_PAGES:
        raise RuntimeError("Tesco OCR source contains duplicate page URLs")
    for number, url in enumerate(pages, start=1):
        validate_page_url(str(url), number)

    pdf_url = str(row.get("source_document_url") or "")
    validate_pdf_url(pdf_url)

    return {
        "ok": True,
        "import_id": import_id,
        "page_image_urls": pages,
        "pdf_url": pdf_url,
        "valid_from": row.get("detected_valid_from"),
        "valid_to": row.get("detected_valid_to"),
    }


def api(method, path, body=None, extra_headers=None):
    if method == "POST" and path == "/rest/v1/rpc/get_terno_ocr_target":
        return _target
    return _api(method, path, body, extra_headers)


def download_file(url: str, destination: str, accept: str, expected_prefix: str | None = None):
    with urllib.request.urlopen(request(url, accept), timeout=120) as response, open(destination, "wb") as output:
        content_type = (response.headers.get("content-type") or "").lower()
        if response.status not in (200, 206):
            raise RuntimeError(f"Tesco asset HTTP {response.status}: {url}")
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
    if os.path.getsize(destination) < 10_000:
        raise RuntimeError(f"Tesco asset is unexpectedly small: {url}")
    if expected_prefix:
        with open(destination, "rb") as handle:
            prefix = handle.read(len(expected_prefix)).decode("latin1", "replace")
        if prefix != expected_prefix:
            raise RuntimeError(f"Tesco asset has unexpected magic bytes: {url}")
    return content_type


def normalize_image(source_path: str, destination: str, page_number: int):
    from PIL import Image, ImageOps

    normalized_path = f"{destination}.normalized.jpg"
    try:
        with Image.open(source_path) as source:
            source.load()
            image = ImageOps.exif_transpose(source)
            width, height = image.size
            if width < 500 or height < 700 or width > 10000 or height > 10000:
                raise RuntimeError(f"Tesco page {page_number} has unsafe dimensions {width}x{height}")
            if width * height > 50_000_000:
                raise RuntimeError(f"Tesco page {page_number} is too large: {width}x{height}")
            image.convert("RGB").save(normalized_path, format="JPEG", quality=95, optimize=False, progressive=False)
        if os.path.getsize(normalized_path) < 50_000:
            raise RuntimeError(f"Tesco page {page_number} normalized image is unexpectedly small")
        os.replace(normalized_path, destination)
    finally:
        try:
            if os.path.exists(normalized_path):
                os.remove(normalized_path)
        except OSError:
            pass


def render_pdf_page(destination: str, page_number: int):
    if not _target or not _target.get("pdf_url"):
        raise RuntimeError("Tesco PDF fallback has no canonical PDF URL")
    pdf_url = str(_target["pdf_url"])
    validate_pdf_url(pdf_url)
    workdir = os.path.dirname(destination)
    pdf_path = os.path.join(workdir, "tesco-canonical-source.pdf")
    if not os.path.exists(pdf_path):
        temporary_pdf = f"{pdf_path}.download"
        try:
            download_file(pdf_url, temporary_pdf, "application/pdf,*/*;q=0.8", expected_prefix="%PDF-")
            if os.path.getsize(temporary_pdf) < 250_000:
                raise RuntimeError("Tesco canonical PDF is unexpectedly small")
            os.replace(temporary_pdf, pdf_path)
        finally:
            try:
                if os.path.exists(temporary_pdf):
                    os.remove(temporary_pdf)
            except OSError:
                pass

    prefix = os.path.join(workdir, f"tesco-pdf-page-{page_number}")
    rendered = f"{prefix}.jpg"
    completed = subprocess.run(
        [
            "pdftoppm", "-f", str(page_number), "-l", str(page_number), "-singlefile",
            "-jpeg", "-jpegopt", "quality=95", "-r", "160", pdf_path, prefix,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=180,
        check=False,
    )
    try:
        if completed.returncode != 0 or not os.path.exists(rendered):
            raise RuntimeError(f"Tesco PDF page {page_number} render failed: {completed.stderr[-1200:]}")
        normalize_image(rendered, destination, page_number)
    finally:
        try:
            if os.path.exists(rendered):
                os.remove(rendered)
        except OSError:
            pass
    print(f"[{page_number}/{EXPECTED_PAGES}] page image invalid; rendered from canonical PDF", flush=True)


def cache_busted(url: str, attempt: int):
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query.append(("_slevao_retry", f"{int(time.time() * 1000)}-{attempt}"))
    return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query)))


def direct_download(image_url: str, destination: str):
    page_number = int(os.path.basename(destination).split("-")[-1].split(".")[0])
    validate_page_url(image_url, page_number)
    errors = []
    raw_path = f"{destination}.download"

    for attempt in range(1, 4):
        try:
            retry_url = image_url if attempt == 1 else cache_busted(image_url, attempt)
            content_type = download_file(retry_url, raw_path, "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8")
            if not content_type.startswith("image/"):
                raise RuntimeError(f"Tesco page {page_number} response is not image/*: {content_type}")
            normalize_image(raw_path, destination, page_number)
            return
        except Exception as exc:
            errors.append(f"attempt {attempt}: {exc}")
            try:
                if os.path.exists(raw_path):
                    os.remove(raw_path)
            except OSError:
                pass
            if attempt < 3:
                time.sleep(0.4 * attempt)

    try:
        render_pdf_page(destination, page_number)
    except Exception as exc:
        raise RuntimeError(
            f"Tesco page {page_number} failed direct image retries ({'; '.join(errors)}) and PDF fallback: {exc}"
        ) from exc
    finally:
        try:
            if os.path.exists(raw_path):
                os.remove(raw_path)
        except OSError:
            pass


worker.api = api
worker.download = direct_download

if __name__ == "__main__":
    _target = ensure_target()
    print(json.dumps({
        "worker": "tesco",
        "engine": worker.ENGINE,
        "adapter": SOURCE_ADAPTER,
        "import_id": _target["import_id"],
        "pages": len(_target["page_image_urls"]),
        "valid_from": _target["valid_from"],
        "valid_to": _target["valid_to"],
    }, ensure_ascii=False), flush=True)
    worker.main()
