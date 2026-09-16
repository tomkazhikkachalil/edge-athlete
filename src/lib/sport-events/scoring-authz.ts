/**
 * Who may write a hole score on an event round, and how (Events program,
 * phase 1) — pure. `scoring-authz-server.ts` resolves the rows and calls
 * `scoringRight`; the two score routes (api/golf/scorecards/[id]/scores and
 * api/golf/participant-scores) read the verdict and pick the client.
 *
 * Rights, from the spec: every participant enters their own card; a player
 * may enter for a PARTNER IN THE SAME GROUP (the partner confirms at submit);
 * the organizer edits any card and marks it final. The round's creator (the
 * organizer who minted it) keeps the shared-round creator right.
 *
 * Card status gates (204):
 *   in_progress  owner, creator, same-group partner, organizer / co-organizer
 *   submitted    owner (the write REOPENS the card) and organizers — a
 *                partner may no longer touch it
 *   final        organizers only
 *
 * Phase 4 (214) — RECORDERS: a named recorder (`recorder` on the viewer's
 * event row) writes any card on the admin client, `via: 'recorder'`, on an
 * in-progress or submitted card (never a final one). When the event has
 * `self_entry: false` the owner's own write and a partner's are refused
 * (403 `recorder_only`) — the recorder or an organizer enters for everyone.
 *
 * Client: RLS admits the participant and the round's creator (mig 200); a
 * group-mate or a co-organizer is authorised HERE and writes on the admin
 * client — the gate IS the authorization (the acting-as precedent). The
 * session client stays for self / creator writes so RLS remains the second
 * lock where it can be.
 *
 * Conflicts live PER HOLE since phase 2b (mig 209 `golf_hole_scores.
 * version`): `src/lib/golf/hole-writes.ts` is the pure verdict and
 * `hole-scores-server.ts` the compare-and-set. The card-stamp guard that
 * lived here (`detectConflict` on the card's updated_at — bumped by the
 * 039 totals trigger on every hole write by anyone, so group-mates
 * false-conflicted) is gone.
 */
import type { SportEventRole } from './types';

export type CardStatus = 'in_progress' | 'submitted' | 'final';

export interface ScoringRightInput {
  viewerId: string;
  /** The profile that owns the card being written. */
  ownerProfileId: string;
  /** The round's group_posts.creator_id. */
  roundCreatorId: string;
  /** The viewer's event role, when the round is an event round. */
  eventRole: SportEventRole | 'viewer' | null;
  /** The viewer and the owner share a playing group on this round. */
  sameGroup: boolean;
  card: { status: CardStatus };
  /** Phase 4: the viewer is a named recorder on the event. */
  recorder?: boolean;
  /** Phase 4: players enter their own (the event's `self_entry`); false = recorders / organizers only. */
  selfEntry?: boolean;
}

export type ScoringVia = 'self' | 'creator' | 'groupmate' | 'organizer' | 'recorder';

export type ScoringRight =
  | { allowed: true; via: ScoringVia; client: 'session' | 'admin'; reopens: boolean }
  | { allowed: false; status: 403 | 409; error: string; reason?: 'recorder_only' };

export function scoringRight(i: ScoringRightInput): ScoringRight {
  const isSelf = i.viewerId === i.ownerProfileId;
  const isCreator = i.viewerId === i.roundCreatorId;
  const isOrganizer = i.eventRole === 'organizer' || i.eventRole === 'co_organizer';
  const isRecorder = i.recorder === true;
  const selfEntry = i.selfEntry !== false;
  const RECORDER_ONLY = { allowed: false as const, status: 403 as const, error: 'A recorder enters the scores for this event.', reason: 'recorder_only' as const };

  if (i.card.status === 'final') {
    if (isOrganizer) return { allowed: true, via: 'organizer', client: isCreator ? 'session' : 'admin', reopens: false };
    return { allowed: false, status: 409, error: 'This card is final. Ask the organizer to reopen it.' };
  }
  if (i.card.status === 'submitted') {
    if (isSelf && selfEntry) return { allowed: true, via: 'self', client: 'session', reopens: true };
    if (isOrganizer) return { allowed: true, via: 'organizer', client: isCreator ? 'session' : 'admin', reopens: false };
    if (isCreator) return { allowed: true, via: 'creator', client: 'session', reopens: false };
    if (isRecorder) return { allowed: true, via: 'recorder', client: 'admin', reopens: false };
    if (isSelf) return RECORDER_ONLY;
    return { allowed: false, status: 409, error: 'This card has been submitted by its player.' };
  }
  if (isSelf && selfEntry) return { allowed: true, via: 'self', client: 'session', reopens: false };
  if (isCreator) return { allowed: true, via: 'creator', client: 'session', reopens: false };
  if (isOrganizer) return { allowed: true, via: 'organizer', client: 'admin', reopens: false };
  if (isRecorder) return { allowed: true, via: 'recorder', client: 'admin', reopens: false };
  if (!selfEntry) return RECORDER_ONLY;
  if (i.sameGroup) return { allowed: true, via: 'groupmate', client: 'admin', reopens: false };
  return { allowed: false, status: 403, error: 'Only the player, a partner in their group, or an organizer can enter these scores.' };
}

/** Holes of a card run from the starting hole for `holesPlayed` holes (a back nine is 10..18). */
export function holeNumberInRange(holeNumber: number, startingHole: number, holesPlayed: number): boolean {
  if (!Number.isInteger(holeNumber) || !Number.isInteger(startingHole) || !Number.isInteger(holesPlayed)) return false;
  return holeNumber >= startingHole && holeNumber < startingHole + holesPlayed && holeNumber >= 1 && holeNumber <= 18;
}

/**
 * The hole range a card accepts. An EVENT round knows its own start and
 * length (sport_event_rounds), so an off-catalog back nine — no hole data
 * to encode 10..18 — still validates; a plain shared round derives the
 * start from its hole data (src/lib/golf/holes.ts) and falls back to 1.
 */
export function holeRangeFor(input: { eventRound: { starting_hole: number; holes: number } | null; derivedStartingHole: number; holesPlayed: number | null | undefined }): { startingHole: number; holesPlayed: number } {
  if (input.eventRound) return { startingHole: input.eventRound.starting_hole, holesPlayed: input.eventRound.holes };
  const holes = typeof input.holesPlayed === 'number' && input.holesPlayed > 0 ? input.holesPlayed : 18;
  return { startingHole: input.derivedStartingHole, holesPlayed: holes };
}
