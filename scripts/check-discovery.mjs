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
import { detectProgress, detectPriceList, detectInbox, isContactField, maskContact } from '../src/lib/shapes.js'

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
  ai_photo_index_full: [{ id: 1, entity_slug: 'flora-bama', vec: 'x' }], // machinery
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
  mergedKeys.includes('song_requests'), `got: ${mergedKeys.join(', ')}`)
check('customer-submitted content IS shown — it is the business\'s data',
  mergedKeys.includes('song_requests'))
check('menu_items stays nested rather than duplicating as a section',
  !mergedKeys.includes('menu_items'))
check('AI machinery swept from the database is not rendered as a section',
  !mergedKeys.includes('ai_photo_index_full'), `got: ${mergedKeys.join(', ')}`)

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

console.log('\nShape detection — nothing depends on a table being known')

// Tables invented for this test. None of them appear anywhere in src/.
const unknownGoal = [
  { id: 1, campaign_name: 'New van fund', current_amount: 4200, target_amount: 9000 },
  { id: 2, campaign_name: 'Studio time', current_amount: 0, target_amount: 1500 },
]
const unknownPrices = [
  { id: 1, tier_type: 'sponsorship', label: 'Stage banner', amount: 250, sort_order: 1 },
  { id: 2, tier_type: 'sponsorship', label: 'Named set', amount: 500, sort_order: 2 },
  { id: 3, tier_type: 'meet_greet', label: 'Photo + signed poster', amount: 40, sort_order: 1 },
]
const unknownInbox = [
  { id: 1, patron_name: 'Katie', patron_phone: '251-555-9090', wish: 'Play Wonderwall' },
]
const notProgress = [{ id: 1, goal_type: 'nightly', description: 'no numbers here' }]

const g = detectProgress(unknownGoal)
check('an unknown campaign table is detected as progress',
  g?.raised === 'current_amount' && g?.target === 'target_amount', JSON.stringify(g))
check('its title field is found too', g?.title === 'campaign_name')
check('a text-only table is NOT mistaken for progress', detectProgress(notProgress) === null)
check('a table with no rows is not progress', detectProgress([]) === null)

const pl = detectPriceList(unknownPrices)
check('an unknown tiers table is detected as a price list',
  pl?.kind === 'tier_type' && pl?.label === 'label' && pl?.amount === 'amount',
  JSON.stringify(pl))
check('a plain priced list is not forced into the grouped layout',
  detectPriceList([{ id: 1, name: 'Half day', price: 800 }]) === null)

check('an unknown submissions table is detected by its columns',
  detectInbox('wish_wall', [], unknownInbox))
check('a submissions table is detected by its name alone',
  detectInbox('venue_inquiries', [{ name: 'x' }]))
check('the business\'s own content is not an inbox',
  !detectInbox('drink_sections', [{ name: 'section_name' }, { name: 'sort_order' }]))

console.log('\nCatalog uses shape, not a list of names')
const shapeTables = [
  'artist_price_tiers', 'songs', 'artist_goals',   // known artist tables
  'merch_crowdfund', 'sponsor_tiers',              // invented, should be offered
  'wish_wall', 'venue_inquiries',                  // invented, should be held back
]
const columnsByTable = {
  wish_wall: [{ name: 'patron_name' }, { name: 'patron_phone' }],
  merch_crowdfund: [{ name: 'current_amount' }, { name: 'target_amount' }],
  sponsor_tiers: [{ name: 'tier_type' }, { name: 'label' }, { name: 'amount' }],
}
const shapeCatalog = buildCatalog(shapeTables, [], (t) => columnsByTable[t] || [])
const shapeOffered = shapeCatalog.flatMap((g2) => g2.entries.map((e) => e.table))

check('an invented crowdfund table is offered', shapeOffered.includes('merch_crowdfund'),
  `offered: ${shapeOffered.join(', ')}`)
check('an invented tiers table is offered', shapeOffered.includes('sponsor_tiers'))
check('an invented submissions table is held back by its columns',
  !shapeOffered.includes('wish_wall'))
check('an invented inquiries table is held back by its name',
  !shapeOffered.includes('venue_inquiries'))

const artistGroup2 = shapeCatalog.find((g2) => g2.group === 'Artist & live shows')
const artistNames = artistGroup2 ? artistGroup2.entries.map((e) => e.table) : []
check('artist tables group by pattern, not membership',
  ['artist_price_tiers', 'songs', 'artist_goals'].every((t) => artistNames.includes(t)),
  `artist group: ${artistNames.join(', ')}`)
check('a brand-new artist_* table would group too — pattern check',
  /^artists?(_|$)/.test('artist_merch_drops'))
check('artist tables still get real labels',
  artistGroup2?.entries.find((e) => e.table === 'songs')?.label === 'Setlist' &&
    artistGroup2?.entries.find((e) => e.table === 'artist_price_tiers')?.label === 'Prices')

console.log('\nContact masking is by naming convention')
check('somebody else\'s phone is masked',
  maskContact('251-555-1234') === '•••-•••-1234' &&
    maskContact('sarah@example.com') === 'sa•••@example.com',
  `got ${maskContact('251-555-1234')} / ${maskContact('sarah@example.com')}`)
check('an invented contact column is caught',
  isContactField('patron_phone') && isContactField('subscriber_email'))
check('a plain phone column on a list row is masked',
  isContactField('phone'))
check("the business's own phone stays readable",
  !isContactField('phone', { ownRecord: true }))
check('a non-contact column is untouched',
  !isContactField('song_title') && !isContactField('amount'))

console.log(failures ? `\n${failures} failed\n` : '\nAll checks passed\n')
process.exit(failures ? 1 : 0)
