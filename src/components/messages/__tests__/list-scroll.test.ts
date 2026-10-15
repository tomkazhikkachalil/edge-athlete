import { describe, expect, it } from 'vitest';
import {
  STICK_THRESHOLD_PX,
  arrivalAction,
  classifyListChange,
  distanceFromBottom,
  restoreAfterPrepend,
  shouldStickToBottom,
} from '../list-scroll';

describe('the thread list scroll rules', () => {
  it('measures the distance from the bottom', () => {
    expect(distanceFromBottom(0, 1000, 400)).toBe(600);
    expect(distanceFromBottom(600, 1000, 400)).toBe(0);
    expect(distanceFromBottom(650, 1000, 400)).toBe(0);
  });
  it('sticks within the threshold', () => {
    expect(shouldStickToBottom(0)).toBe(true);
    expect(shouldStickToBottom(STICK_THRESHOLD_PX)).toBe(true);
    expect(shouldStickToBottom(STICK_THRESHOLD_PX + 1)).toBe(false);
  });
  it('keeps what you were reading in place after a prepend', () => {
    expect(restoreAfterPrepend(1000, 0, 1600)).toBe(600);
    expect(restoreAfterPrepend(1000, 120, 1600)).toBe(720);
    expect(restoreAfterPrepend(1000, 0, 800)).toBe(0);
  });
  it('classifies the change by the edges', () => {
    const e = (newestId: string | null, oldestId: string | null, count: number) => ({ newestId, oldestId, count });
    expect(classifyListChange(e(null, null, 0), e('m3', 'm1', 3))).toBe('initial');
    expect(classifyListChange(e('m3', 'm1', 3), e('m4', 'm1', 4))).toBe('appended');
    expect(classifyListChange(e('m3', 'm1', 3), e('m3', 'm0', 53))).toBe('prepended');
    expect(classifyListChange(e('m3', 'm1', 3), e('m3', 'm1', 3))).toBe('none');
    expect(classifyListChange(e('m3', 'm1', 3), e(null, null, 0))).toBe('none');
    // A dedupe that changed nothing at the edges is nothing.
    expect(classifyListChange(e('m3', 'm1', 3), e('m3', 'm1', 3))).toBe('none');
  });
  it('decides what a change does', () => {
    expect(arrivalAction({ change: 'initial', isOwn: false, nearBottom: false })).toBe('scroll');
    expect(arrivalAction({ change: 'appended', isOwn: true, nearBottom: false })).toBe('scroll');
    expect(arrivalAction({ change: 'appended', isOwn: false, nearBottom: true })).toBe('scroll');
    expect(arrivalAction({ change: 'appended', isOwn: false, nearBottom: false })).toBe('pill');
    expect(arrivalAction({ change: 'prepended', isOwn: false, nearBottom: true })).toBe('none');
    expect(arrivalAction({ change: 'none', isOwn: true, nearBottom: true })).toBe('none');
  });
});
