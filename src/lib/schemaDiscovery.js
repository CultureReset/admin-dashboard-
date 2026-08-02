import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// Runtime schema discovery.
//
// The dashboard carries no list of known tables. It asks the database what
// tables exist (via the PostgREST OpenAPI spec Supabase publishes) and treats
// every table with an `entity_slug` column as a possible business section.
//
// The schema is re-read on every load, so the dashboard tracks the database:
// add a table and it appears, drop a table and it disappears, rename or add
// columns and they flow straight through. The cache below only seeds the first
// paint — it never decides what's current.

const SCHEMA_CACHE_KEY = 'gcr_entity_tables_v1'

/** Last known table list, for instant first paint. May be stale or null. */
export function getCachedTables() {
  try {
    const raw = localStorage.getItem(SCHEMA_CACHE_KEY)
    if (!raw) return null
    const { tables } = JSON.parse(raw)
    return Array.isArray(tables) ? tables : null
  } catch {
    return null
  }
}

// Columns per table, so edit forms can build themselves from the schema
// rather than from hand-written field lists.
let columnsByTable = {}

/** Column definitions for a table: [{ name, type, format, readOnly }] */
export function getColumns(table) {
  return columnsByTable[table] || []
}

// Columns the business shouldn't hand-edit (identity, ownership, bookkeeping).
const SYSTEM_COLUMNS = new Set([
  'id',
  'entity_slug',
  'entity_id',
  'site_id',
  'created_at',
  'updated_at',
  'search_vector',
  'embedding',
])

export function isEditableColumn(col) {
  return !SYSTEM_COLUMNS.has(col.name) && !col.readOnly
}

/** Always reads the live schema. This is the source of truth. */
export async function fetchEntityTables() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: 'application/openapi+json',
    },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Schema read failed (${res.status})`)
  const spec = await res.json()

  const defs = spec.definitions || spec.components?.schemas || {}
  const tables = Object.keys(defs)
    .filter((name) => {
      const props = defs[name]?.properties
      return props && Object.prototype.hasOwnProperty.call(props, 'entity_slug')
    })
    .sort()

  columnsByTable = {}
  for (const table of tables) {
    const props = defs[table].properties || {}
    columnsByTable[table] = Object.entries(props).map(([name, def]) => ({
      name,
      type: def.type || 'string',
      format: def.format || '',
      enum: def.enum || null,
      readOnly: /generated|identity/i.test(def.description || ''),
    }))
  }

  try {
    localStorage.setItem(
      SCHEMA_CACHE_KEY,
      JSON.stringify({ tables, at: Date.now() })
    )
  } catch {
    /* storage unavailable — discovery still works, just without a warm start */
  }

  return tables
}
