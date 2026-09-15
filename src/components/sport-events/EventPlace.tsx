'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ConfirmModal from '@/components/ConfirmModal';
import { useAuth } from '@/lib/auth';
import { localDayKey } from '@/lib/calendar/grid';
import { eventApi } from '@/lib/sport-events/client';
import { joinControl } from '@/lib/sport-events/join-state';
import { parseEventTab, tabsFor, type EventTab } from '@/lib/sport-events/tabs';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import EventGroupsEditor from './EventGroupsEditor';
import EventHeader from './EventHeader';
import EventLeaderboard from './EventLeaderboard';
import EventOverview from './EventOverview';
import EventPlayers from './EventPlayers';
import EventSchedule from './EventSchedule';
import EventTabs from './EventTabs';
import InviteWindow from './InviteWindow';

/**
 * The event page shell (Events program). Holds the view, the active tab
 * (`?tab=` deep link, replaceState on change — the notifications land on
 * players / leaderboard), every action, and one refetch after each. The
 * server page hands a public event's view in for the first paint; the
 * viewer's own role arrives with the session refetch.
 */
interface Props {
  eventId: string;
  initialView: SportEventViewPayload | null;
  token: string | null;
}

type Confirm = { title: string; message: string; confirmText: string; danger?: boolean; run: () => Promise<void> } | null;

export default function EventPlace({ eventId, initialView, token }: Props) {
  const { user, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const api = useMemo(() => eventApi(eventId, token), [eventId, token]);
  const [view, setView] = useState<SportEventViewPayload | null>(initialView);
  const [tab, setTab] = useState<EventTab>(parseEventTab(params.get('tab'), { canManage: initialView?.viewer.can_manage ?? true }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [version, setVersion] = useState(0);

  const refetch = useCallback(async () => {
    const res = await api.view();
    if (res.ok && res.data) {
      setView(res.data);
      setVersion(v => v + 1);
    }
    return res;
  }, [api]);

  // The session refetch: the viewer's role, the organizer's link token.
  useEffect(() => {
    if (!initialAuthCheckComplete) return;
    let cancelled = false;
    (async () => {
      const res = await api.view();
      if (!cancelled && res.ok && res.data) setView(res.data);
    })();
    return () => { cancelled = true; };
  }, [api, initialAuthCheckComplete, user?.id]);

  const changeTab = (next: EventTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url.toString());
  };

  const run = useCallback(async (fn: () => Promise<{ ok: boolean; error: string | null }>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fn();
    if (!res.ok) setError(res.error ?? 'Something went wrong.');
    else if (done) setNotice(done);
    await refetch();
    setBusy(false);
    return res.ok;
  }, [refetch]);

  if (!view) return null;
  const { event, viewer } = view;
  const visibleTab: EventTab = tab === 'groups' && !viewer.can_manage ? 'overview' : tab;
  const own = view.participants.find(p => p.id === viewer.participant_id) ?? null;
  const host = view.participants.find(p => p.profile_id === event.host_profile_id);
  const control = joinControl({
    signedIn: !!user,
    canManage: viewer.can_manage,
    role: viewer.role,
    participantStatus: viewer.participant_status,
    playing: viewer.playing,
    waitlistPosition: own?.waitlist_position ?? null,
    event: { status: event.status, joinMode: event.join_mode },
  });
  const pid = viewer.participant_id;

  const joinActions = {
    onAccept: () => { if (pid) run(() => api.participantAction(pid, 'accept'), "You're in."); },
    onDecline: () => { if (pid) run(() => api.participantAction(pid, 'decline')); },
    onRequest: () => run(() => api.request(), 'Request sent.'),
    onCancelRequest: () => { if (pid) run(() => api.participantAction(pid, 'decline')); },
    onWithdraw: () => setConfirm({ title: 'Leave this event?', message: 'Your spot goes to the next player on the waitlist.', confirmText: 'Leave', danger: true, run: async () => { if (pid) await run(() => api.participantAction(pid, 'withdraw')); } }),
    onFollow: () => run(() => api.follow()),
    onUnfollow: () => run(() => api.unfollow()),
    onManage: () => changeTab('players'),
  };

  const today = () => localDayKey(new Date());
  const organizerControls = viewer.can_manage && event.status !== 'completed' && event.status !== 'cancelled' ? (
    <div className="mt-4 flex flex-wrap gap-2" data-event-organizer-controls="">
      {event.status === 'draft' && (
        <button type="button" disabled={busy} onClick={() => run(() => api.transition('open'), 'Published.')} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-event-action="open">Publish</button>
      )}
      {event.status === 'open' && (
        <button type="button" disabled={busy} onClick={() => setConfirm({ title: 'Go live?', message: 'The round starts for everyone who accepted. Invites close; late accepts still join.', confirmText: 'Go live', run: async () => { await run(() => api.transition('live', { today: today() }), 'The round is live.'); } })} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-event-action="live">Go live</button>
      )}
      {event.status === 'live' && (
        <button type="button" disabled={busy} onClick={() => setConfirm({ title: 'Complete the event?', message: 'Cards that are not final are finalized as they stand. Results post to every player\'s profile unless they opted out.', confirmText: 'Complete', run: async () => { await run(() => api.transition('completed', { override: true }), 'Results are in.'); } })} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-event-action="completed">Complete</button>
      )}
      {(event.status === 'draft' || event.status === 'open') && (
        <button type="button" disabled={busy} onClick={() => setConfirm({ title: 'Cancel this event?', message: 'Players are no longer expected. This cannot be undone.', confirmText: 'Cancel event', danger: true, run: async () => { await run(() => api.transition('cancelled')); } })} className="ea-interactive border border-border-strong text-secondary px-4 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-event-action="cancelled">Cancel event</button>
      )}
    </div>
  ) : null;

  const excludeIds = new Set(view.participants.filter(p => p.status !== 'declined' && p.status !== 'withdrawn' && p.status !== 'removed').map(p => p.profile_id));

  return (
    <div className="space-y-4" data-event-place="">
      <EventHeader view={view} hostName={host?.name ?? 'the host'} control={control} busy={busy} actions={joinActions} organizerControls={organizerControls} />
      {(error || notice) && (
        <p role="status" className={`text-sm rounded-lg px-3 py-2 ${error ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'}`} data-event-notice="">
          {error ?? notice}
        </p>
      )}
      <section className="bg-surface rounded-lg border border-border">
        <EventTabs tabs={tabsFor({ canManage: viewer.can_manage })} active={visibleTab} onChange={changeTab} />
        <div id={`event-panel-${visibleTab}`} role="tabpanel" aria-labelledby={`event-tab-${visibleTab}`} className="p-4 sm:p-6">
          {visibleTab === 'overview' && <EventOverview view={view} busy={busy} onRotateLink={async () => { await run(() => api.rotateLink(), 'New link ready.'); }} />}
          {visibleTab === 'schedule' && <EventSchedule view={view} />}
          {visibleTab === 'players' && (
            <EventPlayers
              view={view}
              control={control}
              busy={busy}
              joinActions={joinActions}
              onOpenInvite={() => setInviteOpen(true)}
              onInviteHandle={async h => { await run(() => api.inviteHandles([h]), 'Invited.'); }}
              onDecide={(target, action) => run(() => api.participantAction(target, action))}
              onHideToggle={(target, hidden) => run(() => api.participantPatch(target, { hide_from_profile: hidden }))}
              onIndexOverride={(target, index) => run(() => api.participantPatch(target, { handicap_index: index }))}
            />
          )}
          {visibleTab === 'groups' && viewer.can_manage && <EventGroupsEditor view={view} api={api} onSaved={v => { setView(v); setVersion(x => x + 1); }} />}
          {visibleTab === 'leaderboard' && <EventLeaderboard view={view} api={api} version={version} />}
        </div>
      </section>
      {inviteOpen && (
        <InviteWindow
          excludeIds={excludeIds}
          onClose={() => setInviteOpen(false)}
          onInvite={async id => {
            const res = await api.invite([id]);
            if (!res.ok) { setError(res.error); return false; }
            await refetch();
            return (res.data?.invited ?? []).includes(id);
          }}
        />
      )}
      {confirm && (
        <ConfirmModal
          isOpen
          title={confirm.title}
          message={confirm.message}
          confirmText={confirm.confirmText}
          confirmButtonClass={confirm.danger ? 'bg-red-600 hover:bg-red-700 text-white' : undefined}
          onConfirm={async () => { const c = confirm; setConfirm(null); await c.run(); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {!user && initialAuthCheckComplete && (
        <p className="text-sm text-muted text-center">
          <button type="button" onClick={() => router.push('/')} className="text-brand-fg hover:text-brand-fg-strong font-medium min-h-[44px]">Log in</button> to join or follow this event.
        </p>
      )}
    </div>
  );
}
