import { useState } from 'react'
import { getColumns, isEditableColumn } from '../lib/schemaDiscovery'
import { labelFor } from '../lib/discoverSections'

// A form that builds itself from a table's columns. Nothing here knows about
// menus or hours or charters — give it any table and it renders the right
// inputs, so tables added to the database later are editable with no new code.

function inputFor(col, value, onChange) {
  const common = {
    id: col.name,
    value: value ?? '',
    onChange: (e) => onChange(col.name, e.target.value),
  }

  if (col.enum) {
    return (
      <select {...common}>
        <option value="">—</option>
        {col.enum.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }

  if (col.type === 'boolean') {
    return (
      <select {...common}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  }

  if (col.type === 'integer' || col.type === 'number') {
    return <input type="number" step="any" {...common} />
  }

  if (col.format === 'date') return <input type="date" {...common} />
  if (col.format === 'time' || /^time/.test(col.format)) {
    return <input type="time" {...common} />
  }
  if (/timestamp/.test(col.format)) {
    return <input type="datetime-local" {...common} />
  }

  // Free text: longer fields get a textarea.
  if (/description|body|answer|notes?|content|summary|terms/i.test(col.name)) {
    return <textarea rows={3} {...common} />
  }

  return <input type="text" {...common} />
}

export default function RowEditor({ table, row, onSave, onCancel, onDelete }) {
  const columns = getColumns(table).filter(isEditableColumn)
  const [values, setValues] = useState(() => {
    const seed = {}
    for (const col of columns) seed[col.name] = row?.[col.name] ?? ''
    return seed
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function change(name, value) {
    setValues((v) => ({ ...v, [name]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSave(coerce(values, columns))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Delete this permanently?')) return
    setBusy(true)
    setError('')
    try {
      await onDelete()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (!columns.length) {
    return (
      <div className="editor">
        <p className="auth-error">This table has no editable fields.</p>
        <button onClick={onCancel}>Close</button>
      </div>
    )
  }

  return (
    <form className="editor" onSubmit={submit}>
      {columns.map((col) => (
        <label key={col.name} className="editor-field">
          <span>{labelFor(col.name)}</span>
          {inputFor(col, values[col.name], change)}
        </label>
      ))}

      {error && <p className="auth-error">{error}</p>}

      <div className="editor-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {row && onDelete && (
          <button type="button" className="danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
      </div>
    </form>
  )
}

// Turn form strings back into the types the database expects.
function coerce(values, columns) {
  const out = {}
  for (const col of columns) {
    const raw = values[col.name]
    if (raw === '' || raw === undefined) {
      out[col.name] = null
    } else if (col.type === 'boolean') {
      out[col.name] = raw === 'true'
    } else if (col.type === 'integer') {
      out[col.name] = parseInt(raw, 10)
    } else if (col.type === 'number') {
      out[col.name] = parseFloat(raw)
    } else {
      out[col.name] = raw
    }
  }
  return out
}
