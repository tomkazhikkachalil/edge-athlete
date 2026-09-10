import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { revalidateTag } from 'next/cache';
import { getOrCreateDraft, publishDraft, writeDraft, type RevisionRow, type SitePointers } from '../revisions-server';
import { SNAPSHOT_VERSION } from '@/lib/site-builder/snapshot';

// Hardening H2: the draft-write FENCE and the publish ORDER, asserted
// against a scripted fake admin that records every chained call. The real
// client is PostgREST; here we only need to know WHAT was asked of it.

interface Call {
  table: string;
  ops: { op: string; args: unknown[] }[];
}
type Script = (call: Call, index: number) => unknown;

function fakeAdmin(script: Script) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    const handler = {
      get(_t: unknown, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
            try {
              resolve(script(call, calls.indexOf(call)));
            } catch (e) {
              reject?.(e);
            }
          };
        }
        return (...args: unknown[]) => {
          call.ops.push({ op: prop, args });
          return proxy;
        };
      },
    };
    const proxy: unknown = new Proxy(chain, handler);
    return proxy;
  };
  return { admin: { from } as never, calls };
}

const has = (call: Call, op: string, ...args: unknown[]) => call.ops.some(o => o.op === op && JSON.stringify(o.args) === JSON.stringify(args));
const opNames = (call: Call) => call.ops.map(o => o.op);

const snapshot = {
  v: SNAPSHOT_VERSION,
  templateId: 'classic',
  theme: {},
  hero: {},
  nav: [],
  contact: {},
  modules: { hero: { enabled: true, sortOrder: 0, config: {} }, standings: { enabled: true, sortOrder: 1, config: {} } },
};
const draftRow: RevisionRow = {
  id: 'd1',
  site_id: 's1',
  snapshot,
  rev: 4,
  label: null,
  created_by: 'u',
  created_at: '2026-09-09T10:00:00.000Z',
  updated_at: '2026-09-09T10:00:00.000Z',
  published_at: null,
  published_by: null,
};
const site: SitePointers = { id: 's1', subdomain: 'qa', published_at: '2026-09-01T00:00:00.000Z', draft_revision_id: 'd1', published_revision_id: 'p0', created_at: '2026-09-01T00:00:00.000Z' };

beforeEach(() => {
  vi.mocked(revalidateTag).mockClear();
});

describe('writeDraft — the fence', () => {
  it('updates by id + rev AND published_at IS NULL; zero rows = conflict', async () => {
    const { admin, calls } = fakeAdmin(() => ({ data: [{ id: 'd1' }], error: null }));
    expect(await writeDraft(admin, draftRow, snapshot)).toBe('ok');
    const call = calls[0];
    expect(call.table).toBe('org_site_revisions');
    expect(has(call, 'eq', 'id', 'd1')).toBe(true);
    expect(has(call, 'eq', 'rev', 4)).toBe(true);
    expect(has(call, 'is', 'published_at', null)).toBe(true);
    expect(call.ops[0].op).toBe('update');
    expect((call.ops[0].args[0] as { rev: number }).rev).toBe(5);

    const raced = fakeAdmin(() => ({ data: [], error: null }));
    expect(await writeDraft(raced.admin, draftRow, snapshot)).toBe('conflict');
  });
});

describe('getOrCreateDraft — a published row is never reused', () => {
  it('a pointer at an UNPUBLISHED row reuses it; at a PUBLISHED row it materialises a fresh draft', async () => {
    const reuse = fakeAdmin(() => ({ data: draftRow, error: null }));
    expect((await getOrCreateDraft(reuse.admin, site, 'u'))?.id).toBe('d1');
    expect(reuse.calls).toHaveLength(1);

    const stale = fakeAdmin((call, i) => {
      if (i === 0) return { data: { ...draftRow, published_at: '2026-09-09T11:00:00.000Z' }, error: null }; // the pointed row got published
      if (call.table === 'org_sites' && call.ops[0].op === 'select') return { data: { template_id: 'classic', theme_token_set: {}, nav_config: [], hero_config: {}, contact_config: {} }, error: null };
      if (call.table === 'org_site_modules') return { data: [], error: null };
      if (call.table === 'org_site_revisions' && call.ops[0].op === 'select') return { data: { ...draftRow, id: 'p0', published_at: 'x' }, error: null }; // published layout read
      if (call.table === 'org_site_revisions' && call.ops[0].op === 'insert') return { data: { ...draftRow, id: 'd2', rev: 1 }, error: null };
      if (call.table === 'org_sites' && call.ops[0].op === 'update') return { data: [{ id: 's1' }], error: null };
      return { data: null, error: null };
    });
    const fresh = await getOrCreateDraft(stale.admin, site, 'u');
    expect(fresh?.id).toBe('d2');
    const insert = stale.calls.find(c => c.table === 'org_site_revisions' && c.ops[0].op === 'insert')!;
    expect((insert.ops[0].args[0] as { rev: number }).rev).toBe(1);
    // The claim replaces the STALE pointer (not "is null").
    const claim = stale.calls.find(c => c.table === 'org_sites' && c.ops[0].op === 'update')!;
    expect(has(claim, 'eq', 'draft_revision_id', 'd1')).toBe(true);
  });
});

describe('publishDraft — stamp first, fenced; site row before module rows; purge both tags', () => {
  const rowsScript = (call: Call): unknown | undefined => {
    if (call.table === 'org_sites' && call.ops[0].op === 'select') return { data: { template_id: 'classic', theme_token_set: {}, nav_config: [], hero_config: {}, contact_config: {} }, error: null };
    if (call.table === 'org_site_modules' && call.ops[0].op === 'select') return { data: [{ module_key: 'hero', enabled: true, sort_order: 0, config: {} }], error: null };
    return undefined;
  };

  it('happy path: the order is stamp → org_sites mirror → module rows → pointer flip → prune; both tags purged', async () => {
    const { admin, calls } = fakeAdmin(call => {
      const rows = rowsScript(call);
      if (rows !== undefined) return rows;
      if (call.table === 'org_site_revisions' && call.ops[0].op === 'select') {
        const id = call.ops.find(o => o.op === 'eq')?.args[1];
        if (id === 'd1') return { data: draftRow, error: null };
        if (id === 'p0') return { data: { ...draftRow, id: 'p0', published_at: 'x' }, error: null };
        return { data: [], error: null }; // history
      }
      if (call.table === 'org_site_revisions' && call.ops[0].op === 'update') return { data: [{ id: 'd1' }], error: null }; // stamp
      if (call.table === 'org_sites' && call.ops[0].op === 'update') return { data: [{ id: 's1' }], error: null };
      if (call.table === 'org_site_modules' && call.ops[0].op === 'update') return { data: [{ module_key: 'x' }], error: null };
      return { data: null, error: null };
    });
    const result = await publishDraft(admin, site, 'u', 'v1');
    expect(result).toEqual({ status: 'published', revisionId: 'd1' });
    const stamp = calls.findIndex(c => c.table === 'org_site_revisions' && c.ops[0].op === 'update');
    const siteMirror = calls.findIndex(c => c.table === 'org_sites' && c.ops[0].op === 'update' && 'template_id' in (c.ops[0].args[0] as object));
    const moduleMirror = calls.findIndex(c => c.table === 'org_site_modules' && c.ops[0].op === 'update');
    const flip = calls.findIndex(c => c.table === 'org_sites' && c.ops[0].op === 'update' && 'published_revision_id' in (c.ops[0].args[0] as object));
    expect(stamp).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(siteMirror);
    expect(siteMirror).toBeLessThan(moduleMirror);
    expect(moduleMirror).toBeLessThan(flip);
    // The stamp is fenced on the rev we read and on "still a draft".
    const stampCall = calls[stamp];
    expect(has(stampCall, 'eq', 'rev', 4)).toBe(true);
    expect(has(stampCall, 'is', 'published_at', null)).toBe(true);
    expect(opNames(stampCall)).toContain('select');
    expect(vi.mocked(revalidateTag).mock.calls.map(c => c[0])).toEqual(['org-site:qa', 'org-sitemap']);
  });

  it('a stamp that matches zero rows (the draft moved) is RACED before any row changes; nothing purged', async () => {
    const { admin, calls } = fakeAdmin(call => {
      const rows = rowsScript(call);
      if (rows !== undefined) return rows;
      if (call.table === 'org_site_revisions' && call.ops[0].op === 'select') return { data: draftRow, error: null };
      if (call.table === 'org_site_revisions' && call.ops[0].op === 'update') return { data: [], error: null };
      return { data: null, error: null };
    });
    expect(await publishDraft(admin, site, 'u')).toEqual({ status: 'raced' });
    expect(calls.some(c => c.table === 'org_sites' && c.ops[0].op === 'update')).toBe(false);
    expect(calls.some(c => c.table === 'org_site_modules' && c.ops[0].op === 'update')).toBe(false);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('a refused template CHECK on the site row un-stamps the revision, moves no module row, and purges', async () => {
    const { admin, calls } = fakeAdmin(call => {
      const rows = rowsScript(call);
      if (rows !== undefined) return rows;
      if (call.table === 'org_site_revisions' && call.ops[0].op === 'select') return { data: draftRow, error: null };
      if (call.table === 'org_site_revisions' && call.ops[0].op === 'update') return { data: [{ id: 'd1' }], error: null };
      if (call.table === 'org_sites' && call.ops[0].op === 'update') return { data: null, error: { code: '23514' } };
      return { data: null, error: null };
    });
    expect(await publishDraft(admin, site, 'u')).toEqual({ status: 'template_check' });
    expect(calls.some(c => c.table === 'org_site_modules' && c.ops[0].op !== 'select')).toBe(false);
    const unstamp = calls.filter(c => c.table === 'org_site_revisions' && c.ops[0].op === 'update').at(-1)!;
    expect((unstamp.ops[0].args[0] as { published_at: unknown }).published_at).toBeNull();
    expect(revalidateTag).toHaveBeenCalledWith('org-site:qa', { expire: 0 });
  });

  it('a pointer already published elsewhere is not_found (never re-published)', async () => {
    const { admin } = fakeAdmin(call => {
      const rows = rowsScript(call);
      if (rows !== undefined) return rows;
      return { data: { ...draftRow, published_at: 'x' }, error: null };
    });
    expect(await publishDraft(admin, site, 'u')).toEqual({ status: 'not_found' });
  });
});
