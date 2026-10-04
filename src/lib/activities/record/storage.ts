// ── Where a recording lives while it is being made (Live Activities) ───────
// IndexedDB, not localStorage: a three-hour ride at one fix a second is
// ~10,000 points (~1 MB of JSON) written every few seconds, and the pending
// photo blobs ride along — localStorage is synchronous on the main thread
// and capped at ~5 MB. The pure parts (what to persist, when to flush, when
// a draft has expired) are here and unit-tested; the IndexedDB calls are a
// small promise wrapper, feature-detected: a browser without it keeps the
// recording in memory and the screen says a reload would lose it.
//
// Three stores: `recordings` (the state WITHOUT points, keyed by id),
// `points` (batches, keyed [id, seq]), `photos` (pending File blobs, keyed
// [id, localId]). A recording older than RECORDING_TTL_MS is purged — the
// workout draft's 48 h.

import type { ActivityPoint } from '../types';
import type { RecordingState } from './recording';

export const DB_NAME = 'ea-activity-recorder';
export const DB_VERSION = 1;
export const RECORDING_TTL_MS = 48 * 60 * 60 * 1000;
/** Points are flushed every this many admitted fixes … */
export const FLUSH_EVERY_POINTS = 10;
/** … or this often, whichever comes first. */
export const FLUSH_EVERY_MS = 15_000;

export type RecordingMeta = Omit<RecordingState, 'points'> & { pointCount: number; savedAt: number };

/** The state without its points — what the `recordings` store holds. */
export function metaOf(state: RecordingState, savedAt: number): RecordingMeta {
  const { points, ...rest } = state;
  return { ...rest, pointCount: points.length, savedAt };
}

/** Whether a flush is due: enough new points, or enough time since the last. */
export function flushDue(pendingPoints: number, lastFlushAt: number, now: number): boolean {
  return pendingPoints >= FLUSH_EVERY_POINTS || (pendingPoints > 0 && now - lastFlushAt >= FLUSH_EVERY_MS);
}

/** A saved recording older than the TTL is gone. */
export function isExpired(meta: { savedAt: number }, now: number): boolean {
  return now - meta.savedAt > RECORDING_TTL_MS;
}

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('points')) db.createObjectStore('points', { keyPath: ['id', 'seq'] });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: ['id', 'localId'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out: T | undefined;
    const req = run(s);
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error ?? new Error('indexedDB transaction failed'));
    t.onabort = () => reject(t.error ?? new Error('indexedDB transaction aborted'));
  });
}

export interface RecordingStore {
  saveMeta(state: RecordingState, now: number): Promise<void>;
  appendPoints(id: string, seq: number, points: readonly ActivityPoint[]): Promise<void>;
  savePhoto(id: string, localId: string, file: Blob): Promise<void>;
  loadPhoto(id: string, localId: string): Promise<Blob | null>;
  load(id: string): Promise<RecordingState | null>;
  findUnfinished(profileId: string, now: number): Promise<RecordingMeta | null>;
  clear(id: string): Promise<void>;
  purgeExpired(now: number): Promise<void>;
}

/** The IndexedDB-backed store, or null where the browser has none. */
export function openRecordingStore(): RecordingStore | null {
  if (!hasIndexedDb()) return null;
  const dbp = openDb();
  return {
    async saveMeta(state, now) {
      const db = await dbp;
      await tx(db, 'recordings', 'readwrite', s => s.put(metaOf(state, now)));
    },
    async appendPoints(id, seq, points) {
      if (points.length === 0) return;
      const db = await dbp;
      await tx(db, 'points', 'readwrite', s => s.put({ id, seq, points: points.map(p => ({ ...p })) }));
    },
    async savePhoto(id, localId, file) {
      const db = await dbp;
      await tx(db, 'photos', 'readwrite', s => s.put({ id, localId, file }));
    },
    async loadPhoto(id, localId) {
      const db = await dbp;
      const row = await tx<{ file: Blob } | undefined>(db, 'photos', 'readonly', s => s.get([id, localId]) as IDBRequest<{ file: Blob } | undefined>);
      return row?.file ?? null;
    },
    async load(id) {
      const db = await dbp;
      const meta = await tx<RecordingMeta | undefined>(db, 'recordings', 'readonly', s => s.get(id) as IDBRequest<RecordingMeta | undefined>);
      if (!meta) return null;
      const batches = await tx<Array<{ seq: number; points: ActivityPoint[] }>>(db, 'points', 'readonly', s =>
        s.getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])) as IDBRequest<Array<{ seq: number; points: ActivityPoint[] }>>
      );
      const points = (batches ?? []).sort((a, b) => a.seq - b.seq).flatMap(b => b.points);
      const { pointCount: _count, savedAt: _savedAt, ...rest } = meta;
      void _count;
      void _savedAt;
      return { ...rest, points } as RecordingState;
    },
    async findUnfinished(profileId, now) {
      const db = await dbp;
      const all = (await tx<RecordingMeta[]>(db, 'recordings', 'readonly', s => s.getAll() as IDBRequest<RecordingMeta[]>)) ?? [];
      const mine = all.filter(m => m.profileId === profileId && m.status !== 'idle' && !isExpired(m, now));
      mine.sort((a, b) => b.savedAt - a.savedAt);
      return mine[0] ?? null;
    },
    async clear(id) {
      const db = await dbp;
      await tx(db, 'recordings', 'readwrite', s => s.delete(id));
      await tx(db, 'points', 'readwrite', s => s.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
      await tx(db, 'photos', 'readwrite', s => s.delete(IDBKeyRange.bound([id, ''], [id, '￿'])));
    },
    async purgeExpired(now) {
      const db = await dbp;
      const all = (await tx<RecordingMeta[]>(db, 'recordings', 'readonly', s => s.getAll() as IDBRequest<RecordingMeta[]>)) ?? [];
      for (const m of all) if (isExpired(m, now)) await this.clear(m.id);
    },
  };
}
