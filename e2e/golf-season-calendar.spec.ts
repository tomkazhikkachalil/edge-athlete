import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Golf sites, part 4 (phase 6e S4): the season on the schedule and the
// calendar. The season generator publishes each play window as an
// ALL-DAY, MULTI-DAY event (local midnights in the publisher's zone,
// end exclusive) that reaches roster members through the read-time org
// merge; the public /schedule lists the rounds with state chips and
// offers a Subscribe link; /schedule.ics carries them as VALUE=DATE
// events; a window move re-derives the event's bounds; "Publish season"
// is idempotent. Self-skips pre-172.

async function settleBody(
  request: { get: (u: string) => Promise<{ text: () => Promise<string> }> },
  url: string,
  needle: string,
  shouldContain = true,
  attempts = 8
): Promise<string> {
  let body = '';
  for (let i = 0; i < attempts; i++) {
    body = await (await request.get(url)).text();
    if (body.includes(needle) === shouldContain) return body;
    await new Promise(r => setTimeout(r, 2500));
  }
  return body;
}

const utcToday = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
/** The UTC instant of local midnight on `iso` in `tz` (Intl-derived, no library). */
function localMidnightUtc(iso: string, tz: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 12);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false, timeZoneName: 'shortOffset' }).formatToParts(new Date(guess));
  const off = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT';
  const mt = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(off);
  const sign = mt?.[1] === '-' ? -1 : 1;
  const hours = mt ? Number(mt[2]) + Number(mt[3] ?? 0) / 60 : 0;
  return new Date(Date.UTC(y, m - 1, d) - sign * hours * 3_600_000).toISOString();
}

test('season on the calendar: all-day windows on members’ calendars, /schedule rounds + Subscribe, schedule.ics, window move, publish-season idempotent; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-competitions', owner.id);
  await resetRateBucket(admin, 'org-site', owner.id);

  const probe = await admin.from('contests').select('play_from').limit(1);
  test.skip(!!probe.error, `contests.play_from missing — run migration 172 (${probe.error?.message})`);

  const stamp = Date.now();
  const tz = 'America/Toronto';
  const start = addDays(utcToday(), -3); // week 1 is OPEN today
  const { data: league } = await admin
    .from('leagues')
    .insert({ name: `QA Season Cal League ${stamp}`, sport_key: 'golf', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([
    // Every row carries every key — a multi-row insert NULLs omitted keys
    // instead of defaulting them (memberships.kind is NOT NULL).
    { league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'roster' },
    { league_id: leagueId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    { league_id: leagueId, profile_id: alpha.id, role: 'member', kind: 'roster' },
  ]);
  const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: `2026 ${stamp}` }).select().single();
  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-season-cal-${stamp}`,
      name: `QA Cal Nine ${stamp}`,
      total_par: 36,
      holes_count: 9,
      section_kind: 'nine',
      hole_data: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 350 }, handicap: i + 1 })),
      course_rating: { white: 35.2 },
      slope_rating: { white: 118 },
    })
    .select('id')
    .single();
  const courseId = course!.id as string;
  const { data: venue } = await admin
    .from('venues')
    .insert({ league_id: leagueId, name: `QA Cal Venue ${stamp}`, golf_course_id: courseId })
    .select('id')
    .single();
  const venueId = venue!.id as string;
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      league_id: leagueId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Cal League ${stamp}`,
      format: 'leaderboard',
      entrant_type: 'athlete',
      scoring_rule: 'golf_gross',
      status: 'active',
      visibility: 'public',
    })
    .select('id')
    .single();
  const competitionId = comp!.id as string;
  await admin.from('competition_entries').insert([
    { competition_id: competitionId, profile_id: owner.id, status: 'approved' },
    { competition_id: competitionId, profile_id: alpha.id, status: 'approved' },
  ]);

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const base = `/api/leagues/${leagueId}/competitions/${competitionId}`;
    // Generate 3 weeks, published to the calendar in Toronto time.
    let res = await ownerApi.post(`${base}/golf-season`, {
      data: { competitionId, startDate: start, weeks: 3, windowDays: 7, holes: 9, venueId, dryRun: false, publishToCalendar: true, timezone: tz },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const out = await res.json();
    expect(out.summary).toMatchObject({ created: 3, published: 3 });
    expect(out.report.every((r: { published?: boolean }) => r.published === true)).toBe(true);

    // The mirror events: all-day, local-midnight bounds, end exclusive, the window title.
    const { data: contests } = await admin
      .from('contests')
      .select('id, round, play_from, play_to, event_id')
      .eq('competition_id', competitionId)
      .order('play_from');
    expect(contests!.length).toBe(3);
    expect(contests!.every(c => !!c.event_id)).toBe(true);
    const week1 = contests![0];
    const { data: ev } = await admin
      .from('events')
      .select('title, description, starts_at, ends_at, all_day, timezone, category, league_id, location')
      .eq('id', week1.event_id)
      .single();
    expect(ev!.all_day).toBe(true);
    expect(ev!.timezone).toBe(tz);
    expect(ev!.category).toBe('game');
    expect(ev!.league_id).toBe(leagueId);
    expect(ev!.title).toBe(`Week 1 — Cal League ${stamp}`);
    expect(ev!.description).toContain('9 holes at QA Cal Nine');
    expect(new Date(ev!.starts_at).toISOString()).toBe(localMidnightUtc(week1.play_from, tz));
    expect(new Date(ev!.ends_at).toISOString()).toBe(localMidnightUtc(addDays(week1.play_to, 1), tz));

    // A roster member's calendar carries it through the org merge (no guest row).
    const listRange = `from=${new Date(Date.now() - 7 * 86_400_000).toISOString()}&to=${new Date(Date.now() + 28 * 86_400_000).toISOString()}`;
    res = await alphaApi.get(`/api/calendar/events?${listRange}`);
    test.skip(res.status() === 404, 'calendar flag off on this target');
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const merged = (await res.json()).events.find((e: { id: string }) => e.id === week1.event_id);
    expect(merged, 'the round should appear on the member calendar').toBeTruthy();
    expect(merged.is_org_event).toBe(true);
    expect(merged.all_day).toBe(true);

    // Publish season is idempotent: nothing left to publish.
    res = await ownerApi.post(`${base}/contests/publish-season`, { data: { competitionId, timezone: tz } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await res.json()).toMatchObject({ published: 0 });

    // A window move re-derives the event's bounds (in its own zone).
    const movedFrom = addDays(week1.play_from as string, 1);
    const movedTo = addDays(week1.play_to as string, 1);
    res = await ownerApi.patch(`${base}/contests`, { data: { id: week1.id, playFrom: movedFrom, playTo: movedTo } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: moved } = await admin.from('events').select('starts_at, ends_at, all_day').eq('id', week1.event_id).single();
    expect(moved!.all_day).toBe(true);
    expect(new Date(moved!.starts_at).toISOString()).toBe(localMidnightUtc(movedFrom, tz));
    expect(new Date(moved!.ends_at).toISOString()).toBe(localMidnightUtc(addDays(movedTo, 1), tz));

    // The public site: rounds on /schedule with chips, Subscribe, the ICS feed.
    res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_module', moduleKey: 'schedule', enabled: true } });
    expect(res.status()).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const canonicalProbe = await anonCtx.request.get(`/org/${site.subdomain}`, { maxRedirects: 0 });
    const sitePath = canonicalProbe.status() === 301 ? `/${site.subdomain}` : `/org/${site.subdomain}`;

    const sched = await settleBody(anonCtx.request, `${sitePath}/schedule`, 'League rounds', true, 12);
    expect(sched).toContain('League rounds');
    expect(sched).toContain('Week 1');
    expect(sched).toContain('Week 3');
    expect(sched).toContain('9 holes');
    expect(sched).toContain(`QA Cal Nine ${stamp}`);
    expect(sched).toContain('open now');
    expect(sched).toContain('upcoming');
    expect(sched).toContain('webcal://');
    expect(sched).toContain('/schedule.ics');
    expect(sched).toContain('"@type":"SportsEvent"');
    // The mirrored events also show under Events as a multi-day range.
    expect(sched).toContain(`Week 1 — Cal League ${stamp}`);
    // The home carries the rounds too.
    const home = await settleBody(anonCtx.request, sitePath, 'Week 1', true, 12);
    expect(home).toContain('open now');

    const icsRes = await anonCtx.request.get(`${sitePath}/schedule.ics?_cb=${Date.now()}`);
    expect(icsRes.status()).toBe(200);
    expect(icsRes.headers()['content-type']).toContain('text/calendar');
    // Unfold RFC 5545 continuation lines (75-octet folding) before asserting.
    const ics = (await icsRes.text()).replace(/\r?\n[ \t]/g, '');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain(`X-WR-CALNAME:QA Season Cal League ${stamp}`);
    // Weeks 2–3 arrive as their (upcoming) mirror events; the OPEN week 1
    // started days ago, so its event is not "upcoming" — the feed carries
    // the round itself instead. Three VEVENTs, never a duplicate.
    expect(ics).toContain(`SUMMARY:Week 1 — Cal League ${stamp}`);
    expect(ics).toContain(`SUMMARY:Week 3 — Cal League ${stamp}`);
    expect(ics).toContain('DTSTART;VALUE=DATE:');
    expect((ics.match(/UID:contest-/g) ?? []).length).toBe(1);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);

    // 375px on /schedule.
    const page = await anonCtx.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${sitePath}/schedule`);
    await expect(page.getByRole('heading', { name: 'League rounds' })).toBeVisible({ timeout: 15_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    await page.close();
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    await anonCtx.close();
    const { data: evs } = await admin.from('contests').select('event_id').eq('competition_id', competitionId);
    const eventIds = (evs ?? []).map(c => c.event_id).filter(Boolean) as string[];
    await admin.from('org_sites').delete().eq('league_id', leagueId);
    await admin.from('venues').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
    if (eventIds.length) await admin.from('events').delete().in('id', eventIds);
    await admin.from('golf_courses').delete().eq('id', courseId);
  }
});
