/**
 * The three V1 apps, built against the same capability API third parties will
 * eventually get. First-party for now: no sandbox, no app store, but the exact
 * surface — so when the WASM host arrives nothing about these has to change.
 */
import { CapabilityHost, InvocationContext } from '../capabilities/host.js';
import { Intent } from '../router/classify.js';
import { Pipeline, VisionResult } from '../pipeline/index.js';
import { ObservationRow, ListItemRow } from '../capabilities/handlers.js';

export interface AppManifest {
  id: string;
  name: string;
  intents: string[];
  /** What the app may call. `observation.create` is deliberately absent from
   *  every third-party set: an app that could forge an observation could forge
   *  your memory. */
  scopes: string[];
  egress: 'node' | 'external';
}

export interface AppInput {
  intent: Intent;
  transcript: string;
  /** Present only when the request carried a frame and policy allowed vision. */
  vision?: VisionResult;
  observationId?: string;
}

export interface AppOutput {
  speak: string;
  card?: { title: string; body?: string; meta?: string; ttl_ms: number };
}

export interface App {
  manifest: AppManifest;
  run(ctx: InvocationContext, host: CapabilityHost, input: AppInput,
      pipeline: Pipeline): Promise<AppOutput>;
}

/** "What is this?" — proves capture → vision → speech, the whole latency path. */
export const whatIsThis: App = {
  manifest: {
    id: 'what-is-this', name: 'What is this?',
    intents: ['vision.identify', 'unknown'],
    scopes: ['observation.search'], egress: 'node',
  },
  async run(_ctx, _host, input) {
    if (!input.vision) {
      return { speak: "I couldn't see anything just then." };
    }
    const { description, confidence } = input.vision;
    if (confidence < 0.5) {
      return {
        speak: `I'm not sure. It might be ${description}.`,
        card: { title: 'Uncertain', body: description,
                meta: `${Math.round(confidence * 100)}%`, ttl_ms: 4000 },
      };
    }
    const article = description.replace(/^(a|an)\s+/i, '');
    return {
      speak: `That's ${description}.`,
      card: { title: article.split(',')[0] ?? article, body: article.split(',')[1]?.trim(),
              meta: `${Math.round(confidence * 100)}% confident`, ttl_ms: 4000 },
    };
  },
};

/** "Remember this." — proves the observation schema and retrieval. */
export const rememberThis: App = {
  manifest: {
    id: 'remember-this', name: 'Remember this',
    intents: ['memory.remember', 'memory.recall'],
    scopes: ['observation.search', 'entity.create', 'kv.*'], egress: 'node',
  },
  async run(ctx, host, input) {
    if (input.intent.name === 'memory.remember') {
      const what = input.vision?.description ?? input.transcript;
      if (input.observationId) {
        await host.invoke(ctx, 'entity.create', {
          kind: 'memory', name: what, observationId: input.observationId,
          attrs: { said: input.transcript },
        });
      }
      return {
        speak: `Saved. ${what}.`,
        card: { title: 'Remembered', body: what, ttl_ms: 3000 },
      };
    }

    // Recall is a SQL query over observations, not a model recalling something.
    const what = input.intent.slots['what'] ?? '';
    const found = await host.invoke<{ match: 'exact' | 'recent' | 'none'; rows: ObservationRow[] }>(
      ctx, 'observation.search', { q: what || null, limit: 5 });

    if (found.match === 'none' || found.rows.length === 0) {
      return { speak: what ? `I have no record of ${what}.` : 'I have nothing recorded.' };
    }

    const top = found.rows[0]!;
    const when = new Date(top.captured_at).toLocaleString();
    const desc = top.description ?? top.transcript ?? 'something';

    // Say how the answer was found. Silently downgrading and sounding equally
    // confident is the failure mode that makes assistants untrustworthy.
    const speak = found.match === 'exact'
      ? `You saw ${desc} on ${when}.`
      : `Nothing matched "${what}" exactly. The most recent thing I have is ${desc}, on ${when}.`;

    return {
      speak,
      card: { title: desc, meta: found.match === 'exact' ? when : `${when} · closest match`, ttl_ms: 5000 },
    };
  },
};

/** "Add this to my list." — proves intent routing, tokens and per-person isolation. */
export const addToList: App = {
  manifest: {
    id: 'add-to-list', name: 'Lists',
    intents: ['list.add'],
    scopes: ['list.add', 'list.get', 'observation.search'], egress: 'node',
  },
  async run(ctx, host, input) {
    const list = input.intent.slots['list'] || 'my';
    const title = input.vision?.description ?? input.transcript;
    await host.invoke(ctx, 'list.add', {
      list, title, observationId: input.observationId ?? undefined,
      note: input.vision ? `seen · ${Math.round(input.vision.confidence * 100)}%` : undefined,
    });
    const items = await host.invoke<ListItemRow[]>(ctx, 'list.get', { list });
    return {
      speak: `Added ${title} to the ${list} list.`,
      card: { title: `${list} list`, body: title, meta: `${items.length} items`, ttl_ms: 3500 },
    };
  },
};

/** L0 device commands. No model is involved at all — this is the point of L0. */
export const deviceControl: App = {
  manifest: {
    id: 'device', name: 'Device',
    intents: ['device.volume', 'device.brightness', 'device.stop'],
    scopes: [], egress: 'node',
  },
  async run(_ctx, _host, input) {
    const said: Record<string, string> = {
      'device.volume': 'Volume changed.',
      'device.brightness': 'Brightness changed.',
      'device.stop': 'Stopped.',
    };
    return { speak: said[input.intent.name] ?? 'Done.' };
  },
};

export const APPS: App[] = [whatIsThis, rememberThis, addToList, deviceControl];

export function appForIntent(intent: Intent): App {
  return APPS.find(a => a.manifest.intents.includes(intent.name)) ?? whatIsThis;
}
