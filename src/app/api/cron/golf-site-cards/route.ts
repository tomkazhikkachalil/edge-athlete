import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { SITE_TICK_BUDGET_MS, runSiteCardBatch, runSiteEvidenceBatch } from '@/lib/golf/site-card-server';
import { reportRouteError } from '@/lib/observability/report';
import { recordJobSummary } from '@/lib/platform-jobs/record';

// Longer than site-card-server.ts SITE_TICK_BUDGET_MS (site-card-server.test.ts pins it).
export const maxDuration = 120;

// ── POST /api/cron/golf-site-cards ───────────────────────────────────────────
// One tick of the website scorecard reader (migration 315 schedules it every
// five minutes on production through pg_cron; staging has no schedule). Two
// courses a tick: each one's own website is visited once, a scorecard it
// publishes as text is read by rule (no model), and it is saved only when
// every check passes. A route of its own so the map tick's clocks are not
// touched. Without CRON_SECRET it answers 401.
// Since migration 318 one of the tick's two visits may go to a course that
// HAS a card, to keep its website's pars as evidence (never to write the card).
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  const started = new Date();
  let summary: Record<string, unknown>;
  try {
    // Two visits a tick in all (migration 318): first one carded course whose
    // tees disagree on a par, for the club's own card as a confirmation; the
    // rest go to courses with no card, as before. Before 318 has run the
    // first part says so and the tick is what it was.
    const evidence = await runSiteEvidenceBatch(admin, { rows: 1, dryRun: false });
    const left = Math.max(0, SITE_TICK_BUDGET_MS - (Date.now() - started.getTime()));
    const cards = await runSiteCardBatch(admin, { rows: 2 - evidence.visits, dryRun: false, deadlineMs: left });
    summary = { ...cards, evidence: { ok: evidence.ok, due: evidence.due, visits: evidence.visits, outcomes: evidence.outcomes, kept: evidence.kept, error: evidence.error } };
  } catch (e) {
    reportRouteError('[site-cards] tick failed:', e);
    summary = { ok: false, phase: 'site-cards' };
  }
  await recordJobSummary(admin, 'golf-site-cards', started, summary).catch(() => undefined);
  return NextResponse.json(summary, { status: summary.ok === false && summary.error === 'migration 315 has not run' ? 409 : 200 });
}
