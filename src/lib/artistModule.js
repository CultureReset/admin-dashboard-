// The artist module — configuration, not features.
//
// Nothing here decides what an artist dashboard contains. Discovery still does
// that: a table with an entity_slug and rows for this artist becomes a section,
// and the Add catalog offers the rest. This file only supplies the labels,
// icons and grouping that make those tables read like a product instead of like
// a schema dump, plus the small amount of shape knowledge the money renderers
// need.
//
// Adding a new artist table to the database is still a zero-code change. It
// will appear, render and edit. It just won't have a pretty name until someone
// adds one line below — and `humanize()` gives it a decent one meanwhile.

/** Section labels for the artist tables. Merged into discoverSections. */
export const ARTIST_LABELS = {
  artist_profiles: 'Artist Profile',
  songs: 'Setlist',
  artist_price_tiers: 'Prices',
  tip_links: 'Payment Handles',
  song_requests: 'Song Requests',
  shoutouts: 'Shoutouts',
  artist_goals: 'Goals',
  artist_goal_contributions: 'Goal Contributions',
  song_cooperatives: 'Crowdfunded Songs',
  artist_shows: 'Shows',
  artist_follows: 'Fan List',
  artist_booking_requests: 'Booking Requests',
  artist_qr_codes: 'QR Codes',
  payment_confirmations: 'Payment Confirmations',
  artist_aliases: 'Also Known As',
}

export const ARTIST_ICONS = {
  artist_profiles: '🎤',
  songs: '🎵',
  artist_price_tiers: '💲',
  tip_links: '💳',
  song_requests: '🎧',
  shoutouts: '📣',
  artist_goals: '🎯',
  artist_goal_contributions: '🎯',
  song_cooperatives: '🔥',
  artist_shows: '📅',
  artist_follows: '📲',
  artist_booking_requests: '📝',
  artist_qr_codes: '🔳',
  payment_confirmations: '✅',
  artist_aliases: '🏷️',
}

/** Catalog grouping, so the artist tables cluster instead of scattering. */
export const ARTIST_GROUP = 'Artist & live shows'
export const ARTIST_TABLES = new Set(Object.keys(ARTIST_LABELS))

/**
 * Tables fans write, not the artist: requests, shoutouts, contributions,
 * follows, booking leads, parsed payment emails. They still appear as sections
 * once they have rows — that's the artist's queue — but they are never offered
 * in the Add catalog, because "add a song request" is not a thing an artist
 * does. Mirrors the `inbox` array in sql/artist_module.sql.
 */
export const ARTIST_FAN_TABLES = new Set([
  'song_requests',
  'shoutouts',
  'artist_goal_contributions',
  'artist_follows',
  'artist_booking_requests',
  'payment_confirmations',
])

/**
 * The kinds of thing an artist can charge for. Drives the Prices section, and
 * matches artist_price_tiers.kind in sql/artist_module.sql.
 *
 * Adding a kind here is presentation only — an unknown kind still renders, it
 * just gets its raw value as a heading.
 */
export const PRICE_KINDS = {
  request: { label: 'Song requests', help: 'What a song costs to request.' },
  shoutout: { label: 'Shoutouts', help: 'Birthday, bachelorette, dedication, sponsor.' },
  tip: { label: 'Tip amounts', help: 'The quick-tip buttons fans see.' },
  crowdfund: { label: 'Crowdfund amounts', help: 'Contribution buttons on a funded song.' },
  addon: { label: 'Add-ons', help: 'Extras a fan can bolt onto a request.' },
}

/**
 * Progress-bearing sections: which field is raised, which is the target, and
 * what to call the thing. Used by the goal renderer.
 */
export const PROGRESS_SHAPES = {
  artist_goals: { raised: 'current_amount', target: 'target_amount', title: 'goal_name' },
  song_cooperatives: { raised: 'current_amount', target: 'target_amount', title: 'song_title' },
}

/** Fields that hold fan contact details. Masked in the dashboard by default. */
export const FAN_PII_FIELDS = new Set([
  'fan_phone',
  'tourist_phone',
  'contributor_phone',
  'phone',
  'email',
])

/** Mask a phone/email for display: keeps enough to recognise, not to misuse. */
export function maskContact(value) {
  const s = String(value ?? '')
  if (!s) return ''
  if (s.includes('@')) {
    const [user, domain] = s.split('@')
    return `${user.slice(0, 2)}${'•'.repeat(Math.max(user.length - 2, 1))}@${domain}`
  }
  const digits = s.replace(/\D/g, '')
  if (digits.length < 4) return '•'.repeat(s.length)
  return `•••-•••-${digits.slice(-4)}`
}
