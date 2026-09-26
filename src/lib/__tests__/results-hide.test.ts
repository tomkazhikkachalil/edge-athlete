import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { anyScoreRecorded, isResultPost } from '../results/kinds';

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
    expect(del).toMatch(/setResultHidden\(supabase, \{ kind: 'golf_round', id: roundId \}, true, user\.id\)/);
    expect(del).not.toMatch(/\.delete\(\)/);
  });
  it('DELETE /api/posts hides a result post and a scored round; an ordinary post still deletes', () => {
    const del = code('src/app/api/posts/route.ts').split('export async function DELETE')[1];
    expect(del).toMatch(/deleteOrHideRound\(supabase, post\.group_post_id, post\.profile_id\)/);
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
    expect(callers.map(f => path.relative(ROOT, f))).toEqual([]);
  });
});
