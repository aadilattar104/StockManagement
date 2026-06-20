import { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getZypeeUploads, uploadZypee, deleteZypeeUpload, getZypeeStock,
  uploadInTransit, getInTransit, deleteInTransit, getZypeeCompareTable, deleteTransitPo, replaceTransitPo
} from '../api/client'
import ConfirmDialog from '../components/ConfirmDialog'
import { Upload, Truck, Trash2, Download, History, Calendar, Filter, LayoutGrid, Search, BookOpen, Plus, X, FileDown, GripVertical, AlertTriangle, Link2, ChevronDown, ChevronRight } from 'lucide-react'

const WAREHOUSES = ['MUM', 'PUN', 'DEL', 'BLR']
const WH_LABELS = { MUM: 'Mumbai', PUN: 'Pune', DEL: 'Delhi', BLR: 'Bangalore' }
const WH_COLORS = {
  MUM: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  PUN: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  DEL: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  BLR: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
}

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function WarehouseBadge({ code }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${WH_COLORS[code] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
      {code}
    </span>
  )
}

// ── STOCK TAB (original view, cleaned up per previous changes) ───────────────
function StockTab({ uploads, uploadsLoading, setDeleteTarget }) {
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [selectedDate, setSelectedDate] = useState('')

  const availableDates = useMemo(() => {
    if (!selectedWarehouse) return []
    return uploads
      .filter(u => u.warehouse === selectedWarehouse)
      .map(u => u.stock_date)
      .sort((a, b) => b.localeCompare(a))
  }, [uploads, selectedWarehouse])

  const effectiveDate = selectedDate || availableDates[0] || ''

  const { data: stockRows = [], isLoading: stockLoading } = useQuery({
    queryKey: ['zypee-stock', selectedWarehouse, effectiveDate],
    queryFn: () => getZypeeStock(selectedWarehouse, effectiveDate),
    enabled: !!selectedWarehouse && !!effectiveDate,
  })

  function handleDownload() {
    if (!stockRows.length) return
    const sorted = sortSkusForDownload(stockRows.map(r => r.name))
    const nameToRow = Object.fromEntries(stockRows.map(r => [r.name, r]))
    const csv = ['Name,Qty', ...sorted.map(name => `"${name}",${nameToRow[name]?.old_quantity ?? 0}`)].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedWarehouse}_${effectiveDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
      {/* Left: Upload History */}
      <div className="xl:col-span-1 card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <History className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-200">Upload History</h2>
        </div>
        <div className="divide-y divide-slate-800/60 max-h-[600px] overflow-y-auto">
          {uploadsLoading && <p className="px-4 py-6 text-xs text-slate-500 text-center">Loading…</p>}
          {!uploadsLoading && uploads.length === 0 && <p className="px-4 py-6 text-xs text-slate-500 text-center">No uploads yet.</p>}
          {uploads.map(u => (
            <div key={u.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <WarehouseBadge code={u.warehouse} />
                  <span className="text-xs text-slate-400 font-mono">{fmt(u.stock_date)}</span>
                </div>
                <p className="text-xs text-slate-600">{u.row_count} SKUs</p>
              </div>
              <button
                onClick={() => setDeleteTarget(u)}
                className="p-1.5 hover:bg-red-900/30 rounded text-slate-600 hover:text-red-400 transition-colors"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Stock Table */}
      <div className="xl:col-span-3 space-y-4">
        <div className="card p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <span className="text-xs text-slate-500 uppercase tracking-wider">Filters</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">City</label>
            <select
              value={selectedWarehouse}
              onChange={e => { setSelectedWarehouse(e.target.value); setSelectedDate('') }}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-brand-500"
            >
              <option value="">— Select city —</option>
              {WAREHOUSES.map(w => <option key={w} value={w}>{w} — {WH_LABELS[w]}</option>)}
            </select>
          </div>
          {selectedWarehouse && (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-500" />
              <label className="text-xs text-slate-500">Date</label>
              <select
                value={effectiveDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-brand-500"
              >
                {availableDates.length === 0 && <option value="">No uploads for {selectedWarehouse}</option>}
                {availableDates.map(d => <option key={d} value={d}>{fmt(d)}</option>)}
              </select>
            </div>
          )}
          {stockRows.length > 0 && (
            <button
              onClick={handleDownload}
              className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              Download ({stockRows.length})
            </button>
          )}
        </div>

        <div className="card overflow-hidden">
          {!selectedWarehouse && <div className="py-16 text-center text-slate-500 text-sm">Select a city to view stock</div>}
          {selectedWarehouse && !effectiveDate && <div className="py-16 text-center text-slate-500 text-sm">No data uploaded for {selectedWarehouse} yet.</div>}
          {selectedWarehouse && effectiveDate && (
            <>
              <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-3">
                <WarehouseBadge code={selectedWarehouse} />
                <span className="text-sm text-slate-300">{WH_LABELS[selectedWarehouse]}</span>
                <span className="text-xs text-slate-500">·</span>
                <span className="text-xs text-slate-500">{fmt(effectiveDate)}</span>
                <span className="text-xs text-slate-500">·</span>
                <span className="text-xs text-slate-500">{stockRows.length} SKUs</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-800/40">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Name</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {stockLoading && <tr><td colSpan={2} className="py-12 text-center text-slate-500 text-sm">Loading…</td></tr>}
                    {!stockLoading && stockRows.length === 0 && <tr><td colSpan={2} className="py-12 text-center text-slate-500 text-sm">No data found.</td></tr>}
                    {stockRows.map(row => (
                      <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-3 text-slate-200">{row.name}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          <span className={row.old_quantity === 0 ? 'text-red-400' : row.old_quantity <= 10 ? 'text-amber-400' : 'text-slate-200'}>
                            {row.old_quantity}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── IN TRANSIT TAB ────────────────────────────────────────────────────────────
function InTransitTab() {
  const qc = useQueryClient()
  const fileInputRef = useRef(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [expandedPo, setExpandedPo] = useState(null)

  // Multi-upload state
  const [uploadResults, setUploadResults] = useState([])
  const [uploading, setUploading] = useState(false)

  // Duplicate-with-different-qty confirm state
  const [dupConfirm, setDupConfirm] = useState(null) // { filename, result }
  const [replacing, setReplacing] = useState(false)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['zypee-in-transit'],
    queryFn: getInTransit,
  })

  const deleteMut = useMutation({
    mutationFn: deleteInTransit,
    onSuccess: () => {
      qc.invalidateQueries(['zypee-in-transit'])
      qc.invalidateQueries(['zypee-compare-table'])
      setDeleteTarget(null)
    },
  })

  function fmtShort(d) {
    if (!d) return '—'
    const [y, m, day] = d.split('-')
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${parseInt(day)}-${months[parseInt(m)-1]}-${y}`
  }

  // Group rows by warehouse + po_date
  const grouped = useMemo(() => {
    const map = {}
    for (const r of rows) {
      const key = `${r.warehouse}||${r.po_date}`
      if (!map[key]) map[key] = { warehouse: r.warehouse, po_date: r.po_date, items: [] }
      map[key].items.push(r)
    }
    return Object.values(map).sort((a, b) => {
      if (b.po_date > a.po_date) return 1
      if (b.po_date < a.po_date) return -1
      return a.warehouse.localeCompare(b.warehouse)
    })
  }, [rows])

  // ── Multi-file upload handler ───────────────────────────────────────────────
  async function handleFiles(files) {
    if (!files.length) return
    setUploading(true)
    setUploadResults([])
    const results = []
    for (const file of files) {
      try {
        const data = await uploadInTransit(file)
        results.push({ filename: file.name, result: data })
        if (data.duplicate && data.qty_changed) {
          // Pause — show replace confirm
          setDupConfirm({ filename: file.name, result: data })
          setUploadResults([...results])
          setUploading(false)
          return
        }
        if (!data.duplicate) {
          qc.invalidateQueries(['zypee-in-transit'])
          qc.invalidateQueries(['zypee-compare-table'])
        }
      } catch (e) {
        results.push({ filename: file.name, error: e.message || 'Upload failed' })
      }
    }
    setUploadResults(results)
    setUploading(false)
  }

  // ── Confirm replace ─────────────────────────────────────────────────────────
  async function confirmReplace() {
    if (!dupConfirm) return
    setReplacing(true)
    try {
      const { result } = dupConfirm
      await replaceTransitPo({
        warehouse: result.warehouse,
        po_number: result.po_number,
        po_date: result.po_date,
        rows: result.rows_payload || [],
      })
      qc.invalidateQueries(['zypee-in-transit'])
      qc.invalidateQueries(['zypee-compare-table'])
      setUploadResults(prev => [...prev, {
        filename: dupConfirm.filename,
        result: { ...result, replaced: true, matched: (result.rows_payload || []).length, duplicate: false },
      }])
    } catch (e) {
      setUploadResults(prev => [...prev, { filename: dupConfirm.filename, error: e.message }])
    }
    setReplacing(false)
    setDupConfirm(null)
  }

  // Last result with exceptions to show the unmapped table
  const lastWithExceptions = [...uploadResults].reverse().find(r => r.result?.exceptions?.length > 0)

  return (
    <div className="space-y-6">
      {/* Upload banner */}
      <div className="card p-5 flex flex-wrap items-center gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-200">Upload PO PDF</p>
          <p className="text-xs text-slate-500 mt-0.5">Extracts PO number, date, SKU names and quantities automatically. Multiple files supported.</p>
        </div>
        <button
          onClick={() => { setUploadResults([]); fileInputRef.current?.click() }}
          disabled={uploading}
          className="ml-auto btn-primary"
        >
          <Upload className="w-4 h-4" />
          {uploading ? 'Processing…' : 'Upload PO PDF'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; handleFiles(files) }}
        />
      </div>

      {/* Per-file upload results */}
      {uploadResults.length > 0 && (
        <div className="space-y-2">
          {uploadResults.map((r, i) => {
            if (r.error) return (
              <div key={i} className="px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-sm flex items-center justify-between">
                <span>✗ {r.filename} — {r.error}</span>
                <button onClick={() => setUploadResults(p => p.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
              </div>
            )
            const res = r.result
            // Same PO, same quantities
            if (res.duplicate && !res.qty_changed) return (
              <div key={i} className="px-4 py-3 rounded-lg bg-slate-800 border border-slate-600 text-slate-300 text-sm flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>
                    <strong className="text-slate-100">{r.filename}</strong> — PO <strong className="text-slate-100">{res.po_number}</strong> ({res.warehouse} · {fmtShort(res.po_date)}) has already been uploaded. Quantities are identical, no changes made.
                  </span>
                </div>
                <button onClick={() => setUploadResults(p => p.filter((_, j) => j !== i))} className="flex-shrink-0"><X className="w-4 h-4 text-slate-500 hover:text-slate-300" /></button>
              </div>
            )
            // qty_changed duplicate — handled by dupConfirm panel
            if (res.duplicate && res.qty_changed) return null
            // Normal success
            return (
              <div key={i} className="px-4 py-3 rounded-lg bg-emerald-900/30 border border-emerald-700/40 text-emerald-300 text-sm flex items-center justify-between">
                <span>✓ {r.filename} — {res.replaced ? 'Replaced' : 'Uploaded'}: <strong>{res.warehouse}</strong> · PO <strong>{res.po_number}</strong> · {fmtShort(res.po_date)} · <strong>{res.matched}</strong> SKUs</span>
                <button onClick={() => setUploadResults(p => p.filter((_, j) => j !== i))}><X className="w-4 h-4 text-emerald-600 hover:text-emerald-400" /></button>
              </div>
            )
          })}
        </div>
      )}

      {/* Duplicate PO — different qty — confirm replace */}
      {dupConfirm && (
        <div className="card p-5 border border-amber-700/50 bg-amber-900/10 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-300">PO Already Uploaded — Quantities Changed</p>
              <p className="text-xs text-slate-400 mt-1">
                <strong className="text-slate-200">{dupConfirm.filename}</strong> — PO <strong className="text-slate-200">{dupConfirm.result.po_number}</strong> for <strong className="text-slate-200">{dupConfirm.result.warehouse}</strong> on <strong className="text-slate-200">{fmtShort(dupConfirm.result.po_date)}</strong> has already been uploaded but the quantities in this file are different.
              </p>
              <p className="text-xs text-amber-600 mt-2">Do you want to replace the existing PO data with the new quantities?</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={confirmReplace}
              disabled={replacing}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {replacing ? 'Replacing…' : 'Yes, Replace'}
            </button>
            <button
              onClick={() => setDupConfirm(null)}
              className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Unmapped SKUs exceptions */}
      {lastWithExceptions && (
        <div className="card overflow-hidden border border-amber-800/30">
          <div className="px-5 py-3 border-b border-amber-800/30 bg-amber-900/10 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-amber-300">Unmapped SKUs — not saved</span>
            <span className="ml-1 text-xs text-amber-700 bg-amber-900/40 px-2 py-0.5 rounded-full">{lastWithExceptions.result.exceptions.length}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-800/40">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">SKU Name from PO</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {lastWithExceptions.result.exceptions.map((ex, i) => (
                <tr key={i} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-amber-300 text-xs">{ex.sku_name}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-slate-400">{ex.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PO list */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
          <Truck className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-200">Purchase Orders In Transit</span>
          <span className="ml-1 text-xs text-slate-600 bg-slate-800 px-2 py-0.5 rounded-full">{grouped.length}</span>
        </div>

        {isLoading && <p className="py-12 text-center text-slate-500 text-sm">Loading…</p>}
        {!isLoading && grouped.length === 0 && (
          <p className="py-16 text-center text-slate-500 text-sm">No in-transit data yet. Upload a PO PDF to get started.</p>
        )}

        <div className="divide-y divide-slate-800/60">
          {grouped.map(group => {
            const key = `${group.warehouse}||${group.po_date}`
            const isOpen = expandedPo === key
            const totalQty = group.items.reduce((s, r) => s + (r.qty || 0), 0)
            return (
              <div key={key}>
                <div
                  className="px-4 py-3 flex items-center gap-3 hover:bg-slate-800/30 cursor-pointer transition-colors"
                  onClick={() => setExpandedPo(isOpen ? null : key)}
                >
                  {isOpen
                    ? <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  }
                  <WarehouseBadge code={group.warehouse} />
                  <span className="text-xs text-slate-400">{fmt(group.po_date)}</span>
                  <span className="text-xs text-slate-600 ml-1">{group.items.length} SKUs · {totalQty} units</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ ids: group.items.map(r => r.id), label: `${group.warehouse} / ${fmt(group.po_date)}` }) }}
                      className="p-1.5 hover:bg-red-900/30 rounded text-slate-600 hover:text-red-400 transition-colors"
                      title="Delete this PO"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="bg-slate-900/40 border-t border-slate-800/60">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-800/20">
                          <th className="px-8 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">SKU Name</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Qty</th>
                          <th className="px-4 py-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40">
                        {group.items.map(row => (
                          <tr key={row.id} className="hover:bg-slate-800/20">
                            <td className="px-8 py-2 text-slate-300 text-xs">{row.sku_name}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs text-slate-300">{row.qty}</td>
                            <td className="px-4 py-2 text-right">
                              <button
                                onClick={() => setDeleteTarget({ ids: [row.id], label: row.sku_name })}
                                className="p-1 hover:bg-red-900/30 rounded text-slate-700 hover:text-red-400 transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          for (const id of deleteTarget.ids) {
            await deleteMut.mutateAsync(id)
          }
          setDeleteTarget(null)
        }}
        title="Delete In-Transit Entry?"
        message={`Remove "${deleteTarget?.label}" from in-transit?`}
        warning="This will permanently delete the selected in-transit row(s)."
        loading={deleteMut.isPending}
      />
    </div>
  )
}

// ── COMPARE TAB ───────────────────────────────────────────────────────────────
function CompareTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [deletePoTarget, setDeletePoTarget] = useState(null)

  const { data: apiData = { rows: [], po_columns: {} }, isLoading, error } = useQuery({
    queryKey: ['zypee-compare-table'],
    queryFn: getZypeeCompareTable,
  })

  const deletePoMut = useMutation({
    mutationFn: deleteTransitPo,
    onSuccess: () => {
      qc.invalidateQueries(['zypee-compare-table'])
      qc.invalidateQueries(['zypee-in-transit'])
      setDeletePoTarget(null)
    },
  })

  const rows = apiData.rows || []
  const poColumns = apiData.po_columns || {}

  const allColumns = useMemo(() => {
    const cols = []
    for (const wh of WAREHOUSES) {
      cols.push({ type: 'stock', warehouse: wh, key: `${wh.toLowerCase()}_stock` })
      for (const col of (poColumns[wh] || [])) {
        cols.push({ type: 'transit', ...col })
      }
    }
    return cols
  }, [poColumns])

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const s = search.toLowerCase()
    return rows.filter(r => r.zypee_sku_name?.toLowerCase().includes(s))
  }, [rows, search])

  const WH_STOCK_COLORS = {
    MUM: 'text-blue-400/80', PUN: 'text-purple-400/80',
    DEL: 'text-amber-400/80', BLR: 'text-emerald-400/80',
  }
  const WH_TRANSIT_COLORS = {
    MUM: 'text-blue-400/50', PUN: 'text-purple-400/50',
    DEL: 'text-amber-400/50', BLR: 'text-emerald-400/50',
  }

  function numStock(v) {
    if (v === null || v === undefined) return <span className="text-slate-700">—</span>
    return <span className={v === 0 ? 'text-red-400' : v <= 10 ? 'text-amber-400' : 'text-slate-200'}>{v}</span>
  }

  function fmtShort(d) {
    if (!d) return '—'
    const [y, m, day] = d.split('-')
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${parseInt(day)}-${months[parseInt(m)-1]}-${y}`
  }

  // ── CSV download ──────────────────────────────────────────────────────────
  function downloadCsv() {
    if (!rows.length) return
    const headers = ['Zypee SKU', 'WH Stock', ...allColumns.map(col =>
      col.type === 'stock' ? `${col.warehouse} Stock` : `${col.warehouse} Transit (${fmtShort(col.po_date)})`
    )]
    const csvRows = rows.map(r => {
      const cells = [`"${r.zypee_sku_name}"`, r.wh_stock ?? '']
      for (const col of allColumns) {
        if (col.type === 'stock') cells.push(r[col.key] ?? '')
        else { const t = r[col.column_key]; cells.push(t?.qty ?? '') }
      }
      return cells.join(',')
    })
    const csv = [headers.join(','), ...csvRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `zypee_compare_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  // ── PDF download ──────────────────────────────────────────────────────────
  function downloadPdf() {
    if (!rows.length) return

    const headers = ['Zypee SKU', 'WH Stock', ...allColumns.map(col =>
      col.type === 'stock' ? `${col.warehouse} Stock` : `${col.warehouse} Transit\n${fmtShort(col.po_date)}`
    )]

    // Column widths (pt): SKU wide, rest narrow
    const colWidths = [160, 48, ...allColumns.map(() => 52)]
    const totalWidth = colWidths.reduce((s, w) => s + w, 0)
    const pageW = Math.max(totalWidth + 40, 595)
    const pageH = 420 // landscape A4-ish height

    const MARGIN = 20
    const ROW_H = 18
    const HEADER_H = 28
    const FONT_SIZE = 6.5
    const TITLE_SIZE = 9

    // Build SVG — we'll convert to PDF-like printable HTML
    // Using window.print with a hidden iframe for landscape PDF
    const colorsMap = { MUM: '#3b82f6', PUN: '#a855f7', DEL: '#f59e0b', BLR: '#10b981' }

    let html = `<!DOCTYPE html><html><head><style>
      @page { size: ${pageW}pt ${pageH}pt landscape; margin: 0; }
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, sans-serif; }
      body { padding: 16pt; background: white; }
      h1 { font-size: ${TITLE_SIZE}pt; color: #1e293b; margin-bottom: 8pt; }
      p.sub { font-size: 6pt; color: #64748b; margin-bottom: 10pt; }
      table { border-collapse: collapse; width: 100%; font-size: ${FONT_SIZE}pt; }
      th { background: #1e293b; color: #94a3b8; padding: 4pt 3pt; text-align: right; border: 0.5pt solid #334155; white-space: pre-line; font-weight: 600; font-size: 5.5pt; text-transform: uppercase; letter-spacing: 0.3pt; }
      th.sku-col { text-align: left; }
      td { padding: 3pt 3pt; text-align: right; border: 0.5pt solid #1e293b; background: #0f172a; color: #cbd5e1; }
      td.sku-col { text-align: left; font-size: 6pt; color: #e2e8f0; }
      tr:nth-child(even) td { background: #0f172a; }
      tr:nth-child(odd) td { background: #0b1222; }
      .zero { color: #ef4444; }
      .low { color: #f59e0b; }
      .dash { color: #334155; }
    </style></head><body>`

    html += `<h1>Zypee Stock + In Transit Compare</h1>`
    html += `<p class="sub">Generated: ${new Date().toLocaleString('en-IN')} &nbsp;|&nbsp; ${rows.length} SKUs</p>`
    html += `<table><thead><tr>`
    html += `<th class="sku-col" style="width:${colWidths[0]}pt">Zypee SKU</th>`
    html += `<th style="width:${colWidths[1]}pt">WH Stock</th>`
    allColumns.forEach((col, i) => {
      const color = colorsMap[col.warehouse] || '#94a3b8'
      const opacity = col.type === 'stock' ? '1' : '0.65'
      const label = col.type === 'stock'
        ? `${col.warehouse} Stock`
        : `${col.warehouse} Transit\n${fmtShort(col.po_date)}`
      html += `<th style="width:${colWidths[i+2]}pt;color:${color};opacity:${opacity}">${label}</th>`
    })
    html += `</tr></thead><tbody>`

    rows.forEach(row => {
      html += `<tr>`
      html += `<td class="sku-col">${row.zypee_sku_name}</td>`
      const whQty = row.wh_stock ?? 0
      html += `<td class="${whQty === 0 ? 'zero' : whQty <= 10 ? 'low' : ''}">${whQty}</td>`
      allColumns.forEach(col => {
        if (col.type === 'stock') {
          const v = row[col.key] ?? 0
          html += `<td class="${v === 0 ? 'zero' : v <= 10 ? 'low' : ''}">${v}</td>`
        } else {
          const t = row[col.column_key]
          if (t === null || t === undefined) {
            html += `<td class="dash">—</td>`
          } else {
            html += `<td class="${t.qty === 0 ? 'dash' : ''}">${t.qty}</td>`
          }
        }
      })
      html += `</tr>`
    })

    html += `</tbody></table></body></html>`

    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;'
    document.body.appendChild(iframe)
    iframe.contentDocument.open()
    iframe.contentDocument.write(html)
    iframe.contentDocument.close()
    setTimeout(() => {
      iframe.contentWindow.print()
      setTimeout(() => document.body.removeChild(iframe), 2000)
    }, 400)
  }

  const totalCols = 2 + allColumns.length

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="card p-4 flex flex-wrap items-center gap-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search SKUs…"
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded pl-8 pr-3 py-1.5 focus:outline-none focus:border-brand-500 placeholder-slate-600 w-56"
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          {rows.length > 0 && (<>
            <button
              onClick={downloadCsv}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
            <button
              onClick={downloadPdf}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm transition-colors"
            >
              <FileDown className="w-4 h-4" />
              PDF
            </button>
          </>)}
        </div>
      </div>

      {isLoading && <div className="card py-16 text-center"><p className="text-slate-500 text-sm">Loading compare table…</p></div>}
      {error && <div className="card p-4 border border-red-800/40"><p className="text-red-400 text-sm">{error.message}</p></div>}
      {!isLoading && rows.length === 0 && !error && (
        <div className="card py-20 text-center space-y-3">
          <Link2 className="w-8 h-8 text-slate-700 mx-auto" />
          <p className="text-slate-500 text-sm">No data yet.</p>
          <p className="text-slate-600 text-xs">Upload Zypee stock CSVs and create SKU mappings first.</p>
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-200">Stock + In Transit</span>
            <span className="text-xs text-slate-500">· {rows.length} SKUs</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-800/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider sticky left-0 bg-slate-800/40 z-10">Zypee SKU</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">WH Stock</th>
                  {allColumns.map(col => {
                    if (col.type === 'stock') return (
                      <th key={col.key} className={`px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider ${WH_STOCK_COLORS[col.warehouse]}`}>
                        {col.warehouse} Stock
                      </th>
                    )
                    return (
                      <th key={col.column_key} className={`px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider ${WH_TRANSIT_COLORS[col.warehouse]}`}>
                        <div className="flex flex-col items-end gap-0.5">
                          <span>{col.warehouse} Transit</span>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-normal text-slate-500 normal-case tracking-normal">{fmtShort(col.po_date)}</span>
                            <button onClick={() => setDeletePoTarget(col)}
                              className="p-0.5 hover:bg-red-900/40 rounded text-slate-600 hover:text-red-400 transition-all"
                              title={`Delete PO ${col.po_number}`}>
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.length === 0 && (
                  <tr><td colSpan={totalCols} className="py-10 text-center text-slate-500 text-sm">No results match search.</td></tr>
                )}
                {filtered.map((row, i) => (
                  <tr key={row.zypee_sku_name} className={`hover:bg-slate-800/30 transition-colors ${i % 2 === 1 ? 'bg-slate-800/10' : ''}`}>
                    <td className="px-4 py-3 text-slate-200 text-xs font-medium sticky left-0 bg-inherit">{row.zypee_sku_name}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{numStock(row.wh_stock)}</td>
                    {allColumns.map(col => {
                      if (col.type === 'stock') return (
                        <td key={col.key} className="px-3 py-3 text-right font-mono text-xs">{numStock(row[col.key])}</td>
                      )
                      const t = row[col.column_key]
                      return (
                        <td key={col.column_key} className="px-3 py-3 text-right font-mono text-xs">
                          {t === null || t === undefined
                            ? <span className="text-slate-700">—</span>
                            : <span className={t.qty === 0 ? 'text-slate-600' : WH_TRANSIT_COLORS[col.warehouse]}>{t.qty}</span>
                          }
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deletePoTarget}
        onClose={() => setDeletePoTarget(null)}
        onConfirm={() => deletePoMut.mutate({ warehouse: deletePoTarget.warehouse, po_date: deletePoTarget.po_date, po_number: deletePoTarget.po_number })}
        title="Delete PO Upload?"
        message={`Warehouse: ${deletePoTarget?.warehouse} · PO Number: ${deletePoTarget?.po_number} · PO Date: ${fmtShort(deletePoTarget?.po_date)}`}
        warning="This will permanently delete all transit rows for this PO. The entire column will disappear."
        loading={deletePoMut.isPending}
      />
    </div>
  )
}

// ── DEFAULT SKU LIST ─────────────────────────────────────────────────────────
const DEFAULT_SKUS = [
  // Khakhras — alphabetical
  'Achari Methi I Khapli Wheat Khakhra',
  'Bajra I Millet Khakhra',
  'Chola Fadi I High Protein Gluten Free Khakhra',
  'Green Moong I High Protein Gluten Free Khakhra',
  'Jowar & Bajra I Millet Khakhra',
  'Jowar I Millet Khakhra',
  'Methi Masala I Khapli Wheat Khakhra',
  'Sada I Khapli Wheat Khakhra',
  // Chana Jor — alphabetical by size
  'Chana Jor I 200 gms',
  'Chana Jor I 500 gms',
  'Chana Jor I 80 gms',
  // Moong Jor — alphabetical by size
  'Moong Jor I 200 gms',
  'Moong Jor I 80 gms',
  // High Fibre Millet Mix — alphabetical by size
  'High Fibre Millet Mix I 200 gms',
  'High Fibre Millet Mix I 80 gms',
]

const LS_KEY = 'zypee_sku_master'

// Sort SKUs: Khakhras first (alpha), then Chana Jor, Moong Jor, High Fibre Millet Mix (alpha within each)
function sortSkusForDownload(list) {
  const isKhakhra = s => /khakhra/i.test(s)
  const isChanaJor = s => /^chana jor/i.test(s)
  const isMoongJor = s => /^moong jor/i.test(s)
  const isMillet = s => /^high fibre millet mix/i.test(s)

  const group = s => {
    if (isKhakhra(s)) return 0
    if (isChanaJor(s)) return 1
    if (isMoongJor(s)) return 2
    if (isMillet(s)) return 3
    return 4
  }

  return [...list].sort((a, b) => {
    const ga = group(a), gb = group(b)
    if (ga !== gb) return ga - gb
    return a.localeCompare(b)
  })
}

function loadSkus() {
  try {
    const stored = localStorage.getItem(LS_KEY)
    if (stored) return JSON.parse(stored)
  } catch {}
  return DEFAULT_SKUS
}

function saveSkus(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)) } catch {}
}

// ── SKU MASTER TAB ────────────────────────────────────────────────────────────
function SkuMasterTab() {
  const [skus, setSkus] = useState(() => loadSkus())
  const [newSku, setNewSku] = useState('')
  const [genWarehouse, setGenWarehouse] = useState('MUM')
  const [genDate, setGenDate] = useState(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10) // yyyy-mm-dd for input[type=date]
  })
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)
  const [editIdx, setEditIdx] = useState(null)
  const [editVal, setEditVal] = useState('')

  function persist(next) { setSkus(next); saveSkus(next) }

  function addSku() {
    const v = newSku.trim()
    if (!v || skus.includes(v)) return
    persist([...skus, v])
    setNewSku('')
  }

  function removeSku(i) {
    const next = skus.filter((_, idx) => idx !== i)
    persist(next)
  }

  function startEdit(i) {
    setEditIdx(i)
    setEditVal(skus[i])
  }

  function commitEdit(i) {
    const v = editVal.trim()
    if (!v) { setEditIdx(null); return }
    const next = [...skus]
    next[i] = v
    persist(next)
    setEditIdx(null)
  }

  // Drag reorder
  function onDragStart(i) { setDragIdx(i) }
  function onDragEnter(i) { setOverIdx(i) }
  function onDragEnd() {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const next = [...skus]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(overIdx, 0, moved)
      persist(next)
    }
    setDragIdx(null)
    setOverIdx(null)
  }

  function resetToDefault() {
    if (window.confirm('Reset to default SKU list? This will discard any changes.')) {
      persist([...DEFAULT_SKUS])
    }
  }

  function generateCsv() {
    // filename: WAREHOUSE_DD-MM-YYYY.csv
    const [year, month, day] = genDate.split('-')
    const filename = `${genWarehouse}_${day}-${month}-${year}.csv`
    const sorted = sortSkusForDownload(skus)
    const lines = ['sku,name,old_quantity', ...sorted.map(s => `,"${s}",0`)]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      {/* Left: SKU list manager */}
      <div className="xl:col-span-3 card overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-200">SKU Master List</h2>
            <span className="ml-1 text-xs text-slate-600 bg-slate-800 px-2 py-0.5 rounded-full">{skus.length}</span>
          </div>
          <button
            onClick={resetToDefault}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            Reset defaults
          </button>
        </div>

        {/* Add new SKU */}
        <div className="px-4 py-3 border-b border-slate-800 flex gap-2">
          <input
            type="text"
            value={newSku}
            onChange={e => setNewSku(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addSku()}
            placeholder="Type SKU name and press Enter…"
            className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-brand-500 placeholder-slate-600"
          />
          <button
            onClick={addSku}
            disabled={!newSku.trim()}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed px-3"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* SKU list */}
        <div className="flex-1 overflow-y-auto max-h-[520px] divide-y divide-slate-800/40">
          {skus.length === 0 && (
            <p className="px-4 py-8 text-xs text-slate-500 text-center">No SKUs yet. Add one above.</p>
          )}
          {skus.map((sku, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragEnter={() => onDragEnter(i)}
              onDragEnd={onDragEnd}
              onDragOver={e => e.preventDefault()}
              className={`flex items-center gap-3 px-3 py-2.5 hover:bg-slate-800/30 transition-colors group cursor-grab active:cursor-grabbing ${
                overIdx === i && dragIdx !== i ? 'border-t-2 border-brand-500' : ''
              }`}
            >
              <GripVertical className="w-3.5 h-3.5 text-slate-700 group-hover:text-slate-500 flex-shrink-0" />
              <span className="text-xs text-slate-500 w-5 flex-shrink-0 font-mono">{i + 1}</span>

              {editIdx === i ? (
                <input
                  autoFocus
                  value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  onBlur={() => commitEdit(i)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitEdit(i)
                    if (e.key === 'Escape') setEditIdx(null)
                  }}
                  className="flex-1 bg-slate-700 border border-brand-500 text-slate-100 text-sm rounded px-2 py-0.5 focus:outline-none"
                />
              ) : (
                <span
                  className="flex-1 text-sm text-slate-200 cursor-text"
                  onDoubleClick={() => startEdit(i)}
                  title="Double-click to edit"
                >
                  {sku}
                </span>
              )}

              <button
                onClick={() => removeSku(i)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-900/30 rounded text-slate-600 hover:text-red-400 transition-all flex-shrink-0"
                title="Remove"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-slate-800">
          <p className="text-xs text-slate-600">Drag to reorder · Double-click to edit · Hover to delete</p>
        </div>
      </div>

      {/* Right: Generate CSV panel */}
      <div className="xl:col-span-2 space-y-4">
        <div className="card p-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <FileDown className="w-4 h-4 text-slate-400" />
              Generate Upload CSV
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Creates a pre-filled CSV with all {skus.length} SKUs at qty 0.
              Fill in quantities, then upload.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Warehouse</label>
              <div className="flex gap-2">
                {WAREHOUSES.map(wh => (
                  <button
                    key={wh}
                    onClick={() => setGenWarehouse(wh)}
                    className={`flex-1 py-1.5 rounded text-xs font-bold border transition-colors ${
                      genWarehouse === wh
                        ? WH_COLORS[wh]
                        : 'bg-slate-800/40 text-slate-500 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    {wh}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Date</label>
              <input
                type="date"
                value={genDate}
                onChange={e => setGenDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          {/* Preview filename */}
          {genDate && (
            <div className="bg-slate-800/60 rounded-lg px-3 py-2.5 border border-slate-700/50">
              <p className="text-xs text-slate-500 mb-0.5">Output filename</p>
              <p className="text-sm font-mono text-slate-200">
                {(() => {
                  const [y, m, d] = genDate.split('-')
                  return `${genWarehouse}_${d}-${m}-${y}.csv`
                })()}
              </p>
            </div>
          )}

          <button
            onClick={generateCsv}
            disabled={!skus.length || !genDate}
            className="w-full btn-primary justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Download CSV ({skus.length} SKUs)
          </button>
        </div>

        {/* Instructions card */}
        <div className="card p-4 space-y-2.5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">How to use</p>
          <ol className="space-y-2 text-xs text-slate-500">
            <li className="flex gap-2"><span className="text-brand-400 font-bold flex-shrink-0">1.</span>Manage your SKU list on the left (add / remove / reorder)</li>
            <li className="flex gap-2"><span className="text-brand-400 font-bold flex-shrink-0">2.</span>Pick warehouse + date, click Download CSV</li>
            <li className="flex gap-2"><span className="text-brand-400 font-bold flex-shrink-0">3.</span>Open the file, fill in <code className="bg-slate-800 px-1 rounded">old_quantity</code> for each SKU</li>
            <li className="flex gap-2"><span className="text-brand-400 font-bold flex-shrink-0">4.</span>Go to Stock tab → Upload CSV</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
export default function Zypee() {
  const qc = useQueryClient()
  const fileInputRef = useRef(null)
  const [activeTab, setActiveTab] = useState('stock') // 'stock' | 'in-transit' | 'compare' | 'skumaster'
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [error, setError] = useState(null)
  const [uploadSuccess, setUploadSuccess] = useState(null)

  const { data: uploads = [], isLoading: uploadsLoading } = useQuery({
    queryKey: ['zypee-uploads'],
    queryFn: getZypeeUploads,
  })

  const uploadMut = useMutation({
    mutationFn: uploadZypee,
    onSuccess: (data) => {
      qc.invalidateQueries(['zypee-uploads'])
      qc.invalidateQueries(['zypee-stock'])
      setError(null)
      setUploadSuccess(`✓ Loaded ${data.rows_loaded} rows for ${data.warehouse} — ${fmt(data.stock_date)}`)
      setTimeout(() => setUploadSuccess(null), 4000)
    },
    onError: (e) => setError(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: deleteZypeeUpload,
    onSuccess: () => {
      qc.invalidateQueries(['zypee-uploads'])
      qc.invalidateQueries(['zypee-stock'])
      setDeleteTarget(null)
    },
  })

  return (
    <div className="px-8 py-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Zypee Stock</h1>
          <p className="text-sm text-slate-500 mt-1">Daily warehouse stock by city</p>
        </div>
        <button
          onClick={() => { setError(null); fileInputRef.current?.click() }}
          disabled={uploadMut.isPending}
          className="btn-primary"
        >
          <Upload className="w-4 h-4" />
          {uploadMut.isPending ? 'Uploading…' : 'Upload CSV'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) uploadMut.mutate(f)
            e.target.value = ''
          }}
        />
      </div>

      {/* Error / success banners */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-sm">
          {error} <span className="ml-2 text-xs text-red-500">Filename must be: WAREHOUSE_DD-MM-YYYY.csv</span>
        </div>
      )}
      {uploadSuccess && (
        <div className="px-4 py-3 rounded-lg bg-emerald-900/30 border border-emerald-700/40 text-emerald-300 text-sm">
          {uploadSuccess}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-800">
        <button
          onClick={() => setActiveTab('stock')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'stock'
              ? 'border-brand-500 text-slate-100'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          Stock
        </button>
        <button
          onClick={() => setActiveTab('in-transit')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${
            activeTab === 'in-transit'
              ? 'border-brand-500 text-slate-100'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          In Transit
        </button>
        <button
          onClick={() => setActiveTab('compare')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${
            activeTab === 'compare'
              ? 'border-brand-500 text-slate-100'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Compare Warehouses
        </button>
        <button
          onClick={() => setActiveTab('skumaster')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${
            activeTab === 'skumaster'
              ? 'border-brand-500 text-slate-100'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          SKU Master
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'stock' && (
        <StockTab
          uploads={uploads}
          uploadsLoading={uploadsLoading}
          setDeleteTarget={setDeleteTarget}
        />
      )}
      {activeTab === 'in-transit' && (
        <InTransitTab />
      )}
      {activeTab === 'compare' && (
        <CompareTab />
      )}
      {activeTab === 'skumaster' && (
        <SkuMasterTab />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        title="Delete Upload?"
        message={`Remove ${deleteTarget?.warehouse} data for ${fmt(deleteTarget?.stock_date)}?`}
        warning="This will permanently delete all stock rows for this upload."
        loading={deleteMut.isPending}
      />
    </div>
  )
}