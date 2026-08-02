import { labelFor, iconFor } from './discoverSections.js'
import { TABLE_TO_API_KEY, tableFor } from './tableMap.js'
import { ARTIST_GROUP, ARTIST_TABLES, ARTIST_FAN_TABLES } from './artistModule.js'

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

// Tables that carry a slug but aren't the business's own content to author.
// Everything else is offered. Erring toward offering too much is the right
// failure here — the point is that a business can add whatever they want.
const INTERNAL_PATTERNS = [
  /^ai_/, // AI / derived indexes
  /_(embedding|embeddings|vector|vectors|index|index_full)$/,
  /^(entity_owners|platform_admins|business_claims)$/, // access control
  /(^|_)(booking|bookings|reservation|reservations|order|orders|payment|payments|invoice|invoices|transaction|transactions)(_|$)/,
  /(^|_)(customer|customers|lead|leads|waiver|waivers|signature|signatures)(_|$)/,
  /(^|_)(audit|log|logs|history|impression|impressions|click|clicks|analytics|tracking|events_log)(_|$)/,
  /^(user_|tourist_|swipe|saved_)/, // Trip Swipe / end-user data
  /(^|_)(sms|message|messages|inbox|notification|notifications)(_|$)/,
  /^song_requests$/, // carries fan_phone
  /(^|_)(backup|bak|old|legacy|tmp|temp|migration|import|staging)(_|$)/,
  /_(backup|old|legacy|tmp|temp|v1|v2|copy)$/,
  /^entity_reviews$/, // reviews are written by customers, not the business
]

/** Is this a table the business should be able to create rows in? */
export function isOfferable(table) {
  if (ARTIST_FAN_TABLES.has(table)) return false
  return !INTERNAL_PATTERNS.some((re) => re.test(table))
}

// Coarse buckets so a ~200-entry catalog reads as a menu instead of a wall.
// Keyword match, first hit wins; anything unmatched lands in "Everything else",
// which is where a brand-new table shows up until someone gives it a home.
const GROUPS = [
  // Artist first — it matches on explicit table names, so it must win over the
  // keyword buckets below (`songs` would otherwise fall into "About & content").
  [ARTIST_GROUP, (t) => ARTIST_TABLES.has(t)],
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
 * @returns {{ group: string, entries: {table,label,icon}[] }[]}
 */
export function buildCatalog(allTables = [], activeKeys = []) {
  // Sections are keyed by the API's name (`hours`); the catalog works in table
  // names (`entity_hours`). Resolve before comparing or the business is offered
  // a table it is already using under a different label.
  const inUse = new Set(activeKeys.map(tableFor).filter(Boolean))

  const entries = allTables
    .filter((t) => !inUse.has(t))
    .filter(isOfferable)
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
