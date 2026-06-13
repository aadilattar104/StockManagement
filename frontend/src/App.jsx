import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import WarehouseStock from './pages/WarehouseStock'
import SalesOrders from './pages/SalesOrders'
import SalesOrderDetail from './pages/SalesOrderDetail'
import Invoices from './pages/Invoices'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/"                  element={<Dashboard />} />
          <Route path="/stock"             element={<WarehouseStock />} />
          <Route path="/sales-orders"      element={<SalesOrders />} />
          <Route path="/sales-orders/:id"  element={<SalesOrderDetail />} />
          <Route path="/invoices"          element={<Invoices />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
