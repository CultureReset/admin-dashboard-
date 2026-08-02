import { useState } from 'react'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Login from './pages/Login'
import Claim from './pages/Claim'
import Dashboard from './pages/Dashboard'
import BusinessPicker from './pages/BusinessPicker'

function NoBusinessLinked() {
  const { signOut, user } = useAuth()
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>No business linked</h1>
        <p className="claim-sub">
          This account isn't connected to a business yet.
        </p>
        <p className="claim-status">{user?.email}</p>
        <button type="button" className="auth-switch" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  )
}

function Root() {
  const { loading, user, isAdmin, gcrSlug } = useAuth()
  const [claiming, setClaiming] = useState(false)

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) {
    return claiming ? (
      <Claim onBack={() => setClaiming(false)} />
    ) : (
      <Login onClaim={() => setClaiming(true)} />
    )
  }

  // Admin with no business selected picks one; deep links land straight in.
  if (isAdmin && !gcrSlug) return <BusinessPicker />

  if (!gcrSlug) return <NoBusinessLinked />
  return <Dashboard />
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}
