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
    // Cheapest possible round-trip: head-count a tiny always-present table
    const { error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
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
