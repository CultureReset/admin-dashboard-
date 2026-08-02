import { createClient } from '@supabase/supabase-js'

// Same GCR Supabase project already backing gcr-api-clean and the rest of
// the GCR ecosystem — this platform's accounts and data live in the same
// place, not a separate auth store.
export const SUPABASE_URL = 'https://mkepugvdlktfsossumox.supabase.co'
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rZXB1Z3ZkbGt0ZnNvc3N1bW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MjI0MDEsImV4cCI6MjA5NDk5ODQwMX0.27ZrHwtt0RtQvFA24w4LCH0fTKxkpvT_R1aaqvSIo3w'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
