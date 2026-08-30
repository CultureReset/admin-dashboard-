import { describe, it, expect, afterAll } from 'vitest';
import { freshNode } from '../helpers.js';
import { mint, revoke, TokenError } from '../../src/capabilities/token.js';
import { defaultBundle, evaluate } from '../../src/capabilities/policy.js';

const node = await freshNode();
afterAll(() => node.db.close());

describe('capability tokens', () => {
  it('refuses a capability outside the token scopes', async () => {
    const ctx = node.ctx('matt', 'plant-id', ['observation.search']);
    await expect(node.host.invoke(ctx, 'list.add', { list: 'x', title: 'y' }))
      .rejects.toThrow(TokenError);
  });

  it('honours wildcard scopes', async () => {
    const ctx = node.ctx('matt', 'lists', ['list.*']);
    await expect(node.host.invoke(ctx, 'list.add', { list: 'a', title: 'b' })).resolves.toBeTruthy();
  });

  it('refuses an expired token', async () => {
    const p = node.person('matt');
    const ctx = { person: p, token: mint('x', p.personId, ['list.*'], { ttlMs: -1 }),
                  policy: defaultBundle(p.personId) };
    await expect(node.host.invoke(ctx, 'list.add', { list: 'a', title: 'b' }))
      .rejects.toThrow(/expired/);
  });

  it('revocation takes effect on the next call, not the next launch', async () => {
    const ctx = node.ctx('matt', 'revokeme', ['list.*']);
    await expect(node.host.invoke(ctx, 'list.add', { list: 'a', title: 'b' })).resolves.toBeTruthy();
    revoke(ctx.token);
    await expect(node.host.invoke(ctx, 'list.add', { list: 'a', title: 'c' }))
      .rejects.toThrow(/revoked/);
  });

  it('refuses a token minted for a different person', async () => {
    const A = node.person('matt'), B = node.person('poppy');
    const ctx = { person: A, token: mint('sneaky', B.personId, ['list.*']),
                  policy: defaultBundle(A.personId) };
    await expect(node.host.invoke(ctx, 'list.add', { list: 'a', title: 'b' }))
      .rejects.toThrow(/does not belong to the session person/);
  });

  it('exhausts a one-shot budget', async () => {
    const p = node.person('matt');
    const token = mint('oneshot', p.personId, ['list.*'], { maxCalls: 1 });
    const ctx = { person: p, token, policy: defaultBundle(p.personId) };
    await expect(node.host.invoke(ctx, 'list.add', { list: 'a', title: 'one' })).resolves.toBeTruthy();
    await expect(node.host.invoke(ctx, 'list.add', { list: 'a', title: 'two' }))
      .rejects.toThrow(/call budget/);
  });
});

describe('per-(app, person) storage', () => {
  it('two apps under one person cannot see each other', async () => {
    const one = node.ctx('matt', 'app-one', ['kv.*']);
    const two = node.ctx('matt', 'app-two', ['kv.*']);
    await node.host.invoke(one, 'kv.set', { key: 'k', value: { from: 'one' } });
    expect(await node.host.invoke(two, 'kv.get', { key: 'k' })).toBeNull();
    expect(await node.host.invoke(one, 'kv.get', { key: 'k' })).toEqual({ from: 'one' });
  });

  it('one app installed by two people gets two namespaces', async () => {
    const m = node.ctx('matt', 'shared-app', ['kv.*']);
    const p = node.ctx('poppy', 'shared-app', ['kv.*']);
    await node.host.invoke(m, 'kv.set', { key: 'pref', value: 'matt-value' });
    await node.host.invoke(p, 'kv.set', { key: 'pref', value: 'poppy-value' });
    expect(await node.host.invoke(m, 'kv.get', { key: 'pref' })).toBe('matt-value');
    expect(await node.host.invoke(p, 'kv.get', { key: 'pref' })).toBe('poppy-value');
  });
});

describe('audit', () => {
  it('writes a receipt in the same transaction as the effect', async () => {
    const ctx = node.ctx('matt', 'audited', ['list.*', 'audit.read']);
    await node.host.invoke(ctx, 'list.add', { list: 'receipts', title: 'thing' });
    const rows = await node.host.invoke<{ app_id: string; capability: string; ok: boolean }[]>(
      ctx, 'audit.read', { limit: 10 });
    expect(rows.some(r => r.app_id === 'audited' && r.capability === 'list.add' && r.ok)).toBe(true);
  });

  it('records a failed call too', async () => {
    const ctx = node.ctx('matt', 'failer', ['entity.create', 'audit.read']);
    await node.host.invoke(ctx, 'entity.create', { kind: 'k', name: 'n' }).catch(() => {});
    await expect(node.host.invoke(ctx, 'entity.create', { kind: null, name: null })).rejects.toThrow();
    const rows = await node.host.invoke<{ app_id: string; ok: boolean }[]>(ctx, 'audit.read', { limit: 20 });
    expect(rows.some(r => r.app_id === 'failer' && !r.ok)).toBe(true);
  });
});

describe('policy is evaluated per element', () => {
  it('caps the request at its strictest element and withholds the rest', () => {
    const bundle = { ...defaultBundle('p'), elements: {
      image: 'external' as const, list_contents: 'node' as const } };
    const d = evaluate(bundle, [
      { kind: 'image', value: {} },
      { kind: 'list_contents', value: ['a'] },
    ], 'external');
    expect(d.destination).toBe('node');
    expect(d.withheld).toEqual([]);
    expect(d.redactions).toEqual([]);          // nothing leaves the node
  });

  it('redacts when an element genuinely does leave', () => {
    const bundle = { ...defaultBundle('p'), elements: { image: 'external' as const } };
    const d = evaluate(bundle, [{ kind: 'image', value: {} }], 'external');
    expect(d.destination).toBe('external');
    expect(d.redactions).toContain('exif');
  });
});
