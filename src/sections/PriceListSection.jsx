import { detectPriceList } from '../lib/shapes'
import { PRICE_KIND_LABELS } from '../lib/artistModule'
import { money } from '../lib/format'

// Priced options grouped by what they're for — "Shoutouts: Birthday $10,
// Bachelorette $15" rather than a flat list where the grouping column is just
// another chip.
//
// The kind/label/amount fields are found by shape, and the groups come from
// whatever values are actually in the data. PRICE_KIND_LABELS only supplies
// nicer wording for kinds we happen to have words for; an unrecognised kind
// renders under its own raw value rather than disappearing.
//
// Returns null when the shape isn't there, so the caller falls through to
// GenericSection.

export default function PriceListSection({ section, columns = [] }) {
  const rows = Array.isArray(section.data) ? section.data : []
  const shape = detectPriceList(rows, columns)
  if (!shape) return null

  const kindOf = (r) => r[shape.kind] ?? 'other'

  // Known kinds first in their declared order, then everything else as found.
  const present = [...new Set(rows.map(kindOf))]
  const order = [
    ...Object.keys(PRICE_KIND_LABELS).filter((k) => present.includes(k)),
    ...present.filter((k) => !PRICE_KIND_LABELS[k]),
  ]

  return (
    <section className="panel">
      <h2>
        {section.label} <span className="count">({rows.length})</span>
      </h2>

      {order.map((kind) => {
        const group = rows
          .filter((r) => kindOf(r) === kind)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        if (!group.length) return null
        const meta = PRICE_KIND_LABELS[kind]

        return (
          <div key={String(kind)} className="price-kind">
            <h3 className="price-kind-name">
              {meta?.label || String(kind).replace(/_/g, ' ')}
            </h3>
            {meta?.help && <p className="price-kind-help">{meta.help}</p>}
            <div className="price-row">
              {group.map((row, i) => {
                const amount = row[shape.amount]
                const open = amount === null || amount === undefined || amount === ''
                return (
                  <div
                    key={row.id ?? i}
                    className={`price-chip${row.active === false ? ' off' : ''}`}
                  >
                    <b>
                      {open
                        ? 'Fan chooses'
                        : `${money(amount) || `$${amount}`}${row.is_minimum ? '+' : ''}`}
                    </b>
                    <span>{row[shape.label]}</span>
                    {row.description && <small>{row.description}</small>}
                    {row.active === false && <em>hidden from fans</em>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </section>
  )
}
