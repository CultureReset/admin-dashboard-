/**
 * Classify once at the edge, dispatch directly.
 *
 * Both the deck and the architecture doc describe escalation as a ladder — try
 * local, then the node, then the cloud. Each rung costs a full round trip, so
 * the requests that need the most help are punished the most. This classifies
 * once and routes straight to the level that can answer.
 */
export type Level = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface Intent {
  name: string;
  level: Level;
  /** Whether the current camera frame is part of the request. */
  needsImage: boolean;
  slots: Record<string, string>;
  confidence: number;
}

interface Rule {
  name: string;
  level: Level;
  needsImage: boolean;
  patterns: RegExp[];
  slots?: (m: RegExpMatchArray) => Record<string, string>;
}

const RULES: Rule[] = [
  // L0 — deterministic device commands. No model touches these at all.
  { name: 'device.volume', level: 'L0', needsImage: false,
    patterns: [/\b(volume|turn it)\s+(up|down)\b/i, /\b(louder|quieter)\b/i] },
  { name: 'device.brightness', level: 'L0', needsImage: false,
    patterns: [/\bbright(er|ness)\b/i, /\bdim(mer)?\b/i] },
  { name: 'device.stop', level: 'L0', needsImage: false,
    patterns: [/^\s*(stop|cancel|never ?mind)\b/i] },

  // L3 — the node. Personal data and multimodal reasoning.
  { name: 'list.add', level: 'L3', needsImage: true,
    patterns: [
      /\b(add|put)\s+(this|that|it)\b.*?\b(to|on)\b\s+(?<list>.+?)(?:\s+list)?\s*$/i,
      /\b(add|put)\s+(this|that|it)\b.*?\blist\b/i,
    ],
    slots: (m) => ({ list: (m.groups?.['list'] ?? 'my').replace(/^(my|the)\s+/i, '').trim() }) },

  { name: 'memory.remember', level: 'L3', needsImage: true,
    patterns: [/\bremember (this|that|it)\b/i, /\bsave (this|that|it)\b/i, /\bnote this\b/i] },

  { name: 'memory.recall', level: 'L3', needsImage: false,
    patterns: [
      /\bwhere did i (?:see|put|leave)\s+(?<what>.+?)\s*\??$/i,
      /\bwhat did i (?:see|look at)\b\s*(?<what>.*?)\s*\??$/i,
      /\bwhen did i (?:see)\s+(?<what>.+?)\s*\??$/i,
    ],
    slots: (m) => ({ what: (m.groups?.['what'] ?? '').replace(/^(the|those|that|a)\s+/i, '').trim() }) },

  { name: 'vision.identify', level: 'L3', needsImage: true,
    patterns: [
      /\bwhat(?:'s| is| kind of| type of)?\b.*\b(this|that|it)\b/i,
      /\bidentify (this|that|it)\b/i,
      /\bwhat am i looking at\b/i,
    ] },
];

export function classify(utterance: string): Intent {
  const text = utterance.trim();
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      const m = text.match(p);
      if (m) {
        return {
          name: rule.name,
          level: rule.level,
          needsImage: rule.needsImage,
          slots: rule.slots ? rule.slots(m) : {},
          // Deterministic commands are certain; the rest are pattern confidence.
          confidence: rule.level === 'L0' ? 1 : 0.8,
        };
      }
    }
  }
  return { name: 'unknown', level: 'L3', needsImage: true, slots: {}, confidence: 0.2 };
}

/**
 * Battery is a routing input on a wearable. Under 15% we stop shipping images
 * and answer from audio alone rather than silently draining the device.
 */
export function degradeForBattery(intent: Intent, batteryPct?: number): Intent {
  if (batteryPct === undefined || batteryPct >= 15) return intent;
  return { ...intent, needsImage: false };
}
