import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DELETE_REFUSALS, offersDelete, planResultDelete, type ResultDeleteFacts } from '../results/delete-rule';

const ROOT = path.resolve(__dirname, '../../..');
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const facts = (over: Partial<ResultDeleteFacts> = {}): ResultDeleteFacts => ({
  official: false,
  eventRound: false,
  finished: true,
  isCreator: true,
  othersPlayed: 0,
  ...over,
});

describe('may this result be deleted?', () => {
  it('a finished for-fun round nobody else played goes entirely', () => {
    expect(planResultDelete(facts())).toEqual({ action: 'delete_round' });
  });

  it('an official result is never deleted — whoever asks, finished or not', () => {
    for (const over of [{}, { finished: false }, { isCreator: false }, { othersPlayed: 3 }]) {
      expect(planResultDelete(facts({ official: true, ...over }))).toEqual({ action: 'refuse', reason: 'official' });
    }
  });

  it("an event round stays on the event's record, official or not", () => {
    expect(planResultDelete(facts({ eventRound: true }))).toEqual({ action: 'refuse', reason: 'event' });
    expect(planResultDelete(facts({ eventRound: true, finished: false }))).toEqual({ action: 'refuse', reason: 'event' });
  });

  it('an unfinished casual round is discarded whole by its creator — scored or not', () => {
    expect(planResultDelete(facts({ finished: false }))).toEqual({ action: 'discard_round' });
    expect(planResultDelete(facts({ finished: false, othersPlayed: 2 }))).toEqual({ action: 'discard_round' });
  });

  it('a playing partner cannot discard a round that is still being played', () => {
    expect(planResultDelete(facts({ finished: false, isCreator: false }))).toEqual({ action: 'refuse', reason: 'unfinished_not_creator' });
  });

  it("in a finished shared round a delete removes the requester's result only", () => {
    // The creator: their result and the round's post; partners keep theirs.
    expect(planResultDelete(facts({ othersPlayed: 1 }))).toEqual({ action: 'remove_own_result', removePost: true });
    // A partner: their result; the creator's post is not theirs to remove.
    expect(planResultDelete(facts({ isCreator: false, othersPlayed: 1 }))).toEqual({ action: 'remove_own_result', removePost: false });
    expect(planResultDelete(facts({ isCreator: false, othersPlayed: 0 }))).toEqual({ action: 'remove_own_result', removePost: false });
  });

  it('every refusal names the way out', () => {
    expect(DELETE_REFUSALS.official).toMatch(/hide it from your profile/);
    expect(DELETE_REFUSALS.event).toMatch(/hide it from your profile/);
  });

  it('the menu offers Delete only where the client can see nothing official', () => {
    expect(offersDelete({ eventRound: false, contestLinked: false })).toBe(true);
    expect(offersDelete({ eventRound: true, contestLinked: false })).toBe(false);
    expect(offersDelete({ eventRound: false, contestLinked: true })).toBe(false);
  });
});

describe('the delete doors', () => {
  it('ask for it by name — a bare DELETE still hides a result (an old tab never destroys)', () => {
    const posts = code('src/app/api/posts/route.ts').split('export async function DELETE')[1];
    expect(posts).toMatch(/searchParams\.get\('mode'\) === 'delete'/);
    expect(posts.indexOf("=== 'delete'")).toBeLessThan(posts.indexOf('deleteOrHideRound('));
    expect(code('src/app/api/group-posts/[id]/route.ts').split('export async function DELETE')[1]).toMatch(/get\('mode'\) === 'delete'/);
    expect(code('src/app/api/golf/rounds/[roundId]/route.ts').split('export async function DELETE')[1]).toMatch(/get\('mode'\) === 'delete'/);
  });

  it('the one writer reads the origin (it fails closed) before anything is removed', () => {
    const src = code('src/lib/results/delete-server.ts');
    expect(src).toMatch(/resolveResultOrigin\(/);
    const round = src.split('export async function deleteRoundResult')[1];
    expect(round.indexOf('resolveResultOrigin(')).toBeLessThan(round.indexOf('planResultDelete('));
    expect(round.indexOf('planResultDelete(')).toBeLessThan(round.indexOf('.delete('));
  });

  it("removing your own result touches only your rows (.eq('profile_id', …) on the stats rows)", () => {
    const own = code('src/lib/results/delete-server.ts').split('async function removeOwnResult')[1].split('\nexport ')[0];
    expect(own).toMatch(/from\('golf_rounds'\)[\s\S]{0,160}\.eq\('profile_id', requesterId\)/);
    expect(own).not.toMatch(/from\('group_posts'\)[\s\S]{0,80}\.delete\(/);
  });
});
