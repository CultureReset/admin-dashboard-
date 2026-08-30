/**
 * The capability surface apps actually call. Apps never write SQL; the host
 * does. Row level security is the second line of defence, not the first.
 */
import { CapabilityHost, HandlerMeta } from './host.js';
import { Tx } from '../store/db.js';

export interface ObservationRow {
  id: string; kind: string; description: string | null; transcript: string | null;
  captured_at: string; media_ref: string | null; confidence: number | null;
}

export interface ListItemRow {
  id: string; list_name: string; title: string; note: string | null; created_at: string;
}

export function registerCoreCapabilities(host: CapabilityHost): void {
  // --- observations -------------------------------------------------------
  // Only the capture pipeline may create these. An app that could forge an
  // observation could forge your memory, so `observation.create` is not in any
  // third-party scope set — see apps/registry.ts.
  host.register<{
    kind: string; description?: string; transcript?: string; mediaRef?: string;
    deviceId?: string; policy?: string; retainUntil?: string | null;
    derivedBy?: Record<string, string>; confidence?: number;
  }, { id: string }>('observation.create', async (tx, a, m) => {
    const row = await tx.one<{ id: string }>(
      `insert into observation
         (person_id, household_id, device_id, kind, description, transcript,
          media_ref, policy, retain_until, derived_by, confidence)
       values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,'node'),$9,coalesce($10,'{}'::jsonb),$11)
       returning id`,
      [m.personId, m.householdId, a.deviceId ?? m.deviceId ?? null, a.kind,
       a.description ?? null, a.transcript ?? null, a.mediaRef ?? null,
       a.policy ?? null, a.retainUntil ?? null,
       a.derivedBy ? JSON.stringify(a.derivedBy) : null, a.confidence ?? null],
    );
    return { id: row.id };
  });

  // Memory is a SQL query over rows, not a model recalling something. The
  // embedding, when it exists, is an index over this — never the source.
  //
  // Retrieval is lexical for now, which has a real and visible limit: asking
  // for "shoes" will not match a row described as "desert boots". Rather than
  // pretend otherwise, the search reports how it matched so the app can say so.
  // This is exactly the gap a vector index closes, and the shape of the answer
  // does not change when one is added.
  host.register<{ q?: string; since?: string; limit?: number },
                { match: 'exact' | 'recent' | 'none'; rows: ObservationRow[] }>(
    'observation.search', async (tx, a) => {
      const limit = Math.min(a.limit ?? 20, 100);
      const cols = `id, kind, description, transcript, captured_at, media_ref, confidence`;

      if (a.q) {
        const hits = await tx.query<ObservationRow>(
          `select ${cols} from observation
            where (description ilike '%'||$1||'%' or transcript ilike '%'||$1||'%')
              and ($2::timestamptz is null or captured_at >= $2)
            order by captured_at desc limit $3`,
          [a.q, a.since ?? null, limit]);
        if (hits.length) return { match: 'exact', rows: hits };
      }

      const recent = await tx.query<ObservationRow>(
        `select ${cols} from observation
          where ($1::timestamptz is null or captured_at >= $1)
            and description is not null
          order by captured_at desc limit $2`,
        [a.since ?? null, limit]);
      return { match: a.q ? (recent.length ? 'recent' : 'none') : 'exact', rows: recent };
    });

  // --- lists --------------------------------------------------------------
  host.register<{ list: string; title: string; note?: string; observationId?: string },
                { id: string }>('list.add', async (tx, a, m) => {
    const row = await tx.one<{ id: string }>(
      `insert into list_item(person_id, household_id, list_name, title, note, observation_id)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [m.personId, m.householdId, a.list, a.title, a.note ?? null, a.observationId ?? null],
    );
    return { id: row.id };
  });

  host.register<{ list: string }, ListItemRow[]>('list.get', async (tx, a) =>
    tx.query<ListItemRow>(
      `select id, list_name, title, note, created_at
         from list_item where list_name = $1 order by created_at desc limit 100`,
      [a.list]));

  // --- entities -----------------------------------------------------------
  host.register<{ kind: string; name: string; attrs?: Record<string, unknown>; observationId?: string },
                { id: string }>('entity.create', async (tx, a, m) => {
    const row = await tx.one<{ id: string }>(
      `insert into entity(person_id, household_id, kind, name, attrs, observation_id)
       values ($1,$2,$3,$4,coalesce($5,'{}'::jsonb),$6) returning id`,
      [m.personId, m.householdId, a.kind, a.name,
       a.attrs ? JSON.stringify(a.attrs) : null, a.observationId ?? null],
    );
    return { id: row.id };
  });

  // --- per-(app, person) private storage ----------------------------------
  // The app id comes from the token, not the arguments, so an app cannot read
  // another app's namespace even within the same person.
  host.register<{ key: string }, unknown>('kv.get', async (tx, a, m) => {
    const rows = await tx.query<{ value: unknown }>(
      `select value from app_kv where app_id = $1 and key = $2`, [m.appId, a.key]);
    return rows[0]?.value ?? null;
  });

  host.register<{ key: string; value: unknown }, { ok: true }>('kv.set', async (tx, a, m) => {
    await tx.query(
      `insert into app_kv(person_id, household_id, app_id, key, value)
       values ($1,$2,$3,$4,$5::jsonb)
       on conflict (person_id, app_id, key)
       do update set value = excluded.value, updated_at = now()`,
      [m.personId, m.householdId, m.appId, a.key, JSON.stringify(a.value)],
    );
    return { ok: true };
  });

  // --- audit --------------------------------------------------------------
  // The receipt, readable by the person it belongs to. This is what makes the
  // privacy model legible: not the toggle, the weekly ledger.
  host.register<{ limit?: number }, unknown[]>('audit.read', async (tx, a) =>
    tx.query(`select app_id, capability, destination, ok, at
                from audit order by at desc limit least(coalesce($1,50),200)`,
      [a.limit ?? null]));
}
