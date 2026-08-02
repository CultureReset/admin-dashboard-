-- ============================================================================
-- OWNERSHIP + WRITE ACCESS
--
-- Required before the dashboard's editing can be turned on safely.
--
-- The problem this solves: right now nothing links a login to a business.
-- entity_owners is empty, and the dashboard tracks the claimed slug in Supabase
-- user_metadata — which the browser can write. Without the pieces below, any
-- signed-up user can point themselves at any slug and edit or delete that
-- business's data.
--
-- Run this in the Supabase SQL editor. Read it first; it is written to be
-- reviewed, not pasted blindly.
-- ============================================================================


-- 1. Who owns what -----------------------------------------------------------
-- entity_owners already exists (id, user_id, entity_id, entity_slug, role).
-- Lock it down so a user cannot simply insert themselves as an owner.

ALTER TABLE public.entity_owners ENABLE ROW LEVEL SECURITY;

-- A user may read their own ownership rows, and nothing else.
DROP POLICY IF EXISTS entity_owners_read_own ON public.entity_owners;
CREATE POLICY entity_owners_read_own ON public.entity_owners
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Deliberately NO insert/update/delete policy for regular users. Ownership is
-- granted out-of-band (service_role: an admin approval, verified invite email,
-- or phone verification). service_role bypasses RLS, so your backend can still
-- write these rows.

CREATE UNIQUE INDEX IF NOT EXISTS entity_owners_user_slug_uniq
  ON public.entity_owners (user_id, entity_slug);


-- 2. Platform admins ---------------------------------------------------------
-- Lets you open and edit any business's dashboard from the admin side.

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- An admin can see their own row (that's how the dashboard knows). Nobody can
-- add themselves — grant admin with the service key or straight from the SQL
-- editor.
DROP POLICY IF EXISTS platform_admins_read_own ON public.platform_admins;
CREATE POLICY platform_admins_read_own ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- Admins need to browse the full business list in the picker.
DROP POLICY IF EXISTS entity_admin_read ON public.entity;
-- (entity is already publicly readable; no extra policy required.)


-- 3. The access test ---------------------------------------------------------
-- One function every write policy uses: you may change a business's data if you
-- own it, or if you are a platform admin.

CREATE OR REPLACE FUNCTION public.owns_entity(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.entity_owners
      WHERE user_id = auth.uid()
        AND entity_slug = p_slug
    );
$$;

GRANT EXECUTE ON FUNCTION public.owns_entity(text) TO authenticated;


-- 4. Turn on write access, table by table ------------------------------------
-- Apply to the tables a business should be able to edit. Deliberately explicit:
-- blanket-applying this to all 305 slug tables would also open booking records,
-- waivers, customer contact rows, and AI/internal tables to client writes.
--
-- Repeat this block per table. Start with a couple, confirm the dashboard
-- behaves, then widen.

DO $$
DECLARE
  t text;
  editable text[] := ARRAY[
    'entity_hours',
    'entity_photos',
    'menu_sections',
    'menu_items',
    'entity_events',
    'entity_specials',
    'faqs',
    'entity_policies'
    -- add more table names here as you decide to expose them
  ];
BEGIN
  FOREACH t IN ARRAY editable LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN

      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      -- Public may keep reading (this is what GCR Unified relies on).
      EXECUTE format($p$
        DROP POLICY IF EXISTS %1$s_public_read ON public.%1$I;
        CREATE POLICY %1$s_public_read ON public.%1$I
          FOR SELECT USING (true);
      $p$, t);

      -- Owners may change only their own business's rows.
      EXECUTE format($p$
        DROP POLICY IF EXISTS %1$s_owner_write ON public.%1$I;
        CREATE POLICY %1$s_owner_write ON public.%1$I
          FOR ALL TO authenticated
          USING (public.owns_entity(entity_slug))
          WITH CHECK (public.owns_entity(entity_slug));
      $p$, t);

    END IF;
  END LOOP;
END $$;


-- 5. Close the doors that are currently open ---------------------------------
-- Independent of the dashboard: anon currently holds INSERT/UPDATE/DELETE on
-- every table by default, and ~46 slug tables have no RLS at all — meaning
-- anyone with the public anon key can modify them. Recommended:

-- REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public
--   REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;

-- And these two currently expose secrets/PII to the public key:
--   bookable_resources  → wifi_password, ical_export_token  (policy: USING (true))
--   song_requests       → fan_phone                          (policy: USING (true))
-- Replace their blanket public-read policies with column-limited views or
-- owner-scoped policies.


-- 6. Make yourself an admin --------------------------------------------------
-- After provisioning, find your own auth user id and insert it here. Run from
-- the SQL editor (which uses the service role, so RLS doesn't block it).
--
--   INSERT INTO public.platform_admins (user_id, note)
--   SELECT id, 'matthew' FROM auth.users WHERE email = 'you@yourdomain.com';
--
-- Then, from CyberCheck login admin, link straight into any dashboard:
--   https://<dashboard-host>/?business=<slug>
