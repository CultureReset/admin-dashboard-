import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { fetchEntity } from '../lib/gcrApi'
import { fetchEntityTables } from '../lib/schemaDiscovery'
import { fetchTablesForSlug, readTableCache } from '../lib/entityTables'
import { discoverSections, mergeEntitySources } from '../lib/discoverSections'
import { TABLE_TO_API_KEY } from '../lib/tableMap'
import { CUSTOM_RENDERERS } from '../sections/registry'
import GenericSection from '../sections/GenericSection'
import EditableSection from '../sections/EditableSection'
import TopBar from '../components/TopBar'
import BottomNav from '../components/BottomNav'
import MainContent from '../components/MainContent'
import AddSection from '../components/AddSection'

export default function Dashboard() {
  const { gcrSlug } = useAuth()
  const [entity, setEntity] = useState(null)
  const [tableRows, setTableRows] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sweep, setSweep] = useState(null) // { done, total } while scanning
  const [activeKey, setActiveKey] = useState(null)
  const [reloadKey, setReloadKey] = useState(0) // bumped after an edit saves
  const [allTables, setAllTables] = useState([]) // every slug table in the schema
  const [adding, setAdding] = useState(false)

  // The API payload — richest source for the domains it covers.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetchEntity(gcrSlug)
      .then((data) => {
        if (!cancelled) setEntity(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [gcrSlug, reloadKey])

  // Ask the database what tables exist right now, then sweep them for this
  // slug. The schema is re-read every load, so the dashboard follows the
  // database: new tables show up, dropped tables go away, column changes flow
  // through. Cached results only paint instantly while the fresh read runs.
  useEffect(() => {
    let cancelled = false

    const cached = readTableCache(gcrSlug)
    if (cached) setTableRows(cached)

    ;(async () => {
      try {
        const tables = await fetchEntityTables()
        if (cancelled) return
        // Kept whole, not just the ones with rows — this is what the business
        // gets offered when they want to add something they don't have yet.
        setAllTables(tables)
        if (!cached) setSweep({ done: 0, total: tables.length })

        const fresh = await fetchTablesForSlug(gcrSlug, tables, {
          // Stream sections in as they land so the page fills progressively…
          onFound: (table, rows) => {
            if (!cancelled) setTableRows((prev) => ({ ...prev, [table]: rows }))
          },
          onProgress: (done, total) => {
            if (!cancelled && !cached) setSweep({ done, total })
          },
        })

        // …then replace wholesale, which is what drops tables that no longer
        // exist or no longer have data for this business.
        if (!cancelled) setTableRows(fresh)
      } catch {
        // Discovery is additive — if it fails the API-backed sections still work.
      } finally {
        if (!cancelled) setSweep(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [gcrSlug, reloadKey])

  const merged = useMemo(
    () => mergeEntitySources(entity, tableRows),
    [entity, tableRows]
  )
  const sections = useMemo(() => discoverSections(merged), [merged])

  useEffect(() => {
    if (sections.length && !sections.some((s) => s.key === activeKey)) {
      setActiveKey(sections[0].key)
    }
  }, [sections, activeKey])

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <span>Loading your business…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dashboard-loading">
        <span className="auth-error">Couldn't load your business: {error}</span>
      </div>
    )
  }

  const active = sections.find((s) => s.key === activeKey)
  const Custom = active ? CUSTOM_RENDERERS[active.key] : null

  return (
    <div className="dashboard-shell">
      <TopBar businessName={entity?.name} />
      {sweep && (
        <div className="sweep-status">
          Checking your data… {sweep.done}/{sweep.total}
        </div>
      )}
      <MainContent empty={!adding && sections.length === 0} onAdd={() => setAdding(true)}>
        {adding ? (
          <AddSection
            allTables={allTables}
            activeKeys={sections.map((s) => s.key)}
            slug={gcrSlug}
            onCancel={() => setAdding(false)}
            onDone={(table) => {
              setAdding(false)
              // The new row makes this table a section on the next pass.
              setActiveKey(TABLE_TO_API_KEY[table] || table)
              setReloadKey((k) => k + 1)
            }}
          />
        ) : (
          active && (
            <EditableSection
              key={active.key}
              section={active}
              slug={gcrSlug}
              onChanged={() => setReloadKey((k) => k + 1)}
            >
              {Custom ? (
                <Custom entity={merged} section={active} />
              ) : (
                <GenericSection entity={merged} section={active} />
              )}
            </EditableSection>
          )
        )}
      </MainContent>
      <BottomNav
        sections={sections}
        activeKey={activeKey}
        onSelect={(key) => {
          setAdding(false)
          setActiveKey(key)
        }}
        onAdd={() => setAdding(true)}
        adding={adding}
      />
    </div>
  )
}
