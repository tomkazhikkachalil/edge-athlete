/**
 * Capture stash (browser-only; IndexedDB). The composer's crash-draft
 * (posts/composer-draft.ts) has always carried the caption and settings
 * through a reload but never the media — "Media Files still can't ride
 * localStorage" was the documented limit. IndexedDB CAN hold a File, so
 * picked or captured files are written here the instant they arrive
 * (before the editor opens and its full-resolution decode begins), and a
 * tab that iOS Safari reloads under memory pressure offers them back.
 *
 * Why this exists (Tom, Sep 3 2026 device pass): taking a photo from the
 * feed composer on an iPhone ended in a page reload and a lost photo. The
 * stash makes every reload that happens AFTER the file reaches the page
 * recoverable; a reload that happens while the native camera is still open
 * (before the change event) never reaches us — the restore banner not
 * appearing after such a reload is itself the diagnostic for that case.
 *
 * Contract: every function fails OPEN and quietly (private mode, quota, no
 * IndexedDB) — the stash is a safety net, never a gate on the pick. Files
 * are stored as {name, type, lastModified, blob} rather than File objects:
 * Safari has historically been unreliable cloning File into IndexedDB, and
 * reconstructing is free. `isFreshStash` is the one pure piece (unit-tested).
 */

const DB_NAME = 'ea-capture-stash';
const STORE = 'captures';
const DB_VERSION = 1;

/** Long enough to survive a reload and a moment of confusion, short enough
 *  that a week-old photo never resurfaces in an unrelated session. */
export const CAPTURE_STASH_TTL_MS = 30 * 60 * 1000;

export const COMPOSER_STASH_KEY = 'composer';

interface StoredFile {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
}

interface StashRecord {
  key: string;
  savedAt: number;
  files: StoredFile[];
}

export function isFreshStash(savedAt: unknown, now: number = Date.now()): boolean {
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return false;
  const age = now - savedAt;
  return age >= 0 && age <= CAPTURE_STASH_TTL_MS;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = op(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

function toStored(file: File): StoredFile {
  return { name: file.name, type: file.type, lastModified: file.lastModified, blob: file };
}

function toFile(stored: StoredFile): File {
  return new File([stored.blob], stored.name, {
    type: stored.type,
    lastModified: stored.lastModified,
  });
}

async function readRecord(key: string): Promise<StashRecord | undefined> {
  return run<StashRecord | undefined>('readonly', store => store.get(key) as IDBRequest<StashRecord | undefined>);
}

/** Replace the stash for `key` with exactly these files (empty = clear). */
export async function stashCaptures(key: string, files: File[]): Promise<void> {
  try {
    if (files.length === 0) {
      await run('readwrite', store => store.delete(key));
      return;
    }
    const record: StashRecord = { key, savedAt: Date.now(), files: files.map(toStored) };
    await run('readwrite', store => store.put(record));
  } catch (err) {
    console.warn('[capture-stash] write failed (fail-open):', err);
  }
}

/** Add newly picked files to whatever fresh stash already exists. */
export async function appendStashedCaptures(key: string, files: File[]): Promise<void> {
  if (files.length === 0) return;
  try {
    const current = await readRecord(key);
    const existing = current && isFreshStash(current.savedAt) ? current.files : [];
    const record: StashRecord = {
      key,
      savedAt: Date.now(),
      files: [...existing, ...files.map(toStored)],
    };
    await run('readwrite', store => store.put(record));
  } catch (err) {
    console.warn('[capture-stash] append failed (fail-open):', err);
  }
}

/** The fresh stash for `key` as Files, or null (stale stashes are deleted). */
export async function loadStashedCaptures(key: string, now: number = Date.now()): Promise<File[] | null> {
  try {
    const record = await readRecord(key);
    if (!record) return null;
    if (!isFreshStash(record.savedAt, now) || !Array.isArray(record.files) || record.files.length === 0) {
      await run('readwrite', store => store.delete(key));
      return null;
    }
    return record.files.map(toFile);
  } catch {
    return null;
  }
}

export async function clearCaptureStash(key: string): Promise<void> {
  try {
    await run('readwrite', store => store.delete(key));
  } catch {
    // Nothing to do — a stale stash expires on its own.
  }
}
