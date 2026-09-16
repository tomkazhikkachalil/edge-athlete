/**
 * Joining a sport event — invite, request, accept, decline, approve, reject,
 * remove, withdraw, follow, unfollow — and the capacity / waitlist rules
 * (Events program, phase 1). Pure: `join-server.ts` reads the rows, calls
 * `planJoin`, writes the plan, sends the bells.
 *
 * Rules (Tom's spec, decision 3 + section 5):
 *   * Invite is ALWAYS available to organizers while the event is draft or
 *     open; `join_mode = 'request'` additionally opens the request door,
 *     while the event is open only.
 *   * Accepting on a full event lands the player on the waitlist with a
 *     position; any vacancy (decline, withdraw, remove, a capacity raise, an
 *     organizer stepping out of play) promotes the lowest position first.
 *   * Withdraw is the participant's own exit (open or live); removed is the
 *     organizer's. Both free a seat.
 *   * Followers never take a seat and never count.
 *   * A late accept while live is allowed (the server adds them to the
 *     round); a request while live is not.
 *   * Phase 4 (214): `join_mode = 'open'` opens the JOIN door — any signed-in
 *     person seats themselves with one tap while the event is open (a live
 *     event offers Follow: the roster is minted at go-live); a follower row
 *     converts; a removed row stays out; capacity waitlists as ever. Blocks
 *     are the route's business (a 409 that never says who blocked whom).
 *   * Phase 2 (waitlist polish): an organizer may PROMOTE a waitlisted
 *     player now — the field goes one over the capacity by the organizer's
 *     choice (later accepts still waitlist); positions are RE-PACKED
 *     1..n after every change (`repackWaitlist`, the one writer is
 *     join-server.ts writeWaitlistOrder) and an organizer may reorder
 *     (`moveWaitlistTo`); a waitlisted player sees how many are ahead
 *     (`aheadOf`) — a queue position is between the player and the
 *     organizer (view.ts hides others' waitlisted rows from the roster).
 */
import type { SportEventJoinMode, SportEventParticipantStatus, SportEventRole, SportEventStatus } from './types';

export type JoinAction = 'invite' | 'request' | 'join' | 'accept' | 'decline' | 'approve' | 'reject' | 'remove' | 'withdraw' | 'follow' | 'unfollow' | 'promote';

export interface ParticipantSnapshot {
  id: string;
  profileId: string;
  role: SportEventRole;
  status: SportEventParticipantStatus;
  playing: boolean;
  waitlistPosition: number | null;
  createdAt: string;
}

export interface JoinContext {
  event: { status: SportEventStatus; joinMode: SportEventJoinMode; capacity: number | null };
  /** The acting viewer's role on the event ('viewer' = not a participant). */
  actorRole: SportEventRole | 'viewer';
  /** The row the action targets (the actor's own for request / accept / decline / withdraw / follow; the target's for organizer actions). Null when none exists. */
  row: ParticipantSnapshot | null;
  /** Every row of the event (for capacity + promotion). */
  rows: ParticipantSnapshot[];
  /** Phase 2: the cut has been made — no new players (a late joiner would rank below it by the rule). */
  cutDecided?: boolean;
}

export type JoinPlan =
  | { ok: true; next: Partial<Pick<ParticipantSnapshot, 'role' | 'status' | 'playing' | 'waitlistPosition'>> & { accepted?: boolean; responded?: boolean }; create: boolean; promote: string[]; delete?: boolean }
  | { ok: false; status: 400 | 403 | 409; error: string };

const MANAGES = (r: SportEventRole | 'viewer') => r === 'organizer' || r === 'co_organizer';

/** Seats taken: accepted + playing (followers never count; organizers only when playing). */
export function seatsTaken(rows: ParticipantSnapshot[]): number {
  return rows.filter(r => r.status === 'accepted' && r.playing).length;
}

export function isFull(rows: ParticipantSnapshot[], capacity: number | null): boolean {
  return capacity !== null && seatsTaken(rows) >= capacity;
}

export function nextWaitlistPosition(rows: ParticipantSnapshot[]): number {
  return rows.reduce((max, r) => (r.waitlistPosition !== null && r.waitlistPosition > max ? r.waitlistPosition : max), 0) + 1;
}

/** Who gets a seat when `freeSeats` open up: lowest waitlist position first. */
export function planWaitlistPromotion(rows: ParticipantSnapshot[], capacity: number | null, freeSeatsOverride?: number): string[] {
  if (capacity === null) return rows.filter(r => r.status === 'waitlisted').sort(byPosition).map(r => r.id);
  const free = freeSeatsOverride ?? Math.max(0, capacity - seatsTaken(rows));
  if (free <= 0) return [];
  return rows.filter(r => r.status === 'waitlisted').sort(byPosition).slice(0, free).map(r => r.id);
}

const byPosition = (a: ParticipantSnapshot, b: ParticipantSnapshot) => (a.waitlistPosition ?? Infinity) - (b.waitlistPosition ?? Infinity) || a.createdAt.localeCompare(b.createdAt);

function seatOrWaitlist(ctx: JoinContext, rowsAfter: ParticipantSnapshot[]): Pick<ParticipantSnapshot, 'status' | 'waitlistPosition'> {
  return isFull(rowsAfter, ctx.event.capacity)
    ? { status: 'waitlisted', waitlistPosition: nextWaitlistPosition(ctx.rows) }
    : { status: 'accepted', waitlistPosition: null };
}

export function planJoin(action: JoinAction, ctx: JoinContext): JoinPlan {
  const { event, actorRole, row, rows } = ctx;
  const terminal = event.status === 'completed' || event.status === 'cancelled';
  if (terminal) return { ok: false, status: 409, error: 'This event is over.' };
  const others = row ? rows.filter(r => r.id !== row.id) : rows;

  switch (action) {
    case 'invite': {
      if (!MANAGES(actorRole)) return { ok: false, status: 403, error: 'Only an organizer can invite.' };
      if (event.status === 'live') return { ok: false, status: 409, error: 'The event is live — add players from the round.' };
      if (ctx.cutDecided) return { ok: false, status: 409, error: 'The cut has been made — no new players.' };
      // A follower may be invited to play; a player already in any live state may not be invited twice.
      if (row && row.role !== 'follower' && (row.status === 'accepted' || row.status === 'invited' || row.status === 'waitlisted' || row.status === 'requested')) return { ok: false, status: 409, error: 'Already invited.' };
      return { ok: true, create: !row, next: { role: row?.role === 'follower' ? 'participant' : row?.role ?? 'participant', status: 'invited', playing: true, waitlistPosition: null }, promote: [] };
    }
    case 'request': {
      if (event.status !== 'open') return { ok: false, status: 409, error: 'The event is not open for requests.' };
      if (event.joinMode !== 'request') return { ok: false, status: 403, error: 'This event is invite-only.' };
      if (row && (row.status === 'accepted' || row.status === 'waitlisted')) return { ok: false, status: 409, error: 'You are already in.' };
      if (row && row.status === 'requested') return { ok: false, status: 409, error: 'Already requested.' };
      if (row && row.status === 'invited') return planJoin('accept', ctx);
      if (row && row.status === 'removed') return { ok: false, status: 403, error: 'You were removed from this event.' };
      return { ok: true, create: !row, next: { role: 'participant', status: 'requested', playing: true, waitlistPosition: null, responded: true }, promote: [] };
    }
    case 'join': {
      if (event.status !== 'open') return { ok: false, status: 409, error: event.status === 'live' ? 'The event is live — follow it, or ask the organizer to add you.' : 'The event is not open to join.' };
      if (event.joinMode !== 'open') return { ok: false, status: 403, error: event.joinMode === 'request' ? 'This event takes requests — ask to join.' : 'This event is invite-only.' };
      if (row && (row.status === 'accepted' || row.status === 'waitlisted') && row.role !== 'follower') return { ok: false, status: 409, error: 'You are already in.' };
      if (row && row.status === 'invited') return planJoin('accept', ctx);
      if (row && row.status === 'requested') return { ok: false, status: 409, error: 'Already requested.' };
      if (row && row.status === 'removed') return { ok: false, status: 403, error: 'You were removed from this event.' };
      const seat = seatOrWaitlist(ctx, others);
      return { ok: true, create: !row, next: { role: 'participant', playing: true, ...seat, accepted: seat.status === 'accepted', responded: true }, promote: [] };
    }
    case 'accept': {
      if (!row || row.status !== 'invited') return { ok: false, status: 409, error: 'No invitation to accept.' };
      if (event.status !== 'open' && event.status !== 'live' && event.status !== 'draft') return { ok: false, status: 409, error: 'The event is not open.' };
      const seat = seatOrWaitlist(ctx, others);
      return { ok: true, create: false, next: { ...seat, accepted: seat.status === 'accepted', responded: true }, promote: [] };
    }
    case 'approve': {
      if (!MANAGES(actorRole)) return { ok: false, status: 403, error: 'Only an organizer can approve.' };
      if (!row || row.status !== 'requested') return { ok: false, status: 409, error: 'No request to approve.' };
      const seat = seatOrWaitlist(ctx, others);
      return { ok: true, create: false, next: { ...seat, accepted: seat.status === 'accepted' }, promote: [] };
    }
    case 'decline': {
      if (!row || (row.status !== 'invited' && row.status !== 'requested')) return { ok: false, status: 409, error: 'Nothing to decline.' };
      if (row.status === 'requested') return { ok: true, create: false, next: { status: 'withdrawn', waitlistPosition: null, responded: true }, promote: [] };
      return { ok: true, create: false, next: { status: 'declined', waitlistPosition: null, responded: true }, promote: [] };
    }
    case 'reject': {
      if (!MANAGES(actorRole)) return { ok: false, status: 403, error: 'Only an organizer can decide a request.' };
      if (!row || row.status !== 'requested') return { ok: false, status: 409, error: 'No request to decide.' };
      return { ok: true, create: false, next: { status: 'declined', waitlistPosition: null }, promote: [] };
    }
    case 'remove': {
      if (!MANAGES(actorRole)) return { ok: false, status: 403, error: 'Only an organizer can remove a player.' };
      if (!row) return { ok: false, status: 409, error: 'Not a participant.' };
      if (row.role === 'organizer') return { ok: false, status: 403, error: 'The organizer cannot be removed.' };
      const freed = row.status === 'accepted' && row.playing ? 1 : 0;
      return { ok: true, create: false, next: { status: 'removed', waitlistPosition: null }, promote: freed ? planWaitlistPromotion(others, event.capacity, freeSeats(others, event.capacity)) : [] };
    }
    case 'withdraw': {
      if (!row) return { ok: false, status: 409, error: 'Not a participant.' };
      if (row.status !== 'accepted' && row.status !== 'waitlisted' && row.status !== 'requested') return { ok: false, status: 409, error: 'Nothing to withdraw from.' };
      if (row.role === 'organizer') return { ok: false, status: 403, error: 'The organizer cannot withdraw — cancel or transfer the event.' };
      const freed = row.status === 'accepted' && row.playing ? 1 : 0;
      return { ok: true, create: false, next: { status: 'withdrawn', waitlistPosition: null, responded: true }, promote: freed ? planWaitlistPromotion(others, event.capacity, freeSeats(others, event.capacity)) : [] };
    }
    case 'promote': {
      if (!MANAGES(actorRole)) return { ok: false, status: 403, error: 'Only an organizer can promote a player.' };
      if (!row || row.status !== 'waitlisted') return { ok: false, status: 409, error: 'Not on the waitlist.' };
      // The organizer's call: seated now, capacity or not (a later accept still waitlists).
      return { ok: true, create: false, next: { status: 'accepted', waitlistPosition: null, accepted: true }, promote: [] };
    }
    case 'follow': {
      if (row && (row.status === 'accepted' || row.status === 'waitlisted' || row.status === 'invited' || row.status === 'requested')) return { ok: false, status: 409, error: 'You are already part of this event.' };
      if (row && row.role === 'follower' && row.status === 'accepted') return { ok: false, status: 409, error: 'Already following.' };
      return { ok: true, create: !row, next: { role: 'follower', status: 'accepted', playing: false, waitlistPosition: null }, promote: [] };
    }
    case 'unfollow': {
      if (!row || row.role !== 'follower') return { ok: false, status: 409, error: 'Not following.' };
      return { ok: true, create: false, delete: true, next: {}, promote: [] };
    }
    default:
      return { ok: false, status: 400, error: 'Unknown action.' };
  }
}

/** Seats free among `rows` (the actor's own row already excluded by the caller). */
export function freeSeats(rows: ParticipantSnapshot[], capacity: number | null): number {
  return capacity === null ? Number.POSITIVE_INFINITY : Math.max(0, capacity - seatsTaken(rows));
}

/** A capacity raise (or an organizer stepping out of play) promotes as many as the new room allows. */
export function planCapacityChange(rows: ParticipantSnapshot[], newCapacity: number | null): string[] {
  return planWaitlistPromotion(rows, newCapacity);
}

/** The waitlist packed 1..n in position order (then arrival) — the rows whose position changes. */
export function repackWaitlist(rows: ParticipantSnapshot[]): Array<{ id: string; waitlistPosition: number }> {
  return rows
    .filter(r => r.status === 'waitlisted')
    .sort(byPosition)
    .map((r, i) => ({ id: r.id, waitlistPosition: i + 1 }))
    .filter(u => rows.find(r => r.id === u.id)?.waitlistPosition !== u.waitlistPosition);
}

/** Move a waitlisted row to a 1-based position in the packed queue (clamped); the full packed order's changes. */
export function moveWaitlistTo(rows: ParticipantSnapshot[], id: string, position: number): Array<{ id: string; waitlistPosition: number }> {
  const queue = rows.filter(r => r.status === 'waitlisted').sort(byPosition);
  const at = queue.findIndex(r => r.id === id);
  if (at < 0) return [];
  const [moved] = queue.splice(at, 1);
  const to = Math.min(queue.length, Math.max(0, position - 1));
  queue.splice(to, 0, moved);
  return queue.map((r, i) => ({ id: r.id, waitlistPosition: i + 1 })).filter(u => rows.find(r => r.id === u.id)?.waitlistPosition !== u.waitlistPosition);
}

/** How many waitlisted players are ahead of this one; null when not waitlisted. */
export function aheadOf(rows: ParticipantSnapshot[], id: string): number | null {
  const own = rows.find(r => r.id === id);
  if (!own || own.status !== 'waitlisted') return null;
  return rows.filter(r => r.status === 'waitlisted' && r.id !== id && byPosition(r, own) < 0).length;
}
