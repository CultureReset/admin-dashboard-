// The GCR API reshapes the database before it sends it. `entity_hours` arrives
// as `hours`, `entity_events` as `events`, `entity_offer_fee` as `fees`, and so
// on — buildFullEntity() in gcr-api-clean routes/gcr.js picks the friendlier
// name for the public site.
//
// That rename matters here for two reasons:
//
//   1. Writes. A section discovered from the API payload is keyed by the API's
//      name, and PostgREST has no table called `hours` — every insert, update
//      and delete on an API-supplied section would 404. Editing has to resolve
//      back to the real table first.
//   2. Duplicates. The direct table sweep finds `entity_hours` on its own. With
//      no mapping the dashboard shows both "Hours" (API) and "Entity Hours"
//      (swept) as separate sections holding the same rows.
//
// Anything not listed here is assumed to already be a real table name, which is
// what keeps discovery open-ended: a table added to the database tomorrow is
// swept, rendered and edited with no entry here.

/** API payload key → the table it actually came from. */
export const API_KEY_TO_TABLE = {
  // core, every business
  hours: 'entity_hours',
  secondary_hours: 'entity_secondary_hours',
  photos: 'entity_photos',
  tags: 'entity_tags',
  events: 'entity_events',
  reviews: 'entity_reviews',
  team: 'entity_team_members',
  policies: 'entity_policies',
  blog_posts: 'entity_blog_posts',
  social_posts: 'entity_social_posts',
  about_bullets: 'entity_about_bullets',
  perfect_for: 'entity_perfect_for',
  specials: 'entity_specials',
  sections: 'entity_sections',
  structured_attributes: 'entity_attributes',
  nearby_landmarks: 'entity_nearby_landmarks',
  fees: 'entity_offer_fee',
  deposits: 'entity_offer_deposit',
  refund_policies: 'entity_refund_policy',
  availability_today: 'business_availability',
  modules: 'entity_modules',

  // food
  sides: 'entity_sides',
  daily_features: 'entity_daily_features',

  // activity
  pricing: 'pricing_items',
  schedules: 'activity_schedules',

  // stay
  amenities: 'amenities',

  // loyalty
  loyalty_program: 'loyalty_programs',

  // Same name on both sides — listed so the mapping reads as the full picture
  // rather than looking like an oversight.
  faqs: 'faqs',
  announcements: 'announcements',
  whats_excluded: 'whats_excluded',
  whats_included: 'whats_included',
  what_to_bring: 'what_to_bring',
  requirements: 'requirements',
  meeting_points: 'meeting_points',
  activity_options: 'activity_options',
  fish_species: 'fish_species',
  activity_details: 'activity_details',
  weather_rules: 'weather_rules',
  marina_details: 'marina_details',
  offerings: 'offerings',
  menu_sections: 'menu_sections',
  drink_sections: 'drink_sections',
  happy_hour_sections: 'happy_hour_sections',
  order_links: 'order_links',
  property_details: 'property_details',
  property_fees: 'property_fees',
  room_types: 'room_types',
  stay_links: 'stay_links',
  availability: 'availability',
  bookable_resources: 'bookable_resources',
  service_categories: 'service_categories',
  service_menu: 'service_menu',
  service_packages: 'service_packages',
  class_schedule: 'class_schedule',
  product_categories: 'product_categories',
  products: 'products',
  facilities: 'facilities',
  spot_rules: 'spot_rules',
  access_info: 'access_info',
}

/**
 * Payload keys the API assembles rather than reads — derived counts, a joined
 * parent record, the industry-table lookup. There is no table to write back to,
 * so these render read-only.
 */
export const DERIVED_KEYS = new Set([
  'industry_facts',
  'parent',
  'parent_amenities',
  'module_keys',
])

/** The table a section writes to, or null when the section is read-only. */
export function tableFor(sectionKey) {
  if (DERIVED_KEYS.has(sectionKey)) return null
  return API_KEY_TO_TABLE[sectionKey] || sectionKey
}

/** table name → API payload key, for collapsing swept duplicates. */
export const TABLE_TO_API_KEY = Object.fromEntries(
  Object.entries(API_KEY_TO_TABLE).map(([apiKey, table]) => [table, apiKey])
)
