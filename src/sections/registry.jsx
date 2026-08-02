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

// Purpose-built renderers, only for data domains where a generic list layout
// genuinely falls short (day-of-week mapping, image grids, nested pricing
// tiers, star ratings, accordions).
//
// This map does NOT define which sections exist — discoverSections() does that
// from the API response. Anything not listed here renders through
// GenericSection, so a business with data in a table nobody anticipated still
// gets a working section for it.
export const CUSTOM_RENDERERS = {
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
