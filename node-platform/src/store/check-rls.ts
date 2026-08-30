/**
 * CI gate. Fails the build if any table is person-scoped without protection,
 * or is unprotected without being on the explicit exemption list.
 *
 * This is the check that stops the slow decay where someone adds a table in a
 * hurry and it quietly has no policy on it.
 */
import { Db } from './db.js';

/**
 * Tables allowed to exist without a person_id column. Adding to this list is a
 * decision, not a convenience: `household` is shared reference data and `person`
 * is the identity table itself, keyed by `id`. Both still carry forced RLS.
 */
const EXEMPT = new Set(['household', 'person']);

export interface RlsFinding { table: string; problem: string }

export async function checkRls(db: Db): Promise<RlsFinding[]> {
  const tables = await db.privileged<{
    table_name: string; has_person: boolean; rls_enabled: boolean; rls_forced: boolean; policies: number;
  }>(`
    select c.relname as table_name,
           exists (select 1 from pg_attribute a
                   where a.attrelid = c.oid and a.attname = 'person_id' and a.attnum > 0) as has_person,
           c.relrowsecurity  as rls_enabled,
           c.relforcerowsecurity as rls_forced,
           (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = 'public'
    order by c.relname
  `);

  const findings: RlsFinding[] = [];
  for (const t of tables) {
    if (!t.has_person && !EXEMPT.has(t.table_name)) {
      findings.push({ table: t.table_name, problem: 'no person_id column and not exempt' });
    }
    if (!t.rls_enabled) findings.push({ table: t.table_name, problem: 'row level security not enabled' });
    if (!t.rls_forced)  findings.push({ table: t.table_name, problem: 'row level security not FORCED (the owner bypasses it)' });
    if (t.policies === 0) findings.push({ table: t.table_name, problem: 'no policy attached' });
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = await Db.open();
  const findings = await checkRls(db);
  await db.close();
  if (findings.length === 0) {
    console.log('RLS check passed: every table is protected.');
  } else {
    for (const f of findings) console.error(`  ✗ ${f.table}: ${f.problem}`);
    console.error(`\n${findings.length} problem(s).`);
    process.exit(1);
  }
}
