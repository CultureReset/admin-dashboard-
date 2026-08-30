import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * The only module that owns a database handle.
 *
 * Person context is set per transaction with set_config(..., is_local => true).
 * The `true` is load-bearing: a non-local setting survives the transaction and,
 * behind a pooler, is inherited by the next person's request on that connection.
 * That is the classic multi-tenant leak and it is silent, because ordinary tests
 * run one person at a time.
 */

export interface PersonContext {
  personId: string;
  householdId: string;
}

export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T>;
}

const sqlFile = (name: string) =>
  readFile(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

export class Db {
  private constructor(private readonly pg: PGlite) {}

  static async open(dataDir?: string): Promise<Db> {
    const pg = new PGlite(dataDir);
    await pg.waitReady;
    const db = new Db(pg);
    await db.migrate();
    return db;
  }

  async migrate(): Promise<void> {
    await this.pg.exec(await sqlFile('schema.sql'));
    await this.pg.exec(await sqlFile('policies.sql'));
  }

  /** Escape hatch for migrations, seeding and the RLS checker. Never for requests. */
  async privileged<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const r = await this.pg.query<T>(sql, params as never[]);
    return r.rows;
  }

  /**
   * Run work as `app_runtime` with a person bound for the life of the transaction.
   * Superusers bypass RLS entirely, so dropping to a non-superuser role is not
   * defence in depth here — it is the only thing making the policies apply.
   */
  async withPerson<T>(ctx: PersonContext, work: (tx: Tx) => Promise<T>): Promise<T> {
    const pg = this.pg;
    await pg.exec('begin');
    try {
      await pg.exec('set local role app_runtime');
      await pg.query(`select set_config('app.person_id', $1, true)`, [ctx.personId]);
      await pg.query(`select set_config('app.household_id', $1, true)`, [ctx.householdId]);

      const tx: Tx = {
        async query<R>(sql: string, params: unknown[] = []) {
          const r = await pg.query<R>(sql, params as never[]);
          return r.rows;
        },
        async one<R>(sql: string, params: unknown[] = []) {
          const r = await pg.query<R>(sql, params as never[]);
          const row = r.rows[0];
          if (!row) throw new Error('expected exactly one row, got none');
          return row as R;
        },
      };

      const out = await work(tx);
      await pg.exec('commit');
      return out;
    } catch (err) {
      await pg.exec('rollback');
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}
