import { money } from '../lib/format'

// menu_sections / drink_sections each arrive as an array of section objects
// with `items` already nested inside — the API does the section/item join
// server-side, nothing to re-group on the client.
export default function MenuSection({ entity, sectionsKey, title }) {
  const sections = entity[sectionsKey] || []
  const populated = sections.filter((s) => (s.items || []).length)
  if (!populated.length) return null

  return (
    <section className="panel">
      <h2>{title}</h2>
      {populated.map((sec) => (
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
                <div className="menu-item-price">{money(item.price)}</div>
              </div>
            ))}
        </div>
      ))}
    </section>
  )
}
