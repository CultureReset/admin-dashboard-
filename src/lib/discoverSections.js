// Explicit extension: this module is also imported by scripts/check-discovery.mjs
// under plain node, which does not do extensionless resolution.
import { TABLE_TO_API_KEY } from './tableMap.js'
import { ARTIST_LABELS, ARTIST_ICONS } from './artistModule.js'
import { isInternal } from './sectionCatalog.js'

// Section discovery: walk the entity payload from GCR API Clean and turn
// every data domain that actually has rows into a dashboard section.
//
// This is deliberately NOT a fixed list of supported sections. Any table
// attached to the business's slug that comes back with data becomes a
// section — including tables added to the API later, with no change here.

// Keys that are metadata/relationships rather than a business data section.
const NOT_A_SECTION = new Set([
  'id',
  'slug',
  'created_at',
  'updated_at',
  'search_vector',
  'embedding',
  'modules',
  'module_keys',
  'child_count',
  'is_hub',
  'spots_remaining',
  'hero_image_url',
  'google_places_data',
  'display_config',
  'address_descriptor',
  'google_maps_links',
  'theme',
])

// Nicer names for keys where humanizing the column name isn't quite right.
const LABEL_OVERRIDES = {
  menu_sections: 'Menu',
  drink_sections: 'Drinks',
  happy_hour_sections: 'Happy Hour',
  sections: 'Offerings',
  faqs: 'FAQs',
  industry_facts: 'Details',
  secondary_hours: 'Other Hours',
  whats_included: "What's Included",
  whats_excluded: "What's Not Included",
  what_to_bring: 'What to Bring',
  structured_attributes: 'Attributes',
  nearby_landmarks: 'Nearby',
  perfect_for: 'Perfect For',
  about_bullets: 'About',
  social_posts: 'Social Posts',
  blog_posts: 'Blog',
  order_links: 'Ordering',
  stay_links: 'Booking Links',
  bookable_resources: 'Units',
  service_menu: 'Services',
  class_schedule: 'Classes',
  product_categories: 'Product Categories',
  service_categories: 'Service Categories',
  activity_options: 'Options',
  meeting_points: 'Meeting Points',
  fish_species: 'Species',
  daily_features: 'Daily Features',
  refund_policies: 'Refund Policies',
  weather_rules: 'Weather Rules',
  property_details: 'Property Details',
  property_fees: 'Property Fees',
  room_types: 'Room Types',
  activity_details: 'Activity Details',
  access_info: 'Access Info',
  loyalty_program: 'Loyalty',
  marina_details: 'Marina',
  availability_today: 'Availability Today',
  parent_amenities: 'Complex Amenities',
  spot_rules: 'Rules',
}

const ICONS = {
  hours: '🕒',
  secondary_hours: '🕒',
  photos: '📷',
  menu_sections: '🍽️',
  drink_sections: '🍹',
  happy_hour_sections: '🥂',
  events: '🎤',
  specials: '🏷️',
  reviews: '⭐',
  faqs: '❓',
  policies: '📄',
  sections: '📦',
  offerings: '📦',
  team: '👥',
  tags: '🔖',
  amenities: '✨',
  fees: '💵',
  deposits: '💵',
  property_fees: '💵',
  pricing: '💵',
  products: '🛍️',
  service_menu: '🧰',
  class_schedule: '📅',
  availability: '📅',
  bookable_resources: '🛏️',
  room_types: '🛏️',
  meeting_points: '📍',
  nearby_landmarks: '📍',
  blog_posts: '📝',
  announcements: '📣',
  social_posts: '📱',
  loyalty_program: '🎁',
  industry_facts: 'ℹ️',
}

function humanize(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function labelFor(key) {
  return LABEL_OVERRIDES[key] || ARTIST_LABELS[key] || humanize(key)
}

export function iconFor(key) {
  return ICONS[key] || ARTIST_ICONS[key] || '📋'
}

/** Does this value represent real, displayable data? */
function hasData(value) {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') {
    return Object.values(value).some(
      (v) => v !== null && v !== undefined && v !== ''
    )
  }
  return false // scalars are profile fields, not sections
}

// Child tables whose rows the API already returns nested inside a parent
// section — showing them again as their own section would just be a duplicate.
const NESTED_IN_PARENT = new Set([
  'menu_items',
  'drink_items',
  'happy_hour_items',
  'menu_item_options',
  'menu_item_option_groups',
  'entity_section_items',
  'offering_prices',
  'price_tiers',
  'room_amenities',
])

/**
 * Combine the API's entity payload with rows swept directly from the database.
 * The API version wins where both have the same key, since it arrives already
 * joined/nested (menu sections with their items, offerings with price tiers).
 */
export function mergeEntitySources(entity, tableRows = {}) {
  const merged = { ...(entity || {}) }
  for (const [table, rows] of Object.entries(tableRows)) {
    if (NESTED_IN_PARENT.has(table)) continue
    // Machinery swept straight out of the database. Verified against a live
    // business: without this, Flora-Bama's dashboard opens with
    // ai_photo_index_full and ai_entity_intent_tags_full as sections.
    if (isInternal(table)) continue
    // The API renames most tables on the way out (entity_hours → hours). Check
    // the name it would have arrived under, or the swept table shows up a
    // second time as its own near-identical section.
    const apiKey = TABLE_TO_API_KEY[table]
    if (apiKey && hasData(merged[apiKey])) continue
    if (hasData(merged[table])) continue // API already supplied a richer version
    merged[apiKey || table] = rows
  }
  return merged
}

/**
 * Returns [{ key, label, icon, kind, data }] for every data domain this
 * business actually has. `kind` is 'list' (array of rows) or 'record'
 * (single object of fields).
 */
export function discoverSections(entity) {
  if (!entity) return []

  return Object.keys(entity)
    .filter((key) => !NOT_A_SECTION.has(key))
    .filter((key) => hasData(entity[key]))
    .map((key) => ({
      key,
      label: labelFor(key),
      icon: iconFor(key),
      kind: Array.isArray(entity[key]) ? 'list' : 'record',
      data: entity[key],
    }))
}
