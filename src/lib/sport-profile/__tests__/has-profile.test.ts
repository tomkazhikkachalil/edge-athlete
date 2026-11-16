import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { hasSportProfile, sportSums } from '../has-profile';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('which sports have a sport profile', () => {
  it('every sport with a stat sheet has one — track and field too, since each event is a best (one wave phase 4) — and golf (its own payload); a sport with no sheet does not', () => {
    for (const k of ['soccer', 'basketball', 'ice_hockey', 'volleyball', 'baseball', 'mma', 'boxing', 'swimming', 'running', 'golf', 'track_field']) expect(hasSportProfile(k), k).toBe(true);
    for (const k of ['tennis', 'football', 'curling']) expect(hasSportProfile(k), k).toBe(false);
  });
  it('the skill card says it, so a page needs no stat sheet to know; the strip\'s tap opens the sport profile on all three routes', () => {
    expect(read('src/lib/sports/server/index.ts')).toContain('sportProfile: def.enabled && hasSportProfile(sportKey),');
    expect(read('src/app/(app)/athlete/[id]/page.tsx')).toContain('router.push(`/athlete/${athleteId}/sport/${sportKey}`)');
    expect(read('src/app/(app)/athlete/page.tsx')).toContain('router.push(`/athlete/${user.id}/sport/${sportKey}`)');
    expect(read('src/app/(app)/u/[username]/page.tsx')).toContain('router.push(`/u/${encodeURIComponent(username)}/sport/${sportKey}`)');
    // The profile routes never import the stat sheets to decide it (their first load stays what it is).
    for (const f of ['src/app/(app)/athlete/[id]/page.tsx', 'src/app/(app)/athlete/page.tsx', 'src/app/(app)/u/[username]/page.tsx']) expect(read(f)).not.toMatch(/has-profile|stat-schemas/);
  });
});

describe('which sports\' numbers add up', () => {
  it('a game with two sides does; a race does not — a sum of times means nothing', () => {
    for (const k of ['soccer', 'basketball', 'ice_hockey', 'mma', 'wrestling']) expect(sportSums(k), k).toBe(true);
    for (const k of ['swimming', 'running', 'cycling', 'rowing', 'track_field', 'golf']) expect(sportSums(k), k).toBe(false);
  });
  it('a sport that does not add up shows each column by its own rule', () => {
    // Since one wave phase 4 a race's columns show, each by its own rule (a total, a best, an average) — never a sum of times.
    expect(read('src/components/sport-profile/CareerView.tsx')).toContain('columns={data.columns}');
    expect(read('src/components/sport-profile/SeasonView.tsx')).toContain("{data.sums ? 'Season totals' : 'Season totals and bests'}");
    // The splits by opponent and period stay a game-with-sides thing.
    expect(read('src/components/sport-profile/SeasonView.tsx')).toContain('{data.sums && opponents.rows.length > 0 && (');
  });
});

describe('a block closes a profile (Nov 2026)', () => {
  it('the shared check refuses on the two paths that would let a viewer in — a guardian\'s access is not a viewer\'s', () => {
    const src = read('src/lib/privacy.ts');
    expect(src.match(/const closed = await blocked\(\);\s+if \(closed\) return closed;/g)?.length).toBe(2);
    expect(src.indexOf("reason: 'profile_access'")).toBeLessThan(src.indexOf('const blocked = async'));
  });
  it('the older Stats routes, which gate inline, refuse too — as a private profile, never as a block', () => {
    for (const f of ['src/app/api/sports/stat-lines/route.ts', 'src/app/api/performance/rollups/route.ts']) {
      expect(read(f)).toMatch(/if \(await blockedEitherWay\((supabase|admin), viewerId, profileId\)\)[\s\S]{0,80}This profile is private/);
    }
  });
});

describe('more doors on the sport pages (one wave, phase 5)', () => {
  it('a stat\'s reel offers the kinds of play that made it as chips, only when there is more than one', () => {
    const reel = read('src/components/sport-profile/StatReel.tsx');
    expect(reel).toContain('const kinds = stat ? [...new Set(whole.clips.map(c => c.eventKey).filter((k): k is string => !!k))] : [];');
    expect(reel).toContain('{kinds.length > 1 && (');
    expect(reel).toContain("sportViewSearch({ season, stat, event: k })");
  });
  it('a best opens the game it happened in, a headline tile the clips of its one stat — and nothing when there is none', () => {
    expect(read('src/components/sport-profile/CareerView.tsx')).toContain('bestHref={b => bestDoor(data.games.find(g => g.counted && g.date === b.date && g.stats[b.key] === b.value)?.key)}');
    expect(read('src/components/sport-profile/CareerView.tsx')).toContain("href: t.stat && (data.career.clips[t.stat] ?? 0) > 0 ?");
    expect(read('src/lib/sport-profile/sport-profile-server.ts')).toContain("('keys' in t.compute && t.compute.keys.length === 1 ? t.compute.keys[0] : null)");
  });
});
