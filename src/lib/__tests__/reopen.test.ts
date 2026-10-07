import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { reopenActions, reopenSeenKey, reopenSkipsPath } from '../drafts/reopen';
import type { DraftItem } from '../drafts/list';

// Drafts round PR 4 (Oct 2026): the reopen prompt — once per app open, the
// one most recent in-progress thing, Resume / Finish / Discard.

const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const item = (over: Partial<DraftItem>): DraftItem => ({
  kind: 'round', id: 'gp1', postId: 'p1', state: 'in_progress', title: 'Pine Hills', startedAt: '2026-10-05', lastActivityAt: null, href: '/live/gp1', isCreator: true, scored: true, ...over,
});

describe('reopenActions', () => {
  it("the creator of a scored round: Resume, Finish (→ the review screen), Discard", () => {
    expect(reopenActions(item({}))).toMatchObject({ resume: true, finish: true, discard: true });
  });
  it('a scoreless round has nothing to finish: Resume or Discard', () => {
    expect(reopenActions(item({ scored: false }))).toMatchObject({ finish: false, discard: true });
  });
  it("a playing partner only resumes — the round is the creator's to finish or discard", () => {
    expect(reopenActions(item({ isCreator: false }))).toMatchObject({ resume: true, finish: false, discard: false });
  });
  it('a workout and a recording on this phone get all three', () => {
    expect(reopenActions(item({ kind: 'workout', id: 'w1', href: '/app/workout/w1' }))).toMatchObject({ finish: true, discard: true });
    expect(reopenActions(item({ kind: 'recording', id: 'r1', href: '/activities/record' }))).toMatchObject({ finish: true, discard: true });
  });
});

describe('once per app open, never over the thing itself', () => {
  it('the key is per account', () => {
    expect(reopenSeenKey('u1')).toBe('ea:reopen-prompt:v1:u1');
    expect(reopenSeenKey('u2')).not.toBe(reopenSeenKey('u1'));
  });
  it('skips the live page, the recorder, the workout editor and the Drafts area; asks everywhere else', () => {
    for (const p of ['/live/gp1', '/activities/record', '/app/workout/w1', '/athlete/drafts', '/athlete/drafts/p1', null, '']) expect(reopenSkipsPath(p)).toBe(true);
    for (const p of ['/feed', '/athlete', '/athlete/x', '/live', '/sports', '/calendar', '/app/notifications', '/activities/a1']) expect(reopenSkipsPath(p)).toBe(false);
  });
});

describe('one door at the top of every page', () => {
  it('the host is mounted once in the app root layout', () => {
    const layout = read('src/app/(app)/layout.tsx');
    expect(layout).toMatch(/<ReopenPromptHost \/>/);
    expect(layout.match(/<ReopenPromptHost \/>/g)?.length).toBe(1);
  });
  it("the feed's live-round banner and the Vitals workout banner are gone (the prompt and Drafts are the doors)", () => {
    expect(read('src/app/(app)/feed/page.tsx')).not.toMatch(/live-banner-dismissed|Continue scoring/);
    expect(read('src/components/VitalsTab.tsx')).not.toMatch(/workout-banner-dismissed|Resume banner — a live session/);
  });
  it('the host decides only after the server list AND the phone answered, and remembers in sessionStorage', () => {
    const host = read('src/components/drafts/ReopenPromptHost.tsx');
    expect(host).toMatch(/!checkedPhone \|\| !drafts\.loaded\) return;/);
    expect(host).toMatch(/sessionStorage\.setItem\(reopenSeenKey\(user\.id\), '1'\)/);
  });
  it("the recorder's offer carries Finish and honours ?finish=1", () => {
    const rec = read('src/components/activities/record/RecordActivityScreen.tsx');
    expect(rec).toMatch(/data-record-resume-finish=""/);
    expect(rec).toMatch(/get\('finish'\) === '1'/);
  });
});
