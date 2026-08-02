-- Read-only helper for the business dashboard.
--
-- Returns every table in the database that is tied to a business slug and has
-- rows for it, as one JSON object keyed by table name. Adding a new table with
-- an entity_slug column makes it appear automatically — nothing is listed or
-- hardcoded anywhere.
--
-- SECURITY INVOKER: runs as the caller, so existing row-level security applies
-- exactly as it does today. This adds NO new data exposure. It only replaces
-- ~305 separate HTTP round trips with a single call.
--
-- Nothing existing is modified: this only adds one new function.

CREATE OR REPLACE FUNCTION public.entity_sections(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  t text;
  rows jsonb;
BEGIN
  FOR t IN
    SELECT DISTINCT col.table_name
    FROM information_schema.columns col
    JOIN pg_class c ON c.relname = col.table_name
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE col.table_schema = 'public'
      AND col.column_name = 'entity_slug'
      AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    BEGIN
      EXECUTE format(
        'SELECT jsonb_agg(x) FROM (SELECT * FROM public.%I WHERE entity_slug = $1 LIMIT 500) x',
        t
      ) INTO rows USING p_slug;

      IF rows IS NOT NULL THEN
        result := result || jsonb_build_object(t, rows);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE; -- an unreadable table must not break the whole response
    END;
  END LOOP;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.entity_sections(text) TO anon, authenticated;

-- Called from the dashboard as:
--   supabase.rpc('entity_sections', { p_slug: 'flora-bama-yacht-club' })
