/**
 * Open Glasses Protocol, version 1 (`ogp/1`).
 *
 * Devices are stateless and semantic: they receive intent ("show this card",
 * "speak this"), never pixels or raw buffers. That is what lets a 40-column
 * monochrome HUD and a 1080p framebuffer satisfy the same call.
 */
import { z } from 'zod';

export const PROTO_VERSION = 'ogp/1';

export const DisplayClass = z.enum(['none', 'text', 'rich', 'framebuffer']);

export const Capabilities = z.object({
  capture:  z.object({ still: z.boolean(), video: z.boolean().default(false),
                       max: z.tuple([z.number(), z.number()]).optional(),
                       indicator: z.enum(['none', 'software', 'hardwired']).default('none') }).optional(),
  listen:   z.object({ channels: z.number().default(1), rate: z.number().default(16000),
                       wakeword: z.boolean().default(false), vad: z.boolean().default(false) }).optional(),
  speak:    z.object({ codecs: z.array(z.string()).default(['pcm']),
                       transducer: z.enum(['speaker', 'bone', 'none']).default('speaker') }).optional(),
  display:  z.object({ class: DisplayClass, cols: z.number().optional(), rows: z.number().optional(),
                       mono: z.boolean().default(false),
                       anchor: z.array(z.enum(['head', 'world'])).default(['head']) }).optional(),
  location: z.object({ source: z.enum(['none', 'onboard', 'companion']) }).optional(),
  sensor:   z.object({ imu: z.boolean().default(false), presence: z.boolean().default(false),
                       tap: z.boolean().default(false) }).optional(),
});
export type Capabilities = z.infer<typeof Capabilities>;

/** First message after connect. The router caches it and routes against it. */
export const Announce = z.object({
  type: z.literal('announce'),
  proto: z.literal(PROTO_VERSION),
  device: z.object({
    id: z.string().min(3),
    kind: z.enum(['glasses', 'pendant', 'vehicle', 'speaker', 'watch', 'simulator']),
    make: z.string().default('unknown'),
    model: z.string().default('unknown'),
    firmware: z.string().default('0.0.0'),
  }),
  capabilities: Capabilities,
  limits: z.object({ uplink_kbps: z.number().default(1000),
                     max_payload_kb: z.number().default(512) })
           .default({ uplink_kbps: 1000, max_payload_kb: 512 }),
});

export const Authenticate = z.object({
  type: z.literal('authenticate'),
  device_key: z.string().min(8),   // stands in for real device attestation
});

/**
 * Sent the instant the user taps, before they have finished speaking. The node
 * starts encoding the frame immediately, so by the time the request arrives the
 * expensive half of vision is already done. This message is the whole reason
 * the end-to-end budget comes in under a second.
 */
export const Capture = z.object({
  type: z.literal('capture'),
  id: z.string(),
  image_ref: z.string().optional(),
  captured_at: z.string().optional(),
});

/** Sent when speech ends. Latency is measured from here, not from the tap. */
export const Request = z.object({
  type: z.literal('request'),
  id: z.string(),
  audio_ref: z.string(),
  audio_ms: z.number().optional(),
  /** What the speech actually was. The simulator supplies it so the mock STT
   *  is deterministic; a real device sends only audio. */
  transcript_hint: z.string().optional(),
});

export const State = z.object({
  type: z.literal('state'),
  battery_pct: z.number().min(0).max(100).optional(),
  worn: z.boolean().optional(),
  link_rssi: z.number().optional(),
});

export const Cancel = z.object({ type: z.literal('cancel'), id: z.string() });

export const ClientMessage = z.discriminatedUnion('type', [
  Announce, Authenticate, Capture, Request, State, Cancel,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Node → device. Every one is semantic. */
export type ServerMessage =
  | { type: 'ready'; proto: string; person: string; display: z.infer<typeof DisplayClass> }
  | { type: 'speak'; id: string; text: string; ms: number }
  | { type: 'display'; id: string; card: DisplayCard | null }
  | { type: 'notify'; title: string; body: string }
  | { type: 'error'; id?: string; code: string; message: string }
  | { type: 'timing'; id: string; ms: Record<string, number>; total_ms: number };

export interface DisplayCard {
  title: string;
  body?: string;
  meta?: string;
  ttl_ms: number;
}

/** Render a card for whatever the device can actually show. */
export function renderCard(card: DisplayCard, caps: Capabilities): DisplayCard | null {
  const d = caps.display;
  if (!d || d.class === 'none') return null;          // device speaks instead
  if (d.class === 'text') {
    const cols = d.cols ?? 40;
    const clip = (s: string) => (s.length > cols ? s.slice(0, cols - 1) + '…' : s);
    return { title: clip(card.title), body: card.body ? clip(card.body) : undefined,
             meta: card.meta ? clip(card.meta) : undefined, ttl_ms: card.ttl_ms };
  }
  return card;                                        // rich / framebuffer take it whole
}
