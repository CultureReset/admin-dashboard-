import { dayName, fmtTime } from '../lib/format'

export default function HoursSection({ entity }) {
  const hours = entity.hours || []
  if (!hours.length) return null
  const sorted = [...hours].sort((a, b) => a.day_of_week - b.day_of_week)
  return (
    <section className="panel">
      <h2>Hours</h2>
      <div className="hours-grid">
        {sorted.map((h) => (
          <div key={h.day_of_week} className="hours-row">
            <span>{dayName(h.day_of_week)}</span>
            <span>{h.is_closed ? 'Closed' : `${fmtTime(h.opens_at)} – ${fmtTime(h.closes_at)}`}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
