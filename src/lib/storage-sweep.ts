/**
 * Orphaned-storage sweep — pure logic (route: /api/admin/storage-sweep).
 *
 * Files in the `uploads` bucket become orphans when their last DB reference
 * goes away without storage cleanup: set-media thumbnail removal, workout
 * discard, the entries PUT replace-all dropping sets, and historical post
 * deletions from before delete-time cleanup existed. The sweep compares
 * every stored file against every DB column that can hold an uploads URL
 * and reports/removes the unreferenced ones.
 *
 * SAFETY: uploads happen BEFORE the row that references them is written
 * (editor uploads → debounced snapshot PUT; composer uploads → post create),
 * so a just-uploaded file is legitimately unreferenced for a while. Files
 * younger than GRACE_MS are never swept.
 */

export const GRACE_MS = 48 * 60 * 60 * 1000;

export interface StorageFile {
  path: string; // full path within the bucket, e.g. "posts/<uid>/<file>.png"
  createdAt: string | null;
}

/**
 * Path within the uploads bucket for a public URL, or null if the URL
 * doesn't point at it (external hosts, other buckets, malformed).
 */
export function uploadsPathFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const m = /\/storage\/v1\/object\/public\/uploads\/(.+?)(?:[?#]|$)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Collect uploads-bucket paths from workout_sets.media jsonb values. */
export function collectSetMediaPaths(mediaValues: unknown[]): string[] {
  const paths: string[] = [];
  for (const media of mediaValues) {
    if (!Array.isArray(media)) continue;
    for (const item of media) {
      const path = uploadsPathFromUrl((item as { url?: unknown } | null)?.url);
      if (path) paths.push(path);
    }
  }
  return paths;
}

/**
 * Decide whether a file may be swept: unreferenced AND older than the grace
 * period. Missing/unparseable created_at is treated as NOT sweepable —
 * age is the only guard against deleting an in-flight upload.
 */
export function isSweepable(
  file: StorageFile,
  referencedPaths: ReadonlySet<string>,
  nowMs: number,
  graceMs: number = GRACE_MS
): boolean {
  if (referencedPaths.has(file.path)) return false;
  if (!file.createdAt) return false;
  const created = Date.parse(file.createdAt);
  if (Number.isNaN(created)) return false;
  return nowMs - created > graceMs;
}
