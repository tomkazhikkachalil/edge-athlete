import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Nov 19 2026 (Tom's round on the course): layout rules that a browser test
// cannot reach without an event or uploaded media, pinned at the source.
const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

describe('the posted scorecard', () => {
  const src = read('components/golf/SharedRoundFullCard.tsx');
  const table = src.slice(src.indexOf('const renderScorecardTable'), src.indexOf('{/* Header. `shrink-0`'));
  it('no media is drawn inside a nine\'s table: PAR is followed by the players', () => {
    expect(table).toContain('{/* Par Row */}');
    expect(table).toContain('{/* Player Rows */}');
    expect(table).not.toContain('MediaTile');
  });
  it('the hole media is one strip after the tables and the legend', () => {
    const strip = src.indexOf('data-round-hole-media=""');
    expect(strip).toBeGreaterThan(src.indexOf('{/* Legend */}'));
    expect(strip).toBeLessThan(src.indexOf('{/* Media Tab'));
    expect(src.slice(strip, src.indexOf('{/* Media Tab'))).toContain('MediaTile');
  });
  it('the yardage row sits above PAR and is drawn only when the round has a yardage', () => {
    expect(table.indexOf('data-round-yardage-row')).toBeGreaterThan(-1);
    expect(table.indexOf('data-round-yardage-row')).toBeLessThan(table.indexOf('{/* Par Row */}'));
    expect(table).toContain('{roundHasYardage && (');
  });
});

describe('a long name is cut or wrapped, never pushed off a phone', () => {
  it('both event leaderboards cut the player\'s name and keep its chips', () => {
    for (const file of ['components/sport-events/OverallBoard.tsx', 'components/sport-events/EventLeaderboard.tsx']) {
      const src = read(file);
      expect(src, file).toContain('className="inline-block max-w-[9rem] truncate align-bottom sm:max-w-[18rem]" title={r.name} data-board-name=""');
      expect(src, file).toContain('{r.flight && <span');
    }
  });
  it('Live Now cards have a width to cut against, in the strip and in the list', () => {
    const src = read('components/LiveNowStrip.tsx');
    expect(src.match(/'min-w-\[220px\] max-w-\[80vw\] sm:max-w-xs flex-shrink-0'/g)).toHaveLength(3);
    expect(src).not.toContain("'min-w-[220px] flex-shrink-0'");
    expect(src).toContain("'grid grid-cols-1 gap-3 sm:grid-cols-2'");
  });
  it('the event name in the three back links is cut, and its neighbours keep their size', () => {
    expect(read('app/(app)/live/[groupPostId]/page.tsx')).toContain('<span className="min-w-0 truncate">{scorecard.sport_event ? scorecard.sport_event.name : \'Live Now\'}</span>');
    expect(read('components/golf/GroupScoreCard.tsx')).toContain('<span className="min-w-0 truncate">{event.name}</span>');
    expect(read('components/sport-events/EventLiveScreen.tsx')).toContain('<span className="min-w-0 truncate">{view?.event.name ?? \'Event\'}</span>');
  });
  it('the course name wraps in the round\'s two cards', () => {
    expect(read('components/golf/SharedRoundFullCard.tsx')).toContain('<h2 className="text-2xl font-black min-w-0 break-words" data-round-course-name="">');
    expect(read('components/golf/SharedRoundQuickView.tsx')).toContain('<span className="font-bold text-primary text-base min-w-0 break-words">{golf_data.course_name}</span>');
  });
});

describe('the temperature row', () => {
  it('the label row is the label alone; the unit toggle rides beside the input', () => {
    const src = read('components/golf/round-steps/ConditionsStep.tsx');
    const label = src.indexOf('<label className={GOLF_LABEL} htmlFor="golf-temperature">');
    const row = src.indexOf('<div className="flex items-center gap-2">', label);
    expect(row).toBeGreaterThan(label);
    expect(src.indexOf('id="golf-temperature"', row)).toBeLessThan(src.indexOf('data-golf-temp-units=""', row));
    expect(src).not.toContain('flex items-end justify-between gap-2');
  });
});

describe('leftovers, Nov 19: the scorer badge and the round detail page', () => {
  it('the scorer badge follows the round: Final when completed, LIVE otherwise', () => {
    const src = read('components/golf/ScoreEntryModal.tsx');
    expect(src).toContain("{isLive && (roundStatus === 'completed' ? (");
    expect(src).toContain('data-scorer-status="final"');
    expect(src).toContain('data-scorer-status="live"');
    // The flag that drives saving is not the badge's.
    expect(src).toContain('const isLive = !!onSaveHole;');
    for (const caller of ['app/(app)/live/[groupPostId]/page.tsx', 'components/PostCard.tsx']) {
      expect(read(caller), caller).toMatch(/roundStatus=\{(scorecard|groupScorecard)\.group_post\.status\}/);
    }
  });
  it('the round detail page draws a yardage column only when the round kept one', () => {
    const src = read('app/(app)/app/sport/golf/rounds/[roundId]/page.tsx');
    expect(src).toContain("const hasYardage = holes.some(h => typeof h.distance_yards === 'number' && h.distance_yards > 0);");
    expect(src.match(/\{hasYardage && </g)).toHaveLength(3);
    expect(src.indexOf('data-round-detail-yds-head')).toBeLessThan(src.indexOf('uppercase">Par</th>'));
  });
});

describe('migration 316: the profile copy of a round keeps the estimated-par mark', () => {
  it('the three reads of golf_holes ask for the column', () => {
    expect(read('app/api/golf/rounds/[roundId]/route.ts').match(/distance_yards, notes, par_estimated/g)).toHaveLength(3);
    expect(read('lib/golf/post-read.ts')).toMatch(/par,\n\s+par_estimated,/);
    expect(read('lib/sport-profile/golf-profile-server.ts')).toContain("select('round_id, hole_number, par, par_estimated, strokes,");
  });
  it('the round detail page, the round card and the golf profile show it', () => {
    expect(read('app/(app)/app/sport/golf/rounds/[roundId]/page.tsx')).toContain("{h.par != null && h.par_estimated ? ' (est.)' : ''}");
    expect(read('components/golf/GolfRoundCard.tsx').match(/data-round-card-par-estimated=""/g)).toHaveLength(2);
    const profile = read('components/sport-profile/GolfProfile.tsx');
    expect(profile).toContain("${h.parEst ? ' (est.)' : ''}");
    expect(profile).toContain('data-golf-par-estimated={h.n}');
  });
});
