import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Program D (Oct 2026): ONE step shell for the sport setup — the frame the
// e2e hooks rely on. Read from the source (the component renders in a browser).
const src = fs.readFileSync(path.join(process.cwd(), 'src/components/StepFlow.tsx'), 'utf8');

describe('StepFlow — the shared step shell', () => {
  it('says "Step n of N · label", draws a dot row with aria-current, and exposes the e2e hooks', () => {
    expect(src).toMatch(/Step \{index \+ 1\} of \{steps\.length\} · /);
    expect(src).toMatch(/aria-current=\{i === index \? 'step' : undefined\}/);
    for (const hook of ['data-step-flow={id}', 'data-step={step.id}', 'data-step-back=""', 'data-step-next=""', 'data-step-finish=""', 'data-step-skip=""', 'data-step-dot={s.id}']) {
      expect(src, hook).toContain(hook);
    }
  });
  it('every target is at least 44 px, and the shell sets no display or width on a shared class', () => {
    expect(src.match(/min-h-\[44px\]/g)?.length).toBeGreaterThanOrEqual(4);
    expect(src).not.toMatch(/\.ea-[a-z-]+\s*\{/);
  });
  it('the last step shows the caller\'s finish button, never Next; Back is disabled on the first step', () => {
    expect(src).toMatch(/\{ownFinish \? null : last \? \(\s*<button[^>]*onClick=\{onFinish\}/);
    expect(src).toMatch(/disabled=\{busy \|\| index === 0\}/);
  });
});

// Oct 28 2026 (the golf round as steps): the frame says WHY Next is refused,
// the finish honours canAdvance too, and can wear the live red with its own
// busy line — SportSetupFlow passes none of these and renders as before.
describe('StepFlow — the refusal line, the finish tone and the busy label', () => {
  it('a refused Next shows its reason beside the button, and nothing when it may advance', () => {
    expect(src).toContain('data-step-refusal={!canAdvance && refusal ? \'\' : undefined}');
    expect(src).toMatch(/\{!canAdvance && refusal \? refusal : null\}/);
  });
  it('the finish is disabled while refused or busy, and the defaults keep the old frame', () => {
    expect(src).toMatch(/onClick=\{onFinish\} disabled=\{busy \|\| !canAdvance\}/);
    expect(src).toMatch(/busyLabel = 'Saving…'/);
    expect(src).toMatch(/canAdvance = true/);
    expect(src).toMatch(/finishTone = 'brand'/);
    expect(src).toMatch(/brand: 'ea-cta'/);
    expect(src).toMatch(/live: 'bg-red-600 hover:bg-red-700/);
  });
});

// Nov 23 2026 (Tom's visual spec — the mechanical dialect): the golf round's
// look is a VARIANT of the same frame, never a second frame. The default
// renders as before; the words "Step n of N · label" stay in the text.
describe('StepFlow — variant="mech"', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
  it('the default is the house frame, and mech keeps every hook and the readable step line', () => {
    expect(src).toMatch(/variant = 'default'/);
    expect(src).toContain('<span className="sr-only">Step {index + 1} of {steps.length} · {step.label}</span>');
    expect(src).toContain('<span aria-hidden="true">Step {index + 1} / {steps.length} · {step.label}</span>');
    expect(src.match(/data-step-header=""/g)?.length).toBe(2);
    expect(src.match(/data-step-dot=\{s\.id\}/g)?.length).toBe(2);
    // One footer for both looks: the same buttons, the same rules.
    expect(src.match(/data-step-back=""/g)?.length).toBe(1);
    expect(src.match(/data-step-next=""/g)?.length).toBe(1);
    expect(src.match(/data-step-finish=""/g)?.length).toBe(1);
  });
  it('one segment per step in the progress tokens; Back 92 × 48, Next at least 132 × 48', () => {
    expect(src).toContain("className=\"h-1.5 flex-1 rounded-[2px] transition-colors\"");
    for (const token of ['--mech-progress-current', '--mech-progress-done', '--mech-progress-empty']) expect(src).toContain(token);
    expect(src).toContain("'ea-mech-back min-h-[44px] h-12 w-[92px] shrink-0'");
    expect(src).toContain("'ea-mech-next min-h-[44px] h-12 min-w-[132px] shrink-0 px-4'");
  });
  it('only the golf round asks for it; the composer wears the scope only while golf is the post type', () => {
    expect(read('src/components/golf/GolfComposerSection.tsx')).toContain('variant="mech"');
    for (const other of ['src/components/SportSetupFlow.tsx', 'src/components/videos/NewVideoFlow.tsx']) {
      expect(read(other), other).not.toContain('variant="mech"');
    }
    const composer = read('src/components/CreatePostModal.tsx');
    expect(composer).toContain("const isGolf = postType === 'golf';");
    expect(composer).toMatch(/isGolf\s*\? 'ea-mech ea-mech-overlay fixed inset-0/);
    for (const width of ["narrow: 'sm:max-w-[480px]'", "wide: 'sm:max-w-[760px]'", "full: 'sm:max-w-[920px]'"]) expect(composer).toContain(width);
    // A custom class takes no breakpoint prefix: the cap lives in the dialog class.
    expect(composer).not.toContain('sm:max-h-modal');
    expect(read('src/components/SportSelector.tsx')).not.toContain('sm:max-h-modal');
    expect(read('src/app/globals.css')).toMatch(/\.ea-mech-dialog \{[^}]*max-height: 90dvh;/);
  });
});
