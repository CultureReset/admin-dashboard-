import { Db } from '../src/store/db.js';
import { CapabilityHost } from '../src/capabilities/host.js';
import { registerCoreCapabilities } from '../src/capabilities/handlers.js';
import { mint } from '../src/capabilities/token.js';
import { defaultBundle } from '../src/capabilities/policy.js';
import { seed } from '../src/store/seed.js';

export async function freshNode() {
  const db = await Db.open();               // in-memory PGlite, one per test file
  const s = await seed(db);
  const host = new CapabilityHost(db);
  registerCoreCapabilities(host);

  const person = (handle: string) => {
    const p = s.people.find(x => x.handle === handle);
    if (!p) throw new Error(`no seeded person ${handle}`);
    return { personId: p.id, householdId: s.householdId };
  };

  const ctx = (handle: string, appId: string, scopes: string[]) => {
    const pc = person(handle);
    return { person: pc, token: mint(appId, pc.personId, scopes), policy: defaultBundle(pc.personId) };
  };

  return { db, host, seeded: s, person, ctx };
}
