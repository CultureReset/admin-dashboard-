export default function SpecialsSection({ entity }) {
  const specials = (entity.specials || []).filter((s) => s.is_active !== false)
  if (!specials.length) return null

  return (
    <section className="panel">
      <h2>Specials</h2>
      {specials.map((s) => (
        <div key={s.id} className="list-row">
          <strong>{s.special_name}</strong>
          {(s.discount_text || s.discount_value) && (
            <span>
              {s.discount_text ||
                `${s.discount_value}${s.discount_type === 'percent' ? '% off' : ' off'}`}
            </span>
          )}
          {s.days && <span>{s.days}</span>}
          {s.description && <p>{s.description}</p>}
        </div>
      ))}
    </section>
  )
}
