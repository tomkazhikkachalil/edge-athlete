import { describe, it, expect } from 'vitest';
import { coverProxyUrl, coverPlaceholderUrl } from '../cover-url';

const ID = '11111111-2222-3333-4444-555555555555';
const STORED = 'https://proj.supabase.co/storage/v1/object/public/uploads/covers/abc/1700000000-cover.jpg';

describe('coverProxyUrl', () => {
  it('keys the endpoint by profile and busts on the filename', () => {
    expect(coverProxyUrl(ID, STORED)).toBe(`/api/media/cover/${ID}?v=1700000000-cover.jpg`);
  });

  it('is null without a profile or a cover', () => {
    expect(coverProxyUrl(null, STORED)).toBeNull();
    expect(coverProxyUrl(ID, null)).toBeNull();
  });
});

describe('coverPlaceholderUrl', () => {
  it('is the same cover at the one placeholder width, sharing the buster', () => {
    expect(coverPlaceholderUrl(ID, STORED)).toBe(`/api/media/cover/${ID}?v=1700000000-cover.jpg&w=32`);
  });

  it('is null whenever the full cover is', () => {
    expect(coverPlaceholderUrl(ID, '')).toBeNull();
    expect(coverPlaceholderUrl(undefined, STORED)).toBeNull();
  });
});
