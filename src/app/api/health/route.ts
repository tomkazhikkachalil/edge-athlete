import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';

// ── GET /api/health ───────────────────────────────────────────────────────────
// Lightweight liveness + dependency check for uptime monitors (UptimeRobot,
// BetterStack, Vercel checks). Returns 200 when the app can reach Supabase,
// 503 otherwise. No auth — exposes no data beyond up/down.
export async function GET() {
  const startedAt = Date.now();
  try {
    const supabase = getSupabaseAdmin();
    // The cheapest round-trip PostgREST offers without DDL: a HEAD for one
    // primary-key row — an index probe, no count. This used to be
    // `count: 'exact'`, an exact COUNT(*) over the whole table on EVERY
    // monitor ping (a full scan at scale, for a number nobody read):
    // Round 1 PR 6. `SELECT 1` proper would need an RPC — not worth DDL.
    const { error } = await supabase
      .from('profiles')
      .select('id', { head: true })
      .limit(1);

    if (error) {
      return NextResponse.json(
        { status: 'degraded', database: 'error', latency_ms: Date.now() - startedAt },
        { status: 503 }
      );
    }

    return NextResponse.json({
      status: 'ok',
      database: 'ok',
      latency_ms: Date.now() - startedAt,
      // Which build answers: Vercel's system variable (null off Vercel). The
      // prod e2e setup waits for the merged commit before probing — every
      // probe run right after a merge used to hit the previous build.
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    });
  } catch {
    return NextResponse.json(
      { status: 'down', database: 'unreachable', latency_ms: Date.now() - startedAt },
      { status: 503 }
    );
  }
}
