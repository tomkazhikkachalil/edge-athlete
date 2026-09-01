import { describe, expect, it } from 'vitest';
import { isWindowOpen } from '@/lib/registration/validate';
import {
  ageBandCap,
  ageOnDec31,
  eligibilityWarnings,
  streamGender,
} from '../eligibility';
import { applicableWindow, registrationCollision } from '../registration-server';
import type { RosterEdge } from '../members';

describe('eligibility — warn, never block', () => {
  it('ageBandCap parses the U-vocab and refuses free text', () => {
    expect(ageBandCap('U13')).toBe(13);
    expect(ageBandCap('u7')).toBe(7);
    expect(ageBandCap('Senior')).toBeNull();
    expect(ageBandCap('13 and under')).toBeNull();
    expect(ageBandCap(null)).toBeNull();
  });

  it('streamGender maps the vocab and leaves mixed/unknown unchecked', () => {
    expect(streamGender('Girls')).toBe('female');
    expect(streamGender('boys')).toBe('male');
    expect(streamGender('Mixed')).toBeNull();
    expect(streamGender(null)).toBeNull();
  });

  it('age is whole years on Dec 31 of the season start year', () => {
    expect(ageOnDec31('2014-06-15', 2026)).toBe(12);
    expect(ageOnDec31('2013-12-31', 2026)).toBe(13);
  });

  it('flags over-age, unknown DOB, and gender mismatch — nothing else', () => {
    const division = { age_band: 'U13', gender_stream: 'Girls' };
    const season = '2026-09-01';
    expect(
      eligibilityWarnings({
        division,
        athlete: { birthday: '2014-06-15', gender: 'female' },
        seasonStartsOn: season,
      })
    ).toEqual([]);
    expect(
      eligibilityWarnings({
        division,
        athlete: { birthday: '2012-01-01', gender: 'female' },
        seasonStartsOn: season,
      }).map(w => w.kind)
    ).toEqual(['age_over']);
    expect(
      eligibilityWarnings({
        division,
        athlete: { birthday: null, gender: 'male' },
        seasonStartsOn: season,
      }).map(w => w.kind)
    ).toEqual(['age_unknown', 'gender_mismatch']);
    // custom gender is never checked; programs (division null) check nothing.
    expect(
      eligibilityWarnings({
        division,
        athlete: { birthday: '2014-06-15', gender: 'custom' },
        seasonStartsOn: season,
      })
    ).toEqual([]);
    expect(
      eligibilityWarnings({
        division: null,
        athlete: { birthday: null, gender: null },
        seasonStartsOn: season,
      })
    ).toEqual([]);
  });
});

describe('isWindowOpen — the one viewer-independent predicate', () => {
  const now = '2026-09-01T12:00:00.000Z';
  it('open between opens_at and closes_at; closes_at null = open-ended', () => {
    expect(isWindowOpen({ opens_at: '2026-08-01T00:00:00Z', closes_at: null }, now)).toBe(true);
    expect(
      isWindowOpen({ opens_at: '2026-08-01T00:00:00Z', closes_at: '2026-10-01T00:00:00Z' }, now)
    ).toBe(true);
  });
  it('closed before it opens and at/after it closes', () => {
    expect(isWindowOpen({ opens_at: '2026-10-01T00:00:00Z', closes_at: null }, now)).toBe(false);
    expect(
      isWindowOpen({ opens_at: '2026-08-01T00:00:00Z', closes_at: '2026-09-01T12:00:00.000Z' }, now)
    ).toBe(false);
  });
});

describe('applicableWindow — offering-specific beats season-wide', () => {
  const seasonWide = {
    id: 'w1', season_id: 's1', division_id: null, program_id: null,
    opens_at: '2026-08-01T00:00:00Z', closes_at: null, capacity: null,
  };
  const divisionWindow = { ...seasonWide, id: 'w2', division_id: 'd1' };
  it('prefers the offering window, falls back to season-wide, else null', () => {
    expect(applicableWindow([seasonWide, divisionWindow], { divisionId: 'd1' })?.id).toBe('w2');
    expect(applicableWindow([seasonWide, divisionWindow], { divisionId: 'd9' })?.id).toBe('w1');
    expect(applicableWindow([divisionWindow], { divisionId: 'd9' })).toBeNull();
    expect(applicableWindow([], { programId: 'p1' })).toBeNull();
  });
});

describe('registrationCollision — invite-wins (Tom, Sep 1)', () => {
  const edge = (status: RosterEdge['status'], seasonId: string | null): RosterEdge => ({
    status,
    seasonId,
  });
  it('a season edge of ANY status blocks re-registration for that season', () => {
    for (const status of ['registered', 'evaluating', 'placed', 'released'] as const) {
      expect(registrationCollision([edge(status, 's1')], 's1')).toBe('already_this_season');
    }
  });
  it('a NULL-season pending invite must be answered first', () => {
    expect(registrationCollision([edge('pending', null)], 's1')).toBe('pending_invite');
  });
  it('legacy active membership coexists; other seasons do not collide', () => {
    expect(registrationCollision([edge('active', null)], 's1')).toBe('ok');
    expect(registrationCollision([edge('placed', 's0')], 's1')).toBe('ok');
    expect(registrationCollision([], 's1')).toBe('ok');
  });
});
