import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildDraftsList, draftReviewHref, draftsCount, isWorkoutDraft, pickReopenCandidate, roundTitle, WORKOUT_DRAFTS_SINCE, type DraftRoundRow, type DraftWorkoutRow } from '../drafts/list';

// Drafts round PR 2 (Oct 2026): the one private list of what is not posted
// yet — rounds in progress, drafts, workouts in progress, the recording on
// this phone — and the rule for which of them the reopen prompt asks about.

const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const round = (over: Partial<DraftRoundRow>): DraftRoundRow => ({
  id: 'gp1', status: 'active', date: '2026-10-05', post_id: 'p1', course_name: 'Pine Hills', title: null,
  isCreator: true, lastScoreAt: '2026-10-05T15:00:00Z', postIsDraft: true, sportEventRoundId: null, ...over,
});
const workout = (over: Partial<DraftWorkoutRow>): DraftWorkoutRow => ({
  id: 'w1', status: 'active', title: 'Legs', started_at: '2026-10-06T08:00:00Z', last_activity_at: '2026-10-06T08:30:00Z', ...over,
});

describe('buildDraftsList', () => {
  it('a pending or active round is IN PROGRESS (Resume); a completed round with a draft post is a DRAFT (Review / Post)', () => {
    const list = buildDraftsList({ rounds: [round({ status: 'pending', id: 'a', post_id: 'pa' }), round({ status: 'active', id: 'b', post_id: 'pb' }), round({ status: 'completed', id: 'c', post_id: 'pc' })], workouts: [] });
    expect(list.inProgress.map(i => [i.id, i.state, i.href])).toEqual([['a', 'in_progress', '/live/a'], ['b', 'in_progress', '/live/b']]);
    expect(list.drafts.map(i => [i.id, i.postId, i.href])).toEqual([['c', 'pc', '/athlete/drafts/pc']]);
  });
  it('a POSTED round is nothing here; a cancelled one is nothing; an event round is never listed', () => {
    const list = buildDraftsList({
      rounds: [round({ status: 'completed', postIsDraft: false }), round({ status: 'cancelled', id: 'x' }), round({ status: 'active', id: 'e', sportEventRoundId: 'r1' })],
      workouts: [],
    });
    expect(draftsCount(list)).toBe(0);
  });
  it('only the CREATOR holds the draft — a playing partner sees the round in progress, never as their draft', () => {
    const list = buildDraftsList({ rounds: [round({ status: 'completed', isCreator: false }), round({ status: 'active', id: 'live', isCreator: false })], workouts: [] });
    expect(list.drafts).toEqual([]);
    expect(list.inProgress.map(i => [i.id, i.isCreator])).toEqual([['live', false]]);
  });
  it('a completed round without a post is not a draft (nothing to review)', () => {
    expect(buildDraftsList({ rounds: [round({ status: 'completed', post_id: null })], workouts: [] }).drafts).toEqual([]);
  });
  it('workouts: an active session is in progress; a finished one with no decision is a DRAFT (Share / Keep private); a decided or shared one is nothing', () => {
    const list = buildDraftsList({ rounds: [], workouts: [
      workout({}),
      workout({ id: 'undecided', status: 'completed', ended_at: '2026-10-07T09:00:00Z' }),
      workout({ id: 'kept', status: 'completed', ended_at: '2026-10-07T09:00:00Z', share_decided_at: '2026-10-07T09:05:00Z' }),
      workout({ id: 'shared', status: 'completed', ended_at: '2026-10-07T09:00:00Z', post_id: 'p9' }),
    ] });
    expect(list.inProgress.map(i => [i.kind, i.id, i.href, i.title])).toEqual([['workout', 'w1', '/app/workout/w1', 'Legs']]);
    expect(list.drafts.map(i => [i.id, i.href])).toEqual([['undecided', '/app/workout/undecided?share=1']]);
  });
  it('a workout finished before the Drafts round is history, not a draft (no decision was ever recorded)', () => {
    expect(isWorkoutDraft(workout({ status: 'completed', ended_at: '2026-09-30T09:00:00Z' }))).toBe(false);
    expect(isWorkoutDraft(workout({ status: 'completed', ended_at: WORKOUT_DRAFTS_SINCE }))).toBe(true);
  });
  it('the recording on this phone is an in-progress row to the recorder', () => {
    const list = buildDraftsList({ rounds: [], workouts: [], recording: { id: 'rec', label: 'Walk', savedAt: Date.parse('2026-10-06T09:00:00Z') } });
    expect(list.inProgress[0]).toMatchObject({ kind: 'recording', href: '/activities/record', title: 'Walk (on this phone)' });
  });
  it('newest activity first; an untouched round sorts by its date', () => {
    const list = buildDraftsList({
      rounds: [round({ id: 'old', lastScoreAt: '2026-10-01T10:00:00Z' }), round({ id: 'quiet', status: 'pending', lastScoreAt: null, date: '2026-10-04' }), round({ id: 'new', lastScoreAt: '2026-10-06T10:00:00Z' })],
      workouts: [workout({ last_activity_at: '2026-10-05T10:00:00Z' })],
    });
    expect(list.inProgress.map(i => i.id)).toEqual(['new', 'w1', 'quiet', 'old']);
  });
  it('the title is the course, else the round title, else "Golf round"', () => {
    expect(roundTitle({ course_name: ' Pine Hills ', title: 'Sunday' })).toBe('Pine Hills');
    expect(roundTitle({ course_name: null, title: 'Sunday' })).toBe('Sunday');
    expect(roundTitle({ course_name: '', title: null })).toBe('Golf round');
  });
});

describe('the reopen candidate', () => {
  it('is the most recently touched in-progress thing, or nothing', () => {
    const list = buildDraftsList({ rounds: [round({ id: 'r' })], workouts: [workout({ last_activity_at: '2026-10-06T10:00:00Z' })] });
    expect(pickReopenCandidate(list)?.id).toBe('w1');
    expect(pickReopenCandidate({ inProgress: [], drafts: [] })).toBeNull();
  });
});

describe('the one spelling of the review screen', () => {
  it('round-route re-exports the Drafts list helper; the card, the live page and the composer go through it', () => {
    expect(draftReviewHref('p1')).toBe('/athlete/drafts/p1');
    expect(read('src/lib/golf/round-route.ts')).toMatch(/export \{ draftReviewHref as draftReviewPath \}/);
    expect(read('src/components/PostCard.tsx')).toMatch(/href=\{draftReviewHref\(post\.id\)\}/);
    expect(read('src/app/(app)/live/[groupPostId]/page.tsx')).toMatch(/isCreator \? draftReviewPath\(entry\.postId\)/);
  });
  it('the API is private and never cached; a stranger\'s profile is refused by the write_content gate', () => {
    const src = read('src/app/api/drafts/route.ts');
    expect(src).toMatch(/'Cache-Control': 'private, no-store'/);
    expect(src).toMatch(/resolveProfileAction\(await getProfileRole\(user\.id, requested\), 'write_content'\)/);
  });
  it('the drawer carries the Drafts door the dropdown has (the drawer is a superset)', () => {
    const src = read('src/components/AppHeader.tsx');
    expect(src).toMatch(/data-header-drafts=""/);
    expect(src).toMatch(/data-drawer-drafts=""/);
  });
});
