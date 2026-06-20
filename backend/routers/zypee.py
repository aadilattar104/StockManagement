import os
import re
import shutil
import tempfile
from datetime import date
from fastapi import APIRouter, UploadFile, File, HTTPException
from database import supabase

router = APIRouter(prefix="/api/zypee", tags=["zypee"])

VALID_WAREHOUSES = {"MUM", "PUN", "DEL", "BLR"}

# ─── Known SKU master list (used for PDF name resolution) ────────────────────

KNOWN_PRODUCTS = [
    'Achari Methi I Khapli Wheat Khakhra',
    'Bajra I Millet Khakhra',
    'Chola Fadi I High Protein Gluten Free Khakhra',
    'Green Moong I High Protein Gluten Free Khakhra',
    'Jowar & Bajra I Millet Khakhra',
    'Jowar I Millet Khakhra',
    'Methi Masala I Khapli Wheat Khakhra',
    'Sada I Khapli Wheat Khakhra',
    'Chana Jor I 200 gms',
    'Chana Jor I 500 gms',
    'Chana Jor I 80 gms',
    'Moong Jor I 200 gms',
    'Moong Jor I 80 gms',
    'High Fibre Millet Mix I 200 gms',
    'High Fibre Millet Mix I 80 gms',
]


# ─── PDF extraction helpers ───────────────────────────────────────────────────

def _normalize(s: str) -> str:
    """Remove all whitespace for fuzzy matching (handles split words like 'K hakhra')."""
    return re.sub(r'\s+', '', s).lower()


def _clean_name(raw: str) -> str:
    """Strip trailing vendor SKU / EAN / tax code garbage from a product name."""
    cleaned = re.sub(r'\s+(?:0\s+7266\d+|8906\d+|1905\d+|2106\d+).*$', '', raw)
    cleaned = re.sub(r'(\s+\d+)+\s*$', '', cleaned)
    return cleaned.strip()


def _resolve_name(name: str) -> str:
    """
    Match a raw extracted name (possibly split across PDF lines) to a known product.
    Strategy: exact → exact-normalized → prefix → prefix-normalized → suffix.
    For ambiguous prefix matches (e.g. 'High Fibre Millet Mix I') the shortest
    known product is chosen so the first line alone doesn't over-commit;
    the caller will have appended the size line before calling save.
    """
    nl = name.lower().strip()
    nn = _normalize(nl)
    # 1. Exact
    for known in KNOWN_PRODUCTS:
        if nl == known.lower():
            return known
    # 2. Exact after removing all spaces (handles split words: 'gm s' -> 'gms')
    for known in KNOWN_PRODUCTS:
        if nn == _normalize(known):
            return known
    # 3. Known starts with our name (our name is a prefix) → shortest known wins
    prefix_matches = [k for k in KNOWN_PRODUCTS if k.lower().startswith(nl) and len(nl) >= 8]
    if prefix_matches:
        return min(prefix_matches, key=lambda k: len(k))
    # 4. Same but normalized
    prefix_matches_n = [k for k in KNOWN_PRODUCTS if _normalize(k).startswith(nn) and len(nn) >= 8]
    if prefix_matches_n:
        return min(prefix_matches_n, key=lambda k: len(k))
    # 5. Our name starts with a known product
    for known in KNOWN_PRODUCTS:
        if nl.startswith(known.lower()):
            return known
    # 6. Same but normalized
    for known in KNOWN_PRODUCTS:
        if nn.startswith(_normalize(known)) and len(nn) >= 8:
            return known
    return name


def _is_real_sku(words_list: list) -> bool:
    """Return True if the SKU column words represent a genuine product SKU."""
    text = ' '.join(words_list)
    if re.search(r'726684', text):
        return True
    if re.search(r'\b890619681\b', text):
        return True
    if re.search(r'\b8906196810\b', text):
        return True
    return False


def detect_warehouse_from_pdf(text: str) -> str:
    t = text.upper()
    m = re.search(r'VENDOR NAME\s+(SVASTHYAA[-_][A-Z0-9_-]+)', t)
    vendor = m.group(1) if m else t.split('\n')[0][:30]
    if 'DEL' in vendor:
        return 'DEL'
    if 'PUNE' in vendor or '-PUN' in vendor:
        return 'PUN'
    if 'BLR' in vendor:
        return 'BLR'
    if 'MUM' in vendor or 'ANDHERI' in vendor:
        return 'MUM'
    return ''


def _extract_po_date(text: str):
    m = re.search(r'PO Date\s+(\d{4}-\d{2}-\d{2})', text)
    return m.group(1) if m else None


def _extract_po_number(text: str):
    # Try "PURCHASE ORDER" followed by digits (on same or next line)
    m = re.search(r'PURCHASE ORDER[\s\n]+(\d+)', text, re.IGNORECASE)
    if m:
        return m.group(1)
    # Fallback: look for a standalone 7-digit number near top of doc
    m = re.search(r'\b(\d{7})\b', text[:500])
    if m:
        return m.group(1)
    return None


def _extract_items(page) -> list:
    """
    Word-level extraction from a PO PDF page.

    Detects column boundaries from the header row:
      SKU IMAGE  |  Company SKU  |  Product Name  |  Vendor SKU  |  ...  |  Quantity  |  ...
    
    Only words in the 'Product Name' column (between product_name_x and vendor_sku_x)
    are used for the product name; words in the SKU column trigger new-product detection.
    Continuation lines (no real SKU) extend the current product's name parts.
    """
    words = page.extract_words()
    if not words:
        return []

    product_name_x = quantity_x = header_y = None
    for i, w in enumerate(words):
        if (w['text'] == 'Product'
                and i + 1 < len(words)
                and words[i + 1]['text'] == 'Name'):
            if product_name_x is None:
                product_name_x = w['x0']
                header_y = w['top']
        if w['text'] == 'Quantity' and quantity_x is None:
            quantity_x = w['x0']

    if product_name_x is None or quantity_x is None:
        return []

    # Right boundary of the Product Name column = left edge of Vendor SKU column
    vendor_sku_x = None
    for w in words:
        if (w['text'] == 'Vendor'
                and abs(w['top'] - header_y) < 20
                and w['x0'] > product_name_x):
            vendor_sku_x = w['x0']
            break
    name_right = (vendor_sku_x - 3) if vendor_sku_x else (quantity_x - 5)

    # Group words by rounded y-coordinate (row)
    data_words = [w for w in words if w['top'] > header_y + 5]
    row_map: dict = {}
    for w in data_words:
        y = round(w['top'] / 3) * 3
        row_map.setdefault(y, []).append(w)

    STOP_WORDS = {
        'item', 'total', 'tax', 'amount', 'grand', 'value',
        'words', 'for', 'authorized', 'signatory', 'paise',
    }

    items: list = []
    cur_name_parts: list = []
    cur_qty = None

    def save_current():
        if cur_name_parts and cur_qty is not None:
            raw = ' '.join(cur_name_parts)
            items.append({
                'name': _resolve_name(_clean_name(raw)),
                'qty': cur_qty,
            })

    for y in sorted(row_map):
        rw = sorted(row_map[y], key=lambda w: w['x0'])
        sku_w  = [w['text'] for w in rw if w['x0'] < product_name_x]
        name_w = [w['text'] for w in rw if product_name_x <= w['x0'] < name_right]
        qty_w  = [w['text'] for w in rw if w['x0'] >= quantity_x - 5]

        # Stop processing at footer rows
        combined = ' '.join(sku_w + name_w + qty_w).lower()
        if any(s in combined for s in STOP_WORDS):
            save_current()
            cur_name_parts = []
            cur_qty = None
            continue

        new_product = bool(sku_w and name_w and _is_real_sku(sku_w))

        if new_product:
            save_current()
            cur_name_parts = name_w
            cur_qty = None
            for qw in qty_w:
                try:
                    v = int(qw.replace(',', ''))
                    if 1 <= v <= 9999:
                        cur_qty = v
                        break
                except (ValueError, TypeError):
                    pass
        else:
            if name_w:
                cur_name_parts.extend(name_w)
            for qw in qty_w:
                try:
                    v = int(qw.replace(',', ''))
                    if 1 <= v <= 9999 and cur_qty is None:
                        cur_qty = v
                        break
                except (ValueError, TypeError):
                    pass

    save_current()
    return items


# ─── CSV helpers ──────────────────────────────────────────────────────────────

def parse_filename(filename: str):
    name = os.path.splitext(filename)[0]
    parts = name.split("_")
    if len(parts) != 2:
        raise HTTPException(400, f"Filename must be WAREHOUSE_DD-MM-YYYY.csv, got: {filename}")
    warehouse = parts[0].upper()
    if warehouse not in VALID_WAREHOUSES:
        raise HTTPException(400, f"Unknown warehouse code '{warehouse}'. Valid: {', '.join(VALID_WAREHOUSES)}")
    date_str = parts[1]
    match = re.match(r"(\d{2})-(\d{2})-(\d{4})", date_str)
    if not match:
        raise HTTPException(400, f"Date in filename must be DD-MM-YYYY, got: {date_str}")
    day, month, year = match.groups()
    try:
        stock_date = date(int(year), int(month), int(day))
    except ValueError:
        raise HTTPException(400, f"Invalid date in filename: {date_str}")
    return warehouse, stock_date.isoformat()


def parse_csv(filepath: str):
    import csv
    rows = []
    with open(filepath, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sku = (row.get("sku") or "").strip()
            name = (row.get("name") or "").strip()
            qty_raw = (row.get("old_quantity") or "").strip()
            try:
                qty = int(float(qty_raw)) if qty_raw else 0
            except (ValueError, TypeError):
                qty = 0
            if name:
                rows.append({"sku": sku, "name": name, "old_quantity": qty})
    return rows


# ─── Stock Upload ─────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_zypee(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only .csv files are accepted")
    warehouse, stock_date = parse_filename(file.filename)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name
    try:
        rows = parse_csv(tmp_path)
    finally:
        os.unlink(tmp_path)
    if not rows:
        raise HTTPException(400, "No data rows found in CSV")
    existing = (
        supabase.table("zypee_uploads")
        .select("id")
        .eq("warehouse", warehouse)
        .eq("stock_date", stock_date)
        .execute()
    )
    if existing.data:
        upload_id = existing.data[0]["id"]
        supabase.table("zypee_stock").delete().eq("upload_id", upload_id).execute()
        supabase.table("zypee_uploads").update({"uploaded_at": "now()"}).eq("id", upload_id).execute()
    else:
        upload_res = (
            supabase.table("zypee_uploads")
            .insert({"warehouse": warehouse, "stock_date": stock_date})
            .execute()
        )
        upload_id = upload_res.data[0]["id"]
    stock_rows = [
        {
            "upload_id": upload_id,
            "sku": r["sku"],
            "name": r["name"],
            "old_quantity": r["old_quantity"],
            "is_active": True,
        }
        for r in rows
    ]
    for i in range(0, len(stock_rows), 100):
        supabase.table("zypee_stock").insert(stock_rows[i : i + 100]).execute()
    return {
        "warehouse": warehouse,
        "stock_date": stock_date,
        "upload_id": upload_id,
        "rows_loaded": len(stock_rows),
    }


@router.get("/uploads")
async def get_uploads():
    uploads = (
        supabase.table("zypee_uploads").select("*").order("stock_date", desc=True).execute()
    )
    result = []
    for u in uploads.data or []:
        count_res = (
            supabase.table("zypee_stock")
            .select("id", count="exact")
            .eq("upload_id", u["id"])
            .execute()
        )
        result.append({**u, "row_count": count_res.count or 0})
    return result


@router.get("/stock")
async def get_stock(warehouse: str, date: str):
    upload = (
        supabase.table("zypee_uploads")
        .select("id")
        .eq("warehouse", warehouse.upper())
        .eq("stock_date", date)
        .execute()
    )
    if not upload.data:
        return []
    upload_id = upload.data[0]["id"]
    rows = (
        supabase.table("zypee_stock")
        .select("*")
        .eq("upload_id", upload_id)
        .order("name")
        .execute()
    )
    return rows.data or []


@router.put("/stock/{stock_id}/toggle")
async def toggle_active(stock_id: str, payload: dict):
    is_active = payload.get("is_active", True)
    result = (
        supabase.table("zypee_stock")
        .update({"is_active": is_active})
        .eq("id", stock_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Stock row not found")
    return result.data[0]


@router.delete("/uploads/{upload_id}")
async def delete_upload(upload_id: str):
    supabase.table("zypee_stock").delete().eq("upload_id", upload_id).execute()
    supabase.table("zypee_uploads").delete().eq("id", upload_id).execute()
    return {"deleted": upload_id}


# ─── In Transit ───────────────────────────────────────────────────────────────

@router.post("/in-transit/upload")
async def upload_in_transit(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        import pdfplumber
        with pdfplumber.open(tmp_path) as pdf:
            page = pdf.pages[0]
            full_text = page.extract_text() or ""
            warehouse = detect_warehouse_from_pdf(full_text)
            po_date = _extract_po_date(full_text)
            po_number = _extract_po_number(full_text)
            line_items = _extract_items(page)
    finally:
        os.unlink(tmp_path)

    if not warehouse:
        raise HTTPException(400, "Could not detect warehouse from PDF (expected SVASTHYAA-XXX vendor name).")
    if not po_date:
        raise HTTPException(400, "Could not extract PO Date from PDF.")
    if not po_number:
        raise HTTPException(400, "Could not extract PO Number from PDF.")
    if not line_items:
        raise HTTPException(400, "No line items found in PDF.")

    # Load SKU mappings
    mappings_res = supabase.table("zypee_sku_mappings").select("id,zypee_sku_name").execute()
    mappings = {
        m["zypee_sku_name"].strip().lower(): m
        for m in (mappings_res.data or [])
    }

    matched = []
    exceptions = []

    for item in line_items:
        name = item["name"].strip()
        key = name.lower()
        if key in mappings:
            mapping = mappings[key]
            matched.append({
                "warehouse": warehouse,
                "po_number": po_number,
                "po_date": po_date,
                "zypee_sku_mapping_id": mapping["id"],
                "sku_name": name,
                "qty": item["qty"],
            })
        else:
            exceptions.append({
                "sku_name": name,
                "warehouse": warehouse,
                "qty": item["qty"],
                "reason": "Mapping Required",
            })

    # ── Duplicate PO check ────────────────────────────────────────────────────
    # Check if this PO (warehouse + po_number + po_date) already exists
    existing_po = supabase.table("zypee_in_transit").select(
        "zypee_sku_mapping_id,qty"
    ).eq("warehouse", warehouse).eq("po_number", po_number).eq("po_date", po_date).execute()

    if existing_po.data:
        existing_rows = existing_po.data  # list of {zypee_sku_mapping_id, qty}
        # Build a comparable qty map from existing rows
        existing_qty_map = {r["zypee_sku_mapping_id"]: r["qty"] for r in existing_rows}
        # Build qty map from incoming matched rows
        incoming_qty_map = {r["zypee_sku_mapping_id"]: r["qty"] for r in matched}
        # Check if quantities are identical
        if existing_qty_map == incoming_qty_map:
            return {
                "warehouse": warehouse,
                "po_date": po_date,
                "po_number": po_number,
                "duplicate": True,
                "qty_changed": False,
                "matched": 0,
                "exceptions": exceptions,
                "rows": [],
            }
        else:
            # Quantities differ — return conflict info + the new rows for replace
            return {
                "warehouse": warehouse,
                "po_date": po_date,
                "po_number": po_number,
                "duplicate": True,
                "qty_changed": True,
                "matched": 0,
                "exceptions": exceptions,
                "rows": [],
                "rows_payload": matched,  # frontend passes this to replace-po on confirm
            }

    inserted = []
    for row in matched:
        res = supabase.table("zypee_in_transit").insert(row).execute()
        if res.data:
            inserted.append(res.data[0])

    return {
        "warehouse": warehouse,
        "po_date": po_date,
        "po_number": po_number,
        "matched": len(inserted),
        "exceptions": exceptions,
        "rows": inserted,
    }


@router.post("/in-transit/replace-po")
async def replace_po(payload: dict):
    """Force-replace an existing PO after user confirms. Deletes old rows, inserts new ones."""
    warehouse = (payload.get("warehouse") or "").upper()
    po_number = payload.get("po_number") or ""
    po_date = payload.get("po_date") or ""
    rows_data = payload.get("rows") or []  # list of {zypee_sku_mapping_id, sku_name, qty}

    if not warehouse or not po_number or not po_date or not rows_data:
        raise HTTPException(400, "warehouse, po_number, po_date, and rows are required")

    # Delete existing rows for this PO
    supabase.table("zypee_in_transit").delete().eq(
        "warehouse", warehouse
    ).eq("po_number", po_number).eq("po_date", po_date).execute()

    # Insert fresh rows
    inserted = []
    for row in rows_data:
        res = supabase.table("zypee_in_transit").insert({
            "warehouse": warehouse,
            "po_number": po_number,
            "po_date": po_date,
            "zypee_sku_mapping_id": row["zypee_sku_mapping_id"],
            "sku_name": row["sku_name"],
            "qty": row["qty"],
        }).execute()
        if res.data:
            inserted.append(res.data[0])

    return {
        "warehouse": warehouse,
        "po_date": po_date,
        "po_number": po_number,
        "matched": len(inserted),
        "rows": inserted,
    }


@router.get("/in-transit")
async def get_in_transit():
    rows = (
        supabase.table("zypee_in_transit")
        .select("*")
        .order("uploaded_at", desc=True)
        .execute()
    )
    return rows.data or []


@router.delete("/in-transit/po")
async def delete_po(payload: dict):
    """Delete all transit rows for a specific PO (warehouse + po_date + po_number)."""
    warehouse = (payload.get("warehouse") or "").upper()
    po_date = payload.get("po_date") or ""
    po_number = payload.get("po_number") or ""

    if not warehouse or not po_date or not po_number:
        raise HTTPException(400, "warehouse, po_date, and po_number are required")

    supabase.table("zypee_in_transit").delete().eq(
        "warehouse", warehouse
    ).eq("po_date", po_date).eq("po_number", po_number).execute()

    return {"success": True}


@router.delete("/in-transit/{transit_id}")
async def delete_in_transit(transit_id: str):
    supabase.table("zypee_in_transit").delete().eq("id", transit_id).execute()
    return {"deleted": transit_id}


# ─── Compare Table ────────────────────────────────────────────────────────────

@router.get("/compare")
async def get_compare(date: str = None):
    mappings_res = supabase.table("zypee_sku_mappings").select("id,zypee_sku_name,warehouse_stock_id").execute()
    mappings = mappings_res.data or []
    if not mappings:
        return {"rows": [], "po_columns": {}}

    ws_ids = list({m["warehouse_stock_id"] for m in mappings if m.get("warehouse_stock_id")})
    ws_res = (
        supabase.table("warehouse_stock")
        .select("id,title,weight,stock_qty")
        .in_("id", ws_ids)
        .execute()
    )
    ws_map = {w["id"]: w for w in (ws_res.data or [])}

    # Build per-warehouse stock maps
    wh_stock_map: dict = {}
    for wh in VALID_WAREHOUSES:
        if date:
            upload_q = (
                supabase.table("zypee_uploads")
                .select("id")
                .eq("warehouse", wh)
                .eq("stock_date", date)
                .execute()
            )
        else:
            upload_q = (
                supabase.table("zypee_uploads")
                .select("id,stock_date")
                .eq("warehouse", wh)
                .order("stock_date", desc=True)
                .limit(1)
                .execute()
            )
        if not upload_q.data:
            continue
        upload_id = upload_q.data[0]["id"]
        stock_rows = (
            supabase.table("zypee_stock")
            .select("name,old_quantity")
            .eq("upload_id", upload_id)
            .execute()
        )
        name_to_qty = {
            r["name"].strip().lower(): r["old_quantity"]
            for r in (stock_rows.data or [])
        }
        for m in mappings:
            mid = m["id"]
            key = m["zypee_sku_name"].strip().lower()
            wh_stock_map.setdefault(mid, {})[wh] = name_to_qty.get(key, 0)

    # ── Dynamic PO columns ──────────────────────────────────────────────────────
    # Fetch all in-transit rows
    transit_res = supabase.table("zypee_in_transit").select(
        "id,zypee_sku_mapping_id,warehouse,qty,po_date,po_number"
    ).execute()
    transit_rows = transit_res.data or []

    # Build po_columns: { "MUM": [...], "PUN": [...], ... }
    # Each entry: { column_key, warehouse, po_date, po_number }
    po_columns: dict = {wh: [] for wh in ["MUM", "PUN", "DEL", "BLR"]}
    seen_column_keys: set = set()

    for t in transit_rows:
        wh = t["warehouse"]
        po_date_raw = t["po_date"] or ""
        po_date_key = po_date_raw.replace("-", "_")           # "2026-06-12" → "2026_06_12"
        col_key = f"{wh.lower()}_{po_date_key}"              # "mum_2026_06_12"
        if col_key not in seen_column_keys and wh in po_columns:
            po_columns[wh].append({
                "column_key": col_key,
                "warehouse": wh,
                "po_date": po_date_raw,
                "po_number": t["po_number"],
            })
            seen_column_keys.add(col_key)

    # Sort each warehouse's columns newest first
    for wh in po_columns:
        po_columns[wh].sort(key=lambda c: c["po_date"], reverse=True)

    # Build transit_lookup[mapping_id][column_key] = { qty, po_number, po_date }
    transit_lookup: dict = {}
    for t in transit_rows:
        mid = t["zypee_sku_mapping_id"]
        wh = t["warehouse"]
        po_date_raw = t["po_date"] or ""
        po_date_key = po_date_raw.replace("-", "_")
        col_key = f"{wh.lower()}_{po_date_key}"
        transit_lookup.setdefault(mid, {})[col_key] = {
            "qty": t["qty"],
            "po_number": t["po_number"],
            "po_date": po_date_raw,
        }

    # Build rows
    rows = []
    for m in mappings:
        mid = m["id"]
        ws = ws_map.get(m.get("warehouse_stock_id"), {})
        stock = wh_stock_map.get(mid, {})
        t_lookup = transit_lookup.get(mid, {})

        row = {
            "mapping_id": mid,
            "zypee_sku_name": m["zypee_sku_name"],
            "wh_stock": ws.get("stock_qty", 0),
            "mum_stock": stock.get("MUM", 0),
            "pun_stock": stock.get("PUN", 0),
            "del_stock": stock.get("DEL", 0),
            "blr_stock": stock.get("BLR", 0),
        }

        # Add one key per PO column
        for wh_cols in po_columns.values():
            for col in wh_cols:
                row[col["column_key"]] = t_lookup.get(col["column_key"])

        rows.append(row)

    rows.sort(key=lambda r: r["zypee_sku_name"])
    return {"rows": rows, "po_columns": po_columns}