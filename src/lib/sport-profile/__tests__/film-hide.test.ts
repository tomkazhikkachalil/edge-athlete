import { describe, it, expect } from 'vitest';
import { parseHideBody } from '../film-hide-server';

const V = '11111111-2222-3333-4444-555555555555';
const H = 'AAAAAAAA-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('POST …/film-hidden — what may be asked (311)', () => {
  it('a game: the video and whether to hide it', () => {
    expect(parseHideBody({ video_id: V, hidden: true })).toEqual({ ok: true, value: { videoId: V, highlightId: null, hidden: true } });
  });
  it('a clip: the highlight too, lower-cased', () => {
    expect(parseHideBody({ video_id: V, highlight_id: H, hidden: false })).toEqual({ ok: true, value: { videoId: V, highlightId: H.toLowerCase(), hidden: false } });
  });
  it('anything else is refused with what is missing', () => {
    expect(parseHideBody(null)).toEqual({ ok: false, error: 'Choose the game' });
    expect(parseHideBody({ video_id: 'x', hidden: true })).toEqual({ ok: false, error: 'Choose the game' });
    expect(parseHideBody({ video_id: V, highlight_id: 'nope', hidden: true })).toEqual({ ok: false, error: 'That is not a clip' });
    expect(parseHideBody({ video_id: V })).toEqual({ ok: false, error: 'Say whether to hide it' });
    expect(parseHideBody({ video_id: V, hidden: 'yes' })).toEqual({ ok: false, error: 'Say whether to hide it' });
  });
});
