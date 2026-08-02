import { money } from '../lib/format'

// `sections` is the universal flexible-offerings pack (charters, rentals,
// marina products, tours, etc.) — each section already has `items` nested,
// and each item may carry `tiers` (age/season price breakdowns).
export default function OfferingsSection({ entity }) {
  const sections = (entity.sections || []).filter(
    (s) => s.is_active !== false && (s.items || []).length
  )
  if (!sections.length) return null

  return (
    <section className="panel">
      <h2>Offerings</h2>
      {sections.map((sec) => (
        <div key={sec.id} className="menu-subsection">
          <h3>
            {sec.icon ? `${sec.icon} ` : ''}
            {sec.section_name}
          </h3>
          {sec.subtitle && <p className="offering-subtitle">{sec.subtitle}</p>}
          {(sec.items || []).map((item) => (
            <div key={item.id} className="offering-item">
              <div className="menu-item">
                <div>
                  <div className="menu-item-name">{item.item_name}</div>
                  {item.description && <div className="menu-item-desc">{item.description}</div>}
                  {item.duration && <div className="menu-item-desc">{item.duration}</div>}
                </div>
                <div className="menu-item-price">
                  {item.price_label || money(item.price_from)}
                  {item.price_to ? `–${money(item.price_to)}` : ''}
                </div>
              </div>
              {(item.tiers || []).map((t) => (
                <div key={t.id} className="tier-row">
                  <span>{t.label}</span>
                  <span>{money(t.price)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
