import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { freshNode } from '../helpers.js';
import { Sandbox, SandboxError, loadWasm } from '../../src/wasm/sandbox.js';
import { fileURLToPath } from 'node:url';

const node = await freshNode();
afterAll(() => node.db.close());

let wasm: Uint8Array<ArrayBuffer>;
beforeAll(async () => {
  wasm = await loadWasm(fileURLToPath(new URL('../../build/plant-id.wasm', import.meta.url)));
});

const INPUT = { description: 'a fiddle-leaf fig, Ficus lyrata', confidence: 0.92,
                transcript: 'what plant is this?' };

describe('a sandboxed app runs and can reach its own capabilities', () => {
  it('produces an answer', async () => {
    const sb = new Sandbox(node.host);
    const ctx = node.ctx('matt', 'plant-id', ['entity.create', 'kv.*']);
    const out = await sb.run(wasm, ctx, INPUT);
    const parsed = JSON.parse(out.output);
    expect(parsed.speak).toContain('fiddle-leaf fig');
    expect(parsed.card.meta).toBe('1 plants identified');
    expect(out.calls).toBe(3);                       // entity.create, kv.get, kv.set
    expect(out.logs[0]).toContain('plant-id identified');
  });

  it('its writes actually landed, under the right person', async () => {
    const verify = node.ctx('matt', 'verify', ['observation.search']);
    const rows = await node.db.withPerson(verify.person, tx =>
      tx.query<{ kind: string; name: string }>(`select kind, name from entity`));
    expect(rows.some(r => r.kind === 'plant' && r.name.includes('Ficus'))).toBe(true);
  });
});

describe('the sandbox is the permission boundary', () => {
  it('refuses a capability outside the app token, from inside the guest', async () => {
    const sb = new Sandbox(node.host);
    // No kv.* scope this time: the guest's kv.get call must fail.
    const ctx = node.ctx('matt', 'plant-id', ['entity.create']);
    await expect(sb.run(wasm, ctx, INPUT)).rejects.toThrow(/no scope for kv.get/);
  });

  it('cannot reach another person even running the same module', async () => {
    const sb = new Sandbox(node.host);
    const plants = (who: string) => node.db.withPerson(node.person(who), tx =>
      tx.query(`select 1 from entity where kind = 'plant'`)).then(r => r.length);

    const mBefore = await plants('matt'), pBefore = await plants('poppy');

    const m = await sb.run(wasm, node.ctx('matt',  'plant-id', ['entity.create', 'kv.*']), INPUT);
    const p = await sb.run(wasm, node.ctx('poppy', 'plant-id', ['entity.create', 'kv.*']), INPUT);

    // Each person's kv counter is their own namespace, incremented independently.
    expect(JSON.parse(m.output).card.meta).not.toBe(JSON.parse(p.output).card.meta);

    // Each run added exactly one row, and only to its own person.
    expect(await plants('matt')).toBe(mBefore + 1);
    expect(await plants('poppy')).toBe(pBefore + 1);
  });

  it('a refused call does not roll back the guest\'s earlier writes', async () => {
    // Each capability call is its own transaction — there is no transaction
    // spanning a guest run. An app that is refused partway keeps what it had
    // already committed, exactly as an app hitting a permission error would.
    // Worth being explicit about: it is a deliberate choice, not an oversight.
    const sb = new Sandbox(node.host);
    const before = await node.db.withPerson(node.person('matt'), tx =>
      tx.query(`select 1 from entity where kind = 'plant'`)).then(r => r.length);
    await expect(sb.run(wasm, node.ctx('matt', 'plant-id', ['entity.create']), INPUT))
      .rejects.toThrow(/no scope for kv.get/);
    const after = await node.db.withPerson(node.person('matt'), tx =>
      tx.query(`select 1 from entity where kind = 'plant'`)).then(r => r.length);
    expect(after).toBe(before + 1);
  });
});

describe('a guest has no ambient authority', () => {
  it('has exactly two imports, both from the host', async () => {
    const mod = new WebAssembly.Module(wasm);
    const imports = WebAssembly.Module.imports(mod);
    const modules = new Set(imports.map(i => i.module));
    expect([...modules].sort()).toEqual(['env', 'og']);
    expect(imports.filter(i => i.module === 'og').map(i => i.name).sort())
      .toEqual(['invoke', 'log']);
  });

  it('has no WASI, filesystem, socket or clock import', async () => {
    const mod = new WebAssembly.Module(wasm);
    const names = WebAssembly.Module.imports(mod).map(i => `${i.module}.${i.name}`);
    for (const forbidden of ['wasi_snapshot_preview1', 'fd_write', 'sock_', 'clock_time_get', 'path_open']) {
      expect(names.some(n => n.includes(forbidden))).toBe(false);
    }
  });

  it('rejects a module that asks for an import the host does not offer', async () => {
    // A hand-built module importing wasi_snapshot_preview1.fd_write.
    const evil = buildModuleImporting('wasi_snapshot_preview1', 'fd_write');
    const sb = new Sandbox(node.host);
    const ctx = node.ctx('matt', 'evil', ['kv.*']);
    await expect(sb.run(evil, ctx, INPUT)).rejects.toThrow(/forbidden import/);
  });
});

describe('budgets are enforced, not advertised', () => {
  it('terminates a guest that never returns', async () => {
    // `spin()` loops forever. A step machine could not stop this; a worker can.
    const spinner = await loadWasm(fileURLToPath(new URL('../../build/spin.wasm', import.meta.url)));
    const sb = new Sandbox(node.host, { deadlineMs: 300, maxCalls: 8, maxMemoryPages: 64 });
    const ctx = node.ctx('matt', 'spinner', []);
    const started = Date.now();
    await expect(sb.run(spinner, ctx, INPUT)).rejects.toThrow(SandboxError);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('cuts an app off at its call budget', async () => {
    const sb = new Sandbox(node.host, { deadlineMs: 2000, maxCalls: 1, maxMemoryPages: 64 });
    const ctx = node.ctx('matt', 'plant-id', ['entity.create', 'kv.*']);
    await expect(sb.run(wasm, ctx, INPUT)).rejects.toThrow(/call budget/);
  });
});

/** Minimal valid module that imports one function and exports run/alloc. */
function buildModuleImporting(mod: string, name: string): Uint8Array<ArrayBuffer> {
  const str = (s: string) => [s.length, ...[...s].map(c => c.charCodeAt(0))];
  const section = (id: number, body: number[]) => [id, body.length, ...body];
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [0x01, 0x60, 0x00, 0x00]),                       // type: () -> ()
    ...section(2, [0x01, ...str(mod), ...str(name), 0x00, 0x00]),  // import
  ];
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}
