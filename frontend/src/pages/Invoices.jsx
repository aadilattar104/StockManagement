import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getInvoices, getInvoice, uploadInvoice, confirmInvoice, deleteInvoice, cancelInvoiceUpload, deleteAllInvoices } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import UploadZone from '../components/UploadZone'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { Link } from 'react-router-dom'
import { Upload, Eye, Trash2, Check, ExternalLink, ArrowLeft, Trash } from 'lucide-react'

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function Invoices() {
  const qc = useQueryClient()
  const { data: invoices = [], isLoading } = useQuery({ queryKey: ['invoices'], queryFn: getInvoices })

  const [showUpload, setShowUpload] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [pdfPath, setPdfPath] = useState('')
  const [linkedSos, setLinkedSos] = useState([])
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteAll, setDeleteAll] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [error, setError] = useState(null)

  const uploadMut = useMutation({
    mutationFn: uploadInvoice,
    onSuccess: (data) => {
      setPreviewData(data.extracted)
      setPdfPath(data.pdf_path || '')
      setLinkedSos(data.linked_sos || [])
      setShowUpload(false)
      setError(null)
    },
    onError: (e) => setError(e.message)
  })

  const confirmMut = useMutation({
    mutationFn: () => confirmInvoice(previewData, pdfPath, linkedSos.map(s => s.id)),
    onSuccess: () => {
      qc.invalidateQueries(['invoices'])
      qc.invalidateQueries(['sales-orders'])
      qc.invalidateQueries(['stock'])
      qc.invalidateQueries(['dashboard'])
      setPreviewData(null)
      setPdfPath('')
    },
    onError: (e) => setError(e.message)
  })

  const deleteMut = useMutation({
    mutationFn: deleteInvoice,
    onSuccess: () => {
      qc.invalidateQueries(['invoices'])
      qc.invalidateQueries(['sales-orders'])
      qc.invalidateQueries(['stock'])
      qc.invalidateQueries(['dashboard'])
      setDeleteTarget(null)
    }
  })

  const deleteAllMut = useMutation({
    mutationFn: deleteAllInvoices,
    onSuccess: () => {
      qc.invalidateQueries(['invoices'])
      qc.invalidateQueries(['sales-orders'])
      qc.invalidateQueries(['stock'])
      qc.invalidateQueries(['dashboard'])
      setDeleteAll(false)
    }
  })

  // Called when user closes preview modal without confirming
  function handleCancelPreview() {
    if (pdfPath) {
      cancelInvoiceUpload(pdfPath)  // fire-and-forget — delete from Supabase Storage
    }
    setPreviewData(null)
    setPdfPath('')
    setLinkedSos([])
  }

  return (
    <div className="px-8 py-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Invoices</h1>
          <p className="text-sm text-slate-500 mt-1">{invoices.length} invoices processed</p>
        </div>
        <div className="flex items-center gap-2">
          {invoices.length > 0 && (
            <button onClick={() => setDeleteAll(true)} className="btn-danger flex items-center gap-1.5">
              <Trash className="w-4 h-4" /> Delete All
            </button>
          )}
          <button onClick={() => setShowUpload(!showUpload)} className="btn-primary">
            <Upload className="w-4 h-4" /> Upload Tax Invoice
          </button>
        </div>
      </div>

      {showUpload && (
        <div className="card p-5">
          <UploadZone
            accept=".pdf"
            label="Upload Tax Invoice PDF"
            onFile={(f) => uploadMut.mutate(f)}
            loading={uploadMut.isPending}
          />
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="table-head px-4 py-3 text-left">Invoice #</th>
              <th className="table-head px-4 py-3 text-left">Date</th>
              <th className="table-head px-4 py-3 text-left">Vendor</th>
              <th className="table-head px-4 py-3 text-right">Dispatched</th>
              <th className="table-head px-4 py-3 text-left">Matched SO(s)</th>
              <th className="table-head px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {isLoading && <tr><td colSpan={6} className="text-center py-12 text-slate-500 text-sm">Loading…</td></tr>}
            {!isLoading && invoices.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-slate-500 text-sm">No invoices yet. Upload a Tax Invoice PDF.</td></tr>
            )}
            {invoices.map(inv => (
              <tr key={inv.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="table-cell font-mono text-slate-200">{inv.invoice_number}</td>
                <td className="table-cell text-slate-400">{fmt(inv.invoice_date)}</td>
                <td className="table-cell text-slate-300">{inv.vendor_name || '—'}</td>
                <td className="table-cell text-right font-mono text-brand-400">{inv.total_qty}</td>
                <td className="table-cell">
                  <div className="flex flex-wrap gap-1">
                    {(inv.matched_sos || []).map(s => (
                      <Link key={s.so_id} to={`/sales-orders/${s.so_id}`}
                        className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded font-mono transition-colors">
                        {s.so_number}
                      </Link>
                    ))}
                    {(!inv.matched_sos?.length) && <span className="text-xs text-slate-500">—</span>}
                  </div>
                </td>
                <td className="table-cell text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => setDetailId(inv.id)}
                      className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors"
                      title="View detail">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setDeleteTarget(inv)}
                      className="p-1.5 hover:bg-red-900/30 rounded text-slate-400 hover:text-red-400 transition-colors"
                      title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Upload Preview Modal */}
      {/* onClose calls handleCancelPreview so PDF is deleted from storage if user doesn't confirm */}
      <Modal open={!!previewData} onClose={handleCancelPreview} title="Review Tax Invoice — Confirm to Deduct Stock" size="xl">
        {previewData && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-4 p-4 bg-slate-800/40 rounded-lg">
              <div>
                <p className="text-xs text-slate-500">Invoice Number</p>
                <p className="font-mono text-slate-200 mt-0.5">{previewData.invoice_number}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Date</p>
                <p className="text-slate-200 mt-0.5">{fmt(previewData.invoice_date)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Vendor</p>
                <p className="text-slate-200 mt-0.5">{previewData.vendor_name || '—'}</p>
              </div>
            </div>

            {linkedSos.length > 0 && (
              <div className="p-3 bg-brand-600/10 border border-brand-700/30 rounded-lg">
                <p className="text-xs text-slate-400 mb-1.5">Matched Sales Order(s):</p>
                <div className="flex gap-2 flex-wrap">
                  {linkedSos.map(so => (
                    <span key={so.id} className="text-xs bg-brand-700/20 text-brand-300 border border-brand-700/30 px-2 py-1 rounded font-mono">
                      {so.so_number} · {so.vendor_name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {linkedSos.length === 0 && (
              <div className="p-3 bg-amber-900/20 border border-amber-800/40 rounded-lg">
                <p className="text-xs text-amber-300">⚠ No matching Sales Order found. Stock will still be deducted if SKUs match.</p>
              </div>
            )}

            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Invoice Lines vs Matched SO Lines</p>
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80">
                      <th className="table-head px-3 py-2 text-left">#</th>
                      <th className="table-head px-3 py-2 text-left">Invoice Product</th>
                      <th className="table-head px-3 py-2 text-left">Gramage</th>
                      <th className="table-head px-3 py-2 text-right">Qty</th>
                      <th className="table-head px-3 py-2 text-left">Matched SO Line</th>
                      <th className="table-head px-3 py-2 text-left">Matched SKU</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {(previewData.line_items || []).map((li, i) => (
                      <tr key={i} className="hover:bg-slate-800/20">
                        <td className="px-3 py-2 text-slate-500 text-xs">{li.line_no ?? i + 1}</td>
                        <td className="px-3 py-2 text-slate-200">{li.product_name}</td>
                        <td className="px-3 py-2 text-xs font-mono text-slate-400">{li.gramage || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-brand-400">{li.qty_dispatched}</td>
                        <td className="px-3 py-2 text-xs text-slate-400">
                          {li.matched_so_line?.product_name || <span className="text-slate-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {li.matched_stock_id
                            ? <span className="text-brand-400">✓ Matched</span>
                            : <span className="text-slate-600">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex justify-end gap-3">
              {/* Cancel button also calls handleCancelPreview to clean up storage */}
              <button onClick={handleCancelPreview} className="btn-secondary">Cancel</button>
              <button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending} className="btn-primary">
                <Check className="w-4 h-4" />
                {confirmMut.isPending ? 'Saving…' : 'Confirm & Deduct Stock'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {detailId && (
        <InvoiceDetailModal id={detailId} onClose={() => setDetailId(null)} />
      )}

      <ConfirmDialog
        open={deleteAll}
        onClose={() => setDeleteAll(false)}
        onConfirm={() => deleteAllMut.mutate()}
        title="Delete All Invoices?"
        message={`This will permanently remove all ${invoices.length} invoices.`}
        warning="This will reverse all stock deductions and reopen all affected Sales Orders."
        loading={deleteAllMut.isPending}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        title="Delete Invoice?"
        message={`Remove invoice ${deleteTarget?.invoice_number}?`}
        warning="This will reverse all stock deductions made by this invoice and reopen the affected Sales Orders."
        loading={deleteMut.isPending}
      />
    </div>
  )
}

function InvoiceDetailModal({ id, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => getInvoice(id)
  })

  function fmt(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return (
    <Modal open onClose={onClose} title="Invoice Detail" size="lg">
      {isLoading && <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>}
      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 p-4 bg-slate-800/40 rounded-lg">
            <div><p className="text-xs text-slate-500">Invoice #</p><p className="font-mono text-slate-200 mt-0.5">{data.invoice.invoice_number}</p></div>
            <div><p className="text-xs text-slate-500">Date</p><p className="text-slate-200 mt-0.5">{fmt(data.invoice.invoice_date)}</p></div>
            <div><p className="text-xs text-slate-500">Vendor</p><p className="text-slate-300 mt-0.5">{data.invoice.vendor_name || '—'}</p></div>
            <div><p className="text-xs text-slate-500">Total Qty</p><p className="font-mono text-brand-400 mt-0.5">{data.invoice.total_qty}</p></div>
          </div>

          {data.linked_sos?.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {data.linked_sos.map(so => (
                <Link key={so.so_id} to={`/sales-orders/${so.so_id}`} onClick={onClose}
                  className="inline-flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded font-mono">
                  {so.so_number} <StatusBadge status={so.status} /> <ExternalLink className="w-3 h-3" />
                </Link>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/80">
                  <th className="table-head px-3 py-2 text-left">Product</th>
                  <th className="table-head px-3 py-2 text-left">Gramage</th>
                  <th className="table-head px-3 py-2 text-right">Qty</th>
                  <th className="table-head px-3 py-2 text-left">Matched SKU</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {(data.line_items || []).map((li, i) => (
                  <tr key={i} className="hover:bg-slate-800/20">
                    <td className="px-3 py-2 text-slate-200">{li.product_name}</td>
                    <td className="px-3 py-2 text-xs font-mono text-slate-400">{li.gramage || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-brand-400">{li.qty_dispatched}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {li.warehouse_stock ? `${li.warehouse_stock.title} ${li.warehouse_stock.weight || ''}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}