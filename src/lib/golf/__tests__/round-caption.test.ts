import { describe, it, expect } from 'vitest';
import { isAutoRoundCaption } from '../round-caption';

describe('isAutoRoundCaption', () => {
  it('matches the composer template verbatim', () => {
    // CreatePostModal writes `Golf at ${courseName}`; the API stores it as the
    // caption when the athlete typed no description.
    expect(isAutoRoundCaption('Golf at Eagle Creek Golf Club', 'Eagle Creek Golf Club')).toBe(true);
    expect(isAutoRoundCaption('Golf at Ottawa Hunt and Golf Club', 'Ottawa Hunt and Golf Club')).toBe(true);
  });

  it('ignores case and collapsed whitespace — typography, not authorship', () => {
    expect(isAutoRoundCaption('  golf at   Eagle Creek Golf Club ', 'Eagle Creek Golf Club')).toBe(true);
    expect(isAutoRoundCaption('GOLF AT EAGLE CREEK GOLF CLUB', 'eagle creek golf club')).toBe(true);
  });

  it('NEVER hides something the athlete wrote themselves', () => {
    // The whole safety property: only the template disappears.
    const course = 'Eagle Creek Golf Club';
    for (const caption of [
      'Golf at Eagle Creek Golf Club with the boys',
      'Golf at Eagle Creek Golf Club!',
      'Great golf at Eagle Creek Golf Club',
      'Eagle Creek Golf Club',
      'Golf at Rideau View Golf Club',
      'What a round',
      'Golf at',
    ]) {
      expect(isAutoRoundCaption(caption, course), caption).toBe(false);
    }
  });

  it('is inert without both a caption and a course', () => {
    expect(isAutoRoundCaption(null, 'Eagle Creek')).toBe(false);
    expect(isAutoRoundCaption('Golf at Eagle Creek', null)).toBe(false);
    expect(isAutoRoundCaption('', '')).toBe(false);
    expect(isAutoRoundCaption('Golf at   ', '   ')).toBe(false);
  });
});
