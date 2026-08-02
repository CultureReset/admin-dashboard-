import { useAuth } from '../lib/AuthContext'

export default function TopBar({ businessName }) {
  const { signOut, viewingAsAdmin, closeBusiness } = useAuth()

  return (
    <>
      {viewingAsAdmin && (
        <div className="admin-banner">
          <span>Admin view</span>
          <button onClick={closeBusiness}>← All businesses</button>
        </div>
      )}
      <header className="topbar">
        <span className="topbar-brand">{businessName || 'Dashboard'}</span>
        <button className="topbar-signout" onClick={signOut}>
          Sign out
        </button>
      </header>
    </>
  )
}
