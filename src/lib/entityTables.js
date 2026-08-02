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
