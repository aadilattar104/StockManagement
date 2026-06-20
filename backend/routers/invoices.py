import os
import shutil
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException
from database import supabase
from services.pdf_extractor import extract_invoice_pdf
from services.matcher import find_best_stock_match, fuzzy_vendor_match, match_score, find_best_so_line_match

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


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
        pass


def _recompute_so_status(so_id: str):
    # Guard: never overwrite a manually-closed SO — closing is irreversible
    so_check = supabase.table("sales_orders").select("status").eq("id", so_id).execute()
    if so_check.data and so_check.data[0].get("status") == "closed":
        return  # skip recomputation — closed SOs stay closed

    lines_result = supabase.table("so_line_items").select("id,qty_ordered").eq("so_id", so_id).execute()
    lines = lines_result.data or []

    statuses = []
    for line in lines:
        fr_result = supabase.table("fulfilment_records").select("qty_dispatched").eq(
            "so_line_id", line["id"]
        ).execute()
        qty_dispatched = sum(r.get("qty_dispatched", 0) for r in (fr_result.data or []))
        qty_ordered = line.get("qty_ordered", 0)
        qty_pending = max(0, qty_ordered - qty_dispatched)
        if qty_dispatched == 0:
            statuses.append("not_sent")
        elif qty_pending == 0:
            statuses.append("fulfilled")
        else:
            statuses.append("partial")

    if not statuses or all(s == "not_sent" for s in statuses):
        so_status = "open"
    elif all(s == "fulfilled" for s in statuses):
        so_status = "fulfilled"
    else:
        so_status = "partial"

    supabase.table("sales_orders").update({"status": so_status}).eq("id", so_id).execute()
    return so_status


@router.post("/upload")
async def upload_invoice(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        extracted = extract_invoice_pdf(tmp_path)
        if not extracted.get("invoice_number"):
            raise HTTPException(422, "Could not extract Invoice number from PDF")

        # Check duplicate before uploading
        existing = supabase.table("invoices").select("id").eq(
            "invoice_number", extracted["invoice_number"]
        ).execute()
        if existing.data:
            raise HTTPException(409, f"Invoice {extracted['invoice_number']} already exists")

        # Upload PDF to Supabase Storage
        storage_path = f"invoices/{extracted['invoice_number']}.pdf"
        _upload_to_storage(tmp_path, storage_path)

    finally:
        os.unlink(tmp_path)  # always delete local temp file

    # Find linked SOs
    linked_sos = []
    so_reference = extracted.get("so_reference")
    if so_reference:
        so_result = supabase.table("sales_orders").select("*").eq(
            "so_number", so_reference
        ).execute()
        if so_result.data:
            linked_sos = so_result.data

    if not linked_sos and extracted.get("vendor_name"):
        open_sos = supabase.table("sales_orders").select("*").in_(
            "status", ["open", "partial"]
        ).execute()
        linked_sos = fuzzy_vendor_match(extracted["vendor_name"], open_sos.data or [])

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

        # Collect all SO lines from linked SOs, then find best gramage-aware match
        all_so_lines = []
        for so in linked_sos:
            so_lines_result = supabase.table("so_line_items").select("*").eq(
                "so_id", so["id"]
            ).execute()
            all_so_lines.extend(so_lines_result.data or [])

        so_line_match = find_best_so_line_match(li, all_so_lines)

        matched_lines.append({
            **li,
            "matched_stock_id": stock_id,
            "match_score": score,
            "matched_so_line": so_line_match,
        })

    return {
        "extracted": {**extracted, "line_items": matched_lines},
        "linked_sos": linked_sos,
        "pdf_path": storage_path,   # pass back to frontend → confirm sends it
    }


@router.post("/confirm")
async def confirm_invoice(payload: dict):
    data = payload.get("invoice_data", {})
    pdf_path = payload.get("pdf_path", "")
    linked_so_ids = payload.get("linked_so_ids", [])

    invoice_number = data.get("invoice_number")
    if not invoice_number:
        raise HTTPException(400, "invoice_number required")

    # Final duplicate check
    existing = supabase.table("invoices").select("id").eq(
        "invoice_number", invoice_number
    ).execute()
    if existing.data:
        _delete_from_storage(pdf_path)
        raise HTTPException(409, f"Invoice {invoice_number} already exists")

    inv_insert = supabase.table("invoices").insert({
        "invoice_number": invoice_number,
        "invoice_date": data.get("invoice_date"),
        "vendor_name": data.get("vendor_name"),
        "total_qty": data.get("total_qty", 0),
        "total_amount": data.get("total_amount", 0),
        "pdf_path": pdf_path,   # stored in DB so delete can find it later
    }).execute()

    if not inv_insert.data:
        raise HTTPException(500, "Failed to insert invoice")

    invoice_id = inv_insert.data[0]["id"]

    for so_id in linked_so_ids:
        supabase.table("so_invoice_links").insert({
            "so_id": so_id,
            "invoice_id": invoice_id,
        }).execute()

    for li in data.get("line_items", []):
        il_insert = supabase.table("invoice_line_items").insert({
            "invoice_id": invoice_id,
            "line_no": li.get("line_no"),
            "product_name": li.get("product_name"),
            "gramage": li.get("gramage"),
            "qty_dispatched": li.get("qty_dispatched", 0),
            "rate": li.get("rate"),
            "amount": li.get("amount"),
            "matched_stock_id": li.get("matched_stock_id"),
        }).execute()

        invoice_line_id = il_insert.data[0]["id"] if il_insert.data else None

        matched_so_line = li.get("matched_so_line")
        so_line_id = li.get("matched_so_line_id")
        if not so_line_id and isinstance(matched_so_line, dict):
            so_line_id = matched_so_line.get("id")
        if so_line_id and invoice_line_id:
            qty_dispatched = li.get("qty_dispatched", 0)
            fr_result = supabase.table("fulfilment_records").select("*").eq(
                "so_line_id", so_line_id
            ).execute()
            if fr_result.data:
                fr = fr_result.data[0]
                new_dispatched = fr.get("qty_dispatched", 0) + qty_dispatched
                qty_ordered = fr.get("qty_ordered", 0)
                qty_pending = max(0, qty_ordered - new_dispatched)
                status = (
                    "not_sent" if new_dispatched == 0
                    else "fulfilled" if qty_pending == 0
                    else "partial"
                )
                supabase.table("fulfilment_records").update({
                    "invoice_line_id": invoice_line_id,
                    "qty_dispatched": new_dispatched,
                    "qty_pending": qty_pending,
                    "status": status,
                }).eq("id", fr["id"]).execute()

        stock_id = li.get("matched_stock_id")
        qty_dispatched = li.get("qty_dispatched", 0)
        if stock_id and qty_dispatched > 0:
            stock_result = supabase.table("warehouse_stock").select("stock_qty").eq(
                "id", stock_id
            ).execute()
            if stock_result.data:
                current_qty = stock_result.data[0].get("stock_qty", 0)
                supabase.table("warehouse_stock").update(
                    {"stock_qty": max(0, current_qty - qty_dispatched)}
                ).eq("id", stock_id).execute()

    for so_id in linked_so_ids:
        _recompute_so_status(so_id)

    return {"id": invoice_id, "invoice_number": invoice_number}


@router.post("/cancel-upload")
async def cancel_invoice_upload(payload: dict):
    """Call this if user closes preview modal without confirming — cleans up storage."""
    pdf_path = payload.get("pdf_path", "")
    _delete_from_storage(pdf_path)
    return {"deleted": pdf_path}


@router.get("")
async def list_invoices():
    result = supabase.table("invoices").select("*").order("uploaded_at", desc=True).execute()
    invoices = result.data or []

    for inv in invoices:
        links = supabase.table("so_invoice_links").select(
            "so_id, sales_orders(so_number)"
        ).eq("invoice_id", inv["id"]).execute()
        inv["matched_sos"] = [
            {"so_id": l["so_id"], "so_number": l.get("sales_orders", {}).get("so_number")}
            for l in (links.data or [])
        ]

    return invoices


@router.get("/{invoice_id}")
async def get_invoice_detail(invoice_id: str):
    inv_result = supabase.table("invoices").select("*").eq("id", invoice_id).execute()
    if not inv_result.data:
        raise HTTPException(404, "Invoice not found")
    invoice = inv_result.data[0]

    lines_result = supabase.table("invoice_line_items").select(
        "*, warehouse_stock(title, weight, stock_qty)"
    ).eq("invoice_id", invoice_id).execute()
    lines = lines_result.data or []

    links = supabase.table("so_invoice_links").select(
        "so_id, sales_orders(so_number, vendor_name, status)"
    ).eq("invoice_id", invoice_id).execute()
    linked_sos = [
        {**l.get("sales_orders", {}), "so_id": l["so_id"]}
        for l in (links.data or [])
    ]

    return {"invoice": invoice, "line_items": lines, "linked_sos": linked_sos}


@router.delete("/{invoice_id}")
async def delete_invoice(invoice_id: str):
    # Fetch pdf_path before deleting row
    inv_result = supabase.table("invoices").select("pdf_path").eq("id", invoice_id).execute()
    if not inv_result.data:
        raise HTTPException(404, "Invoice not found")

    pdf_path = inv_result.data[0].get("pdf_path", "")

    lines_result = supabase.table("invoice_line_items").select("*").eq(
        "invoice_id", invoice_id
    ).execute()
    lines = lines_result.data or []

    # Reverse stock deductions
    for line in lines:
        stock_id = line.get("matched_stock_id")
        qty = line.get("qty_dispatched", 0)
        if stock_id and qty > 0:
            stock_result = supabase.table("warehouse_stock").select("stock_qty").eq(
                "id", stock_id
            ).execute()
            if stock_result.data:
                current_qty = stock_result.data[0].get("stock_qty", 0)
                supabase.table("warehouse_stock").update(
                    {"stock_qty": current_qty + qty}
                ).eq("id", stock_id).execute()

    # Get linked SO IDs before deleting
    links_result = supabase.table("so_invoice_links").select("so_id").eq(
        "invoice_id", invoice_id
    ).execute()
    linked_so_ids = [l["so_id"] for l in (links_result.data or [])]

    # Reverse fulfilment records
    for line in lines:
        il_id = line.get("id")
        qty = line.get("qty_dispatched", 0)
        fr_result = supabase.table("fulfilment_records").select("*").eq(
            "invoice_line_id", il_id
        ).execute()
        for fr in (fr_result.data or []):
            new_dispatched = max(0, fr.get("qty_dispatched", 0) - qty)
            qty_ordered = fr.get("qty_ordered", 0)
            qty_pending = max(0, qty_ordered - new_dispatched)
            status = "not_sent" if new_dispatched == 0 else ("fulfilled" if qty_pending == 0 else "partial")
            supabase.table("fulfilment_records").update({
                "invoice_line_id": None,
                "qty_dispatched": new_dispatched,
                "qty_pending": qty_pending,
                "status": status,
            }).eq("id", fr["id"]).execute()

    # Delete DB row (cascades invoice_line_items + so_invoice_links)
    supabase.table("invoices").delete().eq("id", invoice_id).execute()

    # Delete PDF from Supabase Storage
    _delete_from_storage(pdf_path)

    # Recompute SO statuses — guard inside _recompute_so_status skips closed SOs
    for so_id in linked_so_ids:
        _recompute_so_status(so_id)

    return {"deleted": invoice_id}

@router.delete("")
async def delete_all_invoices():
    """
    Delete every invoice. For each one:
    - Reverses stock deductions
    - Reverses fulfilment records
    - Recomputes SO statuses (skips closed SOs)
    - Deletes PDF from storage
    """
    all_invoices = supabase.table("invoices").select("id,pdf_path").execute()

    for inv in (all_invoices.data or []):
        invoice_id = inv["id"]

        lines_result = supabase.table("invoice_line_items").select("*").eq(
            "invoice_id", invoice_id
        ).execute()
        lines = lines_result.data or []

        # Reverse stock deductions
        for line in lines:
            stock_id = line.get("matched_stock_id")
            qty = line.get("qty_dispatched", 0)
            if stock_id and qty > 0:
                stock_result = supabase.table("warehouse_stock").select("stock_qty").eq(
                    "id", stock_id
                ).execute()
                if stock_result.data:
                    current_qty = stock_result.data[0].get("stock_qty", 0)
                    supabase.table("warehouse_stock").update(
                        {"stock_qty": current_qty + qty}
                    ).eq("id", stock_id).execute()

        # Reverse fulfilment records
        for line in lines:
            il_id = line.get("id")
            qty = line.get("qty_dispatched", 0)
            fr_result = supabase.table("fulfilment_records").select("*").eq(
                "invoice_line_id", il_id
            ).execute()
            for fr in (fr_result.data or []):
                new_dispatched = max(0, fr.get("qty_dispatched", 0) - qty)
                qty_ordered = fr.get("qty_ordered", 0)
                qty_pending = max(0, qty_ordered - new_dispatched)
                status = "not_sent" if new_dispatched == 0 else ("fulfilled" if qty_pending == 0 else "partial")
                supabase.table("fulfilment_records").update({
                    "invoice_line_id": None,
                    "qty_dispatched": new_dispatched,
                    "qty_pending": qty_pending,
                    "status": status,
                }).eq("id", fr["id"]).execute()

        # Get linked SO IDs before deleting
        links_result = supabase.table("so_invoice_links").select("so_id").eq(
            "invoice_id", invoice_id
        ).execute()
        linked_so_ids = [l["so_id"] for l in (links_result.data or [])]

        # Delete DB row (cascades invoice_line_items + so_invoice_links)
        supabase.table("invoices").delete().eq("id", invoice_id).execute()

        # Delete PDF from storage
        _delete_from_storage(inv.get("pdf_path", ""))

        # Recompute SO statuses
        for so_id in linked_so_ids:
            _recompute_so_status(so_id)

    return {"deleted": "all"}