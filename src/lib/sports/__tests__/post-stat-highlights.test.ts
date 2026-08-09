import { describe, it, expect } from 'vitest';
import { buildStatHighlights, coursePar } from '../post-stat-highlights';
import { STAT_SCHEMAS } from '../stat-schemas';

const statLine = (sport_key: string, stats: Record<string, number>, extra = {}) => ({
  type: 'stat_line',
  sport_key,
  stats,
  ...extra,
});

describe('buildStatHighlights — stat-line sports', () => {
  it('hockey leads with POINTS, which no field stores — it is goals + assists', () => {
    const h = buildStatHighlights({ statsData: statLine('ice_hockey', { goals: 2, assists: 1, shots: 6 }) })!;
    expect(h.hero).toEqual({ value: '3', label: 'Points' });
    expect(h.support).toEqual([
      { value: '2', label: 'G' },
      { value: '1', label: 'A' },
      { value: '6', label: 'S' },
    ]);
  });

  it('basketball leads with points; baseball with hits', () => {
    expect(
      buildStatHighlights({ statsData: statLine('basketball', { points: 24, rebounds: 8, assists: 5 }) })!.hero
    ).toEqual({ value: '24', label: 'Points' });
    expect(
      buildStatHighlights({ statsData: statLine('baseball', { hits: 3, home_runs: 1, rbis: 4 }) })!.hero
    ).toEqual({ value: '3', label: 'Hits' });
  });

  it('volleyball leads with kills, not the setter assists the generic headline would pick', () => {
    // Regression guard: the shared compactLine helper returns the first three
    // non-zero fields in declaration order, which puts assists ahead of aces
    // and contradicts volleyball's own profile tiles.
    const h = buildStatHighlights({
      statsData: statLine('volleyball', { kills: 12, assists: 30, digs: 9, aces: 3 }),
    })!;
    expect(h.hero).toEqual({ value: '12', label: 'Kills' });
    expect(h.support.map(t => t.label)).toEqual(['D', 'ACE']);
  });

  it('caps supporting stats at three even when more were recorded', () => {
    const h = buildStatHighlights({
      statsData: statLine('ice_hockey', { goals: 1, assists: 1, shots: 4, hits: 3, blocks: 2, pim: 2 }),
    })!;
    expect(h.support).toHaveLength(3);
  });

  it('omits stats that were not recorded rather than padding with zeros', () => {
    const h = buildStatHighlights({ statsData: statLine('basketball', { points: 10 }) })!;
    expect(h.support).toEqual([]);
  });

  it('promotes a supporting stat when the hero stat itself is absent', () => {
    // 0 points but 8 rebounds is still a post worth rendering — it must not
    // headline a bare "0".
    const h = buildStatHighlights({ statsData: statLine('basketball', { rebounds: 8, assists: 2 }) })!;
    expect(h.hero).toEqual({ value: '8', label: 'REB' });
    expect(h.support).toEqual([{ value: '2', label: 'AST' }]);
  });

  it('falls back to any recorded stat when neither hero nor support keys apply', () => {
    const h = buildStatHighlights({ statsData: statLine('ice_hockey', { pim: 5 }) })!;
    expect(h.hero).toEqual({ value: '5', label: 'Penalty Minutes' });
  });

  it('returns null when nothing at all was recorded', () => {
    expect(buildStatHighlights({ statsData: statLine('basketball', {}) })).toBeNull();
    expect(buildStatHighlights({ statsData: statLine('basketball', { points: 0, rebounds: 0 }) })).toBeNull();
  });

  it('carries opponent, date and result through for the card header', () => {
    const h = buildStatHighlights({
      statsData: statLine('soccer', { goals: 2 }, {
        opponent: 'Rivals FC', date: '2026-07-17', result: 'W', result_score: '4-2',
      }),
    })!;
    expect(h.moment).toBe('vs Rivals FC');
    expect(h.date).toBe('2026-07-17');
    expect(h.result).toBe('W');
    expect(h.resultScore).toBe('4-2');
  });

  it('falls back to the sport activity noun when no opponent was given', () => {
    expect(buildStatHighlights({ statsData: statLine('volleyball', { kills: 4 }) })!.moment).toBe('Match');
  });

  it('ignores payloads that are not stat lines', () => {
    expect(buildStatHighlights({ statsData: { type: 'vitals_entry', metric_label: 'Weight' } })).toBeNull();
    expect(buildStatHighlights({ statsData: null })).toBeNull();
    expect(buildStatHighlights({})).toBeNull();
  });

  it('every live stat-line schema declares a hero and support keys that exist', () => {
    for (const [sport, schema] of Object.entries(STAT_SCHEMAS)) {
      expect(schema!.heroStat.label, sport).toBeTruthy();
      const keys = schema!.fields.map(f => f.key);
      for (const k of schema!.supportKeys) expect(keys, `${sport}:${k}`).toContain(k);
    }
  });
});

describe('buildStatHighlights — golf', () => {
  const round = (over: Record<string, unknown> = {}) => ({
    course: 'Ottawa Hunt',
    gross_score: 69,
    golf_holes: Array.from({ length: 18 }, () => ({ par: 4 })), // par 72
    ...over,
  });

  it('leads with to-par and keeps the gross score as a supporting stat', () => {
    const h = buildStatHighlights({ sportKey: 'golf', golfRound: round() })!;
    expect(h.hero).toEqual({ value: '-3', label: 'To Par' });
    expect(h.heroToPar).toBe(-3);
    expect(h.moment).toBe('Ottawa Hunt');
  });

  it('renders level par as E and over par with an explicit +', () => {
    expect(buildStatHighlights({ sportKey: 'golf', golfRound: round({ gross_score: 72 }) })!.hero.value).toBe('E');
    expect(buildStatHighlights({ sportKey: 'golf', golfRound: round({ gross_score: 75 }) })!.hero.value).toBe('+3');
  });

  it('adds GIR / fairways / putts in the priority golf already uses elsewhere', () => {
    const h = buildStatHighlights({
      sportKey: 'golf',
      golfRound: round({ gir_percentage: 61.1, fir_percentage: 78.4, total_putts: 28 }),
    })!;
    expect(h.support.map(t => t.label)).toEqual(['GIR', 'Fairways', 'Putts']);
    expect(h.support[0].value).toBe('61%');
  });

  it('still renders when hole detail is missing, falling back to the raw score', () => {
    const h = buildStatHighlights({ sportKey: 'golf', golfRound: round({ golf_holes: null }) })!;
    expect(h.heroToPar).toBeNull();
    expect(h.hero.value).toBe('69');
  });

  it('returns null for a golf post with no round at all', () => {
    expect(buildStatHighlights({ sportKey: 'golf' })).toBeNull();
  });
});

describe('buildStatHighlights — shared golf rounds', () => {
  const scorecard = (participants: unknown[], golf = {}) => ({
    golf_data: { course_name: 'Eagle Creek', holes_played: 18, game_format: 'stroke', ...golf },
    participants,
  });
  const row = (profile_id: string, total_score: number, to_par: number | null) => ({
    participant: { profile_id },
    scores: { total_score, to_par },
  });

  it('leads with TO PAR, not the raw score with to-par as its label', () => {
    // Regression: deferring to buildPostHeadline flattens to-par into the
    // label, so the card rendered "75" big with "+3" underneath it.
    const h = buildStatHighlights({
      sportKey: 'golf',
      groupScorecard: scorecard([row('u1', 75, 3)]),
      viewerId: 'u1',
    })!;
    expect(h.hero).toEqual({ value: '+3', label: 'To Par' });
    expect(h.heroToPar).toBe(3);
    // The score lives in the player row now, not a support tile.
    expect(h.support).toEqual([]);
    expect(h.players![0].score).toBe(75);
    expect(h.moment).toBe('Eagle Creek');
  });

  it("uses the VIEWER's row when they played, not the leader's", () => {
    const card = scorecard([row('leader', 68, -4), row('me', 82, 10)]);
    expect(buildStatHighlights({ sportKey: 'golf', groupScorecard: card, viewerId: 'me' })!.hero.value).toBe('+10');
    // …and the leader's when the viewer wasn't in the round
    expect(buildStatHighlights({ sportKey: 'golf', groupScorecard: card, viewerId: 'someone-else' })!.hero.value).toBe('-4');
  });

  it('renders level par as E and carries holes/format in the meta line', () => {
    const h = buildStatHighlights({
      sportKey: 'golf',
      groupScorecard: scorecard([row('u1', 72, 0)]),
      viewerId: 'u1',
    })!;
    expect(h.hero.value).toBe('E');
    expect(h.meta).toEqual(['18 holes', 'Stroke Play']);
  });

  it('falls back to the score when a shared round has no to-par recorded', () => {
    const h = buildStatHighlights({
      sportKey: 'golf',
      groupScorecard: scorecard([row('u1', 79, null)]),
      viewerId: 'u1',
    })!;
    expect(h.hero).toEqual({ value: '79', label: 'Score' });
    expect(h.heroToPar).toBeNull();
  });

  it('returns null when nobody in the shared round has scored yet', () => {
    expect(
      buildStatHighlights({
        sportKey: 'golf',
        groupScorecard: scorecard([{ participant: { profile_id: 'u1' }, scores: { total_score: null, to_par: null } }]),
      })
    ).toBeNull();
  });
});

describe('buildStatHighlights — golf players and round metadata', () => {
  const player = (id: string, first: string, last: string, avatar: string | null, total: number, toPar: number | null) => ({
    participant: { profile_id: id, profile: { first_name: first, last_name: last, full_name: `${first} ${last}`, avatar_url: avatar } },
    scores: { total_score: total, to_par: toPar },
  });
  const card = (participants: unknown[], golf = {}, groupPost = {}) => ({
    group_post: { date: '2026-08-01', ...groupPost },
    golf_data: { course_name: 'Eagle Creek Golf Club', holes_played: 18, game_format: 'stroke', ...golf },
    participants,
  });

  it('keeps CREATION order — never re-sorts by score', () => {
    // Tom's rule: the order players were entered at creation holds on every
    // surface. The payload arrives pre-sorted by participantOrder; a worse
    // score entered first stays first.
    const h = buildStatHighlights({
      sportKey: 'golf',
      groupScorecard: card([
        player('tom', 'Tom', 'K', 'https://cdn/tom.jpg', 8, 4),
        player('tp', 'Test', 'Partner', null, 5, 1),
      ]),
      viewerId: 'tom',
    })!;
    expect(h.players!.map(p => [p.name, p.score, p.toPar])).toEqual([
      ['Tom K', 8, 4],
      ['Test Partner', 5, 1],
    ]);
    expect(h.players![0].avatarUrl).toBe('https://cdn/tom.jpg');
    expect(h.players![0].isViewer).toBe(true);
    expect(h.players![1].avatarUrl).toBeNull(); // initials fallback in the card
    expect(h.players![0].shortName).toBe('Tom K');
  });

  it('excludes participants who never scored', () => {
    const h = buildStatHighlights({
      sportKey: 'golf',
      groupScorecard: card([
        player('a', 'A', 'One', null, 80, 8),
        { participant: { profile_id: 'b', profile: { first_name: 'B', last_name: 'Two' } }, scores: { total_score: null, to_par: null } },
      ]),
    })!;
    expect(h.players).toHaveLength(1);
  });

  it('labels the game format instead of leaking the raw column value', () => {
    // Regression: the card used to print the literal "stroke".
    expect(buildStatHighlights({ sportKey: 'golf', groupScorecard: card([player('a','A','One',null,72,0)]) })!.meta)
      .toEqual(['18 holes', 'Stroke Play']);
    expect(buildStatHighlights({ sportKey: 'golf', groupScorecard: card([player('a','A','One',null,72,0)], { game_format: 'match' }) })!.meta)
      .toContain('Match Play');
  });

  it('carries the round date through for the card header', () => {
    expect(buildStatHighlights({ sportKey: 'golf', groupScorecard: card([player('a','A','One',null,72,0)]) })!.date).toBe('2026-08-01');
  });

  it('drops the support tiles once players are shown — the roster says it already', () => {
    expect(buildStatHighlights({ sportKey: 'golf', groupScorecard: card([player('a','A','One',null,72,0)]) })!.support).toEqual([]);
  });

  it('builds each player\'s hole preview from hole_scores with pars from hole_data', () => {
    const p = player('a', 'A', 'One', null, 9, 1);
    p.scores = {
      ...p.scores,
      // Unsorted on purpose — the strip must come out hole-ordered.
      hole_scores: [
        { hole_number: 2, strokes: 5 },
        { hole_number: 1, strokes: 4 },
      ],
    } as typeof p.scores;
    const h = buildStatHighlights({
      sportKey: 'golf',
      groupScorecard: card([p], { hole_data: [{ hole: 1, par: 3 }, { hole: 2, par: 4 }] }),
    })!;
    expect(h.players![0].holes).toEqual([
      { hole: 1, strokes: 4, par: 3 },
      { hole: 2, strokes: 5, par: 4 },
    ]);
  });

  it('falls back to par 4 when a pre-039 round has no hole_data — same as the full card', () => {
    const p = player('a', 'A', 'One', null, 5, 1);
    p.scores = { ...p.scores, hole_scores: [{ hole_number: 1, strokes: 5 }] } as typeof p.scores;
    const h = buildStatHighlights({ sportKey: 'golf', groupScorecard: card([p]) })!;
    expect(h.players![0].holes).toEqual([{ hole: 1, strokes: 5, par: 4 }]);
  });

  it('score-only participants get an empty preview, not a crash', () => {
    const h = buildStatHighlights({ sportKey: 'golf', groupScorecard: card([player('a','A','One',null,72,0)]) })!;
    expect(h.players![0].holes).toEqual([]);
  });

  describe('solo rounds', () => {
    const solo = (over = {}) => ({ course: 'St. Andrews Old Course', date: '2026-07-24', gross_score: 89, par: 72, holes: 18, ...over });
    const author = { id: 'tom', first_name: 'Tom', last_name: 'K', full_name: 'Tom K', avatar_url: 'https://cdn/tom.jpg' };

    it('reads par from the COLUMN, so to-par survives without joined holes', () => {
      // Regression: par was only ever summed from golf_holes, so a payload
      // without hole detail silently lost to-par.
      const h = buildStatHighlights({ sportKey: 'golf', golfRound: solo(), author, viewerId: 'tom' })!;
      expect(h.hero).toEqual({ value: '+17', label: 'To Par' });
      expect(h.heroToPar).toBe(17);
    });

    it('uses `holes`, not `holes_played`, for the meta line', () => {
      // Regression: GolfRoundLike named this holes_played, which golf_rounds
      // does not have — so the holes never rendered for a solo round.
      expect(buildStatHighlights({ sportKey: 'golf', golfRound: solo(), author })!.meta).toEqual(['18 holes']);
    });

    it('shows the post author as the single player', () => {
      const h = buildStatHighlights({ sportKey: 'golf', golfRound: solo(), author, viewerId: 'tom' })!;
      expect(h.players).toEqual([
        { profileId: 'tom', name: 'Tom K', shortName: 'Tom K', avatarUrl: 'https://cdn/tom.jpg', score: 89, toPar: 17, isViewer: true, holes: [] },
      ]);
    });

    it('carries a sorted hole-by-hole preview and drops strokes-less rows', () => {
      // Unsorted input + one par-only row (hole entered but never scored):
      // the strip must show only played holes, in order, with par attached.
      const h = buildStatHighlights({
        sportKey: 'golf',
        golfRound: solo({
          golf_holes: [
            { hole_number: 3, par: 5, strokes: 4 },
            { hole_number: 1, par: 4, strokes: 5 },
            { hole_number: 2, par: 3 }, // no strokes — dropped
          ],
        }),
        author,
      })!;
      expect(h.players![0].holes).toEqual([
        { hole: 1, strokes: 5, par: 4 },
        { hole: 3, strokes: 4, par: 5 },
      ]);
    });

    it('sums recorded-hole pars for a PARTIALLY recorded round', () => {
      // An 18-hole round abandoned after 12 holes: gross is a 12-hole sum, so
      // to-par must compare against 12 holes of par, not the column's 72 —
      // otherwise every partial round reads absurdly under par.
      const h = buildStatHighlights({
        sportKey: 'golf',
        golfRound: solo({
          gross_score: 50,
          golf_holes: Array.from({ length: 12 }, () => ({ par: 4 })), // par 48
        }),
        author,
      })!;
      expect(h.hero).toEqual({ value: '+2', label: 'To Par' });
      expect(h.heroToPar).toBe(2);
    });

    it('hides zero/unrecorded GIR, fairways and putts', () => {
      // Tom's real rounds record 0% for both — "0% GIR · 0% FWY" reads broken.
      const h = buildStatHighlights({
        sportKey: 'golf',
        golfRound: solo({ gir_percentage: 0, fir_percentage: 0, total_putts: null }),
        author,
      })!;
      expect(h.support).toEqual([]);
      const withStats = buildStatHighlights({
        sportKey: 'golf',
        golfRound: solo({ gir_percentage: 61.1, fir_percentage: 0, total_putts: 30 }),
        author,
      })!;
      expect(withStats.support.map(t => t.label)).toEqual(['GIR', 'Putts']);
    });
  });
});

describe('coursePar', () => {
  const holes = (n: number, par = 4) => Array.from({ length: n }, () => ({ par }));

  it('prefers the column when hole detail is absent', () => {
    expect(coursePar({ par: 72 })).toBe(72);
    expect(coursePar({ par: 72, golf_holes: null })).toBe(72);
    expect(coursePar({ par: 72, golf_holes: [] })).toBe(72);
  });

  it('prefers the column for a fully recorded round', () => {
    // Column beats the sum on complete rounds — the #73 rule: the column is
    // authoritative, holes are a fallback for pre-column payloads.
    expect(coursePar({ par: 70, holes: 18, golf_holes: holes(18) })).toBe(70);
  });

  it('sums recorded pars for a partially recorded round', () => {
    // 12 of 18 holes recorded: gross is a partial sum, so par must be too.
    expect(coursePar({ par: 72, holes: 18, golf_holes: holes(12) })).toBe(48);
  });

  it('falls back to the sum when the column is missing or zero', () => {
    expect(coursePar({ golf_holes: holes(18) })).toBe(72);
    expect(coursePar({ par: 0, golf_holes: holes(9, 4) })).toBe(36);
  });

  it('keeps the column when completeness is unknowable (no holes count)', () => {
    // golf_holes joined but the round row carries no `holes` column: we can't
    // tell partial from complete, so the authoritative column wins.
    expect(coursePar({ par: 72, golf_holes: holes(12) })).toBe(72);
  });

  it('returns null when nothing usable is present', () => {
    expect(coursePar(null)).toBeNull();
    expect(coursePar(undefined)).toBeNull();
    expect(coursePar({})).toBeNull();
    expect(coursePar({ par: null, golf_holes: [{ par: 4 }, { par: null }] })).toBeNull();
  });
});
