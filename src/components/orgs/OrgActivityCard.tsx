'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OwnerAuthorityEntry } from '@/lib/authority/projection';

// ── Activity — the owner's authority log (Authority PR 5, Sep 25 2026) ─────
// Who changed who can run this club or league and its public face: owners,
// managers, staff, the site going live or offline, publishes, restores,
// deletes. A change by the Edge Athlete team reads "Edge Athlete support".
// A deleted news post has an inline Restore while it can still come back.
// Owners only (the API decides); newest first, "Show older" pages back.

export default function OrgActivityCard({ plural, orgId, onRestored }: { plural: 'leagues' | 'clubs'; orgId: string; onRestored?: () => void }) {
  const [entries, setEntries] = useState<OwnerAuthorityEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'hidden' | 'error'>('loading');
  const [restoring, setRestoring] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (before: string | null): Promise<{ ok: boolean; entries: OwnerAuthorityEntry[]; next: string | null; hidden?: boolean }> => {
    try {
      const res = await fetch(`/api/${plural}/${orgId}/authority-log${before ? `?before=${encodeURIComponent(before)}` : ''}`, { cache: 'no-store' });
      if (res.status === 403 || res.status === 404) return { ok: false, entries: [], next: null, hidden: true };
      if (!res.ok) return { ok: false, entries: [], next: null };
      const body = (await res.json()) as { supported: boolean; entries: OwnerAuthorityEntry[]; next: string | null };
      if (!body.supported) return { ok: false, entries: [], next: null, hidden: true };
      return { ok: true, entries: body.entries, next: body.next };
    } catch {
      return { ok: false, entries: [], next: null };
    }
  }, [plural, orgId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = await load(null);
      if (cancelled) return;
      if (!out.ok) { setStatus(out.hidden ? 'hidden' : 'error'); return; }
      setEntries(out.entries);
      setNext(out.next);
      setStatus('ready');
    })();
    return () => { cancelled = true; };
  }, [load]);

  const older = async () => {
    if (!next) return;
    const out = await load(next);
    if (!out.ok) return;
    setEntries(e => [...e, ...out.entries]);
    setNext(out.next);
  };

  const restore = async (newsId: string) => {
    setRestoring(newsId);
    setMessage(null);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/site/news/${newsId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restore: true }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(typeof body.error === 'string' ? body.error : 'Could not restore it.'); return; }
      setMessage('Restored — the post is back as it was.');
      const out = await load(null);
      if (out.ok) { setEntries(out.entries); setNext(out.next); }
      onRestored?.();
    } finally {
      setRestoring(null);
    }
  };

  if (status === 'hidden') return null;

  return (
    <section id="activity" aria-label="Activity" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-org-activity="">
      <h2 className="text-lg font-semibold text-primary">Activity</h2>
      <p className="text-sm text-tertiary mb-4">Who changed who runs this, and its website. Only owners see this.</p>
      {status === 'loading' && <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand"></div>}
      {status === 'error' && <p role="alert" className="text-sm text-tertiary">Couldn&apos;t load the activity.</p>}
      {message && <p role="status" className="text-sm text-secondary mb-3" data-org-activity-message="">{message}</p>}
      {status === 'ready' && entries.length === 0 && <p className="text-sm text-tertiary">Nothing recorded yet.</p>}
      {status === 'ready' && entries.length > 0 && (
        <ol className="space-y-3">
          {entries.map(e => (
            <li key={e.id} className={`text-sm border-l-2 pl-3 ${e.actor === 'Edge Athlete support' ? 'border-brand' : 'border-border'}`} data-org-activity-action={e.action}>
              <p className="text-primary break-words">
                {e.words}
                {e.target ? ` — ${e.target}` : ''}
                {e.detail.title ? ` — “${e.detail.title}”` : e.detail.label ? ` — “${e.detail.label}”` : e.detail.domain ? ` — ${e.detail.domain}` : e.detail.listing ? ` — ${e.detail.listing}` : e.detail.fields?.length ? ` — ${e.detail.fields.join(', ')}` : ''}
              </p>
              <p className="text-xs text-muted">
                {e.actor} · {new Date(e.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
              {e.action === 'news_deleted' && e.detail.newsId && (
                <button type="button" disabled={restoring !== null} onClick={() => void restore(e.detail.newsId as string)} className="mt-1 px-3 py-1.5 min-h-[44px] rounded-lg border border-border bg-surface text-xs font-semibold text-primary ea-interactive disabled:opacity-50" data-org-activity-restore={e.detail.newsId}>
                  {restoring === e.detail.newsId ? 'Restoring…' : 'Restore'}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {next && (
        <button type="button" onClick={() => void older()} className="mt-3 text-sm text-brand-fg hover:underline min-h-[44px]">
          Show older
        </button>
      )}
    </section>
  );
}
