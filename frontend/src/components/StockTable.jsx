import { useState } from "react";
import StatusBadge from "./StatusBadge";
import ConfirmDialog from "./ConfirmDialog";

export default function StockTable({ rows, onUpdate, onDelete }) {
  const [editId, setEditId] = useState(null);
  const [editQty, setEditQty] = useState("");
  const [deleteId, setDeleteId] = useState(null);

  const handleEditSave = async (id) => {
    const qty = parseInt(editQty, 10);
    if (isNaN(qty) || qty < 0) return;
    await onUpdate(id, qty);
    setEditId(null);
    setEditQty("");
  };

  if (!rows || rows.length === 0) {
    return (
      <p className="text-gray-500 text-sm py-8 text-center">
        No stock loaded yet. Upload an XLSX to get started.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">SKU Title</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Weight</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Stock Qty</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.map((row) => (
              <tr
                key={row.id}
                className={
                  row.status === "out"
                    ? "bg-red-50"
                    : row.status === "low"
                    ? "bg-yellow-50"
                    : ""
                }
              >
                <td className="px-4 py-3 font-medium text-gray-900">{row.title}</td>
                <td className="px-4 py-3 text-gray-600">{row.weight || "—"}</td>
                <td className="px-4 py-3 text-right">
                  {editId === row.id ? (
                    <input
                      type="number"
                      min="0"
                      className="w-24 border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={editQty}
                      onChange={(e) => setEditQty(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEditSave(row.id);
                        if (e.key === "Escape") setEditId(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span className="font-mono">{row.stock_qty}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-4 py-3 text-center space-x-2">
                  {editId === row.id ? (
                    <>
                      <button
                        onClick={() => handleEditSave(row.id)}
                        className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditId(row.id);
                          setEditQty(String(row.stock_qty));
                        }}
                        className="text-xs px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteId(row.id)}
                        className="text-xs px-2 py-1 bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deleteId && (
        <ConfirmDialog
          title="Delete Stock Row"
          message="Are you sure you want to delete this SKU? This cannot be undone."
          onConfirm={() => {
            onDelete(deleteId);
            setDeleteId(null);
          }}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  );
}
