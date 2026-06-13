import re
import openpyxl
from typing import List, Dict


def parse_weight(raw) -> List[str]:
    """Normalise weight cell — may contain newline-separated values."""
    if raw is None:
        return [None]
    s = str(raw).strip()
    parts = [p.strip() for p in re.split(r"\n|/", s) if p.strip()]
    if not parts:
        return [None]
    return parts


def parse_qty(raw) -> List[int]:
    """Normalise qty cell — may contain newline-separated values to sum."""
    if raw is None:
        return [0]
    s = str(raw).strip()
    # e.g. "1140\n674" → sum
    parts = re.split(r"\n", s)
    try:
        values = [int(float(p.strip())) for p in parts if p.strip()]
        return [sum(values)]
    except ValueError:
        return [0]


def load_stock_from_xlsx(filepath: str) -> List[Dict]:
    """
    Parse warehouse XLSX. Returns list of dicts ready for DB upsert.
    Handles multi-value weight / qty cells.
    """
    wb = openpyxl.load_workbook(filepath)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []

    # Skip header row
    data_rows = rows[1:]
    results = []

    for row in data_rows:
        if not row or row[0] is None:
            continue

        title = str(row[0]).strip()
        raw_weight = row[1] if len(row) > 1 else None
        raw_qty = row[2] if len(row) > 2 else None

        weights = parse_weight(raw_weight)
        qtys = parse_qty(raw_qty)

        # If weight has multiple entries (newline), create separate rows
        # qty is summed already
        qty = qtys[0] if qtys else 0

        if len(weights) > 1:
            # Multiple weight variants split into separate SKUs
            for w in weights:
                results.append({
                    "title": title,
                    "weight": w,
                    "stock_qty": qty // len(weights) if qty else 0
                })
        else:
            results.append({
                "title": title,
                "weight": weights[0],
                "stock_qty": qty
            })

    return results
