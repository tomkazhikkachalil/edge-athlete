import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Program C, PR C1 (migration 269, Oct 19 2026 — Convention 47): sports are
// the profile's (Media + Stats), training is Training's, the feed is a
// SWITCH. These pins hold the SQL: the training predicate at exactly the
// four Media / Stats sites and nowhere else, feed_following filtering
// on_feed, the backfills in their order, and nothing touching posts.status.

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
const sql = read('database/migrations/269_feed_switch_training_buckets.sql');
const bodyOf = (fn: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  const next = sql.indexOf('CREATE OR REPLACE FUNCTION public.', start + 10);
  return sql.slice(start, next === -1 ? undefined : next);
};
const PRED = /AND p\.post_category IS DISTINCT FROM 'training'\s+AND \(p\.stats_data->>'type'\) IS DISTINCT FROM 'activity'/g;

describe('269: the training predicate', () => {
  it('sits in get_profile_all_media once, get_profile_stats_media once, the counts twice — and never in tagged or statements', () => {
    expect(bodyOf('get_profile_all_media').match(PRED)?.length).toBe(1);
    expect(bodyOf('get_profile_stats_media').match(PRED)?.length).toBe(1);
    expect(bodyOf('get_profile_media_counts').match(PRED)?.length).toBe(2);
    expect(bodyOf('get_profile_tagged_media').match(PRED)).toBeNull();
    expect(bodyOf('get_profile_statements_media').match(PRED)).toBeNull();
    // the comment in the header plus the four sites — nothing stray
    expect(sql.match(/IS DISTINCT FROM 'training'/g)?.length).toBe(5);
  });
  it('uses IS DISTINCT FROM (post_category is nullable) and never a bare <>', () => {
    expect(sql).not.toMatch(/post_category <> 'training'/);
    expect(sql).not.toMatch(/post_category != 'training'/);
  });
  it('the counts stay in step with the grids (the 068 drift rule): the same predicate text at both pairs', () => {
    const grid = bodyOf('get_profile_all_media').match(PRED)![0].replace(/\s+/g, ' ');
    const count = bodyOf('get_profile_media_counts').match(PRED)![0].replace(/\s+/g, ' ');
    expect(count).toBe(grid);
  });
});

describe('269: the feed switch and the columns', () => {
  it('feed_following filters p.on_feed first and keeps 230\'s shape', () => {
    const ff = bodyOf('feed_following');
    expect(ff).toMatch(/WHERE p\.on_feed\s+--[^\n]*\n\s+AND \(p\.profile_id = p_viewer/);
    expect(ff).toContain("AND f.status = 'accepted'");
    expect(ff).toContain('LIMIT GREATEST(1, LEAST(p_limit, 101))');
    expect(ff).toContain('REVOKE EXECUTE ON FUNCTION public.feed_following(uuid, integer, timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated;');
  });
  it('adds on_feed (NOT NULL DEFAULT true, no index) and profile_hidden_at, and never writes posts.status', () => {
    expect(sql).toContain('ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS on_feed boolean NOT NULL DEFAULT true;');
    expect(sql).toContain('ALTER TABLE public.workout_sessions ADD COLUMN IF NOT EXISTS profile_hidden_at timestamptz;');
    expect(sql).not.toMatch(/CREATE INDEX[^\n]*on_feed/);
    expect(sql).not.toMatch(/UPDATE public\.posts[^;]*SET status/);
  });
  it('the backfills run in order: the bridged category first, Keep private honoured, then every completed workout decided', () => {
    const a = sql.indexOf("SET post_category = NULL");
    const b = sql.indexOf('SET profile_hidden_at = share_decided_at');
    const c = sql.indexOf('SET share_decided_at = COALESCE(ended_at');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(sql).toContain("AND stats_data->>'type' = 'stat_line'");
  });
});
