import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getStock, uploadStock, updateStock, deleteStock, toggleSkuActive, deleteAllStock, deleteSelectedStock } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import UploadZone from '../components/UploadZone'
import ConfirmDialog from '../components/ConfirmDialog'
import { Pencil, Trash2, Check, X, Upload } from 'lucide-react'

export default function WarehouseStock() {
  const qc = useQueryClient()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['stock'], queryFn: getStock })

  const [tab, setTab] = useState('stock')
  const [editId, setEditId] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showDeleteAll, setShowDeleteAll] = useState(false)
  const [showDeleteSelected, setShowDeleteSelected] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [uploadMsg, setUploadMsg] = useState(null)
  const [showUpload, setShowUpload] = useState(false)

  const uploadMut = useMutation({
    mutationFn: uploadStock,
    onSuccess: (data) => {
      qc.invalidateQueries(['stock'])
      setUploadMsg(data.message)
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

  const deleteAllMut = useMutation({
    mutationFn: deleteAllStock,
    onSuccess: () => {
      qc.invalidateQueries(['stock'])
      setShowDeleteAll(false)
      setSelectedIds(new Set())
    }
  })

  const deleteSelectedMut = useMutation({
    mutationFn: () => deleteSelectedStock([...selectedIds]),
    onSuccess: () => {
      qc.invalidateQueries(['stock'])
      setShowDeleteSelected(false)
      setSelectedIds(new Set())
    }
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }) => toggleSkuActive(id, is_active),
    onSuccess: () => qc.invalidateQueries(['stock']),
  })

  const statusOrder = { out: 0, low: 1, healthy: 2 }
  const activeRows = [...rows]
    .filter(r => r.is_active)
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status])

  const zeroQtyRows = [...rows]
    .filter(r => r.stock_qty === 0)
    .sort((a, b) => a.title.localeCompare(b.title))

  const allSelected = activeRows.length > 0 && activeRows.every(r => selectedIds.has(r.id))
  const someSelected = selectedIds.size > 0

  function toggleRow(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(activeRows.map(r => r.id)))
    }
  }

  return (
    <div className="px-8 py-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Warehouse Stock</h1>
          <p className="text-sm text-slate-500 mt-1">
            {activeRows.length} active SKUs · {rows.length} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          {someSelected && tab === 'stock' && (
            <button onClick={() => setShowDeleteSelected(true)}
              className="btn-secondary text-red-400 border-red-800/40 hover:bg-red-900/20">
              <Trash2 className="w-4 h-4" /> Delete Selected ({selectedIds.size})
            </button>
          )}
          {tab === 'stock' && rows.length > 0 && (
            <button onClick={() => setShowDeleteAll(true)}
              className="btn-secondary text-red-400 border-red-800/40 hover:bg-red-900/20">
              <Trash2 className="w-4 h-4" /> Delete All
            </button>
          )}
          <button onClick={() => setShowUpload(!showUpload)} className="btn-primary">
            <Upload className="w-4 h-4" /> Upload XLSX
          </button>
        </div>
      </div>

      {showUpload && (
        <div className="card p-5">
          <UploadZone accept=".xlsx" label="Upload warehouse stock XLSX"
            onFile={(f) => uploadMut.mutate(f)} loading={uploadMut.isPending} />
        </div>
      )}

      {uploadMsg && (
        <div className="p-3 bg-brand-600/10 border border-brand-700/30 rounded-lg text-sm text-brand-400">
          ✓ {uploadMsg}
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-800">
        <button onClick={() => { setTab('stock'); setSelectedIds(new Set()) }}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'stock' ? 'border-brand-500 text-brand-400' : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}>
          Stock
        </button>
        <button onClick={() => { setTab('manage'); setSelectedIds(new Set()) }}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'manage' ? 'border-brand-500 text-brand-400' : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}>
          Manage SKUs
          {zeroQtyRows.length > 0 && (
            <span className="ml-2 text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded-full">
              {zeroQtyRows.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'stock' && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="table-head px-4 py-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="rounded border-slate-600 bg-slate-800 text-brand-500 focus:ring-brand-500" />
                </th>
                <th className="table-head px-4 py-3 text-left">Product</th>
                <th className="table-head px-4 py-3 text-left">Weight</th>
                <th className="table-head px-4 py-3 text-right">Stock Qty</th>
                <th className="table-head px-4 py-3 text-left">Status</th>
                <th className="table-head px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoading && <tr><td colSpan={6} className="text-center py-12 text-slate-500 text-sm">Loading…</td></tr>}
              {!isLoading && activeRows.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500 text-sm">
                  No active stock. Upload an XLSX to get started.
                </td></tr>
              )}
              {activeRows.map(row => {
                const isSelected = selectedIds.has(row.id)
                const rowBg = isSelected ? 'bg-brand-900/20' :
                  row.status === 'out' ? 'bg-red-950/20' :
                  row.status === 'low' ? 'bg-amber-950/20' : ''
                return (
                  <tr key={row.id} className={`transition-colors hover:bg-slate-800/30 ${rowBg}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row.id)}
                        className="rounded border-slate-600 bg-slate-800 text-brand-500 focus:ring-brand-500" />
                    </td>
                    <td className="table-cell font-medium text-slate-200">{row.title}</td>
                    <td className="table-cell text-slate-400 font-mono text-xs">{row.weight || '—'}</td>
                    <td className="table-cell text-right">
                      {editId === row.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <input type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
                            className="input w-24 text-right" autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Enter') updateMut.mutate({ id: row.id, qty: parseInt(editVal) })
                              if (e.key === 'Escape') setEditId(null)
                            }} />
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
                    <td className="table-cell"><StatusBadge status={row.status} type="stock" /></td>
                    <td className="table-cell text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setEditId(row.id); setEditVal(row.stock_qty) }}
                          className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteTarget(row)}
                          className="p-1.5 hover:bg-red-900/30 rounded text-slate-400 hover:text-red-400 transition-colors">
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
      )}

      {tab === 'manage' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            SKUs with stock qty = 0. Toggle active/inactive manually. SKUs with qty &gt; 0 are always active automatically.
          </p>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="table-head px-4 py-3 text-left">Product</th>
                  <th className="table-head px-4 py-3 text-left">Weight</th>
                  <th className="table-head px-4 py-3 text-center">SKU Status</th>
                  <th className="table-head px-4 py-3 text-right">Toggle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {isLoading && <tr><td colSpan={4} className="text-center py-12 text-slate-500 text-sm">Loading…</td></tr>}
                {!isLoading && zeroQtyRows.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-12 text-slate-500 text-sm">
                    All SKUs have stock qty &gt; 0. Nothing to manage here.
                  </td></tr>
                )}
                {zeroQtyRows.map(row => (
                  <tr key={row.id} className="transition-colors hover:bg-slate-800/30">
                    <td className="table-cell font-medium text-slate-200">{row.title}</td>
                    <td className="table-cell text-slate-400 font-mono text-xs">{row.weight || '—'}</td>
                    <td className="table-cell text-center">
                      <StatusBadge status={row.is_active} type="sku_active" />
                    </td>
                    <td className="table-cell text-right">
                      <button
                        onClick={() => toggleMut.mutate({ id: row.id, is_active: !row.is_active })}
                        disabled={toggleMut.isPending}
                        className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                          row.is_active
                            ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-800/40'
                            : 'bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50 border border-emerald-800/40'
                        }`}>
                        {row.is_active ? 'Mark Inactive' : 'Mark Active'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        title="Delete SKU?"
        message={`Remove "${deleteTarget?.title}" (${deleteTarget?.weight || 'no weight'}) from warehouse stock?`}
        loading={deleteMut.isPending}
      />

      <ConfirmDialog
        open={showDeleteSelected}
        onClose={() => setShowDeleteSelected(false)}
        onConfirm={() => deleteSelectedMut.mutate()}
        title="Delete Selected SKUs?"
        message={`Remove ${selectedIds.size} selected SKU${selectedIds.size > 1 ? 's' : ''} from warehouse stock?`}
        warning="This cannot be undone."
        loading={deleteSelectedMut.isPending}
      />

      <ConfirmDialog
        open={showDeleteAll}
        onClose={() => setShowDeleteAll(false)}
        onConfirm={() => deleteAllMut.mutate()}
        title="Delete All Stock?"
        message="This will remove all warehouse stock data permanently."
        warning="This cannot be undone. You will need to re-upload the XLSX."
        loading={deleteAllMut.isPending}
      />
    </div>
  )
}