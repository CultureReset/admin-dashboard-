import { supabase } from './supabaseClient'

// Every write in the dashboard goes through this one module, so scoping and
// permission handling live in a single place.
//
// Rows are always written with the signed-in business's own slug, and updates
// and deletes are always filtered by that slug as well as the row id — so even
// a tampered id can't reach another business's row. The database must still
// enforce this independently via row-level security; this is the client half.

function tidy(values) {
  const out = {}
  for (const [k, v] of Object.entries(values)) {
    if (v === '') out[k] = null // empty input means "no value", not empty string
    else out[k] = v
  }
  return out
}

function describe(error) {
  const msg = error?.message || 'Write failed'
  // PostgREST reports an RLS refusal as a permissions error; make it readable.
  if (/row-level security|permission denied|violates/i.test(msg)) {
    return "You don't have permission to change this yet."
  }
  return msg
}

export async function createRow(table, slug, values) {
  const { data, error } = await supabase
    .from(table)
    .insert({ ...tidy(values), entity_slug: slug })
    .select()
  if (error) throw new Error(describe(error))
  return data?.[0]
}

export async function updateRow(table, slug, id, values) {
  const { data, error } = await supabase
    .from(table)
    .update(tidy(values))
    .eq('id', id)
    .eq('entity_slug', slug) // never reachable outside this business
    .select()
  if (error) throw new Error(describe(error))
  if (!data?.length) throw new Error('Nothing was updated — check permissions.')
  return data[0]
}

export async function deleteRow(table, slug, id) {
  const { error, count } = await supabase
    .from(table)
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('entity_slug', slug)
  if (error) throw new Error(describe(error))
  if (!count) throw new Error('Nothing was deleted — check permissions.')
}
