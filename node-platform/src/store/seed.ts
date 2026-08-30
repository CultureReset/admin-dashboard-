/**
 * Two people from the first commit, with one user.
 *
 * The second person is not decoration. Keeping an empty second account in every
 * run is what stops the system quietly becoming single-tenant — the failure you
 * otherwise discover months later, when fixing it means rewriting every query.
 */
import { Db } from './db.js';

export interface Seeded {
  householdId: string;
  people: { id: string; handle: string; deviceId: string; deviceKey: string }[];
}

export async function seed(db: Db): Promise<Seeded> {
  const existing = await db.privileged<{ id: string }>(`select id from household limit 1`);
  if (existing[0]) return await read(db, existing[0].id);

  const [hh] = await db.privileged<{ id: string }>(
    `insert into household(name) values ('Home') returning id`);
  const householdId = hh!.id;

  const people = [];
  for (const [handle, name] of [['matt', 'Matt'], ['poppy', 'Poppy']] as const) {
    const [p] = await db.privileged<{ id: string }>(
      `insert into person(household_id, handle, display_name, kek_handle)
       values ($1,$2,$3,$4) returning id`,
      [householdId, handle, name, `kek:${handle}`]);
    const deviceId = `glasses-${handle}`;
    const deviceKey = `devkey-${handle}-0001`;
    await db.privileged(
      `insert into device(id, person_id, household_id, kind, device_key, capabilities)
       values ($1,$2,$3,'glasses',$4,$5::jsonb)`,
      [deviceId, p!.id, householdId, deviceKey, JSON.stringify({
        capture: { still: true, video: false, indicator: 'hardwired' },
        listen:  { channels: 2, rate: 16000, wakeword: true, vad: true },
        speak:   { codecs: ['opus'], transducer: 'bone' },
        display: { class: 'text', cols: 40, rows: 5, mono: true, anchor: ['head'] },
        sensor:  { imu: true, presence: true, tap: true },
      })]);
    people.push({ id: p!.id, handle, deviceId, deviceKey });
  }

  // A shared device with no person bound. Household scope only until someone
  // claims it — never a "probably Matt" guess, which would read one person's
  // private data aloud in a shared room.
  await db.privileged(
    `insert into device(id, person_id, household_id, kind, device_key, capabilities)
     values ('kitchen-speaker', null, $1, 'speaker', 'devkey-kitchen-0001', $2::jsonb)`,
    [householdId, JSON.stringify({
      listen: { channels: 1, rate: 16000, wakeword: true, vad: true },
      speak:  { codecs: ['opus'], transducer: 'speaker' },
      display: { class: 'none' },
    })]);

  return { householdId, people };
}

async function read(db: Db, householdId: string): Promise<Seeded> {
  const rows = await db.privileged<{ id: string; handle: string; device_id: string; device_key: string }>(
    `select p.id, p.handle, d.id as device_id, d.device_key
       from person p join device d on d.person_id = p.id
      where p.household_id = $1 order by p.handle`, [householdId]);
  return {
    householdId,
    people: rows.map(r => ({ id: r.id, handle: r.handle, deviceId: r.device_id, deviceKey: r.device_key })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = await Db.open();
  const s = await seed(db);
  console.log('household', s.householdId);
  for (const p of s.people) console.log(`  ${p.handle.padEnd(6)} ${p.id}  device=${p.deviceId}  key=${p.deviceKey}`);
  await db.close();
}
