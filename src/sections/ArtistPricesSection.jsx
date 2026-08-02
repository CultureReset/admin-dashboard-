import { PRICE_KINDS } from '../lib/artistModule'
import { money } from '../lib/format'

// artist_price_tiers grouped by what the price is for, so an artist reading
// this sees "Shoutouts: Birthday $10, Bachelorette $15" rather than a flat list
// of rows where `kind` is just another column.
//
// Editing still goes through EditableSection and the schema-built form — this
// only changes how the rows are laid out.

export default function ArtistPricesSection({ section }) {
  const rows = Array.isArray(section.data) ? section.data : []
  if (!rows.length) return null

  // Preserve the declared order of PRICE_KINDS, then anything unrecognised.
  const seen = new Set(rows.map((r) => r.kind || 'other'))
  const order = [
    ...Object.keys(PRICE_KINDS).filter((k) => seen.has(k)),
    ...[...seen].filter((k) => !PRICE_KINDS[k]),
  ]

  return (
    <section className="panel">
      <h2>
        {section.label} <span className="count">({rows.length})</span>
      </h2>

      {order.map((kind) => {
        const group = rows
          .filter((r) => (r.kind || 'other') === kind)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        if (!group.length) return null
        const meta = PRICE_KINDS[kind]

        return (
          <div key={kind} className="price-kind">
            <h3 className="price-kind-name">{meta?.label || kind}</h3>
            {meta?.help && <p className="price-kind-help">{meta.help}</p>}
            <div className="price-row">
              {group.map((row) => (
                <div
                  key={row.id}
                  className={`price-chip${row.active === false ? ' off' : ''}`}
                >
                  <b>
                    {row.amount === null || row.amount === undefined
                      ? 'Fan chooses'
                      : `${money(row.amount) || `$${row.amount}`}${row.is_minimum ? '+' : ''}`}
                  </b>
                  <span>{row.label}</span>
                  {row.description && <small>{row.description}</small>}
                  {row.active === false && <em>hidden from fans</em>}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}
