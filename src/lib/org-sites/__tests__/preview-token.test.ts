import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PREVIEW_TOKEN_TTL_SECONDS,
  signPreviewToken,
  verifyPreviewToken,
} from '../preview-token';

const SITE = '01234567-89ab-4cde-8f01-23456789abcd';

describe('preview tokens', () => {
  beforeEach(() => {
    process.env.MEDIA_PROXY_SECRET = 'test-secret';
    delete process.env.MEDIA_PROXY_SECRET_PREVIOUS;
  });
  afterEach(() => {
    delete process.env.MEDIA_PROXY_SECRET;
    delete process.env.MEDIA_PROXY_SECRET_PREVIOUS;
  });

  it('round-trips within the TTL', () => {
    const token = signPreviewToken(SITE);
    expect(verifyPreviewToken(token)).toBe(SITE);
  });

  it('expires', () => {
    const token = signPreviewToken(SITE, 0);
    expect(verifyPreviewToken(token, (PREVIEW_TOKEN_TTL_SECONDS + 1) * 1000)).toBeNull();
    expect(verifyPreviewToken(token, (PREVIEW_TOKEN_TTL_SECONDS - 1) * 1000)).toBe(SITE);
  });

  it('rejects tampering', () => {
    const token = signPreviewToken(SITE);
    const [payload, sig] = token.split('.');
    const other = Buffer.from(
      JSON.stringify({ v: 1, s: '99999999-9999-4999-8999-999999999999', e: 9999999999 })
    ).toString('base64url');
    expect(verifyPreviewToken(`${other}.${sig}`)).toBeNull();
    expect(verifyPreviewToken(`${payload}.${'A'.repeat(43)}`)).toBeNull();
    expect(verifyPreviewToken('garbage')).toBeNull();
    expect(verifyPreviewToken(null)).toBeNull();
  });

  it('accepts the previous secret during rotation, fails closed without secrets', () => {
    const token = signPreviewToken(SITE);
    process.env.MEDIA_PROXY_SECRET = 'rotated';
    expect(verifyPreviewToken(token)).toBeNull();
    process.env.MEDIA_PROXY_SECRET_PREVIOUS = 'test-secret';
    expect(verifyPreviewToken(token)).toBe(SITE);
    delete process.env.MEDIA_PROXY_SECRET;
    delete process.env.MEDIA_PROXY_SECRET_PREVIOUS;
    expect(verifyPreviewToken(token)).toBeNull();
  });
});
