// Shape detection.
//
// Nothing in the dashboard should need a list of table names to work. The
// engine already discovers tables from the live schema; these functions do the
// same for what a table *is* — read the columns and the rows and work out
// whether this thing is a progress bar, a price list, or an inbox of stuff
// fans submitted.
//
// The test is always: would a table nobody has ever heard of get the right
// treatment? A `merch_crowdfund` table added tomorrow, with a target and a
// running total, gets a progress bar here without anyone editing a map. A
// `sponsor_tiers` table with kind/label/amount gets the price layout. That is
// the difference between configuration and hardwiring — configuration makes an
// unknown table look nicer, hardwiring makes it not work at all.
//
// Everything below is domain-agnostic on purpose. None of it mentions artists.

// ── Field-name vocabularies ────────────────────────────────────────────────
// These describe how columns are *named* across the database, not which tables
// exist. Adding a table needs no change here; only a genuinely new naming
// convention would.

const RAISED_RE = /^(current|raised|collected|funded|pledged|received|so_far)(_amount|_total|_sum)?$|^amount_(raised|collected|funded)$/
const TARGET_RE = /^(target|goal|needed|required)(_amount|_total|_sum)?$|^amount_(target|goal|needed)$/
const KIND_RE = /^(kind|category|tier|tier_type|group|bucket)$|^[a-z_]*_type$|^type$/
const LABEL_RE = /^(label|name|title|display_name|option|caption)$/
const AMOUNT_RE = /^(amount|price|value|cost|rate|fee)$/

/**
 * Contact details belonging to someone who is not the business — a fan, a
 * customer, a lead. Matched by name so a column added tomorrow is caught too.
 *
 * Deliberately does NOT match the business's own `phone` / `email` on tables
 * like `entity` or `artist_profiles`; that is handled by the caller passing
 * `ownRecord`, because the same column name means different things depending
 * on whose row it is.
 */
const CONTACT_OWNER_RE = /^(fan|contributor|requester|tourist|customer|guest|patron|attendee|lead|contact|payer|sender|from|reviewer|recipient|subscriber|member)_/
const CONTACT_FIELD_RE = /(^|_)(phone|mobile|email|address|whatsapp|handle_private)$/

/**
 * Table names that describe something submitted TO the business — by a
 * customer, a fan, a lead. This is the business's data and it renders as a
 * section; it just isn't something the business "adds".
 */
const INBOX_NAME_RE =
  /(_requests|_leads|_contributions|_follows|_followers|_confirmations|_submissions|_signups|_optins|_opt_ins|_responses|_replies|_inquiries|_applications|_votes|_entries)$/
const INBOX_CONCEPT_RE =
  /(^|_)(booking|bookings|reservation|reservations|order|orders|payment|payments|invoice|invoices|transaction|transactions|claim|claims|review|reviews|waiver|waivers|signature|signatures|customer|customers|lead|leads|shoutouts?)(_|$)/

const numeric = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v))

function fieldNames(rows = [], columns = []) {
  const names = new Set(columns.map((c) => (typeof c === 'string' ? c : c.name)))
  for (const row of rows.slice(0, 20)) {
    if (row && typeof row === 'object') for (const k of Object.keys(row)) names.add(k)
  }
  names.delete(undefined)
  return [...names]
}

function firstMatch(names, re) {
  return names.find((n) => re.test(n)) || null
}

// ── Progress ───────────────────────────────────────────────────────────────

/**
 * Does this section track "X of Y raised"? Returns the field names to read, or
 * null. Requires both halves to actually hold numbers in at least one row —
 * a `goal_type` text column must not be mistaken for a target.
 *
 * @returns {{raised: string, target: string, title: string|null}|null}
 */
export function detectProgress(rows = [], columns = []) {
  if (!Array.isArray(rows) || !rows.length) return null
  const names = fieldNames(rows, columns)

  const raised = firstMatch(names, RAISED_RE)
  const target = firstMatch(names, TARGET_RE)
  if (!raised || !target) return null

  // The target must be a number somewhere, or this isn't a progress table.
  const targetIsNumeric = rows.some((r) => numeric(r?.[target]))
  if (!targetIsNumeric) return null

  return { raised, target, title: pickTitleField(rows, columns) }
}

// ── Price lists ────────────────────────────────────────────────────────────

/**
 * Does this section look like a set of priced options grouped into kinds —
 * "Shoutouts: Birthday $10, Bachelorette $15"? Returns the field names, or
 * null. A single flat list of priced rows deliberately does NOT qualify;
 * GenericSection already renders that well. The grouping column is what makes
 * this layout worth having.
 *
 * @returns {{kind: string, label: string, amount: string}|null}
 */
export function detectPriceList(rows = [], columns = []) {
  if (!Array.isArray(rows) || rows.length < 2) return null
  const names = fieldNames(rows, columns)

  const kind = firstMatch(names, KIND_RE)
  const label = firstMatch(names, LABEL_RE)
  const amount = firstMatch(names, AMOUNT_RE)
  if (!kind || !label || !amount) return null

  // The amount has to be money-shaped, and the kind has to actually group —
  // one distinct value across every row is just a constant, not a grouping.
  if (!rows.some((r) => numeric(r?.[amount]))) return null
  const kinds = new Set(rows.map((r) => r?.[kind]).filter((v) => v !== null && v !== undefined && v !== ''))
  if (kinds.size < 1) return null

  return { kind, label, amount }
}

// ── Inboxes ────────────────────────────────────────────────────────────────

/**
 * Is this a table other people write to, rather than the business's own
 * content? Song requests, shoutouts, booking leads, fan signups, contributions.
 *
 * Two independent signals, either is enough:
 *   1. it carries somebody else's identity  (fan_name, contributor_phone…)
 *   2. its name says it collects submissions (…_requests, …_leads, …_votes)
 *
 * These sections still render — the business needs to see what came in — but
 * they are never offered as something to "add", because the business isn't the
 * author.
 */
export function detectInbox(table, columns = [], rows = []) {
  if (INBOX_NAME_RE.test(table) || INBOX_CONCEPT_RE.test(table)) return true
  const names = fieldNames(rows, columns)
  return names.some((n) => CONTACT_OWNER_RE.test(n))
}

// ── Contact details ────────────────────────────────────────────────────────

/**
 * Is this field somebody else's contact detail, so it should be masked?
 *
 * `ownRecord` marks a section that IS the business's own profile row, where
 * `phone` and `email` are the business's own and must stay readable.
 */
export function isContactField(field, { ownRecord = false } = {}) {
  if (!field) return false
  if (CONTACT_OWNER_RE.test(field)) return true
  if (ownRecord) return false
  return CONTACT_FIELD_RE.test(field)
}

/** Mask a phone or email: enough to recognise, not enough to misuse. */
export function maskContact(value) {
  const s = String(value ?? '')
  if (!s) return ''
  if (s.includes('@')) {
    const [user, ...rest] = s.split('@')
    const domain = rest.join('@')
    return `${user.slice(0, 2)}${'•'.repeat(Math.max(user.length - 2, 1))}@${domain}`
  }
  const digits = s.replace(/\D/g, '')
  if (digits.length < 4) return '•'.repeat(s.length)
  return `•••-•••-${digits.slice(-4)}`
}

// ── Titles ─────────────────────────────────────────────────────────────────

// Shared with GenericSection so "what is this row called" is decided once.
export const TITLE_FIELDS = [
  'item_name', 'name', 'title', 'label', 'question', 'event_name',
  'special_name', 'section_name', 'service_name', 'product_name',
  'goal_name', 'song_title', 'amenity', 'tag_name', 'item',
  'excluded_item', 'included_item', 'requirement_name', 'policy_type',
  'type', 'species', 'class_name', 'rule', 'facility', 'text', 'message',
  'day', 'kind',
]

// Fallback for field names nobody listed: anything that reads like a name or a
// title. `campaign_name` on a table invented tomorrow gets picked up here.
const TITLE_SHAPED_RE = /(^|_)(name|title|label|heading)$/

/** Which field carries this section's row headings? */
export function pickTitleField(rows = [], columns = []) {
  const names = fieldNames(rows, columns)
  const known = new Set(names)
  const listed = TITLE_FIELDS.find((f) => known.has(f))
  if (listed) return listed
  // Skip plumbing that happens to end in _name but identifies something else.
  return names.find((n) => TITLE_SHAPED_RE.test(n) && !/^(entity|site|table|file|column)_/.test(n)) || null
}
