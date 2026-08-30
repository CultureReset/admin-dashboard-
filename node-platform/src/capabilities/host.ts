/**
 * The capability host: the only module in the system that holds a database
 * handle or reaches an identity node.
 *
 * The important property is in the handler signature. `Handler` receives a
 * transaction and its own arguments — there is nowhere to put a person id, so
 * no app can name a person other than the one it is already running as.
 * Isolation is structural rather than a review checklist.
 */
import { Db, Tx, PersonContext } from '../store/db.js';
import { CapabilityToken, assertToken, isRevoked, TokenError } from './token.js';
import { PolicyBundle } from './policy.js';

export interface InvocationContext {
  person: PersonContext;
  token: CapabilityToken;
  policy: PolicyBundle;
  /** Set by the gateway from the device's `state` message. Read by the router. */
  device?: { id: string; batteryPct?: number; worn?: boolean };
}

/** Note what is absent: no person argument. That is the whole design. */
export type Handler<A = unknown, R = unknown> =
  (tx: Tx, args: A, meta: HandlerMeta) => Promise<R>;

export interface HandlerMeta {
  appId: string;
  deviceId?: string;
  /** Present only for capabilities that legitimately need the identity of the
   *  owning person as data — e.g. stamping a row. Derived, never supplied. */
  personId: string;
  householdId: string;
}

export class CapabilityError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'CapabilityError';
  }
}

export class CapabilityHost {
  private readonly handlers = new Map<string, Handler<never, unknown>>();

  constructor(private readonly db: Db) {}

  register<A, R>(capability: string, handler: Handler<A, R>): void {
    if (this.handlers.has(capability)) throw new Error(`duplicate capability ${capability}`);
    this.handlers.set(capability, handler as Handler<never, unknown>);
  }

  registered(): string[] { return [...this.handlers.keys()].sort(); }

  async invoke<R = unknown>(ctx: InvocationContext, capability: string, args: unknown): Promise<R> {
    const handler = this.handlers.get(capability);
    if (!handler) throw new CapabilityError('unknown_capability', `no such capability: ${capability}`);

    if (isRevoked(ctx.token)) throw new TokenError(`token revoked for ${ctx.token.appId}`);
    if (ctx.token.personId !== ctx.person.personId) {
      throw new TokenError('token does not belong to the session person');
    }
    assertToken(ctx.token, capability);

    const meta: HandlerMeta = {
      appId: ctx.token.appId,
      deviceId: ctx.device?.id,
      personId: ctx.person.personId,
      householdId: ctx.person.householdId,
    };

    // Success and failure are audited differently, and the difference matters.
    //
    // A successful effect gets its receipt inside the same transaction: a crash
    // between the two would otherwise leave an action with no record, which is
    // the failure that destroys trust in the whole privacy story.
    //
    // A failure cannot use that transaction, because the rollback that undoes
    // the effect would also undo the receipt — and a refused call is exactly
    // what you most want in the log. It has no data effect to be atomic with,
    // so it is written separately, after the rollback.
    try {
      return await this.db.withPerson(ctx.person, async (tx) => {
        const out = await (handler as Handler<unknown, R>)(tx, args, meta);
        await tx.query(
          `insert into audit(person_id, household_id, app_id, capability, destination, ok, detail)
           values ($1,$2,$3,$4,$5,true,null)`,
          [meta.personId, meta.householdId, meta.appId, capability, 'node'],
        );
        return out as R;
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await this.auditFailure(meta, capability, detail);
      throw err;
    }
  }

  /** Outside the rolled-back transaction, so the refusal survives. */
  private async auditFailure(meta: HandlerMeta, capability: string, detail: string): Promise<void> {
    try {
      await this.db.privileged(
        `insert into audit(person_id, household_id, app_id, capability, destination, ok, detail)
         values ($1,$2,$3,$4,'node',false,$5)`,
        [meta.personId, meta.householdId, meta.appId, capability, detail],
      );
    } catch {
      // Never let an audit write mask the original error.
    }
  }
}
