#!/usr/bin/env python3
"""Strict, read-only verifier for JIP staged OCR candidates.

A v3-only candidate is never trusted by OCR confidence alone. The verifier first
maps its price position into production OCR v2 and rejects matching unit-price
expressions (100 g/ml or 1 kg/l). Only unresolved candidates are checked against
a fresh high-resolution render of the official PDF. A price is accepted only
after a strong multi-preprocessing / multi-PSM vote.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageOps

PRODUCTION_ENGINE = "tesseract-cli-ces-jip-v2"
STAGED_ENGINE = "tesseract-cli-ces-jip-v3-pdf1800"
RENDER_WIDTH = 3200
PRICE_RE = re.compile(r"(?<!\d)(\d{1,4})[,.](\d{2})(?!\d)")


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def decimal_values(value: Any) -> list[float]:
    out: list[float] = []
    for major, minor in PRICE_RE.findall(clean(value)):
        price = int(major) + int(minor) / 100
        if 2 <= price <= 5000:
            out.append(round(price, 2))
    return out


def price_close(a: float, b: float) -> bool:
    return abs(a - b) <= max(0.02, min(abs(a), abs(b)) * 0.001)


def load_json(path: str) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict) or not value.get("ok"):
        raise ValueError(f"Invalid JSON input: {path}")
    return value


def api_get(url: str, key: str) -> Any:
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {key}", "apikey": key, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)


def get_ocr_page(base: str, key: str, import_id: str, engine: str, page: int) -> dict[str, Any]:
    query = urllib.parse.urlencode({
        "select": "page_number,image_width,image_height,words,engine",
        "import_id": f"eq.{import_id}",
        "engine": f"eq.{engine}",
        "page_number": f"eq.{page}",
        "limit": "1",
    })
    rows = api_get(f"{base.rstrip('/')}/rest/v1/leaflet_ocr_pages?{query}", key)
    if not isinstance(rows, list) or len(rows) != 1:
        raise RuntimeError(f"Expected one OCR page for {engine} page {page}")
    row = rows[0]
    if not row.get("image_width") or not row.get("image_height") or not isinstance(row.get("words"), list):
        raise RuntimeError(f"Incomplete OCR page metadata for {engine} page {page}")
    return row


def candidate_key(candidate: dict[str, Any]) -> tuple[Any, ...]:
    try:
        price = round(float(candidate.get("price")), 2)
    except (TypeError, ValueError):
        price = None
    return (
        int(candidate.get("page") or 0),
        clean(candidate.get("title")).lower(),
        clean(candidate.get("quantity")).lower(),
        price,
    )


def original_v3_candidate(v3_doc: dict[str, Any], summarized: dict[str, Any]) -> dict[str, Any]:
    target = candidate_key(summarized)
    for candidate in v3_doc.get("candidates") or []:
        if candidate_key(candidate) == target:
            return candidate
    raise RuntimeError(f"Cannot resolve v3 candidate evidence: {target}")


def normalized_box(candidate: dict[str, Any], page: dict[str, Any]) -> tuple[float, float, float, float]:
    coords = (((candidate.get("raw") or {}).get("coords") or {}).get("p"))
    if not isinstance(coords, list) or len(coords) != 4:
        raise RuntimeError(f"Missing price coordinates for {candidate.get('title')}")
    left, top, right, bottom = [float(x) for x in coords]
    width, height = float(page["image_width"]), float(page["image_height"])
    if width <= 0 or height <= 0 or right <= left or bottom <= top:
        raise RuntimeError(f"Invalid price coordinates for {candidate.get('title')}: {coords}")
    return left / width, top / height, right / width, bottom / height


def word_center(word: dict[str, Any], page: dict[str, Any]) -> tuple[float, float]:
    width, height = float(page["image_width"]), float(page["image_height"])
    return (
        (float(word.get("left") or 0) + float(word.get("width") or 0) / 2) / width,
        (float(word.get("top") or 0) + float(word.get("height") or 0) / 2) / height,
    )


def detect_cross_engine_unit_price(candidate: dict[str, Any], v3_page: dict[str, Any], v2_page: dict[str, Any]) -> dict[str, Any] | None:
    try:
        target_price = round(float(candidate.get("price")), 2)
    except (TypeError, ValueError):
        return None
    nl, nt, nr, nb = normalized_box(candidate, v3_page)
    tx, ty = (nl + nr) / 2, (nt + nb) / 2

    for price_word in v2_page.get("words") or []:
        if not any(price_close(v, target_price) for v in decimal_values(price_word.get("text"))):
            continue
        px, py = word_center(price_word, v2_page)
        if abs(px - tx) > 0.10 or abs(py - ty) > 0.055:
            continue
        nearby: list[tuple[float, dict[str, Any]]] = []
        for word in v2_page.get("words") or []:
            wx, wy = word_center(word, v2_page)
            if abs(wy - py) <= 0.022 and abs(wx - px) <= 0.10:
                nearby.append((wx, word))
        nearby.sort(key=lambda item: item[0])
        tokens = [clean(word.get("text")) for _, word in nearby if clean(word.get("text"))]
        folded = re.sub(r"\s+", " ", " ".join(tokens).lower().replace("q", "g"))
        has_equal = "=" in folded
        has_100 = bool(re.search(r"(?:^|\s)100(?:\s|$)", folded))
        has_small = bool(re.search(r"(?:^|\s)(?:g|ml)(?:\s|$)", folded))
        has_one = bool(re.search(r"(?:^|\s)1(?:\s|$)", folded))
        has_large = bool(re.search(r"(?:^|\s)(?:kg|l)(?:\s|$)", folded))
        if has_equal and ((has_100 and has_small) or (has_one and has_large)):
            return {
                "classification": "cross_engine_unit_price_marker",
                "engine": PRODUCTION_ENGINE,
                "target_price": target_price,
                "tokens": tokens,
                "normalized_target_center": [round(tx, 5), round(ty, 5)],
            }
    return None


def source_pdf_url(v2_doc: dict[str, Any]) -> str:
    source = clean(v2_doc.get("source_document_url")).rstrip("/")
    if not re.fullmatch(r"https://www\.jip-potraviny\.cz/wp-content/uploads/file/MO-\d{1,2}-\d{1,2}-\d{4}", source, re.I):
        raise RuntimeError(f"Unexpected JIP source URL: {source}")
    return source + "/files/downloads/MO.pdf"


def download_pdf(url: str, path: Path) -> None:
    subprocess.run([
        "curl", "--fail-with-body", "--silent", "--show-error", "--location",
        "--retry", "4", "--retry-all-errors", "--retry-delay", "2",
        "--connect-timeout", "20", "--max-time", "180",
        "-A", "slevao-jip-staged-verifier/1.1", url, "-o", str(path),
    ], check=True, timeout=200)
    if not path.exists() or path.stat().st_size < 100_000:
        raise RuntimeError(f"Downloaded JIP PDF is unexpectedly small: {path.stat().st_size if path.exists() else 0}")


def render_page(pdf: Path, page: int, output_base: Path) -> Path:
    subprocess.run([
        "pdftoppm", "-jpeg", "-f", str(page), "-l", str(page), "-singlefile",
        "-scale-to-x", str(RENDER_WIDTH), "-scale-to-y", "-1", str(pdf), str(output_base),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
    rendered = Path(str(output_base) + ".jpg")
    if not rendered.exists():
        raise RuntimeError(f"PDF render missing for page {page}")
    return rendered


def price_crop(image: Image.Image, box_norm: tuple[float, float, float, float]) -> Image.Image:
    nl, nt, nr, nb = box_norm
    left, top, right, bottom = nl * image.width, nt * image.height, nr * image.width, nb * image.height
    bw, bh = right - left, bottom - top
    mx, my = max(90, bw * 0.35), max(45, bh * 0.40)
    return image.crop((
        max(0, int(left - mx)), max(0, int(top - my)),
        min(image.width, int(right + mx)), min(image.height, int(bottom + my)),
    ))


def context_crop(image: Image.Image, box_norm: tuple[float, float, float, float]) -> Image.Image:
    nl, nt, nr, nb = box_norm
    left, top, right, bottom = nl * image.width, nt * image.height, nr * image.width, nb * image.height
    return image.crop((
        max(0, int(left - 430)), max(0, int(top - 150)),
        min(image.width, int(right + 250)), min(image.height, int(bottom + 160)),
    ))


def tesseract_text(path: Path, psm: int, whitelist: bool) -> str:
    cmd = ["tesseract", str(path), "stdout", "-l", "eng" if whitelist else "ces+eng", "--psm", str(psm)]
    if whitelist:
        cmd += ["-c", "tessedit_char_whitelist=0123456789,."]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=45)
    return clean(result.stdout)


def vote_price(crop: Image.Image, workdir: Path, stem: str) -> dict[str, Any]:
    gray = crop.convert("L")
    variants = {
        "gray": gray,
        "contrast": ImageEnhance.Contrast(gray).enhance(1.8),
        "bw": ImageOps.autocontrast(gray).point(lambda p: 255 if p > 165 else 0),
    }
    votes: Counter[float] = Counter()
    support: dict[float, set[str]] = defaultdict(set)
    readings: list[dict[str, Any]] = []
    for variant, image in variants.items():
        path = workdir / f"{stem}-{variant}.png"
        image.save(path)
        for psm in (7, 8, 13):
            raw = tesseract_text(path, psm, True)
            values = decimal_values(raw)
            readings.append({"variant": variant, "psm": psm, "raw": raw, "values": values})
            for value in set(values):
                votes[value] += 1
                support[value].add(variant)
    ranked = votes.most_common()
    winner = ranked[0] if ranked else None
    runner_up = ranked[1][1] if len(ranked) > 1 else 0
    accepted = bool(winner and winner[1] >= 5 and len(support[winner[0]]) >= 2 and runner_up <= 1)
    return {
        "accepted": accepted,
        "winner": [winner[0], winner[1]] if winner else None,
        "runner_up_votes": runner_up,
        "variant_support": {f"{price:.2f}": sorted(values) for price, values in support.items()},
        "readings": readings,
    }


def local_unit_marker(texts: list[str], price: float) -> dict[str, Any] | None:
    joined = re.sub(r"\s+", " ", " | ".join(texts).lower().replace("q", "g"))
    price_forms = (f"{price:.2f}".replace(".", ","), f"{price:.2f}")
    if not any(form in joined for form in price_forms):
        return None
    if re.search(r"100\s*(?:g|ml)\s*=", joined) or re.search(r"1\s*(?:kg|l)\s*=", joined):
        return {"classification": "highres_unit_price_marker", "texts": texts}
    return None


def verify_highres(candidate: dict[str, Any], v3_page: dict[str, Any], rendered: Path, workdir: Path) -> dict[str, Any]:
    base = {
        "title": candidate.get("title"), "staged_price": candidate.get("price"),
        "quantity": candidate.get("quantity"), "page": candidate.get("page"),
        "conf": candidate.get("conf"), "price_line": (candidate.get("raw") or {}).get("price_line"),
    }
    box_norm = normalized_box(candidate, v3_page)
    with Image.open(rendered) as page_image:
        vote = vote_price(price_crop(page_image, box_norm), workdir, f"price-{candidate.get('page')}-{abs(hash(candidate_key(candidate))) % 10**8}")
        if not vote.get("accepted") or not vote.get("winner"):
            return {**base, "verified": False, "reason": "no_strong_price_vote", "price_vote": vote}
        winner_price = round(float(vote["winner"][0]), 2)
        context = context_crop(page_image, box_norm).convert("L")
    context_path = workdir / f"context-{abs(hash(candidate_key(candidate))) % 10**8}.png"
    context.save(context_path)
    texts = [tesseract_text(context_path, psm, False) for psm in (6, 11)]
    unit = local_unit_marker(texts, winner_price)
    if unit:
        return {**base, "verified": False, "reason": "unit_price", "price_vote": vote, "evidence": unit}
    conf = candidate.get("conf") or {}
    if float(conf.get("title") or 0) < 80 or float(conf.get("qty") or 0) < 65:
        return {**base, "verified": False, "reason": "weak_title_or_quantity", "price_vote": vote}
    return {
        **base, "verified": True, "verified_price": winner_price,
        "verification": "targeted-highres-multivote-v1", "price_vote": vote,
        "context_texts": texts, "normalized_price_box": [round(x, 6) for x in box_norm],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--v2", required=True)
    parser.add_argument("--v3", required=True)
    parser.add_argument("--consensus", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        v2_doc, v3_doc, consensus = load_json(args.v2), load_json(args.v3), load_json(args.consensus)
        base, key = os.environ.get("SUPABASE_URL", "").strip(), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not base or not key:
            raise RuntimeError("Missing Supabase environment")
        import_id = clean(v2_doc.get("source_import_id") or v3_doc.get("import_id"))
        if not import_id or v3_doc.get("engine") != STAGED_ENGINE:
            raise RuntimeError("Unexpected staged OCR input")

        candidates = [original_v3_candidate(v3_doc, row) for row in consensus.get("v3_only") or []]
        report: dict[str, Any] = {
            "ok": True, "source_import_id": import_id,
            "production_engine": PRODUCTION_ENGINE, "staged_engine": STAGED_ENGINE,
            "candidate_count": len(candidates), "verified": [], "rejected": [],
        }
        cache: dict[tuple[str, int], dict[str, Any]] = {}
        unresolved: list[tuple[dict[str, Any], dict[str, Any]]] = []

        for candidate in candidates:
            page = int(candidate.get("page") or 0)
            if page < 1 or page > 12:
                raise RuntimeError(f"Invalid JIP page {page}")
            for engine in (STAGED_ENGINE, PRODUCTION_ENGINE):
                cache.setdefault((engine, page), get_ocr_page(base, key, import_id, engine, page))
            v3_page, v2_page = cache[(STAGED_ENGINE, page)], cache[(PRODUCTION_ENGINE, page)]
            unit = detect_cross_engine_unit_price(candidate, v3_page, v2_page)
            if unit:
                report["rejected"].append({
                    "title": candidate.get("title"), "staged_price": candidate.get("price"),
                    "quantity": candidate.get("quantity"), "page": page,
                    "verified": False, "reason": "unit_price", "evidence": unit,
                })
            else:
                unresolved.append((candidate, v3_page))

        if unresolved:
            with tempfile.TemporaryDirectory(prefix="jip-staged-verify-") as temp:
                workdir = Path(temp)
                pdf = workdir / "MO.pdf"
                download_pdf(source_pdf_url(v2_doc), pdf)
                rendered_pages: dict[int, Path] = {}
                for candidate, v3_page in unresolved:
                    page = int(candidate.get("page") or 0)
                    if page not in rendered_pages:
                        rendered_pages[page] = render_page(pdf, page, workdir / f"page-{page}-3200")
                    result = verify_highres(candidate, v3_page, rendered_pages[page], workdir)
                    (report["verified"] if result.get("verified") else report["rejected"]).append(result)

        report["verified_count"] = len(report["verified"])
        report["rejected_count"] = len(report["rejected"])
        report["safe_incremental_candidates"] = [
            {
                "title": row["title"], "price": row["verified_price"], "quantity": row["quantity"], "page": row["page"],
                "verification": row["verification"],
                "evidence": {
                    "staged_price": row["staged_price"], "price_vote": row["price_vote"],
                    "normalized_price_box": row["normalized_price_box"], "context_texts": row["context_texts"],
                },
            }
            for row in report["verified"]
        ]
        rendered = json.dumps(report, ensure_ascii=False, indent=2)
        if args.output:
            Path(args.output).write_text(rendered + "\n", encoding="utf-8")
        print(rendered)
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
