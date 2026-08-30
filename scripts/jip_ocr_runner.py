#!/usr/bin/env python3
import json
import subprocess
import sys

import jip_ocr_sync as sync


def curl_query(sql: str, read_only: bool = False):
    payload = json.dumps({"query": sql, "read_only": read_only})
    result = subprocess.run(
        [
            "curl",
            "--silent",
            "--show-error",
            "--fail-with-body",
            "--max-time",
            "90",
            "--request",
            "POST",
            "--url",
            sync.API,
            "--header",
            f"Authorization: Bearer {sync.ACCESS_TOKEN}",
            "--header",
            "Content-Type: application/json",
            "--header",
            "User-Agent: Slevao-GitHub-Actions/1.0",
            "--data-binary",
            payload,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Supabase database/query curl failed ({result.returncode}): "
            f"{result.stderr.strip()} {result.stdout[:1200]}"
        )
    return json.loads(result.stdout or "[]")


sync.query = curl_query
sys.exit(sync.main())
