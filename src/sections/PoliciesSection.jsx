export default function PoliciesSection({ entity }) {
  const policies = entity.policies || []
  if (!policies.length) return null

  return (
    <section className="panel">
      <h2>Policies</h2>
      {policies.map((p) => (
        <details key={p.id} className="faq-row">
          <summary>{p.title || p.type || p.policy_type}</summary>
          <p>{p.body || p.content}</p>
        </details>
      ))}
    </section>
  )
}
