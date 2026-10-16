import { describe, it, expect, vi } from 'vitest';
import { createUploadQueue, failedForRetryOnline, reduceQueue, settleSummary, type QueueItem, type QueueState } from '../upload-queue';
import { failureKindOf, UploadError, type UploadedMedia } from '../upload';

// Video posters program, PR 2 (Oct 13 2026): the one upload queue — the
// state machine and the runtime, with a fake uploader and no browser.

// The runtime creates object URLs for previews; node has none.
const urls: string[] = [];
(globalThis as unknown as { URL: typeof URL }).URL.createObjectURL = ((blob: Blob) => { const u = `blob:test/${urls.length}-${blob.size}`; urls.push(u); return u; }) as typeof URL.createObjectURL;
(globalThis as unknown as { URL: typeof URL }).URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;

const file = (name: string, type = 'image/jpeg', size = 10) => new File([new Uint8Array(size)], name, { type });
const tick = () => new Promise(r => setTimeout(r, 0));
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

describe('reduceQueue — the state machine', () => {
  const reg = (s: QueueState, id: string, kind: 'image' | 'video' = 'image') => reduceQueue(s, { type: 'register', localId: id, kind });
  it('register → pending at generation 1; a second register is a no-op', () => {
    const s = reg({}, 'a');
    expect(s.a).toMatchObject({ status: 'pending', generation: 1, progress: 0, posterAttempts: 0 });
    expect(reg(s, 'a')).toBe(s);
  });
  it('progress, stored and failed honour the generation; a stale event is a no-op', () => {
    let s = reg({}, 'a');
    s = reduceQueue(s, { type: 'progress', localId: 'a', generation: 1, fraction: 0.5 });
    expect(s.a.progress).toBe(0.5);
    expect(reduceQueue(s, { type: 'progress', localId: 'a', generation: 0, fraction: 0.9 })).toBe(s);
    expect(reduceQueue(s, { type: 'stored', localId: 'a', generation: 2, url: 'x' })).toBe(s);
    s = reduceQueue(s, { type: 'stored', localId: 'a', generation: 1, url: 'https://x/a.jpg' });
    expect(s.a).toMatchObject({ status: 'stored', progress: 1, storedUrl: 'https://x/a.jpg', processing: false });
    // processing = stored but converting
    const p = reduceQueue(reg({}, 'v', 'video'), { type: 'stored', localId: 'v', generation: 1, url: 'u', processing: true });
    expect(p.v.status).toBe('processing');
  });
  it('replace bumps the generation and drops what the old bytes earned; retry only from failed', () => {
    let s = reg({}, 'a', 'video');
    s = reduceQueue(s, { type: 'stored', localId: 'a', generation: 1, url: 'u1' });
    s = reduceQueue(s, { type: 'poster', localId: 'a', generation: 1, url: 'p1' });
    s = reduceQueue(s, { type: 'replace', localId: 'a' });
    expect(s.a).toMatchObject({ status: 'pending', generation: 2, storedUrl: undefined, posterUrl: undefined, progress: 0 });
    // The old generation's poster, landing late, is ignored.
    expect(reduceQueue(s, { type: 'poster', localId: 'a', generation: 1, url: 'p-late' })).toBe(s);
    expect(reduceQueue(s, { type: 'retry', localId: 'a' })).toBe(s); // pending, not failed
    s = reduceQueue(s, { type: 'failed', localId: 'a', generation: 2, failure: { kind: 'network', message: 'x' } });
    s = reduceQueue(s, { type: 'retry', localId: 'a' });
    expect(s.a).toMatchObject({ status: 'pending', generation: 3, failure: undefined });
  });
  it('forget removes; blur and poster-attempt are generation-free', () => {
    let s = reg({}, 'a');
    s = reduceQueue(s, { type: 'blur', localId: 'a', hash: 'h' });
    s = reduceQueue(s, { type: 'poster-attempt', localId: 'a' });
    expect(s.a).toMatchObject({ blurHash: 'h', posterAttempts: 1 });
    expect(reduceQueue(s, { type: 'blur', localId: 'a', hash: 'h' })).toBe(s);
    expect(reduceQueue(s, { type: 'forget', localId: 'a' })).toEqual({});
    expect(reduceQueue({}, { type: 'forget', localId: 'nope' })).toEqual({});
  });
});

describe('failedForRetryOnline / settleSummary', () => {
  const item = (localId: string, status: QueueItem['status'], kind?: QueueItem['failure'] extends infer F ? (F extends { kind: infer K } ? K : never) : never): QueueItem =>
    ({ localId, kind: 'image', status, generation: 1, progress: 0, posterAttempts: 0, ...(kind ? { failure: { kind, message: '' } } : {}) });
  it('a reconnect re-queues network and offline failures only', () => {
    const items = [item('n', 'failed', 'network'), item('o', 'failed', 'offline'), item('r', 'failed', 'refused'), item('t', 'failed', 'too-large'), item('p', 'pending'), item('s', 'stored')];
    expect(failedForRetryOnline(items)).toEqual(['n', 'o']);
    expect(settleSummary(items)).toEqual({ failed: 4, pending: 1, processing: 0 });
  });
});

describe('failureKindOf', () => {
  it('an UploadError carries its kind; a fetch TypeError is network; anything else refused', () => {
    expect(failureKindOf(new UploadError('too-large', 'x'))).toBe('too-large');
    expect(failureKindOf(new TypeError('Failed to fetch'))).toBe('network');
    expect(failureKindOf(new Error('Nope'))).toBe('refused');
    expect(failureKindOf('string')).toBe('refused');
  });
});

describe('createUploadQueue — the runtime', () => {
  function harness(over: { online?: boolean; upload?: (f: File) => Promise<UploadedMedia> } = {}) {
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const releases = new Map<string, () => void>();
    const upload = over.upload ?? (async (f: File) => {
      calls.push(f.name);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>(resolve => releases.set(f.name, resolve));
      inFlight -= 1;
      return { url: `https://x/${f.name}`, type: f.type.startsWith('video/') ? 'video' as const : 'image' as const };
    });
    let online = over.online ?? true;
    const listeners = new Set<() => void>();
    const states: QueueState[] = [];
    const stored: string[] = [];
    const notices: string[] = [];
    const queue = createUploadQueue({
      sessionId: 's',
      stash: null,
      upload,
      onChange: s => states.push(s),
      onStored: item => stored.push(item.localId),
      notify: (t, m) => notices.push(`${t}: ${m}`),
      isOnline: () => online,
      subscribeOnline: l => { listeners.add(l); return () => listeners.delete(l); },
    });
    return {
      queue, calls, states, stored, notices,
      release: (name: string) => { releases.get(name)?.(); releases.delete(name); },
      maxInFlight: () => maxInFlight,
      setOnline: (v: boolean) => { online = v; listeners.forEach(l => l()); },
      listeners,
    };
  }

  it('register is synchronous (the tile first); uploads run one at a time; stored carries the URL and tells the host', async () => {
    const h = harness();
    const [a, b] = h.queue.register([file('a.jpg'), file('b.jpg')]);
    expect(a.status).toBe('pending');
    expect(h.queue.previewFor(a.localId)).toMatch(/^blob:/);
    expect(h.calls).toEqual([]); // nothing before the microtask
    await flush();
    expect(h.calls).toEqual(['a.jpg']); // b waits for a
    h.release('a.jpg');
    await flush();
    expect(h.queue.itemFor(a.localId)).toMatchObject({ status: 'stored', storedUrl: 'https://x/a.jpg', progress: 1 });
    expect(h.stored).toEqual([a.localId]);
    expect(h.calls).toEqual(['a.jpg', 'b.jpg']);
    h.release('b.jpg');
    const summary = await h.queue.settle();
    expect(summary).toEqual({ failed: 0, pending: 0, processing: 0 });
    expect(h.maxInFlight()).toBe(1);
    expect(h.queue.itemFor(b.localId)?.status).toBe('stored');
  });

  it('a failure keeps the file and says why; retry re-uploads under a new generation', async () => {
    let attempts = 0;
    const h = harness({ upload: async () => { attempts += 1; if (attempts === 1) throw new UploadError('network', 'interrupted'); return { url: 'https://x/ok', type: 'image' }; } });
    const [a] = h.queue.register([file('a.jpg')]);
    await flush();
    expect(h.queue.itemFor(a.localId)).toMatchObject({ status: 'failed', failure: { kind: 'network', message: 'interrupted' } });
    expect(h.notices).toEqual(['Upload failed: interrupted']);
    expect(h.queue.fileFor(a.localId)?.name).toBe('a.jpg');
    h.queue.retry(a.localId);
    expect(h.queue.itemFor(a.localId)).toMatchObject({ status: 'pending', generation: 2 });
    await flush();
    expect(h.queue.itemFor(a.localId)).toMatchObject({ status: 'stored', storedUrl: 'https://x/ok' });
  });

  it('offline: an attempt fails at once as offline without calling the uploader; the connection returning re-queues it by itself', async () => {
    const h = harness({ online: false });
    const [a] = h.queue.register([file('a.jpg')]);
    await flush();
    expect(h.calls).toEqual([]);
    expect(h.queue.itemFor(a.localId)).toMatchObject({ status: 'failed', failure: { kind: 'offline' } });
    h.setOnline(true);
    await flush();
    expect(h.calls).toEqual(['a.jpg']);
    h.release('a.jpg');
    await flush();
    expect(h.queue.itemFor(a.localId)?.status).toBe('stored');
  });

  it('a refused upload is NOT retried on reconnect', async () => {
    const h = harness({ upload: async () => { throw new UploadError('too-large', 'too big'); } });
    const [a] = h.queue.register([file('a.jpg')]);
    await flush();
    expect(h.queue.itemFor(a.localId)?.failure?.kind).toBe('too-large');
    h.setOnline(true);
    await flush();
    expect(h.queue.itemFor(a.localId)?.status).toBe('failed');
  });

  it('replaceWithEdited bumps the generation: the OLD bytes landing later are ignored, the new ones win, the poster rides after', async () => {
    const h = harness();
    const [a] = h.queue.register([file('a.mp4', 'video/mp4')]);
    await flush();
    expect(h.calls).toEqual(['a.mp4']);
    h.queue.replaceWithEdited(a.localId, file('a-edited.mp4', 'video/mp4'), { posterBlob: new Blob([new Uint8Array(3)], { type: 'image/jpeg' }) });
    expect(h.queue.itemFor(a.localId)).toMatchObject({ status: 'pending', generation: 2, posterAttempts: 1 });
    h.release('a.mp4'); // the old upload lands — ignored
    await flush();
    expect(h.queue.itemFor(a.localId)).toMatchObject({ status: 'pending', storedUrl: undefined });
    expect(h.calls).toEqual(['a.mp4', 'a-edited.mp4']);
    h.release('a-edited.mp4');
    await flush();
    expect(h.queue.itemFor(a.localId)).toMatchObject({ status: 'stored', storedUrl: 'https://x/a-edited.mp4' });
    expect(h.calls).toEqual(['a.mp4', 'a-edited.mp4', 'poster.jpg']);
    h.release('poster.jpg');
    await h.queue.settle();
    expect(h.queue.itemFor(a.localId)?.posterUrl).toBe('https://x/poster.jpg');
  });

  it('waitFor resolves at stored or failed; settle waits for work enqueued meanwhile; forget drops everything', async () => {
    const h = harness();
    const [a] = h.queue.register([file('a.jpg')]);
    const settled = h.queue.waitFor(a.localId);
    await flush();
    h.release('a.jpg');
    expect((await settled).status).toBe('stored');
    const [b] = h.queue.register([file('b.jpg')]);
    const settle = h.queue.settle();
    await flush();
    h.queue.attachOriginal(b.localId, file('b-orig.jpg'));
    h.release('b.jpg');
    await flush();
    h.release('b-orig.jpg');
    expect(await settle).toEqual({ failed: 0, pending: 0, processing: 0 });
    expect(h.queue.itemFor(b.localId)).toMatchObject({ storedUrl: 'https://x/b.jpg', sourceUrl: 'https://x/b-orig.jpg' });
    h.queue.forget(b.localId);
    expect(h.queue.itemFor(b.localId)).toBeUndefined();
    expect(h.queue.fileFor(b.localId)).toBeNull();
    await expect(h.queue.waitFor('nope')).rejects.toThrow('Unknown upload');
  });

  it('prepare runs once on the device chain before the upload and keeps the original for the host', async () => {
    const prepare = vi.fn(async (f: File) => ({ file: file(`small-${f.name}`), original: f, width: 10, height: 20 }));
    const calls: string[] = [];
    const queue = createUploadQueue({
      sessionId: 's', stash: null, prepare,
      upload: async f => { calls.push(f.name); return { url: `https://x/${f.name}`, type: 'image' }; },
      onChange: () => undefined, isOnline: () => true, subscribeOnline: () => () => undefined,
    });
    const [a] = queue.register([file('a.jpg')]);
    await queue.settle();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['small-a.jpg']);
    expect(queue.itemFor(a.localId)).toMatchObject({ status: 'stored', prepared: { width: 10, height: 20, resized: true } });
    expect(queue.originalFor(a.localId)?.name).toBe('a.jpg');
    expect(queue.fileFor(a.localId)?.name).toBe('small-a.jpg');
  });

  it('the stash entry goes when the upload lands — unless the host keeps its bytes until it clears them', async () => {
    const removed: string[] = [];
    const stash = { save: async () => undefined, load: async () => null, listSession: async () => [], remove: async (_s: string, id: string) => { removed.push(id); }, clearSession: async () => undefined, sweepExpired: async () => undefined };
    const upload = async (f: File) => ({ url: `https://x/${f.name}`, type: 'image' as const });
    const base = { sessionId: 's', stash, upload, onChange: () => undefined, isOnline: () => true, subscribeOnline: () => () => undefined };
    const dropping = createUploadQueue(base);
    const [a] = dropping.register([file('a.jpg')]);
    await dropping.settle();
    expect(removed).toEqual([a.localId]);
    const keeping = createUploadQueue({ ...base, keepStashedAfterUpload: true });
    const [b] = keeping.register([file('b.jpg')]);
    await keeping.settle();
    expect(removed).toEqual([a.localId]);
    keeping.forget(b.localId);
    expect(removed).toEqual([a.localId, b.localId]);
  });

  it('destroy unsubscribes from the connection', () => {
    const h = harness();
    expect(h.listeners.size).toBe(1);
    h.queue.destroy();
    expect(h.listeners.size).toBe(0);
  });

  it('holdDevice: device work waits while the editor holds it; a released hold lets it run; holds nest; destroy frees a waiter', async () => {
    const h = harness();
    const ran: string[] = [];
    const release = h.queue.holdDevice();
    const second = h.queue.holdDevice();
    const done = h.queue.device(async () => { ran.push('resize'); return 1; });
    await flush();
    expect(ran).toEqual([]); // held
    release();
    release(); // idempotent — the other hold still stands
    await flush();
    expect(ran).toEqual([]);
    second();
    await flush();
    expect(ran).toEqual(['resize']);
    await expect(done).resolves.toBe(1);

    const h2 = harness();
    h2.queue.holdDevice();
    const waiting = h2.queue.device(async () => 'ran');
    h2.queue.destroy();
    await expect(waiting).resolves.toBe('ran'); // never stranded
  });
});
