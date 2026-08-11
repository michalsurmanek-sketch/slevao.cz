#!/usr/bin/env python3
"""OCR current/upcoming JIP leaflet pages on a GitHub runner and persist them safely.

The GitHub runner has enough memory for native Tesseract, unlike Supabase Edge.
Database access uses the existing SUPABASE_ACCESS_TOKEN against the official
Supabase Management API database/query endpoint; no service-role key is needed.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "uhampjdqjxmbhaptgitn")
ACCESS_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
API_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
JIP_PROXY_URL = f"https://{PROJECT_REF}.supabase.co/functions/v1/debug-kaufland-source"
ENGINE = "tesseract-cli-ces-jip-v2"


def query(sql: str, parameters: list[Any] | None = None, read_only: bool = False) -> list[dict[str, Any]]:
    if not ACCESS_TOKEN:
        raise RuntimeError("Chybí SUPABASE_ACCESS_TOKEN.")
    body: dict[str, Any] = {"query": sql, "read_only": read_only}
    if parameters is not None:
        body["parameters"] = parameters
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {ACCESS_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "slevao-jip-ocr/2",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8") or "[]")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"Supabase Management API HTTP {exc.code}: {detail[:1500]}") from exc

    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        if payload.get("error"):
            raise RuntimeError(f"Supabase SQL chyba: {payload['error']}")
        for key in ("result", "data"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def current_source() -> dict[str, Any] | None:
    rows = query(
        """
        select
          li.id::text as id,
          li.detected_valid_from::text as valid_from,
          li.detected_valid_to::text as valid_to,
          li.source_document_url,
          li.metadata ->> 'title' as title,
          li.metadata -> 'page_image_urls' as page_image_urls
        from public.leaflet_imports li
        join public.stores s on s.id = li.store_id
        where s.slug = 'jip'
          and li.metadata ->> 'adapter' = 'jip-flip-pdf-v1'
          and li.detected_valid_to > (now() at time zone 'Europe/Prague')::date
          and jsonb_typeof(li.metadata -> 'page_image_urls') = 'array'
          and jsonb_array_length(li.metadata -> 'page_image_urls') >= 2
        order by li.detected_valid_from asc, li.created_at desc
        limit 1
        """,
        read_only=True,
    )
    return rows[0] if rows else None


def existing_pages(import_id: str) -> set[int]:
    rows = query(
        "select page_number from public.leaflet_ocr_pages where import_id = $1::uuid order by page_number",
        [import_id],
        read_only=True,
    )
    return {int(row["page_number"]) for row in rows}


def download(url: str, destination: Path) -> bytes:
    parsed = urllib.parse.urlparse(url)
    fetch_url = url
    if parsed.hostname == "www.jip-potraviny.cz" and "/files/mobile/" in parsed.path:
        fetch_url = f"{JIP_PROXY_URL}?url={urllib.parse.quote(url, safe='')}"
    request = urllib.request.Request(
        fetch_url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
            "Accept": "image/jpeg,image/png,image/webp,*/*",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=75) as response:
            data = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"Stažení JIP stránky selhalo HTTP {exc.code}: {detail[:500]}") from exc
    if len(data) < 10_000:
        raise RuntimeError(f"JIP stránka je podezřele malá: {url} ({len(data)} B)")
    destination.write_bytes(data)
    return data


def tesseract_words(image_path: Path) -> tuple[str, list[dict[str, Any]], float, str]:
    process = subprocess.run(
        ["tesseract", str(image_path), "stdout", "-l", "ces", "--psm", "11", "tsv"],
        text=True,
        capture_output=True,
        timeout=180,
        check=False,
    )
    if process.returncode != 0:
        raise RuntimeError(f"Tesseract selhal: {process.stderr[-1500:]}")

    words: list[dict[str, Any]] = []
    lines: dict[tuple[int, int, int], list[tuple[int, str]]] = defaultdict(list)
    reader = csv.DictReader(io.StringIO(process.stdout), delimiter="\t")
    for row in reader:
        text = (row.get("text") or "").strip()
        if not text or row.get("level") != "5":
            continue
        try:
            confidence = float(row.get("conf") or -1)
            left = int(row.get("left") or 0)
            top = int(row.get("top") or 0)
            width = int(row.get("width") or 0)
            height = int(row.get("height") or 0)
            block = int(row.get("block_num") or 0)
            paragraph = int(row.get("par_num") or 0)
            line = int(row.get("line_num") or 0)
            word = int(row.get("word_num") or 0)
        except ValueError:
            continue
        if confidence < 0 or width <= 0 or height <= 0:
            continue
        words.append(
            {
                "text": text,
                "left": left,
                "top": top,
                "width": width,
                "height": height,
                "confidence": round(confidence, 2),
                "block": block,
                "paragraph": paragraph,
                "line": line,
                "word": word,
            }
        )
        lines[(block, paragraph, line)].append((word, text))

    if len(words) < 25:
        raise RuntimeError(f"OCR vrátil jen {len(words)} slov.")
    avg_confidence = round(sum(float(word["confidence"]) for word in words) / len(words), 2)
    text_content = "\n".join(
        " ".join(text for _, text in sorted(line_words))
        for _, line_words in sorted(lines.items())
    )
    return process.stdout, words, avg_confidence, text_content


def save_page(import_id: str, page_number: int, image_url: str, image_bytes: bytes, tsv: str,
              words: list[dict[str, Any]], avg_confidence: float, text_content: str) -> None:
    checksum = hashlib.sha256(image_bytes + tsv.encode("utf-8")).hexdigest()
    query(
        """
        insert into public.leaflet_ocr_pages(
          import_id,page_number,image_url,engine,language,text_content,words,
          avg_confidence,word_count,checksum,created_at,updated_at
        ) values (
          $1::uuid,$2::integer,$3,$4,'ces',$5,$6::jsonb,$7::numeric,$8::integer,$9,now(),now()
        )
        on conflict(import_id,page_number,engine) do update set
          image_url=excluded.image_url,
          language=excluded.language,
          text_content=excluded.text_content,
          words=excluded.words,
          avg_confidence=excluded.avg_confidence,
          word_count=excluded.word_count,
          checksum=excluded.checksum,
          updated_at=now()
        """,
        [import_id, page_number, image_url, ENGINE, text_content, json.dumps(words, ensure_ascii=False), avg_confidence, len(words), checksum],
    )


def refresh_completion(import_id: str) -> dict[str, Any]:
    rows = query("select public.refresh_leaflet_ocr_completion($1::uuid) as result", [import_id])
    return rows[0].get("result", {}) if rows else {}


def trigger_product_sync() -> int:
    rows = query("select public.trigger_jip_ocr_product_sync(false) as request_id")
    if not rows or rows[0].get("request_id") is None:
        raise RuntimeError("JIP produktový sync nevrátil request_id.")
    return int(rows[0]["request_id"])


def wait_for_sync(request_id: int) -> dict[str, Any]:
    for _ in range(30):
        rows = query(
            "select status_code,timed_out,error_msg,content from net._http_response where id=$1::bigint",
            [request_id],
            read_only=True,
        )
        if rows:
            row = rows[0]
            if row.get("timed_out"):
                raise RuntimeError(f"JIP Edge sync timeout: {row.get('error_msg')}")
            status = int(row.get("status_code") or 0)
            content = row.get("content") or "{}"
            try:
                payload = json.loads(content)
            except json.JSONDecodeError:
                payload = {"raw": content}
            if status < 200 or status >= 300:
                raise RuntimeError(f"JIP Edge sync HTTP {status}: {content[:1500]}")
            if payload.get("ok") is False:
                raise RuntimeError(f"JIP Edge sync chyba: {payload}")
            return payload
        time.sleep(2)
    raise RuntimeError(f"JIP Edge sync {request_id} se nevrátil včas.")


def main() -> int:
    source = current_source()
    if not source:
        print("JIP nemá nadcházející leták s obrazovými stranami; není co OCRovat.")
        return 0

    import_id = source["id"]
    page_urls = source.get("page_image_urls") or []
    if isinstance(page_urls, str):
        page_urls = json.loads(page_urls)
    if not isinstance(page_urls, list) or len(page_urls) < 2:
        raise RuntimeError("JIP import nemá platný seznam page_image_urls.")

    done = existing_pages(import_id)
    print(f"JIP source {import_id}: {source.get('valid_from')}–{source.get('valid_to')}, stran {len(page_urls)}, hotovo {len(done)}")

    with tempfile.TemporaryDirectory(prefix="jip-ocr-") as temp_dir:
        temp = Path(temp_dir)
        for page_number, image_url in enumerate(page_urls, start=1):
            if page_number in done:
                continue
            image_path = temp / f"page-{page_number:02d}.jpg"
            print(f"OCR JIP strana {page_number}/{len(page_urls)}…", flush=True)
            image_bytes = download(str(image_url), image_path)
            tsv, words, avg_confidence, text_content = tesseract_words(image_path)
            save_page(import_id, page_number, str(image_url), image_bytes, tsv, words, avg_confidence, text_content)
            print(f"  {len(words)} slov, průměrná jistota {avg_confidence} %")

    completion = refresh_completion(import_id)
    print("OCR completion:", json.dumps(completion, ensure_ascii=False))
    if not completion.get("complete"):
        raise RuntimeError(f"JIP OCR není po běhu kompletní: {completion}")

    request_id = trigger_product_sync()
    result = wait_for_sync(request_id)
    print("JIP product sync:", json.dumps(result, ensure_ascii=False))
    if result.get("processing"):
        raise RuntimeError(f"JIP sync po kompletním OCR stále čeká: {result}")
    if not (result.get("published") or result.get("reused")):
        if int(result.get("candidate_count") or 0) < 1:
            raise RuntimeError(f"JIP OCR je kompletní, ale nebyla bezpečně publikována žádná nabídka: {result}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
