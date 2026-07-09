import os
import shutil
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException
from database import supabase
from models import StockUpdateRequest, StockActiveToggleRequest
from services.stock_loader import load_stock_from_xlsx

router = APIRouter(prefix="/api/stock", tags=["stock"])


def stock_status(qty: int) -> str:
    if qty == 0:
        return "out"
    elif qty <= 30:
        return "low"
    return "healthy"


def compute_is_active(stock_qty: int, manual_is_active) -> bool:
    if stock_qty > 0:
        return True
    if manual_is_active is None:
        return False
    return bool(manual_is_active)


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
        existing = supabase.table("warehouse_stock").select("id,is_active").eq(
            "title", row["title"]
        ).eq("weight", row["weight"] or "").execute()

        if existing.data:
            existing_row = existing.data[0]
            stock_qty = row["stock_qty"]
            if stock_qty > 0:
                new_is_active = True
            else:
                new_is_active = existing_row.get("is_active", False)

            result = supabase.table("warehouse_stock").update({
                "stock_qty": stock_qty,
                "is_active": new_is_active,
            }).eq("id", existing_row["id"]).execute()
            upserted.append(result.data[0] if result.data else None)
        else:
            row["is_active"] = row["stock_qty"] > 0
            result = supabase.table("warehouse_stock").insert(row).execute()
            upserted.append(result.data[0] if result.data else None)

    return {"message": f"Upserted {len([u for u in upserted if u])} stock rows"}


@router.post("/update")
async def update_stock_from_xlsx(file: UploadFile = File(...)):
    """
    Update warehouse stock quantities from a fresh Excel file WITHOUT deleting
    or recreating any warehouse_stock rows.

    - Matches existing rows by (title, weight).
    - If matched: updates stock_qty (and is_active) in place, preserving the
      row's id so all FK relationships (Zypee SKU mapping, SO line items,
      invoice line items, fulfilment matrix) keep working.
    - If not matched: inserts a new warehouse_stock row (same as Upload Stock).
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

    # Snapshot all existing rows once, so we can (a) match efficiently and
    # (b) know which ones weren't touched by this upload.
    existing_res = supabase.table("warehouse_stock").select("id,title,weight,is_active").execute()
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
            stock_qty = row["stock_qty"]
            if stock_qty > 0:
                new_is_active = True
            else:
                new_is_active = existing_row.get("is_active", False)

            result = supabase.table("warehouse_stock").update({
                "stock_qty": stock_qty,
                "is_active": new_is_active,
            }).eq("id", existing_row["id"]).execute()

            matched_ids.add(existing_row["id"])
            updated.append(result.data[0] if result.data else None)
        else:
            row["is_active"] = row["stock_qty"] > 0
            result = supabase.table("warehouse_stock").insert(row).execute()
            if result.data:
                inserted.append(result.data[0])
                matched_ids.add(result.data[0]["id"])

    # Rows that existed before but weren't present in this upload:
    # zero out their qty, but never delete them and never touch anything else.
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


@router.get("")
async def get_stock():
    result = supabase.table("warehouse_stock").select("*").order("title").execute()
    rows = result.data or []
    for row in rows:
        row["status"] = stock_status(row.get("stock_qty", 0))
        if row.get("stock_qty", 0) > 0:
            row["is_active"] = True
    return rows


@router.put("/{stock_id}")
async def update_stock(stock_id: str, body: StockUpdateRequest):
    new_qty = body.stock_qty
    update_payload = {"stock_qty": new_qty}
    if new_qty > 0:
        update_payload["is_active"] = True

    result = supabase.table("warehouse_stock").update(update_payload).eq(
        "id", stock_id
    ).execute()

    if not result.data:
        raise HTTPException(404, "Stock row not found")

    row = result.data[0]
    row["status"] = stock_status(row.get("stock_qty", 0))
    if row.get("stock_qty", 0) > 0:
        row["is_active"] = True
    return row


@router.put("/{stock_id}/toggle-active")
async def toggle_sku_active(stock_id: str, body: StockActiveToggleRequest):
    current = supabase.table("warehouse_stock").select("stock_qty").eq(
        "id", stock_id
    ).execute()

    if not current.data:
        raise HTTPException(404, "Stock row not found")

    stock_qty = current.data[0].get("stock_qty", 0)

    if stock_qty > 0:
        raise HTTPException(400, "Cannot mark inactive: stock qty is greater than 0. Set qty to 0 first.")

    result = supabase.table("warehouse_stock").update({
        "is_active": body.is_active
    }).eq("id", stock_id).execute()

    if not result.data:
        raise HTTPException(404, "Stock row not found")

    row = result.data[0]
    row["status"] = stock_status(row.get("stock_qty", 0))
    return row


@router.delete("/{stock_id}")
async def delete_stock(stock_id: str):
    # Nullify FK references before deleting
    _nullify_stock_references([stock_id])
    supabase.table("warehouse_stock").delete().eq("id", stock_id).execute()
    return {"deleted": stock_id}


@router.delete("")
async def delete_all_stock():
    """Delete all rows from warehouse_stock."""
    # Get all IDs first, then nullify references
    all_ids_res = supabase.table("warehouse_stock").select("id").execute()
    all_ids = [r["id"] for r in (all_ids_res.data or [])]
    _nullify_stock_references(all_ids)
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
    supabase.table("warehouse_stock").delete().in_("id", ids).execute()
    return {"deleted": ids}