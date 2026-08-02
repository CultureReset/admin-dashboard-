import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'

// Same GCR Supabase project already backing gcr-api-clean and the rest of
// the GCR ecosystem — this platform's accounts and data live in the same
// place, not a separate auth store. Host and key come from config.js so a
// deployment can point elsewhere without editing source.
export { SUPABASE_URL, SUPABASE_ANON_KEY }

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
