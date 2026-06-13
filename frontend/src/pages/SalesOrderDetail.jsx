import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSalesOrder, updateSOVendor } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import { ArrowLeft, Pencil, Check, X, ExternalLink } from 'lucide-react'

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const TABS = ['Fulfilment Tally', 'Linked Invoices', 'Stock Snapshot']

export default function SalesOrderDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['sales-order', id],
    queryFn: () => getSalesOrder(id)
  })
  const [tab, setTab] = useState(0)
  const [editingVendor, setEditingVendor] = useState(false)
  const [vendorVal, setVendorVal] = useState('')

  const vendorMut = useMutation({
    mutationFn: (v) => updateSOVendor(id, v),
    onSuccess: () => { qc.invalidateQueries(['sales-order', id]); setEditingVendor(false) }
  })

  if (isLoading) return <Spinner />
  if (error) return <p className="p-8 text-red-400 text-sm">{error.message}</p>

  const { so, line_items, linked_invoices } = data

  const totalOrdered    = line_items.reduce((s, l) => s + (l.fulfilment?.qty_ordered ?? 0), 0)
  const totalDispatched = line_items.reduce((s, l) => s + (l.fulfilment?.qty_dispatched ?? 0), 0)
  const totalPending    = line_items.reduce((s, l) => s + (l.fulfilment?.qty_pending ?? 0), 0)

  // Stock snapshot: unique SKUs from this SO
  const skuMap = {}
  line_items.forEach(l => {
    if (l.warehouse_stock && l.matched_stock_id) {
      skuMap[l.matched_stock_id] = l.warehouse_stock
    }
  })
  const skus = Object.values(skuMap)

  return (
    <div className="px-8 py-8 max-w-7xl space-y-6">
      {/* Back */}
      <Link to="/sales-orders" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors">
        <ArrowLeft className="w-4 h-4" /> All Sales Orders
      </Link>

      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-slate-100 font-mono">{so.so_number}</h1>
              <StatusBadge status={so.status} />
            </div>
            <p className="text-sm text-slate-400">{fmt(so.so_date)}</p>
            {/* Vendor inline edit */}
            <div className="flex items-center gap-2 mt-2">
              {editingVendor ? (
                <>
                  <input
                    className="input w-64 text-sm"
                    value={vendorVal}
                    onChange={e => setVendorVal(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') vendorMut.mutate(vendorVal)
                      if (e.key === 'Escape') setEditingVendor(false)
                    }}
                    autoFocus
                  />
                  <button onClick={() => vendorMut.mutate(vendorVal)} className="p-1.5 text-brand-400 hover:bg-brand-600/10 rounded">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingVendor(false)} className="p-1.5 text-slate-400 hover:bg-slate-700 rounded">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-sm text-slate-300">{so.vendor_name || 'No vendor'}</span>
                  <button onClick={() => { setEditingVendor(true); setVendorVal(so.vendor_name || '') }}
                    className="p-1 text-slate-500 hover:text-slate-300 transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
          {/* Summary bar */}
          <div className="flex gap-6">
            {[
              { label: 'Ordered',    value: totalOrdered,    color: 'text-slate-200' },
              { label: 'Dispatched', value: totalDispatched, color: 'text-brand-400' },
              { label: 'Pending',    value: totalPending,    color: totalPending > 0 ? 'text-amber-400' : 'text-slate-500' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-800 flex gap-0">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px
              ${tab === i ? 'border-brand-500 text-brand-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab 0: Fulfilment Tally */}
      {tab === 0 && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="table-head px-4 py-3 text-left">#</th>
                <th className="table-head px-4 py-3 text-left">Product</th>
                <th className="table-head px-4 py-3 text-left">Gramage</th>
                <th className="table-head px-4 py-3 text-right">Ordered</th>
                <th className="table-head px-4 py-3 text-right">Dispatched</th>
                <th className="table-head px-4 py-3 text-right">Pending</th>
                <th className="table-head px-4 py-3 text-left">Status</th>
                <th className="table-head px-4 py-3 text-left">Matched SKU</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {line_items.map((li, i) => {
                const f = li.fulfilment || {}
                const rowBg =
                  f.status === 'fulfilled' ? 'bg-emerald-950/20' :
                  f.status === 'partial'   ? 'bg-amber-950/20' :
                  f.status === 'not_sent'  ? 'bg-red-950/10' : ''
                return (
                  <tr key={li.id} className={`${rowBg} hover:brightness-110 transition-all`}>
                    <td className="table-cell text-slate-500 text-xs">{li.line_no ?? i + 1}</td>
                    <td className="table-cell font-medium text-slate-200">{li.product_name}</td>
                    <td className="table-cell font-mono text-xs text-slate-400">{li.gramage || '—'}</td>
                    <td className="table-cell text-right font-mono">{f.qty_ordered ?? li.qty_ordered}</td>
                    <td className="table-cell text-right font-mono text-brand-400">{f.qty_dispatched ?? 0}</td>
                    <td className="table-cell text-right font-mono text-amber-400">{f.qty_pending ?? f.qty_ordered ?? 0}</td>
                    <td className="table-cell"><StatusBadge status={f.status || 'not_sent'} type="fulfilment" /></td>
                    <td className="table-cell text-xs text-slate-400">
                      {li.warehouse_stock?.title || '—'}
                      {li.warehouse_stock?.weight ? <span className="text-slate-600 ml-1">{li.warehouse_stock.weight}</span> : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 1: Linked Invoices */}
      {tab === 1 && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="table-head px-4 py-3 text-left">Invoice #</th>
                <th className="table-head px-4 py-3 text-left">Date</th>
                <th className="table-head px-4 py-3 text-right">Qty Dispatched</th>
                <th className="table-head px-4 py-3 text-right">Amount</th>
                <th className="table-head px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {linked_invoices.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10 text-slate-500 text-sm">No invoices linked to this SO yet.</td></tr>
              )}
              {linked_invoices.map(inv => (
                <tr key={inv.invoice_id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="table-cell font-mono text-slate-200">{inv.invoice_number}</td>
                  <td className="table-cell text-slate-400">{fmt(inv.invoice_date)}</td>
                  <td className="table-cell text-right font-mono text-brand-400">{inv.total_qty}</td>
                  <td className="table-cell text-right font-mono text-slate-400">₹{inv.total_amount?.toLocaleString('en-IN') || '—'}</td>
                  <td className="table-cell text-right">
                    <Link to={`/invoices/${inv.invoice_id}`}
                      className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300">
                      View <ExternalLink className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Stock Snapshot */}
      {tab === 2 && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="table-head px-4 py-3 text-left">SKU Title</th>
                <th className="table-head px-4 py-3 text-left">Weight</th>
                <th className="table-head px-4 py-3 text-right">Current Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {skus.length === 0 && (
                <tr><td colSpan={3} className="text-center py-10 text-slate-500 text-sm">No matched warehouse SKUs.</td></tr>
              )}
              {skus.map((sku, i) => (
                <tr key={i} className="hover:bg-slate-800/30">
                  <td className="table-cell text-slate-200">{sku.title}</td>
                  <td className="table-cell text-slate-400 font-mono text-xs">{sku.weight || '—'}</td>
                  <td className="table-cell text-right">
                    <span className={`font-mono font-semibold ${
                      sku.stock_qty === 0 ? 'text-red-400' :
                      sku.stock_qty <= 30 ? 'text-amber-400' : 'text-brand-400'
                    }`}>{sku.stock_qty}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
