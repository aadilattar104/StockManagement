import os
import shutil
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException
from database import supabase
from models import StockUpdateRequest, ProductMasterEditRequest, ProductMasterReorderRequest
from services.stock_loader import load_stock_from_xlsx

router = APIRouter(prefix="/api/stock", tags=["stock"])


def stock_status(qty: int) -> str:
    if qty == 0:
        return "out"
    elif qty <= 30:
        return "low"
    return "healthy"


def _nullify_stock_references(stock_ids: list):
    """Nullify matched_stock_id in so_line_items and invoice_line_items before deleting stock rows."""
    if not stock_ids:
        return
    supabase.table("so_line_items").update({"matched_stock_id": None}).in_(
        "matched_stock_id", stock_ids
    ).execute()
    supabase.table("invoice_line_items").update({"matched_stock_id": None}).in_(
        "matched_stock_id", stock_ids
    ).execute()


def _next_order_index() -> int:
    res = supabase.table("product_master").select("order_index").order(
        "order_index", desc=True
    ).limit(1).execute()
    if res.data:
        return (res.data[0].get("order_index") or 0) + 1
    return 0


# ─── Upload / Update (unchanged matching logic, is_active removed) ───────────

@router.post("/upload")
async def upload_stock(file: UploadFile = File(...)):
    if not file.filename.endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are accepted")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        rows = load_stock_from_xlsx(tmp_path)
    finally:
        os.unlink(tmp_path)

    if not rows:
        raise HTTPException(400, "No data rows found in XLSX")

    upserted = []
    for row in rows:
        existing = supabase.table("warehouse_stock").select("id").eq(
            "title", row["title"]
        ).eq("weight", row["weight"] or "").execute()

        if existing.data:
            existing_row = existing.data[0]
            result = supabase.table("warehouse_stock").update({
                "stock_qty": row["stock_qty"],
            }).eq("id", existing_row["id"]).execute()
            upserted.append(result.data[0] if result.data else None)
        else:
            # New SKU: land in warehouse_stock only. It will surface under
            # "New Products Detected" in the Product Master until a user
            # approves it — it is never auto-added to the Product Master.
            result = supabase.table("warehouse_stock").insert(row).execute()
            upserted.append(result.data[0] if result.data else None)

    return {"message": f"Upserted {len([u for u in upserted if u])} stock rows"}


@router.post("/update")
async def update_stock_from_xlsx(file: UploadFile = File(...)):
    """
    Update warehouse stock quantities from a fresh Excel file WITHOUT deleting
    or recreating any warehouse_stock rows.

    - Matches existing rows by (title, weight).
    - If matched: updates stock_qty in place, preserving the row's id so all
      FK relationships (Product Master, SO line items, invoice line items,
      fulfilment matrix) keep working.
    - If not matched: inserts a new warehouse_stock row (surfaces under
      "New Products Detected" in the Product Master, same as Upload Stock).
    - Any existing warehouse_stock row NOT present in the uploaded file is
      kept, but its stock_qty is set to 0. It is never deleted.
    """
    if not file.filename.endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are accepted")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        rows = load_stock_from_xlsx(tmp_path)
    finally:
        os.unlink(tmp_path)

    if not rows:
        raise HTTPException(400, "No data rows found in XLSX")

    existing_res = supabase.table("warehouse_stock").select("id,title,weight").execute()
    existing_rows = existing_res.data or []
    existing_by_key = {
        (r["title"], r.get("weight") or ""): r for r in existing_rows
    }

    matched_ids = set()
    updated = []
    inserted = []

    for row in rows:
        key = (row["title"], row["weight"] or "")
        existing_row = existing_by_key.get(key)

        if existing_row:
            result = supabase.table("warehouse_stock").update({
                "stock_qty": row["stock_qty"],
            }).eq("id", existing_row["id"]).execute()

            matched_ids.add(existing_row["id"])
            updated.append(result.data[0] if result.data else None)
        else:
            result = supabase.table("warehouse_stock").insert(row).execute()
            if result.data:
                inserted.append(result.data[0])
                matched_ids.add(result.data[0]["id"])

    stale_ids = [r["id"] for r in existing_rows if r["id"] not in matched_ids]
    if stale_ids:
        supabase.table("warehouse_stock").update({
            "stock_qty": 0,
        }).in_("id", stale_ids).execute()

    return {
        "message": (
            f"Updated {len([u for u in updated if u])} existing rows, "
            f"inserted {len(inserted)} new rows, "
            f"zeroed {len(stale_ids)} rows not present in this upload"
        ),
        "updated_count": len([u for u in updated if u]),
        "inserted_count": len(inserted),
        "zeroed_count": len(stale_ids),
    }


# ─── Stock tab — always driven by Product Master, in Product Master order ───

@router.get("")
async def get_stock():
    """
    Returns the Stock tab rows. Only SKUs approved into the Product Master
    are shown, in the exact Product Master order — Product Master is the
    single source of truth for which SKUs exist anywhere in the app.
    """
    pm_res = supabase.table("product_master").select("*").order("order_index").execute()
    pm_rows = pm_res.data or []

    stock_ids = [r["warehouse_stock_id"] for r in pm_rows if r.get("warehouse_stock_id")]
    stock_map = {}
    if stock_ids:
        stock_res = supabase.table("warehouse_stock").select("*").in_("id", stock_ids).execute()
        stock_map = {s["id"]: s for s in (stock_res.data or [])}

    rows = []
    for pm in pm_rows:
        stock = stock_map.get(pm.get("warehouse_stock_id"), {})
        qty = stock.get("stock_qty", 0)
        rows.append({
            "id": pm.get("warehouse_stock_id"),
            "product_master_id": pm["id"],
            "title": pm["sku_name"],
            "weight": pm.get("weight"),
            "stock_qty": qty,
            "status": stock_status(qty),
            "order_index": pm.get("order_index"),
        })
    return rows


@router.put("/{stock_id}")
async def update_stock(stock_id: str, body: StockUpdateRequest):
    new_qty = body.stock_qty
    result = supabase.table("warehouse_stock").update({
        "stock_qty": new_qty,
    }).eq("id", stock_id).execute()

    if not result.data:
        raise HTTPException(404, "Stock row not found")

    row = result.data[0]
    row["status"] = stock_status(row.get("stock_qty", 0))
    return row


@router.delete("/{stock_id}")
async def delete_stock(stock_id: str):
    # Nullify FK references and remove any Product Master entry pointing here
    _nullify_stock_references([stock_id])
    supabase.table("product_master").delete().eq("warehouse_stock_id", stock_id).execute()
    supabase.table("warehouse_stock").delete().eq("id", stock_id).execute()
    return {"deleted": stock_id}


@router.delete("")
async def delete_all_stock():
    """Delete all rows from warehouse_stock (and the Product Master with it)."""
    all_ids_res = supabase.table("warehouse_stock").select("id").execute()
    all_ids = [r["id"] for r in (all_ids_res.data or [])]
    _nullify_stock_references(all_ids)
    supabase.table("product_master").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()
    supabase.table("warehouse_stock").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()
    return {"deleted": "all"}


@router.post("/delete-selected")
async def delete_selected_stock(payload: dict):
    """Delete selected rows by list of IDs."""
    ids = payload.get("ids", [])
    if not ids:
        raise HTTPException(400, "No IDs provided")
    _nullify_stock_references(ids)
    supabase.table("product_master").delete().in_("warehouse_stock_id", ids).execute()
    supabase.table("warehouse_stock").delete().in_("id", ids).execute()
    return {"deleted": ids}


# ─── Product Master ───────────────────────────────────────────────────────────

@router.get("/product-master")
async def get_product_master():
    """The permanent catalogue, in the user-configured global order."""
    pm_res = supabase.table("product_master").select("*").order("order_index").execute()
    pm_rows = pm_res.data or []

    stock_ids = [r["warehouse_stock_id"] for r in pm_rows if r.get("warehouse_stock_id")]
    stock_map = {}
    if stock_ids:
        stock_res = supabase.table("warehouse_stock").select("id,stock_qty").in_("id", stock_ids).execute()
        stock_map = {s["id"]: s for s in (stock_res.data or [])}

    result = []
    for r in pm_rows:
        stock = stock_map.get(r.get("warehouse_stock_id"), {})
        qty = stock.get("stock_qty", 0)
        result.append({
            "id": r["id"],
            "sku_name": r["sku_name"],
            "weight": r.get("weight"),
            "order_index": r.get("order_index"),
            "warehouse_stock_id": r.get("warehouse_stock_id"),
            "stock_qty": qty,
            "status": stock_status(qty),
        })
    return result


@router.get("/new-products")
async def get_new_products():
    """
    Warehouse SKUs that came in via an upload but have not yet been approved
    into the Product Master. Matched purely by absence from product_master —
    a SKU already linked there never reappears here again.
    """
    pm_res = supabase.table("product_master").select("warehouse_stock_id").execute()
    linked_ids = {r["warehouse_stock_id"] for r in (pm_res.data or []) if r.get("warehouse_stock_id")}

    stock_res = supabase.table("warehouse_stock").select("id,title,weight,stock_qty").execute()
    all_stock = stock_res.data or []

    return [
        {
            "warehouse_stock_id": s["id"],
            "title": s["title"],
            "weight": s.get("weight"),
            "stock_qty": s.get("stock_qty", 0),
        }
        for s in all_stock if s["id"] not in linked_ids
    ]


@router.post("/product-master/{warehouse_stock_id}/approve")
async def approve_product(warehouse_stock_id: str):
    """One-click approval: adds the SKU to the bottom of the Product Master."""
    existing = supabase.table("product_master").select("id").eq(
        "warehouse_stock_id", warehouse_stock_id
    ).execute()
    if existing.data:
        raise HTTPException(400, "This SKU is already in the Product Master")

    stock_res = supabase.table("warehouse_stock").select("id,title,weight").eq(
        "id", warehouse_stock_id
    ).execute()
    if not stock_res.data:
        raise HTTPException(404, "Warehouse stock row not found")
    stock = stock_res.data[0]

    result = supabase.table("product_master").insert({
        "sku_name": stock["title"],
        "weight": stock.get("weight"),
        "warehouse_stock_id": warehouse_stock_id,
        "order_index": _next_order_index(),
    }).execute()

    return result.data[0] if result.data else {}


@router.put("/product-master/{product_id}")
async def edit_product_master(product_id: str, body: ProductMasterEditRequest):
    """Edit the SKU name and/or weight shown everywhere."""
    payload = {}
    if body.sku_name is not None:
        payload["sku_name"] = body.sku_name
    if body.weight is not None:
        payload["weight"] = body.weight
    if not payload:
        raise HTTPException(400, "Nothing to update")

    result = supabase.table("product_master").update(payload).eq("id", product_id).execute()
    if not result.data:
        raise HTTPException(404, "Product not found")
    return result.data[0]


@router.delete("/product-master/{product_id}")
async def delete_product_master(product_id: str):
    """
    Removes a product from the catalogue entirely: the Product Master entry
    and its underlying warehouse_stock row (with FK references nullified
    first, same as the existing Delete Stock behaviour).
    """
    pm_res = supabase.table("product_master").select("warehouse_stock_id").eq(
        "id", product_id
    ).execute()
    if not pm_res.data:
        raise HTTPException(404, "Product not found")
    stock_id = pm_res.data[0].get("warehouse_stock_id")

    supabase.table("product_master").delete().eq("id", product_id).execute()

    if stock_id:
        _nullify_stock_references([stock_id])
        supabase.table("warehouse_stock").delete().eq("id", stock_id).execute()

    return {"deleted": product_id}


@router.post("/product-master/reorder")
async def reorder_product_master(body: ProductMasterReorderRequest):
    """
    Persists a full drag-and-drop (or move up/down) reorder. Expects the
    complete list of product_master IDs in their new order.
    """
    for idx, product_id in enumerate(body.ordered_ids):
        supabase.table("product_master").update({"order_index": idx}).eq(
            "id", product_id
        ).execute()
    return {"reordered": len(body.ordered_ids)}