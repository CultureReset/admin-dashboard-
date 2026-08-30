import { describe, it, expect, afterAll } from 'vitest';
import { freshNode } from '../helpers.js';

const node = await freshNode();
afterAll(() => node.db.close());

/**
 * Test 3. The leak that ordinary suites never reproduce, because ordinary
 * suites run one person at a time.
 *
 * `set_config(..., is_local => true)` scopes the setting to the transaction.
 * Without the `true` it survives, and the next person's request on that pooled
 * connection inherits it — silently, with every other test still green.
 */
describe('person context does not survive its transaction', () => {
  it('is cleared once the transaction ends', async () => {
    const A = node.person('matt');
    await node.db.withPerson(A, async tx => { await tx.query('select 1'); });
    const [after] = await node.db.privileged<{ v: string | null }>(
      `select current_setting('app.person_id', true) as v`);
    expect(after?.v ?? '').toBe('');
  });

  it('B does not inherit A context when reusing the same connection', async () => {
    const A = node.person('matt'), B = node.person('poppy');

    await node.db.withPerson(A, tx =>
      tx.query(`insert into list_item(person_id, household_id, list_name, title)
                values ($1,$2,'private','A only')`, [A.personId, A.householdId]));

    // Immediately afterwards, on the very same PGlite connection.
    const bSees = await node.db.withPerson(B, tx =>
      tx.query(`select title from list_item`));
    expect(bSees).toHaveLength(0);
  });

  it('demonstrates the bug it guards against', async () => {
    const A = node.person('matt');
    // A non-local set is exactly the mistake. It leaks past the transaction.
    await node.db.privileged(`select set_config('app.person_id', $1, false)`, [A.personId]);
    const [leaked] = await node.db.privileged<{ v: string }>(
      `select current_setting('app.person_id', true) as v`);
    expect(leaked?.v).toBe(A.personId);          // proves the test can detect it
    await node.db.privileged(`select set_config('app.person_id', '', false)`);
  });

  it('a query with no person context sees nothing rather than erroring', async () => {
    const A = node.person('matt');
    await node.db.withPerson(A, tx =>
      tx.query(`insert into list_item(person_id, household_id, list_name, title)
                values ($1,$2,'x','y')`, [A.personId, A.householdId]));

    const rows = await node.db.withPerson(
      { personId: '00000000-0000-0000-0000-000000000000', householdId: A.householdId },
      tx => tx.query(`select * from list_item`));
    expect(rows).toHaveLength(0);
  });
});
