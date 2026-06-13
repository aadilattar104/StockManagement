import os
import shutil
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException
from database import supabase
from models import VendorUpdateRequest
from services.pdf_extractor import extract_so_pdf
from services.pdf_extractor import extract_so_pdf
from services.matcher import find_best_stock_match

router = APIRouter(prefix="/api/sales-orders", tags=["sales_orders"])


def _upload_to_storage(local_path: str, storage_path: str) -> str:
    """Upload file to Supabase Storage bucket 'uploads'. Returns storage path."""
    with open(local_path, "rb") as f:
        supabase.storage.from_("uploads").upload(
            storage_path,
            f,
            {"content-type": "application/pdf", "upsert": "true"}
        )
    return storage_path


def _delete_from_storage(storage_path: str):
    """Delete file from Supabase Storage bucket 'uploads'."""
    if not storage_path:
        return
    try:
        supabase.storage.from_("uploads").remove([storage_path])
    except Exception:
        pass  # Don't fail the request if storage delete fails


@router.post("/upload")
async def upload_so(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    # Save to temp file for extraction
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        extracted = extract_so_pdf(tmp_path)
        if not extracted.get("so_number"):
            raise HTTPException(422, "Could not extract SO number from PDF")

        # Check duplicate before uploading
        existing = supabase.table("sales_orders").select("id").eq(
            "so_number", extracted["so_number"]
        ).execute()
        if existing.data:
            raise HTTPException(409, f"SO {extracted['so_number']} already exists")

        # Upload PDF to Supabase Storage
        storage_path = f"sales_orders/{extracted['so_number']}.pdf"
        _upload_to_storage(tmp_path, storage_path)

    finally:
        os.unlink(tmp_path)  # always delete local temp file

    # Fetch stock for matching
    stock_result = supabase.table("warehouse_stock").select("id,title,weight").execute()
    stock_rows = stock_result.data or []

    matched_lines = []
    for li in extracted.get("line_items", []):
        stock_id, score = find_best_stock_match(
            li.get("product_name", ""),
            li.get("gramage"),
            stock_rows
        )
        matched_lines.append({**li, "matched_stock_id": stock_id, "match_score": score})

    return {
        "extracted": {**extracted, "line_items": matched_lines},
        "stock_rows": stock_rows,
        "pdf_path": storage_path,   # pass back to frontend → confirm sends it
    }


@router.post("/confirm")
async def confirm_so(payload: dict):
    """Save confirmed SO. pdf_path must be the storage_path returned by /upload."""
    data = payload.get("so_data", {})
    pdf_path = payload.get("pdf_path", "")

    so_number = data.get("so_number")
    if not so_number:
        raise HTTPException(400, "so_number required")

    # Final duplicate check
    existing = supabase.table("sales_orders").select("id").eq(
        "so_number", so_number
    ).execute()
    if existing.data:
        # PDF already in storage — clean it up
        _delete_from_storage(pdf_path)
        raise HTTPException(409, f"SO {so_number} already exists")

    so_insert = supabase.table("sales_orders").insert({
        "so_number": so_number,
        "so_date": data.get("so_date"),
        "vendor_name": data.get("vendor_name"),
        "total_qty": data.get("total_qty", 0),
        "total_amount": data.get("total_amount", 0),
        "status": "open",
        "pdf_path": pdf_path,  # stored in DB so delete can find it later
    }).execute()

    if not so_insert.data:
        raise HTTPException(500, "Failed to insert sales order")

    so_id = so_insert.data[0]["id"]

    for li in data.get("line_items", []):
        supabase.table("so_line_items").insert({
            "so_id": so_id,
            "line_no": li.get("line_no"),
            "product_name": li.get("product_name"),
            "gramage": li.get("gramage"),
            "qty_ordered": li.get("qty_ordered", 0),
            "rate": li.get("rate"),
            "discount_pct": li.get("discount_pct"),
            "amount": li.get("amount"),
            "matched_stock_id": li.get("matched_stock_id"),
        }).execute()

    lines_result = supabase.table("so_line_items").select("id,qty_ordered").eq("so_id", so_id).execute()
    for line in lines_result.data or []:
        supabase.table("fulfilment_records").insert({
            "so_line_id": line["id"],
            "invoice_line_id": None,
            "qty_ordered": line["qty_ordered"],
            "qty_dispatched": 0,
            "qty_pending": line["qty_ordered"],
            "status": "not_sent",
        }).execute()

    return {"id": so_id, "so_number": so_number}


@router.post("/cancel-upload")
async def cancel_so_upload(payload: dict):
    """Call this if user closes the preview modal without confirming — cleans up storage."""
    pdf_path = payload.get("pdf_path", "")
    _delete_from_storage(pdf_path)
    return {"deleted": pdf_path}


@router.get("")
async def list_sales_orders():
    result = supabase.table("sales_orders").select("*").order("uploaded_at", desc=True).execute()
    sos = result.data or []
    enriched = []
    for so in sos:
        so_id = so["id"]
        so_status = so.get("status", "open")
        lines_res = supabase.table("so_line_items").select("id").eq("so_id", so_id).execute()
        line_ids = [l["id"] for l in (lines_res.data or [])]
        qty_pending = 0
        if line_ids:
            fr_res = supabase.table("fulfilment_records").select("qty_pending").in_("so_line_id", line_ids).execute()
            qty_pending = sum(r.get("qty_pending", 0) for r in (fr_res.data or []))
        link_res = supabase.table("so_invoice_links").select("id", count="exact").eq("so_id", so_id).execute()
        has_invoice = (link_res.count or 0) > 0
        if so_status == "fulfilled":
            display_status = "closed"
        elif so_status == "open" and not has_invoice:
            display_status = "invoice_pending"
        else:
            display_status = "partial"
        enriched.append({**so, "qty_pending": qty_pending, "has_invoice": has_invoice, "display_status": display_status})
    return enriched


@router.get("/{so_id}")
async def get_so_detail(so_id: str):
    so_result = supabase.table("sales_orders").select("*").eq("id", so_id).execute()
    if not so_result.data:
        raise HTTPException(404, "Sales order not found")
    so = so_result.data[0]

    lines_result = supabase.table("so_line_items").select(
        "*, warehouse_stock(title, weight, stock_qty)"
    ).eq("so_id", so_id).order("line_no").execute()
    lines = lines_result.data or []

    for line in lines:
        fr_result = supabase.table("fulfilment_records").select("*").eq(
            "so_line_id", line["id"]
        ).execute()
        fr_data = fr_result.data or []
        qty_dispatched = sum(r.get("qty_dispatched", 0) for r in fr_data)
        qty_ordered = line.get("qty_ordered", 0)
        qty_pending = max(0, qty_ordered - qty_dispatched)
        if qty_dispatched == 0:
            status = "not_sent"
        elif qty_pending == 0:
            status = "fulfilled"
        else:
            status = "partial"
        line["fulfilment"] = {
            "qty_ordered": qty_ordered,
            "qty_dispatched": qty_dispatched,
            "qty_pending": qty_pending,
            "status": status,
        }

    links_result = supabase.table("so_invoice_links").select(
        "invoice_id, invoices(invoice_number, invoice_date, total_qty, total_amount)"
    ).eq("so_id", so_id).execute()
    linked_invoices = [
        {**link.get("invoices", {}), "invoice_id": link["invoice_id"]}
        for link in (links_result.data or [])
    ]

    return {"so": so, "line_items": lines, "linked_invoices": linked_invoices}


@router.put("/{so_id}/vendor")
async def update_vendor(so_id: str, body: VendorUpdateRequest):
    result = supabase.table("sales_orders").update(
        {"vendor_name": body.vendor_name}
    ).eq("id", so_id).execute()
    if not result.data:
        raise HTTPException(404, "Sales order not found")
    return result.data[0]


@router.delete("/{so_id}")
async def delete_so(so_id: str):
    # Fetch pdf_path before deleting row
    so_result = supabase.table("sales_orders").select("pdf_path").eq("id", so_id).execute()
    if not so_result.data:
        raise HTTPException(404, "Sales order not found")

    pdf_path = so_result.data[0].get("pdf_path", "")

    # Delete DB row (cascades line items + fulfilment records)
    supabase.table("sales_orders").delete().eq("id", so_id).execute()

    # Delete PDF from Supabase Storage
    _delete_from_storage(pdf_path)

    return {"deleted": so_id}