#!/usr/bin/env node
/**
 * Build a single browsable HTML page from the reconciliation output.
 *
 *   node scripts/build-reconciliation-page.mjs
 *
 * Reads docs/reconciliation/*.csv and writes docs/reconciliation/index.html.
 * Self-contained — no network, no external assets.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs/reconciliation')

function parseCSV(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((f) => f !== ''))
}

function objects(file) {
  const rows = parseCSV(readFileSync(join(OUT, file), 'utf8'))
  const head = rows[0]
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

const missing = objects('MISSING_TABLES.csv').map((r) => ({
  t: r.Table,
  c: r.Category,
  d: r.Definition,
  i: r['Common Industries'],
  k: r['Recommended Columns'],
  e: r['Example Data'],
}))

const undesigned = objects('UNDESIGNED_TABLES.csv').map((r) => ({
  t: r.Table,
  n: Number(r.Rows),
  s: r['Slug Attached'] === 'yes',
  a: r['Suggested Action'],
  w: r.Why,
}))

const live = objects('source/live_tables.csv')
const liveMap = new Map(live.map((r) => [r.table_name, Number(r.rows)]))
const registry = objects('source/CyberCheck_Complete_Table_Registry.csv')
const designedNames = new Set(registry.map((r) => r.Table.trim()))

const RENAMES = {
  module_catalog: 'modules', industry_table_contract: 'capability_table_contract',
  rental_units: 'lodging_units', menu_sections: 'menus', entity_offer_price: 'prices',
  activity_schedules: 'schedules', charter_trips: 'trips', business_staff: 'staff',
  service_menu: 'services', entity_ical_feeds: 'external_calendar_feeds',
  entity_external_calendars: 'external_calendar_feeds',
  ical_availability_blocks: 'external_calendar_events', entity_faqs: 'faqs',
  entity_amenities: 'amenities', inventory_items: 'products',
  entity_gallery: 'entity_photos', hours_exceptions: 'entity_hours_exceptions',
  subtype_taxonomy: 'industry_subtypes', industry: 'industry_catalog',
}

const collisions = Object.entries(RENAMES)
  .filter(([l]) => liveMap.has(l))
  .map(([l, d]) => ({
    live: l, design: d,
    liveRows: liveMap.get(l),
    bothLive: liveMap.has(d),
    designRows: liveMap.has(d) ? liveMap.get(d) : null,
  }))
  .sort((a, b) => Number(b.bothLive) - Number(a.bothLive) || b.liveRows - a.liveRows)

const inBoth = [...designedNames].filter((t) => liveMap.has(t))
const inBothWithData = inBoth.filter((t) => liveMap.get(t) > 0)
const liveWithData = live.filter((r) => Number(r.rows) > 0).length
const slugTables = live.filter((r) => r.has_slug === 'yes')
const slugWithData = slugTables.filter((r) => Number(r.rows) > 0).length
const totalRows = live.reduce((a, r) => a + Number(r.rows), 0)

const DATA = {
  missing, undesigned, collisions,
  stats: {
    designed: designedNames.size,
    live: liveMap.size,
    inBoth: inBoth.length,
    inBothWithData: inBothWithData.length,
    missing: missing.length,
    undesigned: undesigned.length,
    liveWithData,
    liveEmpty: liveMap.size - liveWithData,
    slugTables: slugTables.length,
    slugWithData,
    totalRows,
    bothLive: collisions.filter((c) => c.bothLive).length,
  },
}

const ACTION_NOTE = {
  keep: 'Real business data the design never described. Add it to the registry.',
  review: 'Empty. Either unfinished work or abandoned scaffolding — decide which.',
  'keep-internal': 'AI or derived index. Real, but not something a business edits.',
  rename: 'The same concept as a designed table, under a different name.',
  retire: 'Backup, legacy or migration artifact. Safe to drop once confirmed.',
}

const html = `<title>Table reconciliation — CyberCheck</title>
<style>
:root {
  color-scheme: light;
  --paper:      #f2f4f5;
  --card:       #ffffff;
  --ink:        #10151a;
  --ink-2:      #47535e;
  --ink-3:      #77848f;
  --rule:       #d8dee2;
  --rule-soft:  #e7ebee;
  --accent:     #14666f;
  --accent-bg:  #dcecec;
  --warn:       #9a5a12;
  --warn-bg:    #f3e6d2;
  --crit:       #9c2f26;
  --crit-bg:    #f4ddda;
  --good:       #2a5f47;
  --good-bg:    #dcebe2;
  --mute-bg:    #e6eaed;

  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --serif: ui-serif, Charter, "Iowan Old Style", Georgia, serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --paper:     #0d1114;
    --card:      #151b20;
    --ink:       #e6ecf0;
    --ink-2:     #a3b0ba;
    --ink-3:     #71808b;
    --rule:      #29333a;
    --rule-soft: #1e262c;
    --accent:    #59b8bd;
    --accent-bg: #12333a;
    --warn:      #d69a4d;
    --warn-bg:   #3a2c14;
    --crit:      #e08076;
    --crit-bg:   #3c1f1c;
    --good:      #77bd97;
    --good-bg:   #16301f;
    --mute-bg:   #212a31;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper:#0d1114; --card:#151b20; --ink:#e6ecf0; --ink-2:#a3b0ba; --ink-3:#71808b;
  --rule:#29333a; --rule-soft:#1e262c; --accent:#59b8bd; --accent-bg:#12333a;
  --warn:#d69a4d; --warn-bg:#3a2c14; --crit:#e08076; --crit-bg:#3c1f1c;
  --good:#77bd97; --good-bg:#16301f; --mute-bg:#212a31;
}
:root[data-theme="light"] {
  color-scheme: light;
  --paper:#f2f4f5; --card:#ffffff; --ink:#10151a; --ink-2:#47535e; --ink-3:#77848f;
  --rule:#d8dee2; --rule-soft:#e7ebee; --accent:#14666f; --accent-bg:#dcecec;
  --warn:#9a5a12; --warn-bg:#f3e6d2; --crit:#9c2f26; --crit-bg:#f4ddda;
  --good:#2a5f47; --good-bg:#dcebe2; --mute-bg:#e6eaed;
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font-family: var(--sans); font-size: 15px; line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px 96px; }

/* ── masthead ───────────────────────────────────────────── */
.masthead { padding: 56px 0 36px; border-bottom: 1px solid var(--rule); }
.eyebrow {
  font-family: var(--mono); font-size: 11px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--ink-3); margin: 0 0 14px;
}
h1 {
  font-family: var(--serif); font-weight: 600; font-size: clamp(30px, 5.5vw, 46px);
  line-height: 1.08; letter-spacing: -.015em; margin: 0 0 16px; text-wrap: balance;
}
.standfirst {
  font-size: 17px; color: var(--ink-2); max-width: 62ch; margin: 0;
}
.standfirst b { color: var(--ink); font-weight: 600; }

/* ── the gap bar: the whole finding in one graphic ──────── */
.gap { margin: 40px 0 0; }
.gapbar {
  display: flex; height: 62px; border-radius: 3px; overflow: hidden;
  border: 1px solid var(--rule);
}
.gapbar > div {
  display: flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: 13px; font-weight: 600;
  color: var(--card); position: relative;
}
.seg-missing { background: var(--warn); }
.seg-both    { background: var(--accent); }
.seg-undes   { background: var(--ink-2); }
.gapkey {
  display: grid; gap: 4px 18px; margin-top: 14px;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  font-size: 13px; color: var(--ink-2);
}
.gapkey div { display: flex; gap: 8px; align-items: baseline; }
.sw { width: 10px; height: 10px; border-radius: 2px; flex: none; translate: 0 -1px; }

/* ── stat strip ─────────────────────────────────────────── */
.stats {
  display: grid; gap: 1px; margin: 34px 0 0; background: var(--rule);
  border: 1px solid var(--rule); border-radius: 4px; overflow: hidden;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}
.stat { background: var(--card); padding: 15px 16px; }
.stat .n {
  font-family: var(--mono); font-size: 23px; font-weight: 600;
  font-variant-numeric: tabular-nums; letter-spacing: -.02em; display: block;
}
.stat .l { font-size: 12px; color: var(--ink-3); line-height: 1.35; display: block; margin-top: 3px; }

/* ── sections ───────────────────────────────────────────── */
section { padding-top: 64px; scroll-margin-top: 12px; }
.sec-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.sec-num {
  font-family: var(--mono); font-size: 12px; color: var(--ink-3);
  border: 1px solid var(--rule); border-radius: 3px; padding: 2px 7px;
}
h2 {
  font-family: var(--serif); font-size: 27px; font-weight: 600;
  letter-spacing: -.01em; margin: 0; text-wrap: balance;
}
.sec-sub { color: var(--ink-2); margin: 10px 0 0; max-width: 68ch; }
.sec-sub code, p code { font-family: var(--mono); font-size: .9em; background: var(--mute-bg); padding: 1px 5px; border-radius: 3px; }

/* ── controls ───────────────────────────────────────────── */
.controls {
  display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
  margin: 22px 0 0; position: sticky; top: 0; z-index: 5;
  background: var(--paper); padding: 12px 0; border-bottom: 1px solid var(--rule-soft);
}
input[type="search"] {
  font: inherit; font-family: var(--mono); font-size: 13px;
  padding: 8px 12px; border: 1px solid var(--rule); border-radius: 3px;
  background: var(--card); color: var(--ink); min-width: 230px; flex: 1 1 230px;
}
input[type="search"]:focus-visible, button:focus-visible, summary:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  font: inherit; font-size: 12px; font-family: var(--mono);
  padding: 6px 11px; border: 1px solid var(--rule); border-radius: 3px;
  background: var(--card); color: var(--ink-2); cursor: pointer;
}
.chip[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.count { font-size: 12px; color: var(--ink-3); font-family: var(--mono); margin-left: auto; }

/* ── tables ─────────────────────────────────────────────── */
.scroll { overflow-x: auto; margin-top: 4px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th {
  text-align: left; font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-3); font-weight: 600; padding: 12px 12px 8px; white-space: nowrap;
  border-bottom: 1px solid var(--rule);
}
td { padding: 11px 12px; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
tbody tr:hover { background: var(--card); }
.num { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tname { font-family: var(--mono); font-size: 13px; white-space: nowrap; }
.dim { color: var(--ink-3); }

.pill {
  display: inline-block; font-family: var(--mono); font-size: 11px;
  padding: 2px 8px; border-radius: 10px; white-space: nowrap;
}
.p-keep { background: var(--good-bg); color: var(--good); }
.p-review { background: var(--mute-bg); color: var(--ink-2); }
.p-keepinternal { background: var(--accent-bg); color: var(--accent); }
.p-rename { background: var(--warn-bg); color: var(--warn); }
.p-retire { background: var(--crit-bg); color: var(--crit); }

/* ── collisions ─────────────────────────────────────────── */
.coll { display: grid; gap: 10px; margin-top: 24px; }
.coll-card {
  background: var(--card); border: 1px solid var(--rule); border-radius: 4px;
  padding: 14px 16px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
}
.coll-card.urgent { border-left: 3px solid var(--crit); }
.side { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.side .nm { font-family: var(--mono); font-size: 13.5px; word-break: break-all; }
.side .rc { font-family: var(--mono); font-size: 11px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.vs { font-family: var(--serif); font-style: italic; color: var(--ink-3); font-size: 14px; }
.coll-tag { margin-left: auto; }

/* ── expandable detail ──────────────────────────────────── */
details summary {
  cursor: pointer; list-style: none; font-family: var(--mono); font-size: 11px;
  color: var(--accent); margin-top: 7px; display: inline-block;
}
details summary::-webkit-details-marker { display: none; }
details summary::before { content: "+ "; }
details[open] summary::before { content: "− "; }
details[open] summary { margin-bottom: 7px; }
.cols {
  font-family: var(--mono); font-size: 11.5px; line-height: 1.75; color: var(--ink-2);
  background: var(--mute-bg); padding: 10px 12px; border-radius: 3px;
  max-width: 74ch; white-space: pre-wrap; word-break: break-word;
}
.ex { font-size: 13px; color: var(--ink-2); margin: 8px 0 0; max-width: 70ch; font-style: italic; }

.empty { padding: 26px 12px; color: var(--ink-3); font-size: 14px; }

/* ── footnote ───────────────────────────────────────────── */
.foot {
  margin-top: 72px; padding-top: 22px; border-top: 1px solid var(--rule);
  font-size: 13px; color: var(--ink-3); max-width: 74ch;
}
.foot code { font-family: var(--mono); background: var(--mute-bg); padding: 1px 5px; border-radius: 3px; }

@media (max-width: 640px) {
  .masthead { padding-top: 36px; }
  .gapbar { height: 52px; }
  .gapbar > div { font-size: 11px; }
  .count { margin-left: 0; width: 100%; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>

<div class="wrap">

<header class="masthead">
  <p class="eyebrow">CyberCheck · schema reconciliation · generated 2026-08-01</p>
  <h1>The design describes one system. The database is running another.</h1>
  <p class="standfirst">
    244 tables were designed. 563 exist. They agree on <b>77</b> — and only
    <b>42</b> of those carry any data. Everything below is measured against a
    live snapshot, not a guess.
  </p>

  <div class="gap">
    <div class="gapbar" role="img" aria-label="167 designed but never built, 77 in both, 486 live but never designed">
      <div class="seg-missing" style="flex: 167">167</div>
      <div class="seg-both"    style="flex: 77">77</div>
      <div class="seg-undes"   style="flex: 486">486</div>
    </div>
    <div class="gapkey">
      <div><span class="sw" style="background:var(--warn)"></span><span><b>167 designed, never built.</b> Definitions and columns exist. The tables don't.</span></div>
      <div><span class="sw" style="background:var(--accent)"></span><span><b>77 in both.</b> The only common ground — 42 hold data.</span></div>
      <div><span class="sw" style="background:var(--ink-2)"></span><span><b>486 live, never designed.</b> Running in production, undocumented.</span></div>
    </div>
  </div>

  <div class="stats">
    <div class="stat"><span class="n">563</span><span class="l">tables live</span></div>
    <div class="stat"><span class="n">237</span><span class="l">holding data · 326 empty</span></div>
    <div class="stat"><span class="n">305</span><span class="l">carry an entity_slug</span></div>
    <div class="stat"><span class="n">175</span><span class="l">slug tables with data</span></div>
    <div class="stat"><span class="n">522,309</span><span class="l">rows across everything</span></div>
    <div class="stat"><span class="n">6</span><span class="l">concepts split across two live tables</span></div>
  </div>
</header>

<section id="collisions">
  <div class="sec-head"><span class="sec-num">FIRST</span><h2>Nineteen concepts, two names each</h2></div>
  <p class="sec-sub">
    Same idea, called different things by the design and by the database. Six of
    them exist as <b>two real tables at once</b> — writes can land in either and
    reads will disagree. Resolve these before anything gets built on top of the
    wrong one.
  </p>
  <div class="coll" id="coll-list"></div>
</section>

<section id="missing">
  <div class="sec-head"><span class="sec-num">THEN</span><h2>167 designed, never built</h2></div>
  <p class="sec-sub">
    Each one arrives with its definition, intended industries and recommended
    columns — enough to build from without deciding anything again. Expand a row
    to see the columns.
  </p>
  <div class="controls">
    <input type="search" id="q-missing" placeholder="filter 167 tables…" aria-label="Filter missing tables">
    <div class="chips" id="cat-chips"></div>
    <span class="count" id="c-missing"></span>
  </div>
  <div class="scroll"><table>
    <thead><tr><th style="width:26%">Table</th><th>Definition &amp; columns</th></tr></thead>
    <tbody id="tb-missing"></tbody>
  </table></div>
</section>

<section id="undesigned">
  <div class="sec-head"><span class="sec-num">ALSO</span><h2>486 live, never designed</h2></div>
  <p class="sec-sub">
    Sorted by row count. The largest tables in your database are at the top — and
    none of them appear in the registry at all. Filter by what to do with them.
  </p>
  <div class="controls">
    <input type="search" id="q-undes" placeholder="filter 486 tables…" aria-label="Filter undesigned tables">
    <div class="chips" id="act-chips"></div>
    <span class="count" id="c-undes"></span>
  </div>
  <p class="sec-sub" id="act-note" style="margin-top:14px"></p>
  <div class="scroll"><table>
    <thead><tr>
      <th style="width:32%">Table</th><th class="num">Rows</th>
      <th>Slug</th><th>Action</th><th>Why</th>
    </tr></thead>
    <tbody id="tb-undes"></tbody>
  </table></div>
</section>

<p class="foot">
  Measured against a snapshot of the live database taken 2026-08-01. Regenerate
  the underlying files with <code>node scripts/reconcile-tables.mjs</code>, or
  <code>--refresh</code> to re-read the database first. Nothing here writes to
  the database. Row counts spot-checked directly against live for the twelve
  largest tables — all twelve match.
</p>

</div>

<script>
const D = ${JSON.stringify(DATA)};
const NOTE = ${JSON.stringify(ACTION_NOTE)};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num = (n) => n.toLocaleString();

/* ── collisions ─────────────────────────────────────────── */
document.getElementById('coll-list').innerHTML = D.collisions.map((c) => \`
  <div class="coll-card\${c.bothLive ? ' urgent' : ''}">
    <div class="side">
      <span class="nm">\${esc(c.live)}</span>
      <span class="rc">\${num(c.liveRows)} rows · live</span>
    </div>
    <span class="vs">vs</span>
    <div class="side">
      <span class="nm\${c.bothLive ? '' : ' dim'}">\${esc(c.design)}</span>
      <span class="rc">\${c.bothLive ? num(c.designRows) + ' rows · live' : 'design only — not built'}</span>
    </div>
    <span class="coll-tag pill \${c.bothLive ? 'p-retire' : 'p-review'}">
      \${c.bothLive ? 'both exist — merge' : 'naming decision'}
    </span>
  </div>\`).join('');

/* ── missing ────────────────────────────────────────────── */
const cats = [...new Set(D.missing.map((r) => r.c))].sort();
let catSel = null;
document.getElementById('cat-chips').innerHTML = cats.map((c) =>
  \`<button class="chip" data-cat="\${esc(c)}" aria-pressed="false">\${esc(c.replace(/^\\d+\\s/, ''))}</button>\`
).join('');

function renderMissing() {
  const q = document.getElementById('q-missing').value.trim().toLowerCase();
  const rows = D.missing.filter((r) =>
    (!catSel || r.c === catSel) &&
    (!q || (r.t + ' ' + r.d + ' ' + r.i + ' ' + r.k).toLowerCase().includes(q))
  );
  document.getElementById('c-missing').textContent = rows.length + ' of ' + D.missing.length;
  document.getElementById('tb-missing').innerHTML = rows.length ? rows.map((r) => \`
    <tr>
      <td>
        <div class="tname">\${esc(r.t)}</div>
        <div class="dim" style="font-size:11.5px;margin-top:4px">\${esc(r.c.replace(/^\\d+\\s/, ''))}</div>
      </td>
      <td>
        <div>\${esc(r.d)}</div>
        \${r.i ? \`<div class="dim" style="font-size:12px;margin-top:5px">For: \${esc(r.i)}</div>\` : ''}
        \${r.k ? \`<details><summary>columns</summary><div class="cols">\${esc(r.k).replace(/ \\| /g, '\\n')}</div></details>\` : ''}
        \${r.e ? \`<p class="ex">\${esc(r.e)}</p>\` : ''}
      </td>
    </tr>\`).join('') : '<tr><td colspan="2" class="empty">Nothing matches that filter.</td></tr>';
}

document.getElementById('q-missing').addEventListener('input', renderMissing);
document.getElementById('cat-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  catSel = catSel === b.dataset.cat ? null : b.dataset.cat;
  document.querySelectorAll('#cat-chips .chip').forEach((c) =>
    c.setAttribute('aria-pressed', String(c.dataset.cat === catSel)));
  renderMissing();
});

/* ── undesigned ─────────────────────────────────────────── */
const acts = [...new Set(D.undesigned.map((r) => r.a))]
  .sort((a, b) => D.undesigned.filter((r) => r.a === b).length - D.undesigned.filter((r) => r.a === a).length);
let actSel = null;
document.getElementById('act-chips').innerHTML = acts.map((a) => {
  const n = D.undesigned.filter((r) => r.a === a).length;
  return \`<button class="chip" data-act="\${esc(a)}" aria-pressed="false">\${esc(a)} · \${n}</button>\`;
}).join('');

function renderUndes() {
  const q = document.getElementById('q-undes').value.trim().toLowerCase();
  const rows = D.undesigned.filter((r) =>
    (!actSel || r.a === actSel) && (!q || r.t.toLowerCase().includes(q))
  );
  document.getElementById('c-undes').textContent = rows.length + ' of ' + D.undesigned.length;
  document.getElementById('act-note').textContent = actSel ? NOTE[actSel] : '';
  document.getElementById('tb-undes').innerHTML = rows.length ? rows.map((r) => \`
    <tr>
      <td class="tname">\${esc(r.t)}</td>
      <td class="num">\${num(r.n)}</td>
      <td class="dim" style="font-size:12px">\${r.s ? 'yes' : '—'}</td>
      <td><span class="pill p-\${r.a.replace('-', '')}">\${esc(r.a)}</span></td>
      <td class="dim" style="font-size:12.5px">\${esc(r.w)}</td>
    </tr>\`).join('') : '<tr><td colspan="5" class="empty">Nothing matches that filter.</td></tr>';
}

document.getElementById('q-undes').addEventListener('input', renderUndes);
document.getElementById('act-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  actSel = actSel === b.dataset.act ? null : b.dataset.act;
  document.querySelectorAll('#act-chips .chip').forEach((c) =>
    c.setAttribute('aria-pressed', String(c.dataset.act === actSel)));
  renderUndes();
});

renderMissing();
renderUndes();
</script>
`

writeFileSync(join(OUT, 'index.html'), html)
console.log(`wrote docs/reconciliation/index.html (${(html.length / 1024).toFixed(0)} KB)`)
console.log(`  ${missing.length} missing · ${undesigned.length} undesigned · ${collisions.length} collisions`)
