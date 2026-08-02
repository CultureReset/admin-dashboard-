const GCR_API = 'https://gcr-api-clean.vercel.app/api/gcr'

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

/** Search businesses by name, for the claim-your-business flow. */
export async function searchEntities(query) {
  if (!query || query.trim().length < 2) return []
  const res = await fetch(
    `${GCR_API}/entities?search=${encodeURIComponent(query.trim())}&limit=15`
  )
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const data = await res.json()
  return data.entities || []
}
