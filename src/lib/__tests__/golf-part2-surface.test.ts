import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Golf round flow, part 2 (Tom's spec, Nov 24 2026) — the shape of the
// surface, read from source (the suite has no DOM). The pure rules have
// their own tests: round-steps, recent-partners, slide, score-entry.
const code = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const composer = code('src/components/golf/GolfComposerSection.tsx');
const modal = code('src/components/CreatePostModal.tsx');

describe('A1 / A3 — no score entry and no Preview in the golf flow', () => {
  it('the composer renders no scores step, no score grid and no Quick entry', () => {
    expect(composer).not.toMatch(/currentStep\.id === 'scores'/);
    expect(composer).not.toMatch(/<MultiPlayerScorecardGrid/);
    expect(composer).not.toMatch(/Quick entry/);
    expect(composer).not.toMatch(/ScoreEntryModal/);
  });
  it('a restored draft comes back with its holes blank', () => {
    expect(composer).toMatch(/withoutEnteredScores\(seed\?\.playerScores \?\? \[\]\)/);
  });
  it('Preview is not offered to the golf section, and the prop is gone', () => {
    expect(composer).not.toMatch(/onPreview/);
    expect(composer).not.toMatch(/data-round-preview/);
    expect(code('src/components/sport-composer-extras.ts')).not.toMatch(/onPreview/);
    expect(modal).not.toMatch(/onPreview=/);
  });
});

describe('A4 — the helper sentences sit behind the info button', () => {
  const start = code('src/components/golf/round-steps/StartStep.tsx');
  it('the Start line swaps with the title in place', () => {
    expect(start).toMatch(/Go Live opens the round\. Score hole by hole, add partners any time\./);
    expect(start).toMatch(/infoOpen \? \(\s*<p id="golf-start-info"/);
    expect(start).toMatch(/<InfoToggle/);
  });
  it('the format step explains nothing under its grid', () => {
    const format = code('src/components/golf/round-steps/FormatStep.tsx');
    expect(format).not.toMatch(/Points per hole/);
    expect(format).not.toMatch(/Head-to-head/);
    expect(format).toMatch(/grid grid-cols-3 gap-2/);
    expect(format).toMatch(/GAME_FORMAT_OPTIONS\.map/);
  });
});

describe('A5 – A7 — the Players step', () => {
  const players = code('src/components/golf/round-steps/PlayersStep.tsx');
  it('quick add buttons carry only a picture and say whom they add', () => {
    expect(players).toMatch(/aria-label=\{`Add \$\{person\.name\}`\}/);
    expect(players).toMatch(/quickAdd\.length > 0 &&/);
  });
  it('a handicap is drawn only when there is one', () => {
    expect(players).toMatch(/\{handicap \? \(/);
    expect(players).toMatch(/>HCP</);
  });
  it('the composer offers the suggested people who are not partners yet, asks once on the Players step, and only for the account itself', () => {
    expect(composer).toMatch(/quickAdd=\{quickAddOffered\(recentPartners, sharedRoundParticipants\)\}/);
    expect(composer).toMatch(/currentStep\.id !== 'players' \|\| !composingAsSelf \|\| partnersAskedRef\.current/);
    expect(composer).toMatch(/partnersAskedRef\.current = false;/);
    expect(composer).toMatch(/currentStep\.id === 'finish' \|\| currentStep\.id === 'players'/);
  });
});

describe('the recent partners route', () => {
  const route = code('src/app/api/golf/partners/recent/route.ts');
  it('is the caller\'s own, limited, gated twice and never cached', () => {
    expect(route).toMatch(/requireAuth\(request\)/);
    expect(route).toMatch(/enforceRateLimit\(request, 'recent-partners', \{ userId: user\.id \}\)/);
    expect(route).toMatch(/\.eq\('profile_id', user\.id\)/);
    expect(route).toMatch(/\.eq\('type', 'golf_round'\)/);
    expect(route).toMatch(/filterBlockedBidirectional\(admin, user\.id, candidates\)/);
    expect(route).toMatch(/canViewProfile\(id, user\.id\)/);
    expect(route).toMatch(/'Cache-Control': 'private, no-store'/);
    expect(route).toMatch(/if \(error instanceof Response\) return error;/);
    expect(code('src/lib/rate-limit-core.ts')).toMatch(/'recent-partners': \{ max: \d+, windowSeconds: \d+, keyBy: 'user' \}/);
  });
});

describe('A8 — Go Live is a slide', () => {
  const slide = code('src/components/mech/SlideToConfirm.tsx');
  it('the key captures the pointer, does not scroll the page, and is the finish hook', () => {
    expect(slide).toMatch(/setPointerCapture\(e\.pointerId\)/);
    expect(slide).toMatch(/touchAction: 'none'/);
    expect(slide).toMatch(/data-step-finish=""/);
    expect(slide).toMatch(/if \(slideLocks\(at, d\.travel\)\) lock\(d\.travel\);/);
  });
  it('a click only confirms when no pointer made it (keyboard, assistive tech)', () => {
    expect(slide).toMatch(/if \(e\.detail !== 0 \|\| off\) return;/);
  });
  it('a live round hands the frame the slide; an already-played round keeps its button', () => {
    expect(composer).toMatch(/finishControl=\{!sharedRoundDetails\.alreadyPlayed \? \(\s*<SlideToConfirm/);
    expect(composer).toMatch(/ariaLabel="Slide to go live"/);
    const flow = code('src/components/StepFlow.tsx');
    expect(flow).toMatch(/const ownFinish = mech && last && !!finishControl;/);
    expect(flow).toMatch(/\{ownFinish \? null : last \? \(/);
  });
});

describe('Tag People — the mech dialog is opt-in', () => {
  const tag = code('src/components/TagPeopleModal.tsx');
  it('the default look stays the default; golf asks for the dialect', () => {
    expect(tag).toMatch(/variant = 'default',/);
    expect(tag).toMatch(/if \(variant === 'mech'\) \{/);
    expect(composer).toMatch(/selectionMode=\{true\}\s*variant="mech"/);
    // The general composer took the dialect on Nov 26 2026: the same dialog.
    expect(modal).toMatch(/variant="mech"\s*selectionMode=\{true\}/);
  });
  it('says the three states in the spec\'s words', () => {
    expect(tag).toMatch(/'No one found' : 'Type to search for people'/);
    expect(tag).toMatch(/count > 0 \? `Tag \(\$\{count\}\)` : 'Tag'/);
    expect(tag).toMatch(/placeholder="Search people"/);
  });
});

describe('the frame — no card around a step, the banner in one line', () => {
  it('steps 3 to 6 sit on the surface', () => {
    const after = composer.slice(composer.indexOf("currentStep.id === 'format'"));
    expect(after).not.toMatch(/GOLF_SECTION_CARD/);
  });
  it('ONE banner for every post type (Nov 26 2026): the same two handlers, a saved draft named as one', () => {
    expect(modal.match(/data-draft-banner=/g)).toHaveLength(1);
    expect(modal).toMatch(/onClick=\{\(\) => restoreDraft\(availableDraft\)\}/);
    expect(modal).toMatch(/onClick=\{dismissDraft\}/);
    expect(modal).toMatch(/availableDraft\.kept \? 'Saved draft' : 'Unfinished post'/);
  });
});

describe('Already played is hidden (Nov 25 2026)', () => {
  it('step 1 asks WHEN only while the mode is offered, and a restored draft comes back live', () => {
    const step = code('src/components/golf/round-steps/RoundTypeStep.tsx');
    expect(step).toMatch(/\{offerAlreadyPlayed && \(/);
    expect(composer).toMatch(/offerAlreadyPlayed=\{ALREADY_PLAYED_OFFERED\}/);
    expect(composer).toMatch(/offeredDetails\(seed\?\.sharedRoundDetails\) \?\? \{/);
    expect(composer).toMatch(/return \{ \.\.\.details, alreadyPlayed: false, date: localDayKey\(new Date\(\)\) \};/);
  });
});

// Every screen size, every browser (Tom, Nov 25 2026). The measuring is
// e2e/golf-fit.spec.ts; these pin the rules it led to.
describe('fits any screen, on any engine', () => {
  const slide = code('src/components/mech/SlideToConfirm.tsx');
  it('the slide takes the pointer on the whole TRACK, and follows the distance dragged', () => {
    // The handlers and touch-action sit on the track, before the key's markup.
    const track = slide.slice(slide.indexOf('data-slide-track=""'), slide.indexOf('<button'));
    expect(track).toMatch(/style=\{\{ touchAction: 'none' \}\}/);
    expect(track).toMatch(/onPointerDown=/);
    expect(track).toMatch(/e\.currentTarget\.setPointerCapture\(e\.pointerId\)/);
    expect(slide).toMatch(/slideOffset\(e\.clientX - d\.startX, d\.travel\)/);
    // The key itself keeps only the click no pointer made.
    expect(slide.slice(slide.indexOf('<button'))).not.toMatch(/onPointerDown/);
  });
  it('a sideways drag in the dialog is not the browser\'s back swipe; scrolling parts wear the thin bar', () => {
    const css = code('src/app/globals.css');
    expect(css).toMatch(/\.ea-mech-dialog \{ overscroll-behavior-x: contain; \}/);
    expect(css).toMatch(/\.ea-mech-scroll \{ scrollbar-width: thin;/);
    expect(css).toMatch(/\.ea-mech-scroll::-webkit-scrollbar \{/);
    expect(code('src/components/StepFlow.tsx')).toMatch(/ea-mech-scroll px-4 sm:px-5 py-2\.5/);
    expect(code('src/components/golf/round-steps/PlayersStep.tsx')).toMatch(/data-scroll-x=""/);
  });
  it('under 360 px a tile\'s name takes a second line, never an ellipsis; a picture\'s ring is in px like the picture', () => {
    for (const rel of ['src/components/SportSelector.tsx', 'src/components/golf/round-steps/FormatStep.tsx']) {
      expect(code(rel)).toMatch(/max-\[359px\]:whitespace-normal max-\[359px\]:\[overflow-wrap:anywhere\]/);
      expect(code(rel)).toMatch(/max-\[359px\]:line-clamp-2/);
    }
    const players = code('src/components/golf/round-steps/PlayersStep.tsx');
    expect(players).toMatch(/h-\[48px\] w-\[48px\]/);
    expect(players).toMatch(/h-\[36px\] w-\[36px\]/);
    // A long name's chip stays inside the Tag People dialog.
    expect(code('src/components/TagPeopleModal.tsx')).toMatch(/<li key=\{profile\.id\} className="min-w-0 max-w-full">/);
  });
});
