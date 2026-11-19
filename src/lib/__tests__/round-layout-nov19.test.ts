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
