import { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getZypeeUploads, uploadZypee, deleteZypeeUpload, getZypeeStock,
  uploadInTransit, getInTransit, deleteInTransit, getZypeeCompareTable
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
  const [uploadResult, setUploadResult] = useState(null) // { matched, exceptions }
  const [uploadError, setUploadError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [expandedPo, setExpandedPo] = useState(null) // po_number to expand

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['zypee-in-transit'],
    queryFn: getInTransit,
  })

  const uploadMut = useMutation({
    mutationFn: uploadInTransit,
    onSuccess: (data) => {
      qc.invalidateQueries(['zypee-in-transit'])
      qc.invalidateQueries(['zypee-compare-table'])
      setUploadResult(data)
      setUploadError(null)
    },
    onError: (e) => {
      setUploadError(e.response?.data?.detail || e.message)
      setUploadResult(null)
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteInTransit,
    onSuccess: () => {
      qc.invalidateQueries(['zypee-in-transit'])
      qc.invalidateQueries(['zypee-compare-table'])
      setDeleteTarget(null)
    },
  })

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

  return (
    <div className="space-y-6">
      {/* Upload banner */}
      <div className="card p-5 flex flex-wrap items-center gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-200">Upload PO PDF</p>
          <p className="text-xs text-slate-500 mt-0.5">Extracts PO number, date, SKU names and quantities automatically</p>
        </div>
        <button
          onClick={() => { setUploadError(null); setUploadResult(null); fileInputRef.current?.click() }}
          disabled={uploadMut.isPending}
          className="ml-auto btn-primary"
        >
          <Upload className="w-4 h-4" />
          {uploadMut.isPending ? 'Processing…' : 'Upload PO PDF'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) uploadMut.mutate(f)
            e.target.value = ''
          }}
        />
      </div>

      {/* Upload error */}
      {uploadError && (
        <div className="px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-sm">
          {uploadError}
        </div>
      )}

      {/* Upload result */}
      {uploadResult && (
        <div className="space-y-3">
          <div className="px-4 py-3 rounded-lg bg-emerald-900/30 border border-emerald-700/40 text-emerald-300 text-sm flex items-center justify-between">
            <span>✓ Uploaded {uploadResult.matched || 0} rows for {uploadResult.warehouse} — {fmt(uploadResult.po_date)}</span>
            <button onClick={() => setUploadResult(null)} className="text-emerald-600 hover:text-emerald-400">
              <X className="w-4 h-4" />
            </button>
          </div>
          {uploadResult.exceptions?.length > 0 && (
            <div className="card overflow-hidden border border-amber-800/30">
              <div className="px-5 py-3 border-b border-amber-800/30 bg-amber-900/10 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-amber-300">Unmapped SKUs — not saved</span>
                <span className="ml-1 text-xs text-amber-700 bg-amber-900/40 px-2 py-0.5 rounded-full">{uploadResult.exceptions.length}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-800/40">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">SKU Name from PO</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {uploadResult.exceptions.map((ex, i) => (
                    <tr key={i} className="hover:bg-slate-800/30">
                      <td className="px-4 py-3 text-amber-300 text-xs">{ex.sku_name}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-400">{ex.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                {/* PO header row */}
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
                {/* Expanded SKU rows */}
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

  const { data: apiData = { rows: [], po_status: {} }, isLoading, error, refetch } = useQuery({
    queryKey: ['zypee-compare-table'],
    queryFn: getZypeeCompareTable,
  })

  const deleteTransitMut = useMutation({
    mutationFn: deleteInTransit,
    onSuccess: () => {
      qc.invalidateQueries(['zypee-compare-table'])
      qc.invalidateQueries(['zypee-in-transit'])
    },
  })

  const rows = apiData.rows || []
  const poStatus = apiData.po_status || {}  // { MUM: true, PUN: false, ... }

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const s = search.toLowerCase()
    return rows.filter(r => r.zypee_sku_name?.toLowerCase().includes(s))
  }, [rows, search])

  function numStock(v) {
    if (v === null || v === undefined) return <span className="text-slate-700">—</span>
    return <span className={v === 0 ? 'text-red-400' : v <= 10 ? 'text-amber-400' : 'text-slate-200'}>{v}</span>
  }

  // For in-transit: null = no PO uploaded; [] = PO uploaded but no qty; array of entries
  function numTransit(entries, colorClass) {
    if (entries === null || entries === undefined) {
      return <span className="text-slate-600 text-xs italic">no PO</span>
    }
    if (entries.length === 0) {
      return <span className="text-slate-700 opacity-40">0</span>
    }
    return (
      <div className="flex flex-col gap-1 items-end">
        {entries.map(e => (
          <div key={e.id} className="flex items-center gap-1.5 group">
            <div className="text-right">
              <div className={`font-mono font-semibold ${colorClass}`}>{e.qty}</div>
              <div className="text-slate-600 text-[10px]">{fmt(e.po_date)}</div>
            </div>
            <button
              onClick={() => deleteTransitMut.mutate(e.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-900/40 rounded text-slate-600 hover:text-red-400 transition-all"
              title="Delete this transit entry"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    )
  }

  function downloadCsv() {
    if (!rows.length) return
    const header = ['Zypee SKU', 'WH Stock', 'MUM Stock', 'MUM In Transit', 'PUN Stock', 'PUN In Transit', 'DEL Stock', 'DEL In Transit', 'BLR Stock', 'BLR In Transit'].join(',')
    const sumTransit = (entries) => {
      if (entries === null || entries === undefined) return 'PO not uploaded'
      return entries.reduce((s, e) => s + (e.qty || 0), 0)
    }
    const csvRows = rows.map(r => [
      `"${r.zypee_sku_name}"`,
      r.wh_stock ?? '',
      r.mum_stock ?? '',
      sumTransit(r.mum_in_transit),
      r.pun_stock ?? '',
      sumTransit(r.pun_in_transit),
      r.del_stock ?? '',
      sumTransit(r.del_in_transit),
      r.blr_stock ?? '',
      sumTransit(r.blr_in_transit),
    ].join(','))
    const csv = [header, ...csvRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zypee_compare_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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
          {rows.length > 0 && (
            <button
              onClick={downloadCsv}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              Download CSV
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="card py-16 text-center">
          <p className="text-slate-500 text-sm">Loading compare table…</p>
        </div>
      )}

      {error && (
        <div className="card p-4 border border-red-800/40">
          <p className="text-red-400 text-sm">{error.message}</p>
        </div>
      )}

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
            <span className="text-xs text-slate-500">·</span>
            <span className="text-xs text-slate-500">{rows.length} SKUs</span>
            {/* PO upload status badges */}
            <span className="text-xs text-slate-500">·</span>
            {WAREHOUSES.map(wh => (
              <span key={wh} className={`text-xs px-1.5 py-0.5 rounded border ${poStatus[wh] ? 'bg-emerald-900/30 text-emerald-400 border-emerald-700/40' : 'bg-slate-800 text-slate-600 border-slate-700'}`}>
                {wh} {poStatus[wh] ? '✓' : 'no PO'}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-800/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider sticky left-0 bg-slate-800/40 z-10">Zypee SKU</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">WH Stock</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-blue-400/80 uppercase tracking-wider">MUM Stock</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-blue-400/50 uppercase tracking-wider">MUM Transit</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-purple-400/80 uppercase tracking-wider">PUN Stock</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-purple-400/50 uppercase tracking-wider">PUN Transit</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-amber-400/80 uppercase tracking-wider">DEL Stock</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-amber-400/50 uppercase tracking-wider">DEL Transit</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-emerald-400/80 uppercase tracking-wider">BLR Stock</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-emerald-400/50 uppercase tracking-wider">BLR Transit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.length === 0 && (
                  <tr><td colSpan={10} className="py-10 text-center text-slate-500 text-sm">No results match search.</td></tr>
                )}
                {filtered.map((row, i) => (
                  <tr key={row.zypee_sku_name} className={`hover:bg-slate-800/30 transition-colors ${i % 2 === 1 ? 'bg-slate-800/10' : ''}`}>
                    <td className="px-4 py-3 text-slate-200 text-xs font-medium sticky left-0 bg-inherit">{row.zypee_sku_name}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{numStock(row.wh_stock)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{numStock(row.mum_stock)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{numTransit(row.mum_in_transit, 'text-blue-300/70')}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{numStock(row.pun_stock)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{numTransit(row.pun_in_transit, 'text-purple-300/70')}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{numStock(row.del_stock)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{numTransit(row.del_in_transit, 'text-amber-300/70')}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{numStock(row.blr_stock)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{numTransit(row.blr_in_transit, 'text-emerald-300/70')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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