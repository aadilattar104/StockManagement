export default function StatusBadge({ status, type = 'so', qty }) {
  if (type === 'so') {
    const map = {
      open:      'bg-blue-900/50 text-blue-300 border-blue-800/50',
      partial:   'bg-amber-900/50 text-amber-300 border-amber-800/50',
      fulfilled: 'bg-emerald-900/50 text-emerald-300 border-emerald-800/50',
    }
    const labels = { open: 'Open', partial: 'Partial', fulfilled: 'Fulfilled' }
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${map[status] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
        {labels[status] || status}
      </span>
    )
  }

  if (type === 'stock') {
    const map = {
      healthy: 'bg-emerald-900/50 text-emerald-300 border-emerald-800/50',
      low:     'bg-amber-900/50 text-amber-300 border-amber-800/50',
      out:     'bg-red-900/50 text-red-300 border-red-800/50',
    }
    const icons = { healthy: '✅', low: '🟡', out: '🔴' }
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${map[status] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
        {icons[status]} {status}
      </span>
    )
  }

  if (type === 'fulfilment') {
    const map = {
      fulfilled: 'bg-emerald-900/50 text-emerald-300 border-emerald-800/50',
      partial:   'bg-amber-900/50 text-amber-300 border-amber-800/50',
      not_sent:  'bg-red-900/50 text-red-300 border-red-800/50',
    }
    const labels = { fulfilled: 'Fulfilled', partial: 'Partial', not_sent: 'Not Sent' }
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${map[status] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
        {labels[status] || status}
      </span>
    )
  }

  if (type === 'so_display') {
    if (status === 'closed') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-emerald-900/50 text-emerald-300 border-emerald-800/50">
          Closed
        </span>
      )
    }
    if (status === 'invoice_pending') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-red-900/50 text-red-300 border-red-800/50">
          Invoice Not Uploaded
        </span>
      )
    }
    if (status === 'partial') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-amber-900/50 text-amber-300 border-amber-800/50">
          Partial{qty != null ? ` · ${qty} pending` : ''}
        </span>
      )
    }
  }

  return <span className="text-xs text-slate-400">{status}</span>
}