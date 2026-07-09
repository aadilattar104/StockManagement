import { useQuery } from '@tanstack/react-query'
import { getWarehouseStockMatrix } from '../api/client'

function buildTableData(rows, warehouse_columns) {
  const headers = ['SKU', 'Warehouse Stock', ...warehouse_columns]
  const body = rows.map(row => [
    row.sku_weight ? `${row.sku_title} (${row.sku_weight})` : row.sku_title,
    row.warehouse_stock,
    ...warehouse_columns.map(city => row.city_stock?.[city] ?? '-'),
  ])
  return { headers, body }
}

async function exportToExcel(rows, warehouse_columns) {
  let XLSX
  try {
    XLSX = await import('xlsx')
  } catch {
    alert('xlsx package not available.')
    return
  }

  const { headers, body } = buildTableData(rows, warehouse_columns)
  const ws = XLSX.utils.aoa_to_sheet([headers, ...body])
  ws['!cols'] = [{ wch: 36 }, { wch: 16 }, ...warehouse_columns.map(() => ({ wch: 14 }))]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Warehouse Stock Matrix')
  XLSX.writeFile(wb, `warehouse-stock-matrix-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export default function WarehouseStockMatrix() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['warehouse-stock-matrix'],
    queryFn: getWarehouseStockMatrix,
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

  const { warehouse_columns = [], rows = [] } = data || {}

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
          onClick={() => exportToExcel(rows, warehouse_columns)}
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
              {warehouse_columns.map(city => (
                <th key={city} className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-r border-slate-700/50 min-w-[100px]">
                  {city}
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
                {warehouse_columns.map(city => (
                  <td key={city} className="px-4 py-3 text-right font-mono text-slate-500 border-r border-slate-700/50">
                    {row.city_stock?.[city] ?? '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}