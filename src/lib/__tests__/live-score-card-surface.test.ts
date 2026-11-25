import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The live scoring card (Tom's live-round spec, Nov 25 2026) — the shape of
// the surface, read from source (the suite has no DOM). The rules themselves
// are pure and have their own tests: score-card, score-dial, player-colour,
// penalties, hole-writes.
const code = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const sheet = code('src/components/golf/ScoreEntryModal.tsx');
const dial = code('src/components/golf/scoring/StrokesDial.tsx');
const controls = code('src/components/golf/scoring/ScoreControls.tsx');
const penalty = code('src/components/golf/scoring/PenaltyParts.tsx');
const plate = code('src/components/golf/scoring/HolePlate.tsx');

describe('what is gone (R1 – R7)', () => {
  it('no banner, no wheels, no Library, no Map pill, no section labels, no "Tee → green"', () => {
    for (const gone of ['Your Scores', 'NumberWheel', 'Library', 'data-scorer-map', 'Optional Stats', 'Jump to Hole', 'TEE_TO_GREEN', 'CaptureInputs', 'bg-green-600', 'HoleHeader']) {
      expect(sheet, gone).not.toContain(gone);
    }
    expect(plate).not.toContain('TEE_TO_GREEN');
    expect(fs.existsSync(path.join(process.cwd(), 'src/components/golf/HoleHeader.tsx'))).toBe(false);
  });
  it('the wheel itself stays for its other users (the event group card, the workout timers)', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/components/golf/NumberWheel.tsx'))).toBe(true);
    expect(code('src/components/golf/GroupScoreCard.tsx')).toContain('NumberWheel');
  });
});

describe('A3 / A4 — defaults, and when a hole is recorded', () => {
  it('the card shows shownScore; a change writes both numbers; Next commits what is shown', () => {
    expect(sheet).toMatch(/const shown = shownScore\(currentHoleData\);/);
    expect(sheet).toMatch(/patchCurrentHole\(withStrokes\(currentHoleData, strokes\)\)/);
    expect(sheet).toMatch(/patchCurrentHole\(withPutts\(currentHoleData, putts\)\)/);
    expect(sheet).toMatch(/const committed = commitShown\(\);\s*if \(isLive && !\(await persistHole\(currentHole, committed\)\)\) return;/);
  });
  it('leaving by Previous, a jump key or a player tab commits nothing', () => {
    const previous = sheet.slice(sheet.indexOf('const handlePrevious'), sheet.indexOf('const handleJumpToHole'));
    const jump = sheet.slice(sheet.indexOf('const handleJumpToHole'), sheet.indexOf('const handleDone'));
    const tab = sheet.slice(sheet.indexOf('const handleSwitchPlayer'), sheet.indexOf('// Hole photos/videos'));
    for (const block of [previous, jump, tab]) expect(block).not.toContain('commitShown');
    // The X records nothing either: only the footer's finish does.
    expect(sheet).toMatch(/onClick=\{\(\) => \(isLive \? handleDone\(false\) : onClose\(\)\)\}/);
    expect(sheet).toMatch(/else if \(isLive\) void handleDone\(true\);/);
  });
  it('the server save keeps its timing: no save on a keystroke, the hole is persisted on leaving it', () => {
    const patch = sheet.slice(sheet.indexOf('const patchCurrentHole'), sheet.indexOf('// ── A4: when a hole is RECORDED'));
    expect(patch).not.toContain('onSaveHole');
    expect(patch).toContain('writeDraft(participantId, draftHoles);');
  });
});

describe('penalties — a type and its strokes, cleared on the server when removed', () => {
  it('every save names the penalties, even when there are none', () => {
    expect(sheet.match(/penalties: hole\.penalties \?\? \[\],/g)?.length).toBe(2);
    expect(sheet).toMatch(/penalties: h\.penalties \?\? \[\],/);
    expect(sheet).not.toMatch(/penalties\?\.length \? (hole|h)\.penalties : undefined/);
    expect(sheet.match(/penalty_strokes: (hole|h)\.penalties\?\.length \? (hole|h)\.penalty_strokes \?\? null : null,/g)?.length).toBe(3);
  });
  it('the entry takes the action row\'s place; the list is the app\'s own', () => {
    expect(sheet).toMatch(/\{penaltyOpen \? \(\s*<PenaltyEntryRow/);
    expect(penalty).toMatch(/PENALTY_TYPES\.map\(t => \(/);
    expect(penalty).toMatch(/onAdd\(\{ type, strokes: value \}\)/);
  });
  it('the badge is the hole\'s penalty strokes, not a count', () => {
    expect(sheet).toMatch(/penaltyStrokes=\{totalPenaltyStrokes\(currentHoleData\.penalties, currentHoleData\.penalty_strokes\)\}/);
  });
  it('nothing in the penalty code touches the strokes', () => {
    const block = sheet.slice(sheet.indexOf('// ── Penalties: a TYPE and its STROKES'), sheet.indexOf('// Live mode: persist a single hole'));
    expect(block).not.toMatch(/strokes: (?!cols)/);
    expect(block).not.toContain('withStrokes');
  });
});

describe('the dial and the lamps', () => {
  it('the dial takes the pointer with capture, never scrolls the page, and is a slider', () => {
    expect(dial).toMatch(/e\.currentTarget\.setPointerCapture\(e\.pointerId\)/);
    expect(dial).toMatch(/touchAction: 'none'/);
    expect(dial).toMatch(/role="slider"/);
    expect(dial).toMatch(/aria-valuemax=\{2 \* par\}/);
    expect(dial).toMatch(/strokesForPointer\(clientX - \(r\.left \+ r\.width \/ 2\), clientY - \(r\.top \+ r\.height \/ 2\), par\)/);
  });
  it('a tap on the number confirms, and is not the start of a drag', () => {
    expect(dial).toMatch(/onPointerDown=\{e => e\.stopPropagation\(\)\}\s*onClick=\{\(\) => \{ if \(!disabled\) onConfirm\(\); \}\}/);
  });
  it('FIR and GIR are on or off, from off', () => {
    expect(sheet).toMatch(/on=\{currentHoleData\.fairway_hit === true\}/);
    expect(sheet).toMatch(/on=\{currentHoleData\.green_in_regulation === true\}/);
    expect(controls).toMatch(/aria-pressed=\{on\}/);
  });
});

describe('the frame', () => {
  it('player tabs are tabs; the current key wears the selected player\'s colour', () => {
    expect(controls).toMatch(/role="tablist"/);
    expect(controls).toMatch(/role="tab"\s*aria-selected=\{selected\}/);
    expect(controls).toMatch(/style=\{isCurrent \? \{ boxShadow: `inset 0 0 0 2px \$\{colour\}` \} : undefined\}/);
    expect(sheet).toMatch(/const activeColour = playerColour\(activeIndex\);/);
  });
  it('Next names the hole; the last hole says Finish round on a live round', () => {
    expect(sheet).toMatch(/nextLabel=\{nextNumber !== null \? `Hole \$\{nextNumber\}` : lastLabel\}/);
    expect(sheet).toMatch(/const lastLabel = !isLive \? 'Save Scores' : roundStatus === 'completed' \? 'Done' : 'Finish round';/);
  });
  it('Photo and Video open the phone\'s chooser: no capture attribute', () => {
    expect(penalty).toMatch(/type="file" accept="image\/\*"/);
    expect(penalty).toMatch(/type="file" accept="video\/\*"/);
    expect(penalty).not.toMatch(/capture=/);
  });
  it('the map preview is a still map: no drag, no zoom, no pointer events, loaded lazily', () => {
    const preview = code('src/components/golf/scoring/HoleMapPreviewInner.tsx');
    for (const off of ['dragging: false', 'touchZoom: false', 'doubleClickZoom: false', 'scrollWheelZoom: false', 'zoomControl: false', 'keyboard: false']) expect(preview).toContain(off);
    expect(preview).toMatch(/pointerEvents: 'none'/);
    expect(plate).toMatch(/dynamic\(\(\) => import\('\.\/HoleMapPreviewInner'\), \{\s*ssr: false,/);
  });
  it('the card is inside the dialect, a full screen on a phone', () => {
    expect(sheet).toMatch(/className="ea-mech ea-mech-overlay fixed inset-0 z-\[60\] flex items-stretch justify-center sm:items-center sm:p-4"/);
    const css = code('src/app/globals.css');
    expect(css).toMatch(/@media \(min-width: 900px\) \{\s*\.ea-mech-scorecard \{ max-width: 800px; \}\s*\.ea-mech-scorecard-grid \{ grid-template-columns: 358px minmax\(0, 1fr\); gap: 20px; \}/);
  });
});
