import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { defaultJobDeps, planBackfill, readMediaJobsStatus, runMediaJobsTick } from '@/lib/media/process-server';
import type { MediaJobTable } from '@/lib/media/media-jobs';
import { reportRouteError } from '@/lib/observability/report';

// A live `run` transcodes in this request: the worker's own ceiling.
export const maxDuration = 300;

const ACTIONS = new Set(['plan', 'run', 'retry']);
const TABLES: readonly MediaJobTable[] = ['post_media', 'activity_media'];

/**
 * GET /api/admin/media-jobs — the queue's numbers and the last outcomes (the
 * dashboard panel). POST — { action: 'plan' | 'run' | 'retry', dryRun?,
 * tables?, includeBlur?, limit? }. DRY RUN BY DEFAULT — a live action needs
 * an explicit { "dryRun": false }. `plan` lists (or enqueues) older rows
 * that need a job (PR 9's backfill); `run` claims and runs one tick HERE,
 * in the request (the cron's twin, for a preview or a stuck queue);
 * `retry` puts every failed job back in the queue. Admin-only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const status = await readMediaJobsStatus(getSupabaseAdmin());
    if (!status.ok) return NextResponse.json({ error: status.error }, { status: status.error.includes('261') ? 409 : 500 });
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[media-jobs] status error:', error);
    return NextResponse.json({ error: 'Media jobs status failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const admin = getSupabaseAdmin();
    const body = await request.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!ACTIONS.has(action)) return NextResponse.json({ error: 'action must be plan, run or retry' }, { status: 400 });
    const dryRun = body?.dryRun !== false;
    if (action === 'plan') {
      const tables = Array.isArray(body?.tables) ? TABLES.filter(t => body.tables.includes(t)) : [...TABLES];
      const limit = typeof body?.limit === 'number' && Number.isFinite(body.limit) ? Math.max(1, Math.min(Math.floor(body.limit), 2000)) : 500;
      const result = await planBackfill(admin, { tables, includeBlur: body?.includeBlur === true, limit, dryRun });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error.includes('261') ? 409 : 500 });
      return NextResponse.json({ ...result, dryRun });
    }
    if (action === 'retry') {
      if (dryRun) {
        const { count } = await admin.from('media_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed');
        return NextResponse.json({ ok: true, dryRun, wouldRetry: count ?? 0 });
      }
      const { data, error } = await admin.from('media_jobs').update({ status: 'queued', attempts: 0, run_after: new Date().toISOString(), error: null, finished_at: null }).eq('status', 'failed').select('id');
      if (error) {
        console.error('[ADMIN-MEDIA-JOBS] retry failed:', error.message);
        return NextResponse.json({ error: 'The failed jobs could not be re-queued. Try again in a moment.' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, dryRun, retried: (data ?? []).length });
    }
    const summary = await runMediaJobsTick(admin, defaultJobDeps(admin), { dryRun });
    return NextResponse.json({ ...summary, dryRun });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[media-jobs] action error:', error);
    return NextResponse.json({ error: 'Media jobs action failed' }, { status: 500 });
  }
}
