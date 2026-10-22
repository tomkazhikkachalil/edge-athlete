import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The feed's cold-load layout shift (Oct 10 2026 measurement: LCP 5.2 s,
// CLS 0.35 on a mid-range Android; the Get Started card appeared ~2.3 s in
// and pushed the feed down 246 px, the suggestions' skeleton collapsed).
// Tom (Oct 22): reserve the card's space. The rule is pure
// (shouldReserveGetStarted, get-started.test); these pin the two components.

const SRC = join(__dirname, '..', '..');
const card = readFileSync(join(SRC, 'components', 'GetStartedCard.tsx'), 'utf8');
const suggestions = readFileSync(join(SRC, 'components', 'ConnectionSuggestions.tsx'), 'utf8');
const profile = readFileSync(join(SRC, 'lib', 'supabase.ts'), 'utf8');

describe('the Get Started card holds its place', () => {
  it('decides in render from the profile it already holds, with the clock and the device key read once at mount', () => {
    expect(card).toContain('const [now] = useState(() => Date.now());');
    expect(card).toContain('const [deviceClosed] = useState(() => (user ? safeGetDismissed(user.id) : false));');
    expect(card).toContain('shouldReserveGetStarted({ createdAt: createdAtIso, userType, browserDismissed: deviceClosed }, now)');
    expect(card).not.toContain('useLayoutEffect');
    // The API is asked only once the card is on screen, never before the gate.
    expect(card).toContain("if (!user || !reserved) return;\n    const userId = user.id;");
  });
  it('resolves the two local steps from the row and shows the two API steps as not done', () => {
    expect(card).toContain('hasAvatar: !!profile?.avatar_url');
    expect(card).toContain('followingCount: profile?.following_count ?? 0');
    expect(card).toContain('hasCompetitive: false');
    expect(profile).toContain('following_count?: number;');
  });
  it('keeps the resolving height as the floor when the answer lands, in the same commit', () => {
    expect(card).toContain('setMinHeight(sectionRef.current?.offsetHeight ?? null);\n        setState(body);');
    expect(card).toContain('style={minHeight ? { minHeight } : undefined}');
    expect(card).toContain("data-get-started={resolving ? 'resolving' : 'resolved'}");
    expect(card).toContain('aria-busy={resolving || undefined}');
  });
  it('still goes away for good when every step is done, once it knows', () => {
    expect(card).toContain('if (!resolving && remaining.length === 0) return null;');
  });
  it('the sibling cards stay hidden from the first paint (the testid is on the resolving card)', () => {
    expect(card).toContain('data-testid="get-started-card"');
    const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');
    expect(css).toContain('[data-testid="get-started-card"] + [data-install-card]');
  });
});

describe('the suggestions skeleton is the size of the list', () => {
  it('draws as many rows as the list will hold, each the resolved row\'s height', () => {
    expect(suggestions).toContain('Array.from({ length: limit }, (_, i) => (');
    expect(suggestions).toContain('className="flex items-center gap-3 min-h-[72px]"');
    expect(suggestions).toContain('min-h-[72px]'); // the resolved row
    expect(suggestions).toContain('data-feed-suggestions="loading"');
    expect(suggestions).toContain('data-feed-suggestions="ready"');
  });
});
