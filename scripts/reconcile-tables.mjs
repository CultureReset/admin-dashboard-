#!/usr/bin/env node
/**
 * Reconcile the designed table registry against the live database.
 *
 * Reads two inputs from docs/reconciliation/source/:
 *   CyberCheck_Complete_Table_Registry.csv  — the 244-table design
 *   live_tables.csv                         — snapshot of what's actually there
 *
 * and regenerates every file in docs/reconciliation/.
 *
 * Usage:
 *   node scripts/reconcile-tables.mjs
 *       Regenerate the four output files from the checked-in snapshot.
 *       No network, no database, deterministic.
 *
 *   SUPABASE_SERVICE_KEY=<service_role key> node scripts/reconcile-tables.mjs --refresh
 *       Rebuild live_tables.csv from the database first, then regenerate.
 *
 * --refresh reads the PostgREST schema and asks each table for its row count.
 * It writes nothing to the database and creates nothing — no helper view, no
 * function, no migration. Only tables PostgREST exposes are visible this way;
 * if the two counts ever disagree with the SQL editor, that gap is the reason.
 * The equivalent query, if you'd rather paste it into the SQL editor:
 *
 *   SELECT c.relname AS table_name,
 *          (xpath('/row/c/text()', query_to_xml(
 *             format('SELECT count(*) AS c FROM public.%I', c.relname),
 *             false, true, '')))[1]::text::bigint AS rows,
 *          EXISTS (SELECT 1 FROM information_schema.columns ic
 *                  WHERE ic.table_schema = 'public'
 *                    AND ic.table_name = c.relname
 *                    AND ic.column_name = 'entity_slug') AS has_slug
 *   FROM pg_class c
 *   JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 *   WHERE c.relkind = 'r'
 *   ORDER BY 1;
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs/reconciliation')
const SRC = join(OUT, 'source')
const REGISTRY = join(SRC, 'CyberCheck_Complete_Table_Registry.csv')
const SNAPSHOT = join(SRC, 'live_tables.csv')

const SUPABASE_URL = 'https://mkepugvdlktfsossumox.supabase.co'
const REFRESH = process.argv.includes('--refresh')

// ── CSV ─────────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((f) => f !== ''))
}

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const toCSV = (header, rows) =>
  [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n'

// ── Live snapshot ───────────────────────────────────────────────────────────
async function refreshSnapshot() {
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) {
    console.error('--refresh needs SUPABASE_SERVICE_KEY (service_role key).')
    process.exit(1)
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}` }

  const spec = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { ...auth, Accept: 'application/openapi+json' },
    cache: 'no-store',
  }).then((r) => r.json())

  const defs = spec.definitions || spec.components?.schemas || {}
  const names = Object.keys(defs).filter((n) => defs[n]?.properties).sort()

  const out = []
  const queue = [...names]
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${encodeURIComponent(t)}?select=*&limit=1`,
        { method: 'HEAD', headers: { ...auth, Prefer: 'count=exact' } }
      )
      // Content-Range comes back as "0-0/1234" or "*/1234"
      const count = parseInt((res.headers.get('content-range') || '').split('/')[1], 10)
      out.push({
        table_name: t,
        rows: Number.isFinite(count) ? count : 0,
        has_slug: 'entity_slug' in (defs[t].properties || {}),
      })
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker))

  out.sort((a, b) => a.table_name.localeCompare(b.table_name))
  writeFileSync(
    SNAPSHOT,
    toCSV(['table_name', 'rows', 'has_slug'],
      out.map((r) => [r.table_name, r.rows, r.has_slug ? 'yes' : 'no']))
      // written unquoted for readable diffs
      .replace(/"/g, '')
  )
  console.log(`refreshed snapshot: ${out.length} tables`)
}

function readSnapshot() {
  const rows = parseCSV(readFileSync(SNAPSHOT, 'utf8'))
  return new Map(
    rows.slice(1).map((r) => [
      r[0].trim(),
      { rows: parseInt(r[1], 10) || 0, hasSlug: r[2].trim() === 'yes' },
    ])
  )
}

// ── Disposition heuristics for undesigned live tables ───────────────────────
// Concepts the design names differently. Left = live table, right = designed.
const RENAMES = {
  module_catalog: 'modules',
  industry_table_contract: 'capability_table_contract',
  rental_units: 'lodging_units',
  menu_sections: 'menus',
  entity_offer_price: 'prices',
  activity_schedules: 'schedules',
  charter_trips: 'trips',
  business_staff: 'staff',
  service_menu: 'services',
  entity_ical_feeds: 'external_calendar_feeds',
  entity_external_calendars: 'external_calendar_feeds',
  ical_availability_blocks: 'external_calendar_events',
  entity_faqs: 'faqs',
  entity_amenities: 'amenities',
  inventory_items: 'products',
  entity_gallery: 'entity_photos',
  hours_exceptions: 'entity_hours_exceptions',
  subtype_taxonomy: 'industry_subtypes',
  industry: 'industry_catalog',
}

const RETIRE_PATTERNS = [
  /_backup$/, /_backup_\d+$/, /^legacy_/, /^recovery_/, /_json_backup$/,
  /_metadata_backup$/, /^_/,
]

function disposition(name, rows, hasSlug) {
  if (RENAMES[name]) return ['rename', `design calls this "${RENAMES[name]}"`]
  if (RETIRE_PATTERNS.some((re) => re.test(name))) {
    return ['retire', 'backup / legacy / migration artifact']
  }
  if (name.startsWith('ai_')) {
    return [rows > 0 ? 'keep-internal' : 'retire', 'AI/derived index, not business-facing']
  }
  if (rows === 0) return ['review', 'empty — build it out or drop it']
  if (hasSlug) return ['keep', 'live business data attached to a slug']
  return ['keep', 'live data, not slug-attached']
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(OUT, { recursive: true })
  if (REFRESH) await refreshSnapshot()

  // Designed tables, from the registry
  const reg = parseCSV(readFileSync(REGISTRY, 'utf8'))
  const header = reg[0]
  const col = (n) => header.indexOf(n)
  const designed = new Map()
  for (const r of reg.slice(1)) {
    const t = (r[col('Table')] || '').trim()
    if (!t) continue
    designed.set(t, {
      category: r[col('Category')] || '',
      definition: r[col('Definition')] || '',
      industries: r[col('Common Industries')] || '',
      columns: r[col('Recommended Columns')] || '',
      example: r[col('Example Data')] || '',
    })
  }

  const liveMap = readSnapshot()

  // ── 1. Designed but missing ───────────────────────────────────────────────
  const missing = [...designed.entries()]
    .filter(([t]) => !liveMap.has(t))
    .sort((a, b) => a[1].category.localeCompare(b[1].category) || a[0].localeCompare(b[0]))
    .map(([t, d]) => [d.category, t, d.definition, d.industries, d.columns, d.example])

  writeFileSync(
    join(OUT, 'MISSING_TABLES.csv'),
    toCSV(['Category', 'Table', 'Definition', 'Common Industries', 'Recommended Columns', 'Example Data'], missing)
  )

  // ── 2. Live but never designed ────────────────────────────────────────────
  const undesigned = [...liveMap.entries()]
    .filter(([t]) => !designed.has(t))
    .sort((a, b) => b[1].rows - a[1].rows || a[0].localeCompare(b[0]))
    .map(([t, l]) => {
      const [action, why] = disposition(t, l.rows, l.hasSlug)
      return [t, l.rows, l.hasSlug ? 'yes' : 'no', action, why]
    })

  writeFileSync(
    join(OUT, 'UNDESIGNED_TABLES.csv'),
    toCSV(['Table', 'Rows', 'Slug Attached', 'Suggested Action', 'Why'], undesigned)
  )

  const byAction = {}
  for (const [, , , action] of undesigned) byAction[action] = (byAction[action] || 0) + 1

  // ── 3. Collisions ─────────────────────────────────────────────────────────
  const collisions = Object.entries(RENAMES)
    .filter(([liveName]) => liveMap.has(liveName))
    .map(([liveName, designedName]) => ({
      liveName,
      designedName,
      liveRows: liveMap.get(liveName).rows,
      designedLive: liveMap.has(designedName),
      designedRows: liveMap.get(designedName)?.rows ?? null,
    }))
    .sort((a, b) => b.liveRows - a.liveRows)

  const bothLive = collisions.filter((c) => c.designedLive)

  const collisionsMd = [
    '# Name collisions: one concept, two names',
    '',
    'Each row is a concept the design and the database call different things.',
    'Decide once per row — adopt the designed name, keep the live name, or merge —',
    'before anything gets built on top of the wrong one.',
    '',
    '| Live table | Rows | Design calls it | Designed name also live? | Its rows |',
    '|---|---:|---|---|---:|',
    ...collisions.map((c) =>
      `| \`${c.liveName}\` | ${c.liveRows.toLocaleString()} | \`${c.designedName}\` | ` +
      `${c.designedLive ? '**yes — both exist**' : 'no'} | ` +
      `${c.designedLive ? c.designedRows.toLocaleString() : '—'} |`
    ),
    '',
    `## The urgent ${bothLive.length}`,
    '',
    bothLive.length
      ? 'Both names exist as real tables. Until each pair is merged, writes can land\n' +
        'in either one and reads will disagree:\n\n' +
        bothLive
          .map((c) =>
            `- \`${c.liveName}\` (${c.liveRows.toLocaleString()} rows) vs ` +
            `\`${c.designedName}\` (${c.designedRows.toLocaleString()} rows)`
          )
          .join('\n')
      : 'None — every collision is a naming decision only, not two competing tables.',
    '',
    '## The rest',
    '',
    'For these the designed name does not exist yet, so nothing is split. The',
    'choice is simply whether to rename on the way to matching the design, or to',
    'update the registry to use the live name.',
    '',
  ].join('\n')
  writeFileSync(join(OUT, 'COLLISIONS.md'), collisionsMd)

  // ── 4. README ─────────────────────────────────────────────────────────────
  const inBoth = [...designed.keys()].filter((t) => liveMap.has(t))
  const inBothWithData = inBoth.filter((t) => liveMap.get(t).rows > 0)
  const liveWithData = [...liveMap.values()].filter((l) => l.rows > 0).length
  const slugTables = [...liveMap.values()].filter((l) => l.hasSlug)
  const slugWithData = slugTables.filter((l) => l.rows > 0).length
  const distinct = designed.size + liveMap.size - inBoth.length

  const missingByCategory = {}
  for (const [category] of missing) {
    missingByCategory[category] = (missingByCategory[category] || 0) + 1
  }

  const readme = `# Table reconciliation

What was designed, what is actually in the database, and the gap between them.

Regenerate with \`node scripts/reconcile-tables.mjs\`. Add \`--refresh\` (with
\`SUPABASE_SERVICE_KEY\` set) to re-read the database first.

## Where things stand

| | Count |
|---|---:|
| Tables in the design | ${designed.size} |
| Tables live in the database | ${liveMap.size} |
| In both | ${inBoth.length} |
| In both **and holding data** | ${inBothWithData.length} |
| Designed but not built | ${missing.length} |
| Live but never designed | ${undesigned.length} |
| Live tables with data | ${liveWithData} (${liveMap.size - liveWithData} empty) |
| Slug tables with data | ${slugWithData} of ${slugTables.length} |

The design and the database overlap in ${inBoth.length} of ${distinct} distinct
tables — about ${Math.round((inBoth.length / distinct) * 100)}%. Only
${inBothWithData.length} designed tables are carrying data today.

## The files

**MISSING_TABLES.csv** — ${missing.length} designed tables that don't exist.
Each row carries its definition, intended industries, recommended columns and
example data, so a row is enough to build from. By category:

${Object.entries(missingByCategory)
  .sort()
  .map(([c, n]) => `- ${c} — **${n}**`)
  .join('\n')}

**UNDESIGNED_TABLES.csv** — ${undesigned.length} live tables absent from the
design, sorted by row count, each with a suggested action:

${Object.entries(byAction)
  .sort((a, b) => b[1] - a[1])
  .map(([a, n]) => {
    const why = {
      keep: 'live business data — add to the registry so the design matches reality',
      review: 'empty — build it out or drop it',
      'keep-internal': 'AI/derived index; real, but not business-facing',
      retire: 'backup, legacy or migration artifact',
      rename: 'duplicate of a designed table under another name',
    }[a]
    return `- \`${a}\` — **${n}** — ${why}`
  })
  .join('\n')}

**COLLISIONS.md** — ${collisions.length} concepts living under two names,
${bothLive.length} of which exist as two real tables right now.

**source/** — the inputs. \`CyberCheck_Complete_Table_Registry.csv\` is the
design; \`CyberCheck_Industry_Table_Matrix.csv\` maps tables to industries;
\`live_tables.csv\` is the database snapshot everything here is measured against.

## Suggested order

1. **COLLISIONS.md first**, starting with the ${bothLive.length} pairs where both
   tables exist. Every duplicate resolved now is one that doesn't get built twice.
2. **UNDESIGNED_TABLES.csv, the \`retire\` rows.** Dropping dead tables shrinks
   the surface before any other decision has to be made about it.
3. **UNDESIGNED_TABLES.csv, the \`keep\` rows.** These hold real data and belong
   in the registry — the design should describe what exists.
4. **UNDESIGNED_TABLES.csv, the \`review\` rows.** ${byAction.review || 0} empty
   tables, each either unfinished work or abandoned scaffolding.
5. **MISSING_TABLES.csv.** Build in dependency order: foundation and identity,
   then the shared rules, then the industry packs.

## One thing worth knowing about the dashboard

The dashboard sweeps every slug table blindly and shows whichever ones come back
with rows. It ignores \`industry_table_contract\` (${liveMap.get('industry_table_contract')?.rows ?? 0} rows),
which already records which tables each industry is supposed to have. Wiring the
dashboard to that table would make sections reflect the design rather than
whatever happens to hold data — and needs no schema change at all.
`
  writeFileSync(join(OUT, 'README.md'), readme)

  console.log(`designed ${designed.size} · live ${liveMap.size} · both ${inBoth.length}`)
  console.log(`missing ${missing.length} · undesigned ${undesigned.length} · collisions ${collisions.length} (${bothLive.length} both live)`)
  console.log('wrote MISSING_TABLES.csv, UNDESIGNED_TABLES.csv, COLLISIONS.md, README.md')
}

main().catch((e) => { console.error(e); process.exit(1) })
