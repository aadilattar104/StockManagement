import re
import difflib
import os
from typing import Optional

MATCH_THRESHOLD = int(os.getenv("MATCH_THRESHOLD", "40"))

# Only true stop words — brand/product words kept for matching
NOISE_WORDS = {
    # Pure stop words — no semantic value
    "i", "the", "by", "of", "a", "an", "or",
    # Brand noise
    "svasthyaa",
    # Unit noise
    "gms", "gm",
}

# Synonym map — normalise alternate spellings to a canonical form
SYNONYMS = {
    "fiber"  : "fibre",   # High Fiber → High Fibre
    "world"  : "worlds",  # World's → Worlds
    "chana"  : "chana",
    "jor"    : "jor",
    "moong"  : "moong",
    "millet" : "millet",
    "khakhra": "khakhra",
    "khakra" : "khakhra",
    "protein": "protein",
    "high"   : "high",
    "mix"    : "mix",
    "wheat"  : "wheat",
    "khapli" : "khapli",
}


def normalize_text(text: str) -> str:
    if not text:
        return ""
    text = text.lower()
    # Replace separators (|, -, /) with space
    text = re.sub(r"[|/\\-]", " ", text)
    # Remove remaining non-alphanumeric except space
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    tokens = []
    for t in text.split():
        if t in NOISE_WORDS:
            continue
        # Apply synonym normalisation
        t = SYNONYMS.get(t, t)
        tokens.append(t)
    return " ".join(tokens)


def extract_grams(text: str) -> Optional[float]:
    """Extract numeric gram value from a weight/gramage string."""
    if not text:
        return None
    # handle multi-value like "185g\n190g" → take first
    text = text.split("\n")[0].strip()
    m = re.search(r"(\d+(?:\.\d+)?)\s*g(?:ms?)?", text.lower())
    if m:
        return float(m.group(1))
    # handle plain number (column stored as float like 45.0)
    m = re.search(r"^(\d+(?:\.\d+)?)$", text.strip())
    if m:
        return float(m.group(1))
    return None


def jaccard_score(a: str, b: str) -> float:
    tokens_a = set(a.split())
    tokens_b = set(b.split())
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)


def sequence_ratio(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def match_score(name_a: str, name_b: str) -> float:
    na = normalize_text(name_a)
    nb = normalize_text(name_b)
    j = jaccard_score(na, nb)
    s = sequence_ratio(na, nb)
    return max(j, s) * 100


def find_best_stock_match(product_name: str, gramage: str, stock_rows: list) -> tuple:
    """
    Returns (matched_stock_id, score) or (None, 0).
    stock_rows: list of dicts with keys id, title, weight
    """
    product_grams = extract_grams(gramage) if gramage else None

    best_id = None
    best_score = 0.0

    for row in stock_rows:
        score = match_score(product_name, row.get("title", ""))

        # gramage filter — strict ±4g when both sides have a gramage
        if product_grams is not None:
            stock_grams = extract_grams(str(row.get("weight", "")))
            if stock_grams is not None:
                if abs(product_grams - stock_grams) > 4:
                    continue  # skip gramage mismatch

        if score > best_score:
            best_score = score
            best_id = row["id"]

    if best_score >= MATCH_THRESHOLD:
        return best_id, best_score
    return None, 0.0


def find_best_so_line_match(invoice_line: dict, so_lines: list) -> Optional[dict]:
    """
    Match an invoice line to the best SO line using both product name AND gramage.
    """
    inv_name = invoice_line.get("product_name", "")
    inv_grams = extract_grams(str(invoice_line.get("gramage", "") or ""))

    best_line = None
    best_score = 0.0

    for sol in so_lines:
        text_score = match_score(inv_name, sol.get("product_name", ""))
        if text_score < MATCH_THRESHOLD:
            continue

        # Gramage check — strict ±4g when both sides have gramage
        if inv_grams is not None:
            sol_grams = extract_grams(str(sol.get("gramage", "") or ""))
            if sol_grams is not None and abs(inv_grams - sol_grams) > 4:
                continue  # gramage mismatch — skip

        if text_score > best_score:
            best_score = text_score
            best_line = sol

    return best_line


def fuzzy_vendor_match(vendor_name: str, so_list: list, threshold: float = 70.0) -> list:
    """
    Returns list of SO dicts from so_list where vendor fuzzy-matches.
    """
    matched = []
    for so in so_list:
        score = sequence_ratio(
            vendor_name.lower().strip(),
            (so.get("vendor_name") or "").lower().strip()
        ) * 100
        if score >= threshold:
            matched.append(so)
    return matched


# ── Quick sanity test ────────────────────────────────────────
if __name__ == "__main__":
    tests = [
        ("Worlds Best Chana Jor | Svasthyaa |", "Worlds Best Chana Jor",   "35gms", "35 g"),
        ("World's Best Chana Jor I Svasthyaa",  "Worlds Best Chana Jor",   "72 gms","72 g"),
        ("High Fibre Millet Mix | Svasthyaa",   "High Fibre Millet Mix",   "35 gms","35 g"),
        ("High Fiber Millet Mix I Svasthyaa",   "High Fibre Millet Mix",   "72 gms","72 g"),
    ]
    print(f"{'Product Name':<45} {'Stock Title':<30} Score")
    print("-" * 90)
    for pname, stitle, pgram, sgram in tests:
        score = match_score(pname, stitle)
        pg    = extract_grams(pgram)
        sg    = extract_grams(sgram)
        gram_ok = abs(pg - sg) <= 4 if pg and sg else "N/A"
        print(f"{pname:<45} {stitle:<30} {score:.1f}  gram_ok={gram_ok}")