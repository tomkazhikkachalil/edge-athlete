'use client';

import { useState } from 'react';
import LazyImage from '@/components/LazyImage';
import type { ParticipantView, SportEventViewPayload } from '@/lib/sport-events/view';
import type { JoinControl } from '@/lib/sport-events/join-state';
import EventJoinButton from './EventJoinButton';
import EventPlayerSheet from './EventPlayerSheet';
import type { EventApi } from '@/lib/sport-events/client';

interface Props {
  view: SportEventViewPayload;
  control: JoinControl;
  busy: boolean;
  joinActions: Omit<React.ComponentProps<typeof EventJoinButton>, 'control' | 'busy'>;
  onOpenInvite: () => void;
  onInviteHandle: (handle: string) => Promise<void>;
  onDecide: (pid: string, action: 'approve' | 'reject' | 'remove' | 'promote') => void;
  /** Authority PR 2: the backup roles — the host names co-organizers and hands the event over; a co-organizer steps down. */
  onRoleAction?: (pid: string, action: 'make_co_organizer' | 'make_participant' | 'step_down' | 'make_host', name: string) => void;
  /** Phase 2: the organizer moves a waitlisted player to a 1-based place in the queue. */
  onWaitlistMove?: (pid: string, position: number) => void;
  onHideToggle: (pid: string, hidden: boolean) => void;
  onIndexOverride: (pid: string, index: number | null) => void;
  /** Phase 4: the organizer names (or un-names) a recorder — any accepted row, a follower included. */
  onRecorderToggle?: (pid: string, recorder: boolean) => void;
  /** Phase 2: the organizer's Flights window. */
  onOpenFlights?: () => void;
  /** Phase 4: the player sheet reads this event's line for the tapped player. */
  api?: EventApi;
}

const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

function Avatar({ p }: { p: ParticipantView }) {
  return p.avatar_url ? (
    <LazyImage src={p.avatar_url} alt="" width={40} height={40} className="w-10 h-10 rounded-full object-cover shrink-0" />
  ) : (
    <div className="w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong flex items-center justify-center font-bold shrink-0">{p.name[0]?.toUpperCase() ?? '?'}</div>
  );
}

function IndexField({ p, onChange }: { p: ParticipantView; onChange: (index: number | null) => void }) {
  const [value, setValue] = useState(p.handicap_index === null ? '' : String(p.handicap_index));
  const commit = () => {
    const t = value.trim();
    if (t === '') { if (p.handicap_index !== null) onChange(null); return; }
    const n = Number(t);
    if (Number.isFinite(n) && n !== p.handicap_index) onChange(Math.round(n * 10) / 10);
  };
  return (
    <label className="text-xs text-muted inline-flex items-center gap-1">
      Index
      <input
        type="number"
        step="0.1"
        min="-10"
        max="54"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-16 min-h-[36px] px-2 rounded-md border border-border-strong bg-surface text-primary text-sm"
        aria-label={`Handicap index for ${p.name}`}
      />
      {p.handicap_source === 'organizer' && <span className="text-[10px] uppercase tracking-wide text-brand-fg">set</span>}
    </label>
  );
}

export default function EventPlayers({ view, control, busy, joinActions, onOpenInvite, onInviteHandle, onDecide, onRoleAction, onHideToggle, onIndexOverride, onRecorderToggle, onOpenFlights, onWaitlistMove, api }: Props) {
  const [picked, setPicked] = useState<ParticipantView | null>(null);
  const { event, participants, viewer, counts } = view;
  const canManage = viewer.can_manage;
  const canInvite = canManage && (event.status === 'draft' || event.status === 'open');
  const [handle, setHandle] = useState('');
  const net = event.format === 'stroke_net' || event.format === 'stableford_net';

  const playing = participants.filter(p => p.status === 'accepted' && p.playing && p.role !== 'follower');
  const organizing = participants.filter(p => p.status === 'accepted' && !p.playing && p.role !== 'follower');
  const invited = participants.filter(p => p.status === 'invited');
  const requested = participants.filter(p => p.status === 'requested');
  const waitlisted = participants.filter(p => p.status === 'waitlisted').sort((a, b) => (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0));
  const gone = participants.filter(p => p.status === 'declined' || p.status === 'withdrawn' || p.status === 'removed');
  const followers = participants.filter(p => p.role === 'follower' && p.status === 'accepted');

  const roleLabel = (p: ParticipantView) => (p.role === 'organizer' ? 'Host' : p.role === 'co_organizer' ? 'Co-organizer' : null);

  const row = (p: ParticipantView, extra?: React.ReactNode) => {
    const self = p.profile_id === viewer.profile_id;
    return (
      <li key={p.id} className="flex items-center gap-3 py-2" data-event-player={p.profile_id} data-event-player-status={p.status}>
        <Avatar p={p} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary truncate">
            {/* Phase 4: a name opens the in-event sheet — the masked name and this event's line; the profile only when public (the sheet's rule). */}
            <button type="button" onClick={() => setPicked(p)} className="text-left hover:text-brand-fg min-h-[44px] -my-2" data-event-player-open={p.profile_id}>{p.name}</button>
            {self && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
          </p>
          <p className="text-xs text-muted truncate">
            {roleLabel(p) ?? (p.handle ? `@${p.handle}` : '')}
            {net && p.status === 'accepted' && p.playing && (p.handicap_index !== null ? ` · index ${p.handicap_index}` : ' · no index')}
            {p.flight && p.status === 'accepted' && p.playing && <span data-event-player-flight={p.flight}> · Flight {p.flight}</span>}
            {p.recorder && p.status === 'accepted' && <span data-event-player-recorder=""> · Recorder</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">{extra}</div>
      </li>
    );
  };

  const isHost = viewer.profile_id === event.host_profile_id;
  const organizerRowActions = (p: ParticipantView) => {
    if (!canManage || p.role === 'organizer') return null;
    if (event.status === 'cancelled') return null;
    // Authority PR 2: the host alone changes who can run the event.
    const roleButtons = isHost && onRoleAction && p.status === 'accepted' && !p.departed ? (
      p.role === 'co_organizer' ? (
        <>
          <button type="button" onClick={() => onRoleAction(p.id, 'make_host', p.name)} disabled={busy} className={BTN} data-event-role-action="make_host" aria-label={`Make ${p.name} the host`}>Make host</button>
          <button type="button" onClick={() => onRoleAction(p.id, 'make_participant', p.name)} disabled={busy} className={BTN} data-event-role-action="make_participant" aria-label={`Make ${p.name} a player`}>Make player</button>
        </>
      ) : (
        <button type="button" onClick={() => onRoleAction(p.id, 'make_co_organizer', p.name)} disabled={busy} className={BTN} data-event-role-action="make_co_organizer" aria-label={`Make ${p.name} a co-organizer`}>Make co-organizer</button>
      )
    ) : null;
    if (event.status === 'completed') return roleButtons;
    return (
      <>
        {roleButtons}
        {net && p.status === 'accepted' && p.playing && <IndexField p={p} onChange={i => onIndexOverride(p.id, i)} />}
        {onRecorderToggle && p.status === 'accepted' && (
          <label className="text-xs text-secondary inline-flex items-center gap-2 min-h-[44px]">
            <input type="checkbox" checked={p.recorder} onChange={e => onRecorderToggle(p.id, e.target.checked)} disabled={busy} className="h-4 w-4" data-event-recorder-toggle={p.profile_id} />
            Recorder
          </label>
        )}
        {(p.role !== 'co_organizer' || isHost) && (
          <button type="button" onClick={() => onDecide(p.id, 'remove')} disabled={busy} className={BTN} aria-label={`Remove ${p.name}`}>Remove</button>
        )}
      </>
    );
  };

  const stepDown = (p: ParticipantView) =>
    p.profile_id === viewer.profile_id && p.role === 'co_organizer' && p.status === 'accepted' && onRoleAction && event.status !== 'cancelled' ? (
      <button type="button" onClick={() => onRoleAction(p.id, 'step_down', p.name)} disabled={busy} className={BTN} data-event-role-action="step_down">Step down</button>
    ) : null;

  const selfToggle = (p: ParticipantView) =>
    p.profile_id === viewer.profile_id && p.playing && p.hide_from_profile !== null ? (
      <label className="text-xs text-secondary inline-flex items-center gap-2 min-h-[44px]">
        <input type="checkbox" checked={!p.hide_from_profile} onChange={e => onHideToggle(p.id, !e.target.checked)} disabled={busy} className="h-4 w-4" data-event-show-on-profile="" />
        Show on my profile
      </label>
    ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EventJoinButton control={control} busy={busy} {...joinActions} />
        <div className="flex flex-wrap gap-2">
          {canManage && onOpenFlights && playing.length > 0 && event.status !== 'completed' && event.status !== 'cancelled' && (
            <button type="button" onClick={onOpenFlights} className={BTN} data-event-flights-open="">
              <i className="fas fa-layer-group mr-2" aria-hidden="true"></i>Flights
            </button>
          )}
          {canInvite && (
            <button type="button" onClick={onOpenInvite} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center" data-event-invite-open="">
              <i className="fas fa-user-plus mr-2" aria-hidden="true"></i>Invite
            </button>
          )}
        </div>
      </div>
      {canInvite && (
        <form
          className="flex gap-2"
          onSubmit={async e => { e.preventDefault(); const h = handle.trim().replace(/^@/, ''); if (!h) return; await onInviteHandle(h); setHandle(''); }}
        >
          <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="Invite by @handle" aria-label="Invite by handle" autoComplete="off" className="flex-1 min-w-0 min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-base" data-event-invite-handle="" />
          <button type="submit" disabled={busy || !handle.trim()} className={BTN}>Invite</button>
        </form>
      )}

      <Section title={`Playing (${playing.length})`} empty="Nobody has accepted yet.">
        {playing.map(p => row(p, <>{selfToggle(p)}{stepDown(p)}{organizerRowActions(p)}</>))}
      </Section>
      {organizing.length > 0 && <Section title="Organizing">{organizing.map(p => row(p, <>{stepDown(p)}{organizerRowActions(p)}</>))}</Section>}
      {requested.length > 0 && (
        <Section title={`Requests (${requested.length})`}>
          {requested.map(p => row(p, canManage ? (
            <>
              <button type="button" onClick={() => onDecide(p.id, 'approve')} disabled={busy} className="ea-cta text-white px-3 min-h-[44px] rounded-lg text-sm font-semibold">Accept</button>
              <button type="button" onClick={() => onDecide(p.id, 'reject')} disabled={busy} className={BTN}>Decline</button>
            </>
          ) : null))}
        </Section>
      )}
      {invited.length > 0 && <Section title={`Invited (${invited.length})`}>{invited.map(p => row(p, organizerRowActions(p)))}</Section>}
      {waitlisted.length > 0 && (
        <Section title={`Waitlist (${counts.waitlisted})`}>
          {waitlisted.map((p, i) => row(p, (
            <>
              <span className="text-xs text-muted" data-waitlist-position={p.waitlist_position ?? ''}>#{p.waitlist_position}</span>
              {p.profile_id === viewer.profile_id && !canManage && viewer.waitlist_ahead !== null && (
                <span className="text-xs text-amber-700 dark:text-amber-300" data-waitlist-self="">{viewer.waitlist_ahead === 0 ? "You're next" : `${viewer.waitlist_ahead} ahead of you`}</span>
              )}
              {canManage && onWaitlistMove && event.status !== 'completed' && event.status !== 'cancelled' && (
                <>
                  <button type="button" onClick={() => onWaitlistMove(p.id, i)} disabled={busy || i === 0} className={`${BTN} min-h-[36px] text-xs`} aria-label={`Move ${p.name} up the waitlist`} data-waitlist-up={p.profile_id}>↑</button>
                  <button type="button" onClick={() => onWaitlistMove(p.id, i + 2)} disabled={busy || i === waitlisted.length - 1} className={`${BTN} min-h-[36px] text-xs`} aria-label={`Move ${p.name} down the waitlist`} data-waitlist-down={p.profile_id}>↓</button>
                  <button type="button" onClick={() => onDecide(p.id, 'promote')} disabled={busy} className="ea-cta text-white px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-waitlist-promote={p.profile_id}>Promote now</button>
                </>
              )}
              {organizerRowActions(p)}
            </>
          )))}
        </Section>
      )}
      {followers.length > 0 && <Section title={`Following (${followers.length})`}>{followers.map(p => row(p, organizerRowActions(p)))}</Section>}
      {canManage && gone.length > 0 && <Section title="Not playing">{gone.map(p => row(p, <span className="text-xs text-muted capitalize">{p.status}</span>))}</Section>}
      {picked && <EventPlayerSheet view={view} participant={picked} api={api ?? null} onClose={() => setPicked(null)} />}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode[] | React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <section>
      <h2 className="text-sm font-bold text-primary mb-1">{title}</h2>
      {items.length === 0 ? <p className="text-sm text-muted">{empty}</p> : <ul className="divide-y divide-border-subtle">{items}</ul>}
    </section>
  );
}
