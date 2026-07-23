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
    });
  } catch {
    return NextResponse.json(
      { status: 'down', database: 'unreachable', latency_ms: Date.now() - startedAt },
      { status: 503 }
    );
  }
}
