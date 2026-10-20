import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdmin } from '@/lib/auth-server';
import { computeToday } from '@/lib/platform-stats/rollup-server';
import { sentryLast24h } from '@/lib/platform-stats/sentry-server';
import { dayUTC, yesterdayUTC } from '@/lib/platform-stats/metrics';
import {
  SAMPLE_EVERY_MS, cohorts, dayList, dimsOf, healthWindow, jobViews, pooledRetention, samplerState, seriesFor, shiftDay, windows,
  type EstimateRow, type HealthSample, type JobRow, type StatRow,
} from '@/lib/platform-stats/overview';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/admin/overview?range=7|30|90 — the Overview's one read (H2).
 * Owner-only; `private, no-store`. Reads ONLY the small tables: the range's
 * rows of platform_stats_daily (plus the range before, for the deltas),
 * seven days of health samples, the jobs, the estimates, and today's partial
 * run (cached a minute). Pre-267 answers `{ supported: false }`.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const RANGES = new Set([7, 30, 90]);
const NOT_LIVE = new Set(['42P01', 'PGRST205', '42883', 'PGRST202']);

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const range = Number.parseInt(request.nextUrl.searchParams.get('range') ?? '30', 10);
    const days = RANGES.has(range) ? range : 30;
    const admin = getSupabaseAdmin();
    const now = new Date();
    const nowMs = now.getTime();
    const to = yesterdayUTC(now);
    const from = shiftDay(to, -(days * 2 - 1)); // this window and the one before it
    const cohortFrom = shiftDay(to, -(days + 31)); // a cohort's D30 lands 30 days after it

    const [rowsRes, samplesRes, jobsRes, estRes, cronRes, today, errors24h] = await Promise.all([
      admin.from('platform_stats_daily').select('day, metric, dim, value').gte('day', cohortFrom).lte('day', to).limit(days * 2 * 80 + 400),
      admin.from('platform_health_samples').select('at, db_ms, ok').gte('at', new Date(nowMs - 7 * 86_400_000).toISOString()).order('at', { ascending: false }).limit(2200),
      admin.from('platform_jobs').select('job, last_started_at, last_finished_at, ok, duration_ms'),
      admin.rpc('platform_table_estimates'),
      admin.rpc('platform_cron_runs'),
      computeToday(admin, now),
      sentryLast24h(nowMs),
    ]);
    if (rowsRes.error) {
      if (NOT_LIVE.has(rowsRes.error.code)) return NextResponse.json({ supported: false }, { headers: NO_STORE });
      throw new Error(rowsRes.error.message);
    }
    const rows = ((rowsRes.data ?? []) as { day: string; metric: string; dim: string; value: number | string }[]).map(r => ({ day: r.day, metric: r.metric, dim: r.dim ?? '', value: Number(r.value) })) as StatRow[];
    const inRange = rows.filter(r => r.day >= from);
    const dayAxis = dayList(to, days);
    const samples = (samplesRes.data ?? []) as HealthSample[];
    const jobs = (jobsRes.data ?? []) as JobRow[];
    const estimates = (estRes.data ?? []) as EstimateRow[];
    const cronRuns = (cronRes.data ?? []) as { jobname: string; schedule: string; active: boolean; last_start: string | null; last_status: string | null; runs_24h: number; failed_24h: number }[];

    const series = (metric: string, dim = '') => seriesFor(inRange, dayAxis, metric, dim);
    const stat = (metric: string, dim = '') => {
      const w = windows(inRange, to, days, metric, dim);
      return { series: series(metric, dim), current: w.current, previous: w.previous };
    };
    const dimSeries = (metric: string, prefix: string, cap = 4) => {
      const dims = dimsOf(inRange, metric).filter(d => d.startsWith(prefix)).slice(0, cap);
      return dims.map(d => ({ dim: d.slice(prefix.length), series: series(metric, d), total: windows(inRange, to, days, metric, d).current }));
    };
    const est = (name: string) => estimates.find(e => e.relname === name) ?? null;
    const latestDim = (metric: string, prefix: string) => {
      const lastDay = [...new Set(inRange.filter(r => r.metric === metric).map(r => r.day))].sort().pop();
      return inRange.filter(r => r.metric === metric && r.day === lastDay && r.dim.startsWith(prefix)).map(r => ({ dim: r.dim.slice(prefix.length), value: r.value }));
    };
    const cohortPoints = cohorts(rows);
    const todayValue = (metric: string, dim = '') => today.rows.find(r => r.metric === metric && r.dim === dim)?.value ?? null;

    const payload = {
      supported: true,
      asOf: now.toISOString(),
      range: { days, from: dayAxis[0], to },
      days: dayAxis,
      firstRollupDay: rows.length ? rows.map(r => r.day).sort()[0] : null,
      growth: {
        usersTotal: est('profiles'),
        usersNew: stat('users.new'),
        usersNewByType: dimSeries('users.new', 'type:', 6),
        departed: stat('users.departed'),
        deletionRequested: stat('users.deletion_requested'),
        dau: stat('users.dau'),
        wau: stat('users.wau'),
        mau: stat('users.mau'),
        retention: { d1: pooledRetention(cohortPoints, 'd1'), d7: pooledRetention(cohortPoints, 'd7'), d30: pooledRetention(cohortPoints, 'd30'), cohorts: cohortPoints.slice(0, 14) },
      },
      activity: {
        posts: stat('posts.new'),
        postsByStatus: dimSeries('posts.new', 'status:', 4),
        activities: stat('activities.new'),
        activitiesByType: dimSeries('activities.new', 'type:', 6),
        workouts: stat('workouts.new'),
        workoutsCompleted: stat('workouts.new', 'status:completed'),
        postsTotal: est('posts'),
        activitiesTotal: est('activities'),
        workoutsTotal: est('workout_sessions'),
      },
      community: {
        orgsTotal: latestDim('orgs.total', 'kind:'),
        orgsNew: dimSeries('orgs.new', 'kind:', 2),
        ticketsNew: stat('tickets.new'),
        ticketsNewByType: dimSeries('tickets.new', 'type:', 3),
        ticketsClosed: stat('tickets.closed'),
        ticketsOpen: latestDim('tickets.open', '').find(x => x.dim === '')?.value ?? null,
        contactsNew: dimSeries('contacts.new', 'source:', 2),
        siteViews: stat('site.views'),
        siteVisitors: stat('site.visitors'),
        followsTotal: est('follows'),
        messagesTotal: est('messages'),
        eventsTotal: est('sport_events'),
      },
      platform: {
        storage: { objects: latestDim('storage.objects', 'bucket:'), bytes: latestDim('storage.bytes', 'bucket:') },
        errors: stat('errors.sentry'),
        errors24h,
        jobs: jobViews(jobs, nowMs),
        cronRuns,
        health: {
          sampler: samplerState(samples, nowMs),
          latest: samples[0] ?? null,
          h24: healthWindow(samples, nowMs, 24 * 3_600_000),
          d7: healthWindow(samples, nowMs, 7 * 24 * 3_600_000),
          sampleEveryMs: SAMPLE_EVERY_MS,
        },
      },
      today: {
        day: dayUTC(now),
        supported: today.supported,
        usersNew: todayValue('users.new'),
        dau: todayValue('users.dau'),
        posts: todayValue('posts.new'),
        activities: todayValue('activities.new'),
        workouts: todayValue('workouts.new'),
        ticketsNew: todayValue('tickets.new'),
        ticketsOpen: todayValue('tickets.open'),
      },
    };
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/admin/overview]', error);
    return NextResponse.json({ error: 'Could not load the overview' }, { status: 500, headers: NO_STORE });
  }
}
