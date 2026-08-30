/**
 * Policy is evaluated per data element, not per request.
 *
 * "Add this to my Christmas list" carries an image that may want an external
 * vision model and list contents that must never leave. One slider cannot
 * express that, so the router decomposes the request and each part takes its
 * own exit — with the strictest element capping the request as a whole.
 */
export type Destination = 'local' | 'node' | 'private_cloud' | 'external';

const RANK: Record<Destination, number> = { local: 0, node: 1, private_cloud: 2, external: 3 };

export interface PolicyBundle {
  personId: string;
  /** Ceiling per element kind. Absent kinds fall back to `default`. */
  elements: Partial<Record<ElementKind, Destination>>;
  default: Destination;
  /** Redactors applied before anything leaves the node. */
  redact: string[];
}

export type ElementKind =
  | 'image' | 'audio' | 'transcript' | 'location'
  | 'list_contents' | 'personal_memory' | 'contacts';

export interface Element { kind: ElementKind; value: unknown }

export interface PolicyDecision {
  /** The strictest ceiling across all elements. */
  destination: Destination;
  /** Elements that may travel to that destination, after redaction. */
  allowed: Element[];
  /** Elements held back, with the reason. */
  withheld: { kind: ElementKind; ceiling: Destination }[];
  redactions: string[];
}

export function ceilingFor(bundle: PolicyBundle, kind: ElementKind): Destination {
  return bundle.elements[kind] ?? bundle.default;
}

/**
 * Decide where a request may run, and what may accompany it.
 *
 * Note the two different questions: the request's destination is capped by its
 * strictest element, but a stricter element is not necessarily dropped — it is
 * simply not sent onward when the destination exceeds its own ceiling.
 */
export function evaluate(bundle: PolicyBundle, elements: Element[], want: Destination): PolicyDecision {
  const ceilings = elements.map(e => ceilingFor(bundle, e.kind));
  const strictest = ceilings.reduce<Destination>(
    (acc, c) => (RANK[c] < RANK[acc] ? c : acc), want);

  const allowed: Element[] = [];
  const withheld: { kind: ElementKind; ceiling: Destination }[] = [];
  for (const e of elements) {
    const c = ceilingFor(bundle, e.kind);
    if (RANK[c] >= RANK[strictest]) allowed.push(e);
    else withheld.push({ kind: e.kind, ceiling: c });
  }

  const leavesNode = RANK[strictest] > RANK.node;
  return {
    destination: strictest,
    allowed,
    withheld,
    redactions: leavesNode ? bundle.redact : [],
  };
}

/** Applied as a pipeline stage before egress, and recorded on the observation. */
export function applyRedactions(el: Element, redactors: string[]): Element {
  if (el.kind !== 'image' || redactors.length === 0) return el;
  const v = el.value as Record<string, unknown>;
  const out = { ...v };
  if (redactors.includes('exif')) { delete out['exif']; delete out['gps']; }
  if (redactors.includes('faces')) out['faces_blurred'] = true;
  return { kind: el.kind, value: out };
}

export const defaultBundle = (personId: string): PolicyBundle => ({
  personId,
  default: 'node',
  elements: {
    image: 'node',
    audio: 'node',
    transcript: 'node',
    location: 'node',
    list_contents: 'node',
    personal_memory: 'node',
    contacts: 'local',
  },
  redact: ['exif', 'faces'],
});
