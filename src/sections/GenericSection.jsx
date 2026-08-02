import { labelFor } from '../lib/discoverSections'
import { money } from '../lib/format'
import { isContactField, maskContact, TITLE_FIELDS } from '../lib/shapes'

// Universal renderer for any data domain that doesn't have a purpose-built
// component. Works off the shape of the rows themselves, so a table added to
// the API tomorrow still displays sensibly with no code change here.

// Plumbing columns — real data, but not worth showing as content.
const HIDDEN_FIELDS = new Set([
  'id',
  'entity_slug',
  'entity_id',
  'site_id',
  'section_id',
  'created_at',
  'updated_at',
  'sort_order',
  'is_active',
  'image_path',
  'photo_path',
])

// First match wins when picking which field is the row's headline / body / price.
// TITLE_FIELDS is shared with shapes.js so "what is this row called" is decided once.
const BODY_FIELDS = [
  'description', 'body', 'answer', 'desc', 'note', 'notes', 'summary',
  'content', 'terms', 'instructions', 'requirement_text', 'excerpt',
  'caption', 'bio', 'value',
]
const PRICE_FIELDS = [
  'price', 'price_from', 'amount', 'rate', 'nightly_price', 'cost',
  'cover_charge', 'deposit_amount', 'fee', 'price_label',
]

function pick(row, candidates) {
  for (const f of candidates) {
    const v = row[f]
    if (v !== null && v !== undefined && v !== '') return { field: f, value: v }
  }
  return null
}

function renderValue(v, field, ownRecord = false) {
  if (Array.isArray(v)) return v.map((x) => renderValue(x, field, ownRecord)).filter(Boolean).join(', ')
  if (v && typeof v === 'object') return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  // Somebody else's phone number or email — a fan, a lead, a contributor.
  // Printing it in full turns every section into a contact list; the last four
  // digits are enough to match a payment to a person. Matched by naming
  // convention, so a column added tomorrow is covered too.
  if (isContactField(field, { ownRecord })) return maskContact(v)
  return String(v)
}

function Row({ row }) {
  const title = pick(row, TITLE_FIELDS)
  const body = pick(row, BODY_FIELDS)
  const price = pick(row, PRICE_FIELDS)
  const used = new Set(
    [title?.field, body?.field, price?.field].filter(Boolean)
  )

  // Anything left over that still carries information becomes a small chip,
  // so no real data silently disappears just because it wasn't anticipated.
  const extras = Object.entries(row).filter(([k, v]) => {
    if (HIDDEN_FIELDS.has(k) || used.has(k)) return false
    if (v === null || v === undefined || v === '') return false
    if (typeof v === 'object' && !Array.isArray(v)) return false
    if (Array.isArray(v) && v.length === 0) return false
    return true
  })

  return (
    <div className="generic-row">
      <div className="generic-row-main">
        <div>
          {title && <div className="generic-title">{renderValue(title.value, title.field)}</div>}
          {body && <div className="generic-body">{renderValue(body.value, body.field)}</div>}
        </div>
        {price && (
          <div className="generic-price">
            {price.field === 'price_label'
              ? renderValue(price.value, price.field)
              : money(price.value) || renderValue(price.value, price.field)}
          </div>
        )}
      </div>
      {extras.length > 0 && (
        <div className="generic-chips">
          {extras.map(([k, v]) => (
            <span key={k} className="chip">
              <b>{labelFor(k)}:</b> {renderValue(v, k)}
            </span>
          ))}
        </div>
      )}
      {/* Rows that nest their own items (menu-style sections) still show them. */}
      {Array.isArray(row.items) && row.items.length > 0 && (
        <div className="generic-nested">
          {row.items.map((child, i) => (
            <Row key={child.id ?? i} row={child} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function GenericSection({ section }) {
  const { label, kind, data } = section

  if (kind === 'record') {
    const entries = Object.entries(data).filter(
      ([k, v]) =>
        !HIDDEN_FIELDS.has(k) &&
        v !== null &&
        v !== undefined &&
        v !== '' &&
        !(typeof v === 'object' && !Array.isArray(v))
    )
    if (!entries.length) return null
    return (
      <section className="panel">
        <h2>{label}</h2>
        <div className="facts-grid">
          {entries.map(([k, v]) => (
            <div key={k} className="fact">
              <b>{labelFor(k)}</b>
              <span>{renderValue(v, k, true)}</span>
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="panel">
      <h2>
        {label} <span className="count">({data.length})</span>
      </h2>
      {data.map((row, i) => (
        <Row key={row.id ?? i} row={row} />
      ))}
    </section>
  )
}
