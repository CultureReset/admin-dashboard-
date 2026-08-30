/**
 * The WASM app sandbox.
 *
 * Third-party code on a machine holding someone's entire life gets a sandbox,
 * not a code review. A module has no ambient authority at all — the capability
 * API is its only import, so the sandbox boundary and the permission boundary
 * are the same line of code instead of two things that have to agree.
 */
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  IDX_STATE, IDX_LEN, HEADER_BYTES, PAYLOAD_BYTES,
  STATE_REPLY, SandboxLimits, DEFAULT_LIMITS,
} from './protocol.js';
import { CapabilityHost, InvocationContext } from '../capabilities/host.js';

const WORKER = fileURLToPath(new URL('./worker.js', import.meta.url));

export interface SandboxResult {
  output: string;
  calls: number;
  ms: number;
  logs: string[];
}

export class SandboxError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'SandboxError';
  }
}

export class Sandbox {
  constructor(
    private readonly host: CapabilityHost,
    private readonly limits: SandboxLimits = DEFAULT_LIMITS,
  ) {}

  /**
   * Run a guest against one person's capabilities.
   *
   * `ctx` carries the person and the app's token. The guest never sees either
   * and has no way to name them — it asks for a capability by name and the host
   * decides, under a context the guest cannot reach or influence.
   */
  async run(wasm: Uint8Array, ctx: InvocationContext, input: unknown): Promise<SandboxResult> {
    const shared = new SharedArrayBuffer(HEADER_BYTES + PAYLOAD_BYTES);
    const ctrl = new Int32Array(shared, 0, 2);
    const payload = new Uint8Array(shared, HEADER_BYTES);
    const enc = new TextEncoder(), dec = new TextDecoder();

    const worker = new Worker(WORKER, {
      workerData: {
        wasm, input: JSON.stringify(input), shared,
        maxMemoryPages: this.limits.maxMemoryPages,
      },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
    });

    const started = Date.now();
    const logs: string[] = [];
    let calls = 0;

    // A step machine cannot stop an infinite loop inside the guest, so the
    // deadline is enforced by terminating the thread. That is the difference
    // between a budget and a suggestion.
    let timer: NodeJS.Timeout | undefined;
    const result = new Promise<SandboxResult>((resolve, reject) => {
      timer = setTimeout(() => {
        void worker.terminate();
        reject(new SandboxError('deadline', `guest exceeded ${this.limits.deadlineMs}ms`));
      }, this.limits.deadlineMs);

      const reply = (body: { result?: unknown; error?: string }) => {
        const bytes = enc.encode(JSON.stringify(body));
        payload.set(bytes);
        Atomics.store(ctrl, IDX_LEN, bytes.length);
        Atomics.store(ctrl, IDX_STATE, STATE_REPLY);
        Atomics.notify(ctrl, IDX_STATE);
      };

      worker.on('message', (msg: { type: string; text?: string; output?: string; error?: string }) => {
        if (msg.type === 'log') { logs.push(msg.text ?? ''); return; }
        if (msg.type === 'done') { resolve({ output: msg.output ?? '', calls, ms: Date.now() - started, logs }); return; }
        if (msg.type === 'failed') { reject(new SandboxError('guest_error', msg.error ?? 'guest failed')); return; }

        if (msg.type === 'call') {
          const len = Atomics.load(ctrl, IDX_LEN);
          const req = JSON.parse(dec.decode(payload.subarray(0, len))) as
            { capability: string; args: string };

          if (++calls > this.limits.maxCalls) {
            reply({ error: `call budget of ${this.limits.maxCalls} exhausted` });
            return;
          }

          let parsed: unknown = {};
          try { parsed = req.args ? JSON.parse(req.args) : {}; }
          catch { reply({ error: 'arguments were not valid JSON' }); return; }

          // The token check lives here, in the host. A guest cannot reach it.
          this.host.invoke(ctx, req.capability, parsed)
            .then(r => reply({ result: r }))
            .catch((e: unknown) => reply({ error: e instanceof Error ? e.message : String(e) }));
        }
      });

      worker.on('error', e => reject(new SandboxError('worker_error', e.message)));
      worker.on('exit', code => {
        if (code !== 0) reject(new SandboxError('worker_exit', `worker exited with ${code}`));
      });
    });

    try {
      return await result;
    } finally {
      clearTimeout(timer);
      await worker.terminate();
    }
  }
}

/** Returns a plain (non-shared) buffer, which is what WebAssembly.Module wants. */
export async function loadWasm(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const file = await readFile(path);
  const out = new Uint8Array(new ArrayBuffer(file.byteLength));
  out.set(file);
  return out;
}
