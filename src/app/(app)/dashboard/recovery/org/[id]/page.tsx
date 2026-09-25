'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import type { OrgKind } from '@/lib/orgs/org-ref';
import { PersonBadges, RecoverySection, actButton, actionWords, dangerButton, fieldClass, useRecoveryAct, when } from '@/components/authority/RecoveryKit';

// ── The org recovery panel (Authority PR 4) ─────────────────────────────────
// Everything the Edge Athlete team needs to give an org back or stop its
// misuse: the people who can run it (with what makes them fit or not), an
// owner added or removed, a single-use recovery link, the site paused /
// released / delisted / restored, a vandalised name put back, the whole
// authority log. Every act names a ticket and a reason (the bar) and asks
// first. One column at phone width.

interface Person { id: string; name: string; handle: string | null; email: string | null; supervised: boolean; departed: boolean; moderation: string; holds: boolean }
interface Panel {
  org: { id: string; kind: OrgKind; name: string; description: string | null; visibility: string | null; listing_status: string | null; owner_profile_id: string | null };
  people: { rowId: string; kind: string; role: string; status: string | null; sections: string[] | null; person: Person | null; profileId: string }[];
  site: { id: string; subdomain: string; published_at: string | null; held_at: string | null; custom_domain: string | null } | null;
  revisions: { id: string; label: string | null; created_at: string; published_at: string }[];
  recoveryLinks: { id: string; expires_at: string; consumed_at: string | null; created_at: string }[];
  log: { id: string; action: string; actorKind: string; actorName: string | null; targetName: string | null; detail: Record<string, unknown>; createdAt: string }[];
  tickets: { id: string; number: string; status: string; type: string }[];
}

export default function OrgRecoveryPage() {
  return (
    <Suspense fallback={null}>
      <OrgRecovery />
    </Suspense>
  );
}

function OrgRecovery() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'missing' | 'error'>('loading');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [newOwner, setNewOwner] = useState('');
  const [replacement, setReplacement] = useState('');
  const [linkEmail, setLinkEmail] = useState('');
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  const loadRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!loading && !user) router.replace('/');
    if (!user || !id) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`/api/admin/recovery/orgs/${id}`, { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) { setState('forbidden'); return; }
        if (res.status === 404) { setState('missing'); return; }
        if (!res.ok) { setState('error'); return; }
        const data = (await res.json()) as Panel;
        if (cancelled) return;
        setPanel(data);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };
    loadRef.current = run;
    run();
    return () => { cancelled = true; };
  }, [user, loading, router, id]);

  const reload = useCallback(() => loadRef.current(), []);
  const act = useRecoveryAct(`/api/admin/recovery/orgs/${id}`, params.get('ticket') ?? '', reload);
  const off = !act.ready || act.busy;

  const org = panel?.org;
  const owners = panel?.people.filter(p => p.kind === 'follow' && p.role === 'owner') ?? [];
  const lastOwner = owners.length <= 1;

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <Link href={`/dashboard/recovery${act.ticket ? `?ticket=${encodeURIComponent(act.ticket)}` : ''}`} className="text-sm text-brand-fg hover:underline mb-4 inline-flex items-center gap-2">
          <i className="fas fa-arrow-left text-xs"></i> Recovery
        </Link>

        {state === 'loading' && <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>}
        {state === 'forbidden' && <p className="text-sm text-tertiary">Recovery is for Edge Athlete owners.</p>}
        {state === 'missing' && <p className="text-sm text-tertiary">No such organization.</p>}
        {state === 'error' && <p role="alert" className="text-sm text-tertiary">Couldn&apos;t load the organization. <button type="button" className="text-brand-fg underline" onClick={() => { setState('loading'); void reload(); }}>Try again</button></p>}

        {state === 'ready' && panel && org && (
          <div data-recovery-org={org.id}>
            <header className="mb-4">
              <h1 className="text-2xl font-bold text-primary break-words">{org.name}</h1>
              <p className="text-sm text-tertiary">
                {org.kind} · {org.visibility ?? 'public'} · {org.listing_status ?? 'unlisted'} ·{' '}
                <Link href={`/${org.kind}/${org.id}`} className="text-brand-fg hover:underline">Open its page</Link>
              </p>
            </header>

            {act.bar}

            <RecoverySection title="Who can run it">
              {panel.people.length === 0 && <p className="text-sm text-secondary" data-recovery-ownerless="">No one. Add an owner or send a recovery link below.</p>}
              <ul className="divide-y divide-border">
                {panel.people.map(p => (
                  <li key={p.rowId} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2" data-recovery-person={p.profileId} data-recovery-role={p.kind === 'staff' ? 'staff' : p.role}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-primary font-semibold break-words">
                        {p.person?.name ?? 'Deleted account'}
                        {p.person?.handle ? <span className="text-muted font-normal"> @{p.person.handle}</span> : null}
                      </p>
                      <p className="text-xs text-muted break-all">
                        {p.kind === 'staff' ? `staff · ${p.role}${p.sections?.length ? ` · ${p.sections.join(', ')}` : ''}` : p.role}
                        {p.person?.email ? ` · ${p.person.email}` : ''}
                      </p>
                      <PersonBadges person={p.person} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p.kind === 'follow' && p.role === 'owner' && (
                        <button type="button" disabled={off || (lastOwner && !replacement.trim())} className={dangerButton} data-recovery-act="remove_owner" onClick={() => act.ask({
                          title: 'Remove this owner?',
                          message: `${p.person?.name ?? 'This owner'} becomes a plain member of ${org.name}.${replacement.trim() ? ` ${replacement.trim()} becomes an owner first.` : ''}`,
                          confirmText: 'Remove owner',
                          body: { action: 'remove_owner', profile: p.profileId, replacement: replacement.trim() || null },
                        })}>Remove owner</button>
                      )}
                      {p.kind === 'follow' && p.role === 'manager' && (
                        <button type="button" disabled={off} className={actButton} data-recovery-act="demote_manager" onClick={() => act.ask({
                          title: 'Make this manager a member?',
                          message: `${p.person?.name ?? 'This manager'} stops running ${org.name}.`,
                          confirmText: 'Make member',
                          body: { action: 'set_role', profile: p.profileId, role: 'member' },
                        })}>Make member</button>
                      )}
                      {p.kind === 'staff' && (
                        <button type="button" disabled={off} className={actButton} data-recovery-act="revoke_staff" onClick={() => act.ask({
                          title: 'Revoke this staff grant?',
                          message: `${p.person?.name ?? 'This person'} loses their staff access to ${org.name}.`,
                          confirmText: 'Revoke',
                          body: { action: 'revoke_staff', row: p.rowId },
                        })}>Revoke staff</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {owners.length > 0 && (
                <label className="block text-xs text-muted mt-3">
                  Replacement owner {lastOwner ? '(required to remove the last owner)' : '(optional)'} — id, @handle or email
                  <input value={replacement} onChange={e => setReplacement(e.target.value)} className={`mt-1 ${fieldClass}`} data-recovery-replacement="" />
                </label>
              )}
            </RecoverySection>

            <RecoverySection title="Add an owner">
              <p className="text-xs text-muted mb-2">Only someone the ticket verified. No one else loses their place.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={newOwner} onChange={e => setNewOwner(e.target.value)} placeholder="id, @handle or email" className={fieldClass} data-recovery-new-owner="" />
                <button type="button" disabled={off || !newOwner.trim()} className={`${actButton} sm:w-40`} data-recovery-act="add_owner" onClick={() => act.ask({
                  title: 'Add an owner?',
                  message: `${newOwner.trim()} becomes an owner of ${org.name}, with full control.`,
                  confirmText: 'Add owner',
                  body: { action: 'add_owner', person: newOwner.trim() },
                  onDone: () => setNewOwner(''),
                })}>Add owner</button>
              </div>
            </RecoverySection>

            <RecoverySection title="Send a recovery link">
              <p className="text-xs text-muted mb-2">For someone without an account here yet, or who should prove the email. Single use, one week, only for that email. It adds an owner; it removes no one. Send it in your reply.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={linkEmail} onChange={e => setLinkEmail(e.target.value)} type="email" placeholder="their email" className={fieldClass} data-recovery-link-email="" />
                <button type="button" disabled={off || !linkEmail.trim()} className={`${actButton} sm:w-40`} data-recovery-act="recovery_link" onClick={() => act.ask({
                  title: 'Mint a recovery link?',
                  message: `A single-use link that makes the person signed in as ${linkEmail.trim()} an owner of ${org.name}.`,
                  confirmText: 'Mint link',
                  body: { action: 'recovery_link', email: linkEmail.trim() },
                  onDone: data => setLink({ url: String(data.url ?? ''), expiresAt: String(data.expiresAt ?? '') }),
                })}>Mint link</button>
              </div>
              {link && (
                <div className="mt-3 rounded-lg border border-border p-3">
                  <p className="text-xs text-muted mb-1">Expires {when(link.expiresAt)}. It is shown once.</p>
                  <p className="text-sm text-primary font-mono break-all" data-recovery-link-url="">{link.url}</p>
                  <button type="button" className={`${actButton} mt-2`} onClick={() => { void navigator.clipboard?.writeText(link.url); }}>Copy</button>
                </div>
              )}
              {panel.recoveryLinks.length > 0 && (
                <ul className="mt-3 text-xs text-muted space-y-1">
                  {panel.recoveryLinks.map(l => (
                    <li key={l.id}>Minted {when(l.created_at)} · {l.consumed_at ? `used ${when(l.consumed_at)}` : new Date(l.expires_at) < new Date() ? 'expired' : `open until ${when(l.expires_at)}`}</li>
                  ))}
                </ul>
              )}
            </RecoverySection>

            <RecoverySection title="Website">
              {!panel.site ? (
                <p className="text-sm text-secondary">No website.</p>
              ) : (
                <>
                  <p className="text-sm text-secondary mb-3" data-recovery-site-state={panel.site.held_at ? 'held' : panel.site.published_at ? 'live' : 'offline'}>
                    /org/{panel.site.subdomain}{panel.site.custom_domain ? ` · ${panel.site.custom_domain}` : ''} ·{' '}
                    {panel.site.held_at ? `paused by support since ${when(panel.site.held_at)}` : panel.site.published_at ? 'live' : 'offline'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {panel.site.held_at ? (
                      <button type="button" disabled={off} className={actButton} data-recovery-act="release" onClick={() => act.ask({
                        title: 'Release the website?',
                        message: 'The owners can take it live again. It stays offline until they do.',
                        confirmText: 'Release',
                        body: { action: 'release' },
                      })}>Release</button>
                    ) : (
                      <button type="button" disabled={off} className={dangerButton} data-recovery-act="hold" onClick={() => act.ask({
                        title: 'Pause the website?',
                        message: 'It goes offline now and cannot go live — from any path — until support releases it.',
                        confirmText: 'Pause',
                        body: { action: 'hold' },
                      })}>Pause (take offline)</button>
                    )}
                    {org.listing_status !== 'unlisted' && (
                      <button type="button" disabled={off} className={actButton} data-recovery-act="delist" onClick={() => act.ask({
                        title: 'Take it out of the directory?',
                        message: 'It leaves the directory, search and the sitemap. People with the link can still reach it.',
                        confirmText: 'Delist',
                        body: { action: 'delist' },
                      })}>Delist</button>
                    )}
                  </div>
                  {panel.revisions.length > 0 && (
                    <>
                      <h3 className="text-xs font-semibold text-muted mt-4 mb-2">Published versions (newest first)</h3>
                      <ul className="divide-y divide-border" data-recovery-revisions="">
                        {panel.revisions.map(r => (
                          <li key={r.id} className="py-2 flex flex-col sm:flex-row sm:items-center gap-2">
                            <span className="text-sm text-primary flex-1">{when(r.published_at)}{r.label ? ` · ${r.label}` : ''}</span>
                            <button type="button" disabled={off} className={actButton} data-recovery-act="restore_revision" data-recovery-revision={r.id} onClick={() => act.ask({
                              title: 'Restore this version?',
                              message: `The website goes back to how it was on ${when(r.published_at)}. Later versions stay in the history.`,
                              confirmText: 'Restore',
                              body: { action: 'restore_revision', revision: r.id },
                            })}>Restore</button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </RecoverySection>

            <RecoverySection title="Activity">
              {panel.log.length === 0 ? (
                <p className="text-sm text-secondary">Nothing recorded yet.</p>
              ) : (
                <ol className="space-y-3" data-recovery-log="">
                  {panel.log.map(e => (
                    <li key={e.id} className={`text-sm border-l-2 pl-3 ${e.actorKind === 'platform' ? 'border-brand' : 'border-border'}`} data-recovery-log-action={e.action}>
                      <p className="text-primary">
                        {actionWords(e.action)}
                        {e.targetName ? ` — ${e.targetName}` : ''}
                      </p>
                      <p className="text-xs text-muted">
                        {e.actorKind === 'platform' ? `Edge Athlete support (${e.actorName ?? 'admin'})` : e.actorKind === 'system' ? 'automatic' : e.actorName ?? 'someone'} · {when(e.createdAt)}
                        {typeof e.detail.note === 'string' ? ` · ${e.detail.note}` : ''}
                      </p>
                      {e.action === 'identity_changed' && e.detail.via !== 'restore' && (
                        <button type="button" disabled={off} className={`${actButton} mt-1`} data-recovery-act="restore_identity" onClick={() => act.ask({
                          title: 'Undo this change?',
                          message: 'The details this change edited go back to what they were before it.',
                          confirmText: 'Undo',
                          body: { action: 'restore_identity', audit: e.id },
                        })}>Undo this change</button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </RecoverySection>

            {panel.tickets.length > 0 && (
              <RecoverySection title="Tickets about it">
                <ul className="space-y-1 text-sm">
                  {panel.tickets.map(t => (
                    <li key={t.id}><Link href={`/dashboard/tickets/${t.id}`} className="text-brand-fg hover:underline">{t.number}</Link> · {t.type} · {t.status}</li>
                  ))}
                </ul>
              </RecoverySection>
            )}
          </div>
        )}
      </main>
      {act.modal}
    </div>
  );
}
