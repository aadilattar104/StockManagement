import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Package, ClipboardList, FileText, Zap, Warehouse, Link2 } from 'lucide-react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { loadSamples } from '../api/client'

const nav = [
  { to: '/',              icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/stock',         icon: Package,         label: 'Warehouse Stock' },
  { to: '/sales-orders',  icon: ClipboardList,   label: 'Sales Orders' },
  { to: '/invoices',      icon: FileText,         label: 'Invoices' },
  { to: '/zypee',              icon: Warehouse, label: 'Zypee Stock' },
  { to: '/sku-normalization',  icon: Link2,     label: 'SKU Normalization' },
]

export default function Layout({ children }) {
  const [sampleMsg, setSampleMsg] = useState(null)
  const qc = useQueryClient()
  const loadMut = useMutation({
    mutationFn: loadSamples,
    onSuccess: (data) => {
      setSampleMsg(JSON.stringify(data, null, 2))
      qc.invalidateQueries()
      setTimeout(() => setSampleMsg(null), 5000)
    }
  })

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <Package className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-100 leading-tight">Svasthyaa</p>
              <p className="text-xs text-slate-500 leading-tight">Warehouse</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${isActive
                  ? 'bg-brand-600/15 text-brand-400 border border-brand-700/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Dev: Load Samples */}
        <div className="px-3 pb-5 border-t border-slate-800 pt-4">
          <button
            onClick={() => loadMut.mutate()}
            disabled={loadMut.isPending}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-amber-400 hover:bg-amber-900/10 rounded-lg transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            {loadMut.isPending ? 'Loading samples…' : 'Load sample data'}
          </button>
          {sampleMsg && (
            <div className="mt-2 p-2 bg-slate-800 rounded text-xs text-slate-400 font-mono overflow-hidden text-ellipsis whitespace-nowrap">
              Done ✓
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-slate-950">
        {children}
      </main>
    </div>
  )
}