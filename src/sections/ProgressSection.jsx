import { detectProgress } from '../lib/shapes'
import { money } from '../lib/format'

// Anything that tracks "X of Y raised" — a nightly goal, a crowdfunded song, a
// merch pre-order target, a table nobody has invented yet.
//
// The fields are found by shape, not looked up by table name, so this renders
// correctly for any table whose columns follow the raised/target convention.
// If the shape isn't there, it returns null and the caller falls through to
// GenericSection.

function pct(raised, target) {
  const t = Number(target) || 0
  if (t <= 0) return 0
  return Math.min(Math.round((Number(raised || 0) / t) * 100), 100)
}

export default function ProgressSection({ section, columns = [] }) {
  const rows = Array.isArray(section.data) ? section.data : []
  const shape = detectProgress(rows, columns)
  if (!shape) return null

  return (
    <section className="panel">
      <h2>
        {section.label} <span className="count">({rows.length})</span>
      </h2>

      {rows.map((row, i) => {
        const raised = row[shape.raised]
        const target = row[shape.target]
        const p = pct(raised, target)
        const title = (shape.title && row[shape.title]) || `#${i + 1}`
        const closed = row.active === false || row.status === 'closed'

        // Anything the header and bar didn't already use, as chips — so a
        // column added to this table tomorrow still shows up. Foreign keys and
        // bookkeeping are skipped by shape (`*_id`, `*_at`), not by name.
        const used = new Set([shape.raised, shape.target, shape.title,
          'entity_slug', 'description', 'active', 'status'])
        const extras = Object.entries(row).filter(
          ([k, v]) =>
            !used.has(k) &&
            !/(^id$|_id$|_at$)/.test(k) &&
            v !== null && v !== undefined && v !== '' &&
            typeof v !== 'object'
        )

        return (
          <div key={row.id ?? i} className={`goal-row${closed ? ' closed' : ''}`}>
            <div className="goal-head">
              <div>
                <div className="generic-title">{String(title)}</div>
                {row.description && <div className="generic-body">{row.description}</div>}
              </div>
              <div className="goal-amount">
                {money(raised) || '$0'}
                <span> of {money(target) || '—'}</span>
              </div>
            </div>

            <div className="goal-bar">
              <div className="goal-fill" style={{ width: `${p}%` }} />
            </div>

            <div className="generic-chips">
              <span className="chip">
                <b>Progress:</b> {p}%
              </span>
              {extras.map(([k, v]) => (
                <span key={k} className="chip">
                  <b>{k.replace(/_/g, ' ')}:</b>{' '}
                  {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}
                </span>
              ))}
              {closed && <span className="chip">Not shown to fans</span>}
            </div>
          </div>
        )
      })}
    </section>
  )
}
