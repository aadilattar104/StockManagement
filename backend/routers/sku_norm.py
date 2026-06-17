from fastapi import APIRouter, HTTPException
from database import supabase

router = APIRouter(prefix="/api/sku-norm", tags=["sku-norm"])


@router.get("/mappings")
async def get_mappings():
    """Return all mappings joined with warehouse_stock title+weight."""
    res = supabase.table("zypee_sku_mappings").select(
        "id, zypee_sku_name, warehouse_stock_id, created_at"
    ).order("zypee_sku_name").execute()

    mappings = res.data or []

    # Enrich with warehouse stock details
    stock_ids = [m["warehouse_stock_id"] for m in mappings if m.get("warehouse_stock_id")]
    stock_map = {}
    if stock_ids:
        stock_res = supabase.table("warehouse_stock").select(
            "id, title, weight, stock_qty"
        ).in_("id", stock_ids).execute()
        for s in (stock_res.data or []):
            stock_map[s["id"]] = s

    for m in mappings:
        wid = m.get("warehouse_stock_id")
        if wid and wid in stock_map:
            s = stock_map[wid]
            m["warehouse_sku_label"] = f"{s['title']} | {s['weight'] or '—'}"
            m["warehouse_stock_qty"] = s["stock_qty"]
        else:
            m["warehouse_sku_label"] = "Unknown"
            m["warehouse_stock_qty"] = None

    return mappings


@router.post("/mappings")
async def create_mapping(payload: dict):
    """Create a new Zypee SKU → Warehouse SKU mapping."""
    zypee_name = (payload.get("zypee_sku_name") or "").strip()
    warehouse_stock_id = (payload.get("warehouse_stock_id") or "").strip()

    if not zypee_name:
        raise HTTPException(400, "zypee_sku_name is required")
    if not warehouse_stock_id:
        raise HTTPException(400, "warehouse_stock_id is required")

    # Check duplicate zypee name
    existing = supabase.table("zypee_sku_mappings").select("id").eq(
        "zypee_sku_name", zypee_name
    ).execute()
    if existing.data:
        raise HTTPException(409, f"Mapping for '{zypee_name}' already exists. Delete it first to remap.")

    # Verify warehouse stock exists
    stock = supabase.table("warehouse_stock").select("id").eq(
        "id", warehouse_stock_id
    ).execute()
    if not stock.data:
        raise HTTPException(404, "Warehouse stock item not found")

    res = supabase.table("zypee_sku_mappings").insert({
        "zypee_sku_name": zypee_name,
        "warehouse_stock_id": warehouse_stock_id,
    }).execute()

    return res.data[0]


@router.delete("/mappings/{mapping_id}")
async def delete_mapping(mapping_id: str):
    """Delete a mapping by ID."""
    supabase.table("zypee_sku_mappings").delete().eq("id", mapping_id).execute()
    return {"deleted": mapping_id}


@router.get("/compare")
async def compare(date: str):
    """
    Compare Zypee stock vs warehouse stock using saved mappings.
    date: ISO date string (YYYY-MM-DD) — used to fetch zypee_stock for all warehouses.
    Returns:
      - mapped: list of comparison rows
      - unmapped_zypee: Zypee SKUs in uploads for this date with no mapping
      - unassigned_warehouse: warehouse SKUs not mapped to any Zypee SKU
    """
    WAREHOUSES = ["MUM", "PUN", "DEL", "BLR"]

    # 1. Get all mappings
    mappings_res = supabase.table("zypee_sku_mappings").select(
        "id, zypee_sku_name, warehouse_stock_id"
    ).execute()
    mappings = mappings_res.data or []
    zypee_name_to_mapping = {m["zypee_sku_name"]: m for m in mappings}
    mapped_stock_ids = {m["warehouse_stock_id"] for m in mappings}

    # 2. Get Zypee stock for each warehouse on the given date
    zypee_by_wh = {}  # wh -> {name: qty}
    all_zypee_names = set()

    for wh in WAREHOUSES:
        upload = supabase.table("zypee_uploads").select("id").eq(
            "warehouse", wh
        ).eq("stock_date", date).execute()

        if not upload.data:
            zypee_by_wh[wh] = {}
            continue

        upload_id = upload.data[0]["id"]
        rows = supabase.table("zypee_stock").select(
            "name, old_quantity"
        ).eq("upload_id", upload_id).execute()

        wh_map = {}
        for r in (rows.data or []):
            wh_map[r["name"]] = r["old_quantity"]
            all_zypee_names.add(r["name"])
        zypee_by_wh[wh] = wh_map

    # 3. Get all warehouse stock
    stock_res = supabase.table("warehouse_stock").select(
        "id, title, weight, stock_qty"
    ).execute()
    all_warehouse_stock = {s["id"]: s for s in (stock_res.data or [])}

    # 4. Build mapped comparison rows
    mapped_rows = []
    for zypee_name, mapping in zypee_name_to_mapping.items():
        wid = mapping["warehouse_stock_id"]
        ws = all_warehouse_stock.get(wid)
        if not ws:
            continue

        wh_qtys = {wh: zypee_by_wh[wh].get(zypee_name, None) for wh in WAREHOUSES}
        total_zypee = sum(v for v in wh_qtys.values() if v is not None)
        warehouse_qty = ws["stock_qty"] or 0
        difference = warehouse_qty - total_zypee

        mapped_rows.append({
            "mapping_id": mapping["id"],
            "zypee_sku_name": zypee_name,
            "warehouse_sku_label": f"{ws['title']} | {ws['weight'] or '—'}",
            "warehouse_stock_qty": warehouse_qty,
            **{f"zypee_{wh.lower()}": wh_qtys[wh] for wh in WAREHOUSES},
            "total_zypee": total_zypee,
            "difference": difference,
        })

    mapped_rows.sort(key=lambda r: r["zypee_sku_name"])

    # 5. Unmapped Zypee SKUs (present in uploads but no mapping)
    unmapped_zypee = sorted([
        name for name in all_zypee_names
        if name not in zypee_name_to_mapping
    ])

    # 6. Warehouse SKUs not assigned to any Zypee SKU
    unassigned_warehouse = []
    for wid, ws in all_warehouse_stock.items():
        if wid not in mapped_stock_ids:
            unassigned_warehouse.append({
                "id": wid,
                "title": ws["title"],
                "weight": ws["weight"],
                "stock_qty": ws["stock_qty"],
            })
    unassigned_warehouse.sort(key=lambda r: r["title"])

    return {
        "date": date,
        "mapped": mapped_rows,
        "unmapped_zypee": unmapped_zypee,
        "unassigned_warehouse": unassigned_warehouse,
    }
