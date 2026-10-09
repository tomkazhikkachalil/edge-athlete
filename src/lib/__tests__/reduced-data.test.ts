import { describe, expect, it } from 'vitest';
import { prefersReducedData, reducedDataFrom } from '../net/reduced-data';
import { autoPollAllowed } from '../org-sites/live-poll';

describe('reduced-data — one rule for Save-Data and prefers-reduced-data', () => {
  it('either signal asks for less data; neither means no', () => {
    expect(reducedDataFrom({})).toBe(false);
    expect(reducedDataFrom({ saveData: true })).toBe(true);
    expect(reducedDataFrom({ reducedData: true })).toBe(true);
    expect(reducedDataFrom({ saveData: false, reducedData: false })).toBe(false);
  });

  it('the live scoreboard’s auto-poll rule is its complement', () => {
    for (const env of [{}, { saveData: true }, { reducedData: true }, { saveData: true, reducedData: true }]) {
      expect(autoPollAllowed(env)).toBe(!reducedDataFrom(env));
    }
  });

  it('answers "no" on the server (no window)', () => {
    expect(prefersReducedData()).toBe(false);
  });
});
