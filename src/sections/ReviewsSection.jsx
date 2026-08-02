export default function ReviewsSection({ entity }) {
  const reviews = entity.reviews || []
  if (!reviews.length) return null

  return (
    <section className="panel">
      <h2>Reviews ({reviews.length})</h2>
      {reviews.slice(0, 8).map((r) => (
        <div key={r.id} className="review-row">
          <div className="stars">
            {'★'.repeat(Math.round(r.rating || 5))}
            {'☆'.repeat(5 - Math.round(r.rating || 5))}
          </div>
          {r.title && <strong>{r.title}</strong>}
          <p>{r.body}</p>
          <small>{r.reviewer_name || 'Verified customer'}</small>
        </div>
      ))}
    </section>
  )
}
