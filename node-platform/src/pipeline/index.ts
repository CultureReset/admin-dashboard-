/**
 * Speech, vision and speech synthesis as pure functions.
 *
 * The model is a pure function: everything person-specific arrives as an
 * argument and nothing persists between calls. Retrieval happens in the
 * capability layer, scoped to the person, and its results are passed in — the
 * model never reaches out and fetches anything.
 *
 * Vision is deliberately split in two. Encoding an image is the expensive part
 * and it does not need the question, so it runs while the user is still
 * speaking. Only the short text prefill is left on the critical path once they
 * stop. That split is worth roughly half a second and it is the reason this
 * interface is shaped the way it is.
 */
export interface SttResult { text: string; ms: number; model: string }
export interface VisionHandle { handle: string; ms: number; model: string }
export interface VisionResult { description: string; confidence: number; ms: number; model: string }
export interface TtsResult { ms: number; model: string; bytes: number }

export interface AudioRef { ref: string; durationMs?: number; transcriptHint?: string }
export interface ImageRef { ref: string; width?: number; height?: number; exif?: Record<string, unknown> }

export interface Pipeline {
  name: string;
  stt(audio: AudioRef): Promise<SttResult>;
  /** Encode image tokens. Start this at tap time, not at end of speech. */
  visionPrepare(image: ImageRef): Promise<VisionHandle>;
  /** `context` is retrieval already scoped to the person by the caller. */
  visionAnswer(handle: VisionHandle, question: string, context?: string[]): Promise<VisionResult>;
  tts(text: string): Promise<TtsResult>;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Deterministic stand-in. Latencies approximate a GPU-class node so the
 * end-to-end budget is exercised honestly rather than instantly.
 */
export class MockPipeline implements Pipeline {
  name = 'mock';
  constructor(private readonly speed = 1) {}

  private async cost(ms: number) { await sleep(ms / this.speed); return ms / this.speed; }

  async stt(audio: AudioRef): Promise<SttResult> {
    const ms = await this.cost(250);
    return { text: audio.transcriptHint ?? '', ms, model: 'mock-whisper-small' };
  }

  async visionPrepare(image: ImageRef): Promise<VisionHandle> {
    const ms = await this.cost(450);            // the expensive half
    return { handle: image.ref, ms, model: 'mock-qwen3-vl-4b-q4' };
  }

  async visionAnswer(handle: VisionHandle, _question: string, context?: string[]): Promise<VisionResult> {
    const ms = await this.cost(300);            // text prefill + first tokens
    const known = FIXTURES[handle.handle];
    return {
      description: known ?? 'an object I cannot identify with confidence',
      confidence: known ? (context?.length ? 0.95 : 0.92) : 0.31,
      ms, model: handle.model,
    };
  }

  async tts(text: string): Promise<TtsResult> {
    const ms = await this.cost(150);
    return { ms, model: 'mock-piper', bytes: text.length * 320 };
  }
}

/** Named image fixtures so the simulator and tests are deterministic. */
export const FIXTURES: Record<string, string> = {
  'fixture:eagle':  'a bald eagle, Haliaeetus leucocephalus',
  'fixture:lego':   'a Lego Millennium Falcon set, box number 75257',
  'fixture:plant':  'a fiddle-leaf fig, Ficus lyrata',
  'fixture:boat':   'a Boston Whaler 170 Montauk centre-console',
  'fixture:shoes':  'a pair of tan suede desert boots',
  'fixture:engine': 'a four-cylinder engine bay with a cracked coolant hose',
};

/**
 * Real backends plug in here, behind the same interface, so the node can be
 * built and measured end to end before any model is installed.
 */
export async function loadPipeline(): Promise<Pipeline> {
  const kind = process.env['OG_PIPELINE'] ?? 'mock';
  if (kind === 'mock') return new MockPipeline(Number(process.env['OG_SPEED'] ?? 1));
  if (kind === 'local') {
    const { LocalPipeline, configFromEnv } = await import('./local.js');
    return new LocalPipeline(configFromEnv());
  }
  throw new Error(`unknown pipeline "${kind}". Use "mock" or "local".`);
}
