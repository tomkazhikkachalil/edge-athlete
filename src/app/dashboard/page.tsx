'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { useToast } from '@/components/Toast';
import { formatDisplayName } from '@/lib/formatters';

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

  useEffect(() => {
    if (!authLoading && !user) router.push('/');
  }, [user, authLoading, router]);

  const loadReports = useCallback(async (filter: StatusFilter) => {
    setReportsLoading(true);
    try {
      const response = await fetch(`/api/admin/reports?status=${filter}`);
      if (response.status === 403) {
        setAuthorized(false);
        return;
      }
      setAuthorized(true);
      if (response.ok) {
        const data = await response.json();
        setReports(data.reports);
      }
    } catch (e) {
      console.error('Failed to load reports:', e);
    } finally {
      setReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.id) loadReports(statusFilter);
  }, [user?.id, statusFilter, loadReports]);

  // Clearing is synchronisation (render phase); the debounced fetch stays here.
  const [syncedUserQuery, setSyncedUserQuery] = useState({ authorized, userQuery });
  if (syncedUserQuery.authorized !== authorized || syncedUserQuery.userQuery !== userQuery) {
    setSyncedUserQuery({ authorized, userQuery });
    if (!authorized || userQuery.trim().length < 2) setUsers([]);
  }

  // Debounced user search
  useEffect(() => {
    if (!authorized || userQuery.trim().length < 2) return;
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
    }, 300);
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
      <div className="min-h-screen bg-gray-50">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center px-4">
            <i className="fas fa-lock text-4xl text-gray-300 mb-4"></i>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Admin access required</h1>
            <p className="text-sm text-gray-600">This area is for Edge Athlete administrators.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader showSearch={false} />

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
          <i className="fas fa-shield-alt mr-2 text-violet-600"></i>
          Admin
        </h1>

        {/* Queues — dedicated admin pages */}
        <section className="grid sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => router.push('/dashboard/consent')}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-left hover:border-violet-300 transition"
          >
            <p className="text-sm font-semibold text-gray-900">
              <i className="fas fa-file-signature text-violet-600 mr-2"></i>
              Consent reviews
            </p>
            <p className="text-xs text-gray-500 mt-1">Signed parental-consent submissions awaiting review.</p>
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard/guardians')}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-left hover:border-violet-300 transition"
          >
            <p className="text-sm font-semibold text-gray-900">
              <i className="fas fa-user-shield text-violet-600 mr-2"></i>
              Guardian support
            </p>
            <p className="text-xs text-gray-500 mt-1">Orphaned supervised profiles — invite a guardian or delete.</p>
          </button>
        </section>

        {/* Message reports queue */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Message reports</h2>
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1.5 min-h-[40px] rounded-md text-xs font-medium capitalize transition-colors ${
                    statusFilter === f ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {reportsLoading ? (
            <p className="text-sm text-gray-500 py-6 text-center">Loading reports…</p>
          ) : reports.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              No {statusFilter === 'all' ? '' : statusFilter} reports. 🎉
            </p>
          ) : (
            <div className="space-y-3">
              {reports.map(report => (
                <div key={report.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-red-50 text-red-700 text-xs font-semibold rounded-full uppercase">
                      {report.reason}
                    </span>
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full capitalize">
                      {report.status}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(report.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mb-1">
                    <span className="font-medium">{name(report.reporter)}</span>
                    {' reported '}
                    <span className="font-medium">{name(report.reported)}</span>
                  </p>
                  {report.message?.content && (
                    <blockquote className="text-sm text-gray-600 bg-gray-50 border-l-2 border-gray-300 pl-3 py-1.5 my-2 break-words">
                      {report.message.content}
                    </blockquote>
                  )}
                  {report.details && (
                    <p className="text-xs text-gray-500 mb-2 break-words">Reporter notes: {report.details}</p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {report.reported && (
                      <button
                        onClick={() => router.push(`/athlete/${report.reported!.id}`)}
                        className="px-3 py-1.5 min-h-[40px] text-xs font-medium bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                      >
                        View profile
                      </button>
                    )}
                    {report.status !== 'reviewing' && (
                      <button onClick={() => updateReport(report.id, 'reviewing')}
                        className="px-3 py-1.5 min-h-[40px] text-xs font-medium bg-yellow-50 text-yellow-700 rounded-md hover:bg-yellow-100">
                        Mark reviewing
                      </button>
                    )}
                    {report.status !== 'resolved' && (
                      <button onClick={() => updateReport(report.id, 'resolved')}
                        className="px-3 py-1.5 min-h-[40px] text-xs font-medium bg-green-50 text-green-700 rounded-md hover:bg-green-100">
                        Resolve
                      </button>
                    )}
                    {report.status !== 'dismissed' && (
                      <button onClick={() => updateReport(report.id, 'dismissed')}
                        className="px-3 py-1.5 min-h-[40px] text-xs font-medium bg-gray-50 text-gray-600 rounded-md hover:bg-gray-100">
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* User lookup */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">User lookup</h2>
          <input
            type="search"
            value={userQuery}
            onChange={e => setUserQuery(e.target.value)}
            placeholder="Search by name, email, or handle…"
            className="w-full px-3 py-2 min-h-[44px] border border-gray-300 rounded-md text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-500 mb-4"
            aria-label="Search users"
          />
          {searching ? (
            <p className="text-sm text-gray-500">Searching…</p>
          ) : users.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Handle</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Joined</th>
                    <th className="px-3 py-2 text-left"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{name(u)}</td>
                      <td className="px-3 py-2 text-gray-600">{u.email || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{u.handle || '—'}</td>
                      <td className="px-3 py-2 text-gray-600 capitalize">{u.user_type}{u.visibility === 'private' ? ' · private' : ''}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => router.push(`/athlete/${u.id}`)}
                          className="text-xs font-medium text-violet-600 hover:text-violet-700"
                        >
                          View →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : userQuery.trim().length >= 2 ? (
            <p className="text-sm text-gray-500">No users match.</p>
          ) : (
            <p className="text-xs text-gray-400">Type at least 2 characters to search.</p>
          )}
        </section>
      </div>
    </div>
  );
}
