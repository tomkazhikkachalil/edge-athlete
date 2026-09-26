'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { PersonBadges, RecoverySection, actButton, actionWords, dangerButton, fieldClass, useRecoveryAct, when } from '@/components/authority/RecoveryKit';

// ── The event recovery panel (Authority PR 4) ───────────────────────────────
// Re-host an event (the new host joins as a non-playing co-organizer first;
// the old host stays as a participant unless kept as a co-organizer), take a
// co-organizer's authority away, cancel it before it starts, or make a live
// one private. Every act names a ticket and a reason and asks first.

interface Person { id: string; name: string; handle: string | null; email: string | null; supervised: boolean; departed: boolean; moderation: string; holds: boolean }
interface Panel {
  event: { id: string; name: string; status: string; visibility: string; sport_key: string; org_id: string | null; host: Person | null; hostProfileId: string };
  organizers: { participantId: string; role: string; status: string; playing: boolean; person: Person | null; profileId: string }[];
  acceptedCount: number;
  log: { id: string; action: string; actorKind: string; actorName: string | null; targetName: string | null; detail: Record<string, unknown>; createdAt: string }[];
  tickets: { id: string; number: string; status: string; type: string }[];
  /** Results-kept (241): every player's result per round — what support corrects. */
  results?: Array<{ participantId: string; profileId: string; role: string; status: string; person: Person | null; rounds: Array<{ roundId: string; sequence: number; cardId: string | null; gross: number | null; holes: number | null; lineId: string | null; stats: Record<string, number> | null }> }>;
}

/** "7=5, 12=4" → [{hole_number: 7, strokes: 5}, …]; "goals=2, assists=1" → {goals: 2, assists: 1}. Null on a malformed pair. */
function parsePairs(text: string): Array<[string, number]> | null {
  const out: Array<[string, number]> = [];
  for (const part of text.split(',').map(p => p.trim()).filter(Boolean)) {
    const m = /^([a-z0-9_]+)\s*=\s*(-?\d+(?:\.\d+)?)$/i.exec(part);
    if (!m) return null;
    out.push([m[1], Number(m[2])]);
  }
  return out.length > 0 ? out : null;
}

export default function EventRecoveryPage() {
  return (
    <Suspense fallback={null}>
      <EventRecovery />
    </Suspense>
  );
}

function EventRecovery() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'missing' | 'error'>('loading');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [newHost, setNewHost] = useState('');
  const [keepOld, setKeepOld] = useState(false);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [fix, setFix] = useState<Record<string, string>>({});

  const loadRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!loading && !user) router.replace('/');
    if (!user || !id) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`/api/admin/recovery/events/${id}`, { cache: 'no-store' });
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
  const act = useRecoveryAct(`/api/admin/recovery/events/${id}`, params.get('ticket') ?? '', reload);
  const off = !act.ready || act.busy;
  const ev = panel?.event;

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <Link href={`/dashboard/recovery${act.ticket ? `?ticket=${encodeURIComponent(act.ticket)}` : ''}`} className="text-sm text-brand-fg hover:underline mb-4 inline-flex items-center gap-2">
          <i className="fas fa-arrow-left text-xs"></i> Recovery
        </Link>

        {state === 'loading' && <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>}
        {state === 'forbidden' && <p className="text-sm text-tertiary">Recovery is for Edge Athlete owners.</p>}
        {state === 'missing' && <p className="text-sm text-tertiary">No such event.</p>}
        {state === 'error' && <p role="alert" className="text-sm text-tertiary">Couldn&apos;t load the event. <button type="button" className="text-brand-fg underline" onClick={() => { setState('loading'); void reload(); }}>Try again</button></p>}

        {state === 'ready' && panel && ev && (
          <div data-recovery-event={ev.id}>
            <header className="mb-4">
              <h1 className="text-2xl font-bold text-primary break-words">{ev.name}</h1>
              <p className="text-sm text-tertiary" data-recovery-event-status={ev.status}>
                {ev.sport_key} · {ev.status} · {ev.visibility} · {panel.acceptedCount} in ·{' '}
                <Link href={`/events/${ev.id}`} className="text-brand-fg hover:underline">Open the event</Link>
              </p>
            </header>

            {act.bar}

            <RecoverySection title="Who runs it">
              <ul className="divide-y divide-border">
                <li className="py-3" data-recovery-host={ev.hostProfileId}>
                  <p className="text-sm text-primary font-semibold">{ev.host?.name ?? 'Deleted account'} <span className="text-muted font-normal">· host</span></p>
                  {ev.host?.email && <p className="text-xs text-muted break-all">{ev.host.email}</p>}
                  <PersonBadges person={ev.host} />
                </li>
                {panel.organizers.filter(o => o.profileId !== ev.hostProfileId).map(o => (
                  <li key={o.participantId} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2" data-recovery-person={o.profileId}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-primary font-semibold">{o.person?.name ?? 'Deleted account'} <span className="text-muted font-normal">· {o.role.replace('_', '-')} ({o.status}{o.playing ? ', playing' : ''})</span></p>
                      <PersonBadges person={o.person} />
                    </div>
                    {o.role === 'co_organizer' && (
                      <button type="button" disabled={off} className={actButton} data-recovery-act="remove_co_organizer" onClick={() => act.ask({
                        title: 'Remove this co-organizer?',
                        message: `${o.person?.name ?? 'They'} stay in the event as a participant, without authority.`,
                        confirmText: 'Remove',
                        body: { action: 'remove_co_organizer', participant: o.participantId },
                      })}>Remove co-organizer</button>
                    )}
                  </li>
                ))}
              </ul>
            </RecoverySection>

            {(panel.results?.length ?? 0) > 0 && (
              <RecoverySection title="Results">
                <p className="text-xs text-muted mb-2">Move a result to the person who really played it, correct a score, or remove a result nobody played. The data is kept and everyone involved is told.</p>
                <ul className="divide-y divide-border" data-recovery-results="">
                  {panel.results!.map(r => (
                    <li key={r.participantId} className="py-3 space-y-2" data-recovery-result={r.participantId}>
                      <p className="text-sm text-primary font-semibold break-words">
                        {r.person?.name ?? 'Deleted account'} <span className="text-muted font-normal">· {r.role.replace('_', '-')} ({r.status})</span>
                      </p>
                      <ul className="text-xs text-secondary space-y-1">
                        {r.rounds.map(x => {
                          const key = x.cardId ?? x.lineId ?? x.roundId;
                          return (
                            <li key={key} className="flex flex-col sm:flex-row sm:items-center gap-2">
                              <span className="flex-1">Round {x.sequence}: {x.gross != null ? `${x.gross} (${x.holes ?? 0} holes)` : x.stats ? Object.entries(x.stats).map(([k, v]) => `${k} ${v}`).join(', ') || 'no stats' : 'no score'}</span>
                              {(x.cardId || x.lineId) && (
                                <>
                                  <input value={fix[key] ?? ''} onChange={e => setFix(f => ({ ...f, [key]: e.target.value }))} placeholder={x.cardId ? 'hole=strokes, e.g. 7=5, 12=4' : 'stat=value, e.g. goals=2'} className={`${fieldClass} sm:w-56`} data-recovery-fix={key} />
                                  <button type="button" disabled={off || !parsePairs(fix[key] ?? '')} className={actButton} data-recovery-act={x.cardId ? 'correct_card' : 'correct_line'} onClick={() => {
                                    const pairs = parsePairs(fix[key] ?? '') ?? [];
                                    act.ask({
                                      title: 'Correct this result?',
                                      message: `The corrected values replace what was recorded; the round re-syncs and ${r.person?.name ?? 'the player'} is told.`,
                                      confirmText: 'Correct',
                                      body: x.cardId
                                        ? { action: 'correct_card', card: x.cardId, holes: pairs.map(([h, s]) => ({ hole_number: Number(h), strokes: s })) }
                                        : { action: 'correct_line', line: x.lineId, stats: Object.fromEntries(pairs) },
                                      onDone: () => setFix(f => ({ ...f, [key]: '' })),
                                    });
                                  }}>Correct</button>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {r.profileId !== ev.hostProfileId && (
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input value={moveTo[r.participantId] ?? ''} onChange={e => setMoveTo(m => ({ ...m, [r.participantId]: e.target.value }))} placeholder="the right person: id, @handle or email" className={fieldClass} data-recovery-move-to={r.participantId} />
                          <button type="button" disabled={off || !(moveTo[r.participantId] ?? '').trim()} className={actButton} data-recovery-act="reassign_result" onClick={() => act.ask({
                            title: 'Move this result?',
                            message: `Everything ${r.person?.name ?? 'this player'} has on ${ev.name} moves to ${(moveTo[r.participantId] ?? '').trim()}. Both are told, and so are the organizers.`,
                            confirmText: 'Move result',
                            body: { action: 'reassign_result', participant: r.participantId, person: (moveTo[r.participantId] ?? '').trim() },
                            onDone: () => setMoveTo(m => ({ ...m, [r.participantId]: '' })),
                          })}>Move result</button>
                          <button type="button" disabled={off} className={dangerButton} data-recovery-act="remove_result" onClick={() => act.ask({
                            title: 'Remove this result as a mistake?',
                            message: 'Only for a result nobody played (a test, a duplicate). It leaves the event, the profile, the handicap and the dataset.',
                            confirmText: 'Remove',
                            body: { action: 'remove_result', participant: r.participantId },
                          })}>Remove as mistaken</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </RecoverySection>
            )}

            <RecoverySection title="Hand the event to someone else">
              <p className="text-xs text-muted mb-2">Someone the ticket verified. If they are not in the event they join as a co-organizer who does not play.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={newHost} onChange={e => setNewHost(e.target.value)} placeholder="id, @handle or email" className={fieldClass} data-recovery-new-host="" />
                <button type="button" disabled={off || !newHost.trim()} className={`${actButton} sm:w-40`} data-recovery-act="host" onClick={() => act.ask({
                  title: 'Hand the event over?',
                  message: `${newHost.trim()} becomes the host of ${ev.name}. The current host ${keepOld ? 'stays as a co-organizer' : 'stays as a participant, without authority'}.`,
                  confirmText: 'Hand over',
                  body: { action: 'host', person: newHost.trim(), keep_old_host: keepOld },
                  onDone: () => setNewHost(''),
                })}>Hand over</button>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-secondary mt-2 min-h-[44px]">
                <input type="checkbox" checked={keepOld} onChange={e => setKeepOld(e.target.checked)} />
                Keep the current host as a co-organizer
              </label>
            </RecoverySection>

            <RecoverySection title="Stop it">
              <div className="flex flex-wrap gap-2">
                {(ev.status === 'draft' || ev.status === 'open') && (
                  <button type="button" disabled={off} className={dangerButton} data-recovery-act="cancel" onClick={() => act.ask({
                    title: 'Cancel the event?',
                    message: `${ev.name} is cancelled for everyone. This cannot be undone.`,
                    confirmText: 'Cancel event',
                    body: { action: 'cancel' },
                  })}>Cancel event</button>
                )}
                {ev.visibility !== 'private' && (
                  <button type="button" disabled={off} className={actButton} data-recovery-act="make_private" onClick={() => act.ask({
                    title: 'Make the event private?',
                    message: 'Only the people in it can see it. The organizers can change this back.',
                    confirmText: 'Make private',
                    body: { action: 'make_private' },
                  })}>Make private</button>
                )}
              </div>
              {ev.status === 'live' && <p className="text-xs text-muted mt-2">A live event is never cancelled. Make it private or hand it over.</p>}
            </RecoverySection>

            <RecoverySection title="Activity">
              {panel.log.length === 0 ? (
                <p className="text-sm text-secondary">Nothing recorded yet.</p>
              ) : (
                <ol className="space-y-3" data-recovery-log="">
                  {panel.log.map(e => (
                    <li key={e.id} className={`text-sm border-l-2 pl-3 ${e.actorKind === 'platform' ? 'border-brand' : 'border-border'}`} data-recovery-log-action={e.action}>
                      <p className="text-primary">{actionWords(e.action)}{e.targetName ? ` — ${e.targetName}` : ''}</p>
                      <p className="text-xs text-muted">
                        {e.actorKind === 'platform' ? `Edge Athlete support (${e.actorName ?? 'admin'})` : e.actorKind === 'system' ? 'automatic' : e.actorName ?? 'someone'} · {when(e.createdAt)}
                        {typeof e.detail.note === 'string' ? ` · ${e.detail.note}` : ''}
                      </p>
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
