/**
 * Adapts a sandboxed WebAssembly module to the same App interface the
 * first-party apps implement.
 *
 * Nothing else in the system knows the difference. The router dispatches to it
 * identically, the capability host gates it identically, and the person context
 * it runs under is the one from the session — which is the whole point of
 * keeping first-party apps on the third-party surface from the start.
 */
import { App, AppInput, AppOutput, AppManifest } from './registry.js';
import { CapabilityHost, InvocationContext } from '../capabilities/host.js';
import { Sandbox } from '../wasm/sandbox.js';
import { SandboxLimits, DEFAULT_LIMITS } from '../wasm/protocol.js';
import { Pipeline } from '../pipeline/index.js';

export class WasmApp implements App {
  private readonly sandbox: Sandbox;

  constructor(
    public readonly manifest: AppManifest,
    private readonly wasm: Uint8Array,
    host: CapabilityHost,
    limits: SandboxLimits = DEFAULT_LIMITS,
  ) {
    this.sandbox = new Sandbox(host, limits);
  }

  async run(ctx: InvocationContext, _host: CapabilityHost, input: AppInput,
            _pipeline: Pipeline): Promise<AppOutput> {
    // The guest sees the request, never the person, the token or the database.
    const payload = {
      description: input.vision?.description ?? '',
      confidence: input.vision?.confidence ?? 0,
      transcript: input.transcript,
      intent: input.intent.name,
    };

    const result = await this.sandbox.run(this.wasm, ctx, payload);
    let parsed: AppOutput;
    try {
      parsed = JSON.parse(result.output) as AppOutput;
    } catch {
      throw new Error(`${this.manifest.id} returned output that was not JSON`);
    }
    if (typeof parsed.speak !== 'string') {
      throw new Error(`${this.manifest.id} returned no speak field`);
    }
    return parsed;
  }
}
