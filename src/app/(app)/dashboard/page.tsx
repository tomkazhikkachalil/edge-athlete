'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { useToast } from '@/components/Toast';
import { formatDisplayName } from '@/lib/formatters';
import { SUGGEST_DEBOUNCE_MS } from '@/lib/search/typeahead';
import type { SiteMetrics } from '@/lib/site-builder/metrics-rollup';
import type { SweepSummary } from '@/lib/storage-sweep-server';
import PerformanceBackfillPanel from '@/components/admin/PerformanceBackfillPanel';
import SupportQueueTile from '@/components/admin/SupportQueueTile';

// Admin console (replaces the orphaned legacy dashboard page — its buttons
// had no onClick handlers). Access = ADMIN_EMAILS allowlist, enforced
// server-side; this page just renders the 403 as "not authorized".
interface UserRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  handle: string | null;
  user_type: string;
  visibility: string | null;
  created_at: string;
  onboarded_at: string | null;
}

const name = (p: { first_name: string | null; last_name: string | null; full_name: string | null } | null) =>
  p ? formatDisplayName(p.first_name, null, p.last_name, p.full_name) : 'Unknown';

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { showError } = useToast();

  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const [userQuery, setUserQuery] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [searching, setSearching] = useState(false);

  // Phase 6 R1: the anti-squatting review list — computed server-side
  // against each org's live identity, never stored.
  const [flaggedSlugs, setFlaggedSlugs] = useState<
    { siteId: string; slug: string; orgName: string; side: string; published: boolean; verdict: string; reason?: string }[]
  >([]);
  // Phase 6b C1: every claimed custom domain with its lifecycle state.
  const [orgDomains, setOrgDomains] = useState<
    { siteId: string; slug: string; orgName: string; side: string; domain: string; state: string; failure: string | null; awaitingPlatform: boolean }[]
  >([]);
  const [domainsPlatformConfigured, setDomainsPlatformConfigured] = useState(true);
  const [domainsReload, setDomainsReload] = useState(0);
  // Site Builder phase 11: the builder's numbers (computed by the route) and
  // the storage sweep's dry run — the sweep endpoint's first UI caller.
  const [siteMetrics, setSiteMetrics] = useState<{ supported: boolean; metrics?: SiteMetrics; visits?: { views: number; visitors: number; sites: number } | null } | null>(null);
  const [sweep, setSweep] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; summary?: SweepSummary }>({ status: 'idle' });

  useEffect(() => {
    if (!authLoading && !user) router.push('/');
  }, [user, authLoading, router]);

  // Inlined cancellable IIFE; the guard also stops a slow response for a
  // previous status filter from overwriting a newer one.
  // The gate probe: `/api/admin/me` (owner = admin:true). The old probe was
  // the message-reports read; that panel left with Spec 2 (reports are
  // tickets now — the Support queue tile is the door).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/admin/me', { cache: 'no-store' });
        const body = response.ok ? await response.json().catch(() => null) : null;
        if (!cancelled) setAuthorized(body?.admin === true);
      } catch (e) {
        console.error('Failed to probe admin access:', e);
        if (!cancelled) setAuthorized(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Clearing is synchronisation (render phase); the debounced fetch stays here.
  // Phase 6 R1: load the flagged-slug review list once authorized
  // (inlined cancellable IIFE, the page's fetch idiom).
  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/admin/flagged-slugs');
        if (response.ok) {
          const body = await response.json();
          if (!cancelled) setFlaggedSlugs(body.flagged ?? []);
        }
        const metricsRes = await fetch('/api/admin/site-metrics');
        if (metricsRes.ok) {
          const metricsBody = await metricsRes.json();
          if (!cancelled) setSiteMetrics(metricsBody);
        }
        const domainsRes = await fetch('/api/admin/org-domains');
        if (domainsRes.ok) {
          const domainsBody = await domainsRes.json();
          if (!cancelled) {
            setOrgDomains(domainsBody.domains ?? []);
            setDomainsPlatformConfigured(domainsBody.platformConfigured !== false);
          }
        }
      } catch {
        /* review list is advisory */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authorized, domainsReload]);

  const [syncedUserQuery, setSyncedUserQuery] = useState({ authorized, userQuery });
  if (syncedUserQuery.authorized !== authorized || syncedUserQuery.userQuery !== userQuery) {
    setSyncedUserQuery({ authorized, userQuery });
    if (!authorized || userQuery.trim().length < 1) setUsers([]);
  }

  // Debounced user search
  useEffect(() => {
    if (!authorized || userQuery.trim().length < 1) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/admin/users?q=${encodeURIComponent(userQuery.trim())}`);
        if (response.ok) {
          const data = await response.json();
          setUsers(data.users);
        }
      } catch (e) {
        console.error('User search failed:', e);
      } finally {
        setSearching(false);
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [userQuery, authorized]);

  if (authLoading || !user || authorized === null) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center px-4">
            <i className="fas fa-lock text-4xl text-gray-300 mb-4"></i>
            <h1 className="text-xl font-bold text-primary mb-2">Admin access required</h1>
            <p className="text-sm text-tertiary">This area is for Edge Athlete administrators.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-primary">
          <i className="fas fa-shield-alt mr-2 text-brand-fg"></i>
          Admin
        </h1>

        {/* Queues — dedicated admin pages */}
        <section className="grid sm:grid-cols-2 gap-4">
          <SupportQueueTile />
          <button
            type="button"
            onClick={() => router.push('/dashboard/consent')}
            className="bg-surface rounded-lg shadow-sm border border-border p-4 text-left hover:border-violet-300 transition"
          >
            <p className="text-sm font-semibold text-primary">
              <i className="fas fa-file-signature text-brand-fg mr-2"></i>
              Consent reviews
            </p>
            <p className="text-xs text-muted mt-1">Signed parental-consent submissions awaiting review.</p>
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard/guardians')}
            className="bg-surface rounded-lg shadow-sm border border-border p-4 text-left hover:border-violet-300 transition"
          >
            <p className="text-sm font-semibold text-primary">
              <i className="fas fa-user-shield text-brand-fg mr-2"></i>
              Guardian support
            </p>
            <p className="text-xs text-muted mt-1">Orphaned supervised profiles — invite a guardian or delete.</p>
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard/leagues')}
            className="bg-surface rounded-lg shadow-sm border border-border p-4 text-left hover:border-violet-300 transition"
          >
            <p className="text-sm font-semibold text-primary">
              <i className="fas fa-trophy text-brand-fg mr-2"></i>
              Leagues
            </p>
            <p className="text-xs text-muted mt-1">Create leagues and assign their owners.</p>
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard/clubs')}
            className="bg-surface rounded-lg shadow-sm border border-border p-4 text-left hover:border-violet-300 transition"
          >
            <p className="text-sm font-semibold text-primary">
              <i className="fas fa-building text-brand-fg mr-2"></i>
              Clubs
            </p>
            <p className="text-xs text-muted mt-1">Create clubs, assign owners, review requests.</p>
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard/venues')}
            className="bg-surface rounded-lg shadow-sm border border-border p-4 text-left hover:border-violet-300 transition"
          >
            <p className="text-sm font-semibold text-primary">
              <i className="fas fa-map-marker-alt text-brand-fg mr-2"></i>
              Venues
            </p>
            <p className="text-xs text-muted mt-1">Create venues and their facilities.</p>
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard/structure')}
            className="bg-surface rounded-lg shadow-sm border border-border p-4 text-left hover:border-violet-300 transition"
          >
            <p className="text-sm font-semibold text-primary">
              <i className="fas fa-sitemap text-brand-fg mr-2"></i>
              Structure
            </p>
            <p className="text-xs text-muted mt-1">Seasons, divisions, and teams.</p>
          </button>
        </section>

        {/* Phase 6 R1: flagged site addresses (anti-squatting review). */}
        {flaggedSlugs.length > 0 && (
          <section
            aria-label="Flagged site addresses"
            className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold text-primary mb-1">Flagged site addresses</h2>
            <p className="text-xs text-muted mb-3">
              Slugs that don’t clearly carry their organization’s identity —
              computed live, nothing stored. Renaming is a support action.
            </p>
            <ul className="space-y-2">
              {flaggedSlugs.map(f => (
                <li
                  key={f.siteId}
                  className="flex flex-wrap items-center justify-between gap-2 border border-border rounded-lg px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-primary">/{f.slug}</span>
                    <span className="text-muted"> · {f.orgName} ({f.side})</span>
                    {f.published && <span className="text-emerald-600"> · published</span>}
                  </span>
                  <span className={`text-xs ${f.verdict === 'refused' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'}`}>
                    {f.reason ?? f.verdict}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Site Builder phase 11: the builder's numbers + the storage sweep's dry run. */}
        <section aria-label="Site builder" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-admin-site-metrics="">
          <h2 className="text-lg font-semibold text-primary mb-1">Site builder</h2>
          <p className="text-xs text-muted mb-3">
            Sites, publishes and the one-hour question — computed from each publish’s recorded stats, nothing stored.
            {siteMetrics?.metrics?.truncated && <span className="text-amber-700 dark:text-amber-300"> Row limit hit — these numbers are a floor.</span>}
          </p>
          {siteMetrics === null ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : !siteMetrics.supported || !siteMetrics.metrics ? (
            <p className="text-sm text-muted">Drafts and revisions need a database migration first (180).</p>
          ) : (
            <SiteMetricsTiles m={siteMetrics.metrics} />
          )}
          {/* Program 2, E2: the platform's visits (first-party pixel, last 30 days). */}
          {siteMetrics?.visits && (
            <p className="mt-3 text-xs text-muted" data-admin-site-visits="">
              Visits, last 30 days: <span className="font-medium text-primary">{siteMetrics.visits.views.toLocaleString()}</span> page views ·{' '}
              <span className="font-medium text-primary">{siteMetrics.visits.visitors.toLocaleString()}</span> visitors across {siteMetrics.visits.sites} site{siteMetrics.visits.sites === 1 ? '' : 's'} — counts only, nothing personal (docs/ANALYTICS.md).
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-3">
            <button
              type="button"
              disabled={sweep.status === 'running'}
              onClick={async () => {
                setSweep({ status: 'running' });
                try {
                  const res = await fetch('/api/admin/storage-sweep', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dryRun: true }),
                  });
                  if (!res.ok) throw new Error('sweep');
                  setSweep({ status: 'done', summary: (await res.json()) as SweepSummary });
                } catch {
                  setSweep({ status: 'error' });
                  showError('Storage sweep', 'The dry run failed');
                }
              }}
              className="px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50"
            >
              {sweep.status === 'running' ? 'Sweeping…' : 'Storage sweep (dry run)'}
            </button>
            <p className="text-xs text-muted min-w-0">
              {sweep.status === 'done' && sweep.summary ? (
                <>
                  <span className="font-medium text-primary">{sweep.summary.orphans}</span> orphan file{sweep.summary.orphans === 1 ? '' : 's'} of {sweep.summary.scannedFiles} scanned ·{' '}
                  {sweep.summary.referencedPaths} referenced · {sweep.summary.unreferencedInGrace} inside the {sweep.summary.graceHours}h grace. Nothing was deleted.
                </>
              ) : sweep.status === 'error' ? (
                'The dry run failed — see the server log.'
              ) : (
                'Finds uploads no row references any more. Dry run only — deleting is a console action.'
              )}
            </p>
          </div>
        </section>

        {/* Data foundation F5b: the backfill's door — no developer console needed. */}
        <PerformanceBackfillPanel />

        {/* Phase 6b C1: custom domains — the lifecycle list + retry actions. */}
        {orgDomains.length > 0 && (
          <section
            aria-label="Custom domains"
            className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold text-primary mb-1">Custom domains</h2>
            <p className="text-xs text-muted mb-3">
              Claimed org domains and where each one is in claim → verify → connect → live.
              {!domainsPlatformConfigured && (
                <span className="text-amber-700 dark:text-amber-300">
                  {' '}Vercel API env is not set — verified domains wait here until it is.
                </span>
              )}
            </p>
            <ul className="space-y-2">
              {orgDomains.map(d => (
                <li
                  key={d.siteId}
                  className="flex flex-wrap items-center justify-between gap-2 border border-border rounded-lg px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-primary">{d.domain}</span>
                    <span className="text-muted"> → /{d.slug} · {d.orgName} ({d.side})</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`text-xs ${
                        d.state === 'active'
                          ? 'text-emerald-600'
                          : d.state === 'failed'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {d.state}
                      {d.awaitingPlatform ? ' (awaiting platform)' : ''}
                      {d.failure ? ` — ${d.failure}` : ''}
                    </span>
                    {['verified', 'failed', 'attaching'].includes(d.state) && (
                      <button
                        type="button"
                        onClick={async () => {
                          await fetch('/api/admin/org-domains', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ siteId: d.siteId, action: 'retry-attach' }),
                          });
                          setDomainsReload(k => k + 1);
                        }}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken"
                      >
                        Retry connect
                      </button>
                    )}
                    {d.state === 'attached' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await fetch('/api/admin/org-domains', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ siteId: d.siteId, action: 'probe' }),
                          });
                          setDomainsReload(k => k + 1);
                        }}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken"
                      >
                        Probe
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* User lookup */}
        <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-primary mb-4">User lookup</h2>
          <input
            type="search"
            value={userQuery}
            onChange={e => setUserQuery(e.target.value)}
            placeholder="Search by name, email, or handle…"
            className="w-full px-3 py-2 min-h-[44px] border border-border-strong rounded-md text-sm text-primary focus:outline-none focus:ring-2 focus:ring-violet-500 mb-4"
            aria-label="Search users"
          />
          {searching ? (
            <p className="text-sm text-muted">Searching…</p>
          ) : users.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-muted text-xs text-muted uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Handle</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Joined</th>
                    <th className="px-3 py-2 text-left"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-surface-muted">
                      <td className="px-3 py-2 font-medium text-primary whitespace-nowrap">{name(u)}</td>
                      <td className="px-3 py-2 text-tertiary">{u.email || '—'}</td>
                      <td className="px-3 py-2 text-tertiary">{u.handle || '—'}</td>
                      <td className="px-3 py-2 text-tertiary capitalize">{u.user_type}{u.visibility === 'private' ? ' · private' : ''}</td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => router.push(`/athlete/${u.id}`)}
                          className="text-xs font-medium text-brand-fg hover:text-brand-fg-strong"
                        >
                          View →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : userQuery.trim().length >= 1 ? (
            <p className="text-sm text-muted">No users match.</p>
          ) : (
            <p className="text-xs text-faint">Type to search users.</p>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Site Builder phase 11: the metrics tiles ────────────────────────────────
const duration = (seconds: number | null): string => {
  if (seconds === null) return '—';
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${(seconds / 3600).toFixed(1)} h`;
  return `${Math.round(seconds / 86_400)} d`;
};
const pct = (rate: number | null): string => (rate === null ? '—' : `${Math.round(rate * 100)}%`);

function SiteMetricsTiles({ m }: { m: SiteMetrics }) {
  const tiles: { label: string; value: string; sub?: string }[] = [
    { label: 'Sites', value: String(m.sites.total), sub: `${m.sites.live} live · ${m.sites.withDraft} with a draft` },
    { label: 'New sites', value: String(m.sites.createdLast30), sub: `${m.sites.createdLast7} in 7 days · ${m.sites.createdLast30} in 30` },
    { label: 'Publishes', value: String(m.publishes.last30), sub: `${m.publishes.last7} in 7 days · ${m.publishes.sitesPublishedLast30} sites in 30 · ${m.publishes.total} ever` },
    { label: 'First publish ≤ 1 h', value: m.firstPublish.count ? `${m.firstPublish.withinHour} of ${m.firstPublish.count}` : '—', sub: 'the doc’s one-hour question' },
    { label: 'Time to first publish', value: duration(m.firstPublish.medianSeconds), sub: `median · p75 ${duration(m.firstPublish.p75Seconds)}` },
    { label: 'Layout adoption', value: pct(m.editor.adoptionRate), sub: `${m.editor.sitesWithLayout} of ${m.sites.withPublishedRevision} published sites arranged` },
    { label: 'Widgets per site', value: m.editor.medianWidgetCount === null ? '—' : String(m.editor.medianWidgetCount), sub: `median · ${m.firstPublish.medianWidgetsTouched ?? '—'} touched before the first publish` },
    { label: 'Templates', value: Object.entries(m.sites.byTemplate).map(([k, v]) => `${k} ${v}`).join(' · ') || '—' },
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(t => (
          <div key={t.label} className="rounded-lg border border-border px-3 py-2 min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-muted truncate">{t.label}</dt>
            <dd className="text-lg font-semibold text-primary truncate">{t.value}</dd>
            {t.sub && <dd className="text-xs text-muted">{t.sub}</dd>}
          </div>
        ))}
      </dl>
      {m.editor.topAdded.length > 0 && (
        <p className="text-xs text-muted">
          Most added sections:{' '}
          {m.editor.topAdded.map(t => (
            <span key={t.key} className="mr-1 inline-block rounded-full border border-border px-2 py-0.5 text-primary">
              {t.key} · {t.count}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
