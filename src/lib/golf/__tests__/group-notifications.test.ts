import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cardMilestone, notifyRoundFinal, notifyScoresPosted } from '../group-notifications';

// Nov 19 2026 (Tom: 20+ notifications for one round). Milestones only: a
// golfer finished their card, the round is final. Nothing per hole.

const CREATOR = 'creator';
const FRIEND = 'friend';

describe('cardMilestone', () => {
  const base = { actorId: FRIEND, creatorId: CREATOR, cardOwnerId: FRIEND, holesPlayed: 18 };
  it('nothing until the card holds every hole', () => {
    for (const done of [0, 1, 9, 17, null, undefined]) expect(cardMilestone({ ...base, holesCompleted: done }), String(done)).toBe(false);
    expect(cardMilestone({ ...base, holesCompleted: 18 })).toBe(true);
    expect(cardMilestone({ ...base, holesPlayed: 9, holesCompleted: 9 })).toBe(true);
  });
  it('never to the person who entered the scores: the creator scoring a friend\'s card hears nothing', () => {
    expect(cardMilestone({ ...base, actorId: CREATOR, holesCompleted: 18 })).toBe(false);
  });
  it('never about the creator\'s own card', () => {
    expect(cardMilestone({ ...base, actorId: CREATOR, cardOwnerId: CREATOR, holesCompleted: 18 })).toBe(false);
    expect(cardMilestone({ ...base, actorId: FRIEND, cardOwnerId: CREATOR, holesCompleted: 18 })).toBe(false);
  });
  it('a round with no size says nothing', () => {
    expect(cardMilestone({ ...base, holesPlayed: 0, holesCompleted: 18 })).toBe(false);
    expect(cardMilestone({ ...base, holesPlayed: null, holesCompleted: 18 })).toBe(false);
  });
});

/** A fake of the few reads and the insert the senders make. */
function fakeDb(state: { holesPlayed: number; status: string; golfers: Array<{ profile_id: string; status: string }>; sent?: Array<Record<string, unknown>> }) {
  const inserted: Array<Record<string, unknown>> = [...(state.sent ?? [])];
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    let marker: Record<string, string> | null = null;
    Object.assign(q, {
      select: () => q,
      eq: () => q,
      limit: () => q,
      contains: (_col: string, m: Record<string, string>) => { marker = m; return q; },
      maybeSingle: async () =>
        table === 'golf_scorecard_data' ? { data: { holes_played: state.holesPlayed } }
        : table === 'group_posts' ? { data: { status: state.status } }
        : { data: { first_name: 'Sam', last_name: 'Player', full_name: null } },
      insert: async (rows: Record<string, unknown> | Array<Record<string, unknown>>) => { inserted.push(...(Array.isArray(rows) ? rows : [rows])); return { error: null }; },
      then: (resolve: (v: unknown) => void) => {
        if (table === 'group_post_participants') return resolve({ data: state.golfers });
        if (table === 'notifications') return resolve({ data: inserted.filter(r => Object.entries(marker ?? {}).every(([k, v]) => (r.metadata as Record<string, string>)[k] === v)).map(() => ({ id: 'n' })) });
        return resolve({ data: null });
      },
    });
    return q;
  };
  return { supabase: { from } as never, inserted };
}
const ctx = (supabase: never) => ({ supabase, groupPostId: 'gp1', title: 'Golf at Camelot', actionUrl: null });
const golfers = [{ profile_id: CREATOR, status: 'confirmed' }, { profile_id: FRIEND, status: 'confirmed' }, { profile_id: 'third', status: 'confirmed' }];

describe('notifyScoresPosted: a whole card entered hole by hole', () => {
  it('a friend scoring their own card: seventeen saves say nothing, the eighteenth tells the creator once, a later correction says nothing', async () => {
    const db = fakeDb({ holesPlayed: 18, status: 'active', golfers });
    for (let done = 1; done <= 17; done++) await notifyScoresPosted(ctx(db.supabase), { creatorId: CREATOR, cardOwnerId: FRIEND, actorId: FRIEND, holesCompleted: done });
    expect(db.inserted).toHaveLength(0);
    await notifyScoresPosted(ctx(db.supabase), { creatorId: CREATOR, cardOwnerId: FRIEND, actorId: FRIEND, holesCompleted: 18 });
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({ user_id: CREATOR, type: 'group_update', actor_id: FRIEND, title: 'Sam Player finished their card', metadata: { group_post_id: 'gp1', event: 'card_complete', card_owner: FRIEND } });
    await notifyScoresPosted(ctx(db.supabase), { creatorId: CREATOR, cardOwnerId: FRIEND, actorId: FRIEND, holesCompleted: 18 });
    expect(db.inserted).toHaveLength(1);
  });
  it('Tom\'s round: the creator enters every card for three golfers, 54 saves, and is told nothing while it is live', async () => {
    const db = fakeDb({ holesPlayed: 18, status: 'active', golfers });
    for (const owner of [CREATOR, FRIEND, 'third']) for (let done = 1; done <= 18; done++) await notifyScoresPosted(ctx(db.supabase), { creatorId: CREATOR, cardOwnerId: owner, actorId: CREATOR, holesCompleted: done });
    expect(db.inserted).toHaveLength(0);
  });
  it('two friends each finishing their own card are two notices, one each', async () => {
    const db = fakeDb({ holesPlayed: 9, status: 'active', golfers });
    for (const owner of [FRIEND, 'third']) for (let i = 0; i < 2; i++) await notifyScoresPosted(ctx(db.supabase), { creatorId: CREATOR, cardOwnerId: owner, actorId: owner, holesCompleted: 9 });
    expect(db.inserted.map(r => (r.metadata as { card_owner: string }).card_owner)).toEqual([FRIEND, 'third']);
  });
});

describe('notifyRoundFinal: once, when the round is completed', () => {
  it('nothing while the round is live, however many golfers have a total', async () => {
    const db = fakeDb({ holesPlayed: 18, status: 'active', golfers });
    await notifyRoundFinal(ctx(db.supabase), CREATOR);
    expect(db.inserted).toHaveLength(0);
  });
  it('completed: every golfer who has not declined hears once, except the one whose action finished it', async () => {
    const db = fakeDb({ holesPlayed: 18, status: 'completed', golfers: [...golfers, { profile_id: 'out', status: 'declined' }] });
    await notifyRoundFinal(ctx(db.supabase), CREATOR);
    expect(db.inserted.map(r => r.user_id)).toEqual([FRIEND, 'third']);
    expect(db.inserted[0]).toMatchObject({ title: 'Final leaderboard is in for your shared round', metadata: { group_post_id: 'gp1', event: 'leaderboard_final' } });
    await notifyRoundFinal(ctx(db.supabase), FRIEND);
    expect(db.inserted).toHaveLength(2);
  });
  it('a solo round has no leaderboard moment', async () => {
    const db = fakeDb({ holesPlayed: 18, status: 'completed', golfers: [golfers[0]] });
    await notifyRoundFinal(ctx(db.supabase), CREATOR);
    expect(db.inserted).toHaveLength(0);
  });
  it('the last save of the last card sends the card notice and the final together', async () => {
    const db = fakeDb({ holesPlayed: 18, status: 'completed', golfers: golfers.slice(0, 2) });
    await notifyScoresPosted(ctx(db.supabase), { creatorId: CREATOR, cardOwnerId: FRIEND, actorId: FRIEND, holesCompleted: 18 });
    expect(db.inserted.map(r => [(r.metadata as { event: string }).event, r.user_id])).toEqual([['card_complete', CREATOR], ['leaderboard_final', CREATOR]]);
  });
});

describe('no notification is tied to a single hole', () => {
  it('the per-hole "posted scores" row is gone from the sender and the routes', () => {
    const lib = fs.readFileSync(path.join(__dirname, '../group-notifications.ts'), 'utf8');
    expect(lib).not.toContain("event: 'scores_posted'");
    const route = fs.readFileSync(path.join(__dirname, '../../../app/api/golf/scorecards/[id]/scores/route.ts'), 'utf8');
    expect(route).toContain('actorId: user.id');
    expect(route).toContain('holesCompleted:');
    expect(vi.isMockFunction(notifyScoresPosted)).toBe(false);
  });
});
