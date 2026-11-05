import { describe, it, expect } from 'vitest';
import {
  encodeUploadMetadata, isResumeEntry, nextChunk, parseOffset, resumableEndpoint, resumeEntryUsable, RESUME_TTL_MS,
  toBase64, tusFailureOf, tusProgress, TUS_CHUNK_BYTES, TUS_MIN_BYTES, uploadMetadataFor, uploadTransportFor, utf8ToBase64,
} from '../tus';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Videos program Phase 2 (Nov 5 2026): the resumable protocol's pure rules,
// proven against staging on Nov 5 (create → 201 + Location on the project's
// own host; PATCH 6 MB → 204 + Upload-Offset; HEAD → the offset; a wrong
// offset → 409).

describe('tus — the transport rule', () => {
  it('a file of one chunk or less takes the PUT; above it the resumable path', () => {
    expect(TUS_CHUNK_BYTES).toBe(6 * 1024 * 1024);
    expect(TUS_MIN_BYTES).toBe(TUS_CHUNK_BYTES);
    expect(uploadTransportFor(10)).toBe('put');
    expect(uploadTransportFor(TUS_CHUNK_BYTES)).toBe('put');
    expect(uploadTransportFor(TUS_CHUNK_BYTES + 1)).toBe('tus');
    expect(uploadTransportFor(50 * 1024 * 1024)).toBe('tus');
    expect(uploadTransportFor(NaN)).toBe('put');
  });
  it('the signed endpoint sits on the project host (the connect-src the PUT already uses)', () => {
    expect(resumableEndpoint('https://abc.supabase.co')).toBe('https://abc.supabase.co/storage/v1/upload/resumable/sign');
    expect(resumableEndpoint('https://abc.supabase.co/')).toBe('https://abc.supabase.co/storage/v1/upload/resumable/sign');
  });
  it('the module imports nothing', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/media/tus.ts'), 'utf8');
    expect(src).not.toMatch(/^import /m);
  });
});

describe('tus — base64 and the metadata header', () => {
  it('toBase64 matches Buffer for every padding case and non-Latin-1 text', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd', 'incoming/x/y.mp4', 'Göteborg — été 🎥']) {
      const bytes = new TextEncoder().encode(text);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
      expect(utf8ToBase64(text)).toBe(Buffer.from(text, 'utf8').toString('base64'));
    }
  });
  it('Upload-Metadata is `key base64(value)` pairs, comma-joined, in our four keys', () => {
    const meta = uploadMetadataFor('uploads', 'incoming/o/i.mp4', 'video/mp4');
    expect(Object.keys(meta)).toEqual(['bucketName', 'objectName', 'contentType', 'cacheControl']);
    expect(meta.cacheControl).toBe('3600');
    const header = encodeUploadMetadata(meta);
    const decoded = Object.fromEntries(header.split(',').map(pair => { const [k, v] = pair.split(' '); return [k, Buffer.from(v, 'base64').toString('utf8')]; }));
    expect(decoded).toEqual(meta);
  });
});

describe('tus — chunks, offsets, progress, failures', () => {
  it('nextChunk walks the file in 6 MB steps and ends with the remainder, then null', () => {
    const size = 7 * 1024 * 1024 + 123;
    expect(nextChunk(size, 0)).toEqual({ start: 0, end: TUS_CHUNK_BYTES });
    expect(nextChunk(size, TUS_CHUNK_BYTES)).toEqual({ start: TUS_CHUNK_BYTES, end: size });
    expect(nextChunk(size, size)).toBeNull();
    expect(nextChunk(size, -1)).toBeNull();
    expect(nextChunk(size, NaN)).toBeNull();
  });
  it('parseOffset reads a whole number and nothing else', () => {
    expect(parseOffset('6291456')).toBe(6291456);
    expect(parseOffset(' 0 ')).toBe(0);
    expect(parseOffset('-1')).toBeNull();
    expect(parseOffset('1.5')).toBeNull();
    expect(parseOffset('abc')).toBeNull();
    expect(parseOffset(null)).toBeNull();
    expect(parseOffset(undefined)).toBeNull();
  });
  it('progress is the acknowledged offset plus the chunk in flight, clamped', () => {
    expect(tusProgress(100, 50, 25)).toBe(0.75);
    expect(tusProgress(100, 100, 0)).toBe(1);
    expect(tusProgress(100, 90, 50)).toBe(1);
    expect(tusProgress(0, 0, 0)).toBe(0);
    expect(tusProgress(100, 10, -5)).toBe(0.1);
  });
  it('a status maps to the queue vocabulary: 0 network, 409 offset, 413 too-large, else refused', () => {
    expect(tusFailureOf(0)).toBe('network');
    expect(tusFailureOf(409)).toBe('offset');
    expect(tusFailureOf(413)).toBe('too-large');
    expect(tusFailureOf(400)).toBe('refused');
    expect(tusFailureOf(500)).toBe('refused');
  });
});

describe('tus — the resume entry', () => {
  const entry = { uploadUrl: 'https://abc.supabase.co/storage/v1/upload/resumable/sign/x', path: 'incoming/o/i.mp4', token: 't', size: 10, type: 'video/mp4', savedAt: 1_000 };
  it('isResumeEntry demands an https URL, a key, a token, a positive size, a type and a time', () => {
    expect(isResumeEntry(entry)).toBe(true);
    expect(isResumeEntry({ ...entry, uploadUrl: 'http://x' })).toBe(false);
    expect(isResumeEntry({ ...entry, path: '' })).toBe(false);
    expect(isResumeEntry({ ...entry, token: '' })).toBe(false);
    expect(isResumeEntry({ ...entry, size: 0 })).toBe(false);
    expect(isResumeEntry(null)).toBe(false);
    expect(isResumeEntry('x')).toBe(false);
  });
  it('an entry continues the same file only, inside the TTL (23 h, an hour under the service URL)', () => {
    expect(RESUME_TTL_MS).toBe(23 * 60 * 60 * 1000);
    expect(resumeEntryUsable(entry, { size: 10, type: 'video/mp4' }, 2_000)).toBe(true);
    expect(resumeEntryUsable(entry, { size: 11, type: 'video/mp4' }, 2_000)).toBe(false);
    expect(resumeEntryUsable(entry, { size: 10, type: 'video/quicktime' }, 2_000)).toBe(false);
    expect(resumeEntryUsable(entry, { size: 10, type: 'video/mp4' }, 1_000 + RESUME_TTL_MS)).toBe(false);
    expect(resumeEntryUsable(entry, { size: 10, type: 'video/mp4' }, 500)).toBe(false); // a clock that went backwards
    expect(resumeEntryUsable(null, { size: 10, type: 'video/mp4' }, 2_000)).toBe(false);
  });
});
