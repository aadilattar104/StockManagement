import os
import shutil
from fastapi import APIRouter, UploadFile, File, HTTPException
from database import supabase
from models import StockUpdateRequest
from services.stock_loader import load_stock_from_xlsx

router = APIRouter(prefix="/api/stock", tags=["stock"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def stock_status(qty: int) -> str:
    if qty == 0:
        return "out"
    elif qty <= 30:
        return "low"
    return "healthy"


@router.post("/upload")
async def upload_stock(file: UploadFile = File(...)):
    if not file.filename.endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are accepted")

    local_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(local_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    rows = load_stock_from_xlsx(local_path)
    if not rows:
        raise HTTPException(400, "No data rows found in XLSX")

    # Upsert each row by title+weight combination
    upserted = []
    for row in rows:
        existing = supabase.table("warehouse_stock").select("id").eq(
            "title", row["title"]
        ).eq("weight", row["weight"] or "").execute()

        if existing.data:
            result = supabase.table("warehouse_stock").update({
                "stock_qty": row["stock_qty"]
            }).eq("id", existing.data[0]["id"]).execute()
            upserted.append(result.data[0] if result.data else None)
        else:
            result = supabase.table("warehouse_stock").insert(row).execute()
            upserted.append(result.data[0] if result.data else None)

    return {"message": f"Upserted {len(upserted)} stock rows", "rows": upserted}


@router.get("")
async def get_stock():
    result = supabase.table("warehouse_stock").select("*").order("title").execute()
    rows = result.data or []
    for row in rows:
        row["status"] = stock_status(row.get("stock_qty", 0))
    return rows


@router.put("/{stock_id}")
async def update_stock(stock_id: str, body: StockUpdateRequest):
    result = supabase.table("warehouse_stock").update(
        {"stock_qty": body.stock_qty}
    ).eq("id", stock_id).execute()
    if not result.data:
        raise HTTPException(404, "Stock row not found")
    row = result.data[0]
    row["status"] = stock_status(row.get("stock_qty", 0))
    return row


@router.delete("/{stock_id}")
async def delete_stock(stock_id: str):
    supabase.table("warehouse_stock").delete().eq("id", stock_id).execute()
    return {"deleted": stock_id}
