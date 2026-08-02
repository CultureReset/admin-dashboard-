import { supabase } from './supabaseClient'

// Pull this business's rows from every table tied to a slug. Results stream
// back as they arrive so sections appear immediately instead of waiting for the
// full scan, and are cached per business so repeat visits are instant.
//
// Tables locked down by row-level security simply return nothing and drop out.

const CONCURRENCY = 12
const ROW_LIMIT = 200
const CACHE_PREFIX = 'gcr_tables_'
const CACHE_TTL_MS = 1000 * 60 * 5

export function readTableCache(slug) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + slug)
    if (!raw) return null
    const { rows, at } = JSON.parse(raw)
    if (Date.now() - at > CACHE_TTL_MS) return null
    return rows
  } catch {
    return null
  }
}

function writeTableCache(slug, rows) {
  try {
    sessionStorage.setItem(
      CACHE_PREFIX + slug,
      JSON.stringify({ rows, at: Date.now() })
    )
  } catch {
    /* quota exceeded — caching is optional */
  }
}

// Set once per page load: null = untried, true/false = whether the RPC exists.
let rpcAvailable = null

/** Every slug-scoped table for this business in one call, or null if unavailable. */
async function fetchViaRpc(slug) {
  if (rpcAvailable === false) return null
  const { data, error } = await supabase.rpc('entity_sections', { p_slug: slug })
  if (error || !data || typeof data !== 'object') {
    rpcAvailable = false
    return null
  }
  rpcAvailable = true
  // Drop tables that came back empty so the shape matches the sweep's.
  const out = {}
  for (const [table, rows] of Object.entries(data)) {
    if (Array.isArray(rows) && rows.length) out[table] = rows
  }
  return out
}

async function mapLimit(items, limit, worker) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      await worker(items[cursor++])
    }
  })
  await Promise.all(runners)
}

/**
 * @param {string} slug
 * @param {string[]} tables
 * @param {{ onFound?: (table: string, rows: object[]) => void,
 *           onProgress?: (done: number, total: number) => void }} handlers
 * @returns {Promise<Record<string, object[]>>}
 */
export async function fetchTablesForSlug(slug, tables, { onFound, onProgress } = {}) {
  // One round trip instead of ~305, when sql/entity_sections.sql has been run.
  // SECURITY INVOKER, so row-level security applies exactly as it does to the
  // sweep below. Until that function exists PostgREST returns PGRST202 and we
  // fall through — the dashboard works either way.
  const viaRpc = await fetchViaRpc(slug)
  if (viaRpc) {
    for (const [table, rows] of Object.entries(viaRpc)) onFound?.(table, rows)
    onProgress?.(tables.length, tables.length)
    writeTableCache(slug, viaRpc)
    return viaRpc
  }

  const found = {}
  let done = 0

  await mapLimit(tables, CONCURRENCY, async (table) => {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('entity_slug', slug)
        .limit(ROW_LIMIT)

      if (!error && data && data.length) {
        found[table] = data
        onFound?.(table, data) // surface this section right away
      }
    } catch {
      /* an unreadable table shouldn't break the dashboard */
    } finally {
      onProgress?.(++done, tables.length)
    }
  })

  writeTableCache(slug, found)
  return found
}
