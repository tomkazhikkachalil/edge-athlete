/**
 * Where a workout clip's BYTES wait while it uploads (workout capture round,
 * Oct 8 2026). The set carries `pending:<localId>` (set-media-pending.ts);
 * this holds the file under the same key so a page iOS threw away while the
 * camera was up comes back with the clip and the upload resumes by itself.
 *
 * IndexedDB, mirroring the recorder's store (activities/record/storage.ts)
 * in shape, with ONE deliberate difference: the record holds an
 * **ArrayBuffer, never a Blob or File** — on Sep 3 2026 (round 4) WebKit
 * refused Blob records outright ("Error preparing Blob/File data to be
 * stored"), which is why the composer's stash of that day never worked on
 * Tom's phone. Feature-detected and fail-open: a browser without IndexedDB,
 * a private window or a quota error leaves the tile and the upload
 * untouched — only the reload-recovery is lost, and the screen says so
 * when it happens.
 *
 * TTL = the draft's 48 h: a stashed clip whose draft has expired is noise.
 */

import { DRAFT_TTL_MS } from './draft';

export const STASH_DB_NAME = 'ea-workout-media';
export const STASH_DB_VERSION = 1;
export const STASH_STORE = 'files';
export const STASH_TTL_MS = DRAFT_TTL_MS;

/** Where a clip belongs — the stash is the durable record of "a clip was
 *  attached HERE"; the set's `pending:` entry is derived from it on resume
 *  when the server copy won the reload without it (PR 4). */
export interface StashPlace {
  exerciseName: string;
  setNumber: number;
}

export interface StashRecord {
  sessionId: string;
  localId: string;
  bytes: ArrayBuffer;
  type: string;
  name: string;
  savedAt: number;
  /** Absent on records written before PR 4. */
  place?: StashPlace;
}

/** The stored shape of a file — pure, so the codec is testable without a browser. */
export function toStashRecord(
  sessionId: string,
  localId: string,
  bytes: ArrayBuffer,
  file: { type: string; name: string },
  now: number,
  place?: StashPlace
): StashRecord {
  return { sessionId, localId, bytes, type: file.type, name: file.name, savedAt: now, ...(place ? { place } : {}) };
}

/** A File again, from a record. */
export function fileFromStashRecord(record: StashRecord): File {
  return new File([record.bytes], record.name || `clip-${record.localId}`, { type: record.type });
}

export function isStashExpired(record: { savedAt: number }, now: number): boolean {
  return now - record.savedAt > STASH_TTL_MS;
}

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(STASH_DB_NAME, STASH_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STASH_STORE)) {
        db.createObjectStore(STASH_STORE, { keyPath: ['sessionId', 'localId'] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STASH_STORE, mode);
    const s = t.objectStore(STASH_STORE);
    let out: T | undefined;
    const req = run(s);
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error ?? new Error('indexedDB transaction failed'));
    t.onabort = () => reject(t.error ?? new Error('indexedDB transaction aborted'));
  });
}

export interface StashEntry {
  localId: string;
  file: File;
  place: StashPlace | null;
}

export interface MediaStash {
  save(sessionId: string, localId: string, file: File, now?: number, place?: StashPlace): Promise<void>;
  load(sessionId: string, localId: string, now?: number): Promise<File | null>;
  /** Every unexpired clip of a session, with its place. */
  listSession(sessionId: string, now?: number): Promise<StashEntry[]>;
  remove(sessionId: string, localId: string): Promise<void>;
  clearSession(sessionId: string): Promise<void>;
  /** Drops every record older than the TTL, across sessions. */
  sweepExpired(now?: number): Promise<void>;
}

const sessionRange = (sessionId: string) => IDBKeyRange.bound([sessionId, ''], [sessionId, '￿']);

/** The IndexedDB-backed stash, or null where the browser has none. */
export function openMediaStash(): MediaStash | null {
  if (!hasIndexedDb()) return null;
  const dbp = openDb();
  return {
    async save(sessionId, localId, file, now = Date.now(), place) {
      const bytes = await file.arrayBuffer();
      const db = await dbp;
      await tx(db, 'readwrite', s => s.put(toStashRecord(sessionId, localId, bytes, file, now, place)));
    },
    async load(sessionId, localId, now = Date.now()) {
      const db = await dbp;
      const row = await tx<StashRecord | undefined>(db, 'readonly', s => s.get([sessionId, localId]) as IDBRequest<StashRecord | undefined>);
      if (!row || isStashExpired(row, now)) return null;
      return fileFromStashRecord(row);
    },
    async listSession(sessionId, now = Date.now()) {
      const db = await dbp;
      const rows = (await tx<StashRecord[]>(db, 'readonly', s => s.getAll(sessionRange(sessionId)) as IDBRequest<StashRecord[]>)) ?? [];
      return rows
        .filter(r => !isStashExpired(r, now))
        .sort((a, b) => a.savedAt - b.savedAt)
        .map(r => ({ localId: r.localId, file: fileFromStashRecord(r), place: r.place ?? null }));
    },
    async remove(sessionId, localId) {
      const db = await dbp;
      await tx(db, 'readwrite', s => s.delete([sessionId, localId]));
    },
    async clearSession(sessionId) {
      const db = await dbp;
      await tx(db, 'readwrite', s => s.delete(sessionRange(sessionId)));
    },
    async sweepExpired(now = Date.now()) {
      const db = await dbp;
      const rows = (await tx<StashRecord[]>(db, 'readonly', s => s.getAll() as IDBRequest<StashRecord[]>)) ?? [];
      const expired = rows.filter(r => isStashExpired(r, now));
      if (expired.length === 0) return;
      await tx(db, 'readwrite', s => {
        for (const r of expired) s.delete([r.sessionId, r.localId]);
      });
    },
  };
}
