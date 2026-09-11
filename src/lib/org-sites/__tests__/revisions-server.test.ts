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

// ── Program 2, B (Sep 11 2026): the page rows ───────────────────────────────
import { loadRows, writeDraftLayout, writeSnapshotToRows } from '../revisions-server';
import { blankPageLayout } from '@/lib/site-builder/pages';

describe('pages — the 185 step-down, the mirror, the page layout write', () => {
  const P1 = '2f1b46c8-2964-4139-9689-d1c3f736ed93';
  const P2 = '3a2c57d9-3a75-4240-a79a-e2d4a847fea4';
  const pageRow = { id: P1, slug: 'about', title: 'About', body: [{ type: 'paragraph', text: 'Hi' }], visibility: 'public', created_at: '2026-09-11T09:00:00.000Z', layout: null, in_nav: true };

  it('loadRows reads the page rows with layout + in_nav; a 42703 re-reads without them and reports pre185', async () => {
    const full = fakeAdmin(call => {
      if (call.table === 'org_sites') return { data: { template_id: 'classic', theme_token_set: {}, nav_config: [], hero_config: {}, contact_config: {} }, error: null };
      if (call.table === 'org_site_modules') return { data: [], error: null };
      if (call.table === 'org_site_pages') return { data: [pageRow], error: null };
      return { data: null, error: null };
    });
    const rows = await loadRows(full.admin, 's1');
    expect(rows?.pagesSupport).toBe('supported');
    expect(rows?.pages).toEqual([pageRow]);
    expect(has(full.calls.find(c => c.table === 'org_site_pages')!, 'select', 'id, slug, title, body, visibility, created_at, layout, in_nav')).toBe(true);

    let pageReads = 0;
    const stepdown = fakeAdmin(call => {
      if (call.table === 'org_sites') return { data: { template_id: 'classic', theme_token_set: {}, nav_config: [], hero_config: {}, contact_config: {} }, error: null };
      if (call.table === 'org_site_modules') return { data: [], error: null };
      if (call.table === 'org_site_pages') {
        pageReads += 1;
        if (pageReads === 1) return { data: null, error: { code: '42703', message: 'column org_site_pages.layout does not exist' } };
        const legacy = { id: pageRow.id, slug: pageRow.slug, title: pageRow.title, body: pageRow.body, visibility: pageRow.visibility, created_at: pageRow.created_at };
        return { data: [legacy], error: null };
      }
      return { data: null, error: null };
    });
    const pre = await loadRows(stepdown.admin, 's1');
    expect(pre?.pagesSupport).toBe('pre185');
    expect(pre?.pages[0]).toMatchObject({ id: P1, slug: 'about' });
    expect(pre?.pages[0]).not.toHaveProperty('layout');
    expect(has(stepdown.calls.filter(c => c.table === 'org_site_pages')[1], 'select', 'id, slug, title, body, visibility, created_at')).toBe(true);

    const broken = fakeAdmin(call => {
      if (call.table === 'org_sites') return { data: { template_id: 'classic', theme_token_set: {}, nav_config: [], hero_config: {}, contact_config: {} }, error: null };
      if (call.table === 'org_site_modules') return { data: [], error: null };
      return { data: null, error: { code: 'XX000', message: 'boom' } };
    });
    expect(await loadRows(broken.admin, 's1')).toBeNull(); // never "every page deleted"
  });

  it('writeSnapshotToRows mirrors the page diff after the modules: update by id, insert when missing, delete the gone; body is the layout’s block projection; pre-185 names no layout/in_nav', async () => {
    const prev = { ...snapshot, pages: { [P2]: { id: P2, slug: 'old', title: 'Old', visibility: 'public' as const, inNav: true, createdAt: '2026-09-10T00:00:00.000Z', layout: blankPageLayout(P2) } } };
    const next = { ...snapshot, pages: { [P1]: { id: P1, slug: 'about', title: 'About', visibility: 'draft' as const, inNav: false, createdAt: '2026-09-11T09:00:00.000Z', layout: blankPageLayout(P1) } } };
    const { admin, calls } = fakeAdmin(call => {
      if (call.table === 'org_sites') return { data: [{ id: 's1' }], error: null };
      if (call.table === 'org_site_pages' && call.ops[0].op === 'update') return { data: [], error: null }; // missing → insert
      return { data: [{ id: 'x' }], error: null };
    });
    expect(await writeSnapshotToRows(admin, 's1', prev, next)).toEqual({ ok: true });
    const pageCalls = calls.filter(c => c.table === 'org_site_pages');
    expect(pageCalls.map(c => c.ops[0].op)).toEqual(['update', 'insert', 'delete']);
    const update = pageCalls[0].ops[0].args[0] as Record<string, unknown>;
    expect(update).toEqual({ slug: 'about', title: 'About', visibility: 'draft', body: [], layout: blankPageLayout(P1), in_nav: false });
    expect(has(pageCalls[0], 'eq', 'id', P1)).toBe(true);
    expect(has(pageCalls[0], 'eq', 'site_id', 's1')).toBe(true);
    const insert = pageCalls[1].ops[0].args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({ id: P1, site_id: 's1', body: [], created_at: '2026-09-11T09:00:00.000Z', slug: 'about', layout: blankPageLayout(P1), in_nav: false });
    // A page with words: the projection carries them as blocks.
    const worded = { ...next, pages: { [P1]: { ...next.pages[P1], layout: { ...blankPageLayout(P1), widgets: [{ ...blankPageLayout(P1).widgets[0], config: { blocks: [{ type: 'paragraph', text: 'Hi' }] } }] } } } };
    const w = fakeAdmin(call => (call.table === 'org_sites' ? { data: [{ id: 's1' }], error: null } : { data: [{ id: 'x' }], error: null }));
    await writeSnapshotToRows(w.admin, 's1', null, worded);
    expect((w.calls.find(c => c.table === 'org_site_pages')!.ops[0].args[0] as { body: unknown }).body).toEqual([{ type: 'paragraph', text: 'Hi' }]);
    expect(has(pageCalls[2], 'in', 'id', [P2])).toBe(true);
    // The page rows come AFTER the site row (the template CHECK first).
    expect(calls.findIndex(c => c.table === 'org_sites')).toBeLessThan(calls.findIndex(c => c.table === 'org_site_pages'));

    const pre = fakeAdmin(call => (call.table === 'org_sites' ? { data: [{ id: 's1' }], error: null } : { data: [{ id: 'x' }], error: null }));
    expect(await writeSnapshotToRows(pre.admin, 's1', null, next, 'pre185')).toEqual({ ok: true });
    const preUpdate = pre.calls.find(c => c.table === 'org_site_pages')!.ops[0].args[0] as Record<string, unknown>;
    expect(preUpdate).toEqual({ slug: 'about', title: 'About', visibility: 'draft', body: [] });
    expect(preUpdate).not.toHaveProperty('layout');
  });

  it('writeDraftLayout with a pageId writes that page’s layout only; an unknown page is page_not_found', async () => {
    const draftWithPage = { ...draftRow, snapshot: { ...snapshot, pages: { [P1]: { id: P1, slug: 'about', title: 'About', visibility: 'public', inNav: true, createdAt: '2026-09-11T09:00:00.000Z', layout: blankPageLayout(P1) } } } };
    const { admin, calls } = fakeAdmin(call => {
      if (call.table === 'org_sites') return { data: site, error: null };
      if (call.table === 'org_site_revisions' && call.ops[0].op === 'select') return { data: draftWithPage, error: null };
      if (call.table === 'org_site_revisions' && call.ops[0].op === 'update') return { data: [{ id: 'd1' }], error: null };
      return { data: null, error: null };
    });
    const layout = { ...blankPageLayout(P1), widgets: [{ ...blankPageLayout(P1).widgets[0], h: 5 }] };
    expect(await writeDraftLayout(admin, 'league', 'org', 'u', layout, 4, P1)).toEqual({ status: 'ok', rev: 5 });
    const write = calls.find(c => c.table === 'org_site_revisions' && c.ops[0].op === 'update')!;
    const written = (write.ops[0].args[0] as { snapshot: { layout?: unknown; pages: Record<string, { layout: unknown }> } }).snapshot;
    expect(written.pages[P1].layout).toEqual(layout);
    expect(written).not.toHaveProperty('layout'); // the home slot untouched
    const unknown = fakeAdmin(call => {
      if (call.table === 'org_sites') return { data: site, error: null };
      if (call.table === 'org_site_revisions') return { data: draftWithPage, error: null };
      return { data: null, error: null };
    });
    expect(await writeDraftLayout(unknown.admin, 'league', 'org', 'u', layout, 4, P2)).toEqual({ status: 'page_not_found' });
  });
});
