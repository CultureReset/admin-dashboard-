export default function BottomNav({ sections, activeKey, onSelect }) {
  if (!sections.length) return null
  return (
    <nav className="bottom-nav">
      {sections.map((s) => (
        <button
          key={s.key}
          className={`bottom-nav-item${s.key === activeKey ? ' active' : ''}`}
          onClick={() => onSelect(s.key)}
        >
          <span className="bottom-nav-icon">{s.icon}</span>
          <span className="bottom-nav-label">{s.label}</span>
        </button>
      ))}
    </nav>
  )
}
