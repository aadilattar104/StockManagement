import { useQuery } from '@tanstack/react-query'
import { getFulfilmentMatrix } from '../api/client'

function StatusChip({ status }) {
  if (status === 'sufficient')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        ✓ Sufficient
      </span>
    )
  if (status === 'falling_short')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        ⚠ Falling Short
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
      — No Demand
    </span>
  )
}

export default function FulfilmentMatrix() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['fulfilment-matrix'],
    queryFn: getFulfilmentMatrix,
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
        Failed to load fulfilment matrix: {error.message}
      </div>
    )

  const { skus = [], so_columns = [], rows = [] } = data || {}

  if (!rows.length)
    return (
      <div className="card p-8 text-center text-slate-500 text-sm">
        No open sales orders to display. Upload an SO to see the fulfilment matrix.
      </div>
    )

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-200">Fulfilment Demand Matrix</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          SKU demand across all open sales orders vs current warehouse stock
        </p>
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-800/60">
              {/* SKU column */}
              <th className="sticky left-0 z-10 bg-slate-800 px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-r border-slate-700 min-w-[220px]">
                SKU
              </th>

              {/* One column per SO */}
              {so_columns.map((col) => (
                <th
                  key={col.so_id}
                  className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-r border-slate-700/50 min-w-[130px]"
                >
                  <div className="font-semibold text-slate-200 normal-case truncate max-w-[120px]">
                    {col.vendor_name}
                  </div>
                  <div className="font-mono text-slate-500 font-normal mt-0.5">
                    {col.so_number}
                  </div>
                </th>
              ))}

              {/* Total ordered */}
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-r border-slate-700 min-w-[100px]">
                Total Ordered
              </th>

              {/* Warehouse stock */}
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-r border-slate-700 min-w-[110px]">
                In Warehouse
              </th>

              {/* Status */}
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap min-w-[140px]">
                Status
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/60">
            {rows.map((row, idx) => {
              const shortage = row.total_ordered - row.warehouse_stock
              const status =
                row.total_ordered === 0
                  ? 'no_demand'
                  : row.warehouse_stock >= row.total_ordered
                  ? 'sufficient'
                  : 'falling_short'

              return (
                <tr
                  key={row.sku_id || idx}
                  className={`
                    transition-colors
                    ${status === 'falling_short' ? 'bg-red-950/20 hover:bg-red-950/30' : ''}
                    ${status === 'sufficient' ? 'hover:bg-slate-800/30' : ''}
                    ${status === 'no_demand' ? 'opacity-50 hover:bg-slate-800/20' : ''}
                  `}
                >
                  {/* SKU name */}
                  <td className="sticky left-0 z-10 bg-slate-900 px-4 py-3 border-r border-slate-700">
                    <div className="font-medium text-slate-200 leading-tight">{row.sku_title}</div>
                    {row.sku_weight && (
                      <div className="text-xs text-slate-500 mt-0.5">{row.sku_weight}</div>
                    )}
                  </td>

                  {/* Qty per SO */}
                  {so_columns.map((col) => {
                    const qty = row.so_qtys?.[col.so_id] ?? 0
                    return (
                      <td
                        key={col.so_id}
                        className="px-4 py-3 text-center font-mono border-r border-slate-700/50"
                      >
                        {qty > 0 ? (
                          <span className="text-slate-200 font-semibold">{qty}</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    )
                  })}

                  {/* Total ordered */}
                  <td className="px-4 py-3 text-right font-mono font-bold border-r border-slate-700">
                    <span className={row.total_ordered > 0 ? 'text-amber-400' : 'text-slate-600'}>
                      {row.total_ordered || '—'}
                    </span>
                  </td>

                  {/* Warehouse stock */}
                  <td className="px-4 py-3 text-right font-mono border-r border-slate-700">
                    <span
                      className={
                        row.warehouse_stock === 0
                          ? 'text-red-400 font-bold'
                          : row.warehouse_stock <= 30
                          ? 'text-amber-400 font-semibold'
                          : 'text-green-400'
                      }
                    >
                      {row.warehouse_stock}
                    </span>
                    {status === 'falling_short' && row.total_ordered > 0 && (
                      <div className="text-xs text-red-400 mt-0.5">−{shortage} short</div>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 text-center">
                    <StatusChip status={status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}