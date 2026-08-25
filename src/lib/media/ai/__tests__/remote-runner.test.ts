import { describe, it, expect, vi } from 'vitest';
import { createRemoteRunner } from '../remote-runner';
import { encodeMaskRle } from '../../engine/mask-rle';

const validMask = () => {
  const buf = new Float32Array(64 * 64);
  for (let i = 2000; i < 2600; i++) buf[i] = 1;
  return { width: 64, height: 64, rle: encodeMaskRle(buf) };
};

function mockFetch(response: Partial<Response> | Error): typeof fetch {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return {
      ok: true,
      json: async () => ({}),
      ...response,
    } as Response;
  }) as unknown as typeof fetch;
}

const image = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });

describe('createRemoteRunner.segmentSubject', () => {
  it('posts the image to {base}/segment and returns a validated mask', async () => {
    const payload = validMask();
    const fetchImpl = mockFetch({ ok: true, json: async () => payload });
    const runner = createRemoteRunner('http://localhost:8765/', fetchImpl);
    expect(runner.endpoint).toBe('http://localhost:8765'); // trailing slash trimmed
    const result = await runner.segmentSubject(image);
    expect(result).toEqual(payload);
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('http://localhost:8765/segment');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['Content-Type']).toBe('image/jpeg');
  });

  it('returns null on non-200 responses', async () => {
    const runner = createRemoteRunner('http://x', mockFetch({ ok: false }));
    expect(await runner.segmentSubject(image)).toBeNull();
  });

  it('returns null on schema violations (an AI endpoint is untrusted input)', async () => {
    for (const bad of [
      { width: 64, height: 64 }, // missing rle
      { width: 9000, height: 64, rle: '10,10' }, // dim over cap
      { width: 64, height: 64, rle: '' }, // empty rle
      'not-an-object',
    ]) {
      const runner = createRemoteRunner('http://x', mockFetch({ ok: true, json: async () => bad }));
      expect(await runner.segmentSubject(image)).toBeNull();
    }
  });

  it('returns null when the RLE does not decode at the claimed dimensions', async () => {
    const runner = createRemoteRunner(
      'http://x',
      mockFetch({ ok: true, json: async () => ({ width: 64, height: 64, rle: '10,10' }) })
    );
    expect(await runner.segmentSubject(image)).toBeNull();
  });

  it('returns null on network failure — never throws into the editor', async () => {
    const runner = createRemoteRunner('http://x', mockFetch(new Error('ECONNREFUSED')));
    expect(await runner.segmentSubject(image)).toBeNull();
  });
});
