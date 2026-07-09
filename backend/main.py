import os
from collections import defaultdict
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from dotenv import load_dotenv

load_dotenv()

from database import supabase
from routers import stock, sales_orders, invoices, zypee, sku_norm
from services.pdf_extractor import extract_so_pdf, extract_invoice_pdf
from services.stock_loader import load_stock_from_xlsx
from services.matcher import find_best_stock_match, find_best_so_line_match

app = FastAPI(title="Warehouse Fulfilment System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://stockmanagement-nu.vercel.app", "https://stockmanagement-1-nr7n.onrender.com"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_cors_headers(request: Request, call_next):
    if request.method == "OPTIONS":
        response = Response()
        response.headers["Access-Control-Allow-Origin"] = request.headers.get("origin", "https://stockmanagement-1-nr7n.onrender.com")
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
        return response
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = request.headers.get("origin", "https://stockmanagement-1-nr7n.onrender.com")
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response

app.include_router(stock.router)
app.include_router(sales_orders.router)
app.include_router(invoices.router)
app.include_router(zypee.router)
app.include_router(sku_norm.router)


# ─── Dashboard ────────────────────────────────────────────────────────────────

@app.get("/api/dashboard")
async def dashboard():
    open_sos = supabase.table("sales_orders").select("id", count="exact").in_(
        "status", ["open", "partial"]
    ).execute()

    pending_result = supabase.table("fulfilment_records").select("qty_pending").neq(
        "status", "fulfilled"
    ).execute()
    total_pending = sum(r.get("qty_pending", 0) for r in (pending_result.data or []))

    # Low/out stock counts and detail are scoped to Product Master SKUs only,
    # since Product Master is now the single source of truth for which SKUs exist.
    pm_res = supabase.table("product_master").select("warehouse_stock_id").execute()
    pm_stock_ids = [r["warehouse_stock_id"] for r in (pm_res.data or []) if r.get("warehouse_stock_id")]

    low_stock_count = 0
    out_stock_count = 0
    low_stock_detail_rows = []
    if pm_stock_ids:
        low_stock = supabase.table("warehouse_stock").select("id", count="exact").in_(
            "id", pm_stock_ids
        ).lte("stock_qty", 30).gt("stock_qty", 0).execute()
        low_stock_count = low_stock.count or 0

        out_stock = supabase.table("warehouse_stock").select("id", count="exact").in_(
            "id", pm_stock_ids
        ).eq("stock_qty", 0).execute()
        out_stock_count = out_stock.count or 0

        low_stock_detail_res = supabase.table("warehouse_stock").select("*").in_(
            "id", pm_stock_ids
        ).lte("stock_qty", 30).order("stock_qty").limit(5).execute()
        low_stock_detail_rows = low_stock_detail_res.data or []

    invoices_count = supabase.table("invoices").select("id", count="exact").execute()

    recent_sos = supabase.table("sales_orders").select("*").order(
        "uploaded_at", desc=True
    ).limit(5).execute()

    # Enrich recent SOs with qty_pending, has_invoice, display_status
    enriched_recent_sos = []
    for so in (recent_sos.data or []):
        so_id = so["id"]
        so_status = so.get("status", "open")

        # Sum qty_pending from fulfilment_records for this SO's lines
        so_lines_res = supabase.table("so_line_items").select("id").eq("so_id", so_id).execute()
        so_line_ids = [l["id"] for l in (so_lines_res.data or [])]
        qty_pending = 0
        if so_line_ids:
            fr_res = supabase.table("fulfilment_records").select("qty_pending").in_(
                "so_line_id", so_line_ids
            ).execute()
            qty_pending = sum(r.get("qty_pending", 0) for r in (fr_res.data or []))

        # Check if any invoice is linked
        link_res = supabase.table("so_invoice_links").select("id", count="exact").eq(
            "so_id", so_id
        ).execute()
        has_invoice = (link_res.count or 0) > 0

        # Compute display_status
        if so_status == "fulfilled":
            display_status = "closed"
        elif so_status == "open" and not has_invoice:
            display_status = "invoice_pending"
        else:
            display_status = "partial"

        enriched_recent_sos.append({
            **so,
            "qty_pending": qty_pending,
            "has_invoice": has_invoice,
            "display_status": display_status,
        })

    low_stock_detail = low_stock_detail_rows
    for row in low_stock_detail:
        from routers.stock import stock_status
        row["status"] = stock_status(row.get("stock_qty", 0))

    return {
        "open_sos": open_sos.count or 0,
        "pending_units": total_pending,
        "low_stock_skus": low_stock_count + out_stock_count,
        "invoices_processed": invoices_count.count or 0,
        "recent_sos": enriched_recent_sos,
        "low_stock_detail": low_stock_detail,
    }


@app.get("/api/dashboard/fulfilment-matrix")
async def fulfilment_matrix():
    """
    Pivot matrix: ALL Product Master SKUs as rows (Product Master is the
    single source of truth for which SKUs exist), open/partial SOs as columns.
    - Rows = every Product Master SKU, in Product Master order, even with
      zero demand and even if it currently has no warehouse_stock link.
    - Per-SO columns = static qty_ordered (original order, never changes after dispatch).
    - qty_to_be_sent = live sum of fulfilment_records.qty_pending across open/partial SOs.
    """
    # 1. Product Master — this is now the base row set, in its configured order
    pm_res = supabase.table("product_master").select("*").order("order_index").execute()
    pm_rows = pm_res.data or []

    stock_ids = [r["warehouse_stock_id"] for r in pm_rows if r.get("warehouse_stock_id")]
    stock_map = {}
    if stock_ids:
        stock_res = supabase.table("warehouse_stock").select("id,stock_qty").in_("id", stock_ids).execute()
        stock_map = {s["id"]: s for s in (stock_res.data or [])}

    # 2. All open/partial SOs (closed/fulfilled excluded — their demand is done)
    sos_res = supabase.table("sales_orders").select("id,so_number,vendor_name") \
        .in_("status", ["open", "partial"]).order("uploaded_at").execute()
    sos = sos_res.data or []
    so_ids = [s["id"] for s in sos]

    # so_qtys[sku_id][so_id] = static qty_ordered ; pending[sku_id] = live qty_pending sum
    # keyed by warehouse_stock_id, same as before
    so_qtys: dict = defaultdict(lambda: defaultdict(int))
    pending: dict = defaultdict(int)

    if so_ids:
        lines_res = supabase.table("so_line_items") \
            .select("id,so_id,matched_stock_id,qty_ordered") \
            .in_("so_id", so_ids).execute()
        lines = lines_res.data or []

        line_id_to_stock: dict = {}
        for line in lines:
            sid = line.get("matched_stock_id")
            if sid and sid in stock_map:
                so_qtys[sid][line["so_id"]] += line.get("qty_ordered", 0)
                line_id_to_stock[line["id"]] = sid

        if line_id_to_stock:
            line_ids = list(line_id_to_stock.keys())
            fr_res = supabase.table("fulfilment_records") \
                .select("so_line_id,qty_pending") \
                .in_("so_line_id", line_ids).execute()
            for fr in (fr_res.data or []):
                stock_id = line_id_to_stock.get(fr["so_line_id"])
                if stock_id:
                    pending[stock_id] += fr.get("qty_pending", 0)

    # 3. Build rows — one per Product Master SKU, in Product Master order,
    #    even with zero demand and even without a linked warehouse_stock row.
    rows = []
    for pm in pm_rows:
        stock_id = pm.get("warehouse_stock_id")
        warehouse_stock_qty = stock_map.get(stock_id, {}).get("stock_qty", 0) if stock_id else 0
        qty_to_be_sent = pending.get(stock_id, 0) if stock_id else 0
        rows.append({
            "sku_id": stock_id,
            "product_master_id": pm["id"],
            "sku_title": pm.get("sku_name", "Unknown SKU"),
            "sku_weight": pm.get("weight"),
            "warehouse_stock": warehouse_stock_qty,
            "qty_to_be_sent": qty_to_be_sent,
            "so_qtys": dict(so_qtys.get(stock_id, {})) if stock_id else {},
        })

    # Order is the Product Master order — never re-sorted alphabetically or by shortage.

    return {
        "so_columns": [
            {"so_id": s["id"], "so_number": s["so_number"], "vendor_name": s["vendor_name"]}
            for s in sos
        ],
        "rows": rows,
    }


@app.get("/api/dashboard/warehouse-stock-matrix")
async def warehouse_stock_matrix():
    """
    Warehouse Stock Matrix: every Product Master SKU (in Product Master
    order) against the main warehouse plus per-city warehouses.

    City columns are sourced from the Zypee flow: `zypee_sku_mappings` links
    a warehouse_stock_id to its Zypee SKU name, and for each warehouse we
    look at only its single latest `zypee_uploads` row (older uploads are
    ignored, per spec) to get that SKU's `old_quantity` from `zypee_stock`.
    A SKU with no Zypee mapping, or missing from a warehouse's latest
    upload, displays "-" rather than being hidden or shown as 0.
    """
    WAREHOUSE_LABELS = {"BLR": "Bangalore", "MUM": "Mumbai", "PUN": "Pune", "DEL": "Delhi"}
    warehouse_columns = list(WAREHOUSE_LABELS.values())

    pm_res = supabase.table("product_master").select("*").order("order_index").execute()
    pm_rows = pm_res.data or []

    stock_ids = [r["warehouse_stock_id"] for r in pm_rows if r.get("warehouse_stock_id")]
    stock_map = {}
    if stock_ids:
        stock_res = supabase.table("warehouse_stock").select("id,stock_qty").in_("id", stock_ids).execute()
        stock_map = {s["id"]: s for s in (stock_res.data or [])}

    # warehouse_stock_id -> Zypee mapping (zypee_sku_name), so we know which
    # Zypee SKU name each Product Master product corresponds to.
    mappings_res = supabase.table("zypee_sku_mappings").select(
        "id,zypee_sku_name,warehouse_stock_id"
    ).execute()
    mapping_by_stock_id = {
        m["warehouse_stock_id"]: m
        for m in (mappings_res.data or []) if m.get("warehouse_stock_id")
    }

    # For each warehouse, pull ONLY its latest upload's stock (by name),
    # exactly like /api/zypee/compare does when no explicit date is passed.
    per_warehouse_qty_by_name: dict = {}
    for wh in zypee.VALID_WAREHOUSES:
        upload_q = (
            supabase.table("zypee_uploads")
            .select("id")
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
        per_warehouse_qty_by_name[wh] = {
            r["name"].strip().lower(): r["old_quantity"] for r in (stock_rows.data or [])
        }

    # ── PO In Transit columns (moved here from the old /api/zypee/compare,
    # which powered the now-removed Compare Warehouses tab). Same logic,
    # keyed by zypee_sku_mapping_id. ──────────────────────────────────────
    transit_res = supabase.table("zypee_in_transit").select(
        "id,zypee_sku_mapping_id,warehouse,qty,po_date,po_number"
    ).execute()
    transit_rows = transit_res.data or []

    po_columns: dict = {wh: [] for wh in ["MUM", "PUN", "DEL", "BLR"]}
    seen_column_keys: set = set()
    for t in transit_rows:
        wh = t["warehouse"]
        po_date_raw = t["po_date"] or ""
        po_date_key = po_date_raw.replace("-", "_")
        col_key = f"{wh.lower()}_{po_date_key}"
        if col_key not in seen_column_keys and wh in po_columns:
            po_columns[wh].append({
                "column_key": col_key,
                "warehouse": wh,
                "po_date": po_date_raw,
                "po_number": t["po_number"],
            })
            seen_column_keys.add(col_key)

    for wh in po_columns:
        po_columns[wh].sort(key=lambda c: c["po_date"], reverse=True)

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

    rows = []
    for pm in pm_rows:
        stock_id = pm.get("warehouse_stock_id")
        warehouse_stock_qty = stock_map.get(stock_id, {}).get("stock_qty", 0) if stock_id else 0

        mapping = mapping_by_stock_id.get(stock_id) if stock_id else None
        city_stock = {}
        for wh_code, label in WAREHOUSE_LABELS.items():
            if not mapping:
                city_stock[label] = "-"
                continue
            key = mapping["zypee_sku_name"].strip().lower()
            wh_data = per_warehouse_qty_by_name.get(wh_code)
            city_stock[label] = wh_data.get(key, "-") if wh_data is not None else "-"

        # One entry per PO column across all warehouses, so the frontend can
        # render transit qty next to each warehouse's stock column.
        t_lookup = transit_lookup.get(mapping["id"], {}) if mapping else {}
        transit_cols = {}
        for wh_cols in po_columns.values():
            for col in wh_cols:
                transit_cols[col["column_key"]] = t_lookup.get(col["column_key"])

        rows.append({
            "sku_id": stock_id,
            "product_master_id": pm["id"],
            "sku_title": pm.get("sku_name", "Unknown SKU"),
            "sku_weight": pm.get("weight"),
            "warehouse_stock": warehouse_stock_qty,
            "city_stock": city_stock,
            "transit_cols": transit_cols,
        })

    return {
        "warehouse_columns": warehouse_columns,
        "po_columns": po_columns,
        "rows": rows,
    }





# ─── Dev: Load Samples ────────────────────────────────────────────────────────

@app.post("/api/dev/load-samples")
async def load_samples():
    """Load all sample files for demo purposes."""
    base = os.path.join(os.path.dirname(__file__), "sample_data")
    results = {}

    # 1. Load stock
    xlsx_path = os.path.join(base, "Warehouse_stock.xlsx")
    if os.path.exists(xlsx_path):
        rows = load_stock_from_xlsx(xlsx_path)
        upserted = []
        for row in rows:
            existing = supabase.table("warehouse_stock").select("id").eq(
                "title", row["title"]
            ).eq("weight", row["weight"] or "").execute()
            if existing.data:
                r = supabase.table("warehouse_stock").update(
                    {"stock_qty": row["stock_qty"]}
                ).eq("id", existing.data[0]["id"]).execute()
            else:
                r = supabase.table("warehouse_stock").insert(row).execute()
            if r.data:
                upserted.append(r.data[0])
        results["stock"] = f"{len(upserted)} rows upserted"
    else:
        results["stock"] = "sample file not found"

    # 2. Load SO
    so_path = os.path.join(base, "BSC-SO-2627-00340.pdf")
    if os.path.exists(so_path):
        extracted = extract_so_pdf(so_path)
        so_number = extracted.get("so_number")
        if so_number:
            existing = supabase.table("sales_orders").select("id").eq(
                "so_number", so_number
            ).execute()
            if existing.data:
                results["sales_order"] = f"SO {so_number} already exists"
            else:
                # Only match against SKUs that exist in the Product Master
                pm_ids_res = supabase.table("product_master").select("warehouse_stock_id").execute()
                pm_stock_ids = [r["warehouse_stock_id"] for r in (pm_ids_res.data or []) if r.get("warehouse_stock_id")]
                stock_rows = []
                if pm_stock_ids:
                    stock_result = supabase.table("warehouse_stock").select(
                        "id,title,weight"
                    ).in_("id", pm_stock_ids).execute()
                    stock_rows = stock_result.data or []

                so_insert = supabase.table("sales_orders").insert({
                    "so_number": so_number,
                    "so_date": extracted.get("so_date"),
                    "vendor_name": extracted.get("vendor_name"),
                    "total_qty": extracted.get("total_qty", 0),
                    "total_amount": extracted.get("total_amount", 0),
                    "status": "open",
                    "pdf_path": so_path,
                }).execute()

                so_id = so_insert.data[0]["id"] if so_insert.data else None
                if so_id:
                    for li in extracted.get("line_items", []):
                        stock_id, _ = find_best_stock_match(
                            li.get("product_name", ""),
                            li.get("gramage"),
                            stock_rows
                        )
                        il = supabase.table("so_line_items").insert({
                            "so_id": so_id,
                            "line_no": li.get("line_no"),
                            "product_name": li.get("product_name"),
                            "gramage": li.get("gramage"),
                            "qty_ordered": li.get("qty_ordered", 0),
                            "rate": li.get("rate"),
                            "discount_pct": li.get("discount_pct"),
                            "amount": li.get("amount"),
                            "matched_stock_id": stock_id,
                        }).execute()
                        if il.data:
                            supabase.table("fulfilment_records").insert({
                                "so_line_id": il.data[0]["id"],
                                "qty_ordered": li.get("qty_ordered", 0),
                                "qty_dispatched": 0,
                                "qty_pending": li.get("qty_ordered", 0),
                                "status": "not_sent",
                            }).execute()

                results["sales_order"] = f"SO {so_number} loaded"
        else:
            results["sales_order"] = "Could not extract SO number"
    else:
        results["sales_order"] = "sample file not found"

    # 3. Load Invoice
    inv_path = os.path.join(base, "BSPL26-2700318.pdf")
    if os.path.exists(inv_path):
        extracted_inv = extract_invoice_pdf(inv_path)
        inv_number = extracted_inv.get("invoice_number")
        if inv_number:
            existing = supabase.table("invoices").select("id").eq(
                "invoice_number", inv_number
            ).execute()
            if existing.data:
                results["invoice"] = f"Invoice {inv_number} already exists"
            else:
                from routers.invoices import _recompute_so_status

                # Only match against SKUs that exist in the Product Master
                pm_ids_res2 = supabase.table("product_master").select("warehouse_stock_id").execute()
                pm_stock_ids2 = [r["warehouse_stock_id"] for r in (pm_ids_res2.data or []) if r.get("warehouse_stock_id")]
                stock_rows = []
                if pm_stock_ids2:
                    stock_result = supabase.table("warehouse_stock").select(
                        "id,title,weight"
                    ).in_("id", pm_stock_ids2).execute()
                    stock_rows = stock_result.data or []

                linked_so_ids = []
                so_ref = extracted_inv.get("so_reference")
                if so_ref:
                    so_r = supabase.table("sales_orders").select("id").eq(
                        "so_number", so_ref
                    ).execute()
                    linked_so_ids = [s["id"] for s in (so_r.data or [])]

                inv_insert = supabase.table("invoices").insert({
                    "invoice_number": inv_number,
                    "invoice_date": extracted_inv.get("invoice_date"),
                    "vendor_name": extracted_inv.get("vendor_name"),
                    "total_qty": extracted_inv.get("total_qty", 0),
                    "total_amount": extracted_inv.get("total_amount", 0),
                    "pdf_path": inv_path,
                }).execute()

                invoice_id = inv_insert.data[0]["id"] if inv_insert.data else None
                if invoice_id:
                    for so_id in linked_so_ids:
                        supabase.table("so_invoice_links").insert({
                            "so_id": so_id,
                            "invoice_id": invoice_id,
                        }).execute()

                    for li in extracted_inv.get("line_items", []):
                        stock_id, _ = find_best_stock_match(
                            li.get("product_name", ""),
                            li.get("gramage"),
                            stock_rows
                        )
                        il = supabase.table("invoice_line_items").insert({
                            "invoice_id": invoice_id,
                            "line_no": li.get("line_no"),
                            "product_name": li.get("product_name"),
                            "gramage": li.get("gramage"),
                            "qty_dispatched": li.get("qty_dispatched", 0),
                            "rate": li.get("rate"),
                            "amount": li.get("amount"),
                            "matched_stock_id": stock_id,
                        }).execute()

                        if il.data and linked_so_ids:
                            for so_id in linked_so_ids:
                                so_lines_res = supabase.table("so_line_items").select(
                                    "id,qty_ordered,product_name,gramage"
                                ).eq("so_id", so_id).execute()
                                so_lines = so_lines_res.data or []

                                # FIX: use gramage-aware matcher instead of raw match_score
                                # This prevents 72g invoice lines updating 80g SO lines
                                best_sol = find_best_so_line_match(li, so_lines)

                                if best_sol:
                                    fr_res = supabase.table("fulfilment_records").select("*").eq(
                                        "so_line_id", best_sol["id"]
                                    ).execute()
                                    if fr_res.data:
                                        fr = fr_res.data[0]
                                        qty_d = li.get("qty_dispatched", 0)
                                        new_d = fr.get("qty_dispatched", 0) + qty_d
                                        qty_o = fr.get("qty_ordered", 0)
                                        qty_p = max(0, qty_o - new_d)
                                        st = "not_sent" if new_d == 0 else (
                                            "fulfilled" if qty_p == 0 else "partial"
                                        )
                                        supabase.table("fulfilment_records").update({
                                            "invoice_line_id": il.data[0]["id"],
                                            "qty_dispatched": new_d,
                                            "qty_pending": qty_p,
                                            "status": st,
                                        }).eq("id", fr["id"]).execute()

                        if stock_id:
                            qty = li.get("qty_dispatched", 0)
                            if qty > 0:
                                sr = supabase.table("warehouse_stock").select("stock_qty").eq(
                                    "id", stock_id
                                ).execute()
                                if sr.data:
                                    new_qty = max(0, sr.data[0].get("stock_qty", 0) - qty)
                                    supabase.table("warehouse_stock").update(
                                        {"stock_qty": new_qty}
                                    ).eq("id", stock_id).execute()

                    for so_id in linked_so_ids:
                        _recompute_so_status(so_id)

                results["invoice"] = f"Invoice {inv_number} loaded"
        else:
            results["invoice"] = "Could not extract invoice number"
    else:
        results["invoice"] = "sample file not found"

    return results