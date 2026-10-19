'use client';

import { useEffect, useState } from 'react';
import StatTile from './StatTile';
import DailySeriesChart from './DailySeriesChart';
import { PALETTE_STYLE } from './palette';
import { ago, bytes, compact, pct, periodDelta } from '@/lib/platform-stats/overview';

/**
 * The Overview (H2): the console home's first screen. One read of
 * /api/admin/overview per range; every number comes from the small tables
 * (Convention 49). Sections: Health · Growth · Activity · Community ·
 * Platform. The range row scopes every chart and delta below it.
 */
type Stat = { series: (number | null)[]; current: number; previous: number | null };
type DimStat = { dim: string; series: (number | null)[]; total: number };
type Est = { relname: string; reltuples: number; last_analyze: string | null } | null;
type Health = { p50: number | null; p95: number | null; uptime: number | null; samples: number; expected: number };
type Payload = {
  supported: boolean;
  asOf: string;
  range: { days: number; from: string; to: string };
  days: string[];
  firstRollupDay: string | null;
  growth: { usersTotal: Est; usersNew: Stat; usersNewByType: DimStat[]; departed: Stat; deletionRequested: Stat; dau: Stat; wau: Stat; mau: Stat; retention: { d1: { rate: number | null; cohorts: number }; d7: { rate: number | null; cohorts: number }; d30: { rate: number | null; cohorts: number } } };
  activity: { posts: Stat; postsByStatus: DimStat[]; activities: Stat; activitiesByType: DimStat[]; workouts: Stat; workoutsCompleted: Stat; postsTotal: Est; activitiesTotal: Est; workoutsTotal: Est };
  community: { orgsTotal: { dim: string; value: number }[]; orgsNew: DimStat[]; ticketsNew: Stat; ticketsNewByType: DimStat[]; ticketsClosed: Stat; ticketsOpen: number | null; contactsNew: DimStat[]; siteViews: Stat; siteVisitors: Stat; followsTotal: Est; messagesTotal: Est; eventsTotal: Est };
  platform: { storage: { objects: { dim: string; value: number }[]; bytes: { dim: string; value: number }[] }; errors: Stat; jobs: { job: string; ok: boolean | null; ranAgoMs: number | null; durationMs: number | null; running: boolean }[]; cronRuns: { jobname: string; schedule: string; active: boolean; last_start: string | null; last_status: string | null; runs_24h: number; failed_24h: number }[]; health: { sampler: 'ok' | 'absent'; latest: { at: string; db_ms: number; ok: boolean } | null; h24: Health; d7: Health } };
  today: { day: string; supported: boolean; usersNew: number | null; dau: number | null; posts: number | null; activities: number | null; workouts: number | null; ticketsNew: number | null; ticketsOpen: number | null };
};

const RANGES = [7, 30, 90] as const;
const d = (s: Stat) => periodDelta(s.current, s.previous);

export default function OverviewPanel() {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [payload, setPayload] = useState<Payload | 'error' | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/overview?range=${range}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) { setPayload('error'); return; }
        setPayload((await res.json()) as Payload);
      } catch {
        if (!cancelled) setPayload('error');
      }
    })();
    return () => { cancelled = true; };
  }, [range]);

  // A payload for another range is stale: the page reads Loading until this range's answer lands.
  const data: Payload | 'error' | null = payload && payload !== 'error' && payload.range.days !== range ? null : payload;

  const recompute = async () => {
    if (!data || data === 'error') return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/platform-stats/recompute?day=${data.range.to}`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; ran?: string[]; failed?: { group: string }[]; error?: string };
      if (!res.ok) { setNote(body.error ?? 'Could not recompute.'); return; }
      setNote(body.ok ? `Recomputed ${data.range.to}: ${body.ran?.length ?? 0} groups.` : `Recomputed with trouble: ${body.failed?.map(f => f.group).join(', ')}`);
      const again = await fetch(`/api/admin/overview?range=${range}`, { cache: 'no-store' });
      if (again.ok) setPayload((await again.json()) as Payload);
    } catch {
      setNote('Could not recompute.');
    } finally {
      setBusy(false);
    }
  };

  const section = 'bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6 space-y-4';
  const grid = 'grid grid-cols-2 gap-3 sm:grid-cols-4';

  return (
    <section className="space-y-6 ov-root" aria-label="Overview" data-overview="">
      <style dangerouslySetInnerHTML={{ __html: PALETTE_STYLE }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-primary">Overview</h2>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5" role="group" aria-label="Range">
          {RANGES.map(r => (
            <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r} className={`min-h-[36px] rounded-md px-3 text-sm font-medium ${range === r ? 'bg-brand text-white' : 'text-secondary hover:bg-surface-muted'}`} data-overview-range={r}>
              {r} d
            </button>
          ))}
        </div>
      </div>

      {data === null && <p className="text-sm text-muted" data-overview-state="loading">Loading…</p>}
      {data === 'error' && <p className="text-sm text-danger-fg" data-overview-state="error">Could not load the overview.</p>}
      {data && data !== 'error' && !data.supported && <p className="text-sm text-muted" data-overview-state="unsupported">Not available yet — run migration 267.</p>}

      {data && data !== 'error' && data.supported && (
        <>
          {/* Health */}
          <div className={section} data-overview-section="health">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-primary">Health</h3>
              <p className="text-xs text-muted">{data.platform.health.sampler === 'absent' ? 'No sampler here — the 5-minute probe runs on production (migration 268).' : `Probed every 5 min · last ${data.platform.health.latest ? ago(Date.parse(data.asOf) - Date.parse(data.platform.health.latest.at)) : '—'}`}</p>
            </div>
            <dl className={grid}>
              <StatTile label="Database now" value={data.platform.health.latest ? `${data.platform.health.latest.db_ms} ms` : '—'} sub={data.platform.health.latest ? (data.platform.health.latest.ok ? 'ok' : 'failed') : undefined} hook="db-now" />
              <StatTile label="p95 · 24 h" value={data.platform.health.h24.p95 === null ? '—' : `${data.platform.health.h24.p95} ms`} sub={`p50 ${data.platform.health.h24.p50 ?? '—'} ms`} hook="p95-24h" />
              <StatTile label="Uptime · 24 h" value={pct(data.platform.health.h24.uptime, 2)} sub={`${data.platform.health.h24.samples} of ${data.platform.health.h24.expected} probes`} hook="uptime-24h" />
              <StatTile label="Uptime · 7 d" value={pct(data.platform.health.d7.uptime, 2)} sub={`${data.platform.health.d7.samples} of ${data.platform.health.d7.expected} probes`} hook="uptime-7d" />
              <StatTile label="Errors · range" value={data.platform.errors.current} delta={d(data.platform.errors)} series={data.platform.errors.series} sub={data.platform.errors.series.every(v => v === null) ? 'Connect Sentry (H3)' : 'Sentry, all environments'} hook="errors" />
              <StatTile label="Daily cron" value={(() => { const j = data.platform.jobs.find(x => x.job === 'daily'); return j ? (j.running ? 'running' : j.ok ? 'ok' : 'failed') : '—'; })()} sub={(() => { const j = data.platform.jobs.find(x => x.job === 'daily'); return j ? ago(j.ranAgoMs) : 'never'; })()} hook="daily-cron" />
              <StatTile label="Nightly rollup" value={(() => { const j = data.platform.jobs.find(x => x.job === 'platform-rollup'); return j ? (j.running ? 'running' : j.ok ? 'ok' : 'failed') : '—'; })()} sub={(() => { const j = data.platform.jobs.find(x => x.job === 'platform-rollup'); return j ? `${ago(j.ranAgoMs)} · ${j.durationMs ?? '—'} ms` : 'not yet'; })()} hook="rollup-job" />
              <StatTile label="Today so far" value={data.today.supported ? `${compact(data.today.usersNew)} new` : '—'} sub={data.today.supported ? `${compact(data.today.dau)} active · ${compact(data.today.posts)} posts · ${compact(data.today.activities)} activities` : undefined} hook="today" />
            </dl>
          </div>

          {/* Growth */}
          <div className={section} data-overview-section="growth">
            <h3 className="text-base font-semibold text-primary">Growth</h3>
            <dl className={grid}>
              <StatTile label="Accounts" value={data.growth.usersTotal?.reltuples ?? null} approx sub={data.growth.usersTotal?.last_analyze ? `estimate · analysed ${ago(Date.parse(data.asOf) - Date.parse(data.growth.usersTotal.last_analyze))}` : 'estimate'} hook="users-total" />
              <StatTile label={`New accounts · ${range} d`} value={data.growth.usersNew.current} delta={d(data.growth.usersNew)} series={data.growth.usersNew.series} sub={data.growth.usersNewByType.slice(0, 3).map(t => `${t.dim} ${compact(t.total)}`).join(' · ') || undefined} hook="users-new" />
              <StatTile label="Daily actives" value={data.growth.dau.series.filter(v => v !== null).slice(-1)[0] ?? null} delta={d(data.growth.dau)} series={data.growth.dau.series} sub="opened the app, last rolled day" hook="dau" />
              <StatTile label="Weekly · monthly actives" value={`${compact(data.growth.wau.series.filter(v => v !== null).slice(-1)[0] ?? null)} · ${compact(data.growth.mau.series.filter(v => v !== null).slice(-1)[0] ?? null)}`} series={data.growth.mau.series} hook="wau-mau" />
              <StatTile label="Retention D1 · D7 · D30" value={`${pct(data.growth.retention.d1.rate)} · ${pct(data.growth.retention.d7.rate)} · ${pct(data.growth.retention.d30.rate)}`} sub={`${data.growth.retention.d1.cohorts} · ${data.growth.retention.d7.cohorts} · ${data.growth.retention.d30.cohorts} cohorts`} hook="retention" />
              <StatTile label="Departed" value={data.growth.departed.current} delta={d(data.growth.departed)} series={data.growth.departed.series} hook="departed" />
              <StatTile label="Deletions requested" value={data.growth.deletionRequested.current} delta={d(data.growth.deletionRequested)} series={data.growth.deletionRequested.series} hook="deletions" />
            </dl>
            <div className="grid gap-3 md:grid-cols-2">
              <DailySeriesChart title="New accounts per day" days={data.days} series={data.growth.usersNewByType.length > 1 ? data.growth.usersNewByType.map(t => ({ name: t.dim, values: t.series })) : [{ name: 'New accounts', values: data.growth.usersNew.series }]} hook="users-new" />
              <DailySeriesChart title="Daily actives" days={data.days} series={[{ name: 'Daily actives', values: data.growth.dau.series }]} hook="dau" />
            </div>
          </div>

          {/* Activity */}
          <div className={section} data-overview-section="activity">
            <h3 className="text-base font-semibold text-primary">Activity</h3>
            <dl className={grid}>
              <StatTile label={`Posts · ${range} d`} value={data.activity.posts.current} delta={d(data.activity.posts)} series={data.activity.posts.series} sub={`≈ ${compact(data.activity.postsTotal?.reltuples ?? null)} ever`} hook="posts" />
              <StatTile label={`Activities · ${range} d`} value={data.activity.activities.current} delta={d(data.activity.activities)} series={data.activity.activities.series} sub={`≈ ${compact(data.activity.activitiesTotal?.reltuples ?? null)} ever`} hook="activities" />
              <StatTile label={`Workouts · ${range} d`} value={data.activity.workouts.current} delta={d(data.activity.workouts)} series={data.activity.workouts.series} sub={`${compact(data.activity.workoutsCompleted.current)} completed · ≈ ${compact(data.activity.workoutsTotal?.reltuples ?? null)} ever`} hook="workouts" />
              <StatTile label={`Org-site visitors · ${range} d`} value={data.community.siteVisitors.current} delta={d(data.community.siteVisitors)} series={data.community.siteVisitors.series} sub={`${compact(data.community.siteViews.current)} views`} hook="site-visitors" />
            </dl>
            <div className="grid gap-3 md:grid-cols-2">
              <DailySeriesChart title="Posts per day by status" days={data.days} series={data.activity.postsByStatus.length > 1 ? data.activity.postsByStatus.map(t => ({ name: t.dim, values: t.series })) : [{ name: 'Posts', values: data.activity.posts.series }]} hook="posts" />
              <DailySeriesChart title="Activities per day by type" days={data.days} series={data.activity.activitiesByType.length > 1 ? data.activity.activitiesByType.slice(0, 4).map(t => ({ name: t.dim, values: t.series })) : [{ name: 'Activities', values: data.activity.activities.series }]} hook="activities" />
            </div>
          </div>

          {/* Community */}
          <div className={section} data-overview-section="community">
            <h3 className="text-base font-semibold text-primary">Community</h3>
            <dl className={grid}>
              <StatTile label="Clubs · leagues" value={data.community.orgsTotal.map(o => `${compact(o.value)} ${o.dim}${o.value === 1 ? '' : 's'}`).join(' · ') || '—'} sub={data.community.orgsNew.length ? `new in range: ${data.community.orgsNew.map(o => `${o.dim} ${compact(o.total)}`).join(' · ')}` : undefined} hook="orgs" />
              <StatTile label="Support open" value={data.community.ticketsOpen} sub={`${compact(data.community.ticketsNew.current)} opened · ${compact(data.community.ticketsClosed.current)} closed in range`} hook="tickets-open" />
              <StatTile label={`Tickets · ${range} d`} value={data.community.ticketsNew.current} delta={d(data.community.ticketsNew)} series={data.community.ticketsNew.series} sub={data.community.ticketsNewByType.map(t => `${t.dim} ${compact(t.total)}`).join(' · ') || undefined} hook="tickets" />
              <StatTile label={`Contacts · ${range} d`} value={data.community.contactsNew.reduce((s, c) => s + c.total, 0)} sub={data.community.contactsNew.map(c => `${c.dim.replace('_', ' ')} ${compact(c.total)}`).join(' · ') || undefined} hook="contacts" />
              <StatTile label="Follows" value={data.community.followsTotal?.reltuples ?? null} approx hook="follows" />
              <StatTile label="Messages" value={data.community.messagesTotal?.reltuples ?? null} approx hook="messages" />
              <StatTile label="Events" value={data.community.eventsTotal?.reltuples ?? null} approx hook="events" />
            </dl>
          </div>

          {/* Platform */}
          <div className={section} data-overview-section="platform">
            <h3 className="text-base font-semibold text-primary">Platform</h3>
            <dl className={grid}>
              {data.platform.storage.bytes.length === 0 && <StatTile label="Storage" value="—" sub="after the first nightly run" hook="storage" />}
              {data.platform.storage.bytes.slice(0, 4).map(b => (
                <StatTile key={b.dim} label={`Storage · ${b.dim}`} value={bytes(b.value)} sub={`${compact(data.platform.storage.objects.find(o => o.dim === b.dim)?.value ?? null)} files · last night`} hook={`storage-${b.dim}`} />
              ))}
            </dl>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-overview-jobs="">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 pr-3 font-medium">Job</th>
                    <th className="py-1 pr-3 font-medium">Last run</th>
                    <th className="py-1 pr-3 font-medium">Result</th>
                    <th className="py-1 pr-3 font-medium text-right">Took</th>
                  </tr>
                </thead>
                <tbody>
                  {data.platform.jobs.map(j => (
                    <tr key={j.job} className="border-t border-border" data-overview-job={j.job}>
                      <td className="py-1.5 pr-3 text-primary">{j.job}</td>
                      <td className="py-1.5 pr-3 text-secondary">{j.running ? 'running' : ago(j.ranAgoMs)}</td>
                      <td className={`py-1.5 pr-3 ${j.ok === false ? 'text-danger-fg' : j.ok ? 'text-success-fg' : 'text-muted'}`}>{j.running ? '…' : j.ok === null ? '—' : j.ok ? 'ok' : 'failed'}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-secondary">{j.durationMs === null ? '—' : `${(j.durationMs / 1000).toFixed(1)} s`}</td>
                    </tr>
                  ))}
                  {data.platform.cronRuns.map(c => (
                    <tr key={`pg-${c.jobname}`} className="border-t border-border" data-overview-cron={c.jobname}>
                      <td className="py-1.5 pr-3 text-primary">{c.jobname} <span className="text-xs text-muted">pg_cron · {c.schedule}</span></td>
                      <td className="py-1.5 pr-3 text-secondary">{c.last_start ? ago(Date.parse(data.asOf) - Date.parse(c.last_start)) : '—'}</td>
                      <td className={`py-1.5 pr-3 ${c.failed_24h > 0 ? 'text-warning-fg' : 'text-success-fg'}`}>{c.last_status ?? '—'}{c.failed_24h > 0 ? ` · ${c.failed_24h} failed in 24 h` : ''}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-secondary">{c.runs_24h}/24 h</td>
                    </tr>
                  ))}
                  {data.platform.jobs.length === 0 && data.platform.cronRuns.length === 0 && (
                    <tr><td colSpan={4} className="py-3 text-sm text-muted">No job has recorded a run yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={recompute} disabled={busy} className="ea-interactive rounded-lg border border-border px-3 py-2 min-h-[44px] text-sm font-semibold text-primary disabled:opacity-50" data-overview-recompute="">
                {busy ? 'Recomputing…' : `Recompute ${data.range.to}`}
              </button>
              {note && <p className="text-sm text-muted" role="status" data-overview-recompute-note="">{note}</p>}
              <p className="text-xs text-muted">Rollups from {data.firstRollupDay ?? '—'} · as of {new Date(data.asOf).toLocaleTimeString()}</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
