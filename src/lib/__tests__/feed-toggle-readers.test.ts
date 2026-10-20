import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Program C, PR C2 (Convention 47, migration 269): the feed is a SWITCH.
// Feed-side readers filter posts.on_feed; profile-side readers never do;
// the writers carry it; Training and the public profile read published rows
// only; a hidden workout is the owner's alone; Finish is the decision. These
// pins read the source, the house way (the 253 pattern).

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the feed is a switch (269)', () => {
  it('the feed arms filter on_feed only when no profile is named; the single-post branch never does', () => {
    const src = code('src/app/api/posts/route.ts');
    expect(src).toMatch(/if \(!userId\) \{\s*query = query\.eq\('on_feed', true\);\s*\}/);
    // exactly one on_feed read filter in the posts route: the lens arm
    expect(src.match(/\.eq\('on_feed', true\)/g)?.length).toBe(1);
  });
  it('explore, the three search reads and the org activity page are feed-side', () => {
    expect(code('src/app/api/explore/route.ts').match(/\.eq\('on_feed', true\)/g)?.length).toBe(1);
    expect(code('src/app/api/search/route.ts').match(/\.eq\('on_feed', true\)/g)?.length).toBe(3);
    expect(code('src/lib/affiliations/activity-server.ts').match(/\.eq\('on_feed', true\)/g)?.length).toBe(1);
  });
  it('the profile-side readers never filter it', () => {
    for (const f of ['src/app/api/profile/[profileId]/media/route.ts', 'src/app/api/public/profile/route.ts', 'src/app/api/vitals/route.ts', 'src/lib/posts/read-gate.ts']) {
      expect(code(f), f).not.toMatch(/on_feed/);
    }
  });
  it('the writers carry it: POST (default true, a boolean), PUT (an edit), the draft Post', () => {
    const src = code('src/app/api/posts/route.ts');
    expect(src).toMatch(/onFeed: rawOnFeed = true/);
    expect(src).toMatch(/typeof rawOnFeed !== 'boolean'/);
    expect(src).toMatch(/on_feed: onFeed,/);
    expect(src).toMatch(/\.\.\.\(typeof body\.onFeed === 'boolean' \? \{ on_feed: body\.onFeed \} : \{\}\)/);
    expect(src).toMatch(/publishDraftPost\(supabase, \{ postId, onFeed: typeof body\.onFeed === 'boolean' \? body\.onFeed : undefined \}\)/);
    const pub = code('src/lib/posts/publish-server.ts');
    expect(pub).toMatch(/input: \{ postId: string; onFeed\?: boolean \}/);
    expect(pub).toMatch(/on_feed: input\.onFeed/);
  });
  it('the training category is stamped only on a general post — a sport-bridged activity stays a sport result', () => {
    const src = code('src/app/api/posts/route.ts');
    expect(src).toMatch(/isActivityShareRequest\(incomingStatsData\) && postType === 'general' \? \('training' as const\) : null/);
  });
});

describe('training is Training\'s; nothing leaks (269)', () => {
  it('Training Activity and the public profile read published rows only; the public grid drops training posts and the count follows', () => {
    const trainingApi = code('src/app/api/vitals/route.ts');
    expect(trainingApi).toMatch(/\.eq\('post_category', 'training'\)\s*\.eq\('status', 'published'\)/);
    const pub = code('src/app/api/public/profile/route.ts');
    expect(pub.match(/\.eq\('status', 'published'\)/g)?.length).toBe(4);
    expect(pub).toMatch(/!isStatementPost\(p\) && !isTrainingPost\(p\)/);
    expect(pub).toMatch(/\(postsCount \|\| 0\) - \(statementsTotal \|\| 0\) - \(trainingTotal \|\| 0\)/);
  });
  it('isTrainingPost mirrors 269\'s SQL', async () => {
    const { isTrainingPost } = await import('../statements');
    expect(isTrainingPost({ post_category: 'training', stats_data: null })).toBe(true);
    expect(isTrainingPost({ post_category: null, stats_data: { type: 'activity' } })).toBe(true);
    expect(isTrainingPost({ post_category: null, stats_data: { type: 'stat_line', sport_key: 'cycling' } })).toBe(false);
    expect(isTrainingPost({ post_category: null, stats_data: null })).toBe(false);
    expect(isTrainingPost({})).toBe(false);
  });
  it('a hidden workout is the owner\'s alone; Finish is the decision; keepPrivate and onlyMe at save are inert', () => {
    const list = code('src/app/api/workouts/route.ts');
    expect(list).toMatch(/query\.eq\('status', 'completed'\)\.is\('profile_hidden_at', null\)/);
    const one = code('src/app/api/workouts/[id]/route.ts');
    expect(one).toMatch(/session\.status !== 'completed' \|\| session\.profile_hidden_at/);
    expect(one).toMatch(/updates\.profile_hidden_at = body\.hidden \? new Date\(\)\.toISOString\(\) : null/);
    expect(one).toMatch(/if \(!session\.share_decided_at\) updates\.share_decided_at = new Date\(\)\.toISOString\(\);/);
    expect(one).toMatch(/const legacyKeepPrivate = body\.keepPrivate === true && Object\.keys\(body\)\.length === 1;/);
    expect(one).not.toMatch(/updates\.share_decided_at = new Date\(\)\.toISOString\(\);\s*\}\s*if \(body\.keepPrivate/);
    const drafts = code('src/lib/drafts/list.ts');
    expect(drafts).not.toMatch(/isWorkoutDraft|WORKOUT_DRAFTS_SINCE|share=1/);
    // Only me at save stays honoured in C2 — the deployed Finish sheet still offers the card; C3 removes both.
    const act = code('src/app/api/activities/route.ts');
    expect(act).toMatch(/if \(onlyMe === true\) \{/);
  });
});
