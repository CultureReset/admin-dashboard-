/**
 * The glasses, in software.
 *
 * The device is stateless by design, so this is a complete stand-in for the
 * real hardware — which is why firmware is the ninth file to write and not the
 * first. Debugging the architecture here takes seconds; debugging it through a
 * serial cable takes minutes.
 */
import WebSocket from 'ws';
import { PROTO_VERSION } from '../proto.js';

interface Args {
  url: string; key: string; device: string;
  say?: string; image?: string; battery?: number; worn: boolean;
  utteranceMs: number; scenario: boolean; cold: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const person = get('person') ?? 'matt';
  return {
    url: get('url') ?? `ws://localhost:${process.env['OG_PORT'] ?? 8787}`,
    key: get('key') ?? `devkey-${person}-0001`,
    device: get('device') ?? `glasses-${person}`,
    ...(get('say') !== undefined ? { say: get('say')! } : {}),
    ...(get('image') !== undefined ? { image: get('image')! } : {}),
    ...(get('battery') !== undefined ? { battery: Number(get('battery')) } : {}),
    worn: get('worn') !== 'false',
    utteranceMs: Number(get('utterance-ms') ?? 1500),
    scenario: argv.includes('--scenario'),
    // --cold skips the tap-time capture, so the image encode lands on the
    // critical path instead of running under the utterance. Run it both ways
    // to see what the early upload is actually worth.
    cold: argv.includes('--cold'),
  };
}

const CAPS = {
  capture: { still: true, video: false, indicator: 'hardwired' as const },
  listen:  { channels: 2, rate: 16000, wakeword: true, vad: true },
  speak:   { codecs: ['opus'], transducer: 'bone' as const },
  display: { class: 'text' as const, cols: 40, rows: 5, mono: true, anchor: ['head' as const] },
  sensor:  { imu: true, presence: true, tap: true },
};

const SCENARIO: { say: string; image?: string }[] = [
  { say: 'what is that?',                          image: 'fixture:eagle' },
  { say: 'add this to my christmas list',          image: 'fixture:lego' },
  { say: 'remember this',                          image: 'fixture:shoes' },
  { say: 'where did i see those shoes?' },
  { say: 'turn the volume up' },
  { say: 'what kind of boat is that?',             image: 'fixture:boat' },
];

class Glasses {
  private ws!: WebSocket;
  private seq = 0;
  private pending = new Map<string, (v: Record<string, unknown>) => void>();
  private buffer = new Map<string, Record<string, unknown>>();

  constructor(private readonly args: Args) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.args.url);
      this.ws.on('error', reject);
      this.ws.on('open', () => {
        this.send({ type: 'announce', proto: PROTO_VERSION,
          device: { id: this.args.device, kind: 'glasses', make: 'sim', model: 'v1', firmware: '0.1.0' },
          capabilities: CAPS, limits: { uplink_kbps: 8000, max_payload_kb: 512 } });
        this.send({ type: 'authenticate', device_key: this.args.key });
      });
      this.ws.on('message', (raw) => {
        const m = JSON.parse(String(raw)) as Record<string, unknown>;
        if (m['type'] === 'ready') { resolve(); return; }
        if (m['type'] === 'error' && !m['id']) { reject(new Error(String(m['message']))); return; }
        const id = m['id'] as string | undefined;
        if (!id) return;
        const key = `${id}:${m['type']}`;
        this.buffer.set(key, m);
        this.pending.get(key)?.(m);
      });
    });
  }

  private send(m: unknown) { this.ws.send(JSON.stringify(m)); }

  private await1(id: string, type: string, ms = 8000): Promise<Record<string, unknown>> {
    const key = `${id}:${type}`;
    const had = this.buffer.get(key);
    if (had) { this.buffer.delete(key); return Promise.resolve(had); }
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timed out waiting for ${type}`)), ms);
      this.pending.set(key, (v) => { clearTimeout(t); this.pending.delete(key); res(v); });
    });
  }

  state(batteryPct?: number, worn = true) {
    this.send({ type: 'state', ...(batteryPct !== undefined ? { battery_pct: batteryPct } : {}), worn });
  }

  /** One interaction, timed the way a person experiences it. */
  async ask(say: string, image?: string): Promise<void> {
    const id = `req-${++this.seq}`;

    // Tap. The frame goes up now, while the user is still talking.
    if (!this.args.cold) {
      this.send({ type: 'capture', id, ...(image ? { image_ref: image } : {}),
                  captured_at: new Date().toISOString() });
    }

    // The user speaks. This is not latency — it is their time, not the system's.
    await new Promise(r => setTimeout(r, this.args.utteranceMs));

    // Cold path: the frame only goes up now, so its encode is on the clock.
    if (this.args.cold) {
      this.send({ type: 'capture', id, ...(image ? { image_ref: image } : {}),
                  captured_at: new Date().toISOString() });
    }

    // End of speech. The clock that matters starts here.
    const t0 = Date.now();
    this.send({ type: 'request', id, audio_ref: `audio:${id}`,
                audio_ms: this.args.utteranceMs, transcript_hint: say });

    const [speak, display, timing] = await Promise.all([
      this.await1(id, 'speak'), this.await1(id, 'display'), this.await1(id, 'timing'),
    ]).catch(async (e) => {
      const err = await this.await1(id, 'error', 500).catch(() => null);
      throw new Error(err ? String(err['message']) : (e as Error).message);
    });

    const wall = Date.now() - t0;
    console.log(`\n  ▸ "${say}"${image ? `  [${image}]` : ''}`);
    console.log(`    speak    ${speak['text']}`);
    const card = display['card'] as Record<string, string> | null;
    console.log(card
      ? `    lens     ${card['title']}${card['body'] ? ' / ' + card['body'] : ''}${card['meta'] ? ' / ' + card['meta'] : ''}`
      : `    lens     (no display on this device — spoken only)`);
    const ms = timing['ms'] as Record<string, number>;
    const parts = Object.entries(ms).filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}=${Math.round(v)}ms`).join('  ');
    console.log(`    timing   ${parts}`);
    console.log(`    total    ${wall}ms from end of speech`);
  }

  close() { this.ws.close(); }
}

const args = parseArgs(process.argv.slice(2));
const g = new Glasses(args);
await g.connect();
console.log(`connected · ${args.device} · ${args.worn ? 'worn' : 'NOT worn'}` +
            (args.cold ? ' · COLD (no tap-time upload)' : '') +
            (args.battery !== undefined ? ` · battery ${args.battery}%` : ''));
g.state(args.battery, args.worn);

if (args.scenario) {
  for (const step of SCENARIO) await g.ask(step.say, step.image);
} else {
  await g.ask(args.say ?? 'what is that?', args.image ?? 'fixture:eagle');
}
g.close();
