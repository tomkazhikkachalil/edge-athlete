import { describe, expect, it } from 'vitest';
import { judgeSlug, suggestSlugs, identityTokens } from '../slug-policy';

const KMHA = {
  name: 'Kanata Knights',
  sportKey: 'football',
  city: 'Kanata',
  region: 'Ontario',
};

describe('judgeSlug', () => {
  it('accepts city + club name (Tom’s canonical example)', () => {
    expect(judgeSlug('kanata-knights', KMHA).verdict).toBe('ok');
    expect(judgeSlug('kanataknights', KMHA).verdict).toBe('ok');
    expect(judgeSlug('kanata-knights-football', KMHA).verdict).toBe('ok');
    expect(judgeSlug('kanataknightsfootball', KMHA).verdict).toBe('ok');
  });

  it('refuses bare generic words even when they appear in the name', () => {
    expect(judgeSlug('football', KMHA).verdict).toBe('refused');
    expect(judgeSlug('hockey', { name: 'Hockey', city: 'Ottawa' }).verdict).toBe('refused');
    expect(judgeSlug('minor-hockey', { name: 'Ottawa Minor Hockey' }).verdict).toBe('refused');
    expect(judgeSlug('league', KMHA).verdict).toBe('refused');
  });

  it('refuses slugs with no identity connection', () => {
    expect(judgeSlug('senators', KMHA).verdict).toBe('refused');
    expect(judgeSlug('best-club-ever', KMHA).verdict).toBe('refused');
  });

  it('flags single-identity-token slugs (never silently ok)', () => {
    expect(judgeSlug('knights', KMHA).verdict).toBe('flagged');
    expect(judgeSlug('kanata', KMHA).verdict).toBe('flagged');
    // One-word club name: still flagged, per the literal city+name rule.
    expect(judgeSlug('rangers', { name: 'Rangers', city: 'Ottawa' }).verdict).toBe('flagged');
  });

  it('sport_key underscores split into tokens', () => {
    const org = { name: 'Nepean Raiders', sportKey: 'ice_hockey', city: 'Nepean' };
    expect(identityTokens(org).has('hockey')).toBe(true);
    expect(judgeSlug('nepean-raiders-hockey', org).verdict).toBe('ok');
  });
});

describe('suggestSlugs', () => {
  it('suggests ok-verdict combinations, most specific first', () => {
    const got = suggestSlugs(KMHA);
    expect(got.length).toBeGreaterThan(0);
    for (const s of got) {
      expect(judgeSlug(s, KMHA).verdict, s).toBe('ok');
    }
    expect(got).toContain('kanata-knights');
  });

  it('a one-word club still gets viable suggestions via city/sport', () => {
    const org = { name: 'Rangers', sportKey: 'soccer', city: 'Ottawa' };
    const got = suggestSlugs(org);
    expect(got).toContain('ottawa-rangers');
    for (const s of got) expect(judgeSlug(s, org).verdict).toBe('ok');
  });
});
