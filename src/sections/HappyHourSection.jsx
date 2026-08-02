import { fmtTime, money } from '../lib/format'

export default function HappyHourSection({ entity }) {
  const sections = (entity.happy_hour_sections || []).filter((s) => (s.items || []).length)
  const hasTimeLine = !!entity.hh_start
  if (!sections.length && !hasTimeLine) return null

  return (
    <section className="panel">
      <h2>Happy Hour</h2>
      {hasTimeLine && (
        <p className="happy-hour-time">
          {entity.hh_days ? `${entity.hh_days} · ` : ''}
          {fmtTime(entity.hh_start)} – {fmtTime(entity.hh_end)}
          {entity.hh_description ? ` — ${entity.hh_description}` : ''}
        </p>
      )}
      {sections.map((sec) => (
        <div key={sec.id} className="menu-subsection">
          <h3>{sec.section_name}</h3>
          {(sec.items || [])
            .filter((i) => i.is_available !== false)
            .map((item) => (
              <div key={item.id} className="menu-item">
                <div>
                  <div className="menu-item-name">{item.item_name}</div>
                  {item.description && <div className="menu-item-desc">{item.description}</div>}
                </div>
                <div className="menu-item-price">
                  {item.original_price && (
                    <span className="strike">{money(item.original_price)}</span>
                  )}
                  {money(item.price)}
                </div>
              </div>
            ))}
        </div>
      ))}
    </section>
  )
}
