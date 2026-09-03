import { describe, expect, it } from 'vitest';
import {
  closingMessage,
  closingTitle,
  confirmedTitle,
  countedTitle,
  ordinal,
  planWindowReminders,
} from '../golf-league-notify';

const ctx = { roundLabel: 'Week 2', competitionName: 'Thursday Nine' };

describe('golf league bell copy — self-contained titles (they are the digest)', () => {
  it('counted: holes, gross, net when present', () => {
    expect(countedTitle(ctx, { profileId: 'p', gross: 41, net: 36, holes: 9, roundId: 'r', changed: false })).toBe(
      'Your 9-hole 41 (net 36) counts for Week 2 in Thursday Nine'
    );
  });
  it('counted: gross-only and a re-count read differently', () => {
    expect(countedTitle(ctx, { profileId: 'p', gross: 45, net: null, holes: 9, roundId: 'r', changed: true })).toBe(
      'Your 9-hole 45 now counts for Week 2 in Thursday Nine'
    );
  });
  it('counted: an unlabeled round still reads', () => {
    expect(
      countedTitle({ roundLabel: null, competitionName: 'Thursday Nine' }, { profileId: 'p', gross: 80, net: null, holes: 18, roundId: null, changed: false })
    ).toBe('Your 18-hole 80 counts for this round in Thursday Nine');
  });
  it('confirmed: with and without a rank', () => {
    expect(confirmedTitle(ctx, { profileId: 'p', rank: 3, of: 12 })).toBe("Week 2 in Thursday Nine is final — you're 3rd of 12");
    expect(confirmedTitle(ctx, { profileId: 'p', rank: null, of: 12 })).toBe('Week 2 in Thursday Nine is final');
  });
  it('closing: title + course/date message', () => {
    expect(closingTitle(ctx)).toBe('Week 2 in Thursday Nine closes tomorrow — no round posted yet');
    expect(closingMessage('QA Nine', '2026-09-07')).toBe('Post a round at QA Nine by Sep 7.');
    expect(closingMessage(null, '2026-09-07')).toBe('Post a round by Sep 7.');
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th',
    ]);
  });
});

describe('planWindowReminders — once per member per round, only when nothing is posted', () => {
  const members = [
    { profileId: 'a', participantId: 'pa' },
    { profileId: 'b', participantId: 'pb' },
    { profileId: 'c', participantId: 'pc' },
  ];
  it('members without a result are candidates', () => {
    expect(planWindowReminders({ members, resultParticipantIds: new Set(), alreadyNotifiedProfileIds: new Set() })).toEqual(['a', 'b', 'c']);
  });
  it('a result on file skips the member', () => {
    expect(planWindowReminders({ members, resultParticipantIds: new Set(['pb']), alreadyNotifiedProfileIds: new Set() })).toEqual(['a', 'c']);
  });
  it('an existing nudge skips the member (a re-run never double-sends)', () => {
    expect(planWindowReminders({ members, resultParticipantIds: new Set(), alreadyNotifiedProfileIds: new Set(['a', 'c']) })).toEqual(['b']);
  });
  it('empty in, empty out; duplicate members collapse', () => {
    expect(planWindowReminders({ members: [], resultParticipantIds: new Set(), alreadyNotifiedProfileIds: new Set() })).toEqual([]);
    expect(
      planWindowReminders({ members: [members[0], members[0]], resultParticipantIds: new Set(), alreadyNotifiedProfileIds: new Set() })
    ).toEqual(['a']);
  });
});

// Phase 8 P5 — the manager's nudge has its own copy (the window is open, not
// closing) and shares the closing reminder's planner.
import { nudgeTitle } from '../golf-league-notify';

describe('nudgeTitle (P5)', () => {
  it('says the round is open — never "closes tomorrow"', () => {
    const ctx = { roundLabel: 'Week 3', competitionName: 'Thursday Nine' };
    expect(nudgeTitle(ctx)).toBe('Week 3 in Thursday Nine is open — post your round');
    expect(closingTitle(ctx)).toContain('closes tomorrow');
    expect(nudgeTitle(ctx)).not.toContain('closes tomorrow');
  });
});
