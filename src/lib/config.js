// Every host this app talks to, in one place, overridable per deployment.
//
// The defaults are the live GCR stack — gcr-api-clean on Vercel and the GCR
// Supabase project behind it — so a checkout with no .env still points at the
// same API the rest of the GCR ecosystem uses. Set the VITE_* variables in
// .env.local (or in the Vercel/Netlify dashboard) to point at a local API or a
// staging project instead. See .env.example.

// `?? {}` so these modules can also be imported by a plain node script
// (scripts/check-discovery.mjs), where import.meta.env doesn't exist.
const env = import.meta.env ?? {}

/** gcr-api-clean. All read paths and the claim submission go through this. */
export const GCR_API_BASE = (
  env.VITE_GCR_API_BASE || 'https://gcr-api-clean.vercel.app'
).replace(/\/+$/, '')

/** The GCR Supabase project — the same one gcr-api-clean reads and writes. */
export const SUPABASE_URL = (
  env.VITE_SUPABASE_URL || 'https://mkepugvdlktfsossumox.supabase.co'
).replace(/\/+$/, '')

/**
 * Publishable anon key. Safe to ship in a browser bundle — it grants exactly
 * what row-level security allows and nothing more. That is only true once
 * sql/ownership_and_write_access.sql section 5 has revoked the open anon
 * INSERT/UPDATE/DELETE grants; until then this key can write.
 */
export const SUPABASE_ANON_KEY =
  env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rZXB1Z3ZkbGt0ZnNvc3N1bW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MjI0MDEsImV4cCI6MjA5NDk5ODQwMX0.27ZrHwtt0RtQvFA24w4LCH0fTKxkpvT_R1aaqvSIo3w'

/** Businesses sign in with their slug; it maps to a derived login address. */
export const LOGIN_DOMAIN = env.VITE_LOGIN_DOMAIN || 'biz.gulfcoastradar.com'
