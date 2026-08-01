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

/**
 * Buckets the sweep is allowed to delete from.
 *
 * `consent-evidence` is DELIBERATELY ABSENT and must stay that way: it holds
 * the legal audit trail for minors' consent, and the account-deletion engine
 * denylists it for the same reason. Removing files from it is not cleanup,
 * it is destroying evidence.
 *
 * `badges` is absent because nothing writes user-owned files there yet. If
 * that changes, add it here *together with* the columns that reference it —
 * a bucket listed without reference sources would look 100% orphaned and the
 * sweep would delete all of it.
 */
export const SWEEP_BUCKETS = ['uploads', 'avatars'] as const;
export type SweepBucket = (typeof SWEEP_BUCKETS)[number];

/**
 * Every (table, columns) pair that can hold a public storage URL.
 *
 * Scanned for EVERY swept bucket — `bucketPathFromUrl` discards URLs belonging
 * to another bucket, so listing a column here is never wrong for a bucket it
 * doesn't apply to. That asymmetry is the point: adding a source can only ever
 * GROW the referenced set, so it can only ever prevent a deletion, never cause
 * one. When in doubt, add the column.
 *
 * The reverse is what bites. A column that holds a live URL and is missing here
 * makes its files look unreferenced, and once the cron deletes for real that is
 * silent data loss. `group_post_media.thumbnail_url` (migration 060, hole-video
 * poster frames) was exactly that: absent here, empty in the database, and so
 * invisible until the first poster frame was written.
 */
export const URL_SOURCE_COLUMNS: readonly { table: string; columns: string[] }[] = [
  { table: 'post_media', columns: ['media_url', 'thumbnail_url'] },
  { table: 'group_post_media', columns: ['media_url', 'thumbnail_url'] },
  { table: 'messages', columns: ['media_url'] },
  { table: 'profiles', columns: ['avatar_url', 'cover_url'] },
  { table: 'conversations', columns: ['avatar_url'] },
  { table: 'athlete_equipment', columns: ['image_url'] },
  { table: 'athlete_badges', columns: ['icon_url'] },
];

export interface StorageFile {
  path: string; // full path within the bucket, e.g. "posts/<uid>/<file>.png"
  createdAt: string | null;
}

/**
 * Path within `bucket` for a public URL, or null if the URL doesn't point at
 * that bucket (external hosts, a different bucket, malformed).
 *
 * Plain string matching rather than a built regex: the bucket name is
 * interpolated, and a regex would need escaping to stay safe. The trailing
 * slash in the marker is what stops bucket "uploads" matching "uploads2/".
 */
export function bucketPathFromUrl(url: unknown, bucket: string): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  let rest = url.slice(at + marker.length);
  const cut = rest.search(/[?#]/);
  if (cut !== -1) rest = rest.slice(0, cut);
  if (!rest) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/** Back-compat shorthand for the uploads bucket. */
export function uploadsPathFromUrl(url: unknown): string | null {
  return bucketPathFromUrl(url, 'uploads');
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
