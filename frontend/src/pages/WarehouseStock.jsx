import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getStock, uploadStock, updateStockFromXlsx, updateStock, deleteStock, deleteAllStock, deleteSelectedStock,
  getProductMaster, getNewProducts, approveProduct, editProductMaster, deleteProductMaster, reorderProductMaster,
} from '../api/client'
import StatusBadge from '../components/StatusBadge'
import UploadZone from '../components/UploadZone'
import ConfirmDialog from '../components/ConfirmDialog'
import { Pencil, Trash2, Check, X, Upload, RefreshCw, Plus } from 'lucide-react'

export default function WarehouseStock() {
  const qc = useQueryClient()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['stock'], queryFn: getStock })
  const { data: productMaster = [], isLoading: pmLoading } = useQuery({
    queryKey: ['product-master'], queryFn: getProductMaster,
  })
  const { data: newProducts = [], isLoading: newLoading } = useQuery({
    queryKey: ['new-products'], queryFn: getNewProducts,
  })

  const [tab, setTab] = useState('stock')
  const [editId, setEditId] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showDeleteAll, setShowDeleteAll] = useState(false)
  const [showDeleteSelected, setShowDeleteSelected] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [uploadMsg, setUploadMsg] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [updateMsg, setUpdateMsg] = useState(null)
  const [showUpdate, setShowUpdate] = useState(false)

  // Product Master row editing
  const [pmEditId, setPmEditId] = useState(null)
  const [pmEditName, setPmEditName] = useState('')
  const [pmEditWeight, setPmEditWeight] = useState('')
  const [pmDeleteTarget, setPmDeleteTarget] = useState(null)

  const uploadMut = useMutation({
    mutationFn: uploadStock,
    onSuccess: (data) => {
      qc.invalidateQueries(['stock'])
      qc.invalidateQueries(['new-products'])
      setUploadMsg(data.message)
      setShowUpload(false)
      setTimeout(() => setUploadMsg(null), 4000)
    }
  })

  const updateStockMut = useMutation({
    mutationFn: updateStockFromXlsx,
    onSuccess: (data) => {
      // Product Master IDs never change on this endpoint, so invalidating
      // these caches refreshes everything downstream (Fulfilment Matrix,
      // Dashboard Warehouse Stock Matrix, etc.) with zero remapping.
      qc.invalidateQueries(['stock'])
      qc.invalidateQueries(['product-master'])
      qc.invalidateQueries(['new-products'])
      qc.invalidateQueries(['fulfilment-matrix'])
      setUpdateMsg(data.message)
      setShowUpdate(false)
      setTimeout(() => setUpdateMsg(null), 4000)
    }
  })

  const updateMut = useMutation({
    mutationFn: ({ id, qty }) => updateStock(id, qty),
    onSuccess: () => {
      qc.invalidateQueries(['stock'])
      qc.invalidateQueries(['product-master'])
      setEditId(null)
    }
  })

  const deleteMut = useMutation({
    mutationFn: deleteStock,
    onSuccess: () => {
      qc.invalidateQueries(['stock'])
      qc.invalidateQueries(['product-master'])
      setDeleteTarget(null)
    }
  })

  const deleteAllMut = useMutation({
    mutationFn: deleteAllStock,
    onSuccess: () => {
      qc.invalidateQueries(['stock'])
      qc.invalidateQueries(['product-master'])
      qc.invalidateQueries(['new-products'])
      setShowDeleteAll(false)
      setSelectedIds(new Set())
    }
  })

  const deleteSelectedMut = useMutation({
    mutationFn: () => deleteSelectedStock([...selectedIds]),
    onSuccess: () => {
      qc.invalidateQueries(['stock'])
      qc.invalidateQueries(['product-master'])
      setShowDeleteSelected(false)
      setSelectedIds(new Set())
    }
  })

  const approveMut = useMutation({
    mutationFn: approveProduct,
    onSuccess: () => {
      qc.invalidateQueries(['product-master'])
      qc.invalidateQueries(['new-products'])
      qc.invalidateQueries(['stock'])
    }
  })

  const editPmMut = useMutation({
    mutationFn: ({ id, payload }) => editProductMaster(id, payload),
    onSuccess: () => {
      qc.invalidateQueries(['product-master'])
      qc.invalidateQueries(['stock'])
      setPmEditId(null)
    }
  })

  const deletePmMut = useMutation({
    mutationFn: deleteProductMaster,
    onSuccess: () => {
      qc.invalidateQueries(['product-master'])
      qc.invalidateQueries(['stock'])
      qc.invalidateQueries(['new-products'])
      setPmDeleteTarget(null)
    }
  })

  const reorderMut = useMutation({
    mutationFn: reorderProductMaster,
    onSuccess: () => {
      qc.invalidateQueries(['product-master'])
      qc.invalidateQueries(['stock'])
    }
  })

  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id))
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
      setSelectedIds(new Set(rows.map(r => r.id)))
    }
  }

  const [posEditId, setPosEditId] = useState(null)
  const [posEditVal, setPosEditVal] = useState('')

  function setProductPosition(id, newPosition) {
    const from = productMaster.findIndex(p => p.id === id)
    if (from === -1) return

    // Clamp the typed 1-based position into range, then move the item there.
    const to = Math.min(Math.max(newPosition - 1, 0), productMaster.length - 1)
    if (to === from) { setPosEditId(null); return }

    const next = [...productMaster]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)

    reorderMut.mutate(next.map(p => p.id))
    setPosEditId(null)
  }

  return (
    <div className="px-8 py-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Warehouse Stock</h1>
          <p className="text-sm text-slate-500 mt-1">
            {rows.length} SKUs in Product Master
            {newProducts.length > 0 && <> · {newProducts.length} new product{newProducts.length > 1 ? 's' : ''} detected</>}
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
          <button onClick={() => { setShowUpdate(!showUpdate); setShowUpload(false) }} className="btn-secondary">
            <RefreshCw className="w-4 h-4" /> Update Stock
          </button>
          <button onClick={() => { setShowUpload(!showUpload); setShowUpdate(false) }} className="btn-primary">
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

      {showUpdate && (
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-3">
            Upload the latest warehouse stock XLSX. Existing SKUs are matched by product + weight and
            updated in place — IDs, Product Master entries, Sales Orders, and Invoices stay intact. SKUs
            missing from this file are kept but set to 0 qty (never deleted). New SKUs appear under
            "New Products Detected" in the Product Master tab.
          </p>
          <UploadZone accept=".xlsx" label="Update warehouse stock XLSX"
            onFile={(f) => updateStockMut.mutate(f)} loading={updateStockMut.isPending} />
        </div>
      )}

      {uploadMsg && (
        <div className="p-3 bg-brand-600/10 border border-brand-700/30 rounded-lg text-sm text-brand-400">
          ✓ {uploadMsg}
        </div>
      )}

      {updateMsg && (
        <div className="p-3 bg-brand-600/10 border border-brand-700/30 rounded-lg text-sm text-brand-400">
          ✓ {updateMsg}
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-800">
        <button onClick={() => { setTab('stock'); setSelectedIds(new Set()) }}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'stock' ? 'border-brand-500 text-brand-400' : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}>
          Stock
        </button>
        <button onClick={() => { setTab('product-master'); setSelectedIds(new Set()) }}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'product-master' ? 'border-brand-500 text-brand-400' : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}>
          Product Master
          {newProducts.length > 0 && (
            <span className="ml-2 text-xs bg-amber-900/40 text-amber-400 px-1.5 py-0.5 rounded-full">
              {newProducts.length} new
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
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500 text-sm">
                  No SKUs in the Product Master yet. Upload an XLSX, then approve products in the
                  Product Master tab to get started.
                </td></tr>
              )}
              {rows.map(row => {
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

      {tab === 'product-master' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              The permanent product catalogue. Every screen — Stock, Fulfilment Matrix, Dashboard
              Warehouse Stock Matrix, Excel exports — uses exactly this list, in exactly this order.
            </p>
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="table-head px-4 py-3 text-left w-16">Order</th>
                    <th className="table-head px-4 py-3 text-left">SKU Name</th>
                    <th className="table-head px-4 py-3 text-left">Weight</th>
                    <th className="table-head px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {pmLoading && <tr><td colSpan={4} className="text-center py-12 text-slate-500 text-sm">Loading…</td></tr>}
                  {!pmLoading && productMaster.length === 0 && (
                    <tr><td colSpan={4} className="text-center py-12 text-slate-500 text-sm">
                      No products yet. Upload a warehouse stock XLSX — new SKUs will appear below under
                      "New Products Detected" for one-click approval.
                    </td></tr>
                  )}
                  {productMaster.map((p, idx) => (
                    <tr key={p.id} className="transition-colors hover:bg-slate-800/30">
                      <td className="table-cell">
                        {posEditId === p.id ? (
                          <input
                            type="number"
                            min={1}
                            max={productMaster.length}
                            value={posEditVal}
                            onChange={e => setPosEditVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') setProductPosition(p.id, parseInt(posEditVal))
                              if (e.key === 'Escape') setPosEditId(null)
                            }}
                            onBlur={() => setProductPosition(p.id, parseInt(posEditVal))}
                            className="input w-16 text-center"
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => { setPosEditId(p.id); setPosEditVal(String(idx + 1)) }}
                            disabled={reorderMut.isPending}
                            className="text-xs text-slate-400 hover:text-slate-200 font-mono w-8 h-7 rounded hover:bg-slate-700 transition-colors"
                            title="Click to enter a new position"
                          >
                            {idx + 1}
                          </button>
                        )}
                      </td>
                      <td className="table-cell font-medium text-slate-200">
                        {pmEditId === p.id ? (
                          <input value={pmEditName} onChange={e => setPmEditName(e.target.value)}
                            className="input w-full" autoFocus />
                        ) : p.sku_name}
                      </td>
                      <td className="table-cell text-slate-400 font-mono text-xs">
                        {pmEditId === p.id ? (
                          <input value={pmEditWeight} onChange={e => setPmEditWeight(e.target.value)}
                            className="input w-24" />
                        ) : (p.weight || '—')}
                      </td>
                      <td className="table-cell text-right">
                        {pmEditId === p.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => editPmMut.mutate({ id: p.id, payload: { sku_name: pmEditName, weight: pmEditWeight } })}
                              className="p-1.5 hover:bg-brand-600/20 rounded text-brand-400">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setPmEditId(null)}
                              className="p-1.5 hover:bg-slate-700 rounded text-slate-400">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => { setPmEditId(p.id); setPmEditName(p.sku_name); setPmEditWeight(p.weight || '') }}
                              className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setPmDeleteTarget(p)}
                              className="p-1.5 hover:bg-red-900/30 rounded text-slate-400 hover:text-red-400 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              New Products Detected — SKUs found in an uploaded file that aren't in the Product Master yet.
              Approve once and they're remembered forever.
            </p>
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="table-head px-4 py-3 text-left">SKU Name</th>
                    <th className="table-head px-4 py-3 text-left">Weight</th>
                    <th className="table-head px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {newLoading && <tr><td colSpan={3} className="text-center py-8 text-slate-500 text-sm">Loading…</td></tr>}
                  {!newLoading && newProducts.length === 0 && (
                    <tr><td colSpan={3} className="text-center py-8 text-slate-500 text-sm">
                      No new products detected.
                    </td></tr>
                  )}
                  {newProducts.map(p => (
                    <tr key={p.warehouse_stock_id} className="transition-colors hover:bg-slate-800/30">
                      <td className="table-cell font-medium text-slate-200">{p.title}</td>
                      <td className="table-cell text-slate-400 font-mono text-xs">{p.weight || '—'}</td>
                      <td className="table-cell text-right">
                        <button
                          onClick={() => approveMut.mutate(p.warehouse_stock_id)}
                          disabled={approveMut.isPending}
                          className="text-xs px-3 py-1.5 rounded font-medium bg-brand-600/20 text-brand-400 hover:bg-brand-600/30 border border-brand-700/40 inline-flex items-center gap-1">
                          <Plus className="w-3.5 h-3.5" /> Add to Product Master
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        title="Delete SKU?"
        message={`Remove "${deleteTarget?.title}" (${deleteTarget?.weight || 'no weight'}) from warehouse stock and the Product Master?`}
        loading={deleteMut.isPending}
      />

      <ConfirmDialog
        open={showDeleteSelected}
        onClose={() => setShowDeleteSelected(false)}
        onConfirm={() => deleteSelectedMut.mutate()}
        title="Delete Selected SKUs?"
        message={`Remove ${selectedIds.size} selected SKU${selectedIds.size > 1 ? 's' : ''} from warehouse stock and the Product Master?`}
        warning="This cannot be undone."
        loading={deleteSelectedMut.isPending}
      />

      <ConfirmDialog
        open={showDeleteAll}
        onClose={() => setShowDeleteAll(false)}
        onConfirm={() => deleteAllMut.mutate()}
        title="Delete All Stock?"
        message="This will remove all warehouse stock data and the Product Master permanently."
        warning="This cannot be undone. You will need to re-upload the XLSX and re-approve products."
        loading={deleteAllMut.isPending}
      />

      <ConfirmDialog
        open={!!pmDeleteTarget}
        onClose={() => setPmDeleteTarget(null)}
        onConfirm={() => deletePmMut.mutate(pmDeleteTarget.id)}
        title="Delete Product?"
        message={`Remove "${pmDeleteTarget?.sku_name}" (${pmDeleteTarget?.weight || 'no weight'}) from the Product Master? It will disappear from Stock, Fulfilment Matrix, and Dashboard, but its warehouse stock data is kept — it will reappear under "New Products Detected" if you want to add it back.`}
        warning="You can re-add it anytime from New Products Detected."
        loading={deletePmMut.isPending}
      />
    </div>
  )
}