import { Db } from './store/db.js';
import { seed } from './store/seed.js';
import { checkRls } from './store/check-rls.js';
import { CapabilityHost } from './capabilities/host.js';
import { registerCoreCapabilities } from './capabilities/handlers.js';
import { loadPipeline } from './pipeline/index.js';
import { startGateway } from './gateway/server.js';
import { WasmApp } from './apps/wasm-app.js';
import { install, all } from './apps/registry.js';
import { loadWasm } from './wasm/sandbox.js';
import { existsSync } from 'node:fs';

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

// Sandboxed apps, if they have been built. A guest gets the same capability
// surface a first-party app gets, and the router cannot tell them apart.
const PLANT_ID = new URL('../build/plant-id.wasm', import.meta.url);
if (existsSync(PLANT_ID)) {
  install(new WasmApp(
    { id: 'plant-id', name: 'Plant identifier', intents: ['plant.identify'],
      scopes: ['entity.create', 'kv.*'], egress: 'node' },
    await loadWasm(PLANT_ID.pathname), host));
}

startGateway({ port: PORT, db, host, pipeline });

console.log(`open-glasses node listening on ws://localhost:${PORT}`);
console.log(`  pipeline    ${pipeline.name}`);
console.log(`  capabilities ${host.registered().join(', ')}`);
console.log(`  apps        ${all().map(a => a.manifest.id).join(', ')}`);
console.log(`  people`);
for (const p of seeded.people) console.log(`    ${p.handle.padEnd(6)} device=${p.deviceId} key=${p.deviceKey}`);
