import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './Login'
import Dashboard from './Dashboard'
import ProductionLog from './ProductionLog'
import NewProjectWizard from './NewProjectWizard'
import StaffCertifications from './StaffCertifications'

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: '#8a8578' }}>Loading...</div>
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/new" element={<PrivateRoute><NewProjectWizard /></PrivateRoute>} />
        <Route path="/safety-certs" element={<PrivateRoute><StaffCertifications /></PrivateRoute>} />
        <Route path="/project/:id" element={<PrivateRoute><ProductionLog /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
