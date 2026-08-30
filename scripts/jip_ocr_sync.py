#!/usr/bin/env python3
import base64
import csv
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "uhampjdqjxmbhaptgitn")
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
ENGINE = "tesseract-cli-ces-jip-v4-github"
LANGUAGE = "ces+eng"
API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"


def query(sql: str, read_only: bool = False):
    payload = json.dumps({"query": sql, "read_only": read_only}).encode()
    req = urllib.request.Request(
        API,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {ACCESS_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            raw = response.read().decode()
    except Exception as exc:
        raise RuntimeError(f"Supabase database/query failed: {exc}") from exc
    data = json.loads(raw or "[]")
    return data


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def b64(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def get_target():
    sql = f"""
with params as (
  select (now() at time zone 'Europe/Prague')::date as today
), candidates as (
  select li.id, li.source_document_url, li.detected_valid_from, li.detected_valid_to,
         li.metadata->'page_image_urls' as page_image_urls,
         jsonb_array_length(li.metadata->'page_image_urls') as expected_pages,
         (select count(distinct p.page_number)
            from public.leaflet_ocr_pages p
           where p.import_id=li.id and p.engine={sql_literal(ENGINE)} and p.word_count>0) as completed_pages
  from public.leaflet_imports li
  join public.stores s on s.id=li.store_id
  cross join params x
  where s.slug='jip'
    and li.status='published'
    and li.metadata->>'adapter'='jip-flip-pdf-v1'
    and coalesce(li.metadata->>'ocr_required','false')='true'
    and jsonb_typeof(li.metadata->'page_image_urls')='array'
    and jsonb_array_length(li.metadata->'page_image_urls')=12
    and li.source_document_url ~ '/MO-[0-9]{{1,2}}-[0-9]{{1,2}}-[0-9]{{4}}/$'
    and li.detected_valid_to>=x.today
    and li.detected_valid_from<=x.today+4
), chosen as (
  select c.*
  from candidates c
  cross join params x
  where c.completed_pages<c.expected_pages
  order by case when c.detected_valid_from<=x.today and c.detected_valid_to>=x.today then 0 else 1 end,
           c.detected_valid_from,
           c.id
  limit 1
)
select jsonb_build_object(
  'import_id', c.id,
  'source_document_url', c.source_document_url,
  'valid_from', c.detected_valid_from,
  'valid_to', c.detected_valid_to,
  'expected_pages', c.expected_pages,
  'completed_pages', c.completed_pages,
  'engine', {sql_literal(ENGINE)},
  'missing_pages', coalesce((
    select jsonb_agg(jsonb_build_object('page',e.ordinality,'url',e.url) order by e.ordinality)
    from jsonb_array_elements_text(c.page_image_urls) with ordinality as e(url,ordinality)
    where not exists (
      select 1 from public.leaflet_ocr_pages p
      where p.import_id=c.id and p.page_number=e.ordinality and p.engine={sql_literal(ENGINE)} and p.word_count>0
    )
  ), '[]'::jsonb)
) as target
from chosen c;
"""
    rows = query(sql, True)
    if not rows:
        return None
    return rows[0].get("target")


def download(url: str, path: Path):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; Slevao-JIP-OCR/1.0)",
            "Accept": "image/jpeg,image/png,image/webp,*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        content_type = (response.headers.get("Content-Type") or "").lower()
        data = response.read()
    if len(data) < 1024 or len(data) > 20 * 1024 * 1024:
        raise RuntimeError(f"Unexpected image size for {url}: {len(data)} bytes")
    if "image" not in content_type and not data.startswith(b"\xff\xd8"):
        raise RuntimeError(f"Unexpected content type for {url}: {content_type}")
    path.write_bytes(data)
    return data


def image_size(path: Path):
    from PIL import Image
    with Image.open(path) as image:
        return int(image.width), int(image.height)


def run_tesseract(path: Path):
    cmd = [
        "tesseract", str(path), "stdout",
        "-l", LANGUAGE,
        "--psm", "11",
        "tsv",
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    reader = csv.DictReader(io.StringIO(result.stdout), delimiter="\t")
    words = []
    line_map = {}
    confs = []
    for row in reader:
        if row.get("level") != "5":
            continue
        text = (row.get("text") or "").strip()
        if not text:
            continue
        try:
            conf = float(row.get("conf") or "-1")
            left = int(row.get("left") or 0)
            top = int(row.get("top") or 0)
            width = int(row.get("width") or 0)
            height = int(row.get("height") or 0)
            block = int(row.get("block_num") or 0)
            paragraph = int(row.get("par_num") or 0)
            line = int(row.get("line_num") or 0)
            word_num = int(row.get("word_num") or 0)
        except ValueError:
            continue
        if conf < 0 or width <= 0 or height <= 0:
            continue
        item = {
            "text": text,
            "left": left,
            "top": top,
            "width": width,
            "height": height,
            "confidence": round(conf, 3),
            "block": block,
            "paragraph": paragraph,
            "line": line,
            "word": word_num,
        }
        words.append(item)
        confs.append(conf)
        line_map.setdefault((block, paragraph, line), []).append((word_num, text))
    if not words:
        raise RuntimeError("Tesseract returned no words")
    text_lines = []
    for key in sorted(line_map):
        text_lines.append(" ".join(text for _, text in sorted(line_map[key])))
    return words, "\n".join(text_lines), sum(confs) / len(confs)


def upsert_page(import_id: str, page: int, image_url: str, image_path: Path, image_bytes: bytes):
    words, text_content, avg_confidence = run_tesseract(image_path)
    width, height = image_size(image_path)
    checksum = hashlib.sha256(image_bytes).hexdigest()
    words_json = json.dumps(words, ensure_ascii=False, separators=(",", ":")).encode()
    text_bytes = text_content.encode()
    sql = f"""
insert into public.leaflet_ocr_pages(
  import_id,page_number,image_url,engine,language,image_width,image_height,
  text_content,words,avg_confidence,word_count,checksum,updated_at
) values (
  {sql_literal(import_id)}::uuid,{page},{sql_literal(image_url)},{sql_literal(ENGINE)},{sql_literal(LANGUAGE)},{width},{height},
  convert_from(decode({sql_literal(b64(text_bytes))},'base64'),'utf8'),
  convert_from(decode({sql_literal(b64(words_json))},'base64'),'utf8')::jsonb,
  {avg_confidence:.6f},{len(words)},{sql_literal(checksum)},now()
)
on conflict(import_id,page_number,engine) do update set
  image_url=excluded.image_url,
  language=excluded.language,
  image_width=excluded.image_width,
  image_height=excluded.image_height,
  text_content=excluded.text_content,
  words=excluded.words,
  avg_confidence=excluded.avg_confidence,
  word_count=excluded.word_count,
  checksum=excluded.checksum,
  updated_at=now();
"""
    query(sql, False)
    return len(words), avg_confidence, width, height, checksum


def main():
    target = get_target()
    if not target:
        print("No current/upcoming 12-page JIP MO import needs GitHub OCR.")
        return 0
    import_id = str(target["import_id"])
    missing = target.get("missing_pages") or []
    print(json.dumps({
        "import_id": import_id,
        "valid_from": target.get("valid_from"),
        "valid_to": target.get("valid_to"),
        "engine": ENGINE,
        "missing_pages": len(missing),
    }, ensure_ascii=False))
    with tempfile.TemporaryDirectory(prefix="jip-ocr-") as tmp:
        root = Path(tmp)
        for entry in missing:
            page = int(entry["page"])
            url = str(entry["url"])
            image_path = root / f"page-{page}.jpg"
            image_bytes = download(url, image_path)
            count, avg, width, height, checksum = upsert_page(import_id, page, url, image_path, image_bytes)
            print(f"page={page} words={count} avg={avg:.3f} size={width}x{height} sha256={checksum[:12]}")
    completion_sql = f"select public.refresh_leaflet_ocr_completion({sql_literal(import_id)}::uuid) as completion;"
    print(json.dumps(query(completion_sql, False), ensure_ascii=False))
    verify_sql = f"""
select count(distinct page_number) as pages,
       min(word_count) as min_words,
       round(avg(avg_confidence),3) as avg_confidence
from public.leaflet_ocr_pages
where import_id={sql_literal(import_id)}::uuid and engine={sql_literal(ENGINE)} and word_count>0;
"""
    print(json.dumps(query(verify_sql, True), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
