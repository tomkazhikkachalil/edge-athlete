import { describe, it, expect } from 'vitest';
import {
  canViewSharedRound,
  classifyScoreEvent,
  UNKNOWN_EVENT_REFRESH_WINDOW_MS,
} from '@/lib/golf/round-access';

const CREATOR = 'creator-1';
const STRANGER = 'stranger-1';
const PLAYER = 'player-1';

const round = (visibility: string, participants: string[] = [PLAYER]) => ({
  creatorId: CREATOR,
  visibility,
  participantProfileIds: participants,
});

describe('canViewSharedRound', () => {
  // These cases mirror the group_posts RLS policy (035) and the
  // can_view_group_post helper (063): creator OR public OR participant.
  it('creator sees their own private round', () => {
    expect(canViewSharedRound({ viewerId: CREATOR, ...round('private') })).toBe(true);
  });

  it('any signed-in stranger sees a public round', () => {
    expect(canViewSharedRound({ viewerId: STRANGER, ...round('public') })).toBe(true);
  });

  it('stranger denied private and participants_only rounds', () => {
    expect(canViewSharedRound({ viewerId: STRANGER, ...round('private') })).toBe(false);
    expect(canViewSharedRound({ viewerId: STRANGER, ...round('participants_only') })).toBe(false);
  });

  it('participant sees non-public rounds regardless of status (pending included)', () => {
    // participantProfileIds includes ALL statuses by contract — the RLS
    // helper does not filter by status either.
    expect(canViewSharedRound({ viewerId: PLAYER, ...round('private') })).toBe(true);
    expect(canViewSharedRound({ viewerId: PLAYER, ...round('participants_only') })).toBe(true);
  });

  it('anonymous viewer denied everything, including public', () => {
    expect(canViewSharedRound({ viewerId: null, ...round('public') })).toBe(false);
    expect(canViewSharedRound({ viewerId: null, ...round('private') })).toBe(false);
  });

  it('null/missing metadata denies rather than throws', () => {
    expect(
      canViewSharedRound({
        viewerId: STRANGER,
        creatorId: null,
        visibility: null,
        participantProfileIds: [],
      })
    ).toBe(false);
  });
});

describe('classifyScoreEvent', () => {
  const ids = new Set(['p1', 'p2']);
  const T0 = 1_000_000;

  it('known participant id → refresh', () => {
    expect(classifyScoreEvent(ids, 'p1', 0, T0)).toBe('refresh');
  });

  it('unknown id outside the throttle window → refresh-unknown (stale roster)', () => {
    expect(classifyScoreEvent(ids, 'px', 0, T0)).toBe('refresh-unknown');
    expect(classifyScoreEvent(new Set(), 'px', 0, T0)).toBe('refresh-unknown');
  });

  it('unknown id inside the throttle window → ignore (cross-round noise cap)', () => {
    const last = T0 - UNKNOWN_EVENT_REFRESH_WINDOW_MS + 1;
    expect(classifyScoreEvent(ids, 'px', last, T0)).toBe('ignore');
  });

  it('window boundary is inclusive of exactly the window', () => {
    const last = T0 - UNKNOWN_EVENT_REFRESH_WINDOW_MS;
    expect(classifyScoreEvent(ids, 'px', last, T0)).toBe('refresh-unknown');
  });

  it('missing participant id → ignore', () => {
    expect(classifyScoreEvent(ids, null, 0, T0)).toBe('ignore');
    expect(classifyScoreEvent(ids, undefined, 0, T0)).toBe('ignore');
  });
});
