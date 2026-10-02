import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { anyScoreRecorded, isResultPost } from '../results/kinds';
import { pairHiddenResults } from '../results/hidden-list';

// Results-kept round PR 2 (241, Sep 26 2026). Tom: "hide only, no delete …
// any data metrics recorded will go towards understanding what the athlete's
// athletic score is." A person hides a result from their profile; nothing a
// person does removes it from the handicap, the leaderboards or the dataset.

const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('what is a result', () => {
  it('a round card, an event post, a stat line, anything with a dataset row', () => {
    expect(isResultPost({ group_post_id: 'g' })).toBe(true);
    expect(isResultPost({ sport_event_round_id: 'r' })).toBe(true);
    expect(isResultPost({ stats_data: { type: 'stat_line' } })).toBe(true);
    expect(isResultPost({ stats_data: { sport_event_stat_line_id: 'l' } })).toBe(true);
    expect(isResultPost({}, true)).toBe(true);
  });
  it('an ordinary post (a photo, a vitals entry, a post that only references a round) still deletes', () => {
    expect(isResultPost({})).toBe(false);
    expect(isResultPost({ stats_data: { type: 'vitals_entry' } })).toBe(false);
    expect(isResultPost({ stats_data: null })).toBe(false);
  });
  it('a round anyone scored — the creator included — is data', () => {
    expect(anyScoreRecorded([{ scores: { holes_completed: 0, total_score: null } }])).toBe(false);
    expect(anyScoreRecorded([{ scores: null }, { scores: { holes_completed: 3 } }])).toBe(true);
    expect(anyScoreRecorded([{ scores: { total_score: 81 } }])).toBe(true);
    expect(anyScoreRecorded([])).toBe(false);
  });
});

describe('the one hide writer never touches the record', () => {
  it('hide-server writes only the hide stamps', () => {
    const src = code('src/lib/results/hide-server.ts');
    expect(src).not.toMatch(/\.delete\(/);
    expect(src).not.toMatch(/athlete_performances|golf_holes|handicap/);
    expect(src).toMatch(/update\(\{ profile_hidden_at: hidden \? now : null \}\)/);
    expect(src).toMatch(/update\(\{ status: to, profile_hidden_at: hidden \? now : null \}\)/);
  });
});

describe('the doors hide instead of deleting', () => {
  it('DELETE /api/golf/rounds/[id] hides the round', () => {
    const del = code('src/app/api/golf/rounds/[roundId]/route.ts').split('export async function DELETE')[1];
    expect(del).toMatch(/setWholeResultHidden\(supabase, \{ kind: 'golf_round', id: roundId \}, true, user\.id\)/);
    expect(del).not.toMatch(/\.delete\(\)/);
  });
  it('DELETE /api/posts hides a result post and a scored round; an ordinary post still deletes', () => {
    // The BARE delete — everything after the named-delete block (Oct 2026:
    // `?mode=delete` is the only door that removes a result; results-delete.test.ts).
    const whole = code('src/app/api/posts/route.ts').split('export async function DELETE')[1];
    const del = whole.slice(whole.indexOf('deleteOrHideRound('));
    expect(whole).toMatch(/deleteOrHideRound\(supabase, post\.group_post_id, post\.profile_id\)/);
    expect(del.indexOf('isResultPost(')).toBeGreaterThan(-1);
    expect(del.indexOf('isResultPost(')).toBeLessThan(del.indexOf('deletePostCascade('));
  });
  it('a round creator’s delete goes through deleteOrHideRound', () => {
    expect(code('src/app/api/group-posts/[id]/route.ts')).toMatch(/deleteOrHideRound\(getSupabaseAdmin\(\), id, user\.id\)/);
    const fn = code('src/lib/golf/round-delete-server.ts').split('export async function deleteOrHideRound')[1];
    expect(fn).toMatch(/if \(!hasScores && \(mirrors \?\? 0\) === 0 && !round\.sport_event_round_id\) return deleteRoundCascade/);
  });
  it('a played event is never deleted; a scored decline is refused', () => {
    expect(code('src/app/api/sport-events/[id]/route.ts')).toMatch(/read\.event\.status === 'completed'\) return NextResponse\.json\(\{ error: 'This event has results/);
    const attest = code('src/app/api/group-posts/[id]/attest/route.ts');
    expect(attest).toMatch(/if \(gp\?\.sport_event_round_id\)/);
    expect(attest).toMatch(/holes_completed \?\? 0\) > 0 \|\| sc\.total_score != null/);
  });
});

describe('the opt-out is a profile hide', () => {
  it('the golf mirror stamps a hidden player instead of removing them', () => {
    const src = code('src/lib/golf/round-mirror.ts');
    expect(src).not.toMatch(/removeMirrorFor/);
    expect(src).toMatch(/if \(hidden\.has\(p\.profile_id\)\) \{\s*await admin\.from\('golf_rounds'\)\.update\(\{ profile_hidden_at:/);
    expect(code('src/lib/sport-events/results-server.ts')).not.toMatch(/removeMirrorFor/);
  });
  it('the stat mirror keeps a hidden line (only an empty line unmirrors) and the results post counts every line', () => {
    const src = code('src/lib/sport-events/stat-results-server.ts');
    expect(src).toMatch(/if \(!lineHasStats\(line\.stats\)\) \{\s*await unmirrorLine/);
    expect(src).not.toMatch(/hidden\.has\(line\.profile_id\) \|\| !lineHasStats/);
    expect(src).toMatch(/resultsPostData\(event, round, shape, lines, game\)/);
    expect(src.split('export async function applyStatOptOut')[1]).not.toMatch(/unmirrorLine/);
  });
});

describe('who sees a hidden round', () => {
  it('the owner sees it; the lists and the single page skip it for everyone else', () => {
    expect(code('src/app/api/golf/rounds/route.ts')).toMatch(/if \(profileId !== user\.id\) query = query\.is\('profile_hidden_at', null\)/);
    expect(code('src/app/api/golf/rounds/[roundId]/route.ts')).toMatch(/if \(!canView \|\| round\.profile_hidden_at\)/);
    expect(code('src/lib/org-sites/public-data.ts')).toMatch(/\.is\('profile_hidden_at', null\)/);
  });
  it('the handicap and the dataset readers never filter it (every metric counts)', () => {
    for (const f of ['src/lib/golf/handicap-server.ts', 'src/lib/performance/write-server.ts', 'src/lib/competitions/golf-league-server.ts', 'src/lib/sport-events/contest-sync-server.ts']) {
      expect(code(f), f).not.toMatch(/profile_hidden_at/);
    }
  });
});

// ── The sweep: only NAMED writers delete a round or a dataset row ───────────
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('the delete allowlist (a new deleting path fails the gate)', () => {
  const ALLOWED: Record<string, string> = {
    'src/lib/account-deletion.ts': 'the account-erasure path (the departure rules decide what survives)',
    'src/lib/golf/round-delete-server.ts': 'an UNPLAYED round only (deleteOrHideRound decides)',
    'src/lib/results/delete-server.ts': 'the player’s own for-fun result, asked for by name (Oct 2026; delete-rule.ts decides — official and event results are refused)',
    'src/lib/golf/post-write.ts': 'the rollback of a round whose holes failed to save, before any post exists',
    'src/lib/sport-events/opt-out.ts': 'removeMirrorFor — support’s mistaken-result removal (results-kept PR 4); no user door calls it',
    'src/lib/performance/write-server.ts': 'the dataset writer itself (a row whose origin is gone)',
  };
  it('every .delete() on golf_rounds or athlete_performances is in a named writer', () => {
    const offenders: string[] = [];
    for (const f of walk(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, f);
      const src = code(rel);
      for (const table of ['golf_rounds', 'athlete_performances']) {
        const re = new RegExp(`from\\('${table}'\\)[\\s\\S]{0,120}?\\.delete\\(`, 'g');
        if (re.test(src) && !ALLOWED[rel]) offenders.push(`${rel} deletes ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it('removeMirrorFor has no user-door caller', () => {
    const callers = walk(path.join(ROOT, 'src')).filter(f => !f.endsWith('opt-out.ts') && /removeMirrorFor\(/.test(code(path.relative(ROOT, f))));
    // PR 4: only support's mistaken-result removal (owner-only, on a ticket) calls it.
    expect(callers.map(f => path.relative(ROOT, f))).toEqual(['src/lib/results/correction-server.ts']);
  });
});

// ── Fix round (Oct 2026): a hide has to be SEEN to have happened ────────────
describe('hidden means hidden — and one result is one thing', () => {
  it('the feed never hands a hidden result back to its owner; their own profile list does', () => {
    const src = code('src/app/api/posts/route.ts');
    expect(src).toMatch(/const ownProfileList = !!userId && userId === currentUserId && !pinnedOnly;/);
    expect(src).toMatch(/and\(profile_id\.eq\.\$\{currentUserId\},status\.neq\.profile_hidden\)/);
  });
  it('every door hides or shows the WHOLE result (the post and the stats row together)', () => {
    expect(code('src/app/api/results/visibility/route.ts')).toMatch(/setWholeResultHidden\(admin, \{ kind, id \}, hidden, owner\)/);
    const whole = code('src/lib/results/hide-server.ts').split('export async function setWholeResultHidden')[1];
    // The partner row is the SAME owner's only: a playing partner hiding their
    // round never hides the creator's post.
    expect(whole.match(/\.eq\('profile_id', ownerId\)/g)?.length).toBe(4);
  });
  it("other viewers' recent-rounds list skips a hidden round; the owner's keeps it", () => {
    expect(code('src/app/api/golf/stats/route.ts')).toMatch(/viewer\.id === profileId \? scopedRounds : scopedRounds\.filter\(r => !r\.profile_hidden_at\)/);
  });
  it('only the owner is told which of their own tiles are hidden', () => {
    expect(code('src/app/api/profile/[profileId]/media/route.ts')).toMatch(/if \(viewerId === profileId && items\.length > 0\)/);
  });

  const round = (id: string, group: string | null) => ({ id, date: '2026-10-01', course: 'Pine Hills', gross_score: 84, profile_hidden_at: '2026-10-02T00:00:00Z', group_post_id: group });
  const post = (id: string, group: string | null, roundId: string | null = null) => ({ id, caption: null, sport_key: 'golf', created_at: '2026-10-01T18:00:00Z', profile_hidden_at: '2026-10-02T00:00:00Z', group_post_id: group, round_id: roundId });

  it('folds a hidden round into its hidden post, carrying the course and the score', () => {
    const out = pairHiddenResults([round('r1', 'g1')], [post('p1', 'g1')]);
    expect(out.rounds).toEqual([]);
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]).toMatchObject({ id: 'p1', course: 'Pine Hills', gross_score: 84 });
  });
  it('pairs a legacy post by its round_id', () => {
    const out = pairHiddenResults([round('r1', null)], [post('p1', null, 'r1')]);
    expect(out.rounds).toEqual([]);
    expect(out.posts[0].course).toBe('Pine Hills');
  });
  it("keeps a round with no hidden post (a partner's round on someone else's card) and a post with no round (a stat line)", () => {
    const out = pairHiddenResults([round('r1', 'g1')], [post('p2', null)]);
    expect(out.rounds.map(r => r.id)).toEqual(['r1']);
    expect(out.posts[0]).toMatchObject({ id: 'p2', course: null, gross_score: null });
  });
});
