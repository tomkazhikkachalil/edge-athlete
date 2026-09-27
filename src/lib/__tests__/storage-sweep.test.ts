import { describe, it, expect } from 'vitest';
import {
  GRACE_MS,
  PROTECTED_PREFIXES,
  SWEEP_BUCKETS,
  URL_SOURCE_COLUMNS,
  bucketPathFromUrl,
  collectSetMediaPaths,
  isProtectedPath,
  isSweepable,
  uploadsPathFromUrl,
} from '../storage-sweep';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SB = 'https://abc.supabase.co/storage/v1/object/public';

describe('uploadsPathFromUrl', () => {
  it('extracts the path from uploads public URLs', () => {
    expect(uploadsPathFromUrl(`${SB}/uploads/posts/u1/a.png`)).toBe('posts/u1/a.png');
    expect(uploadsPathFromUrl(`${SB}/uploads/u1/b.mp4`)).toBe('u1/b.mp4');
  });

  it('strips query/hash and decodes percent-encoding', () => {
    expect(uploadsPathFromUrl(`${SB}/uploads/posts/u1/a.png?width=100`)).toBe('posts/u1/a.png');
    expect(uploadsPathFromUrl(`${SB}/uploads/posts/u1/a%20b.png`)).toBe('posts/u1/a b.png');
  });

  it('returns null for other buckets, hosts, and junk', () => {
    expect(uploadsPathFromUrl(`${SB}/avatars/u1/a.png`)).toBeNull();
    expect(uploadsPathFromUrl('https://media.giphy.com/x.gif')).toBeNull();
    expect(uploadsPathFromUrl(null)).toBeNull();
    expect(uploadsPathFromUrl('')).toBeNull();
    expect(uploadsPathFromUrl(42)).toBeNull();
  });
});

describe('bucketPathFromUrl', () => {
  it('extracts paths per bucket and ignores other buckets', () => {
    expect(bucketPathFromUrl(`${SB}/avatars/avatars/a-1.png`, 'avatars')).toBe('avatars/a-1.png');
    expect(bucketPathFromUrl(`${SB}/uploads/posts/u1/a.png`, 'avatars')).toBeNull();
    expect(bucketPathFromUrl(`${SB}/avatars/avatars/a-1.png`, 'uploads')).toBeNull();
  });

  it('strips query/hash and decodes, same as the uploads shorthand', () => {
    expect(bucketPathFromUrl(`${SB}/avatars/a%20b.png?v=2`, 'avatars')).toBe('a b.png');
    expect(uploadsPathFromUrl(`${SB}/uploads/posts/u1/a.png`)).toBe('posts/u1/a.png');
  });

  it('does not let one bucket name prefix-match another', () => {
    // The trailing slash in the marker is what prevents this.
    expect(bucketPathFromUrl(`${SB}/uploads2/x.png`, 'uploads')).toBeNull();
    expect(bucketPathFromUrl(`${SB}/avatars-old/x.png`, 'avatars')).toBeNull();
  });

  it('returns null for junk and for a bucket URL with no path after it', () => {
    expect(bucketPathFromUrl(`${SB}/avatars/`, 'avatars')).toBeNull();
    expect(bucketPathFromUrl(null, 'avatars')).toBeNull();
    expect(bucketPathFromUrl(42, 'uploads')).toBeNull();
  });
});

describe('SWEEP_BUCKETS', () => {
  it('never includes consent-evidence — it is the legal audit trail for minors', () => {
    expect(SWEEP_BUCKETS).not.toContain('consent-evidence');
  });

  it('covers avatars, or deleting a user orphans their avatar forever', () => {
    expect(SWEEP_BUCKETS).toContain('avatars');
    expect(SWEEP_BUCKETS).toContain('uploads');
  });
});

describe('URL_SOURCE_COLUMNS', () => {
  const covered = (table: string, column: string) =>
    URL_SOURCE_COLUMNS.some(s => s.table === table && s.columns.includes(column));

  // The cron deletes for real. A live URL column missing from this list makes
  // its files look unreferenced, which is silent data loss on the next sweep.
  it.each([
    ['post_media', 'media_url'],
    ['post_media', 'thumbnail_url'],
    // Migration 120 — non-destructive originals. Registered in the same PR
    // that first writes the column.
    ['post_media', 'source_url'],
    ['group_post_media', 'media_url'],
    // Migration 060 — hole-video poster frames. Was missing, and was invisible
    // because the column was still empty in production.
    ['group_post_media', 'thumbnail_url'],
    ['messages', 'media_url'],
    ['profiles', 'avatar_url'],
    ['profiles', 'cover_url'],
  ])('covers %s.%s', (table, column) => {
    expect(covered(table, column)).toBe(true);
  });

  it('does not scan athlete_badges — the table is dropped by migration 199, and a missing table fails the whole sweep', () => {
    expect(covered('athlete_badges', 'icon_url')).toBe(false);
    expect(URL_SOURCE_COLUMNS.some(s => s.table === 'athlete_badges')).toBe(false);
  });
  it('lists no table twice, so a column added to the wrong entry is not silently lost', () => {
    const tables = URL_SOURCE_COLUMNS.map(s => s.table);
    expect(new Set(tables).size).toBe(tables.length);
  });
});

describe('collectSetMediaPaths', () => {
  it('collects urls from jsonb media arrays, skipping junk shapes', () => {
    const paths = collectSetMediaPaths([
      [{ url: `${SB}/uploads/posts/u1/clip.mp4`, type: 'video' }],
      [{ url: 'https://elsewhere.com/x.png', type: 'image' }, { nope: true }],
      'not-an-array',
      null,
      [],
    ]);
    expect(paths).toEqual(['posts/u1/clip.mp4']);
  });
});

describe('isSweepable', () => {
  const now = Date.parse('2026-07-27T00:00:00Z');
  const old = new Date(now - GRACE_MS - 60_000).toISOString();
  const fresh = new Date(now - 60_000).toISOString();

  it('sweeps old unreferenced files only', () => {
    const refs = new Set(['posts/u1/kept.png']);
    expect(isSweepable({ path: 'posts/u1/orphan.png', createdAt: old }, refs, now)).toBe(true);
    expect(isSweepable({ path: 'posts/u1/kept.png', createdAt: old }, refs, now)).toBe(false);
  });

  it('never sweeps inside the grace period or without a timestamp', () => {
    const refs = new Set<string>();
    expect(isSweepable({ path: 'posts/u1/new.png', createdAt: fresh }, refs, now)).toBe(false);
    expect(isSweepable({ path: 'posts/u1/x.png', createdAt: null }, refs, now)).toBe(false);
    expect(isSweepable({ path: 'posts/u1/x.png', createdAt: 'garbage' }, refs, now)).toBe(false);
  });
});

// ── Bare-path writers (Sep 26 2026) ──────────────────────────────────────────
// The weekly cron deleted every org logo on production: org_sites.logo_path
// holds a BARE path the URL scan cannot see. Every writer into a swept bucket
// is listed here with how its files stay alive — a URL column the sweep scans,
// or a protected prefix. A new `.upload(` call anywhere in src fails this test
// until it is classified.

type Keep = { kind: 'url'; table: string } | { kind: 'protected'; prefix: string } | { kind: 'unswept-bucket'; bucket: string };
const UPLOAD_WRITERS: Record<string, { marker: string; keep: Keep }> = {
  'src/app/api/tickets/attachment/route.ts': { marker: '/tickets/', keep: { kind: 'url', table: 'tickets' } },
  'src/app/api/guardian/athletes/[profileId]/consent/route.ts': { marker: "from('consent-evidence')", keep: { kind: 'unswept-bucket', bucket: 'consent-evidence' } },
  'src/app/api/upload/post-media/route.ts': { marker: 'posts/', keep: { kind: 'url', table: 'post_media' } },
  // No in-app caller today; a client that uses it stores the returned public URL (post media).
  'src/app/api/upload/route.ts': { marker: '${userId}/', keep: { kind: 'url', table: 'post_media' } },
  'src/app/api/upload/equipment/route.ts': { marker: 'equipment/', keep: { kind: 'url', table: 'athlete_equipment' } },
  'src/app/api/upload/avatar/route.ts': { marker: 'avatars/', keep: { kind: 'url', table: 'profiles' } },
  'src/app/api/upload/cover/route.ts': { marker: 'covers/', keep: { kind: 'url', table: 'profiles' } },
  'src/lib/org-sites/logo-server.ts': { marker: 'ORG_LOGO_PREFIX', keep: { kind: 'protected', prefix: 'org-logos/' } },
  'src/lib/org-sites/pages-server.ts': { marker: 'ORG_MEDIA_PREFIX', keep: { kind: 'protected', prefix: 'org-media/' } },
  'src/lib/orgs/contest-media-server.ts': { marker: 'contest-media/', keep: { kind: 'protected', prefix: 'contest-media/' } },
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('every uploads writer stays alive through the sweep', () => {
  const writers = sourceFiles('src').filter(f => /\.upload\(/.test(readFileSync(f, 'utf8')));

  it('every `.upload(` in src is classified (a new writer must say how its files survive)', () => {
    expect(writers.sort()).toEqual(Object.keys(UPLOAD_WRITERS).sort());
  });

  it("each classification matches its file, and each keep-alive is real", () => {
    const scanned = new Set(URL_SOURCE_COLUMNS.map(s => s.table));
    for (const [file, { marker, keep }] of Object.entries(UPLOAD_WRITERS)) {
      expect(readFileSync(file, 'utf8'), file).toContain(marker);
      if (keep.kind === 'url') expect(scanned.has(keep.table), `${file} → ${keep.table}`).toBe(true);
      if (keep.kind === 'protected') expect(PROTECTED_PREFIXES as readonly string[], file).toContain(keep.prefix);
      if (keep.kind === 'unswept-bucket') expect(SWEEP_BUCKETS as readonly string[]).not.toContain(keep.bucket);
    }
  });

  it('protected prefixes are never swept, however old and unreferenced', () => {
    const now = Date.parse('2026-09-26T00:00:00Z');
    const ancient = new Date(now - 365 * 86_400_000).toISOString();
    for (const prefix of PROTECTED_PREFIXES) {
      expect(isProtectedPath(`${prefix}site/1.png`)).toBe(true);
      expect(isSweepable({ path: `${prefix}site/1.png`, createdAt: ancient }, new Set(), now)).toBe(false);
    }
    // a lookalike outside the prefix is still swept
    expect(isSweepable({ path: 'posts/org-logos/1.png', createdAt: ancient }, new Set(), now)).toBe(true);
  });

  it('live event media is a scanned source (216) — it was missing until Sep 26 2026', () => {
    expect(URL_SOURCE_COLUMNS.find(s => s.table === 'sport_event_media')?.columns).toEqual(['media_url', 'thumbnail_url']);
  });
});
