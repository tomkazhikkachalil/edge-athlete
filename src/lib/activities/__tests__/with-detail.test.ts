import { describe, it, expect } from 'vitest';
import { withDetail } from '../details';

// Program E: ONE cleanup rule for every writer of an answer.
describe('withDetail', () => {
  it('sets, deletes on undefined, and prunes an answer its parent no longer offers', () => {
    const a = withDetail('climb', {}, 'style', 'bouldering');
    const b = withDetail('climb', a, 'scale', 'v');
    expect(b).toEqual({ style: 'bouldering', scale: 'v' });
    // Lead climbing does not grade on the V scale: the scale goes with the style.
    expect(withDetail('climb', b, 'style', 'lead')).toEqual({ style: 'lead' });
    expect(withDetail('yoga', { style: 'yin' }, 'style', undefined)).toEqual({});
    const before = { style: 'yin' };
    withDetail('yoga', before, 'heated', true);
    expect(before).toEqual({ style: 'yin' });
  });
});
