import re

path = 'routers/sales_orders.py'
content = open(path, 'r', encoding='utf-8').read()

new_func = '''@router.get("")
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
    return enriched'''

# Replace the old list_sales_orders function using regex
pattern = r'@router\.get\(""\)\nasync def list_sales_orders\(\):.*?return result\.data or \[\]'
result = re.sub(pattern, new_func, content, flags=re.DOTALL)

if 'enriched' in result:
    open(path, 'w', encoding='utf-8').write(result)
    print('SUCCESS - file updated')
else:
    print('FAILED - pattern not matched, file unchanged')
