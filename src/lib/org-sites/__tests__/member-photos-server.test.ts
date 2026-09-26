import { beforeEach, describe, expect, it, vi } from 'vitest';

// The picker's picks (gaps round, Sep 26 2026): `set_gallery_pick` writes
// the DRAFT, so the manager's picker reads the draft; with no draft the
// published module row is the truth.

const loadDraft = vi.fn();
vi.mock('../revisions-server', () => ({ loadDraftSnapshotBySiteId: (...a: unknown[]) => loadDraft(...a) }));
vi.mock('@/lib/media/proxy-url', () => ({ toProxyUrl: () => null }));

import { currentGalleryPicks } from '../member-photos-server';

const u = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const pick = (n: number) => ({ mediaId: u(n), postId: u(100 + n), profileId: u(200 + n), addedAt: '2026-09-26T00:00:00Z' });

function adminWithModuleRow(config: unknown) {
  const calls: string[] = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: config === undefined ? null : { config }, error: null }),
  };
  const admin = { from: (t: string) => (calls.push(t), chain) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal client double
  return { admin: admin as any, calls };
}

describe('currentGalleryPicks', () => {
  beforeEach(() => loadDraft.mockReset());

  it('reads the draft when there is one, and never the published row', async () => {
    loadDraft.mockResolvedValue({ modules: { gallery: { config: { picks: [pick(1), pick(2)] } } } });
    const { admin, calls } = adminWithModuleRow({ picks: [pick(9)] });
    expect((await currentGalleryPicks(admin, u(7))).map(p => p.mediaId)).toEqual([u(1), u(2)]);
    expect(calls).toEqual([]);
  });

  it('a draft with no gallery module has no picks', async () => {
    loadDraft.mockResolvedValue({ modules: {} });
    const { admin } = adminWithModuleRow({ picks: [pick(9)] });
    expect(await currentGalleryPicks(admin, u(7))).toEqual([]);
  });

  it('falls back to the published module row with no draft (never edited, published, pre-180)', async () => {
    loadDraft.mockResolvedValue(null);
    const { admin, calls } = adminWithModuleRow({ picks: [pick(3)] });
    expect((await currentGalleryPicks(admin, u(7))).map(p => p.mediaId)).toEqual([u(3)]);
    expect(calls).toEqual(['org_site_modules']);
  });

  it('no draft and no module row → no picks', async () => {
    loadDraft.mockResolvedValue(null);
    const { admin } = adminWithModuleRow(undefined);
    expect(await currentGalleryPicks(admin, u(7))).toEqual([]);
  });
});
