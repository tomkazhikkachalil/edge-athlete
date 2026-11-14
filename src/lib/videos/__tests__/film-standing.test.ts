import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { filmCountable, filmStanding } from '../film-standing';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('filmStanding (Tom, Nov 14 2026: only club and league tagged data is verified)', () => {
  it('a club\'s or league\'s game is verified — countable only when fully tagged', () => {
    expect(filmStanding('org', 'full')).toBe('verified');
    expect(filmStanding('org', 'highlights')).toBe('verified_highlights');
    expect(filmStanding('org', null)).toBe('verified_highlights');
    expect(filmCountable('verified')).toBe(true);
    expect(filmCountable('verified_highlights')).toBe(false);
  });
  it('anyone else\'s video is recreational whatever its coverage, and never countable', () => {
    expect(filmStanding('profile', 'full')).toBe('recreational');
    expect(filmStanding('profile', 'highlights')).toBe('recreational');
    expect(filmCountable('recreational')).toBe(false);
    expect(filmCountable(null)).toBe(false);
  });
  it('the reader stamps every game with its standing from the video\'s OWNER, and keeps the raw stats only where the line is shown', () => {
    const reader = read('src/lib/videos/video-tagged-server.ts');
    expect(reader).toContain('standing: game ? filmStanding(read.view.owner.kind, game.coverage) : null');
    // The LINE is held back as a spoiler; the raw stats are kept for the totals either way.
    expect(reader.indexOf('statsOf.set(read.view.id, stats);')).toBeLessThan(reader.indexOf("if (game.stats_hidden && !read.canManage && !actsForProfile) hidden = true;"));
    expect(reader).toContain('else line = cells;');
    expect(reader).toContain('return (await taggedGamesWithStats(admin, profileId, viewer, actsForProfile)).map(g => g.view);');
  });
  it('the list is split in two and a highlights-only game says why it is not counted', () => {
    const list = read('src/components/stats/GameFilmLines.tsx');
    expect(list).toContain('data-game-film-group={kind}');
    expect(list).toContain("data-game-film-standing={g.standing ?? 'recreational'}");
    expect(list).toContain('data-game-film-highlights=""');
  });
});
