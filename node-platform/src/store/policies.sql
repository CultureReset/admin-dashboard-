-- Row level security, applied by loop rather than by hand.
--
-- Any table carrying person_id gets enabled + forced RLS and the isolation
-- policy automatically. You cannot add a person-scoped table and forget this,
-- which is the failure mode that quietly turns a multi-tenant system into a
-- single-tenant one.

do $$
declare t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'person_id'
    where c.relkind = 'r' and n.nspname = 'public' and a.attnum > 0
      -- device is household-visible; it gets its own policy below
      and c.relname <> 'device'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('drop policy if exists person_isolation on public.%I', t);

    -- A row is visible when it belongs to the current person, or when it is
    -- explicitly household-scoped and the reader is in that household.
    -- current_setting(..., true) returns null rather than raising when unset,
    -- so a query with no person context sees nothing instead of erroring.
    if exists (
      select 1 from pg_attribute
      where attrelid = format('public.%I', t)::regclass and attname = 'scope'
    ) then
      execute format($f$
        create policy person_isolation on public.%I
          using (
            person_id = nullif(current_setting('app.person_id', true), '')::uuid
            or (scope = 'household'
                and household_id = nullif(current_setting('app.household_id', true), '')::uuid)
          )
          with check (
            person_id = nullif(current_setting('app.person_id', true), '')::uuid
          )
      $f$, t);
    else
      execute format($f$
        create policy person_isolation on public.%I
          using  (person_id = nullif(current_setting('app.person_id', true), '')::uuid)
          with check (person_id = nullif(current_setting('app.person_id', true), '')::uuid)
      $f$, t);
    end if;

    execute format('grant select, insert, update, delete on public.%I to app_runtime', t);
  end loop;
end $$;

-- Tables without person_id are household-level reference data: readable by any
-- member of the household, never writable from the capability layer.
alter table household enable row level security;
alter table household force  row level security;
drop policy if exists household_read on household;
create policy household_read on household
  using (id = nullif(current_setting('app.household_id', true), '')::uuid);
grant select on household to app_runtime;

alter table person enable row level security;
alter table person force  row level security;
drop policy if exists person_household on person;
create policy person_household on person
  using (household_id = nullif(current_setting('app.household_id', true), '')::uuid);
grant select on person to app_runtime;

alter table device enable row level security;
alter table device force  row level security;
drop policy if exists device_scope on device;
create policy device_scope on device
  using (household_id = nullif(current_setting('app.household_id', true), '')::uuid);
grant select on device to app_runtime;

grant usage on all sequences in schema public to app_runtime;
