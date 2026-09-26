import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cleanupEvent, createEvent, goLive, openEventSession, readView, roundTransition, setGroups } from './helpers/sport-events';

type StatsPayload = {
  round: { id: string; status: string; score: { side1_score: number | null; side2_score: number | null; period: number | null; version: number } };
  shape: string;
  sides: [string, string] | null;
  fields: Array<{ key: string }>;
  lines: Array<{ id: string; participant_id: string; profile_id: string; side: 1 | 2 | null; stats: Record<string, number>; version: number; headline: string | null }>;
  viewer: { can_enter: 'all' | string[]; can_score: boolean };
};

/**
 * Events program, phase 4, PR 8 — a TEAM event through the API. NEEDS
 * MIGRATION 215 ON THE TARGET (self-skips before). A hosts a public hockey
 * GAME (Reds vs Blues) without playing; B and C join with one tap and are
 * sorted into the two sides; go-live mints one stat line per player (no
 * group post); a stranger reads the stats; B enters their own line (self
 * entry), may not enter C's (403), a stat off the schema or out of range
 * is refused by name, a stale version is a 409 carrying the current line;
 * A enters C's line and keeps the score (B may not); completion needs no
 * override and the event follows; afterwards B's write is over (409) and
 * A's still lands. The golf vocabulary is refused on a team sport and the
 * shape follows the sport both ways.
 */
test('team events API: a hockey game — refusals, sides, the mint, self entry, the CAS, the score, completion', async () => {
  test.setTimeout(150_000);
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_events').select('shape').limit(1);
  test.skip(!!probe.error, 'sport_events.shape missing — run migration 215');
  test.skip(!s.apiC || !s.userC, 'the four QA users are not minted — an older global setup');
  const apiC = s.apiC!;
  const userC = s.userC!;
  let eventId: string | null = null;
  try {
    const name = `QA Hockey Game ${s.stamp}`;
    // The vocabulary: golf fields on a team round, the wrong shape, a format off golf — each refused by name.
    const bad1 = await s.apiA.post('/api/sport-events', { data: { name, sport_key: 'ice_hockey', round: { scheduled_on: '2030-06-01', course_name: 'QA Rink', holes: 9 } } });
    expect(bad1.status()).toBe(400);
    expect(await readErrorBody(bad1)).toMatch(/holes is only for golf/);
    const bad2 = await s.apiA.post('/api/sport-events', { data: { name, sport_key: 'ice_hockey', shape: 'round', round: { scheduled_on: '2030-06-01', course_name: 'QA Rink' } } });
    expect(bad2.status()).toBe(400);
    expect(await readErrorBody(bad2)).toMatch(/game or a session/);
    const bad3 = await s.apiA.post('/api/sport-events', { data: { name, sport_key: 'ice_hockey', format: 'stroke_net', round: { scheduled_on: '2030-06-01', course_name: 'QA Rink' } } });
    expect(bad3.status()).toBe(400);
    expect(await readErrorBody(bad3)).toMatch(/golf vocabulary/);
    const bad4 = await s.apiA.post('/api/sport-events', { data: { name, shape: 'game', round: { scheduled_on: '2030-06-01', course_name: 'QA Links' } } });
    expect(bad4.status()).toBe(400);
    expect(await readErrorBody(bad4)).toMatch(/golf event is a round/);
    const bad5 = await s.apiA.post('/api/sport-events', { data: { name, sport_key: 'ice_hockey', shape: 'session', format_config: { game: { side_names: ['A', 'B'] } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Rink' } } });
    expect(bad5.status()).toBe(400);
    expect(await readErrorBody(bad5)).toMatch(/only allowed on a game/);

    const view = await createEvent(s.apiA, { name, sport_key: 'ice_hockey', shape: 'game', visibility: 'public', join_mode: 'open', publish: true, host_plays: false, format_config: { game: { side_names: ['Reds', 'Blues'] } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Rink', starts_at: '2030-06-01T19:30:00.000Z' } });
    eventId = view.event.id;
    expect(view.event).toMatchObject({ status: 'open', sport_key: 'ice_hockey', shape: 'game', game: { side_names: ['Reds', 'Blues'] } });
    const roundId = view.rounds[0].id;
    expect(Date.parse(view.rounds[0].starts_at ?? '')).toBe(Date.parse('2030-06-01T19:30:00Z'));
    expect(view.rounds[0].score_version).toBe(0);

    // B and C join with one tap (open).
    for (const api of [s.apiB, apiC]) {
      const joined = await api.post(`/api/sport-events/${eventId}/participants/join`, { data: {} });
      expect(joined.ok(), await readErrorBody(joined)).toBe(true);
    }
    let v = await readView(s.apiA, eventId);
    const bId = v.participants.find(p => p.profile_id === s.userB.id)!.id;
    const cId = v.participants.find(p => p.profile_id === userC.id)!.id;
    expect(v.counts.playing).toBe(2);

    // The sides: one group, B on side 1, C on side 2 (sent, never derived).
    v = await setGroups(s.apiA, eventId, roundId, [{ name: 'The game', members: [{ participant_id: bId, side: 1 }, { participant_id: cId, side: 2 }] }]);
    expect(v.groups.find(g => g.sport_event_round_id === roundId)?.members.map(m => m.side)).toEqual([1, 2]);

    // Go live: the lines are minted, no group post.
    v = await goLive(s.apiA, eventId, '2030-06-01');
    expect(v.event.status).toBe('live');
    expect(v.rounds[0].status).toBe('live');
    expect(v.rounds[0].group_post_id).toBeNull();

    const statsUrl = `/api/sport-events/${eventId}/rounds/${roundId}/stats`;
    const anonRes = await s.anon.get(statsUrl);
    expect(anonRes.status(), await readErrorBody(anonRes)).toBe(200);
    const anon = (await anonRes.json()) as StatsPayload;
    expect(anon.shape).toBe('game');
    expect(anon.sides).toEqual(['Reds', 'Blues']);
    expect(anon.lines).toHaveLength(2);
    expect(anon.lines.find(l => l.profile_id === s.userB.id)).toMatchObject({ side: 1, version: 0, stats: {} });
    expect(anon.viewer).toEqual({ can_enter: [], can_score: false });
    expect(anon.fields.map(f => f.key)).toContain('goals');
    const bLine = anon.lines.find(l => l.profile_id === s.userB.id)!.id;
    const cLine = anon.lines.find(l => l.profile_id === userC.id)!.id;
    const asB = (await (await s.apiB.get(statsUrl)).json()) as StatsPayload;
    expect(asB.viewer).toEqual({ can_enter: [bLine], can_score: false });
    const asA = (await (await s.apiA.get(statsUrl)).json()) as StatsPayload;
    expect(asA.viewer).toEqual({ can_enter: 'all', can_score: true });

    // B's own line (self entry), the vocabulary, the CAS.
    const w1 = await s.apiB.put(`${statsUrl}/${bLine}`, { data: { stats: { goals: 1, assists: 2 }, expected_version: 0 } });
    expect(w1.status(), await readErrorBody(w1)).toBe(200);
    expect(await w1.json()).toMatchObject({ line: { version: 1, stats: { goals: 1, assists: 2 } }, via: 'self' });
    const notMine = await s.apiB.put(`${statsUrl}/${cLine}`, { data: { stats: { goals: 1 }, expected_version: 0 } });
    expect(notMine.status()).toBe(403);
    const unknown = await s.apiB.put(`${statsUrl}/${bLine}`, { data: { stats: { rebounds: 1 }, expected_version: 1 } });
    expect(unknown.status()).toBe(400);
    expect(await readErrorBody(unknown)).toMatch(/Unknown stat .*rebounds/); // the body reads back JSON-escaped — never anchor on the quotes
    const range = await s.apiB.put(`${statsUrl}/${bLine}`, { data: { stats: { goals: 99 }, expected_version: 1 } });
    expect(range.status()).toBe(400);
    expect(await readErrorBody(range)).toMatch(/out of range/);
    const stale = await s.apiB.put(`${statsUrl}/${bLine}`, { data: { stats: { goals: 2 }, expected_version: 0 } });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ reason: 'conflict', current: { version: 1, stats: { goals: 1, assists: 2 } } });
    // The organizer enters C's line.
    const w2 = await s.apiA.put(`${statsUrl}/${cLine}`, { data: { stats: { goals: 1 }, expected_version: 0 } });
    expect(w2.status(), await readErrorBody(w2)).toBe(200);
    expect(await w2.json()).toMatchObject({ via: 'organizer' });

    // The score: a player may not; the organizer may; a stale version is a 409 with the current score.
    const scoreUrl = `/api/sport-events/${eventId}/rounds/${roundId}/score`;
    expect((await s.apiB.put(scoreUrl, { data: { side1_score: 1, side2_score: 0, expected_version: 0 } })).status()).toBe(403);
    const sc = await s.apiA.put(scoreUrl, { data: { side1_score: 2, side2_score: 1, period: 2, expected_version: 0 } });
    expect(sc.status(), await readErrorBody(sc)).toBe(200);
    expect(await sc.json()).toMatchObject({ score: { side1_score: 2, side2_score: 1, period: 2, version: 1 } });
    const scStale = await s.apiA.put(scoreUrl, { data: { side1_score: 3, side2_score: 1, expected_version: 0 } });
    expect(scStale.status()).toBe(409);
    expect(await scStale.json()).toMatchObject({ current: { side1_score: 2, side2_score: 1, period: 2, version: 1 } });
    const after = (await (await s.anon.get(statsUrl)).json()) as StatsPayload;
    expect(after.round.score).toEqual({ side1_score: 2, side2_score: 1, period: 2, version: 1 });
    expect(after.lines.find(l => l.id === bLine)).toMatchObject({ version: 1, headline: expect.stringMatching(/1 G/) });

    // Completion needs no override on a stat round; the event follows. Afterwards a player's write is over; the organizer's lands.
    v = await roundTransition(s.apiA, eventId, roundId, 'completed');
    expect(v.rounds[0].status).toBe('completed');
    expect(v.event.status).toBe('completed');
    const over = await s.apiB.put(`${statsUrl}/${bLine}`, { data: { stats: { goals: 2 }, expected_version: 1 } });
    expect(over.status()).toBe(409);
    const fix = await s.apiA.put(`${statsUrl}/${bLine}`, { data: { stats: { goals: 2, assists: 2 }, expected_version: 1 } });
    expect(fix.status(), await readErrorBody(fix)).toBe(200);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});

/**
 * PR 10 — completion mirrors the lines: B's stat-line POST (the existing
 * `stat_line` shape, W 2-1 from the Reds' side) and its performance row
 * (`post:<id>`, the metrics); the round's one post flips to the results
 * (the score, the sides); the results bell opens the Stats tab; B's
 * opt-out removes the post and the row, the opt back in restores them; an
 * untouched line (C never scored) mirrors nothing.
 */
test('team events API: completion mirrors the lines, the results post, the bell, the opt-out', async () => {
  test.setTimeout(150_000);
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_events').select('shape').limit(1);
  test.skip(!!probe.error, 'sport_events.shape missing — run migration 215');
  test.skip(!s.apiC || !s.userC, 'the four QA users are not minted — an older global setup');
  const apiC = s.apiC!;
  const userC = s.userC!;
  let eventId: string | null = null;
  const postsFor = async (lineId: string) => (await admin.from('posts').select('id, profile_id, visibility, stats_data').eq('stats_data->>sport_event_stat_line_id', lineId)).data ?? [];
  try {
    const view = await createEvent(s.apiA, { name: `QA Hockey Results ${s.stamp}`, sport_key: 'ice_hockey', shape: 'game', visibility: 'public', join_mode: 'open', publish: true, host_plays: false, format_config: { game: { side_names: ['Reds', 'Blues'] } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Rink' } });
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    for (const api of [s.apiB, apiC]) expect((await api.post(`/api/sport-events/${eventId}/participants/join`, { data: {} })).ok()).toBe(true);
    let v = await readView(s.apiA, eventId);
    const bId = v.participants.find(p => p.profile_id === s.userB.id)!.id;
    const cId = v.participants.find(p => p.profile_id === userC.id)!.id;
    const bRow = bId;
    await setGroups(s.apiA, eventId, roundId, [{ name: 'The game', members: [{ participant_id: bId, side: 1 }, { participant_id: cId, side: 2 }] }]);
    await goLive(s.apiA, eventId, '2030-06-01');
    const statsUrl = `/api/sport-events/${eventId}/rounds/${roundId}/stats`;
    const before = (await (await s.apiA.get(statsUrl)).json()) as StatsPayload;
    const bLine = before.lines.find(l => l.profile_id === s.userB.id)!.id;
    const cLine = before.lines.find(l => l.profile_id === userC.id)!.id;
    expect((await s.apiB.put(`${statsUrl}/${bLine}`, { data: { stats: { goals: 2, assists: 1 }, expected_version: 0 } })).ok()).toBe(true);
    expect((await s.apiA.put(`/api/sport-events/${eventId}/rounds/${roundId}/score`, { data: { side1_score: 2, side2_score: 1, period: 3, expected_version: 0 } })).ok()).toBe(true);

    v = await roundTransition(s.apiA, eventId, roundId, 'completed');
    expect(v.event.status).toBe('completed');

    // B's mirrored post: the stat_line shape, W 2-1 vs Blues, public; the performance row over it.
    const bPosts = await postsFor(bLine);
    expect(bPosts).toHaveLength(1);
    expect(bPosts[0]).toMatchObject({ profile_id: s.userB.id, visibility: 'public', stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2030-06-01', stats: { goals: 2, assists: 1 }, opponent: 'Blues', result: 'W', result_score: '2-1', sport_event_id: eventId, sport_event_round_id: roundId, sport_event_stat_line_id: bLine } });
    const perf = await admin.from('athlete_performances').select('natural_key, profile_id, sport_key, occurred_on, metrics, provenance, context').eq('natural_key', `post:${bPosts[0].id as string}`).maybeSingle();
    expect(perf.data).toMatchObject({ profile_id: s.userB.id, sport_key: 'ice_hockey', occurred_on: '2030-06-01', metrics: { goals: 2, assists: 1 }, provenance: 'self_reported', context: { result: 'W', sport_event_id: eventId, recorder: false } });
    // C never scored: nothing mirrored.
    expect(await postsFor(cLine)).toHaveLength(0);
    // The round's one post: the results.
    const roundPost = await admin.from('posts').select('stats_data').eq('sport_event_round_id', roundId).maybeSingle();
    expect(roundPost.data?.stats_data).toMatchObject({ type: 'sport_event_results', shape: 'game', score: { side1_score: 2, side2_score: 1, period: 3 }, sides: [{ side: 1, name: 'Reds' }, { side: 2, name: 'Blues' }] });
    // The results bell for B opens the Stats tab.
    const bell = await admin.from('notifications').select('action_url, message').eq('user_id', s.userB.id).eq('type', 'sport_event_results').contains('metadata', { sport_event_id: eventId }).limit(1).maybeSingle();
    expect(bell.data?.action_url).toContain('tab=stats');

    // Results-kept (241): B's opt-out HIDES the line's post from B's profile — the post and its
    // dataset row stay; the opt back in shows it again.
    const statusOf = async () => ((await admin.from('posts').select('status').eq('id', bPosts[0].id as string).single()).data?.status as string | undefined);
    expect((await s.apiB.patch(`/api/sport-events/${eventId}/participants/${bRow}`, { data: { hide_from_profile: true } })).ok()).toBe(true);
    await expect.poll(statusOf, { timeout: 20_000 }).toBe('profile_hidden');
    expect((await admin.from('athlete_performances').select('natural_key').eq('natural_key', `post:${bPosts[0].id as string}`)).data).toHaveLength(1);
    expect((await s.apiB.patch(`/api/sport-events/${eventId}/participants/${bRow}`, { data: { hide_from_profile: false } })).ok()).toBe(true);
    await expect.poll(statusOf, { timeout: 20_000 }).toBe('published');
    expect((await admin.from('athlete_performances').select('natural_key').eq('natural_key', `post:${bPosts[0].id as string}`)).data).toHaveLength(1);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
