export default function FaqsSection({ entity }) {
  const faqs = entity.faqs || []
  if (!faqs.length) return null

  return (
    <section className="panel">
      <h2>FAQs</h2>
      {faqs.map((f) => (
        <details key={f.id} className="faq-row">
          <summary>{f.question}</summary>
          <p>{f.answer}</p>
        </details>
      ))}
    </section>
  )
}
