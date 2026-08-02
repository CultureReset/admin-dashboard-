# Review of the port

What arrived in `CyberCheckDashboardEverything.html`, what was wrong with it,
and what is still missing. Written after reading all 39 files, both SQL
proposals, and the parts of `gcr-api-clean` this app depends on.

The architecture is right. Schema-driven discovery is the correct answer to a
563-table database that is still moving, and `GenericSection` + `RowEditor`
genuinely do give an unknown table a working screen. The problems below are all
wiring, not design.

---

## Fixed while landing it

### 1. Every edit on an API-supplied section wrote to a table that doesn't exist

The worst of them. `buildFullEntity()` in `gcr-api-clean/routes/gcr.js` renames
tables on the way out — `entity_hours` → `hours`, `entity_events` → `events`,
`entity_offer_fee` → `fees`, `entity_attributes` → `structured_attributes`, and
about twenty more. `EditableSection` used `section.key` directly as the table
name, so Add/Edit/Delete on Hours, Photos, Events, Specials, Reviews, Team,
Policies and the rest all pointed at tables PostgREST has never heard of.

The same rename also produced duplicate sections: the API sends `hours`, the
direct sweep independently finds `entity_hours`, and nothing collapsed them — so
a restaurant showed both "Hours" and "Entity Hours" with the same rows.

`src/lib/tableMap.js` now resolves payload key → real table, used by both the
merge (dedupe) and the write path. Unmapped keys pass straight through, so
discovery stays open-ended. `npm run check` asserts both behaviours.

### 2. Hosts and keys were hardcoded in four files

The API base, Supabase URL and anon key were literals in `gcrApi.js`,
`supabaseClient.js` and both scripts. Now `src/lib/config.js` with `VITE_*`
overrides and `.env.example`.

### 3. The admin picker bypassed the API

`BusinessPicker` queried PostgREST `entity` directly while `gcrApi.searchEntities`
sat unused. It now goes through `GET /api/gcr/entities`, so it keeps working
once the open anon grants are revoked.

### 4. The claim flow existed everywhere except in the code

`gcrApi.js` had a `searchEntities` comment referencing "the claim-your-business
flow", `index.css` still carried `.claim-screen`/`.claim-card`/`.claim-results`
styling, and the commit history lists a claim-by-slug flow — but no page shipped.
`src/pages/Claim.jsx` now searches `GET /api/gcr/entities` and posts to
`POST /api/gcr/claim`, reachable from the sign-in screen.

Worth being explicit: claiming grants nothing. It writes a `business_claims` row
with status `new`; approval happens in cybercheck-login's `admin.html` GCR Claims
panel and that is what creates the `entity_owners` row.

### 5. No `.gitignore`

`scripts/provision-accounts.mjs` writes `business-credentials.csv` — plaintext
passwords for ~4,020 businesses — into the repo root. One `git add -A` and it
would be in history. Now ignored, along with `.env` and `dist/`.

### 6. `sql/entity_sections.sql` was written but never called

The RPC that turns ~305 requests into one existed only as a proposal file.
`entityTables.js` now tries it first and falls back to the sweep when it isn't
installed, so running the SQL is the only step needed to get the speedup.

### 7. A business could only ever see the data it already had

Discovery builds sections from tables that already have rows for this slug. That
made the dashboard a viewer, not something a business could build out: a
restaurant with no menu had no Menu section and no way to make one, and a
brand-new business landed on "No sections yet" with nothing to click.

The dashboard is supposed to be modular — the business decides what they keep in
it, not whichever tables happen to be populated. `src/lib/sectionCatalog.js` +
`src/components/AddSection.jsx` add the other half: every slug table in the live
schema that this business isn't using yet, grouped and searchable. Pick one, fill
in the form `RowEditor` builds from that table's columns, save, and it becomes a
live section. Reached from a permanent **Add** tab and from the empty state.

Internal tables are held back — AI indexes, access control, bookings, payments,
customer records, SMS, audit logs, backups, and `song_requests` (which carries
`fan_phone`). Everything else is offered, including tables nobody has written any
code for, which is the same open-ended rule the rest of discovery follows.

### 8. Nothing was runnable

`scripts/check-discovery.mjs` (`npm run check`) exercises discovery, merging and
table mapping against realistic restaurant and charter payloads. No network, no
database.

---

---

## The artist module — what's done and what's left

Checked against the live `cyber check` Supabase project, not against the design
docs. Most of the module already exists: `artist_profiles` (390 rows),
`artists` (390), `songs`, `song_requests`, `shoutouts`, `artist_goals`,
`artist_goal_contributions`, `song_cooperatives`, `tip_links`, `artist_shows`,
`artist_follows`, `artist_booking_requests`, `artist_qr_codes`,
`payment_confirmations`, `email_parser_log`.

The fan-facing pages exist too, in **`gcr-unified`**: `/artist/:slug`
(`ArtistProfile.jsx` — about, songs, events, booking, reviews, gallery) and
`/artist/:slug/live` (`ArtistLive.jsx` — the money layer: request, shoutout,
tip, with a live queue).

**The gap is pricing.** Nothing in the database says what a song costs, what a
shoutout costs, or what the tip buttons should be. `songs` has no price column.
`artist_profiles` has one `default_min_request_amount`, and `ArtistLive.jsx`
turns it into buttons with `[min, min*2, min*4, min*10]` — computed in
JavaScript, unchangeable by the artist. Shoutout tiers and crowdfund amounts
exist only in the HTML mockups.

`sql/artist_module.sql` (never run, like the others) closes it:

- `songs.price`, `original_artist`, `note`, `is_available`, `is_featured`
- `artist_profiles.custom_song_price`, `shoutout_price`, `min_tip`,
  `requests_open`, `crowdfund_enabled`, `request_note`, `payment_instructions`
- **`artist_price_tiers`** — one table behind every money button, keyed by
  `kind` (request / shoutout / tip / crowdfund / addon). A new kind of paid
  thing is a row, not a migration.
- `tip_links` gains `label`, `sort_order`, `active` and becomes *the* payment
  method table
- `entity_slug` added to `song_cooperatives`, `artist_goal_contributions` and
  `artist_qr_codes`, with backfills — without it the dashboard can't see them
  and RLS can't scope them
- owner-scoped RLS split two ways: the artist owns their catalogue and prices;
  fan-submitted rows are insert-by-anyone, manage-by-owner, with **no public
  SELECT** because they carry `fan_phone`, `tourist_phone` and
  `contributor_phone`

### Still to do on the artist side

1. **`artist_profiles` has four columns for two handles** — `cashtag`, `venmo`,
   `cashapp_handle`, `venmo_handle`. Nothing says which wins, and a page reading
   the wrong pair silently shows no payment button. The SQL backfills whichever
   is populated into `tip_links` and leaves the old columns alone; pick a
   winner and drop the rest once the fan pages read `tip_links`.
2. **`gcr-unified` still hardcodes its amounts.** `ArtistLive.jsx` needs to read
   `artist_price_tiers` and `tip_links` instead of computing multiples of
   `default_min`. That's the change that makes the prices the artist sets
   actually reach fans — this repo can't do it alone.
3. **Two crowdfund models coexist** — `artist_goals` (goal_type, target_amount)
   and `song_cooperatives` (song_title, target_amount). Both are rendered here,
   but one of them should win before either gets real data.
4. **No live-status control.** The mockups show "Live Now / On Break / Requests
   Closed"; `requests_open` covers the switch, but nothing surfaces it yet.
5. **The payment parser is unbuilt.** `payment_confirmations` and
   `email_parser_log` exist and `song_requests.req_code` is the join key, but
   nothing writes the match. Until then every request stays `pending_payment`
   and the artist confirms by eye.

---

## Still open — fix before anyone signs in

### `entity_owners.user_id` now holds three different kinds of id

This is the one that will bite hardest.

- `gcr-api-clean/routes/platform.js` inserts `user_id: req.siteId` — a CyberCheck
  `businesses.id`. Its own `ownedSlug()` helper documents the problem: *"holds
  TWO conventions: platform signups store the businesses.id, admin link-user
  stores the users.id"*.
- `scripts/provision-accounts.mjs` inserts a **GCR Supabase `auth.users.id`** —
  a third id space.
- `sql/ownership_and_write_access.sql` then enforces `user_id = auth.uid()` and
  `owns_entity()` reads the same column.

So every ownership row written by the existing platform will silently fail the
new policy — those businesses get "No business linked" — and the proposed
`UNIQUE (user_id, entity_slug)` index is being applied across mixed id spaces.

Pick one convention, or add a discriminator column and make `owns_entity()`
match on it, **before** running the SQL.

### A business cannot edit its own profile

`discoverSections` treats scalars as profile fields and drops them, and nothing
picks them up afterwards. Name, phone, description, hero image, website, booking
and reservation URLs, social links, price range — the fields a business actually
wants to change — are not editable anywhere in this app. Needs a Profile section
that writes to `entity` filtered by `slug`.

### Nested rows are read-only

`menu_sections` rows arrive with their `items` nested. `EditableSection` edits
the section row; the items have no editor. Same for `drink_items`,
`happy_hour_items`, `entity_section_items`, `offering_prices` and `price_tiers`.
Adding a dish to a menu — the single most common edit a restaurant makes — is
not possible. `RowEditor` already builds itself from any table's columns, so
this is a matter of letting a nested list open one.

### Writes will fail on most sections

`ownership_and_write_access.sql` opens 8 tables. Every other discovered section
renders an Add button that fails at save time with "You don't have permission to
change this yet." Either widen the list deliberately, or have the app check
writability and present those sections as read-only instead of failing after the
user has typed.

---

## Still open — important

**The RPC is named after an existing table.** `sql/entity_sections.sql` creates
`FUNCTION public.entity_sections(text)` while `entity_sections` is already a core
table. Postgres allows it and PostgREST routes `/rpc/entity_sections` correctly,
but it will confuse every person who reads the schema. Rename it — the SQL has
never been run, so this is free right now.

**Anon can still write.** Until section 5 of the SQL executes the `REVOKE`, the
anon key compiled into this bundle has INSERT/UPDATE/DELETE on every table, and
~46 slug tables have RLS off entirely. Every other guarantee in the security
model is decorative until that runs.

**Two tables leak secrets, and this app will now render them.** `bookable_resources`
has a public-read policy exposing `wifi_password` and `ical_export_token`;
`song_requests` exposes `fan_phone`. `GenericSection` shows unrecognised columns
as chips specifically so nothing is silently dropped — which means it will
happily print those on screen.

**An owner of two businesses only ever sees one.** `AuthContext` uses `.limit(1)`
on `entity_owners` and takes `[0]`. Multi-property owners (marinas, condo
complexes, restaurant groups — the API has a whole `parent_entity_slug` /
`is_hub` concept for exactly this) need the same picker admins get.

**A failed schema read disables all editing, silently.** `getColumns()` reads a
module-level cache populated by `fetchEntityTables()`. `Dashboard` swallows
discovery errors on purpose, so if the OpenAPI request fails every editor just
says "This table has no editable fields" with no indication why.

**Row limits truncate without saying so.** The sweep caps at 200 rows per table
and the RPC at 500. A vacation-rental complex with 266 photos loses rows on the
sweep path with no warning. The API path already handles this correctly.

**No image upload.** Photos are URL-only. `gcr-api-clean` has
`POST /api/admin/gcr/upload-image` into the `entity-media` bucket, but it's
admin-authed with an Express JWT and this app carries a Supabase JWT. Either
upload straight to the `entity-media` bucket via supabase-js, or add an
owner-scoped upload endpoint.

**No error boundary, no routing, no CI.** A render error blanks the page.
`?business=` is read once at mount. Section state is lost on back.

---

## Not built at all

Confirmed by reading the code, not just the doc:

- **Composio connections** (HubSpot, Salesforce, Facebook, Gmail) — no trace.
- **The modular-app framework** — installable apps and the third-party SDK. There
  is no app concept anywhere in this codebase.
- **AI data routing** — describing a change in plain words and having it land in
  the right table.
- **`entity_modules` is ignored.** The API already sends `modules` and
  `module_keys` per entity and the dashboard never reads them. Module-based
  gating of which sections a business sees is available today and unused — this
  is the cheapest of the four to pick up, and it's the natural seam the app
  framework would plug into later.

---

## One thing to expect once businesses see this

The reconciliation counts 19 concepts living under two names, **6 of which exist
as two real tables at once**. Because discovery is data-driven, both tables will
be found and both will render — two sections showing conflicting data for the
same thing, and writes landing in whichever one the user happened to open. That
is invisible in a hand-built dashboard and unavoidable in this one. Resolve those
6 before rollout.

---

## Suggested order

1. Settle the `entity_owners.user_id` convention.
2. Run `ownership_and_write_access.sql` (with the rename in §"the RPC is named
   after an existing table" applied to the other file), then provision with
   `--limit=5` and confirm one real business can sign in and save.
3. Widen the editable-table list — the Add catalog now offers ~200 tables and
   only 8 of them accept writes, so most of what a business picks will fail at
   save time until the policy list grows.
4. Run the `REVOKE` in section 5, and fix the two leaking policies.
5. Add the Profile section and nested-row editing.
6. Resolve the 6 duplicate-table collisions.
7. Then the app framework, then Composio, then AI routing.
