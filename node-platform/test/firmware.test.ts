import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ClientMessage, PROTO_VERSION } from '../src/proto.js';

/**
 * A contract test between the firmware and the gateway.
 *
 * The firmware has not been flashed — no one has run it on a board. What can be
 * checked without hardware is that the JSON it constructs is JSON the node will
 * actually accept, so the format strings are read out of main.cpp and parsed
 * with the same zod schema the gateway uses. Edit a format string and this test
 * reads the new one, which is the point: the two cannot drift apart quietly.
 *
 * It does not prove the pin map, the I2S timings, or that any of it runs.
 */
const SRC = fileURLToPath(new URL('../firmware/src/main.cpp', import.meta.url));

/** Join C adjacent string literals and unescape them. */
function extractMessages(source: string): Record<string, string> {
  const block = source.split('// OGP_MESSAGES_BEGIN')[1]?.split('// OGP_MESSAGES_END')[0];
  if (!block) throw new Error('message block markers not found in main.cpp');

  const out: Record<string, string> = {};
  const decl = /static const char\* (MSG_\w+)\s*=\s*((?:\s*"(?:[^"\\]|\\.)*")+)\s*;/g;
  for (const m of block.matchAll(decl)) {
    const literals = [...m[2]!.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(x => x[1]!);
    out[m[1]!] = literals.join('').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return out;
}

/** Fill printf placeholders with values of the right shape. */
function fill(fmt: string): string {
  return fmt
    .replace(/"%s"/g, '"sample-value"')   // quoted → a string
    // 42 rather than something larger: it satisfies every numeric constraint in
    // the protocol, including battery_pct's 0-100 range.
    .replace(/%d/g, '42')
    .replace(/%s/g, 'true');              // bare → a JSON literal (worn)
}

const source = await readFile(SRC, 'utf8');
const messages = extractMessages(source);

describe('firmware speaks the protocol the node parses', () => {
  it('found every message the firmware sends', () => {
    expect(Object.keys(messages).sort()).toEqual(
      ['MSG_ANNOUNCE', 'MSG_AUTHENTICATE', 'MSG_CANCEL', 'MSG_CAPTURE', 'MSG_REQUEST', 'MSG_STATE']);
  });

  for (const [name, fmt] of Object.entries(messages)) {
    it(`${name} is valid JSON`, () => {
      expect(() => JSON.parse(fill(fmt))).not.toThrow();
    });

    it(`${name} passes the gateway's schema`, () => {
      const parsed = ClientMessage.safeParse(JSON.parse(fill(fmt)));
      if (!parsed.success) throw new Error(`${name}: ${JSON.stringify(parsed.error.issues)}`);
      expect(parsed.success).toBe(true);
    });
  }

  it('announces the protocol version this node speaks', () => {
    const a = JSON.parse(fill(messages['MSG_ANNOUNCE']!));
    expect(a.proto).toBe(PROTO_VERSION);
  });

  it('declares no display, so the node falls back to speech', () => {
    const a = JSON.parse(fill(messages['MSG_ANNOUNCE']!));
    expect(a.capabilities.display.class).toBe('none');
  });

  it('declares a hardwired recording indicator', () => {
    // Software-driven is not good enough: the LED is the difference between a
    // device people tolerate and one that gets you asked to leave.
    const a = JSON.parse(fill(messages['MSG_ANNOUNCE']!));
    expect(a.capabilities.capture.indicator).toBe('hardwired');
  });
});

describe('firmware ordering matches the latency design', () => {
  it('uploads the frame before it streams audio', () => {
    const tap = source.split('static void onTap()')[1]?.split('\nstatic ')[0] ?? '';
    const capture = tap.indexOf('captureAndUpload');
    const audio = tap.indexOf('streamAudioUntilSilence');
    const request = tap.indexOf('MSG_REQUEST');
    expect(capture).toBeGreaterThan(-1);
    expect(audio).toBeGreaterThan(capture);      // frame first, while they speak
    expect(request).toBeGreaterThan(audio);      // request last, at end of speech
  });

  it('ends the utterance on silence rather than a fixed wait', () => {
    // A fixed wait would put the difference straight on the critical path,
    // since latency is measured from when the wearer stops talking.
    expect(source).toContain('OG_VAD_SILENCE_MS');
    expect(source).toMatch(/lastVoiceMs/);
  });

  it('keeps the radio in modem sleep', () => {
    expect(source).toContain('WIFI_PS_MAX_MODEM');
  });
});
