import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkUploadIntent,
  EXT_BY_TYPE,
  incomingKey,
  MAX_UPLOAD_BYTES,
  parseIncomingKey,
  postsKey,
  storedTypeMatches,
  isOwnPostsUploadUrl,
} from '../upload-rules';
import { ALLOWED_IMAGE_MIME, ALLOWED_VIDEO_MIME } from '../validation';

const OWNER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('direct upload rules', () => {
  it('the cap is 50 MB until the Supabase project limit is raised', () => {
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
  });

  it('every allowlisted type has an extension (the pick-time list and the server agree)', () => {
    for (const type of [...ALLOWED_IMAGE_MIME, ...ALLOWED_VIDEO_MIME]) expect(EXT_BY_TYPE[type]).toBeTruthy();
    expect(Object.keys(EXT_BY_TYPE).sort()).toEqual([...ALLOWED_IMAGE_MIME, ...ALLOWED_VIDEO_MIME].sort());
  });

  it('intent refuses a bad type, an empty file and an oversize file — a big video is fine', () => {
    expect(checkUploadIntent('image/svg+xml', 10)).toMatchObject({ ok: false, status: 400 });
    expect(checkUploadIntent('image/heic', 10)).toMatchObject({ ok: false, status: 400 });
    expect(checkUploadIntent('video/mp4', 0)).toMatchObject({ ok: false, status: 400 });
    expect(checkUploadIntent('video/mp4', '5')).toMatchObject({ ok: false, status: 400 });
    expect(checkUploadIntent('video/mp4', MAX_UPLOAD_BYTES + 1)).toMatchObject({ ok: false, status: 413 });
    // the whole point: well past Vercel's 4.5 MB function cap
    expect(checkUploadIntent('video/quicktime', 30 * 1024 * 1024)).toEqual({
      ok: true,
      type: 'video/quicktime',
      size: 30 * 1024 * 1024,
    });
  });

  it('the minted key round-trips for its owner only', () => {
    const key = incomingKey(OWNER, 'video/quicktime', ID);
    expect(key).toBe(`incoming/${OWNER}/${ID}.mov`);
    expect(parseIncomingKey(key, OWNER)).toEqual({ id: ID, ext: 'mov', type: 'video/quicktime' });
    expect(parseIncomingKey(key, OTHER)).toBeNull();
  });

  it('a forged or reshaped path is refused before any storage call', () => {
    for (const bad of [
      `posts/${OWNER}/${ID}.mp4`,
      `incoming/${OWNER}/${ID}.svg`,
      `incoming/${OWNER}/../${OTHER}/${ID}.mp4`,
      `incoming/${OWNER}/${ID}.mp4/x`,
      `incoming/${OWNER}/not-a-uuid.mp4`,
      `xincoming/${OWNER}/${ID}.mp4`,
      42,
      null,
    ]) {
      expect(parseIncomingKey(bad, OWNER), String(bad)).toBeNull();
    }
  });

  it('a finished upload lives where the old door wrote it', () => {
    expect(postsKey(OWNER, ID, 'mp4')).toBe(`posts/${OWNER}/${ID}.mp4`);
  });

  it('the stored type must be the minted one (the client cannot relabel the bytes)', () => {
    expect(storedTypeMatches('video/mp4', 'video/mp4')).toBe(true);
    expect(storedTypeMatches('image/jpeg', 'IMAGE/JPEG; charset=binary')).toBe(true);
    expect(storedTypeMatches('image/jpeg', 'text/html')).toBe(false);
    expect(storedTypeMatches('image/jpeg', null)).toBe(false);
  });

  it('the background original is accepted only as the owner\'s own finished upload', () => {
    const base = 'https://abc.supabase.co/storage/v1/object/public/uploads/posts';
    expect(isOwnPostsUploadUrl(`${base}/${OWNER}/${ID}.mov`, OWNER)).toBe(true);
    expect(isOwnPostsUploadUrl(`${base}/${OWNER}/${ID}.mov`, OWNER.toUpperCase())).toBe(true);
    expect(isOwnPostsUploadUrl(`${base}/${OTHER}/${ID}.mov`, OWNER)).toBe(false);
    expect(isOwnPostsUploadUrl(`${base}/${OWNER}/${ID}.svg`, OWNER)).toBe(false);
    expect(isOwnPostsUploadUrl(`https://abc.supabase.co/storage/v1/object/public/uploads/incoming/${OWNER}/${ID}.mov`, OWNER)).toBe(false);
    expect(isOwnPostsUploadUrl(`${base}/${OWNER}/${ID}.mov?x=1#y`, OWNER)).toBe(true);
    expect(isOwnPostsUploadUrl('javascript:alert(1)', OWNER)).toBe(false);
    expect(isOwnPostsUploadUrl(`posts/${OWNER}/${ID}.mov`, OWNER)).toBe(false);
    expect(isOwnPostsUploadUrl(null, OWNER)).toBe(false);
  });
});

// Videos program Phase 2 (Nov 5 2026): the cap lives in ONE module that the
// client, every route and the bucket read. The bucket's own limit is the
// literal 250's result row expects; no other source file carries the number.
describe('the one upload cap', () => {
  it('equals the uploads bucket file_size_limit that migration 250 pins', () => {
    const sql = readFileSync(join(process.cwd(), 'database/migrations/250_uploads_bucket_gzip.sql'), 'utf8');
    const m = /uploads_limit_expect_(\d+)/.exec(sql);
    expect(m, '250 names the bucket limit in its result row').not.toBeNull();
    expect(Number(m![1])).toBe(MAX_UPLOAD_BYTES);
  });
  it('no other source file spells the cap as a literal (code, not comments)', () => {
    const root = join(process.cwd(), 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name) || full.endsWith('/media/upload-rules.ts')) continue;
        const lines = readFileSync(full, 'utf8').split('\n');
        lines.forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
          if (/50 \* 1024 \* 1024|50 \* MB\b|52428800|less than 50MB|Up to 50MB/.test(code)) offenders.push(`${full.slice(root.length + 1)}:${i + 1}`);
        });
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
