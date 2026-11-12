import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_SHEETS, gameSheetFor, periodLabel, rolePrimary, sheetEvent, sheetStatKeys } from '../game-sheets';
import { STAT_SCHEMAS } from '@/lib/sports/stat-schemas';
import { getAllSports } from '@/lib/sports/SportRegistry';

/**
 * The game sheets (Sprint 3, Nov 12 2026): what can be tagged on a full-game
 * video per sport, and what each tag adds. Every sport has one; every stat
 * key is the sport's own stat-schema key or a declared extra.
 */
describe('every sport has a sheet', () => {
  const registry = getAllSports().map(s => s.sport_key).sort();
  it('one sheet per registry sport — on or off — and no sheet for a sport that does not exist', () => {
    expect(Object.keys(GAME_SHEETS).sort()).toEqual(registry);
    for (const [key, sheet] of Object.entries(GAME_SHEETS)) expect(sheet.sportKey).toBe(key);
    expect(registry.length).toBe(17);
  });
  it('gameSheetFor: a known key, an unknown one, nothing', () => {
    expect(gameSheetFor('basketball')?.family).toBe('team');
    expect(gameSheetFor('curling')).toBeNull();
    expect(gameSheetFor(null)).toBeNull();
  });
  it('the module is zero-import', () => {
    expect(readFileSync(join(process.cwd(), 'src/lib/videos/game-sheets.ts'), 'utf8')).not.toMatch(/^import /m);
  });
});

describe('each sheet is well formed', () => {
  for (const sheet of Object.values(GAME_SHEETS)) {
    describe(sheet.sportKey, () => {
      it('event keys are unique, labelled, and short enough for a chip', () => {
        const keys = sheet.events.map(e => e.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const e of sheet.events) {
          expect(e.key).toMatch(/^[a-z0-9_]{2,32}$/);
          expect(e.label.length).toBeGreaterThanOrEqual(2);
          expect(e.short.length).toBeLessThanOrEqual(6);
          const roles = e.roles.map(r => r.key);
          expect(new Set(roles).size).toBe(roles.length);
          if (e.takesValue) expect(e.takesValue.min).toBeLessThanOrEqual(e.takesValue.max);
          for (const r of e.roles) for (const v of Object.values(r.stats)) if (v === 'value') expect(e.takesValue, `${e.key} uses the tag's value`).toBeTruthy();
          if (e.score?.points === 'value') expect(e.takesValue).toBeTruthy();
        }
      });
      it('every stat key is the sport\'s stat-schema key or a declared extra — and no extra shadows a schema key', () => {
        const schema = new Set((STAT_SCHEMAS[sheet.sportKey as keyof typeof STAT_SCHEMAS]?.fields ?? []).map(f => f.key));
        for (const k of sheetStatKeys(sheet)) expect(schema.has(k) || k in sheet.extra, `${sheet.sportKey}.${k}`).toBe(true);
        for (const k of Object.keys(sheet.extra)) expect(schema.has(k), `${sheet.sportKey}.${k} is a schema key`).toBe(false);
      });
      it('every box and team column reads a key some tag can produce', () => {
        const made = new Set(sheetStatKeys(sheet));
        for (const col of [...sheet.box, ...sheet.team]) for (const k of typeof col.key === 'string' ? [col.key] : col.key) expect(made.has(k), `${sheet.sportKey} column ${col.label} → ${k}`).toBe(true);
      });
      it('the family fits: a team sport scores and has a box score; a set sport names its target; combat has a finish; a race has a finish with a time; golf has a hole', () => {
        if (sheet.family === 'team') {
          expect(sheet.events.some(e => e.score)).toBe(true);
          expect(sheet.box.length).toBeGreaterThan(3);
          expect(sheet.scoreMode).not.toBe('none');
        }
        if (sheet.scoreMode === 'sets') expect(sheet.setTarget?.(1)).toBeGreaterThan(0);
        if (sheet.family === 'combat') expect(sheet.events.filter(e => e.finish).length).toBeGreaterThanOrEqual(2);
        if (sheet.family === 'race') expect(sheetEvent(sheet, 'finish')?.takesValue?.kind).toBe('time_ms');
        if (sheet.family === 'golf') expect(sheetEvent(sheet, 'hole_score')?.takesValue?.kind).toBe('strokes');
      });
    });
  }
});

describe('the baselines the broadcasters print', () => {
  const cols = (k: string) => GAME_SHEETS[k].box.map(c => c.label);
  it('basketball: PTS REB AST STL BLK FG 3PT FT TO PF; a three is three points, a field goal and a three', () => {
    expect(cols('basketball')).toEqual(['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG', '3PT', 'FT', 'TO', 'PF']);
    const three = sheetEvent(GAME_SHEETS.basketball, 'fg3_made')!;
    expect(three.score).toEqual({ points: 3, to: 'own' });
    expect(three.roles[0].stats).toEqual({ points: 3, fgm: 1, fga: 1, threes: 1, tpa: 1 });
    expect(three.roles[1]).toMatchObject({ key: 'assist', stats: { assists: 1 } });
  });
  it('soccer: an own goal scores for the other side; a goal is also a shot on target; corners and offsides are the team\'s', () => {
    expect(sheetEvent(GAME_SHEETS.soccer, 'own_goal')!.score).toEqual({ points: 1, to: 'other' });
    expect(sheetEvent(GAME_SHEETS.soccer, 'goal')!.roles[0].stats).toEqual({ goals: 1, shots: 1, shots_on_target: 1 });
    expect(sheetEvent(GAME_SHEETS.soccer, 'corner')).toMatchObject({ roles: [], team: { corners: 1 } });
  });
  it('hockey: two assists, the beaten goalie is on the other side and never primary, a penalty carries its minutes', () => {
    const goal = sheetEvent(GAME_SHEETS.ice_hockey, 'goal_pp')!;
    expect(goal.roles.find(r => r.key === 'assist')!.max).toBe(2);
    const goalie = goal.roles.find(r => r.key === 'goalie')!;
    expect(goalie.other).toBe(true);
    expect(rolePrimary(goal, goalie)).toBe(false);
    expect(rolePrimary(goal, goal.roles[0])).toBe(true);
    expect(sheetEvent(GAME_SHEETS.ice_hockey, 'penalty')!.takesValue).toMatchObject({ kind: 'minutes', default: 2 });
  });
  it('volleyball: sets to 25, the fifth to 15; an error is the opponent\'s point', () => {
    expect(GAME_SHEETS.volleyball.setTarget!(1)).toBe(25);
    expect(GAME_SHEETS.volleyball.setTarget!(5)).toBe(15);
    expect(sheetEvent(GAME_SHEETS.volleyball, 'service_error')!.score).toEqual({ points: 1, to: 'other' });
  });
  it('baseball: a home run is a hit, an at-bat, a run and an RBI', () => {
    expect(sheetEvent(GAME_SHEETS.baseball, 'home_run')!.roles[0].stats).toMatchObject({ hits: 1, at_bats: 1, home_runs: 1, runs: 1, rbis: 1 });
  });
  it('period labels: Q3, OT, OT2, P2, S4, Inning… by the sheet', () => {
    expect(periodLabel(GAME_SHEETS.basketball, 3)).toBe('Q3');
    expect(periodLabel(GAME_SHEETS.basketball, 5)).toBe('OT');
    expect(periodLabel(GAME_SHEETS.basketball, 6)).toBe('OT2');
    expect(periodLabel(GAME_SHEETS.ice_hockey, 2)).toBe('P2');
    expect(periodLabel(GAME_SHEETS.volleyball, 4)).toBe('S4');
    expect(periodLabel(GAME_SHEETS.baseball, 7)).toBe('Inning 7');
    expect(periodLabel(GAME_SHEETS.soccer, 3)).toBe('ET');
    expect(periodLabel(GAME_SHEETS.soccer, null)).toBe('');
  });
});
