import { describe, it, expect } from 'vitest';
import { parseCookieHeader } from '../cookies';

describe('parseCookieHeader', () => {
  it('parses multiple cookies split on "; "', () => {
    expect(parseCookieHeader('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('keeps everything after the first = (base64 padding case)', () => {
    // The old split('=') dropped 'Zg==' down to 'Zg' — the bug that made
    // Supabase session cookies with padding silently fail auth.
    expect(parseCookieHeader('session=Zg==; other=a=b=c')).toEqual({
      session: 'Zg==',
      other: 'a=b=c',
    });
  });

  it('URL-decodes values', () => {
    expect(parseCookieHeader('name=hello%20world')).toEqual({ name: 'hello world' });
  });

  it('falls back to the raw value on malformed % sequences instead of throwing', () => {
    expect(parseCookieHeader('bad=100%; good=1')).toEqual({ bad: '100%', good: '1' });
  });

  it('returns {} for an empty header', () => {
    expect(parseCookieHeader('')).toEqual({});
  });

  it('skips fragments without = and unnamed values', () => {
    expect(parseCookieHeader('noequals; =orphan; a=1')).toEqual({ a: '1' });
  });

  it('tolerates whitespace variants around separators', () => {
    expect(parseCookieHeader(' a = 1 ;b=2;  c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('parses a realistic Supabase auth cookie value intact', () => {
    const value = 'base64-eyJhY2Nlc3NfdG9rZW4iOiJhYmMifQ';
    expect(parseCookieHeader(`sb-abcdefgh-auth-token=${value}`)).toEqual({
      'sb-abcdefgh-auth-token': value,
    });
  });

  it('last occurrence wins on duplicate names', () => {
    expect(parseCookieHeader('a=1; a=2')).toEqual({ a: '2' });
  });
});
