import HoursSection from './HoursSection'
import PhotosSection from './PhotosSection'
import MenuSection from './MenuSection'
import HappyHourSection from './HappyHourSection'
import EventsSection from './EventsSection'
import SpecialsSection from './SpecialsSection'
import ReviewsSection from './ReviewsSection'
import FaqsSection from './FaqsSection'
import PoliciesSection from './PoliciesSection'
import OfferingsSection from './OfferingsSection'
import PriceListSection from './PriceListSection'
import ProgressSection from './ProgressSection'
import { detectPriceList, detectProgress } from '../lib/shapes'

// How a section gets its renderer, in order:
//
//   1. BY_KEY      — the GCR API's own payload keys. These are fixed shapes
//                    the API guarantees (hours as day-of-week rows, photos as
//                    an image grid), so naming them is correct, not hardwiring.
//   2. BY_SHAPE    — anything else. Look at the rows: does this track a target
//                    and a running total? Is it a set of priced options grouped
//                    into kinds? A table nobody has heard of gets the right
//                    layout without being named anywhere.
//   3. GenericSection — the universal fallback.
//
// Nothing in this file decides which sections EXIST. Discovery does that.

const BY_KEY = {
  hours: HoursSection,
  photos: PhotosSection,
  menu_sections: (props) => (
    <MenuSection {...props} sectionsKey="menu_sections" title="Menu" />
  ),
  drink_sections: (props) => (
    <MenuSection {...props} sectionsKey="drink_sections" title="Drinks" />
  ),
  happy_hour_sections: HappyHourSection,
  events: EventsSection,
  specials: SpecialsSection,
  reviews: ReviewsSection,
  faqs: FaqsSection,
  policies: PoliciesSection,
  sections: OfferingsSection,
}

// Shape detectors, most specific first. Each renderer also re-checks its own
// shape and returns null if it doesn't hold, so a false positive here degrades
// to an empty panel rather than a crash — but the guard keeps that from
// happening in the first place.
const BY_SHAPE = [
  [detectProgress, ProgressSection],
  [detectPriceList, PriceListSection],
]

/**
 * The component for a section, or null to use GenericSection.
 *
 * @param {{key: string, kind: string, data: any}} section
 * @param {object[]} columns  live schema columns for the underlying table
 */
export function rendererFor(section, columns = []) {
  if (!section) return null
  if (BY_KEY[section.key]) return BY_KEY[section.key]
  if (section.kind !== 'list') return null

  const rows = Array.isArray(section.data) ? section.data : []
  for (const [detect, Component] of BY_SHAPE) {
    if (detect(rows, columns)) return Component
  }
  return null
}

// Kept for anything still reading the old map directly.
export const CUSTOM_RENDERERS = BY_KEY
