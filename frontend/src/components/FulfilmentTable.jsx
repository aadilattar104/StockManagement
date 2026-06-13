import StatusBadge from "./StatusBadge";

const STATUS_ROW_COLOR = {
  fulfilled: "bg-green-50",
  partial: "bg-yellow-50",
  not_sent: "bg-red-50",
};

export default function FulfilmentTable({ lineItems = [] }) {
  if (!lineItems.length) {
    return <p className="text-gray-500 text-sm py-6 text-center">No line items found.</p>;
  }

  const totalOrdered = lineItems.reduce((s, l) => s + (l.qty_ordered || 0), 0);
  const totalDispatched = lineItems.reduce((s, l) => s + (l.qty_dispatched || 0), 0);
  const totalPending = lineItems.reduce((s, l) => s + (l.qty_pending || 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex gap-6 bg-gray-50 border border-gray-200 rounded-lg px-5 py-3 text-sm">
        <div>
          <span className="text-gray-500">Total Ordered: </span>
          <span className="font-semibold text-gray-800">{totalOrdered}</span>
        </div>
        <div>
          <span className="text-gray-500">Total Dispatched: </span>
          <span className="font-semibold text-green-700">{totalDispatched}</span>
        </div>
        <div>
          <span className="text-gray-500">Total Pending: </span>
          <span className="font-semibold text-red-600">{totalPending}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 text-left font-medium text-gray-600 w-8">#</th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">Product</th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">Gramage</th>
              <th className="px-3 py-3 text-right font-medium text-gray-600">Ordered</th>
              <th className="px-3 py-3 text-right font-medium text-gray-600">Dispatched</th>
              <th className="px-3 py-3 text-right font-medium text-gray-600">Pending</th>
              <th className="px-3 py-3 text-center font-medium text-gray-600">Status</th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">Warehouse SKU</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {lineItems.map((line, idx) => {
              const status = line.fulfilment_status || "not_sent";
              return (
                <tr key={line.id || idx} className={STATUS_ROW_COLOR[status] || ""}>
                  <td className="px-3 py-3 text-gray-500">{line.line_no || idx + 1}</td>
                  <td className="px-3 py-3 font-medium text-gray-900">{line.product_name}</td>
                  <td className="px-3 py-3 text-gray-600">{line.gramage || "—"}</td>
                  <td className="px-3 py-3 text-right font-mono">{line.qty_ordered}</td>
                  <td className="px-3 py-3 text-right font-mono text-green-700">
                    {line.qty_dispatched || 0}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-red-600">
                    {line.qty_pending ?? line.qty_ordered}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <StatusBadge status={status} />
                  </td>
                  <td className="px-3 py-3 text-gray-600 text-xs">
                    {line.matched_stock_title ? (
                      <span>
                        {line.matched_stock_title}
                        {line.matched_stock_weight && (
                          <span className="ml-1 text-gray-400">({line.matched_stock_weight})</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-400 italic">No match</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
