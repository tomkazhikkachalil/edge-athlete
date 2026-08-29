import { describe, it, expect } from 'vitest';
import {
  ageBand,
  agePresetChanges,
  deviationFields,
  effectivePresets,
  parseHouseholdPolicy,
  RESTRICTIVE_PRESETS,
} from '../household-policy';
import { isUnderThreshold } from '../config/minors-config';

describe('parseHouseholdPolicy', () => {
  it('null/garbage/arrays → null (not adopted)', () => {
    for (const raw of [null, undefined, 'x', 42, [], [1]]) {
      expect(parseHouseholdPolicy(raw)).toBeNull();
    }
  });

  it('empty object → restrictive defaults, older + child null', () => {
    expect(parseHouseholdPolicy({})).toEqual({
      defaults: RESTRICTIVE_PRESETS,
      olderDefaults: null,
      childDefaults: null,
    });
  });

  it('unknown keys and bad enum values drop; valid fields survive; defaults back-fill', () => {
    const parsed = parseHouseholdPolicy({
      defaults: { visibility: 'public', messaging_permission: 'EVERYONE', hax: true },
      olderDefaults: { comment_moderation: 'instant', visibility: 'sorta' },
      extra: 1,
    });
    expect(parsed).toEqual({
      defaults: {
        visibility: 'public',
        messaging_permission: 'nobody', // bad value dropped → back-filled
        comment_moderation: 'held',
      },
      olderDefaults: { comment_moderation: 'instant' }, // bad visibility dropped
      childDefaults: null,
    });
  });

  it('olderDefaults {} or all-invalid normalizes to null', () => {
    expect(parseHouseholdPolicy({ olderDefaults: {} })?.olderDefaults).toBeNull();
    expect(parseHouseholdPolicy({ olderDefaults: { visibility: 'nope' } })?.olderDefaults).toBeNull();
  });

  it('childDefaults (Wave 8) parse with the same sparse/null semantics', () => {
    expect(
      parseHouseholdPolicy({ childDefaults: { messaging_permission: 'nobody', bogus: 1 } })?.childDefaults
    ).toEqual({ messaging_permission: 'nobody' });
    expect(parseHouseholdPolicy({ childDefaults: {} })?.childDefaults).toBeNull();
    // Pre-Wave-8 stored policies (no key at all) parse unchanged.
    expect(parseHouseholdPolicy({ defaults: {} })?.childDefaults).toBeNull();
  });
});

describe('ageBand — 4-step ladder (Wave 8), threshold boundary still the sweep predicate', () => {
  const cases: Array<[string, string, string, 'child' | 'younger' | 'older' | 'adult']> = [
    ['2015-06-01', 'US', '2026-08-28', 'child'],   // 11 — under-13 band everywhere
    ['2013-06-01', 'US', '2026-08-28', 'older'],   // 13 in a threshold-13 jurisdiction: over already
    ['2013-06-01', 'DE', '2026-08-28', 'younger'], // 13 in a 16 jurisdiction
    ['2012-06-01', 'US', '2026-08-28', 'older'],   // 14 in a 13 jurisdiction
    ['2012-06-01', 'DE', '2026-08-28', 'younger'], // 14 in a 16 jurisdiction
    ['2012-06-01', 'CA-QC', '2026-08-28', 'older'], // 14 in a 14 jurisdiction
    ['2008-06-01', 'US', '2026-08-28', 'adult'],   // 18 — handover band
  ];
  it('bands cover the ladder across jurisdictions', () => {
    for (const [dob, jur, asOf, expected] of cases) {
      expect(ageBand(dob, jur, asOf), `${dob} ${jur}`).toBe(expected);
    }
  });
  it('between the anchors, younger/older still agrees with isUnderThreshold exactly', () => {
    for (const [dob, jur, asOf] of cases) {
      const band = ageBand(dob, jur, asOf);
      if (band === 'younger' || band === 'older') {
        expect(band === 'younger').toBe(isUnderThreshold(dob, jur, asOf));
      }
    }
  });
});

describe('effectivePresets', () => {
  const policy = parseHouseholdPolicy({
    defaults: { messaging_permission: 'fans_only' },
    olderDefaults: { messaging_permission: 'everyone' },
  })!;
  it('younger = defaults; older = defaults merged with sparse overrides', () => {
    expect(effectivePresets(policy, 'younger').messaging_permission).toBe('fans_only');
    expect(effectivePresets(policy, 'older')).toEqual({
      visibility: 'private',
      messaging_permission: 'everyone',
      comment_moderation: 'held',
    });
  });
  it('older with no overrides configured = defaults', () => {
    const bare = parseHouseholdPolicy({ defaults: { messaging_permission: 'fans_only' } })!;
    expect(effectivePresets(bare, 'older').messaging_permission).toBe('fans_only');
  });
  it('Wave 8 cascade: child merges childDefaults; adult rides olderDefaults; younger stays base', () => {
    const full = parseHouseholdPolicy({
      defaults: { messaging_permission: 'fans_only' },
      childDefaults: { messaging_permission: 'nobody' },
      olderDefaults: { messaging_permission: 'everyone' },
    })!;
    expect(effectivePresets(full, 'child').messaging_permission).toBe('nobody');
    expect(effectivePresets(full, 'younger').messaging_permission).toBe('fans_only');
    expect(effectivePresets(full, 'older').messaging_permission).toBe('everyone');
    expect(effectivePresets(full, 'adult').messaging_permission).toBe('everyone');
    // No childDefaults configured → the child band is just the defaults.
    const noChild = parseHouseholdPolicy({ defaults: { messaging_permission: 'fans_only' } })!;
    expect(effectivePresets(noChild, 'child').messaging_permission).toBe('fans_only');
  });
});

describe('deviationFields', () => {
  const policy = parseHouseholdPolicy({ defaults: { messaging_permission: 'fans_only' } })!;
  const athlete = {
    visibility: 'private',
    messaging_permission: 'everyone',
    comment_moderation: null, // pre-095 client shape — compares as 'held'
    dob: '2015-06-01',
    jurisdiction: 'US',
  };
  it('null policy or null dob → []', () => {
    expect(deviationFields(athlete, null)).toEqual([]);
    expect(deviationFields({ ...athlete, dob: null }, policy)).toEqual([]);
  });
  it('flags only differing fields; null comment_moderation ≡ held', () => {
    expect(deviationFields(athlete, policy, '2026-08-28')).toEqual(['messaging_permission']);
  });
  it('band-aware: an older athlete compares against merged presets', () => {
    const older = parseHouseholdPolicy({
      defaults: { messaging_permission: 'fans_only' },
      olderDefaults: { messaging_permission: 'everyone' },
    })!;
    expect(
      deviationFields({ ...athlete, dob: '2010-01-01' }, older, '2026-08-28')
    ).toEqual([]); // 16yo US: merged preset says 'everyone' — matches
  });
});

describe('agePresetChanges', () => {
  const athlete = { visibility: 'private', messaging_permission: 'nobody', comment_moderation: 'held' };
  it('null policy or olderDefaults null → [] (never prompt)', () => {
    expect(agePresetChanges(athlete, null)).toEqual([]);
    expect(agePresetChanges(athlete, parseHouseholdPolicy({ defaults: {} })!)).toEqual([]);
  });
  it('proposes ONLY the fields olderDefaults names — never drags others to base', () => {
    const policy = parseHouseholdPolicy({
      defaults: { messaging_permission: 'fans_only' }, // differs from athlete but NOT proposed
      olderDefaults: { comment_moderation: 'instant' },
    })!;
    expect(agePresetChanges(athlete, policy)).toEqual([
      { field: 'comment_moderation', from: 'held', to: 'instant' },
    ]);
  });
  it('already-matching override → []', () => {
    const policy = parseHouseholdPolicy({ olderDefaults: { comment_moderation: 'held' } })!;
    expect(agePresetChanges(athlete, policy)).toEqual([]);
  });
});
