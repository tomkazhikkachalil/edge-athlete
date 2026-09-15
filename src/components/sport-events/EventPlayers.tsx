'use client';

import { useState } from 'react';
import Link from 'next/link';
import LazyImage from '@/components/LazyImage';
import type { ParticipantView, SportEventViewPayload } from '@/lib/sport-events/view';
import type { JoinControl } from '@/lib/sport-events/join-state';
import EventJoinButton from './EventJoinButton';

interface Props {
  view: SportEventViewPayload;
  control: JoinControl;
  busy: boolean;
  joinActions: Omit<React.ComponentProps<typeof EventJoinButton>, 'control' | 'busy'>;
  onOpenInvite: () => void;
  onInviteHandle: (handle: string) => Promise<void>;
  onDecide: (pid: string, action: 'approve' | 'reject' | 'remove') => void;
  onHideToggle: (pid: string, hidden: boolean) => void;
  onIndexOverride: (pid: string, index: number | null) => void;
  /** Phase 2: the organizer's Flights window. */
  onOpenFlights?: () => void;
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

export default function EventPlayers({ view, control, busy, joinActions, onOpenInvite, onInviteHandle, onDecide, onHideToggle, onIndexOverride, onOpenFlights }: Props) {
  const { event, participants, viewer } = view;
  const canManage = viewer.can_manage;
  const canInvite = canManage && (event.status === 'draft' || event.status === 'open');
  const [handle, setHandle] = useState('');
  const net = event.format === 'stroke_net';

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
            {p.handle ? <Link href={`/u/${p.handle}`} className="hover:text-brand-fg">{p.name}</Link> : p.name}
            {self && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
          </p>
          <p className="text-xs text-muted truncate">
            {roleLabel(p) ?? (p.handle ? `@${p.handle}` : '')}
            {net && p.status === 'accepted' && p.playing && (p.handicap_index !== null ? ` · index ${p.handicap_index}` : ' · no index')}
            {p.flight && p.status === 'accepted' && p.playing && <span data-event-player-flight={p.flight}> · Flight {p.flight}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">{extra}</div>
      </li>
    );
  };

  const organizerRowActions = (p: ParticipantView) => {
    if (!canManage || p.role === 'organizer') return null;
    if (event.status === 'completed' || event.status === 'cancelled') return null;
    return (
      <>
        {net && p.status === 'accepted' && p.playing && <IndexField p={p} onChange={i => onIndexOverride(p.id, i)} />}
        <button type="button" onClick={() => onDecide(p.id, 'remove')} disabled={busy} className={BTN} aria-label={`Remove ${p.name}`}>Remove</button>
      </>
    );
  };

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
        {playing.map(p => row(p, <>{selfToggle(p)}{organizerRowActions(p)}</>))}
      </Section>
      {organizing.length > 0 && <Section title="Organizing">{organizing.map(p => row(p, organizerRowActions(p)))}</Section>}
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
      {waitlisted.length > 0 && <Section title={`Waitlist (${waitlisted.length})`}>{waitlisted.map(p => row(p, <><span className="text-xs text-muted">#{p.waitlist_position}</span>{organizerRowActions(p)}</>))}</Section>}
      {followers.length > 0 && <Section title={`Following (${followers.length})`}>{followers.map(p => row(p))}</Section>}
      {canManage && gone.length > 0 && <Section title="Not playing">{gone.map(p => row(p, <span className="text-xs text-muted capitalize">{p.status}</span>))}</Section>}
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
