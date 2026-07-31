#!/usr/bin/env python3
"""Doplní čisté fotografie produktů výřezem přímo z PDF letáku."""

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

import fitz
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
    select = (
        "id,import_id,product_id,title,source_page,image_url,status,"
        "leaflet_imports(id,source_document_url,metadata,store_id)"
    )
    params = {
        "select": select,
        "status": "eq.published",
        "source_page": "not.is.null",
        "order": "created_at.desc",
        "limit": str(max(LIMIT * 3, 120)),
    }
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/leaflet_import_items",
        headers=HEADERS,
        params=params,
        timeout=60,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase HTTP {response.status_code}: {response.text[:1200]}")

    jobs: list[dict[str, Any]] = []
    for row in response.json():
        image_url = str(row.get("image_url") or "").strip()
        # Znovu zpracujeme i dřívější vadné výřezy celého reklamního bloku.
        if not image_url or "/product-images/leaflet-crops/" in image_url:
            jobs.append(row)
        if len(jobs) >= LIMIT:
            break
    return jobs


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
        raise ValueError(f"Zdroj není PDF: {response.headers.get('content-type')}")
    return response.content


def render_page(pdf: bytes, page_number: int) -> Image.Image:
    document = fitz.open(stream=pdf, filetype="pdf")
    index = max(0, min(page_number - 1, document.page_count - 1))
    page = document.load_page(index)
    pix = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False)
    return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")


def image_data_url(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def vision_box(image: Image.Image, instruction: str, schema_name: str) -> dict[str, Any]:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["found", "x", "y", "width", "height", "confidence", "contains_text"],
        "properties": {
            "found": {"type": "boolean"},
            "x": {"type": "number", "minimum": 0, "maximum": 1},
            "y": {"type": "number", "minimum": 0, "maximum": 1},
            "width": {"type": "number", "minimum": 0, "maximum": 1},
            "height": {"type": "number", "minimum": 0, "maximum": 1},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "contains_text": {"type": "boolean"},
        },
    }
    payload = {
        "model": OPENAI_MODEL,
        "store": False,
        "input": [{
            "role": "user",
            "content": [
                {"type": "input_text", "text": instruction},
                {"type": "input_image", "image_url": image_data_url(image), "detail": "high"},
            ],
        }],
        "text": {"format": {"type": "json_schema", "name": schema_name, "strict": True, "schema": schema}},
    }
    response = requests.post(
        "https://api.openai.com/v1/responses",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
        data=json.dumps(payload),
        timeout=150,
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
    return json.loads(text or "{}")


def parse_box(result: dict[str, Any], min_confidence: float) -> tuple[float, float, float, float] | None:
    if not result.get("found") or float(result.get("confidence", 0)) < min_confidence:
        return None
    x, y, w, h = (float(result.get(k, 0)) for k in ("x", "y", "width", "height"))
    if w < 0.025 or h < 0.025 or x + w > 1.02 or y + h > 1.02:
        return None
    return x, y, w, h


def crop_pixels(image: Image.Image, box: tuple[float, float, float, float], padding: float = 0) -> Image.Image:
    x, y, w, h = box
    px = w * padding
    py = h * padding
    left = max(0, int((x - px) * image.width))
    top = max(0, int((y - py) * image.height))
    right = min(image.width, int((x + w + px) * image.width))
    bottom = min(image.height, int((y + h + py) * image.height))
    return image.crop((left, top, right, bottom))


def locate_clean_product(page: Image.Image, title: str) -> Image.Image | None:
    # 1) Najde celý reklamní blok, aby se správně určil konkrétní produkt na přeplněné stránce.
    block_result = vision_box(
        page,
        f"Najdi na stránce reklamní blok nabídky produktu '{title}'. "
        "Obdélník může obsahovat fotografii, název a cenu. Vyber pouze správný blok tohoto produktu. "
        "contains_text nastav podle toho, zda blok obsahuje text.",
        "offer_block",
    )
    block_box = parse_box(block_result, 0.65)
    if block_box is None:
        return None
    block = crop_pixels(page, block_box, padding=0.03)

    # 2) Uvnitř bloku najde jen fyzický produkt. Cenovky, popisky a barevné reklamní plochy musí zůstat mimo.
    product_result = vision_box(
        block,
        f"V tomto reklamním bloku je produkt '{title}'. Vrať těsný obdélník pouze kolem skutečné fotografie "
        "výrobku nebo potraviny. NESMÍ obsahovat cenu, procenta, název produktu, gramáž, Clubcard štítek, "
        "barevný reklamní panel, logo obchodu ani jiný text. Pokud čistou fotografii nelze oddělit, found=false. "
        "contains_text=true pouze pokud navržený obdélník stále zasahuje jakýkoli tištěný text nebo cenovku.",
        "clean_product_photo",
    )
    product_box = parse_box(product_result, 0.72)
    if product_box is None or product_result.get("contains_text"):
        return None
    product = crop_pixels(block, product_box, padding=0.015)

    # Nepovolíme extrémně široký reklamní pruh; produktové fotografie bývají kompaktní.
    ratio = product.width / max(product.height, 1)
    if product.width < 80 or product.height < 80 or ratio > 3.2 or ratio < 0.18:
        return None
    return product


def encode_webp(image: Image.Image) -> bytes:
    image.thumbnail((900, 900), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, "WEBP", quality=90, method=6)
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
    print(f"Nalezeno {len(jobs)} produktů k čistému výřezu.")
    pdf_cache: dict[str, bytes] = {}
    success = missing = failed = 0

    for job in jobs:
        try:
            url = resolve_pdf_url(job)
            if not url:
                print(f"SKIP {job['title']}: chybí URL PDF")
                missing += 1
                continue
            pdf = pdf_cache.get(url)
            if pdf is None:
                pdf = download_pdf(url)
                pdf_cache[url] = pdf
            page = render_page(pdf, int(job.get("source_page") or 1))
            product = locate_clean_product(page, str(job.get("title") or ""))
            if product is None:
                print(f"NOT FOUND CLEAN {job['title']} (strana {job.get('source_page')})")
                missing += 1
                continue
            image_url = upload_crop(job, encode_webp(product))
            save_result(job, image_url)
            print(f"OK CLEAN {job['title']} -> {image_url}")
            success += 1
            time.sleep(0.25)
        except Exception as exc:
            failed += 1
            print(f"ERROR {job.get('title')}: {exc}", file=sys.stderr)

    print(json.dumps({"checked": len(jobs), "enriched": success, "not_found": missing, "failed": failed}, ensure_ascii=False))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
