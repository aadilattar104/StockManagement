import re
import pdfplumber
from typing import Dict, List, Optional


def extract_so_pdf(filepath: str) -> Dict:
    """
    Extract Sales Order data from PDF.
    Returns dict with so_number, so_date, vendor_name, line_items.
    """
    with pdfplumber.open(filepath) as pdf:
        full_text = ""
        all_tables = []
        for page in pdf.pages:
            text = page.extract_text() or ""
            full_text += text + "\n"
            tables = page.extract_tables()
            all_tables.extend(tables)

    result = {
        "so_number": None,
        "so_date": None,
        "vendor_name": None,
        "total_qty": 0,
        "total_amount": 0.0,
        "line_items": []
    }

    # --- Extract SO number (top-right of page) ---
    so_match = re.search(r"(BSC-SO-[\w-]+)", full_text)
    if so_match:
        result["so_number"] = so_match.group(1).strip()

    # --- Extract date ---
    # Format: dd/mm/yyyy at top
    date_match = re.search(
        r"(BSC-SO-[\w-]+)\s+(\d{2}/\d{2}/\d{4})", full_text
    )
    if date_match:
        result["so_date"] = _convert_date(date_match.group(2))

    # --- Extract vendor name from "Bill To" block ---
    bill_to_match = re.search(
        r"Bill To\s+SALES ORDER\s+(.+?)(?:\n|FSSAI|Phone)", full_text, re.DOTALL
    )
    if bill_to_match:
        candidate = bill_to_match.group(1).strip().split("\n")[0].strip()
        if candidate:
            result["vendor_name"] = candidate

    # --- Extract line items from the items table ---
    line_items = _parse_so_line_items(all_tables, full_text)
    result["line_items"] = line_items
    result["total_qty"] = sum(li.get("qty_ordered", 0) for li in line_items)
    result["total_amount"] = sum(li.get("amount", 0) or 0 for li in line_items)

    return result


def extract_invoice_pdf(filepath: str) -> Dict:
    """
    Extract Tax Invoice data from PDF.
    Returns dict with invoice_number, invoice_date, vendor_name, so_reference, line_items.
    """
    with pdfplumber.open(filepath) as pdf:
        full_text = ""
        all_tables = []
        for page in pdf.pages:
            text = page.extract_text() or ""
            full_text += text + "\n"
            tables = page.extract_tables()
            all_tables.extend(tables)

    result = {
        "invoice_number": None,
        "invoice_date": None,
        "vendor_name": None,
        "so_reference": None,
        "total_qty": 0,
        "total_amount": 0.0,
        "line_items": []
    }

    # --- Invoice number ---
    inv_match = re.search(r"Invoice No\s*:\s*([\w/\-]+)", full_text)
    if inv_match:
        result["invoice_number"] = inv_match.group(1).strip()

    # --- Invoice date ---
    date_match = re.search(r"Invoice Date\s*:\s*(\d{2}/\d{2}/\d{4})", full_text)
    if date_match:
        result["invoice_date"] = _convert_date(date_match.group(1))

    # --- Vendor name (Bill To / Consignee block) ---
    # Strategy 1: look for explicit "Bill To" label
    DATE_RE = re.compile(r"^\s*(?:Invoice\s+Date|Date)\s*[:\-]", re.IGNORECASE)
    vendor_found = False

    bill_to_match = re.search(
        r"(?:Bill To|Consignee|Buyer)\s*[:\n]\s*(.+?)(?:\n(?:GSTIN|FSSAI|Phone|Address|State|Place)|$)",
        full_text, re.DOTALL | re.IGNORECASE
    )
    if bill_to_match:
        # Take first non-empty, non-date line from the matched block
        for line in bill_to_match.group(1).split("\n"):
            line = line.strip()
            if line and not DATE_RE.match(line) and not re.match(r"^\d{2}[/\-]\d{2}[/\-]\d{4}", line):
                result["vendor_name"] = line
                vendor_found = True
                break

    if not vendor_found:
        # Strategy 2: "Place Of Supply" / state block — skip lines that look like dates
        place_match = re.search(
            r"(?:Place Of Supply.*?\n|Maharashtra \(27\)\n)(.+?)(?:\nFSSAI|\nOffice|\nGSTIN)",
            full_text, re.DOTALL
        )
        if place_match:
            for line in place_match.group(1).split("\n"):
                line = line.strip()
                if line and not DATE_RE.match(line) and not re.match(r"^\d{2}[/\-]\d{2}[/\-]\d{4}", line):
                    result["vendor_name"] = line
                    vendor_found = True
                    break

    if not vendor_found:
        # Strategy 3: named-entity fallback — look for known customer name patterns
        cust_match = re.search(r"\n([A-Z][A-Za-z\s]+(?:Foods|Trade|BSC|Mart|Store|Retail|Pvt|Ltd|Agency|Enterprises)[^\n]*)\n", full_text)
        if cust_match:
            result["vendor_name"] = cust_match.group(1).strip()

    # --- SO reference (P.O.# field) ---
    po_match = re.search(
        r"P\.O\.#\s*:\s*(BSC-SO-[\w-]+)", full_text
    )
    if po_match:
        result["so_reference"] = po_match.group(1).strip()
    else:
        # broader search for PO / order ref
        ref_match = re.search(
            r"(?:Against PO|PO No|Order Ref|P\.O\.)[:\s#]*([\w\-/]+)",
            full_text, re.IGNORECASE
        )
        if ref_match:
            result["so_reference"] = ref_match.group(1).strip()

    # --- Line items ---
    line_items = _parse_invoice_line_items(all_tables, full_text)
    result["line_items"] = line_items
    result["total_qty"] = sum(li.get("qty_dispatched", 0) for li in line_items)
    result["total_amount"] = sum(li.get("amount", 0) or 0 for li in line_items)

    return result


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _convert_date(date_str: str) -> Optional[str]:
    """Convert dd/mm/yyyy → yyyy-mm-dd for DB."""
    if not date_str:
        return None
    parts = date_str.split("/")
    if len(parts) == 3:
        return f"{parts[2]}-{parts[1]}-{parts[0]}"
    return date_str


def _parse_float(val) -> Optional[float]:
    if val is None:
        return None
    s = str(val).replace("₹", "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _parse_int(val) -> int:
    if val is None:
        return 0
    s = str(val).split("\n")[0].replace("pcs", "").strip()
    try:
        return int(float(s))
    except ValueError:
        return 0


def _parse_gramage(product_desc: str) -> tuple:
    """
    Split 'Product Name I Brand I 45 gms' into (product_name, gramage).
    Also handles 'Product I Brand I 45g'.
    """
    if not product_desc:
        return product_desc, None

    # strip HSN line
    desc = re.sub(r"HSN:.*", "", product_desc, flags=re.IGNORECASE).strip()

    # gramage pattern
    gram_match = re.search(r"(\d+(?:\.\d+)?\s*g(?:ms?)?)", desc, re.IGNORECASE)
    gramage = gram_match.group(1).strip() if gram_match else None

    # product name = everything before the gramage / last separator
    if gramage:
        name = desc[:gram_match.start()].rstrip(" |I-").strip()
    else:
        name = desc

    return name, gramage


def _parse_so_line_items(tables: list, full_text: str) -> List[Dict]:
    """Parse line items from SO PDF tables."""
    items = []

    for table in tables:
        if not table:
            continue
        # find the items table — look for a row with '#' or 'Item'
        header_row_idx = None
        for i, row in enumerate(table):
            clean = [str(c or "").strip() for c in row]
            if any(c in ("#", "Item & Description", "Item") for c in clean):
                header_row_idx = i
                break

        if header_row_idx is None:
            continue

        # map columns
        header = [str(c or "").strip().lower() for c in table[header_row_idx]]
        col_map = {}
        for idx, h in enumerate(header):
            if "#" in h or h == "#":
                col_map["line_no"] = idx
            if "item" in h or "description" in h:
                col_map["product"] = idx
            if "qty" in h:
                col_map["qty"] = idx
            if "rate" in h or "price" in h:
                col_map["rate"] = idx
            if "discount" in h:
                col_map["discount"] = idx
            if "amount" in h:
                col_map["amount"] = idx

        if "product" not in col_map:
            continue

        for row in table[header_row_idx + 1:]:
            if not row:
                continue
            line_no_val = row[col_map.get("line_no", 0)] if col_map.get("line_no") is not None else None
            product_val = row[col_map["product"]]

            if product_val is None:
                continue

            product_str = str(product_val).strip()
            if not product_str or product_str.lower().startswith("sub total"):
                continue
            if re.match(r"^[\d.]+$", product_str):
                continue  # skip number-only rows

            try:
                line_no = int(str(line_no_val).strip()) if line_no_val else None
            except (ValueError, TypeError):
                line_no = None

            product_name, gramage = _parse_gramage(product_str)

            qty_val = row[col_map["qty"]] if col_map.get("qty") is not None else None
            rate_val = row[col_map.get("rate")] if col_map.get("rate") is not None else None
            disc_val = row[col_map.get("discount")] if col_map.get("discount") is not None else None
            amt_val = row[col_map.get("amount")] if col_map.get("amount") is not None else None

            # parse discount %
            disc_pct = None
            if disc_val:
                d_str = str(disc_val).replace("%", "").strip()
                try:
                    disc_pct = float(d_str)
                except ValueError:
                    disc_pct = None

            items.append({
                "line_no": line_no,
                "product_name": product_name,
                "gramage": gramage,
                "qty_ordered": _parse_int(qty_val),
                "rate": _parse_float(rate_val),
                "discount_pct": disc_pct,
                "amount": _parse_float(amt_val),
            })

    return items


def _parse_invoice_line_items(tables: list, full_text: str) -> List[Dict]:
    """Parse line items from Invoice PDF tables."""
    items = []

    for table in tables:
        if not table:
            continue

        header_row_idx = None
        for i, row in enumerate(table):
            clean = [str(c or "").strip().lower() for c in row]
            if any(c in ("#", "description", "item") for c in clean) and any(
                "qty" in c or "price" in c for c in clean
            ):
                header_row_idx = i
                break

        if header_row_idx is None:
            continue

        header = [str(c or "").strip().lower() for c in table[header_row_idx]]
        col_map = {}
        for idx, h in enumerate(header):
            if h in ("#",):
                col_map["line_no"] = idx
            if "description" in h or "item" in h:
                col_map["product"] = idx
            if "qty" in h:
                col_map["qty"] = idx
            if "price" in h or "rate" in h:
                col_map["rate"] = idx
            if "amount" in h:
                col_map["amount"] = idx

        if "product" not in col_map:
            continue

        for row in table[header_row_idx + 1:]:
            if not row:
                continue
            product_val = row[col_map["product"]] if col_map.get("product") is not None and len(row) > col_map["product"] else None

            if product_val is None:
                continue

            product_str = str(product_val).strip()
            if not product_str or product_str.lower().startswith("sub total"):
                continue
            if re.match(r"^[\d.]+$", product_str):
                continue

            line_no_val = row[col_map.get("line_no", 0)] if col_map.get("line_no") is not None and len(row) > col_map.get("line_no", 0) else None

            try:
                line_no = int(str(line_no_val).strip()) if line_no_val else None
            except (ValueError, TypeError):
                line_no = None

            product_name, gramage = _parse_gramage(product_str)

            qty_val = row[col_map["qty"]] if col_map.get("qty") is not None and len(row) > col_map["qty"] else None
            rate_val = row[col_map.get("rate")] if col_map.get("rate") is not None and len(row) > col_map.get("rate", 0) else None
            amt_val = row[col_map.get("amount")] if col_map.get("amount") is not None and len(row) > col_map.get("amount", 0) else None

            items.append({
                "line_no": line_no,
                "product_name": product_name,
                "gramage": gramage,
                "qty_dispatched": _parse_int(qty_val),
                "rate": _parse_float(rate_val),
                "amount": _parse_float(amt_val),
            })

    return items