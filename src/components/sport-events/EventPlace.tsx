'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ConfirmModal from '@/components/ConfirmModal';
import { useAuth } from '@/lib/auth';
import { localDayKey } from '@/lib/calendar/grid';
import { eventApi } from '@/lib/sport-events/client';
import { joinControl } from '@/lib/sport-events/join-state';
import { confirmCopyFor, nextOrganizerStep, type RoundAction } from '@/lib/sport-events/page-rules';
import { activeRounds, nextSequence } from '@/lib/sport-events/rounds';
import { parseEventTab, parseRoundParam, tabsFor, type EventTab, type RoundSelection } from '@/lib/sport-events/tabs';
import { isMatchFormat } from '@/lib/sport-events/types';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import EventGroupsEditor from './EventGroupsEditor';
import EventHeader from './EventHeader';
import EventLeaderboard from './EventLeaderboard';
import EventOverview from './EventOverview';
import EventPlayers from './EventPlayers';
import EventSchedule from './EventSchedule';
import EventMatchesTab from './EventMatchesTab';
import EventScorecardTab from './EventScorecardTab';
import EventTabs from './EventTabs';
import FlightsWindow from './FlightsWindow';
import CountsTowardWindow from './CountsTowardWindow';
import FormatSettingsWindow from './FormatSettingsWindow';
import InviteWindow from './InviteWindow';
import RoundEditWindow from './RoundEditWindow';

/**
 * The event page shell (Events program). Holds the view, the active tab
 * (`?tab=` deep link, replaceState on change — the notifications land on
 * players / leaderboard), every action, and one refetch after each. The
 * server page hands a public event's view in for the first paint; the
 * viewer's own role arrives with the session refetch.
 *
 * Phase 2: ONE selected round (`?round=overall|<id>`, parseRoundParam —
 * re-derived on every render so a round minted or completed by an action
 * moves the selection without an effect), the round actions (start /
 * complete / cancel / edit / remove, the confirm copy from page-rules.ts),
 * the add / edit window, and the header's primary action = the next
 * organizer step (Publish → Start round n → Complete round n).
 */
interface Props {
  eventId: string;
  initialView: SportEventViewPayload | null;
  token: string | null;
}

type Confirm = { title: string; message: string; confirmText: string; danger?: boolean; run: () => Promise<void> } | null;
type RoundView = SportEventViewPayload['rounds'][number];
type RoundEdit = { mode: 'add' } | { mode: 'edit'; round: RoundView } | null;

const PRIMARY = 'ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';
const SECONDARY = 'ea-interactive border border-border-strong text-secondary px-4 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

export default function EventPlace({ eventId, initialView, token }: Props) {
  const { user, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const api = useMemo(() => eventApi(eventId, token), [eventId, token]);
  const [view, setView] = useState<SportEventViewPayload | null>(initialView);
  const [tab, setTab] = useState<EventTab>(parseEventTab(params.get('tab'), { canManage: true, isPlayer: true, roundMinted: true, matchPlay: isMatchFormat(initialView?.event.format) || params.get('tab') === 'matches' }));
  const [roundParam, setRoundParam] = useState<string | null>(params.get('round'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [flightsOpen, setFlightsOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [countsTowardOpen, setCountsTowardOpen] = useState(false);
  const [roundEdit, setRoundEdit] = useState<RoundEdit>(null);
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

  const writeUrl = (nextTab: EventTab, nextRound: string | null) => {
    const url = new URL(window.location.href);
    if (nextTab === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', nextTab);
    if (nextRound) url.searchParams.set('round', nextRound);
    else url.searchParams.delete('round');
    window.history.replaceState(window.history.state, '', url.toString());
  };
  const changeTab = (next: EventTab) => {
    setTab(next);
    writeUrl(next, roundParam);
  };
  const changeRound = (next: RoundSelection) => {
    setRoundParam(next);
    writeUrl(tab, next);
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
  const matchPlay = isMatchFormat(event.format);
  const tabViewer = { canManage: viewer.can_manage, isPlayer: viewer.participant_status === 'accepted' && viewer.playing, roundMinted: view.rounds.some(r => r.group_post_id !== null), matchPlay };
  const visibleTab: EventTab = tabsFor(tabViewer).includes(tab) ? tab : 'overview';
  const selectedRound = parseRoundParam(roundParam, view.rounds, visibleTab, { bracket: !!event.match?.bracket });
  const many = activeRounds(view.rounds).length > 1;
  const own = view.participants.find(p => p.id === viewer.participant_id) ?? null;
  const host = view.participants.find(p => p.profile_id === event.host_profile_id);
  const control = joinControl({
    signedIn: !!user,
    canManage: viewer.can_manage,
    role: viewer.role,
    participantStatus: viewer.participant_status,
    playing: viewer.playing,
    waitlistPosition: own?.waitlist_position ?? null,
    waitlistAhead: viewer.waitlist_ahead,
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
    onSignIn: () => router.push(`/?next=${encodeURIComponent(`/events/${eventId}`)}`),
  };

  const today = () => localDayKey(new Date());

  // The round actions — the confirm copy is page-rules.ts's; a single-round event keeps phase 1's words.
  const roundAction = (round: RoundView, action: RoundAction) => {
    if (action === 'edit') { setRoundEdit({ mode: 'edit', round }); return; }
    const copy = confirmCopyFor(action, round, view.rounds, { matchPlay });
    const done = action === 'start' ? (many ? `Round ${round.sequence} is live.` : 'The round is live.')
      : action === 'complete' ? (many && view.rounds.some(r => r.status === 'scheduled' && r.id !== round.id) ? `Round ${round.sequence} is final.` : 'Results are in.')
      : action === 'cancel' ? `Round ${round.sequence} cancelled.` : `Round ${round.sequence} removed.`;
    setConfirm({
      ...copy,
      run: async () => {
        if (action === 'start') await run(() => api.roundTransition(round.id, 'live', { today: today() }), done);
        // A match round ignores the override (every match must be decided — the route refuses `matches_undecided`); a stroke round finalizes as it stands.
        else if (action === 'complete') await run(() => api.roundTransition(round.id, 'completed', { override: !matchPlay }), done);
        else if (action === 'cancel') await run(() => api.roundTransition(round.id, 'cancelled'), done);
        else await run(() => api.deleteRound(round.id), done);
      },
    });
  };

  const step = viewer.can_manage ? nextOrganizerStep(event, view.rounds) : null;
  const organizerControls = viewer.can_manage && event.status !== 'completed' && event.status !== 'cancelled' ? (
    <div className="mt-4 flex flex-wrap gap-2" data-event-organizer-controls="">
      {step?.kind === 'publish' && (
        <button type="button" disabled={busy} onClick={() => run(() => api.transition('open'), 'Published.')} className={PRIMARY} data-event-action="open">Publish</button>
      )}
      {step?.kind === 'start' && (
        <button type="button" disabled={busy} onClick={() => roundAction(step.round as RoundView, 'start')} className={PRIMARY} data-event-action="live" data-event-round-action={step.round.id}>
          {many ? `Start round ${step.round.sequence}` : 'Go live'}
        </button>
      )}
      {step?.kind === 'complete' && (
        <button type="button" disabled={busy} onClick={() => roundAction(step.round as RoundView, 'complete')} className={PRIMARY} data-event-action="completed" data-event-round-action={step.round.id}>
          {many ? `Complete round ${step.round.sequence}` : 'Complete'}
        </button>
      )}
      {(event.status === 'draft' || event.status === 'open') && (
        <button type="button" disabled={busy} onClick={() => setConfirm({ title: 'Cancel this event?', message: 'Players are no longer expected. This cannot be undone.', confirmText: 'Cancel event', danger: true, run: async () => { await run(() => api.transition('cancelled')); } })} className={SECONDARY} data-event-action="cancelled">Cancel event</button>
      )}
    </div>
  ) : null;

  const excludeIds = new Set(view.participants.filter(p => p.status !== 'declined' && p.status !== 'withdrawn' && p.status !== 'removed').map(p => p.profile_id));

  return (
    <div className="space-y-4" data-event-place="">
      <EventHeader view={view} hostName={host?.name ?? 'the host'} control={control} busy={busy} actions={joinActions} organizerControls={organizerControls} todayKey={today()} />
      {(error || notice) && (
        <p role="status" className={`text-sm rounded-lg px-3 py-2 ${error ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'}`} data-event-notice="">
          {error ?? notice}
        </p>
      )}
      <section className="bg-surface rounded-lg border border-border">
        <EventTabs tabs={tabsFor(tabViewer)} active={visibleTab} onChange={changeTab} />
        <div id={`event-panel-${visibleTab}`} role="tabpanel" aria-labelledby={`event-tab-${visibleTab}`} className="p-4 sm:p-6">
          {visibleTab === 'overview' && <EventOverview view={view} busy={busy} onRotateLink={async () => { await run(() => api.rotateLink(), 'New link ready.'); }} onOpenFormat={() => setFormatOpen(true)} onOpenCountsToward={() => setCountsTowardOpen(true)} />}
          {visibleTab === 'schedule' && <EventSchedule view={view} busy={busy} onRoundAction={roundAction} onAddRound={() => setRoundEdit({ mode: 'add' })} />}
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
              onOpenFlights={() => setFlightsOpen(true)}
              onWaitlistMove={(target, position) => run(() => api.participantPatch(target, { waitlist_position: position }))}
              api={api}
            />
          )}
          {visibleTab === 'groups' && viewer.can_manage && <EventGroupsEditor view={view} api={api} selected={selectedRound} onSelect={changeRound} onSaved={v => { setView(v); setVersion(x => x + 1); }} />}
          {visibleTab === 'leaderboard' && <EventLeaderboard view={view} api={api} version={version} selected={selectedRound} onSelect={changeRound} />}
          {visibleTab === 'matches' && (
            <EventMatchesTab
              view={view}
              api={api}
              version={version}
              selected={selectedRound}
              onSelect={changeRound}
              onChanged={() => setVersion(v => v + 1)}
              onCompleteRound={async round => {
                const done = many && view.rounds.some(r => r.status === 'scheduled' && r.id !== round.id) ? `Round ${round.sequence} is final.` : 'Results are in.';
                await run(() => api.roundTransition(round.id, 'completed', {}), done);
              }}
            />
          )}
          {visibleTab === 'scorecard' && (
            <EventScorecardTab
              view={view}
              api={api}
              version={version}
              selected={selectedRound}
              onSelect={changeRound}
              onChanged={() => setVersion(v => v + 1)}
              onCompleteRound={async round => {
                const done = many && view.rounds.some(r => r.status === 'scheduled' && r.id !== round.id) ? `Round ${round.sequence} is final.` : 'Results are in.';
                await run(() => api.roundTransition(round.id, 'completed', { override: !matchPlay }), done);
              }}
            />
          )}
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
      {formatOpen && (
        <FormatSettingsWindow
          event={view.event}
          rounds={view.rounds}
          onClose={() => setFormatOpen(false)}
          onSave={async format_config => {
            const res = await api.patchEvent({ format_config });
            if (res.ok) { setNotice('Format saved.'); await refetch(); }
            return { ok: res.ok, error: res.error };
          }}
        />
      )}
      {countsTowardOpen && (
        <CountsTowardWindow
          view={view}
          onClose={() => setCountsTowardOpen(false)}
          onSave={async competitionId => {
            const res = await api.setContest(competitionId);
            if (res.ok) { setNotice(competitionId ? 'The event counts toward the competition.' : 'The event no longer counts toward a competition.'); await refetch(); }
            return { ok: res.ok, error: res.error };
          }}
        />
      )}
      {flightsOpen && (
        <FlightsWindow
          players={view.participants.filter(p => p.status === 'accepted' && p.playing && p.role !== 'follower')}
          onClose={() => setFlightsOpen(false)}
          onSave={async assignments => {
            const res = await api.saveFlights(assignments);
            if (res.ok) { setNotice('Flights saved.'); await refetch(); }
            return { ok: res.ok, error: res.error };
          }}
        />
      )}
      {roundEdit && (
        <RoundEditWindow
          round={roundEdit.mode === 'edit' ? roundEdit.round : null}
          nextSequence={nextSequence(view.rounds)}
          onClose={() => setRoundEdit(null)}
          onSave={async body => {
            const res = roundEdit.mode === 'edit' ? await api.updateRound(roundEdit.round.id, body) : await api.addRound(body);
            if (res.ok) { setNotice(roundEdit.mode === 'edit' ? 'Round saved.' : 'Round added.'); await refetch(); }
            return { ok: res.ok, error: res.error };
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
    </div>
  );
}
