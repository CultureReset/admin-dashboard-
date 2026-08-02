export default function PhotosSection({ entity }) {
  const photos = entity.photos || []
  if (!photos.length) return null
  const sorted = [...photos].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  return (
    <section className="panel">
      <h2>Photos ({photos.length})</h2>
      <div className="photo-scroll">
        {sorted.map((p) => (
          <img key={p.id || p.url} src={p.url} alt={p.caption || ''} loading="lazy" />
        ))}
      </div>
    </section>
  )
}
