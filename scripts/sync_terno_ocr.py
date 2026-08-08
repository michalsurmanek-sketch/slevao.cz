#!/usr/bin/env python3
import csv
import hashlib
import io
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

ENGINE = "tesseract-cli-ces-v1"
LANGUAGE = "ces+eng"
SUPABASE_USER_AGENT = "slevao-github-actions-terno-ocr/1.0"
BROWSER_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Slevao-Terno-OCR/1.0"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
MAX_PAGES = int(os.environ.get("TERNO_OCR_MAX_PAGES", "0") or "0")
FORCE = os.environ.get("TERNO_OCR_FORCE", "").lower() in {"1", "true", "yes"}

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    raise SystemExit("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")


def looks_like_jwt(value: str) -> bool:
    return value.startswith("eyJ") and value.count(".") == 2


def api(method: str, path: str, body=None, extra_headers=None):
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Accept": "application/json",
        "User-Agent": SUPABASE_USER_AGENT,
        "X-Client-Info": SUPABASE_USER_AGENT,
    }
    # Legacy service-role JWTs are valid bearer tokens. Modern sb_secret_* keys
    # authenticate through apikey and must not be presented as a fake JWT.
    if looks_like_jwt(SERVICE_ROLE_KEY):
        headers["Authorization"] = f"Bearer {SERVICE_ROLE_KEY}"
    if body is not None:
        headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)
    payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = response.read()
            if not raw:
                return None
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:2000]
        raise RuntimeError(f"Supabase {method} {path}: HTTP {exc.code}: {detail}") from exc


def download(url: str, destination: str):
    request = urllib.request.Request(
        url,
        headers={"User-Agent": BROWSER_USER_AGENT, "Accept": "image/jpeg,image/png,image/webp,*/*"},
    )
    with urllib.request.urlopen(request, timeout=90) as response, open(destination, "wb") as out:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)


def file_sha256(path: str):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_tsv(tsv: str):
    reader = csv.DictReader(io.StringIO(tsv), delimiter="\t")
    words = []
    line_words = defaultdict(list)
    confidences = []
    image_width = None
    image_height = None

    for row in reader:
        try:
            level = int(row.get("level") or 0)
            left = int(row.get("left") or 0)
            top = int(row.get("top") or 0)
            width = int(row.get("width") or 0)
            height = int(row.get("height") or 0)
        except ValueError:
            continue

        if level == 1 and width > 0 and height > 0:
            image_width = width
            image_height = height

        if level != 5:
            continue

        text = (row.get("text") or "").strip()
        if not text:
            continue
        try:
            confidence = float(row.get("conf") or -1)
        except ValueError:
            confidence = -1.0

        word = {
            "text": text,
            "confidence": round(confidence, 2),
            "left": left,
            "top": top,
            "width": width,
            "height": height,
            "block": int(row.get("block_num") or 0),
            "paragraph": int(row.get("par_num") or 0),
            "line": int(row.get("line_num") or 0),
            "word": int(row.get("word_num") or 0),
        }
        words.append(word)
        key = (word["block"], word["paragraph"], word["line"])
        line_words[key].append(word)
        if confidence >= 0:
            confidences.append(confidence)

    lines = []
    for key, group in line_words.items():
        ordered = sorted(group, key=lambda item: (item["left"], item["word"]))
        text = " ".join(item["text"] for item in ordered).strip()
        if not text:
            continue
        lines.append({
            "key": key,
            "top": min(item["top"] for item in ordered),
            "left": min(item["left"] for item in ordered),
            "text": text,
        })
    lines.sort(key=lambda item: (item["top"], item["left"]))
    text_content = "\n".join(item["text"] for item in lines)
    avg_confidence = round(sum(confidences) / len(confidences), 3) if confidences else None

    if image_width is None:
        image_width = max((word["left"] + word["width"] for word in words), default=0)
    if image_height is None:
        image_height = max((word["top"] + word["height"] for word in words), default=0)

    return {
        "words": words,
        "text_content": text_content,
        "avg_confidence": avg_confidence,
        "image_width": image_width or None,
        "image_height": image_height or None,
    }


def ocr_page(image_path: str):
    command = [
        "tesseract",
        image_path,
        "stdout",
        "-l",
        LANGUAGE,
        "--psm",
        "11",
        "--oem",
        "1",
        "tsv",
    ]
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=240,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"Tesseract failed: {completed.stderr[-1500:]}")
    return parse_tsv(completed.stdout)


def existing_pages(import_id: str):
    params = urllib.parse.urlencode({
        "import_id": f"eq.{import_id}",
        "engine": f"eq.{ENGINE}",
        "select": "page_number,checksum,word_count",
    })
    rows = api("GET", f"/rest/v1/leaflet_ocr_pages?{params}") or []
    return {int(row["page_number"]): row for row in rows}


def upsert_page(row: dict):
    api(
        "POST",
        "/rest/v1/leaflet_ocr_pages?on_conflict=import_id,page_number,engine",
        [row],
        {"Prefer": "resolution=merge-duplicates,return=minimal"},
    )


def update_import_metadata(import_id: str, completed_pages: int, total_pages: int):
    params = urllib.parse.urlencode({"id": f"eq.{import_id}", "select": "metadata"})
    rows = api("GET", f"/rest/v1/leaflet_imports?{params}") or []
    if not rows:
        raise RuntimeError(f"Import {import_id} disappeared")
    metadata = dict(rows[0].get("metadata") or {})
    metadata.update({
        "ocr_engine": ENGINE,
        "ocr_language": LANGUAGE,
        "ocr_pages_completed": completed_pages,
        "ocr_pages_expected": total_pages,
        "ocr_complete": completed_pages == total_pages,
        "ocr_completed_at": datetime.now(timezone.utc).isoformat() if completed_pages == total_pages else None,
        "ocr_worker": "github-actions",
    })
    patch_params = urllib.parse.urlencode({"id": f"eq.{import_id}"})
    api(
        "PATCH",
        f"/rest/v1/leaflet_imports?{patch_params}",
        {"metadata": metadata},
        {"Prefer": "return=minimal"},
    )


def main():
    target = api("POST", "/rest/v1/rpc/get_terno_ocr_target", {})
    if not isinstance(target, dict) or not target.get("ok"):
        raise RuntimeError(f"No Terno OCR target: {target}")

    import_id = str(target["import_id"])
    page_urls = list(target.get("page_image_urls") or [])
    if MAX_PAGES > 0:
        page_urls = page_urls[:MAX_PAGES]
    if not page_urls:
        raise RuntimeError("Terno target has no page images")

    print(f"Terno OCR target {import_id}: {len(page_urls)} pages", flush=True)
    existing = existing_pages(import_id)
    processed = 0
    skipped = 0

    with tempfile.TemporaryDirectory(prefix="terno-ocr-") as temp_dir:
        for index, image_url in enumerate(page_urls, start=1):
            image_path = os.path.join(temp_dir, f"page-{index}.jpg")
            print(f"[{index}/{len(page_urls)}] download {image_url}", flush=True)
            download(image_url, image_path)
            checksum = file_sha256(image_path)
            old = existing.get(index)
            if not FORCE and old and old.get("checksum") == checksum and int(old.get("word_count") or 0) > 0:
                print(f"[{index}/{len(page_urls)}] unchanged, skip", flush=True)
                skipped += 1
                continue

            started = time.monotonic()
            result = ocr_page(image_path)
            elapsed = time.monotonic() - started
            words = result["words"]
            print(
                f"[{index}/{len(page_urls)}] OCR {len(words)} words, "
                f"avg={result['avg_confidence']}, {elapsed:.1f}s",
                flush=True,
            )
            if not words:
                raise RuntimeError(f"OCR page {index} returned zero words")

            upsert_page({
                "import_id": import_id,
                "page_number": index,
                "image_url": image_url,
                "engine": ENGINE,
                "language": LANGUAGE,
                "image_width": result["image_width"],
                "image_height": result["image_height"],
                "text_content": result["text_content"],
                "words": words,
                "avg_confidence": result["avg_confidence"],
                "word_count": len(words),
                "checksum": checksum,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            processed += 1

    final_existing = existing_pages(import_id)
    complete_pages = sum(1 for page in range(1, len(page_urls) + 1) if int(final_existing.get(page, {}).get("word_count") or 0) > 0)
    update_import_metadata(import_id, complete_pages, len(page_urls))
    print(json.dumps({
        "ok": complete_pages == len(page_urls),
        "import_id": import_id,
        "pages": len(page_urls),
        "complete_pages": complete_pages,
        "processed": processed,
        "skipped": skipped,
    }, ensure_ascii=False), flush=True)
    if complete_pages != len(page_urls):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
