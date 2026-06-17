import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSalesOrders, uploadSalesOrder, uploadSalesOrdersBulk, confirmSalesOrder, deleteSalesOrder, cancelSalesOrderUpload } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import UploadZone from '../components/UploadZone'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { Link } from 'react-router-dom'
import { Upload, Eye, Trash2, Check, AlertTriangle } from 'lucide-react'

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function SalesOrders() {
  const qc = useQueryClient()
  const { data: orders = [], isLoading } = useQuery({ queryKey: ['sales-orders'], queryFn: getSalesOrders })

  const [previewData, setPreviewData] = useState(null)
  const [pdfPath, setPdfPath] = useState('')
  const [editedVendor, setEditedVendor] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [error, setError] = useState(null)

  const uploadMut = useMutation({
    mutationFn: uploadSalesOrder,
    onSuccess: (data) => {
      setPreviewData(data.extracted)
      setPdfPath(data.pdf_path || '')
      setEditedVendor(data.extracted.vendor_name || '')
      setShowUpload(false)
    },
    onError: (e) => setError(e.message)
  })

  const bulkUploadMut = useMutation({
    mutationFn: uploadSalesOrdersBulk,
    onSuccess: () => {
      qc.invalidateQueries(['sales-orders'])
      setShowUpload(false)
      setError(null)
    },
    onError: (e) => setError(e.message)
  })

  const confirmMut = useMutation({
    mutationFn: () => confirmSalesOrder({ ...previewData, vendor_name: editedVendor }, pdfPath),
    onSuccess: () => {
      qc.invalidateQueries(['sales-orders'])
      setPreviewData(null)
      setPdfPath('')
    },
    onError: (e) => setError(e.message)
  })

  const deleteMut = useMutation({
    mutationFn: deleteSalesOrder,
    onSuccess: () => { qc.invalidateQueries(['sales-orders']); setDeleteTarget(null) }
  })

  // Called when user closes preview modal without confirming
  function handleCancelPreview() {
    if (pdfPath) {
      cancelSalesOrderUpload(pdfPath)  // fire-and-forget — delete from Supabase Storage
    }
    setPreviewData(null)
    setPdfPath('')
  }

  return (
    <div className="px-8 py-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Sales Orders</h1>
          <p className="text-sm text-slate-500 mt-1">{orders.length} orders total</p>
        </div>
        <button onClick={() => setShowUpload(!showUpload)} className="btn-primary">
          <Upload className="w-4 h-4" /> Upload SO PDF
        </button>
      </div>

      {showUpload && (
        <div className="card p-5">
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 hover:border-brand-500 rounded-lg p-8 cursor-pointer transition-colors">
            <Upload className="w-8 h-8 text-slate-500 mb-2" />
            <p className="text-sm text-slate-400">Click to select one or more SO PDFs</p>
            <p className="text-xs text-slate-600 mt-1">Single file → preview before saving · Multiple files → saved automatically</p>
            <input
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              disabled={uploadMut.isPending || bulkUploadMut.isPending}
              onChange={e => {
                const files = Array.from(e.target.files || [])
                if (!files.length) return
                setError(null)
                if (files.length === 1) {
                  uploadMut.mutate(files[0])
                } else {
                  bulkUploadMut.mutate(files)
                }
                e.target.value = ''
              }}
            />
          </label>
          {(uploadMut.isPending || bulkUploadMut.isPending) && (
            <p className="mt-3 text-sm text-slate-400 text-center">Processing…</p>
          )}
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="table-head px-4 py-3 text-left">SO Number</th>
              <th className="table-head px-4 py-3 text-left">Date</th>
              <th className="table-head px-4 py-3 text-left">Vendor</th>
              <th className="table-head px-4 py-3 text-right">Total Qty</th>
              <th className="table-head px-4 py-3 text-left">Status</th>
              <th className="table-head px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {isLoading && <tr><td colSpan={6} className="text-center py-12 text-slate-500 text-sm">Loading…</td></tr>}
            {!isLoading && orders.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-slate-500 text-sm">
                No sales orders yet. Upload a PDF to begin.
              </td></tr>
            )}
            {orders.map(so => (
              <tr key={so.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="table-cell font-mono text-sm font-medium text-slate-200">{so.so_number}</td>
                <td className="table-cell text-slate-400">{fmt(so.so_date)}</td>
                <td className="table-cell text-slate-300">{so.vendor_name || '—'}</td>
                <td className="table-cell text-right font-mono text-slate-300">{so.total_qty}</td>
                <td className="table-cell"><StatusBadge type="so_display" status={so.display_status} qty={so.qty_pending} /></td>
                <td className="table-cell text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link to={`/sales-orders/${so.id}`}
                      className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors"
                      title="View detail">
                      <Eye className="w-3.5 h-3.5" />
                    </Link>
                    <button onClick={() => setDeleteTarget(so)}
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

      {/* Preview Modal */}
      {/* onClose calls handleCancelPreview so PDF is deleted from storage if user doesn't confirm */}
      <Modal open={!!previewData} onClose={handleCancelPreview} title="Review Extracted Sales Order" size="lg">
        {previewData && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">SO Number</label>
                <p className="font-mono text-slate-200 mt-1">{previewData.so_number}</p>
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">Date</label>
                <p className="text-slate-200 mt-1">{fmt(previewData.so_date)}</p>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-500 uppercase tracking-wider">Vendor Name (editable)</label>
                <input
                  className="input mt-1"
                  value={editedVendor}
                  onChange={e => setEditedVendor(e.target.value)}
                />
              </div>
            </div>

            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Line Items ({previewData.line_items?.length})</p>
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80">
                      <th className="table-head px-3 py-2 text-left">#</th>
                      <th className="table-head px-3 py-2 text-left">Product</th>
                      <th className="table-head px-3 py-2 text-left">Gramage</th>
                      <th className="table-head px-3 py-2 text-right">Qty</th>
                      <th className="table-head px-3 py-2 text-right">Rate</th>
                      <th className="table-head px-3 py-2 text-left">Matched SKU</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {(previewData.line_items || []).map((li, i) => (
                      <tr key={i} className="hover:bg-slate-800/20">
                        <td className="px-3 py-2 text-slate-500 text-xs">{li.line_no ?? i + 1}</td>
                        <td className="px-3 py-2 text-slate-300">{li.product_name}</td>
                        <td className="px-3 py-2 text-slate-400 font-mono text-xs">{li.gramage || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{li.qty_ordered}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-400 text-xs">₹{li.rate}</td>
                        <td className="px-3 py-2">
                          {li.matched_stock_id
                            ? <span className="text-xs text-brand-400">✓ Matched</span>
                            : <span className="text-xs text-slate-500">—</span>
                          }
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
                {confirmMut.isPending ? 'Saving…' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        title="Delete Sales Order?"
        message={`Remove SO ${deleteTarget?.so_number}?`}
        warning="This will not reverse stock already dispatched against this SO."
        loading={deleteMut.isPending}
      />
    </div>
  )
}