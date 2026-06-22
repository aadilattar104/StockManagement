import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
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
export const deleteAllStock = () => api.delete(`/stock`).then(r => r.data)
export const deleteSelectedStock = (ids) => api.post(`/stock/delete-selected`, { ids }).then(r => r.data)
export const toggleSkuActive = (id, is_active) =>
  api.put(`/stock/${id}/toggle-active`, { is_active }).then(r => r.data)

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
export const cancelSalesOrderUpload = (pdfPath) =>
  api.post('/sales-orders/cancel-upload', { pdf_path: pdfPath })
export const closeSalesOrder = (id) =>
  api.post(`/sales-orders/${id}/close`).then(r => r.data)
export const deleteAllSalesOrders = () =>
  api.delete('/sales-orders').then(r => r.data)
export const uploadSalesOrdersBulk = (files) => {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  return api.post('/sales-orders/upload-bulk', fd, { timeout: 120000 }).then(r => r.data)
}

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
export const cancelInvoiceUpload = (pdfPath) =>
  api.post('/invoices/cancel-upload', { pdf_path: pdfPath })
export const deleteAllInvoices = () =>
  api.delete('/invoices').then(r => r.data)

// ─── Dashboard ────────────────────────────────────────────────────────────────
export const getDashboard = () => api.get('/dashboard').then(r => r.data)
export const getFulfilmentMatrix = () => api.get('/dashboard/fulfilment-matrix').then(r => r.data)

// ─── Dev ──────────────────────────────────────────────────────────────────────
export const loadSamples = () => api.post('/dev/load-samples').then(r => r.data)
export const getZypeeUploads = () => api.get('/zypee/uploads').then(r => r.data)
export const uploadZypee = (file) => {
  const fd = new FormData(); fd.append('file', file)
  return api.post('/zypee/upload', fd).then(r => r.data)
}
export const getZypeeStock = (warehouse, date) =>
  api.get('/zypee/stock', { params: { warehouse, date } }).then(r => r.data)
export const deleteZypeeUpload = (id) => api.delete(`/zypee/uploads/${id}`).then(r => r.data)

// ─── SKU Normalization ────────────────────────────────────────────────────────
export const getMappings = () => api.get('/sku-norm/mappings').then(r => r.data)
export const createMapping = (payload) => api.post('/sku-norm/mappings', payload).then(r => r.data)
export const deleteMapping = (id) => api.delete(`/sku-norm/mappings/${id}`).then(r => r.data)
export const getZypeeCompare = (date) => api.get('/sku-norm/compare', { params: { date } }).then(r => r.data)
export const uploadInTransit = (file) => { const fd = new FormData(); fd.append('file', file); return api.post('/zypee/in-transit/upload', fd).then(r => r.data) }
export const getInTransit = () => api.get('/zypee/in-transit').then(r => r.data)
export const deleteInTransit = (id) => api.delete(`/zypee/in-transit/${id}`).then(r => r.data)
export const getZypeeCompareTable = () => api.get('/zypee/compare').then(r => r.data)
export const replaceTransitPo = (payload) => api.post('/zypee/in-transit/replace-po', payload).then(r => r.data)
export const deleteTransitPo = (payload) => api.delete('/zypee/in-transit/po', { data: payload }).then(r => r.data)