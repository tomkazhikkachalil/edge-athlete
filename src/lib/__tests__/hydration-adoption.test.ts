import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Where the device store is used (performance program Phase 2b, Nov 2026):
 * the profile painted before its read and kept after it, the pulse's numbers
 * hydrated per account by the host, the feed's first page painted before the
 * read on the default scope and kept after it — and every sign-out path
 * clearing the lot. e2e/hydration.spec.ts proves the paint with the network
 * held back; this pins the wiring.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the device store is wired', () => {
  it('the auth provider paints the remembered profile, keeps a fresh one, and clears on every sign-out', () => {
    const src = read('src/lib/auth.tsx');
    expect(src).toMatch(/const remembered = readDevice<Profile>\(currentUser\.id, 'profile'\);\s*if \(remembered && isMounted\) \{\s*setProfile\(remembered\);\s*setLoading\(false\);\s*setInitialAuthCheckComplete\(true\);/);
    expect(src).toMatch(/setProfile\(data\);[\s\S]{0,200}writeDevice\(userId, 'profile', data\);/);
    // The explicit sign-out and both dead-session branches.
    expect(src.match(/clearDevice\(\)/g)).toHaveLength(3);
    expect(src).toMatch(/resetQueryCache\(\);\s*clearDevice\(\);/);
  });
  it('the pulse host hydrates this account\'s numbers; the store never restores fetchedAt and writes after every fetch', () => {
    expect(read('src/lib/pulse/PulseHost.tsx')).toMatch(/hydratePulse\(user\.id\);/);
    const store = read('src/lib/pulse/pulse-store.ts');
    expect(store).toMatch(/snapshot = \{ \.\.\.remembered, fetchedAt: 0 \};/);
    expect(store).toMatch(/if \(deviceUserId\) writeDevice\(deviceUserId, 'pulse', snapshot\);/);
    expect(store).toMatch(/export function resetPulse\(\): void \{\s*snapshot = EMPTY_PULSE;\s*deviceUserId = null;/);
  });
  it('the feed paints the remembered first page on the default scope only, keeps the spinner off it, and saves a trimmed copy', () => {
    const src = read('src/app/(app)/feed/page.tsx');
    expect(src).toContain("const DEFAULT_FEED_SCOPE = 'all';");
    expect(src).toMatch(/feedScope === DEFAULT_FEED_SCOPE && !hydratedRef\.current && peekCached<FeedPage>/);
    expect(src).toMatch(/if \(!loadMore && !hydratedRef\.current\) \{\s*setFeedLoading\(true\);/);
    expect(src).toMatch(/if \(feedScope === DEFAULT_FEED_SCOPE && user\?\.id\) writeDevice\(user\.id, 'feed', trimFeedForDevice\(newPosts as Post\[\]\)\);/);
  });
  it('nothing else reads or writes the device store', () => {
    const allowed = ['src/lib/auth.tsx', 'src/lib/pulse/pulse-store.ts', 'src/app/(app)/feed/page.tsx', 'src/lib/net/device-store.ts'];
    for (const f of allowed) expect(read(f)).toMatch(/readDevice|writeDevice|clearDevice/);
  });
});
