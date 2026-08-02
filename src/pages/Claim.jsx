import { useEffect, useState } from 'react'
import { searchEntities, submitClaim } from '../lib/gcrApi'

// Claim your business.
//
// A business that has no login yet finds its GCR listing, confirms it, and
// sends a claim. This does NOT grant access — POST /api/gcr/claim writes a
// business_claims row with status 'new', which an admin reviews in
// cybercheck-login's admin.html GCR Claims panel. Approving there is what
// creates the account and the entity_owners row this dashboard reads access
// from, so nobody can claim their way into another business's data.

export default function Claim({ onBack }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState(null)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    contact_name: '',
    phone: '',
    email: '',
    message: '',
  })

  useEffect(() => {
    if (picked) return
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }

    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const found = await searchEntities(q, { limit: 15 })
        if (!cancelled) {
          setResults(found)
          setError('')
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, picked])

  function change(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await submitClaim({
        business_name: picked ? picked.name : query.trim(),
        category: picked?.entity_type || null,
        website: picked?.website_url || null,
        contact_name: form.contact_name,
        phone: form.phone,
        email: form.email,
        message: [
          picked ? `GCR listing: ${picked.slug}` : 'No matching GCR listing found',
          form.message,
        ]
          .filter(Boolean)
          .join(' — '),
      })
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="claim-screen">
        <div className="claim-card">
          <h1>Claim sent</h1>
          <p className="claim-sub">
            We'll review it and send your login to{' '}
            {form.email || form.phone || 'the contact you gave'}. Claims are
            checked by hand, so this is not instant.
          </p>
          <button type="button" className="auth-switch" onClick={onBack}>
            ← Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="claim-screen">
      <form className="claim-card" onSubmit={send}>
        <h1>Claim your business</h1>
        <p className="claim-sub">
          Find your listing, tell us how to reach you, and we'll set up your
          login.
        </p>

        {picked ? (
          <div className="claim-result">
            {picked.hero_image_url && <img src={picked.hero_image_url} alt="" />}
            <span className="claim-result-info">
              <strong>{picked.name}</strong>
              <span>
                {[picked.city, picked.state].filter(Boolean).join(', ')}
                {picked.entity_type ? ` · ${picked.entity_type}` : ''}
              </span>
            </span>
            <button type="button" onClick={() => setPicked(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <label>
              Business name
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Start typing your business name…"
                autoFocus
                required
              />
            </label>

            {searching && <p className="claim-status">Searching…</p>}

            {!!results.length && (
              <ul className="claim-results">
                {results.map((b) => (
                  <li key={b.slug} className="claim-result">
                    {b.hero_image_url && <img src={b.hero_image_url} alt="" />}
                    <span className="claim-result-info">
                      <strong>{b.name}</strong>
                      <span>
                        {[b.city, b.state].filter(Boolean).join(', ')}
                        {b.entity_type ? ` · ${b.entity_type}` : ''}
                      </span>
                    </span>
                    <button type="button" onClick={() => setPicked(b)}>
                      This one
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!searching && query.trim().length >= 2 && !results.length && (
              <p className="claim-empty">
                Nothing matches that yet — send the claim anyway and we'll add
                your listing.
              </p>
            )}
          </>
        )}

        <label>
          Your name
          <input
            type="text"
            value={form.contact_name}
            onChange={(e) => change('contact_name', e.target.value)}
          />
        </label>
        <label>
          Phone
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => change('phone', e.target.value)}
            required
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(e) => change('email', e.target.value)}
          />
        </label>
        <label>
          Anything else
          <textarea
            rows={3}
            value={form.message}
            onChange={(e) => change('message', e.target.value)}
            placeholder="How you're connected to the business"
          />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send claim'}
        </button>
        <button type="button" className="auth-switch" onClick={onBack}>
          ← Back to sign in
        </button>
      </form>
    </div>
  )
}
