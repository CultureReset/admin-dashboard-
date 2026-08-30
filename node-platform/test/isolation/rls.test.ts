import { describe, it, expect, afterAll } from 'vitest';
import { freshNode } from '../helpers.js';
import { checkRls } from '../../src/store/check-rls.js';

const node = await freshNode();
afterAll(() => node.db.close());

/**
 * Test 1 from the isolation suite, generated from the schema rather than
 * written per table — so a table added next month is covered without anyone
 * remembering to extend this file.
 */
describe('every person-scoped table isolates by person', () => {
  it('finds the tables to test', async () => {
    const tables = await personTables();
    expect(tables.length).toBeGreaterThan(3);
  });

  it('B cannot read, update or delete rows belonging to A', async () => {
    const A = node.person('matt'), B = node.person('poppy');
    const tables = await personTables();

    for (const t of tables) {
      // A writes one row using only always-present columns.
      const cols = await columnsOf(t);
      const extra = REQUIRED_FOR[t] ?? {};
      const names = ['person_id', 'household_id', ...Object.keys(extra)];
      const values = [A.personId, A.householdId, ...Object.values(extra)];
      const holes = names.map((_, i) => `$${i + 1}`).join(',');
      expect(cols).toContain('person_id');

      const inserted = await node.db.withPerson(A, tx =>
        tx.query<{ id: string }>(
          `insert into ${t}(${names.join(',')}) values (${holes}) returning ${idCol(t)} as id`, values));
      expect(inserted).toHaveLength(1);

      const bSees = await node.db.withPerson(B, tx => tx.query(`select * from ${t}`));
      expect(bSees, `${t}: B can read A's rows`).toHaveLength(0);

      const bUpdated = await node.db.withPerson(B, tx =>
        tx.query(`update ${t} set household_id = household_id returning ${idCol(t)}`));
      expect(bUpdated, `${t}: B can update A's rows`).toHaveLength(0);

      const bDeleted = await node.db.withPerson(B, tx =>
        tx.query(`delete from ${t} returning ${idCol(t)}`));
      expect(bDeleted, `${t}: B can delete A's rows`).toHaveLength(0);

      const stillThere = await node.db.withPerson(A, tx => tx.query(`select * from ${t}`));
      expect(stillThere.length, `${t}: A's row survived B's delete`).toBeGreaterThan(0);

      await node.db.withPerson(A, tx => tx.query(`delete from ${t}`));
    }
  });

  it('B cannot forge a row that claims to belong to A', async () => {
    const A = node.person('matt'), B = node.person('poppy');
    await expect(node.db.withPerson(B, tx =>
      tx.query(`insert into list_item(person_id, household_id, list_name, title)
                values ($1,$2,'christmas','forged')`, [A.personId, A.householdId]),
    )).rejects.toThrow(/row-level security/i);
  });
});

/** Test 2: the schema gate itself. */
describe('schema gate', () => {
  it('every table has person_id (or is explicitly exempt) with RLS enabled and forced', async () => {
    expect(await checkRls(node.db)).toEqual([]);
  });

  it('catches a table added without protection', async () => {
    await node.db.privileged(`create table leaky(id serial primary key, person_id uuid, secret text)`);
    const findings = await checkRls(node.db);
    expect(findings.map(f => f.problem)).toContain('row level security not enabled');
    await node.db.privileged(`drop table leaky`);
    expect(await checkRls(node.db)).toEqual([]);
  });
});

// --- helpers ---------------------------------------------------------------

const REQUIRED_FOR: Record<string, Record<string, unknown>> = {
  observation: { kind: 'text' },
  entity:      { kind: 'note', name: 'x' },
  list_item:   { list_name: 'l', title: 't' },
  app_kv:      { app_id: 'a', key: 'k', value: '{}' },
  audit:       { app_id: 'a', capability: 'c', ok: true },
};

const idCol = (t: string) => (t === 'app_kv' ? 'key' : 'id');

async function personTables(): Promise<string[]> {
  const rows = await node.db.privileged<{ relname: string }>(`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'person_id' and a.attnum > 0
    where c.relkind = 'r' and n.nspname = 'public' and c.relname <> 'device'
    order by c.relname`);
  return rows.map(r => r.relname);
}

async function columnsOf(table: string): Promise<string[]> {
  const rows = await node.db.privileged<{ attname: string }>(
    `select attname from pg_attribute
      where attrelid = $1::regclass and attnum > 0 and not attisdropped`, [table]);
  return rows.map(r => r.attname);
}
