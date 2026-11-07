import { test, expect } from './helpers/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { openEventSession } from './helpers/sport-events';

/**
 * The viewer's follows never cross the wire (migration 303, the improvements
 * round PR 4): the @mention and invite people searches compute "who I may see
 * beyond the public set" in SQL — one direction for mentions (people I
 * follow), either direction for invites. A and B are made PRIVATE for the
 * test, A follows B (pending → accepted):
 *   A's @mention search finds B (A follows B);
 *   B's @mention search does NOT find A (B does not follow A);
 *   B's invite search DOES find A (a follow in either direction);
 *   a stranger's searches find neither.
 * API only — the picker UIs are unchanged.
 */
test('people search: mentions one-way, invites either way, both from SQL @mobile', async () => {
  test.setTimeout(90_000);
  const s = await openEventSession();
  const admin = adminClient();
  let followId: string | null = null;
  try {
    // The QA users are minted without handles; @mentions need one.
    const tag = Date.now().toString(36);
    const a = { handle: `qa${tag}a` };
    const b = { handle: `qa${tag}b` };
    await admin.from('profiles').update({ visibility: 'private', handle: a.handle }).eq('id', s.userA.id);
    await admin.from('profiles').update({ visibility: 'private', handle: b.handle }).eq('id', s.userB.id);

    // A follows B: private → a request; B accepts it.
    const follow = await s.apiA.post('/api/follow', { data: { followingId: s.userB.id } });
    expect(follow.ok(), await readErrorBody(follow)).toBe(true);
    const { data: req } = await admin.from('follows').select('id, status').eq('follower_id', s.userA.id).eq('following_id', s.userB.id).single();
    followId = req!.id;
    if (req!.status !== 'accepted') {
      const accept = await s.apiB.post('/api/followers', { data: { action: 'accept', followId } });
      expect(accept.ok(), await readErrorBody(accept)).toBe(true);
    }

    const mention = async (api: typeof s.apiA, q: string) => {
      const res = await api.get(`/api/mentions/search?q=${encodeURIComponent(q)}`);
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      return ((await res.json()) as { profiles: { id: string }[] }).profiles.map(p => p.id);
    };
    const invite = async (api: typeof s.apiA, q: string) => {
      const res = await api.get(`/api/calendar/invite-search?q=${encodeURIComponent(q)}`);
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      return ((await res.json()) as { profiles: { id: string }[] }).profiles.map(p => p.id);
    };

    expect(await mention(s.apiA, b.handle), 'A @mentions B — A follows B').toContain(s.userB.id);
    expect(await mention(s.apiB, a.handle), 'B cannot @mention private A — B does not follow A').not.toContain(s.userA.id);
    expect(await invite(s.apiB, a.handle), 'B can invite A — a follow in either direction').toContain(s.userA.id);
    if (s.apiC) {
      expect(await mention(s.apiC, b.handle), 'a stranger finds neither').not.toContain(s.userB.id);
      expect(await invite(s.apiC, a.handle), 'a stranger finds neither').not.toContain(s.userA.id);
    }
  } finally {
    if (followId) await admin.from('follows').delete().eq('id', followId);
    await admin.from('profiles').update({ visibility: 'public', handle: null }).in('id', [s.userA.id, s.userB.id]);
    await s.dispose();
  }
});

// Hole 8's remainder (scale round 2 PR 2, Nov 7 2026): a GET through
// requireAuth runs NO bucket, and these two typeaheads are a database query
// per keystroke — they now spend `people-search` (120 a minute per account).
// The client debounces at 250 ms, so a typist never meets it; a held key does.
test('the @mention typeahead meets its bucket: the 121st request in a minute is a 429', async () => {
  test.skip(process.env.E2E_TARGET === 'prod', 'the bucket is per account per minute — never spent on production');
  test.setTimeout(120_000);
  const s = await openEventSession();
  try {
    let first429 = -1;
    for (let i = 1; i <= 125; i += 1) {
      const res = await s.apiA.get(`/api/mentions/search?q=qa${i % 7}`);
      if (res.status() === 429) { first429 = i; break; }
      expect(res.ok(), await readErrorBody(res)).toBe(true);
    }
    expect(first429, 'a 429 arrived within the 125 requests').toBeGreaterThan(0);
    expect(first429, 'the budget is 120 a minute').toBeGreaterThan(100);
    // The invite search spends the SAME bucket (one budget for a person's typeaheads).
    expect((await s.apiA.get('/api/calendar/invite-search?q=qa')).status()).toBe(429);
  } finally {
    await s.dispose();
  }
});
