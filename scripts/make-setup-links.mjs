#!/usr/bin/env node
/**
 * Generate a one-time setup link for a business, so they can set their own
 * password and add a real email address.
 *
 * Use this when handing a dashboard over — text or email the link. Nothing is
 * sent from here; it only produces the URLs.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=<key> node scripts/make-setup-links.mjs <slug> [slug…]
 *   SUPABASE_SERVICE_KEY=<key> node scripts/make-setup-links.mjs --all --limit=50
 *
 * Flags:
 *   --all             every provisioned business
 *   --limit=N         cap how many
 *   --redirect=URL    where the link lands (default: the dashboard host below)
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const SUPABASE_URL = 'https://mkepugvdlktfsossumox.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const LOGIN_DOMAIN = 'biz.gulfcoastradar.com'

if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_KEY (service_role key).')
  process.exit(1)
}

const args = process.argv.slice(2)
const flag = (n) => args.some((a) => a === `--${n}`)
const value = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.split('=')[1] : d
}

const REDIRECT = value('redirect', 'https://dashboard.gulfcoastradar.com/set-password')
const LIMIT = parseInt(value('limit', '0'), 10)
const slugs = args.filter((a) => !a.startsWith('--'))

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  let targets = slugs

  if (flag('all')) {
    const { data, error } = await db
      .from('entity_owners')
      .select('entity_slug')
      .limit(LIMIT || 5000)
    if (error) throw error
    targets = data.map((r) => r.entity_slug)
  }

  if (!targets.length) {
    console.error('Give one or more slugs, or use --all.')
    process.exit(1)
  }

  const rows = [['slug', 'login', 'setup_link']]

  for (const slug of targets) {
    const email = `${slug}@${LOGIN_DOMAIN}`
    try {
      const { data, error } = await db.auth.admin.generateLink({
        type: 'recovery', // sets a new password; also lets them add a real email
        email,
        options: { redirectTo: REDIRECT },
      })
      if (error) throw error
      const link = data?.properties?.action_link
      rows.push([slug, email, link])
      console.log(`${slug}\n  ${link}\n`)
    } catch (err) {
      console.error(`FAILED ${slug}: ${err.message}`)
    }
  }

  if (rows.length > 1) {
    const csv = rows
      .map((r) => r.map((f) => `"${String(f ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    writeFileSync('setup-links.csv', csv + '\n')
    console.log(`Wrote setup-links.csv (${rows.length - 1} links). These are secret and expire.`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
