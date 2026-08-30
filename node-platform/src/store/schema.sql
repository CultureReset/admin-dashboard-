-- Open Glasses node schema.
--
-- Two rules hold everywhere in this file, and check-rls.ts fails the build if
-- either is broken:
--   1. every person-scoped table has a person_id column
--   2. every such table has row level security ENABLED and FORCED
--
-- FORCE matters: without it the table owner bypasses its own policies, and the
-- owner is exactly who the server connects as.

-- gen_random_uuid() is core since Postgres 13; no pgcrypto needed.

-- The runtime role. Owns nothing, creates nothing, and is subject to RLS.
-- Superusers bypass RLS entirely, so the server must never query as one.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin;
  end if;
end $$;

create table if not exists household (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists person (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  handle        text not null unique,
  display_name  text not null,
  -- Handle to this person's key-encryption key. Destroying the KEK is what
  -- makes deletion reach backups; the key material itself never lives here.
  kek_handle    text not null,
  created_at    timestamptz not null default now()
);

create table if not exists device (
  id            text primary key,
  person_id     uuid references person(id) on delete cascade,  -- null = shared device
  household_id  uuid not null references household(id) on delete cascade,
  kind          text not null,
  -- Stands in for real device attestation. A production node would verify a
  -- key in the module's secure element rather than compare a string.
  device_key    text not null unique,
  capabilities  jsonb not null default '{}'::jsonb,
  paired_at     timestamptz not null default now(),
  last_seen_at  timestamptz
);

-- The core datatype. Everything a device captures becomes one of these.
create table if not exists observation (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references person(id) on delete cascade,
  household_id  uuid not null references household(id) on delete cascade,
  scope         text not null default 'person' check (scope in ('person','household')),
  device_id     text,
  captured_at   timestamptz not null default now(),
  received_at   timestamptz not null default now(),

  kind          text not null check (kind in ('image','audio','text','sensor','composite')),
  media_ref     text,
  media_sha256  text,
  transcript    text,
  description   text,

  location_lat  double precision,
  location_lon  double precision,
  location_acc_m real,

  -- Which models produced the derived fields, so a better model can re-run later
  -- and a wrong answer is traceable to what said it.
  derived_by    jsonb not null default '{}'::jsonb,
  confidence    real,

  -- Policy travels with the row. Tightening settings tomorrow must not
  -- retroactively change what was promised when this was captured.
  policy        text not null default 'node'
                check (policy in ('local','node','private_cloud','external')),
  retain_until  timestamptz,
  redactions    text[] not null default '{}',

  request_id    uuid
);

create table if not exists entity (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references person(id) on delete cascade,
  household_id  uuid not null references household(id) on delete cascade,
  scope         text not null default 'person' check (scope in ('person','household')),
  kind          text not null,
  name          text not null,
  attrs         jsonb not null default '{}'::jsonb,
  observation_id uuid references observation(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists list_item (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references person(id) on delete cascade,
  household_id  uuid not null references household(id) on delete cascade,
  scope         text not null default 'person' check (scope in ('person','household')),
  list_name     text not null,
  title         text not null,
  note          text,
  observation_id uuid references observation(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Per (app, person) private storage. Two people installing the same app get
-- two isolated namespaces.
create table if not exists app_kv (
  person_id     uuid not null references person(id) on delete cascade,
  household_id  uuid not null references household(id) on delete cascade,
  app_id        text not null,
  key           text not null,
  value         jsonb not null,
  updated_at    timestamptz not null default now(),
  primary key (person_id, app_id, key)
);

-- The receipt. Written in the same transaction as the effect it records.
create table if not exists audit (
  id            bigserial primary key,
  person_id     uuid not null references person(id) on delete cascade,
  household_id  uuid not null references household(id) on delete cascade,
  app_id        text not null,
  capability    text not null,
  destination   text not null default 'node',
  redactions    text[] not null default '{}',
  ok            boolean not null,
  detail        text,
  at            timestamptz not null default now()
);

create index if not exists observation_person_time on observation (person_id, captured_at desc);
create index if not exists list_item_person_list  on list_item (person_id, list_name);
create index if not exists audit_person_time      on audit (person_id, at desc);
