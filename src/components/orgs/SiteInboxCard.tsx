'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';

// ── The site's inbox — program 2, D2 (Sep 11 2026) ─────────────────────────
// What visitors sent through the site's forms (contact, interest): the
// open list with a Mark read / Archive per row, the archived list with
// Restore. Fetches its own rows (GET …/site/forms?state=), writes through
// PATCH; the bell's `#inbox` lands here. Personal data stays in the console
// — nothing here is ever public.

interface Row {
  id: string;
  kind: 'contact' | 'interest';
  fields: Record<string, unknown>;
  pagePath: string | null;
  createdAt: string;
  readAt: string | null;
  archivedAt: string | null;
}

const PILL = 'min-h-[36px] rounded-md border border-border-strong px-3 text-xs text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';

export default function SiteInboxCard({ plural, orgId }: { plural: 'leagues' | 'clubs'; orgId: string }) {
  const { showError, showSuccess } = useToast();
  const [state, setState] = useState<'open' | 'archived'>('open');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/${plural}/${orgId}/site/forms?state=${state}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setRows([]);
          return;
        }
        const body = (await res.json()) as { submissions: Row[]; unread: number; supported?: boolean };
        if (cancelled) return;
        setRows(body.submissions);
        setUnread(body.unread);
        setSupported(body.supported !== false);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plural, orgId, state, reloadKey]);

  const patch = useCallback(
    async (id: string, body: { read?: boolean; archived?: boolean }, done: string) => {
      setBusy(id);
      try {
        const res = await fetch(`/api/${plural}/${orgId}/site/forms`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) });
        const out = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          showError('Inbox', out.error || 'Could not update the submission');
          return;
        }
        showSuccess('Inbox', done);
        setReloadKey(k => k + 1);
      } catch {
        showError('Inbox', 'Could not update the submission');
      } finally {
        setBusy(null);
      }
    },
    [plural, orgId, showError, showSuccess]
  );

  if (!supported) return null;
  const field = (r: Row, k: string) => (typeof r.fields[k] === 'string' ? (r.fields[k] as string) : null);
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section id="inbox" aria-label="Inbox" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-site-inbox="">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-semibold text-primary">
          Inbox{unread > 0 && <span className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-brand px-1.5 text-xs font-semibold text-white" data-site-inbox-unread="">{unread}</span>}
        </h2>
        <div role="radiogroup" aria-label="Inbox view" className="inline-flex rounded-md border border-border-strong p-0.5">
          {(['open', 'archived'] as const).map(v => (
            <button key={v} type="button" role="radio" aria-checked={state === v} onClick={() => setState(v)} className={`min-h-[36px] rounded px-2.5 text-xs font-medium ${state === v ? 'bg-brand text-white' : 'text-secondary hover:bg-surface-sunken'}`}>
              {v === 'open' ? 'Open' : 'Archived'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-tertiary mb-3">What visitors sent through your site’s forms. Only your managers see this.</p>
      {rows === null ? (
        <div className="h-12 animate-pulse rounded bg-surface-sunken" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-tertiary">{state === 'open' ? 'Nothing yet — add a contact or interest form to your site in the editor.' : 'Nothing archived.'}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map(r => {
            const name = field(r, 'name') ?? 'Someone';
            const email = field(r, 'email');
            const unreadRow = !r.readAt && !r.archivedAt;
            return (
              <li key={r.id} className={`rounded-lg border p-3 ${unreadRow ? 'border-brand bg-brand-soft/30' : 'border-border'}`} data-site-inbox-row={r.id} data-site-inbox-unread-row={unreadRow ? '1' : '0'}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary">
                      {name}
                      <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tertiary">{r.kind === 'contact' ? 'Message' : 'Interest'}</span>
                      {field(r, 'ageGroup') && <span className="ml-2 text-xs text-secondary">{field(r, 'ageGroup')}</span>}
                    </p>
                    <p className="text-xs text-tertiary">
                      {email && (
                        <a href={`mailto:${email}`} className="text-brand-fg hover:underline">
                          {email}
                        </a>
                      )}
                      {field(r, 'phone') && <span> · {field(r, 'phone')}</span>}
                      <span> · {when(r.createdAt)}</span>
                      {r.pagePath && <span> · from {r.pagePath}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {state === 'open' && unreadRow && (
                      <button type="button" onClick={() => void patch(r.id, { read: true }, 'Marked as read')} disabled={busy === r.id} className={PILL} data-site-inbox-read="">
                        Mark read
                      </button>
                    )}
                    {state === 'open' ? (
                      <button type="button" onClick={() => void patch(r.id, { archived: true }, 'Archived')} disabled={busy === r.id} className={PILL} data-site-inbox-archive="">
                        Archive
                      </button>
                    ) : (
                      <button type="button" onClick={() => void patch(r.id, { archived: false }, 'Restored to the inbox')} disabled={busy === r.id} className={PILL} data-site-inbox-restore="">
                        Restore
                      </button>
                    )}
                  </div>
                </div>
                {field(r, 'message') && <p className="mt-2 whitespace-pre-line text-sm text-primary">{field(r, 'message')}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-tertiary">Archived messages are removed after a year; open ones after two.</p>
    </section>
  );
}
