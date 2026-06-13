from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime


# ── Stock ──────────────────────────────────────────────────────────────────

class StockRowOut(BaseModel):
    id: str
    title: str
    weight: Optional[str] = None
    stock_qty: int
    status: str  # healthy / low / out
    updated_at: Optional[datetime] = None


class StockUpdateRequest(BaseModel):
    stock_qty: int


# ── Sales Orders ───────────────────────────────────────────────────────────

class SOLineItemOut(BaseModel):
    id: str
    line_no: Optional[int] = None
    product_name: str
    gramage: Optional[str] = None
    qty_ordered: int
    rate: Optional[float] = None
    discount_pct: Optional[float] = None
    amount: Optional[float] = None
    matched_stock_id: Optional[str] = None
    matched_stock_title: Optional[str] = None
    # fulfilment fields (joined)
    qty_dispatched: Optional[int] = 0
    qty_pending: Optional[int] = None
    fulfilment_status: Optional[str] = None


class SalesOrderListItem(BaseModel):
    id: str
    so_number: str
    so_date: Optional[str] = None
    vendor_name: Optional[str] = None
    total_qty: Optional[int] = None
    total_amount: Optional[float] = None
    status: str
    uploaded_at: Optional[datetime] = None


class SalesOrderDetail(BaseModel):
    id: str
    so_number: str
    so_date: Optional[str] = None
    vendor_name: Optional[str] = None
    total_qty: Optional[int] = None
    total_amount: Optional[float] = None
    status: str
    uploaded_at: Optional[datetime] = None
    line_items: List[SOLineItemOut] = []
    linked_invoices: List[dict] = []
    stock_snapshot: List[dict] = []


class VendorUpdateRequest(BaseModel):
    vendor_name: str


class SOUploadPreview(BaseModel):
    so_number: Optional[str]
    so_date: Optional[str]
    vendor_name: Optional[str]
    total_qty: int
    total_amount: float
    line_items: list


# ── Invoices ───────────────────────────────────────────────────────────────

class InvoiceLineItemOut(BaseModel):
    id: str
    line_no: Optional[int] = None
    product_name: str
    gramage: Optional[str] = None
    qty_dispatched: int
    rate: Optional[float] = None
    amount: Optional[float] = None
    matched_stock_id: Optional[str] = None
    matched_stock_title: Optional[str] = None
    matched_so_line: Optional[str] = None
    fulfilment_status: Optional[str] = None


class InvoiceListItem(BaseModel):
    id: str
    invoice_number: str
    invoice_date: Optional[str] = None
    vendor_name: Optional[str] = None
    total_qty: Optional[int] = None
    total_amount: Optional[float] = None
    matched_sos: List[str] = []
    uploaded_at: Optional[datetime] = None


class InvoiceDetail(BaseModel):
    id: str
    invoice_number: str
    invoice_date: Optional[str] = None
    vendor_name: Optional[str] = None
    total_qty: Optional[int] = None
    total_amount: Optional[float] = None
    uploaded_at: Optional[datetime] = None
    line_items: List[InvoiceLineItemOut] = []
    matched_sos: List[dict] = []


class InvoiceUploadPreview(BaseModel):
    invoice_number: Optional[str]
    invoice_date: Optional[str]
    vendor_name: Optional[str]
    so_reference: Optional[str]
    total_qty: int
    total_amount: float
    line_items: list
    matched_so: Optional[dict] = None
