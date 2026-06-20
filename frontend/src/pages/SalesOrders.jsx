import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSalesOrders, uploadSalesOrder, uploadSalesOrdersBulk,
  confirmSalesOrder, deleteSalesOrder, cancelSalesOrderUpload,
  closeSalesOrder, deleteAllSalesOrders,
} from '../api/client'
import StatusBadge from '../components/StatusBadge'
import UploadZone from '../components/UploadZone'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { Link } from 'react-router-dom'
import { Upload, Eye, Trash2, Check, AlertTriangle, XCircle, Trash } from 'lucide-react'

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Tab definitions — "Closed" tab includes both naturally fulfilled and manually closed
const TABS = [
  { key: 'open',    label: 'Open',    match: s => s.display_status === 'open' || s.display_status === 'invoice_pending' },
  { key: 'partial', label: 'Partial', match: s => s.display_status === 'partial' },
  { key: 'closed',  label: 'Closed',  match: s => s.display_status === 'closed' || s.display_status === 'closed_manual' },
]

export default function SalesOrders() {
  const qc = useQueryClient()
  const { data: orders = [], isLoading } = useQuery({ queryKey: ['sales-orders'], queryFn: getSalesOrders })

  const [activeTab, setActiveTab] = useState('open')
  const [previewData, setPreviewData] = useState(null)
  const [pdfPath, setPdfPath] = useState('')
  const [editedVendor, setEditedVendor] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteAll, setDeleteAll] = useState(false)
  const [closeTarget, setCloseTarget] = useState(null)
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

  const deleteAllMut = useMutation({
    mutationFn: deleteAllSalesOrders,
    onSuccess: () => { qc.invalidateQueries(['sales-orders']); setDeleteAll(false) }
  })

  const closeMut = useMutation({
    mutationFn: (id) => closeSalesOrder(id),
    onSuccess: () => {
      // Invalidate both SO list and the fulfilment matrix (qty_to_be_sent changes)
      qc.invalidateQueries(['sales-orders'])
      qc.invalidateQueries(['fulfilment-matrix'])
      setCloseTarget(null)
    },
    onError: (e) => setError(e.message)
  })

  function handleCancelPreview() {
    if (pdfPath) cancelSalesOrderUpload(pdfPath)
    setPreviewData(null)
    setPdfPath('')
  }

  // Compute per-tab counts client-side from already-fetched list
  const tabCounts = {}
  TABS.forEach(t => { tabCounts[t.key] = orders.filter(t.match).length })

  const visibleOrders = orders.filter(TABS.find(t => t.key === activeTab)?.match ?? (() => true))

  return (
    <div className="px-8 py-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Sales Orders</h1>
          <p className="text-sm text-slate-500 mt-1">{orders.length} orders total</p>
        </div>
        <div className="flex items-center gap-2">
          {orders.length > 0 && (
            <button onClick={() => setDeleteAll(true)} className="btn-danger flex items-center gap-1.5">
              <Trash className="w-4 h-4" /> Delete All
            </button>
          )}
          <button onClick={() => setShowUpload(!showUpload)} className="btn-primary">
            <Upload className="w-4 h-4" /> Upload SO PDF
          </button>
        </div>
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${
              activeTab === tab.key
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab.label}
            {tabCounts[tab.key] > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                activeTab === tab.key
                  ? 'bg-brand-500/20 text-brand-300'
                  : 'bg-slate-700 text-slate-400'
              }`}>
                {tabCounts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

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
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-12 text-slate-500 text-sm">Loading…</td></tr>
            )}
            {!isLoading && visibleOrders.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-slate-500 text-sm">
                {activeTab === 'open' && 'No open sales orders. Upload a PDF to begin.'}
                {activeTab === 'partial' && 'No partially fulfilled orders.'}
                {activeTab === 'closed' && 'No closed or fulfilled orders yet.'}
              </td></tr>
            )}
            {visibleOrders.map(so => (
              <tr key={so.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="table-cell font-mono text-sm font-medium text-slate-200">{so.so_number}</td>
                <td className="table-cell text-slate-400">{fmt(so.so_date)}</td>
                <td className="table-cell text-slate-300">{so.vendor_name || '—'}</td>
                <td className="table-cell text-right font-mono text-slate-300">{so.total_qty}</td>
                <td className="table-cell">
                  <StatusBadge type="so_display" status={so.display_status} qty={so.qty_pending} />
                </td>
                <td className="table-cell text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link to={`/sales-orders/${so.id}`}
                      className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors"
                      title="View detail">
                      <Eye className="w-3.5 h-3.5" />
                    </Link>

                    {/* Close SO button — only on partial SOs */}
                    {so.display_status === 'partial' && (
                      <button
                        onClick={() => setCloseTarget(so)}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-amber-700/50 bg-amber-900/20 text-amber-400 hover:bg-amber-900/40 hover:text-amber-300 transition-colors"
                        title="Close SO manually"
                      >
                        <XCircle className="w-3 h-3" /> Close SO
                      </button>
                    )}

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
              <button onClick={handleCancelPreview} className="btn-secondary">Cancel</button>
              <button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending} className="btn-primary">
                <Check className="w-4 h-4" />
                {confirmMut.isPending ? 'Saving…' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete All confirm */}
      <ConfirmDialog
        open={deleteAll}
        onClose={() => setDeleteAll(false)}
        onConfirm={() => deleteAllMut.mutate()}
        title="Delete All Sales Orders?"
        message={`This will permanently remove all ${orders.length} sales orders.`}
        warning="This cannot be undone. Stock already dispatched against these SOs will not be reversed."
        loading={deleteAllMut.isPending}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        title="Delete Sales Order?"
        message={`Remove SO ${deleteTarget?.so_number}?`}
        warning="This will not reverse stock already dispatched against this SO."
        loading={deleteMut.isPending}
      />

      {/* Close SO confirm — deliberate dialog per spec C.3 */}
      <ConfirmDialog
        open={!!closeTarget}
        onClose={() => setCloseTarget(null)}
        onConfirm={() => closeMut.mutate(closeTarget.id)}
        title="Close this Sales Order?"
        message={`Close SO ${closeTarget?.so_number} with ${closeTarget?.qty_pending ?? 0} units still pending?`}
        warning="This cannot be undone. The pending quantity will not be deducted from warehouse stock — only dispatched quantities affect stock."
        loading={closeMut.isPending}
      />
    </div>
  )
}