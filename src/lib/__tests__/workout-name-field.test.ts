import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isTruncated, placeCaretAtEnd } from '../workouts/name-field';

describe('placeCaretAtEnd', () => {
  it('puts the cursor after the name, selecting nothing', () => {
    const calls: Array<[number, number]> = [];
    placeCaretAtEnd({ value: 'Bench Press', setSelectionRange: (a, b) => calls.push([a, b]) });
    expect(calls).toEqual([[11, 11]]);
  });

  it('an empty name puts it at 0', () => {
    const calls: Array<[number, number]> = [];
    placeCaretAtEnd({ value: '', setSelectionRange: (a, b) => calls.push([a, b]) });
    expect(calls).toEqual([[0, 0]]);
  });
});

describe('isTruncated', () => {
  it('a name wider than its box is cut off', () => {
    expect(isTruncated(320, 200)).toBe(true);
  });
  it('a name that fits — or is off by a rounding pixel — is not', () => {
    expect(isTruncated(200, 200)).toBe(false);
    expect(isTruncated(201, 200)).toBe(false);
    expect(isTruncated(150, 200)).toBe(false);
  });
});

describe('the rename field (Oct 17 2026)', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/workouts/ExerciseCard.tsx'), 'utf8');
  it('never re-selects the text on each keystroke', () => {
    expect(src).not.toMatch(/\.select\(\)/);
    expect(src).toMatch(/onFocus=\{e => placeCaretAtEnd\(e\.currentTarget\)\}/);
  });
});
