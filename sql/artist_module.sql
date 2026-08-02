-- ============================================================================
-- ARTIST MODULE — make the money layer editable
--
-- NEVER RUN. This is a proposal, like the other files in sql/. Read it first.
--
-- Most of the artist module already exists in the GCR database:
--
--   artists                    390 rows   directory record
--   artist_profiles            390 rows   entity_slug, handles, default_min_request_amount
--   songs                                 entity_slug, title, sort_order
--   song_requests                         entity_slug, req_code, amount, payment_status
--   shoutouts                             entity_slug, recipient, message, tip_amount
--   artist_goals                          entity_slug, target_amount, current_amount
--   artist_goal_contributions             goal_id, amount, req_code        (no entity_slug)
--   song_cooperatives                     song_title, target_amount        (no entity_slug)
--   tip_links                             entity_slug, platform, handle, deep_link_prefix
--   artist_shows / artist_follows / artist_booking_requests / payment_confirmations
--
-- What does NOT exist is the part the artist actually needs to control: what
-- anything costs. Today a song has no price, a shoutout has no price, the tip
-- buttons on the live page are computed as [min, min*2, min*4, min*10] in
-- JavaScript, and a crowdfund target can only be typed straight into a goal
-- row. None of that is editable by the artist.
--
-- This file adds the missing money layer and nothing else. It is additive: no
-- column is dropped, no data is rewritten, no existing behaviour changes until
-- something starts reading the new columns.
-- ============================================================================


-- 1. Per-song pricing -------------------------------------------------------
-- `songs` is the artist's own setlist. Give each entry a price so the request
-- form can charge per song instead of one flat minimum.

ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS price          numeric;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS original_artist text;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS note           text;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS is_available   boolean NOT NULL DEFAULT true;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS is_featured    boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.songs.price IS
  'What this song costs to request. NULL falls back to artist_profiles.default_min_request_amount.';


-- 2. Artist-level prices and switches ---------------------------------------
-- artist_profiles already has default_min_request_amount, request_enabled and
-- shoutout_enabled. These are the rest of what the fan pages need.

ALTER TABLE public.artist_profiles ADD COLUMN IF NOT EXISTS custom_song_price   numeric;
ALTER TABLE public.artist_profiles ADD COLUMN IF NOT EXISTS shoutout_price      numeric;
ALTER TABLE public.artist_profiles ADD COLUMN IF NOT EXISTS min_tip             numeric;
ALTER TABLE public.artist_profiles ADD COLUMN IF NOT EXISTS tip_enabled         boolean NOT NULL DEFAULT true;
ALTER TABLE public.artist_profiles ADD COLUMN IF NOT EXISTS crowdfund_enabled   boolean NOT NULL DEFAULT false;
ALTER TABLE public.artist_profiles ADD COLUMN IF NOT EXISTS requests_open       boolean NOT NULL DEFAULT true;
ALTER TABLE public.artist_profiles ADD COLUMN IF NOT EXISTS request_note        text;
ALTER TABLE public.artist_profiles ADD COLUMN IF NOT EXISTS payment_instructions text;

COMMENT ON COLUMN public.artist_profiles.custom_song_price IS
  'Price for a song the fan types in that is not on the setlist.';
COMMENT ON COLUMN public.artist_profiles.requests_open IS
  'Master switch the artist flips between sets. Distinct from request_enabled, which is whether the feature exists at all.';


-- 3. The price list — one table behind every money button --------------------
-- Shoutout tiers ("Birthday $10", "Bachelorette $15", "Sponsor $25"), tip
-- presets ($5/$10/$20/$50), crowdfund contribution presets, and request
-- add-ons all have the same shape: a label and an amount the artist sets.
-- One table for all of them, so adding a new kind of paid thing is a row,
-- not a schema change or a deploy.

CREATE TABLE IF NOT EXISTS public.artist_price_tiers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_slug  text NOT NULL,
  kind         text NOT NULL,            -- shoutout | tip | crowdfund | request | addon
  label        text NOT NULL,            -- "Birthday shoutout", "$20", "Buy the band a round"
  description  text,
  amount       numeric,                  -- NULL = fan enters their own amount
  is_minimum   boolean NOT NULL DEFAULT false,  -- "$25+" rather than exactly $25
  sort_order   integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artist_price_tiers_slug_kind
  ON public.artist_price_tiers (entity_slug, kind, sort_order);

COMMENT ON TABLE public.artist_price_tiers IS
  'Every price the artist can set, in one place. The fan pages read this instead of hardcoding amounts.';


-- 4. Payment handles ---------------------------------------------------------
-- tip_links already models this correctly (platform, handle, deep_link_prefix),
-- it just lacks ordering and an on/off switch. Use it as THE payment method
-- table rather than adding another one.

ALTER TABLE public.tip_links ADD COLUMN IF NOT EXISTS label       text;
ALTER TABLE public.tip_links ADD COLUMN IF NOT EXISTS sort_order  integer NOT NULL DEFAULT 0;
ALTER TABLE public.tip_links ADD COLUMN IF NOT EXISTS active      boolean NOT NULL DEFAULT true;

-- artist_profiles carries FOUR columns for two handles: cashtag, venmo,
-- cashapp_handle, venmo_handle. Nothing says which one wins, and a page that
-- reads the wrong pair silently shows no payment button. Backfill whichever is
-- populated into tip_links, then read tip_links everywhere.
--
-- Review the result before deleting anything — the old columns stay for now.
INSERT INTO public.tip_links (entity_slug, platform, handle, deep_link_prefix, label, sort_order)
SELECT p.entity_slug, 'cashapp',
       COALESCE(NULLIF(p.cashapp_handle,''), NULLIF(p.cashtag,'')),
       'https://cash.app/$', 'Cash App', 1
FROM public.artist_profiles p
WHERE p.entity_slug IS NOT NULL
  AND COALESCE(NULLIF(p.cashapp_handle,''), NULLIF(p.cashtag,'')) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.tip_links t
                  WHERE t.entity_slug = p.entity_slug AND t.platform = 'cashapp')
ON CONFLICT DO NOTHING;

INSERT INTO public.tip_links (entity_slug, platform, handle, deep_link_prefix, label, sort_order)
SELECT p.entity_slug, 'venmo',
       COALESCE(NULLIF(p.venmo_handle,''), NULLIF(p.venmo,'')),
       'https://venmo.com/', 'Venmo', 2
FROM public.artist_profiles p
WHERE p.entity_slug IS NOT NULL
  AND COALESCE(NULLIF(p.venmo_handle,''), NULLIF(p.venmo,'')) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.tip_links t
                  WHERE t.entity_slug = p.entity_slug AND t.platform = 'venmo')
ON CONFLICT DO NOTHING;


-- 5. Crowdfunding -----------------------------------------------------------
-- artist_goals covers "tonight's road fund". song_cooperatives covers "fans
-- pool money for one song" — but it has no entity_slug, so the dashboard can't
-- see it, RLS can't scope it, and the artist can't edit it.

ALTER TABLE public.song_cooperatives         ADD COLUMN IF NOT EXISTS entity_slug text;
ALTER TABLE public.artist_goal_contributions ADD COLUMN IF NOT EXISTS entity_slug text;
ALTER TABLE public.artist_qr_codes           ADD COLUMN IF NOT EXISTS entity_slug text;

-- Backfill from the artist they already point at.
UPDATE public.song_cooperatives sc
   SET entity_slug = p.entity_slug
  FROM public.artist_profiles p
 WHERE sc.entity_slug IS NULL AND p.id = sc.artist_id AND p.entity_slug IS NOT NULL;

UPDATE public.artist_goal_contributions c
   SET entity_slug = g.entity_slug
  FROM public.artist_goals g
 WHERE c.entity_slug IS NULL AND g.id = c.goal_id AND g.entity_slug IS NOT NULL;

UPDATE public.artist_qr_codes q
   SET entity_slug = p.entity_slug
  FROM public.artist_profiles p
 WHERE q.entity_slug IS NULL AND p.id = q.artist_id AND p.entity_slug IS NOT NULL;

-- Let the artist name a crowdfund target without inventing a goal row first.
ALTER TABLE public.song_cooperatives ADD COLUMN IF NOT EXISTS min_contribution numeric;
ALTER TABLE public.song_cooperatives ADD COLUMN IF NOT EXISTS description      text;


-- 6. Write access ------------------------------------------------------------
-- Same owner-scoped pattern as ownership_and_write_access.sql, applied to the
-- artist tables. Without this the dashboard renders artist sections and every
-- save fails with a permissions error.
--
-- Deliberately split: the artist edits their own catalogue and prices, but
-- fan-submitted rows (requests, shoutouts, contributions, follows, booking
-- leads) are insert-by-anyone / update-by-owner, because the fan writing them
-- is not signed in.

DO $$
DECLARE
  t text;
  -- The artist's own content and settings: full control.
  owned text[] := ARRAY[
    'artist_profiles',
    'songs',
    'artist_price_tiers',
    'tip_links',
    'artist_goals',
    'song_cooperatives',
    'artist_shows',
    'artist_qr_codes'
  ];
  -- Rows fans create: the artist reads and manages them but does not author them.
  inbox text[] := ARRAY[
    'song_requests',
    'shoutouts',
    'artist_goal_contributions',
    'artist_follows',
    'artist_booking_requests'
  ];
BEGIN
  FOREACH t IN ARRAY owned LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format($p$
        DROP POLICY IF EXISTS %1$s_public_read ON public.%1$I;
        CREATE POLICY %1$s_public_read ON public.%1$I FOR SELECT USING (true);
      $p$, t);
      EXECUTE format($p$
        DROP POLICY IF EXISTS %1$s_owner_write ON public.%1$I;
        CREATE POLICY %1$s_owner_write ON public.%1$I
          FOR ALL TO authenticated
          USING (public.owns_entity(entity_slug))
          WITH CHECK (public.owns_entity(entity_slug));
      $p$, t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY inbox LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- A fan submitting a request is anonymous.
      EXECUTE format($p$
        DROP POLICY IF EXISTS %1$s_fan_insert ON public.%1$I;
        CREATE POLICY %1$s_fan_insert ON public.%1$I
          FOR INSERT TO anon, authenticated WITH CHECK (true);
      $p$, t);
      -- Only the artist reads and manages what came in.
      EXECUTE format($p$
        DROP POLICY IF EXISTS %1$s_owner_manage ON public.%1$I;
        CREATE POLICY %1$s_owner_manage ON public.%1$I
          FOR ALL TO authenticated
          USING (public.owns_entity(entity_slug))
          WITH CHECK (public.owns_entity(entity_slug));
      $p$, t);
    END IF;
  END LOOP;
END $$;

-- NOTE: song_requests.fan_phone, shoutouts.requester_name,
-- artist_follows.tourist_phone and artist_goal_contributions.contributor_phone
-- are all fan PII. The policies above deliberately give them NO public SELECT.
-- If a fan page needs to show a live queue, expose a view with the phone
-- columns dropped rather than opening the table.


-- 7. Seed the price list for one artist to try it -----------------------------
-- Replace the slug and run just this block to see the dashboard pick it up.
--
--   INSERT INTO public.artist_price_tiers (entity_slug, kind, label, amount, sort_order) VALUES
--     ('your-artist-slug','tip','$5',5,1),
--     ('your-artist-slug','tip','$10',10,2),
--     ('your-artist-slug','tip','$20',20,3),
--     ('your-artist-slug','tip','$50',50,4),
--     ('your-artist-slug','shoutout','Birthday',10,1),
--     ('your-artist-slug','shoutout','Bachelorette',15,2),
--     ('your-artist-slug','shoutout','Anniversary',15,3),
--     ('your-artist-slug','crowdfund','$5',5,1),
--     ('your-artist-slug','crowdfund','$10',10,2),
--     ('your-artist-slug','crowdfund','Custom',NULL,3);
--
--   INSERT INTO public.artist_price_tiers (entity_slug, kind, label, amount, is_minimum, sort_order)
--   VALUES ('your-artist-slug','shoutout','Business / sponsor',25,true,4);
