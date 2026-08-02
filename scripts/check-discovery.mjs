#!/usr/bin/env node
/**
 * Prove the discovery + table-mapping logic without a browser, a network or a
 * database.
 *
 *   node scripts/check-discovery.mjs
 *
 * Two realistic payloads (a restaurant and a charter) go through the same code
 * the dashboard uses, and the assertions check the things that actually break:
 *
 *   - identical code produces completely different section sets
 *   - a swept table does NOT show up a second time next to its API-renamed twin
 *   - every section resolves to a table name that exists in PostgREST, so the
 *     edit path writes somewhere real
 */

import { mergeEntitySources, discoverSections } from '../src/lib/discoverSections.js'
import { tableFor, API_KEY_TO_TABLE } from '../src/lib/tableMap.js'
import { buildCatalog } from '../src/lib/sectionCatalog.js'
import { maskContact } from '../src/lib/artistModule.js'

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── A restaurant, shaped the way GET /api/gcr/entity/:slug returns it ────────
const restaurant = {
  slug: 'flora-bama-yacht-club',
  name: 'Flora-Bama Yacht Club',
  phone: '251-980-5118',
  hours: [{ id: 1, day_of_week: 1, opens_at: '11:00', closes_at: '22:00' }],
  photos: [{ id: 7, url: 'https://example.test/a.jpg', is_cover: true }],
  menu_sections: [
    { id: 3, section_name: 'Starters', items: [{ id: 9, item_name: 'Gulf Oysters', price: 18 }] },
  ],
  happy_hour_sections: [{ id: 4, section_name: 'Weekdays', items: [] }],
  events: [{ id: 11, event_name: 'Live music', event_date: '2026-08-14' }],
  specials: [],
  faqs: [{ id: 2, question: 'Is there parking?', answer: 'Yes.' }],
  child_count: 0,
  is_hub: false,
}

// ── A charter: same code, an entirely different set of domains ──────────────
const charter = {
  slug: 'perdido-key-fishing-charters',
  name: 'Perdido Key Fishing Charters',
  hours: [],
  meeting_points: [{ id: 1, name: 'Dock C', address: '100 Marina Rd' }],
  fish_species: [{ id: 5, species: 'Red Snapper', season: 'June–August' }],
  what_to_bring: [{ id: 8, item: 'Sunscreen' }],
  weather_rules: [{ id: 2, rule_type: 'wind', threshold: '20kt', action: 'reschedule' }],
  pricing: [{ id: 4, name: 'Half day', price: 800, tiers: [] }],
}

console.log('\nSection discovery')
const restaurantSections = discoverSections(mergeEntitySources(restaurant, {}))
const charterSections = discoverSections(mergeEntitySources(charter, {}))
const rKeys = restaurantSections.map((s) => s.key)
const cKeys = charterSections.map((s) => s.key)

check('restaurant gets a Menu section', rKeys.includes('menu_sections'))
check('restaurant gets Hours, Photos, Events, FAQs',
  ['hours', 'photos', 'events', 'faqs'].every((k) => rKeys.includes(k)))
check('empty specials array is not a section', !rKeys.includes('specials'))
check('scalars are not sections', !rKeys.includes('name') && !rKeys.includes('phone'))
check('charter gets Species and Meeting Points',
  cKeys.includes('fish_species') && cKeys.includes('meeting_points'))
check('charter gets no Menu', !cKeys.includes('menu_sections'))
check('the two businesses share almost nothing',
  rKeys.filter((k) => cKeys.includes(k)).length === 0,
  `overlap: ${rKeys.filter((k) => cKeys.includes(k)).join(', ')}`)

console.log('\nSwept tables merged against the API payload')
// What the direct table sweep returns: real table names, including the ones the
// API renames (entity_hours → hours) and one the API never sends.
const swept = {
  entity_hours: [{ id: 99, day_of_week: 1, opens_at: '09:00', closes_at: '17:00' }],
  entity_photos: [{ id: 98, url: 'https://example.test/b.jpg' }],
  song_requests: [{ id: 1, song: 'Sweet Home Alabama' }],
  menu_items: [{ id: 9, item_name: 'Gulf Oysters' }], // nested in menu_sections already
}
const mergedKeys = discoverSections(mergeEntitySources(restaurant, swept)).map((s) => s.key)

check('entity_hours does not become a second Hours section',
  !mergedKeys.includes('entity_hours'),
  `got: ${mergedKeys.join(', ')}`)
check('entity_photos does not become a second Photos section',
  !mergedKeys.includes('entity_photos'))
check('the API version of hours survives the merge',
  mergeEntitySources(restaurant, swept).hours[0].id === 1)
check('an unanticipated table still becomes its own section',
  mergedKeys.includes('song_requests'))
check('menu_items stays nested rather than duplicating as a section',
  !mergedKeys.includes('menu_items'))

console.log('\nEvery section resolves to a writable table')
const allKeys = [...new Set([...mergedKeys, ...cKeys])]
for (const key of allKeys) {
  const table = tableFor(key)
  check(`${key} → ${table ?? 'read-only'}`, table === null || /^[a-z][a-z0-9_]*$/.test(table))
}
check('no API key maps to itself when the API renamed it',
  API_KEY_TO_TABLE.hours === 'entity_hours' && API_KEY_TO_TABLE.fees === 'entity_offer_fee')
check('derived payload keys are read-only',
  tableFor('industry_facts') === null && tableFor('parent') === null)
check('an unknown table maps straight through',
  tableFor('some_table_added_tomorrow') === 'some_table_added_tomorrow')

console.log('\nAdd-a-section catalog')
// A slice of the live schema: tables this business uses, tables it doesn't,
// and the internal ones it should never be offered.
const liveTables = [
  'entity_hours',
  'entity_photos',
  'menu_sections',
  'entity_events',
  'faqs',
  'happy_hour_sections',
  // not in use by the restaurant above
  'drink_sections',
  'entity_specials', // the payload carried `specials: []` — empty is not "in use"
  'entity_policies',
  'room_types',
  'fish_species',
  'dockside_extras', // a table nobody has written code for
  // internal — must never be offered
  'ai_photo_index_full',
  'entity_owners',
  'platform_admins',
  'business_claims',
  'bookings',
  'customer_leads',
  'sms_messages',
  'song_requests',
  'entity_reviews',
  'menu_sections_backup',
  'entity_tags_old',
  'user_preference_scores',
]
const catalog = buildCatalog(liveTables, mergedKeys)
const offered = catalog.flatMap((g) => g.entries.map((e) => e.table))

check('a table the business already uses is not offered again',
  !offered.includes('entity_hours') &&
    !offered.includes('menu_sections') &&
    !offered.includes('happy_hour_sections'),
  `offered: ${offered.join(', ')}`)
check('the API-renamed key resolves before comparing',
  !offered.includes('entity_photos') && !offered.includes('entity_events'))
check('unused tables ARE offered',
  ['drink_sections', 'entity_specials', 'entity_policies', 'room_types', 'fish_species']
    .every((t) => offered.includes(t)),
  `missing from: ${offered.join(', ')}`)
check('a table present but empty for this business is offered',
  offered.includes('entity_specials'))
check('a table nobody wrote code for is offered anyway',
  offered.includes('dockside_extras'))

for (const internal of [
  'ai_photo_index_full', 'entity_owners', 'platform_admins', 'business_claims',
  'bookings', 'customer_leads', 'sms_messages', 'song_requests', 'entity_reviews',
  'menu_sections_backup', 'entity_tags_old', 'user_preference_scores',
]) {
  check(`${internal} is not offered`, !offered.includes(internal))
}

check('entries carry the label they will have as a section',
  catalog.flatMap((g) => g.entries).find((e) => e.table === 'drink_sections')?.label ===
    'Drinks')
check('everything lands in a named group',
  catalog.every((g) => g.group && g.entries.length))

console.log('\nArtist module')
const artistLive = [
  // exists today
  'artist_profiles', 'songs', 'artist_goals', 'song_cooperatives', 'tip_links',
  'artist_shows', 'artist_qr_codes',
  // added by sql/artist_module.sql
  'artist_price_tiers',
  // fan-submitted — must never be offered as "add this"
  'song_requests', 'shoutouts', 'artist_follows', 'artist_booking_requests',
  'artist_goal_contributions', 'payment_confirmations',
]
const artistCatalog = buildCatalog(artistLive, [])
const artistGroup = artistCatalog.find((g) => g.group === 'Artist & live shows')
const artistOffered = artistGroup ? artistGroup.entries.map((e) => e.table) : []

check('artist tables land in their own group',
  !!artistGroup, `groups: ${artistCatalog.map((g) => g.group).join(', ')}`)
check('the artist can add their setlist, prices, goals and handles',
  ['songs', 'artist_price_tiers', 'artist_goals', 'song_cooperatives', 'tip_links']
    .every((t) => artistOffered.includes(t)),
  `offered: ${artistOffered.join(', ')}`)
check('songs is grouped as artist, not swept into About & content',
  artistOffered.includes('songs'))
for (const fanTable of [
  'song_requests', 'shoutouts', 'artist_follows', 'artist_booking_requests',
  'artist_goal_contributions', 'payment_confirmations',
]) {
  check(`${fanTable} is not offered — fans create it`,
    !artistCatalog.some((g) => g.entries.some((e) => e.table === fanTable)))
}
check('artist tables get real labels, not humanized table names',
  artistOffered.length > 0 &&
    artistGroup.entries.find((e) => e.table === 'songs')?.label === 'Setlist' &&
    artistGroup.entries.find((e) => e.table === 'artist_price_tiers')?.label === 'Prices')
check('fan contact details are masked, not printed',
  maskContact('251-555-1234') === '•••-•••-1234' &&
    maskContact('sarah@example.com') === 'sa•••@example.com',
  `got ${maskContact('251-555-1234')} / ${maskContact('sarah@example.com')}`)

console.log(failures ? `\n${failures} failed\n` : '\nAll checks passed\n')
process.exit(failures ? 1 : 0)
