import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabaseClient'

// Admin landing screen: search every business and open its dashboard.
export default function BusinessPicker() {
  const { openBusiness, signOut } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      let req = supabase
        .from('entity')
        .select('slug, name, city, state, entity_type, hero_image_url')
        .eq('is_active', true)
        .order('name')
        .limit(40)

      if (query.trim()) req = req.ilike('name', `%${query.trim()}%`)

      const { data, error } = await req
      if (cancelled) return
      if (error) setError(error.message)
      else {
        setResults(data || [])
        setError('')
      }
      setLoading(false)
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  return (
    <div className="picker-screen">
      <header className="topbar">
        <span className="topbar-brand">All businesses</span>
        <button className="topbar-signout" onClick={signOut}>
          Sign out
        </button>
      </header>

      <div className="picker-body">
        <input
          className="picker-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search businesses…"
          autoFocus
        />

        {error && <p className="auth-error">{error}</p>}
        {loading && <p className="claim-status">Loading…</p>}

        <ul className="picker-list">
          {results.map((b) => (
            <li key={b.slug}>
              <button className="picker-item" onClick={() => openBusiness(b.slug)}>
                {b.hero_image_url ? (
                  <img src={b.hero_image_url} alt="" />
                ) : (
                  <span className="picker-thumb" />
                )}
                <span className="picker-info">
                  <strong>{b.name}</strong>
                  <small>
                    {[b.city, b.state].filter(Boolean).join(', ')}
                    {b.entity_type ? ` · ${b.entity_type}` : ''}
                  </small>
                </span>
                <span className="picker-go">›</span>
              </button>
            </li>
          ))}
          {!loading && !results.length && (
            <li className="claim-empty">No businesses match "{query}".</li>
          )}
        </ul>
      </div>
    </div>
  )
}
