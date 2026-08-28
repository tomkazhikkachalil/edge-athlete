import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildNudgeBatches, nudgeTitle } from '../guardian-nudge';

describe('buildNudgeBatches', () => {
  it('empty in → empty out', () => {
    expect(buildNudgeBatches([], [])).toEqual([]);
  });

  it('groups posts and comments per child, preserving encounter order', () => {
    const batches = buildNudgeBatches(
      [
        { id: 'p1', profile_id: 'a' },
        { id: 'p2', profile_id: 'b' },
        { id: 'p3', profile_id: 'a' },
      ],
      [{ id: 'c1', profile_id: 'b' }]
    );
    expect(batches).toEqual([
      { profileId: 'a', postIds: ['p1', 'p3'], commentIds: [] },
      { profileId: 'b', postIds: ['p2'], commentIds: ['c1'] },
    ]);
  });

  it('a child with only comments still gets a batch', () => {
    expect(buildNudgeBatches([], [{ id: 'c1', profile_id: 'a' }])).toEqual([
      { profileId: 'a', postIds: [], commentIds: ['c1'] },
    ]);
  });
});

describe('nudgeTitle', () => {
  it('singular post', () => {
    expect(nudgeTitle('Maya', 1, 0)).toBe(
      "Maya's post has been waiting 2 days for your review"
    );
  });
  it('singular comment', () => {
    expect(nudgeTitle('Maya', 0, 1)).toBe(
      "Maya's comment has been waiting 2 days for your review"
    );
  });
  it('plural aggregates across kinds', () => {
    expect(nudgeTitle('Maya', 2, 1)).toBe(
      '3 items from Maya are still waiting for your review'
    );
  });
});

describe('never auto-publish (source tripwire)', () => {
  it('the nudge module writes no status anywhere', () => {
    // The locked decision is "nudge, never auto-publish". The sweep's only
    // writes are the approval_nudged_at stamps — any update payload touching
    // `status` in this module is a safety regression, whatever it intends.
    const src = readFileSync(join(__dirname, '..', 'guardian-nudge.ts'), 'utf8');
    expect(src).not.toMatch(/update\(\s*\{[\s\S]{0,200}?status/);
    expect(src).toMatch(/approval_nudged_at/);
  });
});
