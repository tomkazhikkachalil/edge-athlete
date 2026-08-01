import { getSupabaseAdmin } from '@/lib/auth-server';
import {
  GRACE_MS,
  SWEEP_BUCKETS,
  URL_SOURCE_COLUMNS,
  type StorageFile,
  type SweepBucket,
  bucketPathFromUrl,
  collectSetMediaPaths,
  isSweepable,
} from '@/lib/storage-sweep';

// Server-side sweep orchestration, shared by the admin route (manual trigger)
// and the weekly cron. Pure helpers stay in storage-sweep.ts.

const PAGE = 1000;
const REMOVE_BATCH = 100;
// Two levels of folders exist today (posts/<uid>/file and <uid>/file);
// the walker tolerates one more before bailing rather than recursing forever.
const MAX_DEPTH = 4;

type Admin = ReturnType<typeof getSupabaseAdmin>;

export interface SweepBucketSummary {
  bucket: SweepBucket;
  scannedFiles: number;
  referencedPaths: number;
  unreferencedInGrace: number;
  orphans: number;
  deleted: number;
  failed: number;
  orphanPaths: string[]; // bucket-relative
}

export interface SweepSummary {
  dryRun: boolean;
  scannedFiles: number;
  referencedPaths: number;
  graceHours: number;
  unreferencedInGrace: number;
  orphans: number;
  deleted: number;
  failed: number;
  /** Qualified as `<bucket>/<path>` — the sweep spans more than one bucket. */
  orphanPaths: string[];
  byBucket: SweepBucketSummary[];
}

/** Every path in `bucket` referenced anywhere in the DB. */
async function collectReferencedPaths(supabase: Admin, bucket: SweepBucket): Promise<Set<string>> {
  const referenced = new Set<string>();

  const addUrlColumn = async (table: string, columns: string[]) => {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select(columns.join(','))
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`${table} scan failed: ${error.message}`);
      for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
        for (const col of columns) {
          const path = bucketPathFromUrl(row[col], bucket);
          if (path) referenced.add(path);
        }
      }
      if (!data || data.length < PAGE) break;
    }
  };

  for (const src of URL_SOURCE_COLUMNS) {
    try {
      await addUrlColumn(src.table, src.columns);
    } catch (e) {
      // profiles.cover_url doesn't exist until migration 047 — degrade to the
      // columns that do rather than failing the whole sweep. Any other failure
      // is rethrown ON PURPOSE: a missed reference source makes live files look
      // unreferenced, so failing the sweep (and deleting nothing) is always
      // safer than completing it against an incomplete reference set.
      if (src.table === 'profiles' && src.columns.includes('cover_url')) {
        await addUrlColumn('profiles', src.columns.filter(c => c !== 'cover_url'));
      } else {
        throw e;
      }
    }
  }

  if (bucket === 'uploads') {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('workout_sets')
        .select('media')
        .neq('media', '[]')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`workout_sets scan failed: ${error.message}`);
      for (const path of collectSetMediaPaths((data ?? []).map(r => r.media))) {
        referenced.add(path);
      }
      if (!data || data.length < PAGE) break;
    }
  }

  return referenced;
}

/** All files in `bucket` (folders recursed, pagination handled). */
async function listAllFiles(supabase: Admin, bucket: SweepBucket): Promise<StorageFile[]> {
  const files: StorageFile[] = [];
  const walk = async (prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(prefix, { limit: PAGE, offset });
      if (error) throw new Error(`storage list "${bucket}/${prefix}" failed: ${error.message}`);
      for (const entry of data ?? []) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id) {
          files.push({ path, createdAt: entry.created_at ?? null });
        } else {
          await walk(path, depth + 1); // folders come back with id: null
        }
      }
      if (!data || data.length < PAGE) break;
    }
  };
  await walk('', 0);
  return files;
}

/** Sweep one bucket. Files younger than GRACE_MS are never touched. */
async function sweepBucket(
  supabase: Admin,
  bucket: SweepBucket,
  dryRun: boolean
): Promise<SweepBucketSummary> {
  const referenced = await collectReferencedPaths(supabase, bucket);
  const files = await listAllFiles(supabase, bucket);

  const now = Date.now();
  const orphans = files.filter(f => isSweepable(f, referenced, now));
  const inGrace = files.filter(
    f => !referenced.has(f.path) && !isSweepable(f, referenced, now)
  ).length;

  let deleted = 0;
  const failures: string[] = [];
  if (!dryRun && orphans.length > 0) {
    for (let i = 0; i < orphans.length; i += REMOVE_BATCH) {
      const batch = orphans.slice(i, i + REMOVE_BATCH).map(f => f.path);
      const { error } = await supabase.storage.from(bucket).remove(batch);
      if (error) {
        console.error(`[SWEEP] ${bucket} batch remove failed:`, error);
        failures.push(...batch);
      } else {
        deleted += batch.length;
      }
    }
  }

  return {
    bucket,
    scannedFiles: files.length,
    referencedPaths: referenced.size,
    unreferencedInGrace: inGrace,
    orphans: orphans.length,
    deleted,
    failed: failures.length,
    // Cap the listing so the response stays reasonable on big sweeps
    orphanPaths: orphans.slice(0, 200).map(f => f.path),
  };
}

/**
 * Find (and unless dryRun, delete) files no DB row references anymore, across
 * every bucket in SWEEP_BUCKETS. Files younger than GRACE_MS are never touched.
 *
 * Previously uploads-only, which meant deleting a user left their avatar in the
 * `avatars` bucket forever — nothing ever collected it.
 */
export async function runStorageSweep(supabase: Admin, dryRun: boolean): Promise<SweepSummary> {
  const byBucket: SweepBucketSummary[] = [];
  for (const bucket of SWEEP_BUCKETS) {
    byBucket.push(await sweepBucket(supabase, bucket, dryRun));
  }

  const sum = (pick: (b: SweepBucketSummary) => number) =>
    byBucket.reduce((total, b) => total + pick(b), 0);

  return {
    dryRun,
    scannedFiles: sum(b => b.scannedFiles),
    referencedPaths: sum(b => b.referencedPaths),
    graceHours: GRACE_MS / 3_600_000,
    unreferencedInGrace: sum(b => b.unreferencedInGrace),
    orphans: sum(b => b.orphans),
    deleted: sum(b => b.deleted),
    failed: sum(b => b.failed),
    orphanPaths: byBucket.flatMap(b => b.orphanPaths.map(p => `${b.bucket}/${p}`)),
    byBucket,
  };
}
