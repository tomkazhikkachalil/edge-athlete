import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import {
  GRACE_MS,
  type StorageFile,
  collectSetMediaPaths,
  isSweepable,
  uploadsPathFromUrl,
} from '@/lib/storage-sweep';

// Full-bucket walk + full-table reference scan can exceed the default limit.
export const maxDuration = 60;

const PAGE = 1000;
const REMOVE_BATCH = 100;
// Two levels of folders exist today (posts/<uid>/file and <uid>/file);
// the walker tolerates one more before bailing rather than recursing forever.
const MAX_DEPTH = 4;

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Every uploads-bucket path referenced anywhere in the DB. */
async function collectReferencedPaths(supabase: Admin): Promise<Set<string>> {
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
          const path = uploadsPathFromUrl(row[col]);
          if (path) referenced.add(path);
        }
      }
      if (!data || data.length < PAGE) break;
    }
  };

  await addUrlColumn('post_media', ['media_url', 'thumbnail_url']);
  await addUrlColumn('group_post_media', ['media_url']);
  await addUrlColumn('messages', ['media_url']);
  // Covers live in uploads (covers/{uid}/…); avatar_url normally points at
  // the avatars bucket (extractor returns null then) but the avatar route
  // has a bucket-fallback chain that can land in uploads — cheap insurance.
  try {
    await addUrlColumn('profiles', ['cover_url', 'avatar_url']);
  } catch {
    // cover_url doesn't exist until migration 047 runs — don't fail the sweep
    await addUrlColumn('profiles', ['avatar_url']);
  }

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

  return referenced;
}

/** All files in the uploads bucket (folders recursed, pagination handled). */
async function listAllFiles(supabase: Admin): Promise<StorageFile[]> {
  const files: StorageFile[] = [];
  const walk = async (prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase.storage
        .from('uploads')
        .list(prefix, { limit: PAGE, offset });
      if (error) throw new Error(`storage list "${prefix}" failed: ${error.message}`);
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

/**
 * POST /api/admin/storage-sweep — find (and optionally delete) uploads-bucket
 * files no DB row references anymore. Admin-only. Body: { dryRun?: boolean }.
 * DRY RUN BY DEFAULT — deletion requires an explicit { "dryRun": false }.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;

    const referenced = await collectReferencedPaths(supabase);
    const files = await listAllFiles(supabase);

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
        const { error } = await supabase.storage.from('uploads').remove(batch);
        if (error) {
          console.error('[SWEEP] batch remove failed:', error);
          failures.push(...batch);
        } else {
          deleted += batch.length;
        }
      }
    }

    return NextResponse.json({
      dryRun,
      scannedFiles: files.length,
      referencedPaths: referenced.size,
      graceHours: GRACE_MS / 3_600_000,
      unreferencedInGrace: inGrace,
      orphans: orphans.length,
      deleted,
      failed: failures.length,
      // Cap the listing so the response stays reasonable on big sweeps
      orphanPaths: orphans.slice(0, 200).map(f => f.path),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[SWEEP] error:', error);
    return NextResponse.json({ error: 'Storage sweep failed' }, { status: 500 });
  }
}
