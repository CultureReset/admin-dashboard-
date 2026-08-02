import { PROGRESS_SHAPES } from '../lib/artistModule'
import { money } from '../lib/format'

// Goals and crowdfunded songs, with the progress bar the fan pages show.
//
// Both artist_goals and song_cooperatives are "raised of target" rows that just
// name their columns differently; PROGRESS_SHAPES says which is which. A table
// added later with the same shape only needs an entry there.

function pct(raised, target) {
  const t = Number(target) || 0
  if (t <= 0) return 0
  return Math.min(Math.round((Number(raised || 0) / t) * 100), 100)
}

export default function ArtistGoalSection({ section }) {
  const rows = Array.isArray(section.data) ? section.data : []
  if (!rows.length) return null

  const shape = PROGRESS_SHAPES[section.key] || {
    raised: 'current_amount',
    target: 'target_amount',
    title: 'title',
  }

  return (
    <section className="panel">
      <h2>
        {section.label} <span className="count">({rows.length})</span>
      </h2>

      {rows.map((row, i) => {
        const raised = row[shape.raised]
        const target = row[shape.target]
        const p = pct(raised, target)
        const title = row[shape.title] || row.title || row.goal_name || `#${i + 1}`
        const closed = row.active === false || row.status === 'closed'

        return (
          <div key={row.id ?? i} className={`goal-row${closed ? ' closed' : ''}`}>
            <div className="goal-head">
              <div>
                <div className="generic-title">{title}</div>
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
              {row.num_contributors != null && (
                <span className="chip">
                  <b>Contributors:</b> {row.num_contributors}
                </span>
              )}
              {(row.goal_date || row.deadline) && (
                <span className="chip">
                  <b>By:</b> {row.goal_date || row.deadline}
                </span>
              )}
              {row.min_contribution != null && (
                <span className="chip">
                  <b>Minimum:</b> {money(row.min_contribution)}
                </span>
              )}
              {closed && <span className="chip">Not shown to fans</span>}
            </div>
          </div>
        )
      })}
    </section>
  )
}
