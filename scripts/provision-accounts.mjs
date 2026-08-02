#!/usr/bin/env node
/**
 * Create a dashboard account for every business in the database.
 *
 * For each active entity this:
 *   1. creates a Supabase Auth user (login name is the business slug)
 *   2. links that user to the business in entity_owners  ← real ownership
 *   3. writes the credentials to a CSV you can hand out
 *
 * Ownership recorded here is server-side and cannot be changed from a browser,
 * which is what makes editing safe to switch on.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=<service_role key> node scripts/provision-accounts.mjs --dry-run
 *   SUPABASE_SERVICE_KEY=<service_role key> node scripts/provision-accounts.mjs
 *
 * Flags:
 *   --dry-run          show what would happen, create nothing
 *   --limit=N          only process the first N businesses (test with --limit=5)
 *   --domain=example   login address domain (default: biz.gulfcoastradar.com)
 *   --shared-password  give every account the same password (NOT recommended)
 *
 * Safe to re-run: businesses that already have an account are skipped.
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { writeFileSync, appendFileSync, existsSync } from 'node:fs'

const SUPABASE_URL = 'https://mkepugvdlktfsossumox.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_KEY (service_role key, from Supabase → Settings → API).')
  process.exit(1)
}

const args = process.argv.slice(2)
const flag = (name) => args.some((a) => a === `--${name}`)
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : fallback
}

const DRY_RUN = flag('dry-run')
const LIMIT = parseInt(value('limit', '0'), 10)
const DOMAIN = value('domain', 'biz.gulfcoastradar.com')
const SHARED = flag('shared-password')
const SHARED_PASSWORD = 'GulfCoast2026!'
const OUT = 'business-credentials.csv'
const CONCURRENCY = 5

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Login address for a business. The slug is what they actually type. */
const loginEmail = (slug) => `${slug}@${DOMAIN}`

/** Readable but not guessable: e.g. "harbor-7Q4M-tide" */
function makePassword() {
  if (SHARED) return SHARED_PASSWORD
  const words = ['tide', 'harbor', 'coast', 'dune', 'reef', 'shore', 'inlet', 'cove']
  const w1 = words[randomBytes(1)[0] % words.length]
  const w2 = words[randomBytes(1)[0] % words.length]
  const mid = randomBytes(2).toString('hex').toUpperCase()
  return `${w1}-${mid}-${w2}`
}

async function mapLimit(items, limit, worker) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await worker(items[i++])
    })
  )
}

async function main() {
  console.log(`\n${DRY_RUN ? 'DRY RUN — nothing will be created' : 'Provisioning accounts'}`)
  console.log(`Login domain: @${DOMAIN}`)
  console.log(SHARED ? 'Passwords: SHARED (not recommended)\n' : 'Passwords: unique per business\n')

  // Pull every active business.
  const businesses = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('entity')
      .select('id, slug, name, email')
      .eq('is_active', true)
      .order('slug')
      .range(from, from + PAGE - 1)
    if (error) throw error
    businesses.push(...data)
    if (data.length < PAGE) break
  }

  const targets = LIMIT ? businesses.slice(0, LIMIT) : businesses
  console.log(`${businesses.length} active businesses found; processing ${targets.length}.\n`)

  // Skip anything already linked.
  const { data: existing } = await db.from('entity_owners').select('entity_slug')
  const alreadyOwned = new Set((existing || []).map((r) => r.entity_slug))

  if (!DRY_RUN && !existsSync(OUT)) {
    writeFileSync(OUT, 'business_name,slug,login,password\n')
  }

  let created = 0
  let skipped = 0
  let failed = 0

  await mapLimit(targets, CONCURRENCY, async (biz) => {
    if (alreadyOwned.has(biz.slug)) {
      skipped++
      return
    }

    const email = loginEmail(biz.slug)
    const password = makePassword()

    if (DRY_RUN) {
      console.log(`  would create  ${biz.slug.padEnd(42)} ${email}`)
      created++
      return
    }

    try {
      // 1. the account
      const { data: userRes, error: userErr } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // no inbox exists for derived addresses
        user_metadata: {
          business_name: biz.name,
          gcr_slug: biz.slug, // convenience only — never trusted for access
          contact_email: biz.email || null,
        },
      })

      if (userErr) {
        // Already registered from a previous partial run — link it instead.
        if (/already/i.test(userErr.message)) {
          const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
          const found = list?.users?.find((u) => u.email === email)
          if (found) {
            await db.from('entity_owners').upsert(
              { user_id: found.id, entity_id: biz.id, entity_slug: biz.slug, role: 'owner' },
              { onConflict: 'user_id,entity_slug' }
            )
            skipped++
            return
          }
        }
        throw userErr
      }

      // 2. ownership — the part that makes editing safe
      const { error: ownErr } = await db.from('entity_owners').upsert(
        { user_id: userRes.user.id, entity_id: biz.id, entity_slug: biz.slug, role: 'owner' },
        { onConflict: 'user_id,entity_slug' }
      )
      if (ownErr) throw ownErr

      // 3. credentials to hand out
      const csv = [biz.name, biz.slug, email, password]
        .map((f) => `"${String(f ?? '').replace(/"/g, '""')}"`)
        .join(',')
      appendFileSync(OUT, csv + '\n')

      created++
      if (created % 100 === 0) console.log(`  …${created} created`)
    } catch (err) {
      failed++
      console.error(`  FAILED  ${biz.slug}: ${err.message}`)
    }
  })

  console.log(`\nDone. created ${created}, already had accounts ${skipped}, failed ${failed}`)
  if (!DRY_RUN && created) {
    console.log(`Credentials written to ${OUT} — treat this file as secret.`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
