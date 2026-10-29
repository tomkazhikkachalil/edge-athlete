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
    expect(src).toMatch(/\{last \? \(\s*<button[^>]*onClick=\{onFinish\}/);
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
