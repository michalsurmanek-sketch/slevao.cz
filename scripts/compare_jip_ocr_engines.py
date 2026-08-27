#!/usr/bin/env python3
"""Compare JIP OCR v2 production candidates with staged v3 candidates.

This script is deliberately read-only: it never publishes anything. It identifies
strong cross-engine agreement and catches a dangerous OCR failure mode where a
unit price (for example 100 g = 15,31) loses its marker and is mistaken for the
main product price.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


TOKEN_STOP = {
    "a", "i", "j", "s", "v", "z", "x",
    "mix", "set", "ks", "g", "kg", "ml", "l",
}


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def fold(value: Any) -> str:
    text = unicodedata.normalize("NFD", clean(value).lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9%]+", " ", text).strip()


def title_tokens(value: Any) -> set[str]:
    return {
        token
        for token in fold(value).split()
        if len(token) >= 2 and token not in TOKEN_STOP and not token.isdigit()
    }


def parse_quantity(value: Any) -> tuple[float, str] | None:
    q = fold(value).replace(",", ".")
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(g|kg|ml|l|ks)", q)
    if not m:
        return None
    amount = float(m.group(1))
    if not math.isfinite(amount) or amount <= 0:
        return None
    return amount, m.group(2)


def quantity_key(value: Any) -> str:
    parsed = parse_quantity(value)
    if not parsed:
        return fold(value)
    amount, unit = parsed
    if amount.is_integer():
        amount_text = str(int(amount))
    else:
        amount_text = (f"{amount:.6f}").rstrip("0").rstrip(".")
    return f"{amount_text}{unit}"


def title_similarity(a: Any, b: Any) -> dict[str, Any]:
    fa, fb = fold(a), fold(b)
    ta, tb = title_tokens(a), title_tokens(b)
    overlap = ta & tb
    union = ta | tb
    containment = len(overlap) / max(1, min(len(ta), len(tb)))
    jaccard = len(overlap) / max(1, len(union))
    sequence = SequenceMatcher(None, fa, fb).ratio() if fa and fb else 0.0
    strong = (
        fa == fb
        or (len(overlap) >= 2 and containment >= 0.5)
        or (len(overlap) >= 1 and containment >= 0.75 and sequence >= 0.62)
        or sequence >= 0.78
    )
    return {
        "strong": strong,
        "overlap": sorted(overlap),
        "containment": round(containment, 3),
        "jaccard": round(jaccard, 3),
        "sequence": round(sequence, 3),
    }


def price_close(a: float, b: float) -> bool:
    return abs(a - b) <= max(0.02, min(abs(a), abs(b)) * 0.001)


def unit_price_from_main(main_price: float, quantity: Any) -> tuple[float, str] | None:
    parsed = parse_quantity(quantity)
    if not parsed:
        return None
    amount, unit = parsed
    if unit in {"g", "ml"}:
        return round(main_price / amount * 100, 2), f"100 {unit}"
    if unit in {"kg", "l"} and abs(amount - 1.0) > 1e-9:
        return round(main_price / amount, 2), f"1 {unit}"
    return None


def candidate_price(candidate: dict[str, Any]) -> float | None:
    try:
        value = float(candidate.get("price"))
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def pair_score(v2: dict[str, Any], v3: dict[str, Any]) -> tuple[float, dict[str, Any]] | None:
    if quantity_key(v2.get("quantity")) != quantity_key(v3.get("quantity")):
        return None
    sim = title_similarity(v2.get("title"), v3.get("title"))
    if not sim["strong"]:
        return None
    page_bonus = 0.15 if v2.get("page") == v3.get("page") else 0.0
    score = sim["containment"] * 1.5 + sim["sequence"] + sim["jaccard"] * 0.5 + page_bonus
    return score, sim


def compare(v2_doc: dict[str, Any], v3_doc: dict[str, Any]) -> dict[str, Any]:
    v2 = list(v2_doc.get("candidates") or [])
    v3 = list(v3_doc.get("candidates") or [])

    used_v3: set[int] = set()
    pairs: list[dict[str, Any]] = []
    exact_consensus: list[dict[str, Any]] = []
    unit_price_shadows: list[dict[str, Any]] = []
    price_conflicts: list[dict[str, Any]] = []

    for left in v2:
        best: tuple[float, int, dict[str, Any]] | None = None
        for index, right in enumerate(v3):
            if index in used_v3:
                continue
            scored = pair_score(left, right)
            if not scored:
                continue
            score, sim = scored
            if best is None or score > best[0]:
                best = (score, index, sim)
        if best is None:
            continue

        score, index, sim = best
        right = v3[index]
        used_v3.add(index)
        p2, p3 = candidate_price(left), candidate_price(right)
        classification = "matched_title_quantity"
        unit_expected = None
        unit_basis = None

        if p2 is not None and p3 is not None and price_close(p2, p3):
            classification = "exact_price_consensus"
        elif p2 is not None and p3 is not None:
            unit = unit_price_from_main(p2, left.get("quantity"))
            if unit and price_close(unit[0], p3):
                classification = "v3_unit_price_shadow"
                unit_expected, unit_basis = unit
            else:
                classification = "price_conflict"

        item = {
            "classification": classification,
            "match_score": round(score, 3),
            "similarity": sim,
            "v2": {
                "title": left.get("title"),
                "price": p2,
                "quantity": left.get("quantity"),
                "page": left.get("page"),
            },
            "v3": {
                "title": right.get("title"),
                "price": p3,
                "quantity": right.get("quantity"),
                "page": right.get("page"),
                "price_line": (right.get("raw") or {}).get("price_line"),
            },
        }
        if unit_expected is not None:
            item["unit_price_expected"] = unit_expected
            item["unit_price_basis"] = unit_basis

        pairs.append(item)
        if classification == "exact_price_consensus":
            exact_consensus.append(item)
        elif classification == "v3_unit_price_shadow":
            unit_price_shadows.append(item)
        elif classification == "price_conflict":
            price_conflicts.append(item)

    v3_only = []
    for index, candidate in enumerate(v3):
        if index in used_v3:
            continue
        v3_only.append({
            "title": candidate.get("title"),
            "price": candidate_price(candidate),
            "quantity": candidate.get("quantity"),
            "page": candidate.get("page"),
            "price_line": (candidate.get("raw") or {}).get("price_line"),
            "conf": candidate.get("conf"),
        })

    safe_incremental = []
    # New v3-only rows are intentionally NOT considered safe merely because OCR
    # confidence is high. They need an independent source/engine confirmation.

    return {
        "ok": True,
        "production_engine": v2_doc.get("engine"),
        "staged_engine": v3_doc.get("engine"),
        "v2_safe_count": len(v2),
        "v3_parsed_count": len(v3),
        "matched_count": len(pairs),
        "exact_consensus_count": len(exact_consensus),
        "unit_price_shadow_count": len(unit_price_shadows),
        "price_conflict_count": len(price_conflicts),
        "v3_only_count": len(v3_only),
        "safe_incremental_count": len(safe_incremental),
        "recommendation": "keep_v2" if unit_price_shadows or price_conflicts or not safe_incremental else "review_incremental",
        "pairs": pairs,
        "unit_price_shadows": unit_price_shadows,
        "price_conflicts": price_conflicts,
        "v3_only": v3_only,
        "safe_incremental": safe_incremental,
    }


def load(path: str) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict) or not value.get("ok"):
        raise ValueError(f"Invalid comparison input: {path}")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--v2", required=True)
    parser.add_argument("--v3", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()

    try:
        report = compare(load(args.v2), load(args.v3))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    sys.exit(main())
