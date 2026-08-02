import { fmtTime, money } from '../lib/format'

export default function EventsSection({ entity }) {
  const events = (entity.events || []).filter((e) => e.is_active !== false)
  if (!events.length) return null
  const sorted = [...events].sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''))

  return (
    <section className="panel">
      <h2>Events</h2>
      {sorted.map((e) => (
        <div key={e.id} className="list-row">
          <strong>
            {e.event_name}
            {e.artist_name ? ` — ${e.artist_name}` : ''}
          </strong>
          <span>
            {e.event_date} {e.start_time ? `· ${fmtTime(e.start_time)}` : ''}
            {e.cover_charge ? ` · ${money(e.cover_charge)} cover` : ''}
          </span>
          {e.description && <p>{e.description}</p>}
        </div>
      ))}
    </section>
  )
}
