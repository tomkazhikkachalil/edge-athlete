import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The open path reads through the client cache (performance program, Phase 2
 * — Nov 2026): the Live Now strip is ONE read of `/api/live-now` (the route
 * composes the three it replaces in-process), the header's workout routines
 * are read once and kept, the feed's first page and a profile's three reads
 * paint from the cache on a return, the calendar no longer waits for the
 * roster, and sign-out forgets everything. A regression here is a spinner
 * (or a cold function) someone sees again.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('the aggregate live-now route', () => {
  const src = read('src/app/api/live-now/route.ts');
  it('composes the three live-now handlers in-process and adds no rule of its own', () => {
    expect(src).toMatch(/import \{ GET as golfLiveNow \} from '@\/app\/api\/golf\/live-now\/route'/);
    expect(src).toMatch(/import \{ GET as eventsLiveNow \} from '@\/app\/api\/sport-events\/live-now\/route'/);
    expect(src).toMatch(/import \{ GET as videosLiveNow \} from '@\/app\/api\/videos\/live-now\/route'/);
    expect(src).not.toMatch(/getSupabaseAdmin|\.from\(|\.rpc\(|requireAuth|enforceRateLimit/);
    expect(src).toContain("'Cache-Control': 'private, max-age=10'");
  });
});

describe('the strip, the header, the feed, the profile, the calendar', () => {
  it('LiveNowStrip reads /api/live-now through the cache and nothing else', () => {
    const src = read('src/components/LiveNowStrip.tsx');
    expect(src).toMatch(/readCached<LiveNowPayload>\(\s*LIVE_NOW_KEY/);
    expect(src).not.toMatch(/fetch\('\/api\/(golf|sport-events|videos)\/live-now'/);
    expect(src.match(/\bfetch\(/g) ?? []).toHaveLength(0);
  });
  it('the workout routines are read through the cache with a five-minute lifetime and invalidated by refreshRoutines', () => {
    const src = read('src/hooks/useStartWorkout.ts');
    expect(src).toMatch(/readCached<\{ routines\?: WorkoutRoutine\[\] \}>\(\s*ROUTINES_KEY/);
    expect(src).toMatch(/const ROUTINES_STALE_MS = 5 \* 60_000/);
    expect(src).toMatch(/const refreshRoutines = \(\) => \{\s*invalidate\(ROUTINES_KEY\)/);
    expect(src).not.toMatch(/fetch\('\/api\/workout-routines'/);
  });
  it('the feed caches its first page for thirty seconds and forgets it when a post is created or deleted', () => {
    const src = read('src/app/(app)/feed/page.tsx');
    expect(src).toMatch(/const FEED_STALE_MS = 30_000/);
    expect(src).toMatch(/readCached<FeedPage>\(url/);
    expect(src).toMatch(/const handlePostCreated = async \(newPost: unknown\) => \{\s*invalidate\('\/api\/posts'\)/);
    expect(src).toMatch(/const handleDelete = useCallback\(async \(postId: string, mode\?: 'delete'\) => \{\s*invalidate\('\/api\/posts'\)/);
  });
  it('the athlete page reads the profile, the achievements and the skill cards through the cache', () => {
    const src = read('src/app/(app)/athlete/[id]/page.tsx');
    expect(src).toMatch(/const PROFILE_STALE_MS = 60_000/);
    expect(src.match(/readCached</g) ?? []).toHaveLength(3);
    expect(src).not.toMatch(/fetch\(`\/api\/profile\?id=/);
  });
  it('the feed calendar reads the own calendar at once — no wait on the roster', () => {
    const src = read('src/components/calendar/FeedCalendarWidget.tsx');
    expect(src).not.toMatch(/people === null\) return/);
    expect(src).toMatch(/readCached<\{ events\?: EventListItem\[\] \}>\(url/);
  });
  it('sign-out forgets the cache', () => {
    expect(read('src/lib/auth.tsx')).toMatch(/resetQueryCache\(\)/);
  });
  it('nothing else fetches /api/live-now directly — the strip is its one reader', () => {
    const direct = walk(join(ROOT, 'src'))
      .filter((f) => !/LiveNowStrip|query-cache/.test(f))
      .filter((f) => /['"`]\/api\/live-now['"`?]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1));
    expect(direct).toEqual([]);
  });
  it('every writer of a routine forgets the cached list (the header shows the right routines after a save or a delete)', () => {
    const writers = walk(join(ROOT, 'src'))
      .filter((f) => !/__tests__|\/api\//.test(f))
      .map((f) => [f.slice(ROOT.length + 1), readFileSync(f, 'utf8')] as const)
      .filter(([, src]) => /fetch\((?:'\/api\/workout-routines'|`\/api\/workout-routines\/\$\{[^`]*`)[^;]*method:\s*'(POST|PATCH|PUT|DELETE)'/.test(src));
    expect(writers.length).toBeGreaterThanOrEqual(3);
    for (const [rel, src] of writers) expect(src, rel).toMatch(/invalidate\('\/api\/workout-routines'\)/);
  });
});
