// The artist module is naming, and nothing else.
//
// There is no list here that decides what an artist dashboard contains, which
// tables are editable, which render as progress bars, or which are fan
// inboxes. All of that is worked out from the live schema and the shape of the
// rows — see src/lib/shapes.js. A table called `artist_merch_drops` added to
// the database tomorrow gets grouped, rendered, priced and edited without this
// file being touched.
//
// What is here: nicer words. `humanize()` turns `artist_price_tiers` into
// "Artist Price Tiers"; the map below turns it into "Prices". Losing this file
// entirely would make the dashboard uglier and change nothing about what works.
//
// The same is true of every other module. This one is the artist's because
// that's the vocabulary that came up first, not because artists are special.

/** Prettier section names. Anything absent falls back to humanize(). */
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

/**
 * Catalog grouping — a pattern, not a membership list, so a new `artist_*`
 * table clusters with the rest instead of falling into "Everything else".
 */
export const ARTIST_GROUP = 'Artist & live shows'
export const ARTIST_TABLE_RE =
  /^artists?(_|$)|^songs?(_|$)|^setlist|^shoutouts?(_|$)|^tip_links$|^gigs?(_|$)|^band(_|$)/

export function isArtistTable(table) {
  return ARTIST_TABLE_RE.test(table)
}

/**
 * Optional friendly names for `artist_price_tiers.kind`. The Prices section
 * reads whatever kinds are actually in the data — this only supplies wording
 * and a preferred order for the ones we happen to have names for.
 */
export const PRICE_KIND_LABELS = {
  request: { label: 'Song requests', help: 'What a song costs to request.' },
  shoutout: { label: 'Shoutouts', help: 'Birthday, bachelorette, dedication, sponsor.' },
  tip: { label: 'Tip amounts', help: 'The quick-tip buttons fans see.' },
  crowdfund: { label: 'Crowdfund amounts', help: 'Contribution buttons on a funded song.' },
  addon: { label: 'Add-ons', help: 'Extras a fan can bolt onto a request.' },
}
