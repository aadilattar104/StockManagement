import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getMappings, createMapping, deleteMapping,
  getStock, getZypeeUploads, getZypeeStock,
} from '../api/client'
import ConfirmDialog from '../components/ConfirmDialog'
import { Link2, Trash2, Plus, Search, AlertTriangle, CheckCircle2, ArrowRight, X } from 'lucide-react'

// ── helpers ───────────────────────────────────────────────────────────────────
function warehouseLabel(s) {
  if (!s) return '—'
  return s.weight ? `${s.title} | ${s.weight}` : s.title
}

// ── Create Mapping Panel ──────────────────────────────────────────────────────
function CreateMappingPanel({ warehouseStock, existingMappings, zypeeSkuNames, onCreated }) {
  const qc = useQueryClient()
  const [zypeeName, setZypeeName] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [stockSearch, setStockSearch] = useState('')
  const [zypeeSearch, setZypeeSearch] = useState('')
  const [error, setError] = useState(null)

  const alreadyMapped = new Set(existingMappings.map(m => m.zypee_sku_name))

  const filteredStock = useMemo(() => {
    const s = stockSearch.toLowerCase()
    return warehouseStock.filter(ws =>
      warehouseLabel(ws).toLowerCase().includes(s)
    )
  }, [warehouseStock, stockSearch])

  const createMut = useMutation({
    mutationFn: createMapping,
    onSuccess: () => {
      qc.invalidateQueries(['sku-mappings'])
      setZypeeName('')
      setWarehouseId('')
      setStockSearch('')
      setError(null)
      onCreated?.()
    },
    onError: (e) => setError(e.message),
  })

  function handleSubmit() {
    const name = zypeeName.trim()
    if (!name) { setError('Enter a Zypee SKU name'); return }
    if (!warehouseId) { setError('Select a warehouse SKU'); return }
    setError(null)
    createMut.mutate({ zypee_sku_name: name, warehouse_stock_id: warehouseId })
  }

  const unmappedZypeeNames = zypeeSkuNames.filter(n => !alreadyMapped.has(n))

  const filteredZypeeNames = useMemo(() => {
    if (!zypeeSearch.trim()) return unmappedZypeeNames
    const s = zypeeSearch.toLowerCase()
    return unmappedZypeeNames.filter(n => n.toLowerCase().includes(s))
  }, [unmappedZypeeNames, zypeeSearch])

  return (
    <div className="card p-5 space-y-5">
      <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
        <Plus className="w-4 h-4 text-slate-400" />
        Create New Mapping
      </h2>

      {/* Zypee SKU */}
      <div>
        <label className="block text-xs text-slate-500 mb-1.5">Zypee SKU Name</label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={zypeeSearch || zypeeName}
            onChange={e => { setZypeeSearch(e.target.value); setZypeeName(e.target.value) }}
            placeholder="Search or type Zypee SKU name…"
            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded pl-8 pr-3 py-2 focus:outline-none focus:border-brand-500 placeholder-slate-600"
          />
        </div>
        {unmappedZypeeNames.length > 0 && filteredZypeeNames.length > 0 && (
          <div className="mt-1.5 max-h-36 overflow-y-auto space-y-0.5 border border-slate-700/50 rounded">
            {filteredZypeeNames.map(name => (
              <button
                key={name}
                onClick={() => { setZypeeName(name); setZypeeSearch('') }}
                className={`w-full text-left text-xs px-2 py-1.5 rounded transition-colors flex items-center gap-2 ${
                  zypeeName === name
                    ? 'bg-brand-700/30 text-brand-300 border border-brand-700/50'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Arrow */}
      <div className="flex items-center gap-2 text-slate-600">
        <div className="flex-1 h-px bg-slate-800" />
        <ArrowRight className="w-4 h-4" />
        <div className="flex-1 h-px bg-slate-800" />
      </div>

      {/* Warehouse SKU */}
      <div>
        <label className="block text-xs text-slate-500 mb-1.5">Maps To → Warehouse SKU</label>
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={stockSearch}
            onChange={e => setStockSearch(e.target.value)}
            placeholder="Search warehouse SKUs…"
            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded pl-8 pr-3 py-1.5 focus:outline-none focus:border-brand-500 placeholder-slate-600"
          />
        </div>
        <div className="max-h-40 overflow-y-auto border border-slate-700/50 rounded divide-y divide-slate-800/60">
          {filteredStock.length === 0 && (
            <p className="text-xs text-slate-500 px-3 py-4 text-center">No warehouse SKUs found.</p>
          )}
          {filteredStock.map(ws => (
            <button
              key={ws.id}
              onClick={() => setWarehouseId(ws.id)}
              className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-3 ${
                warehouseId === ws.id
                  ? 'bg-brand-700/30 text-brand-200'
                  : 'text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <span className="flex-1">{warehouseLabel(ws)}</span>
              <span className={`font-mono font-semibold flex-shrink-0 ${
                ws.stock_qty === 0 ? 'text-red-400' :
                ws.stock_qty <= 30 ? 'text-amber-400' : 'text-slate-400'
              }`}>
                {ws.stock_qty}
              </span>
              {warehouseId === ws.id && <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-800/40">{error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={!zypeeName.trim() || !warehouseId || createMut.isPending}
        className="w-full btn-primary justify-center disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Link2 className="w-4 h-4" />
        {createMut.isPending ? 'Saving…' : 'Save Mapping'}
      </button>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SkuNormalization() {
  const qc = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [search, setSearch] = useState('')

  const { data: mappings = [], isLoading: mappingsLoading } = useQuery({
    queryKey: ['sku-mappings'],
    queryFn: getMappings,
  })

  const { data: warehouseStock = [] } = useQuery({
    queryKey: ['stock'],
    queryFn: getStock,
  })

  // Get all unique Zypee SKU names from uploads (any warehouse, any date)
  const { data: uploads = [] } = useQuery({
    queryKey: ['zypee-uploads'],
    queryFn: getZypeeUploads,
  })

  // Collect all unique Zypee SKU names from the latest upload per warehouse.
  // Uses the same VITE_API_URL env var that client.js uses so it works on production (Render).
  const { data: allZypeeNames = [] } = useQuery({
    queryKey: ['zypee-all-sku-names', uploads.map(u => u.warehouse + ':' + u.stock_date).join(',')],
    queryFn: async () => {
      // Determine latest upload per warehouse
      const byWh = {}
      for (const u of uploads) {
        if (!byWh[u.warehouse] || u.stock_date > byWh[u.warehouse].stock_date) {
          byWh[u.warehouse] = u
        }
      }
      // Use the same API base that client.js uses via VITE_API_URL.
      // On localhost Vite proxies empty-string base; on Render VITE_API_URL is set.
      // Use getZypeeStock from client.js — it already has the correct base URL for prod/dev
      const names = new Set()
      await Promise.all(
        Object.values(byWh).map(async upload => {
          try {
            const rows = await getZypeeStock(upload.warehouse, upload.stock_date)
            for (const r of (Array.isArray(rows) ? rows : [])) { if (r.name) names.add(r.name) }
          } catch (_) {
            // ignore individual warehouse failures — others still populate the list
          }
        })
      )
      return [...names].sort()
    },
    enabled: uploads.length > 0,
    staleTime: 60_000,
  })

  const deleteMut = useMutation({
    mutationFn: deleteMapping,
    onSuccess: () => {
      qc.invalidateQueries(['sku-mappings'])
      setDeleteTarget(null)
    },
  })

  const filteredMappings = useMemo(() => {
    if (!search.trim()) return mappings
    const s = search.toLowerCase()
    return mappings.filter(m =>
      m.zypee_sku_name.toLowerCase().includes(s) ||
      m.warehouse_sku_label?.toLowerCase().includes(s)
    )
  }, [mappings, search])

  const mappedZypeeNames = new Set(mappings.map(m => m.zypee_sku_name))
  const unmappedZypeeNames = allZypeeNames.filter(n => !mappedZypeeNames.has(n))

  return (
    <div className="px-8 py-8 max-w-7xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
          <Link2 className="w-6 h-6 text-slate-400" />
          SKU Normalization
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Manually map Zypee SKU names to Warehouse SKUs. Only mapped SKUs participate in stock comparison.
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-slate-500 mb-1">Mapped SKUs</p>
          <p className="text-2xl font-bold text-slate-100">{mappings.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 mb-1">Unmapped Zypee SKUs</p>
          <p className={`text-2xl font-bold ${unmappedZypeeNames.length > 0 ? 'text-amber-400' : 'text-slate-100'}`}>
            {unmappedZypeeNames.length}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 mb-1">Total Warehouse SKUs</p>
          <p className="text-2xl font-bold text-slate-100">{warehouseStock.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Left: Create mapping */}
        <div className="xl:col-span-2">
          <CreateMappingPanel
            warehouseStock={warehouseStock}
            existingMappings={mappings}
            zypeeSkuNames={allZypeeNames}
            onCreated={() => {}}
          />

          {/* Unmapped warning */}
          {unmappedZypeeNames.length > 0 && (
            <div className="mt-4 card p-4 border border-amber-800/40">
              <p className="text-xs font-semibold text-amber-400 flex items-center gap-2 mb-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                {unmappedZypeeNames.length} Zypee SKU{unmappedZypeeNames.length > 1 ? 's' : ''} need mapping
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {unmappedZypeeNames.map(name => (
                  <p key={name} className="text-xs text-slate-400 px-2 py-1 bg-slate-800/50 rounded">
                    {name}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Mappings table */}
        <div className="xl:col-span-3 card overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-200">Saved Mappings</h2>
            <span className="text-xs text-slate-600 bg-slate-800 px-2 py-0.5 rounded-full">{mappings.length}</span>
            <div className="ml-auto relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded pl-8 pr-3 py-1.5 focus:outline-none focus:border-brand-500 placeholder-slate-600 w-48"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {mappingsLoading && (
              <p className="text-center text-xs text-slate-500 py-12">Loading…</p>
            )}
            {!mappingsLoading && mappings.length === 0 && (
              <div className="py-20 text-center space-y-2">
                <Link2 className="w-8 h-8 text-slate-700 mx-auto" />
                <p className="text-slate-500 text-sm">No mappings yet.</p>
                <p className="text-slate-600 text-xs">Create your first mapping on the left.</p>
              </div>
            )}
            {!mappingsLoading && mappings.length > 0 && filteredMappings.length === 0 && (
              <p className="text-center text-xs text-slate-500 py-12">No mappings match your search.</p>
            )}
            {filteredMappings.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-800/40 sticky top-0">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Zypee SKU</th>
                    <th className="px-4 py-2 text-slate-700 w-6 text-center">→</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Warehouse SKU</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">WH Stock</th>
                    <th className="px-2 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredMappings.map(m => (
                    <tr key={m.id} className="hover:bg-slate-800/30 transition-colors group">
                      <td className="px-4 py-3 text-slate-200 text-xs">{m.zypee_sku_name}</td>
                      <td className="px-2 py-3 text-slate-700 text-center text-xs">→</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{m.warehouse_sku_label}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-mono text-xs font-semibold ${
                          m.warehouse_stock_qty === 0 ? 'text-red-400' :
                          m.warehouse_stock_qty <= 30 ? 'text-amber-400' : 'text-slate-300'
                        }`}>
                          {m.warehouse_stock_qty ?? '—'}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-right">
                        <button
                          onClick={() => setDeleteTarget(m)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-900/30 rounded text-slate-600 hover:text-red-400 transition-all"
                          title="Delete mapping"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {mappings.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-800">
              <p className="text-xs text-slate-600">Hover a row to delete · Deletions cannot be undone</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        title="Delete Mapping?"
        message={`Remove mapping: "${deleteTarget?.zypee_sku_name}" → "${deleteTarget?.warehouse_sku_label}"?`}
        warning="This SKU will no longer participate in warehouse comparison until remapped."
        loading={deleteMut.isPending}
      />
    </div>
  )
}