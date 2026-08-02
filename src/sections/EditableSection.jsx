import { useState } from 'react'
import GenericSection from './GenericSection'
import RowEditor from '../components/RowEditor'
import { createRow, updateRow, deleteRow } from '../lib/writeEntityData'

// Wraps a discovered section with add / edit / delete. Works for any table,
// since both the display and the form derive from the data and schema.
export default function EditableSection({ section, slug, onChanged, children }) {
  const [editing, setEditing] = useState(null) // row object, or 'new'

  const table = section.key
  const isList = section.kind === 'list'

  async function save(values) {
    if (editing === 'new') await createRow(table, slug, values)
    else await updateRow(table, slug, editing.id, values)
    setEditing(null)
    onChanged?.()
  }

  async function remove() {
    await deleteRow(table, slug, editing.id)
    setEditing(null)
    onChanged?.()
  }

  if (editing) {
    return (
      <div className="panel">
        <h2>{editing === 'new' ? `Add to ${section.label}` : `Edit ${section.label}`}</h2>
        <RowEditor
          table={table}
          row={editing === 'new' ? null : editing}
          onSave={save}
          onCancel={() => setEditing(null)}
          onDelete={editing === 'new' ? null : remove}
        />
      </div>
    )
  }

  return (
    <>
      {children ?? <GenericSection section={section} />}

      {isList && (
        <div className="section-tools">
          <button className="primary" onClick={() => setEditing('new')}>
            + Add
          </button>
          {section.data.map((row, i) => (
            <button key={row.id ?? i} onClick={() => setEditing(row)} disabled={!row.id}>
              Edit {rowLabel(row, i)}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function rowLabel(row, i) {
  const name =
    row.item_name || row.name || row.title || row.label || row.question ||
    row.event_name || row.special_name || row.section_name
  if (name) return String(name).slice(0, 28)
  return `#${i + 1}`
}
