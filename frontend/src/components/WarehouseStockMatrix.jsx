import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { getWarehouseStockMatrix, deleteTransitPo } from '../api/client'
import ConfirmDialog from '../components/ConfirmDialog'

const WH_TRANSIT_COLORS = {
  MUM: 'text-blue-400/50', PUN: 'text-purple-400/50',
  DEL: 'text-amber-400/50', BLR: 'text-emerald-400/50',
}

// Matches the backend's WAREHOUSE_LABELS mapping in main.py — needed so we
// can look up each city column's warehouse code and find its transit PO columns.
const LABEL_TO_CODE = { Bangalore: 'BLR', Mumbai: 'MUM', Pune: 'PUN', Delhi: 'DEL' }

function fmtShort(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${parseInt(day)}-${months[parseInt(m) - 1]}-${y}`
}

// Builds one flat ordered column list: for each warehouse (in warehouse_columns
// order), its city-stock column immediately followed by its own transit PO
// column(s) — same layout the old Compare Warehouses tab used.
function buildColumns(warehouse_columns, po_columns) {
  const cols = []
  for (const label of warehouse_columns) {
    const code = LABEL_TO_CODE[label] || label
    cols.push({ type: 'stock', label, code })
    for (const col of (po_columns[code] || [])) {
      cols.push({ type: 'transit', ...col })
    }
  }
  return cols
}

function buildTableData(rows, columns) {
  const headers = ['SKU', 'Warehouse Stock', ...columns.map(col =>
    col.type === 'stock' ? col.label : `${col.warehouse} Transit (${fmtShort(col.po_date)})`
  )]
  const body = rows.map(row => [
    row.sku_weight ? `${row.sku_title} (${row.sku_weight})` : row.sku_title,
    row.warehouse_stock,
    ...columns.map(col =>
      col.type === 'stock'
        ? (row.city_stock?.[col.label] ?? '-')
        : (row.transit_cols?.[col.column_key]?.qty ?? '-')
    ),
  ])
  return { headers, body }
}

async function exportToExcel(rows, columns) {
  let XLSX
  try {
    XLSX = await import('xlsx')
  } catch {
    alert('xlsx package not available.')
    return
  }

  const { headers, body } = buildTableData(rows, columns)
  const ws = XLSX.utils.aoa_to_sheet([headers, ...body])
  ws['!cols'] = [{ wch: 36 }, { wch: 16 }, ...columns.map(() => ({ wch: 14 }))]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Warehouse Stock Matrix')
  XLSX.writeFile(wb, `warehouse-stock-matrix-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export default function WarehouseStockMatrix() {
  const qc = useQueryClient()
  const [deletePoTarget, setDeletePoTarget] = useState(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['warehouse-stock-matrix'],
    queryFn: getWarehouseStockMatrix,
  })

  const deletePoMut = useMutation({
    mutationFn: deleteTransitPo,
    onSuccess: () => {
      qc.invalidateQueries(['warehouse-stock-matrix'])
      qc.invalidateQueries(['zypee-in-transit'])
      setDeletePoTarget(null)
    },
  })

  if (isLoading)
    return (
      <div className="card p-8 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )

  if (error)
    return (
      <div className="card p-6 text-red-400 text-sm">
        Failed to load warehouse stock matrix: {error.message}
      </div>
    )

  const { warehouse_columns = [], rows = [], po_columns = {} } = data || {}

  // Interleaved: each warehouse's stock column immediately followed by its
  // own transit PO column(s), in warehouse_columns order.
  const columns = buildColumns(warehouse_columns, po_columns)

  if (!rows.length)
    return (
      <div className="card p-8 text-center text-slate-500 text-sm">
        No products in the Product Master yet. Approve products in the Warehouse Stock page to see them here.
      </div>
    )

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Warehouse Stock Matrix</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {rows.length} Product Master SKUs · order matches the Product Master
          </p>
        </div>
        <button
          onClick={() => exportToExcel(rows, columns)}
          className="text-xs px-3 py-1.5 rounded border border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-colors"
          title="Export to Excel"
        >
          ↓ Export to Excel
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-800/60">
              <th className="sticky left-0 z-10 bg-slate-800 px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-r border-slate-700 min-w-[220px]">
                SKU
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-r border-slate-700 min-w-[110px]">
                Warehouse Stock
              </th>
              {columns.map(col => col.type === 'stock' ? (
                <th key={col.label} className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-r border-slate-700/50 min-w-[100px]">
                  {col.label}
                </th>
              ) : (
                <th key={col.column_key} className={`px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap border-r border-slate-700/50 min-w-[100px] ${WH_TRANSIT_COLORS[col.warehouse]}`}>
                  <div className="flex flex-col items-end gap-0.5">
                    <span>{col.warehouse} Transit</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-normal text-slate-500 normal-case tracking-normal">{fmtShort(col.po_date)}</span>
                      <button
                        onClick={() => setDeletePoTarget(col)}
                        className="p-0.5 hover:bg-red-900/40 rounded text-slate-600 hover:text-red-400 transition-all"
                        title={`Delete PO ${col.po_number}`}
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rows.map((row, idx) => (
              <tr key={row.product_master_id || idx} className="hover:bg-slate-800/30 transition-colors">
                <td className="sticky left-0 z-10 bg-slate-900 px-4 py-3 border-r border-slate-700">
                  <div className="font-medium text-slate-200 leading-tight">{row.sku_title}</div>
                  {row.sku_weight && <div className="text-xs text-slate-500 mt-0.5">{row.sku_weight}</div>}
                </td>
                <td className="px-4 py-3 text-right font-mono border-r border-slate-700">
                  <span className={
                    row.warehouse_stock === 0 ? 'text-red-400 font-bold' :
                    row.warehouse_stock <= 30 ? 'text-amber-400 font-semibold' : 'text-green-400'
                  }>
                    {row.warehouse_stock}
                  </span>
                </td>
                {columns.map(col => {
                  if (col.type === 'stock') return (
                    <td key={col.label} className="px-4 py-3 text-right font-mono text-slate-500 border-r border-slate-700/50">
                      {row.city_stock?.[col.label] ?? '-'}
                    </td>
                  )
                  const t = row.transit_cols?.[col.column_key]
                  return (
                    <td key={col.column_key} className="px-4 py-3 text-right font-mono border-r border-slate-700/50">
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