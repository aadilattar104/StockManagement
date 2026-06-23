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

// ─── Export helpers ───────────────────────────────────────────────────────────

function buildTableData(rows, so_columns) {
  const headers = [
    'SKU',
    'Weight',
    ...so_columns.map(c => `${c.vendor_name} (${c.so_number})`),
    'Qty To Be Sent',
    'In Warehouse',
    'Status',
  ]

  const body = rows.map(row => {
    const status =
      row.qty_to_be_sent === 0
        ? 'No Demand'
        : row.warehouse_stock >= row.qty_to_be_sent
        ? 'Sufficient'
        : 'Falling Short'
    return [
      row.sku_title,
      row.sku_weight || '',
      ...so_columns.map(c => row.so_qtys?.[c.so_id] || 0),
      row.qty_to_be_sent,
      row.warehouse_stock,
      status,
    ]
  })

  return { headers, body }
}

function exportToCSV(rows, so_columns) {
  const { headers, body } = buildTableData(rows, so_columns)
  const escape = v => (typeof v === 'string' && v.includes(',') ? `"${v}"` : v)
  const lines = [headers.map(escape).join(','), ...body.map(r => r.map(escape).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fulfilment-matrix-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function exportToExcel(rows, so_columns) {
  // Dynamically import SheetJS (already available in the project via npm)
  let XLSX
  try {
    XLSX = await import('xlsx')
  } catch {
    alert('xlsx package not available. Use CSV export instead.')
    return
  }

  const { headers, body } = buildTableData(rows, so_columns)
  const wsData = [headers, ...body]
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Column widths
  ws['!cols'] = [
    { wch: 36 }, // SKU
    { wch: 10 }, // Weight
    ...so_columns.map(() => ({ wch: 20 })),
    { wch: 16 }, // Qty To Be Sent
    { wch: 14 }, // In Warehouse
    { wch: 14 }, // Status
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Fulfilment Matrix')
  XLSX.writeFile(wb, `fulfilment-matrix-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

function exportToPDF(rows, so_columns) {
  const { headers, body } = buildTableData(rows, so_columns)

  // Build a minimal print-ready HTML page and open it in a new window
  const thStyle = 'padding:6px 10px;background:#1e293b;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border:1px solid #334155;white-space:nowrap;'
  const tdStyle = 'padding:5px 10px;border:1px solid #334155;font-size:12px;color:#e2e8f0;white-space:nowrap;'
  const tdNumStyle = tdStyle + 'text-align:right;font-family:monospace;'

  const headerRow = headers.map(h => `<th style="${thStyle}">${h}</th>`).join('')
  const bodyRows = body.map(row => {
    const status = row[row.length - 1]
    const rowStyle = status === 'Falling Short' ? 'background:#450a0a22;' : ''
    const cells = row.map((v, i) => {
      const isNum = typeof v === 'number'
      return `<td style="${isNum ? tdNumStyle : tdStyle}">${v}</td>`
    }).join('')
    return `<tr style="${rowStyle}">${cells}</tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Fulfilment Matrix — ${new Date().toLocaleDateString('en-IN')}</title>
  <style>
    body { margin: 20px; background: #0f172a; font-family: system-ui, sans-serif; }
    h2 { color: #e2e8f0; margin-bottom: 4px; font-size: 16px; }
    p { color: #64748b; font-size: 12px; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; }
    @media print {
      body { background: white; }
      h2, p { color: #111; }
      @page { size: landscape; margin: 15mm; }
    }
  </style>
</head>
<body>
  <h2>Fulfilment Demand Matrix</h2>
  <p>Generated ${new Date().toLocaleString('en-IN')} · ${rows.length} SKUs · ${so_columns.length} open SOs</p>
  <table>
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`

  const win = window.open('', '_blank')
  if (win) {
    win.document.write(html)
    win.document.close()
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

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

  const { so_columns = [], rows = [] } = data || {}

  if (!rows.length)
    return (
      <div className="card p-8 text-center text-slate-500 text-sm">
        No active SKUs found. Upload stock data to see the fulfilment matrix.
      </div>
    )

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Fulfilment Demand Matrix</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {rows.length} active SKUs · {so_columns.length} open SO{so_columns.length !== 1 ? 's' : ''} · live pending quantities
          </p>
        </div>

        {/* Export buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportToCSV(rows, so_columns)}
            className="text-xs px-3 py-1.5 rounded border border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-colors"
            title="Download as CSV"
          >
            ↓ CSV
          </button>
          <button
            onClick={() => exportToExcel(rows, so_columns)}
            className="text-xs px-3 py-1.5 rounded border border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-colors"
            title="Download as Excel"
          >
            ↓ Excel
          </button>

        </div>
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
                  <div className="font-semibold text-slate-200 normal-case whitespace-normal break-words max-w-[160px] mx-auto">
                    {col.vendor_name}
                  </div>
                  <div className="font-mono text-slate-500 font-normal mt-0.5">
                    {col.so_number}
                  </div>
                </th>
              ))}

              {/* Qty To Be Sent — renamed from "Total Ordered", now live pending */}
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-r border-slate-700 min-w-[120px]">
                Qty To Be Sent
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
              // Use qty_to_be_sent (live pending) for status — not the old total_ordered
              const shortage = row.qty_to_be_sent - row.warehouse_stock
              const status =
                row.qty_to_be_sent === 0
                  ? 'no_demand'
                  : row.warehouse_stock >= row.qty_to_be_sent
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

                  {/* Qty per SO — static qty_ordered, unchanged after dispatch */}
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

                  {/* Qty To Be Sent — live sum of qty_pending */}
                  <td className="px-4 py-3 text-right font-mono font-bold border-r border-slate-700">
                    <span className={row.qty_to_be_sent > 0 ? 'text-amber-400' : 'text-slate-600'}>
                      {row.qty_to_be_sent > 0 ? row.qty_to_be_sent : '—'}
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
                    {status === 'falling_short' && row.qty_to_be_sent > 0 && (
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