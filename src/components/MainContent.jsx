export default function MainContent({ children, empty }) {
  if (empty) {
    return (
      <main className="main-content main-empty">
        <p>No sections yet.</p>
      </main>
    )
  }
  return <main className="main-content">{children}</main>
}
