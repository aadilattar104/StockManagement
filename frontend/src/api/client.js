import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

api.interceptors.response.use(
  res => res,
  err => {
    const msg = err.response?.data?.detail || err.message || 'Unknown error'
    return Promise.reject(new Error(msg))
  }
)

// ─── Stock ────────────────────────────────────────────────────────────────────
export const getStock = () => api.get('/stock').then(r => r.data)
export const uploadStock = (file) => {
  const fd = new FormData(); fd.append('file', file)
  return api.post('/stock/upload', fd).then(r => r.data)
}
export const updateStock = (id, stock_qty) =>
  api.put(`/stock/${id}`, { stock_qty }).then(r => r.data)
export const deleteStock = (id) => api.delete(`/stock/${id}`).then(r => r.data)

// ─── Sales Orders ─────────────────────────────────────────────────────────────
export const getSalesOrders = () => api.get('/sales-orders').then(r => r.data)
export const getSalesOrder = (id) => api.get(`/sales-orders/${id}`).then(r => r.data)
export const uploadSalesOrder = (file) => {
  const fd = new FormData(); fd.append('file', file)
  return api.post('/sales-orders/upload', fd).then(r => r.data)
}
export const confirmSalesOrder = (so_data, pdf_path) =>
  api.post('/sales-orders/confirm', { so_data, pdf_path }).then(r => r.data)
export const updateSOVendor = (id, vendor_name) =>
  api.put(`/sales-orders/${id}/vendor`, { vendor_name }).then(r => r.data)
export const deleteSalesOrder = (id) => api.delete(`/sales-orders/${id}`).then(r => r.data)

// ─── Invoices ─────────────────────────────────────────────────────────────────
export const getInvoices = () => api.get('/invoices').then(r => r.data)
export const getInvoice = (id) => api.get(`/invoices/${id}`).then(r => r.data)
export const uploadInvoice = (file) => {
  const fd = new FormData(); fd.append('file', file)
  return api.post('/invoices/upload', fd).then(r => r.data)
}
export const confirmInvoice = (invoice_data, pdf_path, linked_so_ids) =>
  api.post('/invoices/confirm', { invoice_data, pdf_path, linked_so_ids }).then(r => r.data)
export const deleteInvoice = (id) => api.delete(`/invoices/${id}`).then(r => r.data)

// ─── Dashboard ────────────────────────────────────────────────────────────────
export const getDashboard = () => api.get('/dashboard').then(r => r.data)

// ─── Dev ──────────────────────────────────────────────────────────────────────
export const loadSamples = () => api.post('/dev/load-samples').then(r => r.data)
export async function cancelSalesOrderUpload(pdfPath) {
  await api.post('/api/sales-orders/cancel-upload', { pdf_path: pdfPath })
}
 
export async function cancelInvoiceUpload(pdfPath) {
  await api.post('/api/invoices/cancel-upload', { pdf_path: pdfPath })
}
export const getFulfilmentMatrix = () => api.get('/dashboard/fulfilment-matrix').then(r => r.data)