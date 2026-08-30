import { Db } from './store/db.js';
import { seed } from './store/seed.js';
import { checkRls } from './store/check-rls.js';
import { CapabilityHost } from './capabilities/host.js';
import { registerCoreCapabilities } from './capabilities/handlers.js';
import { loadPipeline } from './pipeline/index.js';
import { startGateway } from './gateway/server.js';

const PORT = Number(process.env['OG_PORT'] ?? 8787);

const db = await Db.open(process.env['OG_DATA']);

const findings = await checkRls(db);
if (findings.length) {
  for (const f of findings) console.error(`  ✗ ${f.table}: ${f.problem}`);
  throw new Error('refusing to start: RLS check failed');
}

const seeded = await seed(db);
const host = new CapabilityHost(db);
registerCoreCapabilities(host);
const pipeline = await loadPipeline();
startGateway({ port: PORT, db, host, pipeline });

console.log(`open-glasses node listening on ws://localhost:${PORT}`);
console.log(`  pipeline    ${pipeline.name}`);
console.log(`  capabilities ${host.registered().join(', ')}`);
console.log(`  people`);
for (const p of seeded.people) console.log(`    ${p.handle.padEnd(6)} device=${p.deviceId} key=${p.deviceKey}`);
