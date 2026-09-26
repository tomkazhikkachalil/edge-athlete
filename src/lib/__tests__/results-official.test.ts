import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isOfficialOrigin, OFFICIAL_PROVENANCE } from '../results/official';
import { resolveResultOrigin } from '../results/origin-server';

// Results-kept round (241, Sep 26 2026): the ONE official predicate and the
// walk from any result to the event or contest it belongs to. Tom: official
// = a club / league hosts the event, it counts toward an org competition, or
// the org recorded it (club_recorded and up). Fails closed.

describe('isOfficialOrigin', () => {
  it('an org host, a competition, a contest, or an org-recorded provenance', () => {
    expect(isOfficialOrigin({ eventOrgId: 'o1' })).toBe(true);
    expect(isOfficialOrigin({ eventCompetitionId: 'c1' })).toBe(true);
    expect(isOfficialOrigin({ contestLinked: true })).toBe(true);
    for (const p of ['club_recorded', 'league_verified', 'sanctioned']) expect(isOfficialOrigin({ provenance: p }), p).toBe(true);
  });
  it('an athlete-hosted event, a casual round, a self-reported line are not', () => {
    expect(isOfficialOrigin({})).toBe(false);
    expect(isOfficialOrigin({ eventOrgId: null, eventCompetitionId: null, contestLinked: false, provenance: 'self_reported' })).toBe(false);
    expect(isOfficialOrigin({ provenance: 'imported' })).toBe(false);
  });
  it('the official rungs are exactly the org-written ones (orgs/provenance.ts)', () => {
    expect([...OFFICIAL_PROVENANCE].sort()).toEqual(['club_recorded', 'league_verified', 'sanctioned']);
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/orgs/provenance.ts'), 'utf8');
    for (const r of ['sanctioned', 'league_verified', 'club_recorded', 'self_reported', 'imported']) expect(src).toContain(`'${r}'`);
  });
});

// A tiny table-driven stand-in for the admin client: each table answers rows;
// filters narrow them; `maybeSingle` / `count` / a plain await all work.
type Row = Record<string, unknown>;
function mockAdmin(tables: Record<string, Row[]>, failOn: string | null = null) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let head = false;
      const q = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) { head = !!opts?.head; return q; },
        eq(col: string, v: unknown) { rows = rows.filter(r => r[col] === v); return q; },
        in(col: string, vs: unknown[]) { rows = rows.filter(r => vs.includes(r[col])); return q; },
        maybeSingle() {
          return Promise.resolve(table === failOn ? { data: null, error: { message: 'boom' } } : { data: rows[0] ?? null, error: null });
        },
        then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
          const v = table === failOn ? { data: null, error: { message: 'boom' }, count: null } : head ? { data: null, error: null, count: rows.length } : { data: rows, error: null, count: rows.length };
          return Promise.resolve(v).then(res, rej);
        },
      };
      return q;
    },
  } as never;
}

describe('resolveResultOrigin', () => {
  const base = {
    sport_events: [
      { id: 'ev-club', org_id: 'org1', competition_id: null },
      { id: 'ev-own', org_id: null, competition_id: null },
      { id: 'ev-contest', org_id: null, competition_id: null },
    ],
    sport_event_rounds: [
      { id: 'r-club', sport_event_id: 'ev-club' },
      { id: 'r-own', sport_event_id: 'ev-own' },
      { id: 'r-contest', sport_event_id: 'ev-contest' },
    ],
    contests: [{ id: 'k1', sport_event_round_id: 'r-contest', sport_event_match_id: null }],
    sport_event_matches: [],
    group_posts: [
      { id: 'gp-club', sport_event_round_id: 'r-club', contest_id: null },
      { id: 'gp-casual', sport_event_round_id: null, contest_id: null },
      { id: 'gp-league', sport_event_round_id: null, contest_id: 'k9' },
    ],
    golf_rounds: [
      { id: 'gr-club', group_post_id: 'gp-club' },
      { id: 'gr-solo', group_post_id: null },
      { id: 'gr-verified', group_post_id: null },
    ],
    athlete_performances: [{ natural_key: 'golf_round:gr-verified', provenance: 'league_verified' }, { natural_key: 'post:p-line', provenance: 'club_recorded' }],
    sport_event_stat_lines: [{ id: 'sl1', sport_event_round_id: 'r-club' }],
    posts: [
      { id: 'p-announce', group_post_id: null, sport_event_round_id: 'r-own', contest_id: null, round_id: null, stats_data: null },
      { id: 'p-line', group_post_id: null, sport_event_round_id: null, contest_id: null, round_id: null, stats_data: { type: 'stat_line' } },
      { id: 'p-mirror', group_post_id: null, sport_event_round_id: null, contest_id: null, round_id: 'gr-club', stats_data: null },
      { id: 'p-plain', group_post_id: null, sport_event_round_id: null, contest_id: null, round_id: null, stats_data: null },
      { id: 'p-evline', group_post_id: null, sport_event_round_id: null, contest_id: null, round_id: null, stats_data: { sport_event_stat_line_id: 'sl1' } },
    ],
  };
  const admin = mockAdmin(base);

  it('an event: its org, a contest on its rounds, or neither', async () => {
    expect((await resolveResultOrigin(admin, { kind: 'event', id: 'ev-club' })).official).toBe(true);
    expect((await resolveResultOrigin(admin, { kind: 'event', id: 'ev-contest' })).official).toBe(true);
    expect((await resolveResultOrigin(admin, { kind: 'event', id: 'ev-own' })).official).toBe(false);
  });
  it('a golf round: through its group post to the event, a league contest, or its provenance', async () => {
    expect(await resolveResultOrigin(admin, { kind: 'golf_round', id: 'gr-club' })).toMatchObject({ official: true, eventId: 'ev-club', orgId: 'org1' });
    expect((await resolveResultOrigin(admin, { kind: 'golf_round', id: 'gr-solo' })).official).toBe(false);
    expect((await resolveResultOrigin(admin, { kind: 'golf_round', id: 'gr-verified' })).official).toBe(true);
    expect((await resolveResultOrigin(admin, { kind: 'group_post', id: 'gp-league' })).official).toBe(true);
    expect((await resolveResultOrigin(admin, { kind: 'group_post', id: 'gp-casual' })).official).toBe(false);
  });
  it('a post: every link — the round, the stat line, the golf round, the provenance', async () => {
    expect((await resolveResultOrigin(admin, { kind: 'post', id: 'p-announce' })).official).toBe(false); // athlete-hosted event
    expect((await resolveResultOrigin(admin, { kind: 'post', id: 'p-line' })).official).toBe(true); // club_recorded
    expect((await resolveResultOrigin(admin, { kind: 'post', id: 'p-mirror' })).official).toBe(true); // round → group post → club event
    expect((await resolveResultOrigin(admin, { kind: 'post', id: 'p-evline' })).official).toBe(true); // stat line → club event
    expect((await resolveResultOrigin(admin, { kind: 'post', id: 'p-plain' })).official).toBe(false);
    expect((await resolveResultOrigin(admin, { kind: 'stat_line', id: 'sl1' })).official).toBe(true);
  });
  it('fails CLOSED: a read error counts as official', async () => {
    const broken = mockAdmin(base, 'sport_events');
    expect(await resolveResultOrigin(broken, { kind: 'event', id: 'ev-own' })).toMatchObject({ official: true, unknown: true });
  });
  it('a missing thing is not official (nothing to protect)', async () => {
    expect(await resolveResultOrigin(admin, { kind: 'post', id: 'nope' })).toMatchObject({ official: false, unknown: false });
  });
});
