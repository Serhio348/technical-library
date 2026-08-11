#!/usr/bin/env python3
"""Extract tables from digital PDFs as Markdown (pdfplumber).

Stdout: JSON { "tables": [ { "page": 1, "markdown": "| ... |" }, ... ], "count": N }
Exit 0 even when no tables — empty list. Exit 2 on usage error.
"""

from __future__ import annotations

import json
import sys
from typing import Any


def cell_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\n", " ").replace("|", "\\|").strip()
    return text


def table_to_markdown(rows: list[list[Any]]) -> str | None:
    cleaned: list[list[str]] = []
    for row in rows:
        if row is None:
            continue
        cells = [cell_text(c) for c in row]
        if any(cells):
            cleaned.append(cells)
    if len(cleaned) < 2:
        return None

    width = max(len(r) for r in cleaned)
    if width < 2:
        return None

    normalized = [r + [""] * (width - len(r)) for r in cleaned]
    header = normalized[0]
    body = normalized[1:]
    # If first row looks like data (all numeric-ish), synthesize header
    if body and all(h == "" or h.replace(".", "", 1).isdigit() for h in header):
        header = [f"Кол.{i + 1}" for i in range(width)]
        body = normalized

    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def extract_tables(pdf_path: str, max_pages: int = 0) -> dict[str, Any]:
    import pdfplumber

    tables_out: list[dict[str, Any]] = []
    with pdfplumber.open(pdf_path) as pdf:
        pages = pdf.pages
        if max_pages > 0:
            pages = pages[:max_pages]
        for page in pages:
            page_no = page.page_number
            try:
                found = page.extract_tables() or []
            except Exception:
                found = []
            for raw in found:
                md = table_to_markdown(raw)
                if md:
                    tables_out.append({"page": page_no, "markdown": md})
    return {"tables": tables_out, "count": len(tables_out)}


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: extract_pdf_tables.py <file.pdf> [max_pages]", file=sys.stderr)
        return 2
    pdf_path = sys.argv[1]
    max_pages = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    try:
        result = extract_tables(pdf_path, max_pages=max_pages)
    except Exception as exc:  # noqa: BLE001 — report to Node as empty + stderr
        print(json.dumps({"tables": [], "count": 0, "error": str(exc)}))
        print(f"extract_pdf_tables failed: {exc}", file=sys.stderr)
        return 0
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
