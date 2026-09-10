import { describe, expect, it } from 'vitest';
import { attachmentTargets, contestChipLabel } from '../contest-attachments';

describe('attachmentTargets', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const g = '33333333-3333-4333-8333-333333333333';

  it('collects well-formed round and group-post ids, de-duplicated, ignoring junk', () => {
    const t = attachmentTargets([
      { roundRef: { roundId: a, groupPostId: g } },
      { roundRef: { roundId: a, groupPostId: null } },
      { roundRef: { roundId: b } },
      { roundRef: { roundId: 'not-a-uuid', groupPostId: 42 } },
      { gross: 40 },
      null,
      undefined,
    ]);
    expect(t.roundIds).toEqual([a, b]);
    expect(t.groupPostIds).toEqual([g]);
  });

  it('is empty for no results', () => {
    expect(attachmentTargets([])).toEqual({ roundIds: [], groupPostIds: [] });
  });
});

describe('contestChipLabel', () => {
  it('joins the competition and the round, or names the competition alone', () => {
    expect(contestChipLabel({ competition_name: 'House League', round: 'Week 1' })).toBe('House League · Week 1');
    expect(contestChipLabel({ competition_name: 'House League', round: '  ' })).toBe('House League');
    expect(contestChipLabel({ competition_name: 'House League', round: null })).toBe('House League');
  });
});
