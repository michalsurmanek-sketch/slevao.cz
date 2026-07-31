#!/usr/bin/env python3
"""Doplni chybejici fotografie vyrezem primo z PDF letaku.

Worker:
1. nacte publikovane leaflet_import_items s source_page a bez obrazku,
2. stahne puvodni PDF letaku,
3. vyrenderuje prislusnou stranu pres PyMuPDF,
4. pozada OpenAI vision o bounding box produktu,
5. vyrez ulozi do Supabase Storage,
6. aktualizuje leaflet_import_items, offers a products.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import sys
import time
import unicodedata
from typing import Any

import fitz  # PyMuPDF
import requests
from PIL import Image

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
OPENAI_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-5-mini")
BUCKET = os.getenv("LEAFLET_IMAGE_BUCKET", "product-images")
LIMIT = max(1, min(int(os.getenv("CROP_LIMIT", "40")), 150))

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}


def api(path: str, method: str = "GET", **kwargs: Any) -> requests.Response:
    response = requests.request(
        method,
        f"{SUPABASE_URL}{path}",
        headers={**HEADERS, **kwargs.pop("headers", {})},
        timeout=60,
        **kwargs,
    )
    response.raise_for_status()
    return response


def slug(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text[:80] or "produkt"


def ensure_bucket() -> None:
    buckets = api("/storage/v1/bucket").json()
    if any(row.get("name") == BUCKET for row in buckets):
        return
    api(
        "/storage/v1/bucket",
        "POST",
        data=json.dumps({"id": BUCKET, "name": BUCKET, "public": True, "file_size_limit": 8_000_000}),
    )


def load_jobs() -> list[dict[str, Any]]:
    # leaflet_imports ma podle migrace sloupec source_document_url.
    # Predchozi verze zadala neexistujici source_url/storage_path a PostgREST vracel HTTP 400.
    select = (
        "id,import_id,product_id,title,source_page,image_url,status,"
        "leaflet_imports(id,source_document_url,metadata,store_id)"
    )
    params = {
        "select": select,
        "status": "eq.published",
        "source_page": "not.is.null",
        "order": "created_at.desc",
        "limit": str(LIMIT),
    }
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/leaflet_import_items",
        headers=HEADERS,
        params=params,
        timeout=60,
    )
    if response.status_code >= 400:
        raise RuntimeError(
            f"Supabase nacitani polozek selhalo HTTP {response.status_code}: {response.text[:1200]}"
        )
    rows = response.json()
    return [row for row in rows if not str(row.get("image_url") or "").strip()]


def resolve_pdf_url(job: dict[str, Any]) -> str | None:
    imp = job.get("leaflet_imports") or {}
    metadata = imp.get("metadata") or {}
    for value in (
        imp.get("source_document_url"),
        metadata.get("source_document_url"),
        metadata.get("source_url"),
        metadata.get("pdf_url"),
        metadata.get("document_url"),
    ):
        if isinstance(value, str) and value.startswith("http"):
            return value
    return None


def download_pdf(url: str) -> bytes:
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/pdf,*/*"}
    if url.startswith(SUPABASE_URL):
        headers.update({"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"})
    response = requests.get(url, headers=headers, timeout=90)
    response.raise_for_status()
    if not response.content.startswith(b"%PDF"):
        raise ValueError(f"Zdroj neni PDF: {response.headers.get('content-type')}")
    return response.content


def render_page(pdf: bytes, page_number: int) -> Image.Image:
    document = fitz.open(stream=pdf, filetype="pdf")
    index = max(0, min(page_number - 1, document.page_count - 1))
    page = document.load_page(index)
    matrix = fitz.Matrix(2.0, 2.0)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")


def locate_product(image: Image.Image, title: str) -> tuple[float, float, float, float] | None:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=88, optimize=True)
    data_url = "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["found", "x", "y", "width", "height", "confidence"],
        "properties": {
            "found": {"type": "boolean"},
            "x": {"type": "number", "minimum": 0, "maximum": 1},
            "y": {"type": "number", "minimum": 0, "maximum": 1},
            "width": {"type": "number", "minimum": 0, "maximum": 1},
            "height": {"type": "number", "minimum": 0, "maximum": 1},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
    }
    payload = {
        "model": OPENAI_MODEL,
        "store": False,
        "input": [{
            "role": "user",
            "content": [
                {"type": "input_text", "text": (
                    f"Na teto strane ceskeho akcniho letaku najdi fotografii produktu: {title}. "
                    "Vrat normalizovany obdelnik pouze samotne fotografie produktu, bez cenovky, textu, loga a pozadi. "
                    "Kdyz produkt na strane neni, found=false."
                )},
                {"type": "input_image", "image_url": data_url, "detail": "high"},
            ],
        }],
        "text": {"format": {"type": "json_schema", "name": "product_crop", "strict": True, "schema": schema}},
    }
    response = requests.post(
        "https://api.openai.com/v1/responses",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
        data=json.dumps(payload),
        timeout=120,
    )
    response.raise_for_status()
    result = response.json()
    text = result.get("output_text")
    if not text:
        for output in result.get("output", []):
            for content in output.get("content", []):
                if content.get("text"):
                    text = content["text"]
                    break
    box = json.loads(text or "{}")
    if not box.get("found") or float(box.get("confidence", 0)) < 0.65:
        return None
    x, y, w, h = (float(box[k]) for k in ("x", "y", "width", "height"))
    if w < 0.04 or h < 0.04:
        return None
    return x, y, w, h


def crop_image(image: Image.Image, box: tuple[float, float, float, float]) -> bytes:
    x, y, w, h = box
    pad_x, pad_y = w * 0.04, h * 0.04
    left = max(0, int((x - pad_x) * image.width))
    top = max(0, int((y - pad_y) * image.height))
    right = min(image.width, int((x + w + pad_x) * image.width))
    bottom = min(image.height, int((y + h + pad_y) * image.height))
    crop = image.crop((left, top, right, bottom))
    crop.thumbnail((900, 900), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    crop.save(output, "WEBP", quality=88, method=6)
    return output.getvalue()


def upload_crop(job: dict[str, Any], data: bytes) -> str:
    filename = f"leaflet-crops/{job['import_id']}/{job['id']}-{slug(job['title'])}.webp"
    response = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{filename}",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "image/webp",
            "x-upsert": "true",
        },
        data=data,
        timeout=60,
    )
    response.raise_for_status()
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{filename}"


def patch_table(table: str, filters: dict[str, str], values: dict[str, Any]) -> None:
    params = {key: f"eq.{value}" for key, value in filters.items() if value}
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**HEADERS, "Prefer": "return=minimal"},
        params=params,
        data=json.dumps(values),
        timeout=60,
    )
    response.raise_for_status()


def save_result(job: dict[str, Any], image_url: str) -> None:
    patch_table("leaflet_import_items", {"id": job["id"]}, {"image_url": image_url})
    if job.get("product_id"):
        patch_table("products", {"id": job["product_id"]}, {"image_url": image_url})
        store_id = (job.get("leaflet_imports") or {}).get("store_id")
        filters = {"product_id": job["product_id"]}
        if store_id:
            filters["store_id"] = store_id
        patch_table("offers", filters, {"image_url": image_url})


def main() -> int:
    ensure_bucket()
    jobs = load_jobs()
    print(f"Nalezeno {len(jobs)} produktu k vyrezu.")
    pdf_cache: dict[str, bytes] = {}
    success = missing = failed = 0

    for job in jobs:
        try:
            url = resolve_pdf_url(job)
            if not url:
                print(f"SKIP {job['title']}: chybi URL PDF")
                missing += 1
                continue
            pdf = pdf_cache.get(url)
            if pdf is None:
                pdf = download_pdf(url)
                pdf_cache[url] = pdf
            page = render_page(pdf, int(job.get("source_page") or 1))
            box = locate_product(page, str(job.get("title") or ""))
            if box is None:
                print(f"NOT FOUND {job['title']} (strana {job.get('source_page')})")
                missing += 1
                continue
            image_url = upload_crop(job, crop_image(page, box))
            save_result(job, image_url)
            print(f"OK {job['title']} -> {image_url}")
            success += 1
            time.sleep(0.2)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"ERROR {job.get('title')}: {exc}", file=sys.stderr)

    print(json.dumps({"checked": len(jobs), "enriched": success, "not_found": missing, "failed": failed}, ensure_ascii=False))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())