import os
from collections import defaultdict
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
    allow_origins=["http://localhost:5173", "https://stockmanagement-nu.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

    low_stock = supabase.table("warehouse_stock").select("id", count="exact").lte(
        "stock_qty", 30
    ).gt("stock_qty", 0).eq("is_active", True).execute()

    out_stock = supabase.table("warehouse_stock").select("id", count="exact").eq(
        "stock_qty", 0
    ).eq("is_active", True).execute()

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

    low_stock_detail = supabase.table("warehouse_stock").select("*").lte(
        "stock_qty", 30
    ).eq("is_active", True).order("stock_qty").limit(5).execute()
    for row in (low_stock_detail.data or []):
        from routers.stock import stock_status
        row["status"] = stock_status(row.get("stock_qty", 0))

    return {
        "open_sos": open_sos.count or 0,
        "pending_units": total_pending,
        "low_stock_skus": (low_stock.count or 0) + (out_stock.count or 0),
        "invoices_processed": invoices_count.count or 0,
        "recent_sos": enriched_recent_sos,
        "low_stock_detail": low_stock_detail.data or [],
    }


@app.get("/api/dashboard/fulfilment-matrix")
async def fulfilment_matrix():
    """
    Pivot matrix: ALL active SKUs as rows, open/partial SOs as columns.
    - Rows = every active warehouse_stock row (is_active=True), even with zero demand.
    - Per-SO columns = static qty_ordered (original order, never changes after dispatch).
    - qty_to_be_sent = live sum of fulfilment_records.qty_pending across open/partial SOs.
    """
    # 1. All active SKUs — this is now the base row set
    stock_res = supabase.table("warehouse_stock") \
        .select("id,title,weight,stock_qty") \
        .eq("is_active", True).execute()
    all_stock = stock_res.data or []
    stock_map = {s["id"]: s for s in all_stock}

    # 2. All open/partial SOs (closed/fulfilled excluded — their demand is done)
    sos_res = supabase.table("sales_orders").select("id,so_number,vendor_name") \
        .in_("status", ["open", "partial"]).order("uploaded_at").execute()
    sos = sos_res.data or []
    so_ids = [s["id"] for s in sos]

    # Build pivot structures (empty by default — filled in if there are open SOs)
    # so_qtys[sku_id][so_id] = static qty_ordered
    so_qtys: dict = defaultdict(lambda: defaultdict(int))
    # pending[sku_id] = sum of qty_pending from fulfilment_records
    pending: dict = defaultdict(int)

    if so_ids:
        # 3. SO line items for open/partial SOs — for the static per-SO columns
        lines_res = supabase.table("so_line_items") \
            .select("id,so_id,matched_stock_id,qty_ordered") \
            .in_("so_id", so_ids).execute()
        lines = lines_res.data or []

        # Build line_id -> matched_stock_id index for the fulfilment lookup
        line_id_to_stock: dict = {}
        for line in lines:
            sid = line.get("matched_stock_id")
            if sid and sid in stock_map:
                so_qtys[sid][line["so_id"]] += line.get("qty_ordered", 0)
                line_id_to_stock[line["id"]] = sid

        # 4. Fulfilment records for those lines — for the live qty_to_be_sent
        if line_id_to_stock:
            line_ids = list(line_id_to_stock.keys())
            fr_res = supabase.table("fulfilment_records") \
                .select("so_line_id,qty_pending") \
                .in_("so_line_id", line_ids).execute()
            for fr in (fr_res.data or []):
                stock_id = line_id_to_stock.get(fr["so_line_id"])
                if stock_id:
                    pending[stock_id] += fr.get("qty_pending", 0)

    # 5. Build rows — one per active SKU, even with zero demand
    rows = []
    for sku in all_stock:
        sku_id = sku["id"]
        qty_to_be_sent = pending.get(sku_id, 0)
        rows.append({
            "sku_id": sku_id,
            "sku_title": sku.get("title", "Unknown SKU"),
            "sku_weight": sku.get("weight"),
            "warehouse_stock": sku.get("stock_qty", 0),
            "qty_to_be_sent": qty_to_be_sent,
            "so_qtys": dict(so_qtys.get(sku_id, {})),
        })

    # 6. Sort: falling short first (stock < demand), then alphabetical
    rows.sort(key=lambda r: (r["warehouse_stock"] >= r["qty_to_be_sent"], r["sku_title"]))

    return {
        "so_columns": [
            {"so_id": s["id"], "so_number": s["so_number"], "vendor_name": s["vendor_name"]}
            for s in sos
        ],
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
                # Only match against active stock
                stock_result = supabase.table("warehouse_stock").select(
                    "id,title,weight"
                ).eq("is_active", True).execute()
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

                # Only match against active stock
                stock_result = supabase.table("warehouse_stock").select(
                    "id,title,weight"
                ).eq("is_active", True).execute()
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