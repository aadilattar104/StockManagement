import re
import difflib
import os
from typing import Optional

MATCH_THRESHOLD = int(os.getenv("MATCH_THRESHOLD", "40"))

NOISE_WORDS = {
    "i", "the", "svasthyaa", "khakhra", "gms", "high", "protein",
    "fiber", "fibre", "mix", "wheat", "millet", "worlds", "world",
    "best", "khapli", "and", "or", "by", "of", "a", "an"
}


def normalize_text(text: str) -> str:
    if not text:
        return ""
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    tokens = [t for t in text.split() if t not in NOISE_WORDS]
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


def Optional_float(x):
    return x  # placeholder typing trick for the above


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

        # gramage filter
        if product_grams is not None:
            stock_grams = extract_grams(str(row.get("weight", "")))
            if stock_grams is not None:
                if abs(product_grams - stock_grams) > 15:
                    continue  # skip gramage mismatch

        if score > best_score:
            best_score = score
            best_id = row["id"]

    if best_score >= MATCH_THRESHOLD:
        return best_id, best_score
    return None, 0.0


def fuzzy_vendor_match(vendor_name: str, so_list: list, threshold: int = 70) -> list:
    """
    Returns list of SO dicts from so_list where vendor fuzzy-matches.
    so_list: list of dicts with vendor_name key.
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
