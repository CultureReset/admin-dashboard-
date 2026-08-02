# Business dashboard

Every business gets sections built from its own data. Nothing is hardcoded per
business or per industry.

A business is identified by its **slug** (`flora-bama-yacht-club`). Everything
about it lives in tables carrying an `entity_slug` column. The dashboard has no
list of features: it asks the database what tables exist, pulls the rows
belonging to that slug, and turns every table that has data into a section. A
restaurant ends up with Menu, Hours, Happy Hour. A charter ends up with Trips,
Species, Meeting Points, Weather Rules. Same code, different data.

Add a table to the database and it appears in every business that has data in
it. Drop it and the section disappears. No deploy, no code change.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
npm run check    # discovery + table-mapping checks, no network needed
```

Deploy `dist/` anywhere static. Copy `.env.example` to `.env.local` only if you
need to point at something other than the live GCR stack.

## Where the data comes from

Two sources, merged:

| Source | Covers |
|---|---|
| `GET /api/gcr/entity/:slug` on **gcr-api-clean** | The ~60 domains the API knows about, pre-joined — menu sections with their items nested, offerings with their price tiers |
| Direct PostgREST sweep of the GCR Supabase | Everything else — any table with an `entity_slug` column |

Where both carry the same table, the API version wins because it arrives better
shaped.

Everything else this app talks to also goes through gcr-api-clean:

| What | Endpoint |
|---|---|
| Load a business | `GET /api/gcr/entity/:slug` |
| Admin business picker, claim search | `GET /api/gcr/entities?search=` |
| Submit a claim | `POST /api/gcr/claim` |

Hosts live in `src/lib/config.js`, overridable with `VITE_*` variables.

### The API renames tables

`buildFullEntity()` in gcr-api-clean reshapes the database before sending it —
`entity_hours` arrives as `hours`, `entity_offer_fee` as `fees`. `src/lib/tableMap.js`
maps those names back, which is what lets an API-supplied section be edited (the
write has to name a real table) and what stops a swept table from appearing a
second time next to its renamed twin. Anything not in the map is assumed to
already be a real table name, so a table added tomorrow still works untouched.

## The files that matter

**Engine — `src/lib/`**

| File | What it does |
|---|---|
| `schemaDiscovery.js` | Reads the live PostgREST OpenAPI spec every load. Finds every table with an `entity_slug` column, and each table's columns — which is how edit forms build themselves. |
| `entityTables.js` | Sweeps those tables for one slug. Tries the `entity_sections` RPC first (one call); falls back to 12-at-a-time streaming requests when it isn't installed. |
| `discoverSections.js` | Turns raw results into sections. Merges the API payload with the swept tables, labels and icons them. |
| `tableMap.js` | API payload key ↔ real table name. |
| `gcrApi.js` | The three gcr-api-clean calls: entity, search, claim. |
| `writeEntityData.js` | **Every write goes through here.** Forces the business's own slug onto inserts; filters updates and deletes by slug as well as row id. |
| `AuthContext.jsx` | Sign in, session, access. Resolves which business you are from `entity_owners`, admin status from `platform_admins` — both server-side. |
| `config.js` | API host, Supabase host and key, login domain. |

**Screens — `src/pages/`** — `Login`, `Claim`, `Dashboard`, `BusinessPicker` (admin only).

**Layout — `src/components/`** — `TopBar`, `BottomNav` (one tab per discovered
section; mobile-first, no sidebar), `MainContent`, `RowEditor` (builds a form
from a table's columns).

**Sections — `src/sections/`** — `GenericSection` renders *any* table by
inspecting the shape of its rows. `registry.jsx` maps a handful of purpose-built
renderers; it does **not** define which sections exist — discovery does.

## Access

1. `sql/ownership_and_write_access.sql` — **required before editing works.**
   Locks `entity_owners`, creates `platform_admins` + `is_platform_admin()`,
   creates `owns_entity(slug)`, and enables owner-scoped write policies on 8
   starter tables while keeping public read intact.
2. `sql/entity_sections.sql` — optional. One read-only `SECURITY INVOKER`
   function returning all of a slug's data in a single call instead of ~305
   requests. `entityTables.js` uses it automatically when present.

**Neither has been run.** Both are proposals — read them before executing.

Provision logins once the SQL is in place:

```bash
SUPABASE_SERVICE_KEY=<service_role key> node scripts/provision-accounts.mjs --dry-run --limit=5
SUPABASE_SERVICE_KEY=<service_role key> node scripts/provision-accounts.mjs
```

Credentials land in `business-credentials.csv`, which is gitignored and should
be treated as secret.

**Admin deep link** — from CyberCheck admin, link each business row to
`https://<dashboard-host>/?business=<slug>`. That opens that business's
dashboard with an "Admin view" banner. With no `?business=`, admins land on the
searchable picker.

## Claims

A business without a login uses **Claim your business** on the sign-in screen.
That searches `GET /api/gcr/entities` and posts to `POST /api/gcr/claim`, which
writes a `business_claims` row with status `new`. It grants nothing on its own —
an admin reviews it in cybercheck-login's `admin.html` GCR Claims panel
(`GET /api/admin/gcr/claims`, `PATCH /api/admin/gcr/claims/:id`), and approving
is what creates the account and the `entity_owners` row.

## Status

**Verified:** builds clean; `npm run check` passes; section discovery and table
mapping tested against realistic restaurant and charter payloads.

**Never run:** this app has not been opened in a browser against live data, has
not authenticated against Supabase, and has not saved an edit. Treat every
runtime path as unproven until it's deployed.

`docs/everything.html` is the full record — the architecture write-up, the
extracted product spec, the module-source analysis, and the reconciliation of
the 244-table design against the 563-table live database. Open it in a browser;
it needs no server and no network.

`docs/PORT_REVIEW.md` lists what this port is missing and what to fix first.
