import { labelFor, iconFor } from './discoverSections.js'
import { TABLE_TO_API_KEY, tableFor } from './tableMap.js'
import { ARTIST_GROUP, isArtistTable } from './artistModule.js'
import { detectInbox } from './shapes.js'

// What a business COULD add, as opposed to what it already has.
//
// Discovery alone can only ever show a business the data it already owns: a
// table with no rows for this slug produces no section, so a restaurant with no
// menu has no Menu screen and no way to make one. That makes the dashboard a
// viewer of whatever happens to be in the database rather than something a
// business can actually build out.
//
// This module answers the other question — of every table the database supports
// right now, which ones is this business not using yet? Those become the "add"
// catalog. Pick one, fill in the form RowEditor builds from its columns, save,
// and it turns into a live section on the next load.
//
// Like everything else here it reads the live schema. A table added to the
// database tomorrow appears in this catalog with no code change.

// Platform machinery — never the business's data in any sense. Hidden from the
// catalog AND from the dashboard, because a business opening its own page and
// finding `ai_photo_index_full` next to its menu is just broken.
//
// This list is deliberately narrow. Bookings, orders, reviews and song requests
// are NOT here: they are the business's data, they just arrive from customers
// rather than being authored. detectInbox() handles those — they render as
// sections and are only held back from "add".
const INTERNAL_PATTERNS = [
  /^ai_/, // AI / derived indexes
  /_(embedding|embeddings|vector|vectors|index|index_full)$/,
  /^(entity_owners|platform_admins)$/, // access control
  /(^|_)(audit|log|logs|history|impression|impressions|click|clicks|analytics|tracking|events_log)(_|$)/,
  /^(user_|tourist_|swipe|saved_)/, // other people's Trip Swipe data
  /(^|_)(sms|message|messages|inbox|notification|notifications)(_|$)/,
  /(^|_)(backup|bak|old|legacy|tmp|temp|migration|import|staging)(_|$)/,
  /_(backup|old|legacy|tmp|temp|v1|v2|copy)$/,
]

/**
 * Machinery, not content — AI indexes, access control, audit logs, backups.
 *
 * These are hidden EVERYWHERE: not offered in the catalog, and not rendered as
 * sections either. Swept straight from the database, a business would otherwise
 * open its dashboard and find `ai_photo_index_full` sitting next to its menu.
 *
 * Distinct from detectInbox(): a song request is real content the business
 * needs to see, it just isn't theirs to author.
 */
export function isInternal(table) {
  return INTERNAL_PATTERNS.some((re) => re.test(table))
}

/**
 * Is this a table the business should be able to create rows in?
 *
 * `columns` comes from the live schema. When it's supplied, a table that
 * collects submissions from other people — song requests, booking leads, fan
 * signups — is recognised by its shape and held back, no matter what it's
 * called. Those still render as sections once they have rows; the business
 * just isn't the one who authors them.
 */
export function isOfferable(table, columns = []) {
  if (isInternal(table)) return false
  if (detectInbox(table, columns)) return false
  return true
}

// Coarse buckets so a ~200-entry catalog reads as a menu instead of a wall.
// Keyword match, first hit wins; anything unmatched lands in "Everything else",
// which is where a brand-new table shows up until someone gives it a home.
const GROUPS = [
  // Artist first: its pattern is more specific than the keyword buckets below,
  // which would otherwise pull `songs` into "About & content".
  [ARTIST_GROUP, isArtistTable],
  ['Food & drink', /menu|drink|food|dish|beverage|happy_hour|side|dessert|wine|beer|cocktail/],
  ['Hours & availability', /hour|schedule|availability|calendar|season|closure|holiday/],
  ['Photos & media', /photo|image|media|gallery|video|logo|banner/],
  ['Events & specials', /event|special|announcement|promotion|deal|live_music|artist/],
  ['Rooms, units & resources', /room|unit|resource|property|lodging|rental|slip|site|cabin|suite/],
  ['Activities & trips', /activity|activities|trip|tour|charter|species|meeting_point|what_to_bring|weather|equipment/],
  ['Services & classes', /service|class|treatment|appointment|package|staff|team|provider/],
  ['Products & retail', /product|inventory|merch|retail|brand|stock/],
  ['Pricing & fees', /price|pricing|fee|deposit|rate|tier|discount|coupon|surcharge|tax/],
  ['Policies & rules', /policy|policies|rule|rules|requirement|refund|cancellation|terms|access|restriction/],
  ['About & content', /about|faq|bullet|blog|post|content|section|highlight|story|description|tag|amenity|amenities|feature|perfect_for|attribute|landmark|nearby/],
  ['Contact & location', /address|location|contact|phone|email|social|link|direction|parking/],
]

// A group matcher is either a regex over the table name or a predicate.
function groupFor(table) {
  for (const [name, match] of GROUPS) {
    const hit = typeof match === 'function' ? match(table) : match.test(table)
    if (hit) return name
  }
  return 'Everything else'
}

/**
 * Everything this business could start using.
 *
 * @param {string[]} allTables   every slug table in the live schema
 * @param {string[]} activeKeys  section keys already on the dashboard
 * @param {(table: string) => object[]} columnsFor  live columns for a table,
 *        so submission tables can be recognised by shape. Optional — without
 *        it the catalog still works, it just falls back to name patterns.
 * @returns {{ group: string, entries: {table,label,icon}[] }[]}
 */
export function buildCatalog(allTables = [], activeKeys = [], columnsFor = () => []) {
  // Sections are keyed by the API's name (`hours`); the catalog works in table
  // names (`entity_hours`). Resolve before comparing or the business is offered
  // a table it is already using under a different label.
  const inUse = new Set(activeKeys.map(tableFor).filter(Boolean))

  const entries = allTables
    .filter((t) => !inUse.has(t))
    .filter((t) => isOfferable(t, columnsFor(t)))
    .map((table) => {
      // Label it the way it will read once it becomes a section.
      const key = TABLE_TO_API_KEY[table] || table
      return { table, label: labelFor(key), icon: iconFor(key), group: groupFor(table) }
    })

  const byGroup = new Map()
  for (const entry of entries) {
    if (!byGroup.has(entry.group)) byGroup.set(entry.group, [])
    byGroup.get(entry.group).push(entry)
  }

  // Named groups in declaration order, "Everything else" last.
  const order = [...GROUPS.map(([name]) => name), 'Everything else']
  return order
    .filter((name) => byGroup.has(name))
    .map((group) => ({
      group,
      entries: byGroup.get(group).sort((a, b) => a.label.localeCompare(b.label)),
    }))
}
