from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime


class StockRow(BaseModel):
    id: Optional[str] = None
    title: str
    weight: Optional[str] = None
    stock_qty: int = 0
    updated_at: Optional[datetime] = None


class StockUpdateRequest(BaseModel):
    stock_qty: int


class SOLineItemIn(BaseModel):
    line_no: Optional[int] = None
    product_name: str
    gramage: Optional[str] = None
    qty_ordered: int
    rate: Optional[float] = None
    discount_pct: Optional[float] = None
    amount: Optional[float] = None
    matched_stock_id: Optional[str] = None


class SalesOrderIn(BaseModel):
    so_number: str
    so_date: Optional[str] = None
    vendor_name: Optional[str] = None
    total_qty: Optional[int] = None
    total_amount: Optional[float] = None
    line_items: List[SOLineItemIn] = []


class VendorUpdateRequest(BaseModel):
    vendor_name: str


class InvoiceLineItemIn(BaseModel):
    line_no: Optional[int] = None
    product_name: str
    gramage: Optional[str] = None
    qty_dispatched: int
    rate: Optional[float] = None
    amount: Optional[float] = None
    matched_stock_id: Optional[str] = None


class InvoiceIn(BaseModel):
    invoice_number: str
    invoice_date: Optional[str] = None
    vendor_name: Optional[str] = None
    so_reference: Optional[str] = None
    total_qty: Optional[int] = None
    total_amount: Optional[float] = None
    line_items: List[InvoiceLineItemIn] = []
