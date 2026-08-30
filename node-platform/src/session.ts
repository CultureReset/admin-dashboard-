/**
 * One device connection: the person bound to it, and the work in flight.
 *
 * Everything downstream reads `person` from here. No function below this file
 * takes a person as an argument, which is what makes isolation structural.
 */
import { CapabilityHost, InvocationContext } from './capabilities/host.js';
import { CapabilityToken, mint } from './capabilities/token.js';
import { PolicyBundle, evaluate, applyRedactions, Element } from './capabilities/policy.js';
import { PersonContext } from './store/db.js';
import { Pipeline, VisionHandle, VisionResult, FIXTURES } from './pipeline/index.js';
import { classify, degradeForBattery } from './router/classify.js';
import { appForIntent } from './apps/registry.js';
import { Capabilities, DisplayCard, renderCard } from './proto.js';

export interface DeviceState { id: string; batteryPct?: number; worn?: boolean }

export interface Answer {
  speak: string;
  card: DisplayCard | null;
  timing: Record<string, number>;
  totalMs: number;
  intent: string;
  level: string;
}

export class Session {
  /** Vision work started at tap time, keyed by request id. */
  private readonly inflight = new Map<string, Promise<VisionHandle>>();
  private readonly cancelled = new Set<string>();
  public state: DeviceState;

  constructor(
    public readonly person: PersonContext,
    public readonly caps: Capabilities,
    private readonly host: CapabilityHost,
    private readonly pipeline: Pipeline,
    private readonly policy: PolicyBundle,
    deviceId: string,
  ) { this.state = { id: deviceId }; }

  private ctxFor(appId: string, scopes: string[], egress: 'node' | 'external'): InvocationContext {
    const token: CapabilityToken = mint(appId, this.person.personId, scopes, { egress, ttlMs: 60_000 });
    return { person: this.person, token, policy: this.policy, device: this.state };
  }

  /** Tap. Start encoding the frame while the user is still speaking. */
  onCapture(id: string, imageRef?: string): void {
    if (!imageRef) return;
    const image = { ref: imageRef, exif: { gps: [51.5, -0.12], device: 'og-sim' } };
    const decision = evaluate(this.policy, [{ kind: 'image', value: image }], 'node');
    const redacted = applyRedactions({ kind: 'image', value: image }, decision.redactions);
    this.inflight.set(id, this.pipeline.visionPrepare(redacted.value as typeof image));
  }

  cancel(id: string): void { this.cancelled.add(id); this.inflight.delete(id); }

  /** Speech ended. Everything from here is on the critical path. */
  async onRequest(id: string, audioRef: string, transcriptHint?: string): Promise<Answer> {
    const t0 = Date.now();
    const timing: Record<string, number> = {};

    const visionPromise = this.inflight.get(id);
    this.inflight.delete(id);

    // STT runs while the frame — started at tap — finishes encoding.
    // Measure how long the encode actually *blocked*, not what it cost: work
    // that finished during the utterance costs nothing on the critical path,
    // and reporting its cost would hide the entire point of starting early.
    const tBefore = Date.now();
    const [stt, handle] = await Promise.all([
      this.pipeline.stt({ ref: audioRef, transcriptHint }),
      visionPromise ?? Promise.resolve(undefined),
    ]);
    const blocked = Date.now() - tBefore;
    timing['stt'] = stt.ms;
    timing['vision_prepare_blocked'] = Math.max(0, Math.round(blocked - stt.ms));

    if (this.cancelled.has(id)) {
      this.cancelled.delete(id);
      throw new Error('cancelled');
    }

    let intent = classify(stt.text);
    intent = degradeForBattery(intent, this.state.batteryPct);
    timing['classify'] = 0;

    let vision: VisionResult | undefined;
    if (handle && intent.needsImage) {
      vision = await this.pipeline.visionAnswer(handle, stt.text);
      timing['vision_answer'] = vision.ms;
    }

    // The observation is written by the capture pipeline, never by an app.
    let observationId: string | undefined;
    if (vision || intent.name === 'memory.remember') {
      const sysCtx = this.ctxFor('system.capture', ['observation.create'], 'node');
      const created = await this.host.invoke<{ id: string }>(sysCtx, 'observation.create', {
        kind: vision ? 'image' : 'text',
        description: vision?.description,
        transcript: stt.text,
        mediaRef: vision ? handle?.handle : undefined,
        deviceId: this.state.id,
        derivedBy: { stt: stt.model, ...(vision ? { vision: vision.model } : {}) },
        confidence: vision?.confidence,
      });
      observationId = created.id;
    }

    const app = appForIntent(intent);
    const appCtx = this.ctxFor(app.manifest.id, app.manifest.scopes, app.manifest.egress);
    const out = await app.run(appCtx, this.host, {
      intent, transcript: stt.text, vision, observationId,
    }, this.pipeline);

    const tts = await this.pipeline.tts(out.speak);
    timing['tts_first_chunk'] = tts.ms;

    return {
      speak: out.speak,
      card: out.card ? renderCard({ ...out.card }, this.caps) : null,
      timing,
      totalMs: Date.now() - t0,
      intent: intent.name,
      level: intent.level,
    };
  }
}

export const knownFixtures = () => Object.keys(FIXTURES);
export type { Element };
