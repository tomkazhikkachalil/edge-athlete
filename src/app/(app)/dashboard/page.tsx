'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { useToast } from '@/components/Toast';
import { formatDisplayName } from '@/lib/formatters';
import { SUGGEST_DEBOUNCE_MS } from '@/lib/search/typeahead';

// Admin console (replaces the orphaned legacy dashboard page — its buttons
// had no onClick handlers). Access = ADMIN_EMAILS allowlist, enforced
// server-side; this page just renders the 403 as "not authorized".
interface ReportRow {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  message: { id: string; content: string | null; type: string; deleted_at: string | null } | null;
  reporter: { id: string; first_name: string | null; last_name: string | null; full_name: string | null; handle: string | null } | null;
  reported: { id: string; first_name: string | null; last_name: string | null; full_name: string | null; handle: string | null } | null;
}

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

const STATUS_FILTERS = ['open', 'reviewing', 'resolved', 'dismissed', 'all'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const name = (p: { first_name: string | null; last_name: string | null; full_name: string | null } | null) =>
  p ? formatDisplayName(p.first_name, null, p.last_name, p.full_name) : 'Unknown';

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { showSuccess, showError } = useToast();

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [reportsLoading, setReportsLoading] = useState(false);

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

  useEffect(() => {
    if (!authLoading && !user) router.push('/');
  }, [user, authLoading, router]);

  // Inlined cancellable IIFE; the guard also stops a slow response for a
  // previous status filter from overwriting a newer one.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setReportsLoading(true);
      try {
        const response = await fetch(`/api/admin/reports?status=${statusFilter}`);
        if (response.status === 403) {
          if (!cancelled) setAuthorized(false);
          return;
        }
        if (!cancelled) setAuthorized(true);
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) setReports(data.reports);
        }
      } catch (e) {
        console.error('Failed to load reports:', e);
      } finally {
        if (!cancelled) setReportsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, statusFilter]);

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

  const updateReport = async (reportId: string, status: string) => {
    try {
      const response = await fetch('/api/admin/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, status }),
      });
      if (!response.ok) {
        showError('Update failed', 'Could not update the report.');
        return;
      }
      showSuccess('Report updated', `Marked as ${status}.`);
      if (statusFilter === 'all') {
        setReports(prev => prev.map(r => (r.id === reportId ? { ...r, status } : r)));
      } else {
        setReports(prev => prev.filter(r => r.id !== reportId));
      }
    } catch (e) {
      console.error('Failed to update report:', e);
      showError('Update failed', 'Could not update the report.');
    }
  };

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

        {/* Message reports queue */}
        <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-primary">Message reports</h2>
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1.5 min-h-[40px] rounded-md text-xs font-medium capitalize transition-colors ${
                    statusFilter === f ? 'bg-brand text-white' : 'bg-surface-sunken text-secondary hover:bg-gray-200 dark:hover:bg-stone-800'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {reportsLoading ? (
            <p className="text-sm text-muted py-6 text-center">Loading reports…</p>
          ) : reports.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">
              No {statusFilter === 'all' ? '' : statusFilter} reports. 🎉
            </p>
          ) : (
            <div className="space-y-3">
              {reports.map(report => (
                <div key={report.id} className="border border-border rounded-lg p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs font-semibold rounded-full uppercase">
                      {report.reason}
                    </span>
                    <span className="px-2 py-0.5 bg-surface-sunken text-tertiary text-xs rounded-full capitalize">
                      {report.status}
                    </span>
                    <span className="text-xs text-faint">
                      {new Date(report.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-secondary mb-1">
                    <span className="font-medium">{name(report.reporter)}</span>
                    {' reported '}
                    <span className="font-medium">{name(report.reported)}</span>
                  </p>
                  {report.message?.content && (
                    <blockquote className="text-sm text-tertiary bg-surface-muted border-l-2 border-border-strong pl-3 py-1.5 my-2 break-words">
                      {report.message.content}
                    </blockquote>
                  )}
                  {report.details && (
                    <p className="text-xs text-muted mb-2 break-words">Reporter notes: {report.details}</p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {report.reported && (
                      <button
                        onClick={() => router.push(`/athlete/${report.reported!.id}`)}
                        className="px-3 py-1.5 min-h-[40px] text-xs font-medium bg-surface-sunken text-secondary rounded-md hover:bg-gray-200 dark:hover:bg-stone-800"
                      >
                        View profile
                      </button>
                    )}
                    {report.status !== 'reviewing' && (
                      <button onClick={() => updateReport(report.id, 'reviewing')}
                        className="px-3 py-1.5 min-h-[40px] text-xs font-medium bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-300 rounded-md hover:bg-yellow-100 dark:hover:bg-yellow-950/60">
                        Mark reviewing
                      </button>
                    )}
                    {report.status !== 'resolved' && (
                      <button onClick={() => updateReport(report.id, 'resolved')}
                        className="px-3 py-1.5 min-h-[40px] text-xs font-medium bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 rounded-md hover:bg-green-100 dark:hover:bg-green-950/60">
                        Resolve
                      </button>
                    )}
                    {report.status !== 'dismissed' && (
                      <button onClick={() => updateReport(report.id, 'dismissed')}
                        className="px-3 py-1.5 min-h-[40px] text-xs font-medium bg-surface-muted text-tertiary rounded-md hover:bg-surface-sunken">
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
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
