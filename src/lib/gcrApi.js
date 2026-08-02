import { GCR_API_BASE } from './config'

const GCR_API = `${GCR_API_BASE}/api/gcr`

/**
 * Fetch one business by slug. Response is the flat entity object itself
 * (no wrapper) — hours/photos/tags/events/specials/reviews/faqs/policies/
 * sections/menu_sections/drink_sections/happy_hour_sections/industry_facts/
 * child_count/is_hub/parent all arrive as top-level keys.
 */
export async function fetchEntity(slug) {
  const res = await fetch(`${GCR_API}/entity/${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error(`Entity not found (${res.status})`)
  return res.json()
}

/**
 * Search businesses by name. Backs both the admin business picker and the
 * claim flow. GET /api/gcr/entities returns { entities, total, offset, limit }
 * and filters to is_active businesses. An empty query returns the first page.
 */
export async function searchEntities(query, { limit = 40 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  const q = (query || '').trim()
  if (q) params.set('search', q)

  const res = await fetch(`${GCR_API}/entities?${params}`)
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const data = await res.json()
  return data.entities || []
}

/**
 * Submit a claim on a business — POST /api/gcr/claim writes a business_claims
 * row with status 'new'. Admin reviews it in cybercheck-login's admin.html GCR
 * Claims panel (GET /api/admin/gcr/claims, PATCH /api/admin/gcr/claims/:id);
 * approving is what creates the login and the entity_owners row that this
 * dashboard reads access from.
 *
 * The API requires business_name and phone; everything else is optional.
 */
export async function submitClaim(claim) {
  const res = await fetch(`${GCR_API}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(claim),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Claim failed (${res.status})`)
  return data
}
