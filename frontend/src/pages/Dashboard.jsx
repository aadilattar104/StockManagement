import { useQuery } from '@tanstack/react-query'
import { getDashboard } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import FulfilmentMatrix from '../components/FulfilmentMatrix'
import WarehouseStockMatrix from '../components/WarehouseStockMatrix'
import { Link } from 'react-router-dom'
import { ClipboardList, Package, TrendingDown, FileText, ArrowRight } from 'lucide-react'

function KpiCard({ icon: Icon, label, value, accent, sub }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</p>
          <p className={`text-3xl font-bold mt-1 ${accent}`}>{value ?? '—'}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
          <Icon className="w-5 h-5 text-slate-400" />
        </div>
      </div>
    </div>
  )
}

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard })

  if (isLoading) return <PageShell><Spinner /></PageShell>
  if (error) return <PageShell><ErrorMsg msg={error.message} /></PageShell>

  return (
    <PageShell>
      <div className="px-8 py-8 space-y-8 max-w-7xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Warehouse fulfilment overview</p>
        </div>

        {/* Fulfilment Matrix — first */}
        <FulfilmentMatrix />

        {/* Warehouse Stock Matrix — below Fulfilment Matrix, always shows every Product Master SKU */}
        <WarehouseStockMatrix />

        {/* KPIs */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard icon={ClipboardList} label="Open Sales Orders"    value={data.open_sos}             accent="text-blue-400" />
          <KpiCard icon={Package}       label="Pending Units"         value={data.pending_units}        accent="text-amber-400" />
          <KpiCard icon={TrendingDown}  label="Low / Out Stock SKUs"  value={data.low_stock_skus}       accent="text-red-400" />
          <KpiCard icon={FileText}      label="Invoices Processed"    value={data.invoices_processed}   accent="text-brand-400" />
        </div>

        {/* Recent SOs + Low Stock */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Recent SOs */}
          <div className="card">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Recent Sales Orders</h2>
              <Link to="/sales-orders" className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="divide-y divide-slate-800/60">
              {(data.recent_sos || []).length === 0 && (
                <p className="px-5 py-8 text-sm text-slate-500 text-center">No sales orders yet. Upload a PDF to get started.</p>
              )}
              {(data.recent_sos || []).map(so => (
                <Link key={so.id} to={`/sales-orders/${so.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-800/40 transition-colors">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{so.vendor_name || '—'}</p>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">{so.so_number}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">{so.total_qty} units</span>
                    <StatusBadge type="so_display" status={so.display_status} qty={so.qty_pending} />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Low Stock */}
          <div className="card">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Low / Out Stock</h2>
              <Link to="/stock" className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="divide-y divide-slate-800/60">
              {(data.low_stock_detail || []).length === 0 && (
                <p className="px-5 py-8 text-sm text-slate-500 text-center">All SKUs are well-stocked.</p>
              )}
              {(data.low_stock_detail || []).map(sku => (
                <div key={sku.id} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <p className="text-sm font-medium text-slate-200">{sku.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{sku.weight || '—'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold font-mono ${sku.stock_qty === 0 ? 'text-red-400' : 'text-amber-400'}`}>
                      {sku.stock_qty}
                    </span>
                    <StatusBadge status={sku.status} type="stock" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  )
}

function PageShell({ children }) {
  return <div className="min-h-screen">{children}</div>
}
function Spinner() {
  return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
}
function ErrorMsg({ msg }) {
  return <div className="p-8 text-red-400 text-sm">{msg}</div>
}