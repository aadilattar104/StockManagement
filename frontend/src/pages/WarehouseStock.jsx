import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getStock, uploadStock, updateStock, deleteStock } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import UploadZone from '../components/UploadZone'
import ConfirmDialog from '../components/ConfirmDialog'
import { Pencil, Trash2, Check, X, Upload } from 'lucide-react'

export default function WarehouseStock() {
  const qc = useQueryClient()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['stock'], queryFn: getStock })
  const [editId, setEditId] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [uploadMsg, setUploadMsg] = useState(null)
  const [showUpload, setShowUpload] = useState(false)

  const uploadMut = useMutation({
    mutationFn: uploadStock,
    onSuccess: (data) => {
      qc.invalidateQueries(['stock'])
      setUploadMsg(`${data.message}`)
      setShowUpload(false)
      setTimeout(() => setUploadMsg(null), 4000)
    }
  })

  const updateMut = useMutation({
    mutationFn: ({ id, qty }) => updateStock(id, qty),
    onSuccess: () => { qc.invalidateQueries(['stock']); setEditId(null) }
  })

  const deleteMut = useMutation({
    mutationFn: deleteStock,
    onSuccess: () => { qc.invalidateQueries(['stock']); setDeleteTarget(null) }
  })

  const statusOrder = { out: 0, low: 1, healthy: 2 }
  const sorted = [...rows].sort((a, b) => statusOrder[a.status] - statusOrder[b.status])

  return (
    <div className="px-8 py-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Warehouse Stock</h1>
          <p className="text-sm text-slate-500 mt-1">{rows.length} SKUs · Click a row to edit quantity</p>
        </div>
        <button onClick={() => setShowUpload(!showUpload)} className="btn-primary">
          <Upload className="w-4 h-4" /> Upload XLSX
        </button>
      </div>

      {/* Upload zone */}
      {showUpload && (
        <div className="card p-5">
          <UploadZone
            accept=".xlsx"
            label="Upload warehouse stock XLSX"
            onFile={(f) => uploadMut.mutate(f)}
            loading={uploadMut.isPending}
          />
        </div>
      )}

      {uploadMsg && (
        <div className="p-3 bg-brand-600/10 border border-brand-700/30 rounded-lg text-sm text-brand-400">
          ✓ {uploadMsg}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="table-head px-4 py-3 text-left">Product</th>
              <th className="table-head px-4 py-3 text-left">Weight</th>
              <th className="table-head px-4 py-3 text-right">Stock Qty</th>
              <th className="table-head px-4 py-3 text-left">Status</th>
              <th className="table-head px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {isLoading && (
              <tr><td colSpan={5} className="text-center py-12 text-slate-500 text-sm">Loading…</td></tr>
            )}
            {!isLoading && sorted.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-slate-500 text-sm">
                No stock data. Upload an XLSX to get started.
              </td></tr>
            )}
            {sorted.map(row => {
              const rowBg =
                row.status === 'out' ? 'bg-red-950/20' :
                row.status === 'low' ? 'bg-amber-950/20' : ''
              return (
                <tr key={row.id} className={`transition-colors hover:bg-slate-800/30 ${rowBg}`}>
                  <td className="table-cell font-medium text-slate-200">{row.title}</td>
                  <td className="table-cell text-slate-400 font-mono text-xs">{row.weight || '—'}</td>
                  <td className="table-cell text-right">
                    {editId === row.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="number"
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          className="input w-24 text-right"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') updateMut.mutate({ id: row.id, qty: parseInt(editVal) })
                            if (e.key === 'Escape') setEditId(null)
                          }}
                        />
                        <button onClick={() => updateMut.mutate({ id: row.id, qty: parseInt(editVal) })}
                          className="p-1.5 hover:bg-brand-600/20 rounded text-brand-400">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditId(null)}
                          className="p-1.5 hover:bg-slate-700 rounded text-slate-400">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="font-mono font-semibold text-slate-200">{row.stock_qty}</span>
                    )}
                  </td>
                  <td className="table-cell">
                    <StatusBadge status={row.status} type="stock" />
                  </td>
                  <td className="table-cell text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => { setEditId(row.id); setEditVal(row.stock_qty) }}
                        className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors"
                        title="Edit quantity"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(row)}
                        className="p-1.5 hover:bg-red-900/30 rounded text-slate-400 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        title="Delete SKU?"
        message={`Remove "${deleteTarget?.title}" (${deleteTarget?.weight || 'no weight'}) from warehouse stock?`}
        loading={deleteMut.isPending}
      />
    </div>
  )
}
