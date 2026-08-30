import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalPipeline, LocalConfig, ModelError } from '../src/pipeline/local.js';

/**
 * The adapters are verified against a stub that speaks the real wire formats,
 * so the request shape is checked without needing models installed. What this
 * does not prove is answer quality — only that we talk to llama.cpp, LM Studio,
 * vLLM and Ollama correctly.
 */
let server: Server;
let port = 0;
let media: string;
const seen: { url: string; body: unknown }[] = [];

beforeAll(async () => {
  media = await mkdtemp(join(tmpdir(), 'og-media-'));
  await writeFile(join(media, 'eagle.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  await writeFile(join(media, 'clip.wav'), Buffer.from('RIFF....WAVEfmt '));

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = req.url ?? '';
      const json = (o: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(o));
      };

      if (url.endsWith('/v1/audio/transcriptions')) {
        seen.push({ url, body: raw.toString('utf8').slice(0, 400) });
        return json({ text: '  what is that?  ' });
      }
      if (url.endsWith('/v1/chat/completions')) {
        const body = JSON.parse(raw.toString()) as { messages: { content: unknown[] }[] };
        seen.push({ url, body });
        return json({ choices: [{ message: { content: 'a bald eagle' } }] });
      }
      if (url.endsWith('/api/chat')) {
        seen.push({ url, body: JSON.parse(raw.toString()) });
        return json({ message: { content: 'a bald eagle' } });
      }
      res.writeHead(404); res.end('no');
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});

afterAll(() => new Promise<void>(r => server.close(() => r())));

const cfg = (over: Partial<LocalConfig> = {}): LocalConfig => ({
  flavour: 'openai',
  sttUrl: `http://127.0.0.1:${port}`, sttModel: 'whisper-1',
  visionUrl: `http://127.0.0.1:${port}`, visionModel: 'local-vlm',
  ttsBin: 'piper', ttsVoice: 'v.onnx',
  mediaDir: media, timeoutMs: 3000, ...over,
});

describe('speech to text', () => {
  it('posts multipart audio and trims the result', async () => {
    const p = new LocalPipeline(cfg());
    const r = await p.stt({ ref: 'file:clip.wav' });
    expect(r.text).toBe('what is that?');
    expect(r.model).toBe('whisper-1');
    const call = seen.find(s => s.url.includes('transcriptions'))!;
    expect(String(call.body)).toContain('whisper-1');
    expect(String(call.body)).toContain('filename="audio.wav"');
  });

  it('reports which stage failed when the file is missing', async () => {
    const p = new LocalPipeline(cfg());
    await expect(p.stt({ ref: 'file:nope.wav' })).rejects.toThrow(ModelError);
    await expect(p.stt({ ref: 'file:nope.wav' })).rejects.toThrow(/media: could not read/);
  });
});

describe('vision, OpenAI-compatible', () => {
  it('sends the image as a data URL in a content array', async () => {
    const p = new LocalPipeline(cfg());
    const h = await p.visionPrepare({ ref: 'file:eagle.jpg' });
    const r = await p.visionAnswer(h, 'what is that?');
    expect(r.description).toBe('a bald eagle');
    expect(r.confidence).toBeGreaterThan(0.5);

    const call = seen.filter(s => s.url.includes('chat/completions')).pop() as
      { body: { messages: { content: { type: string; image_url?: { url: string } }[] }[] } };
    const parts = call.body.messages[0]!.content;
    expect(parts.find(c => c.type === 'text')).toBeTruthy();
    expect(parts.find(c => c.type === 'image_url')?.image_url?.url)
      .toMatch(/^data:image\/jpeg;base64,/);
  });

  it('warms the cache on prepare, then asks the real question on answer', async () => {
    seen.length = 0;
    const p = new LocalPipeline(cfg());
    const h = await p.visionPrepare({ ref: 'file:eagle.jpg' });
    expect(seen.filter(s => s.url.includes('chat')).length).toBe(1);   // the warm-up
    await p.visionAnswer(h, 'what kind of bird is that?');
    const calls = seen.filter(s => s.url.includes('chat'));
    expect(calls.length).toBe(2);
    expect(JSON.stringify(calls[1]!.body)).toContain('what kind of bird is that?');
  });

  it('refuses to answer against an image that was never staged', async () => {
    const p = new LocalPipeline(cfg());
    await expect(p.visionAnswer({ handle: 'ghost', ms: 0, model: 'x' }, 'q'))
      .rejects.toThrow(/never staged/);
  });

  it('lowers confidence when the model hedges', async () => {
    const hedging = createServer((_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: "I'm not sure, possibly a hawk" } }] }));
    });
    await new Promise<void>(r => hedging.listen(0, '127.0.0.1', r));
    const hp = (hedging.address() as { port: number }).port;
    const p = new LocalPipeline(cfg({ visionUrl: `http://127.0.0.1:${hp}` }));
    const h = await p.visionPrepare({ ref: 'file:eagle.jpg' });
    const r = await p.visionAnswer(h, 'what is that?');
    expect(r.confidence).toBeLessThan(0.5);
    await new Promise<void>(r2 => hedging.close(() => r2()));
  });
});

describe('vision, Ollama', () => {
  it('uses /api/chat with a bare images array', async () => {
    seen.length = 0;
    const p = new LocalPipeline(cfg({ flavour: 'ollama', visionModel: 'qwen2.5vl:3b' }));
    const h = await p.visionPrepare({ ref: 'file:eagle.jpg' });
    const r = await p.visionAnswer(h, 'what is that?');
    expect(r.description).toBe('a bald eagle');
    const call = seen.filter(s => s.url.endsWith('/api/chat')).pop() as
      { body: { model: string; stream: boolean; messages: { images: string[] }[] } };
    expect(call.body.model).toBe('qwen2.5vl:3b');
    expect(call.body.stream).toBe(false);
    expect(call.body.messages[0]!.images).toHaveLength(1);
  });
});

describe('failures name the stage', () => {
  it('surfaces a non-200 with the status, and the warm-up never fails the request', async () => {
    const broken = createServer((_q, res) => { res.writeHead(503); res.end('model not loaded'); });
    await new Promise<void>(r => broken.listen(0, '127.0.0.1', r));
    const bp = (broken.address() as { port: number }).port;
    const p = new LocalPipeline(cfg({ visionUrl: `http://127.0.0.1:${bp}` }));

    // A failed warm-up is swallowed: it is an optimisation, not a dependency.
    const h = await p.visionPrepare({ ref: 'file:eagle.jpg' });
    expect(h.handle).toBe('file:eagle.jpg');

    // The answer call is a dependency, so it surfaces with the stage and status.
    await expect(p.visionAnswer(h, 'q')).rejects.toThrow(/vision:.*503/);
    await new Promise<void>(r => broken.close(() => r()));
  });

  it('times out rather than hanging', async () => {
    const slow = createServer(() => { /* never responds */ });
    await new Promise<void>(r => slow.listen(0, '127.0.0.1', r));
    const sp = (slow.address() as { port: number }).port;
    const p = new LocalPipeline(cfg({ sttUrl: `http://127.0.0.1:${sp}`, timeoutMs: 200 }));
    await expect(p.stt({ ref: 'file:clip.wav' })).rejects.toThrow(/timed out after 200ms/);
    await new Promise<void>(r => slow.close(() => r()));
  });
});
