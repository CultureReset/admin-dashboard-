export default function MainContent({ children, empty, onAdd }) {
  if (empty) {
    // A business with nothing entered yet is the normal starting state, not an
    // error — send them straight into the catalog instead of a dead end.
    return (
      <main className="main-content main-empty">
        <p>Nothing here yet.</p>
        {onAdd && (
          <button type="button" className="primary" onClick={onAdd}>
            Add your first section
          </button>
        )}
      </main>
    )
  }
  return <main className="main-content">{children}</main>
}
