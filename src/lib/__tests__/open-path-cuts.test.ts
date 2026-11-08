import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The three cuts the open-path budget exposed (performance program Phase 2d,
 * Nov 2026 — `e2e/perf-feed.spec.ts` counted 23 API calls on a cold /feed):
 * the messages provider's second pulse read, one /api/follow/stats per
 * suggested person, and the browser Sentry's beacons on a clean load.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('one pulse read on open', () => {
  it('the messages provider reuses a pulse younger than the stale gate instead of fetching its own', () => {
    const src = read('src/lib/messages.tsx');
    expect(src).toMatch(/if \(Date\.now\(\) - getPulse\(\)\.fetchedAt <= PULSE_STALE_MS\) return;\s*await fetchPulse\(\);/);
    expect(src).toMatch(/import \{ PULSE_STALE_MS \} from '@\/lib\/pulse\/pulse-rules'/);
  });
});

describe('the suggestions carry the follow stats', () => {
  it('the route reads the counts and the viewer\'s follow rows in TWO batched reads for the whole list', () => {
    const src = read('src/app/api/suggestions/route.ts');
    expect(src).toMatch(/supabase\.from\('profiles'\)\.select\('id, visibility, followers_count'\)\.in\('id', ids\)/);
    expect(src).toMatch(/supabase\.from\('follows'\)\.select\('following_id, status'\)\.eq\('follower_id', profileId\)\.in\('following_id', ids\)/);
    // The same answers the stats route gives: a missing profile is private, any follow row counts.
    expect(src).toContain("is_private: row ? row.visibility === 'private' : true");
    expect(src).toMatch(/follow_status: followOf\.has\(s\.suggested_id\) \? \(followOf\.get\(s\.suggested_id\) \?\? 'accepted'\) : null/);
  });
  it('the follow button starts from the stats a list carried and never asks for them itself', () => {
    const src = read('src/components/FollowButton.tsx');
    expect(src).toContain('initialStats?: FollowStats;');
    expect(src).toMatch(/useState\(initialStats\?\.isFollowing \?\? false\)/);
    expect(src).toMatch(/useState\(initialStats\?\.isPrivate \?\? true\)/);
    expect(src).toMatch(/useState\(!initialStats\)/);
    expect(src).toMatch(/if \(profileId && currentUserId && !initialStatsRef\.current\) run\(\);/);
  });
  it('the suggestions list hands the stats over, and treats an answer without them as before', () => {
    const src = read('src/components/ConnectionSuggestions.tsx');
    expect(src).toMatch(/typeof suggestion\.followers_count === 'number'\s*\?\s*\{/);
    expect(src).toContain('isFollowing: suggestion.follow_status != null,');
    expect(src).toContain("isPrivate: suggestion.is_private !== false,");
    expect(src).toMatch(/:\s*undefined\s*\}/);
  });
});

describe('the browser sends nothing without an error', () => {
  it('the client init drops the session + tracing integrations and the client reports; traces are 0 everywhere', () => {
    const client = read('src/instrumentation-client.ts');
    expect(client).toContain('integrations: browserBeaconIntegrations,');
    expect(client).toContain('sendClientReports: false,');
    const env = read('src/lib/observability/sentry-env.ts');
    expect(env).toMatch(/new Set\(\['BrowserSession', 'BrowserTracing'\]\)/);
    expect(env).toMatch(/function tracesSampleRateFor\(environment: AppEnvironment\): number \{\s*void environment;\s*return 0;/);
  });
});
