import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COPY } from '../copy';

// Flow changes C3 (269, Oct 19 2026): ONE "Post to feed" switch everywhere
// (FeedToggle); the two-card "Post it / Only me" picker is gone, and so is
// every path that wrote a profile decision at the Finish. These pins read
// the source so a host cannot quietly grow a second control.

const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
  const p = path.join(dir, d.name);
  if (d.isDirectory()) return d.name === 'node_modules' || d.name === '__tests__' ? [] : walk(p);
  return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
});

describe('one switch: Post to feed (C3)', () => {
  it('the picker is deleted and no host renders a data-choice card', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/components/posts/PostChoicePicker.tsx'))).toBe(false);
    const offenders = walk(path.join(ROOT, 'src')).filter(f => /data-choice=|PostChoicePicker|onlyMeLine|DEFAULT_CHOICE|PostChoice\b/.test(code(path.relative(ROOT, f))));
    expect(offenders.map(f => path.relative(ROOT, f))).toEqual([]);
  });
  it('the copy has no "Only me"; the OFF line says the item stays on the profile', () => {
    expect(Object.keys(COPY.AUDIENCE).sort()).toEqual(['CHANGE', 'FEED_OFF_LINE', 'FEED_TOGGLE', 'LEGACY_FANS_ONLY', 'WHO_PRIVATE', 'WHO_PUBLIC']);
    expect(COPY.AUDIENCE.FEED_TOGGLE).toBe('Post to feed');
    expect(COPY.AUDIENCE.FEED_OFF_LINE).toMatch(/stays on your profile/);
  });
  it('every host mounts FeedToggle with its kind (memory per kind), an edit without memory', () => {
    const hosts: Array<[string, RegExp]> = [
      ['src/components/activities/record/FinishSheet.tsx', /<FeedToggle [^>]*kind="activity"/],
      ['src/components/workouts/FinishFlow.tsx', /<FeedToggle [^>]*kind="workout"/],
      ['src/app/(app)/athlete/drafts/[postId]/page.tsx', /<FeedToggle [^>]*kind="sport"/],
      ['src/components/CreatePostModal.tsx', /<FeedToggle [^>]*kind=\{feedKind\}/],
      ['src/components/AddBodyMetricModal.tsx', /<FeedToggle [^>]*kind="workout"/],
    ];
    for (const [f, re] of hosts) expect(code(f), f).toMatch(re);
    const edit = code('src/components/EditPostModal.tsx');
    expect(edit).toMatch(/<FeedToggle /);
    expect(edit).not.toMatch(/<FeedToggle [^>]*kind=/);
    expect(edit).toMatch(/\.\.\.\(onFeed !== initialOnFeed \? \{ onFeed \} : \{\}\)/);
  });
  it('the writers carry onFeed; nothing at the Finish writes only_me or keepPrivate', () => {
    expect(code('src/components/CreatePostModal.tsx')).toMatch(/visibility: POST_VISIBILITY,\s*onFeed,/);
    expect(code('src/components/AddBodyMetricModal.tsx')).toMatch(/visibility: POST_VISIBILITY,\s*onFeed,/);
    expect(code('src/app/(app)/athlete/drafts/[postId]/page.tsx')).toMatch(/action: 'post', onFeed/);
    const recorder = code('src/components/activities/record/RecordActivityScreen.tsx');
    expect(recorder).not.toMatch(/onlyMe/);
    expect(recorder).toMatch(/if \(onFeed\) \{/);
    const workout = code('src/components/workouts/WorkoutEditorScreen.tsx');
    expect(workout).not.toMatch(/keepPrivate/);
    expect(workout).toMatch(/body: JSON\.stringify\(\{ hidden: !profileHidden \}\)/);
    expect(code('src/components/drafts/DraftRow.tsx')).not.toMatch(/keepPrivate|data-draft-keep-private/);
  });
  it('the activity page: Post to feed · On the feed + Remove from feed · Show on feed; the hide pair names the profile', () => {
    const page = code('src/components/activities/ActivityScreen.tsx');
    expect(page).toMatch(/data-activity-feed="on"/);
    expect(page).toMatch(/data-activity-feed="off"/);
    expect(page).toMatch(/data-activity-feed-remove/);
    expect(page).toMatch(/Hide from my profile/);
    expect(page).not.toMatch(/'Only me'|Share to feed|On your feed/);
    expect(page).toMatch(/body: JSON\.stringify\(\{ postId: a\.postId, onFeed: on \}\)/);
  });
});
