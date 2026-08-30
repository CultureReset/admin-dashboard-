/**
 * Capability tokens. Scoped and expiring, never booleans.
 *
 * "User approved once" is ambient authority forever, and an install-time
 * checkbox cannot express "while in the foreground" or "for this request only",
 * which are the grants people actually want to give.
 */
export interface CapabilityToken {
  appId: string;
  personId: string;
  scopes: string[];
  /** External destinations this app may reach. 'node' means it may not leave. */
  egress: 'node' | 'external';
  maxCalls?: number;
  expiresAt: number;
}

export class TokenError extends Error {
  constructor(message: string) { super(message); this.name = 'TokenError'; }
}

const calls = new Map<string, number>();
const keyOf = (t: CapabilityToken) => `${t.appId}:${t.personId}:${t.expiresAt}`;

/** Scopes may end in `.*` to cover a family, e.g. `list.*` covers `list.add`. */
export function scopeCovers(scope: string, capability: string): boolean {
  if (scope === capability) return true;
  if (scope.endsWith('.*')) return capability.startsWith(scope.slice(0, -1));
  return false;
}

export function assertToken(token: CapabilityToken, capability: string, now = Date.now()): void {
  if (token.expiresAt <= now) throw new TokenError(`token expired for ${token.appId}`);
  if (!token.scopes.some(s => scopeCovers(s, capability))) {
    throw new TokenError(`${token.appId} has no scope for ${capability}`);
  }
  if (token.maxCalls !== undefined) {
    const k = keyOf(token);
    const used = calls.get(k) ?? 0;
    if (used >= token.maxCalls) throw new TokenError(`${token.appId} exhausted its call budget`);
    calls.set(k, used + 1);
  }
}

export function mint(
  appId: string, personId: string, scopes: string[],
  opts: { ttlMs?: number; egress?: 'node' | 'external'; maxCalls?: number } = {},
): CapabilityToken {
  return {
    appId, personId, scopes,
    egress: opts.egress ?? 'node',
    maxCalls: opts.maxCalls,
    expiresAt: Date.now() + (opts.ttlMs ?? 15 * 60_000),
  };
}

/** Revocation takes effect on the next call, not the next launch. */
const revoked = new Set<string>();
export const revoke = (token: CapabilityToken) => { revoked.add(keyOf(token)); };
export const isRevoked = (token: CapabilityToken) => revoked.has(keyOf(token));
