import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabaseClient'

const AuthContext = createContext(null)

// Businesses sign in with their slug. Supabase Auth is email-based, so the slug
// maps to a derived login address — the same one the provisioning script uses.
// No real email is required to start; one can be added later.
export const LOGIN_DOMAIN = 'biz.gulfcoastradar.com'
const toLoginEmail = (identifier) =>
  identifier.includes('@')
    ? identifier.trim()
    : `${identifier.trim().toLowerCase()}@${LOGIN_DOMAIN}`

/** Admins can open any business by slug: ?business=<slug> */
function slugFromUrl() {
  return new URLSearchParams(location.search).get('business')
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [ownership, setOwnership] = useState(undefined)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminSlug, setAdminSlug] = useState(slugFromUrl())

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => listener.subscription.unsubscribe()
  }, [])

  // Both checks are server-side. Ownership comes from entity_owners and admin
  // status from platform_admins — neither can be forged from the browser, which
  // is what keeps one account out of another business's data.
  const loadAccess = useCallback(async (userId) => {
    if (!userId) {
      setOwnership(null)
      setIsAdmin(false)
      return
    }

    const [{ data: owned }, { data: admin }] = await Promise.all([
      supabase.from('entity_owners').select('entity_slug, role').eq('user_id', userId).limit(1),
      supabase.from('platform_admins').select('user_id').eq('user_id', userId).limit(1),
    ])

    setOwnership(owned?.[0] || null)
    setIsAdmin(!!admin?.length)
  }, [])

  useEffect(() => {
    if (session === undefined) return
    loadAccess(session?.user?.id)
  }, [session, loadAccess])

  const signIn = (identifier, password) =>
    supabase.auth.signInWithPassword({ email: toLoginEmail(identifier), password })

  const signOut = () => supabase.auth.signOut()

  // An admin viewing a business wins over their own ownership row, so support
  // can jump straight into any dashboard.
  const gcrSlug = (isAdmin && adminSlug) || ownership?.entity_slug || null

  const value = {
    session,
    user: session?.user || null,
    loading: session === undefined || ownership === undefined,
    gcrSlug,
    isAdmin,
    viewingAsAdmin: !!(isAdmin && adminSlug),
    hasAccess: !!gcrSlug,
    openBusiness: (slug) => {
      setAdminSlug(slug)
      const url = new URL(location.href)
      url.searchParams.set('business', slug)
      history.pushState({}, '', url)
    },
    closeBusiness: () => {
      setAdminSlug(null)
      const url = new URL(location.href)
      url.searchParams.delete('business')
      history.pushState({}, '', url)
    },
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
