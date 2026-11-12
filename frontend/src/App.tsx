import { Navigate, Routes, Route } from 'react-router-dom'
import { useAuth } from './api/auth'
import { canApprove, canWrite, isAdmin, isOic } from './lib/permissions'
import Layout from './components/Layout'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import ItemDetail from './pages/ItemDetail'
import ItemForm from './pages/ItemForm'
import Alerts from './pages/Alerts'
import Reports from './pages/Reports'
import AuditTrail from './pages/AuditTrail'
import MasterData from './pages/MasterData'
import Users from './pages/Users'
import UserForm from './pages/UserForm'
import { EntityDetail, EntityList } from './pages/Entities'
import Approvals from './pages/Approvals'
import Import from './pages/Import'

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="auth"><p className="mu">Loading…</p></div>
  if (!user) return <Login />
  if (user.must_change_password) return <ChangePassword forced />
  const w = canWrite(user), admin = isAdmin(user), oic = isOic(user), approver = canApprove(user)
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="inventory" element={<Inventory />} />
        {w && <Route path="inventory/new" element={<ItemForm />} />}
        {w && <Route path="inventory/import" element={<Import />} />}
        <Route path="inventory/:id" element={<ItemDetail />} />
        {w && <Route path="inventory/:id/edit" element={<ItemForm />} />}
        <Route path="projects" element={<EntityList kind="projects" />} />
        <Route path="projects/:name" element={<EntityDetail kind="projects" />} />
        <Route path="vendors" element={<EntityList kind="vendors" />} />
        <Route path="vendors/:name" element={<EntityDetail kind="vendors" />} />
        <Route path="spares" element={<Navigate to="/inventory?c=Spare" replace />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="reports" element={<Reports />} />
        <Route path="audit" element={<AuditTrail />} />
        {(approver || oic) && <Route path="approvals" element={<Approvals />} />}
        {approver && <Route path="master-data" element={<MasterData />} />}
        {approver && <Route path="users" element={<Users />} />}
        {admin && <Route path="users/new" element={<UserForm />} />}
        {approver && <Route path="users/:id" element={<UserForm />} />}
        <Route path="account" element={<ChangePassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
