/**
 * Real model backends, behind the same four methods as the mock.
 *
 * Nothing above this file changes when you switch — `loadPipeline()` is the only
 * seam. Two flavours are supported because they cover almost every local setup:
 *
 *   openai   llama.cpp --server, LM Studio, vLLM, whisper.cpp --server
 *   ollama   ollama serve
 *
 * Configure with environment variables; see `describeConfig()` for the list.
 */
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {
  Pipeline, AudioRef, ImageRef, SttResult, TtsResult, VisionHandle, VisionResult,
} from './index.js';

export interface LocalConfig {
  flavour: 'openai' | 'ollama';
  sttUrl: string;
  sttModel: string;
  visionUrl: string;
  visionModel: string;
  ttsBin: string;
  ttsVoice: string;
  /** Where `fixture:` and bare refs resolve from. */
  mediaDir: string;
  timeoutMs: number;
}

export function configFromEnv(): LocalConfig {
  const e = process.env;
  const flavour = (e['OG_FLAVOUR'] ?? 'openai') as 'openai' | 'ollama';
  return {
    flavour,
    sttUrl:      e['OG_STT_URL']    ?? 'http://127.0.0.1:8081',
    sttModel:    e['OG_STT_MODEL']  ?? 'whisper-1',
    visionUrl:   e['OG_VLM_URL']    ?? (flavour === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:8080'),
    visionModel: e['OG_VLM_MODEL']  ?? (flavour === 'ollama' ? 'qwen2.5vl:3b' : 'local-vlm'),
    ttsBin:      e['OG_TTS_BIN']    ?? 'piper',
    ttsVoice:    e['OG_TTS_VOICE']  ?? 'en_GB-alba-medium.onnx',
    mediaDir:    e['OG_MEDIA_DIR']  ?? './media',
    timeoutMs:   Number(e['OG_TIMEOUT_MS'] ?? 20_000),
  };
}

export function describeConfig(c: LocalConfig): string {
  return [
    `flavour  ${c.flavour}`,
    `stt      ${c.sttModel} @ ${c.sttUrl}`,
    `vision   ${c.visionModel} @ ${c.visionUrl}`,
    `tts      ${c.ttsBin} ${c.ttsVoice}`,
  ].join('\n  ');
}

export class ModelError extends Error {
  constructor(public readonly stage: string, message: string) {
    super(`${stage}: ${message}`); this.name = 'ModelError';
  }
}

export class LocalPipeline implements Pipeline {
  readonly name: string;
  /** Image bytes held only for the life of a request, keyed by handle. */
  private readonly staged = new Map<string, string>();

  constructor(private readonly cfg: LocalConfig) {
    this.name = `local(${cfg.flavour})`;
  }

  // --- speech to text -----------------------------------------------------
  async stt(audio: AudioRef): Promise<SttResult> {
    const t0 = Date.now();
    const bytes = await this.readMedia(audio.ref);
    const form = new FormData();
    form.append('model', this.cfg.sttModel);
    form.append('response_format', 'json');
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'audio.wav');

    const body = await this.post<{ text?: string }>(
      `${this.cfg.sttUrl}/v1/audio/transcriptions`, form, 'stt');
    if (typeof body.text !== 'string') throw new ModelError('stt', 'response had no text field');
    return { text: body.text.trim(), ms: Date.now() - t0, model: this.cfg.sttModel };
  }

  // --- vision -------------------------------------------------------------
  /**
   * Encode the image. Started at tap time, so its cost lands during the
   * utterance rather than on the critical path.
   *
   * Over HTTP there is no separate "encode" call, so this warms the backend's
   * prefix cache with the image and a trivial prompt. The saving is real but it
   * depends on the backend actually caching prefixes — llama.cpp and Ollama do.
   * If yours does not, this costs one extra cheap call and saves nothing, which
   * is why it is measured (`vision_prepare_blocked`) rather than assumed.
   */
  async visionPrepare(image: ImageRef): Promise<VisionHandle> {
    const t0 = Date.now();
    const b64 = (await this.readMedia(image.ref)).toString('base64');
    this.staged.set(image.ref, b64);
    try {
      await this.chatWithImage(b64, 'Reply with the single word: ready.', 8);
    } catch {
      // A failed warm-up must not fail the request; the answer call will retry.
    }
    return { handle: image.ref, ms: Date.now() - t0, model: this.cfg.visionModel };
  }

  async visionAnswer(handle: VisionHandle, question: string, context?: string[]): Promise<VisionResult> {
    const t0 = Date.now();
    const b64 = this.staged.get(handle.handle);
    if (!b64) throw new ModelError('vision', 'image was never staged; call visionPrepare first');

    const prompt = [
      'Identify what the user is asking about in one short noun phrase.',
      'Do not add commentary. If unsure, say so plainly.',
      ...(context?.length ? [`Context the user already has: ${context.join('; ')}`] : []),
      `User asked: ${question}`,
    ].join('\n');

    const text = await this.chatWithImage(b64, prompt, 96);
    this.staged.delete(handle.handle);

    return {
      description: text.trim(),
      // Local models rarely return calibrated logprobs; a hedge in the wording
      // is the honest signal available, so it is what we use.
      confidence: /not sure|unsure|cannot tell|unclear/i.test(text) ? 0.35 : 0.85,
      ms: Date.now() - t0,
      model: this.cfg.visionModel,
    };
  }

  private async chatWithImage(b64: string, prompt: string, maxTokens: number): Promise<string> {
    if (this.cfg.flavour === 'ollama') {
      const body = await this.post<{ message?: { content?: string } }>(
        `${this.cfg.visionUrl}/api/chat`,
        { model: this.cfg.visionModel, stream: false,
          options: { num_predict: maxTokens },
          messages: [{ role: 'user', content: prompt, images: [b64] }] },
        'vision');
      const out = body.message?.content;
      if (typeof out !== 'string') throw new ModelError('vision', 'ollama response had no message.content');
      return out;
    }

    const body = await this.post<{ choices?: { message?: { content?: string } }[] }>(
      `${this.cfg.visionUrl}/v1/chat/completions`,
      { model: this.cfg.visionModel, max_tokens: maxTokens, temperature: 0.2,
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ] }] },
      'vision');
    const out = body.choices?.[0]?.message?.content;
    if (typeof out !== 'string') throw new ModelError('vision', 'response had no choices[0].message.content');
    return out;
  }

  // --- text to speech -----------------------------------------------------
  /** Piper as a subprocess. Measured to first bytes, since playback streams. */
  async tts(text: string): Promise<TtsResult> {
    const t0 = Date.now();
    const bytes = await new Promise<number>((resolve, reject) => {
      const p = spawn(this.cfg.ttsBin, ['--model', this.cfg.ttsVoice, '--output_raw'],
                      { stdio: ['pipe', 'pipe', 'pipe'] });
      let total = 0, settled = false;
      const t = setTimeout(() => { p.kill(); reject(new ModelError('tts', 'timed out')); },
                           this.cfg.timeoutMs);
      p.stdout.on('data', (c: Buffer) => {
        total += c.length;
        // Resolve on the first chunk: that is when audio can start playing.
        if (!settled) { settled = true; clearTimeout(t); resolve(total); }
      });
      p.on('error', e => { clearTimeout(t); reject(new ModelError('tts', e.message)); });
      p.on('close', code => {
        clearTimeout(t);
        if (!settled) code === 0 ? resolve(total) : reject(new ModelError('tts', `piper exited ${code}`));
      });
      p.stdin.end(text);
    });
    return { ms: Date.now() - t0, model: `piper:${this.cfg.ttsVoice}`, bytes };
  }

  // --- plumbing -----------------------------------------------------------
  private async readMedia(ref: string): Promise<Buffer> {
    const path = ref.startsWith('/') ? ref
      : `${this.cfg.mediaDir}/${ref.replace(/^[a-z]+:/, '')}`;
    try {
      return await readFile(path);
    } catch {
      throw new ModelError('media', `could not read ${path}`);
    }
  }

  private async post<T>(url: string, body: unknown, stage: string): Promise<T> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    try {
      const isForm = body instanceof FormData;
      const res = await fetch(url, {
        method: 'POST',
        ...(isForm ? {} : { headers: { 'content-type': 'application/json' } }),
        body: isForm ? body : JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!res.ok) {
        throw new ModelError(stage, `${url} returned ${res.status} ${await res.text().catch(() => '')}`.trim());
      }
      return await res.json() as T;
    } catch (e) {
      if (e instanceof ModelError) throw e;
      const why = e instanceof Error && e.name === 'AbortError'
        ? `timed out after ${this.cfg.timeoutMs}ms`
        : e instanceof Error ? e.message : String(e);
      throw new ModelError(stage, `${url} — ${why}`);
    } finally {
      clearTimeout(t);
    }
  }
}
