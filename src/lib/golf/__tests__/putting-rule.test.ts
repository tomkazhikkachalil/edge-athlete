import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PUTTING_MODE,
  GIMME_DEFAULT,
  GIMME_FEET_INVALID,
  GIMME_MAX,
  GIMME_MIN,
  PUTTING_LABEL,
  PUTTING_MODES,
  PUTTING_RULE_INVALID,
  clampGimmeFeet,
  isPuttingMode,
  parsePuttingRule,
  puttingInfoLine,
  puttingModeOr,
  puttingPayload,
  puttingRuleOf,
  puttingSummary,
} from '../putting-rule';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('the putting rule of an indoor round (Tom, Nov 27 2026)', () => {
  it('has three modes, Putt out first and the default; gimme runs 1 to 15 ft, 6 by default', () => {
    expect([...PUTTING_MODES]).toEqual(['putt_out', 'gimme', 'auto_2']);
    expect(PUTTING_LABEL).toEqual({ putt_out: 'Putt out', gimme: 'Gimme', auto_2: 'Auto 2' });
    expect(DEFAULT_PUTTING_MODE).toBe('putt_out');
    expect([GIMME_MIN, GIMME_MAX, GIMME_DEFAULT]).toEqual([1, 15, 6]);
  });

  it('knows a mode from anything else', () => {
    expect(isPuttingMode('gimme')).toBe(true);
    expect(isPuttingMode('Gimme')).toBe(false);
    expect(isPuttingMode(undefined)).toBe(false);
    expect(puttingModeOr('auto_2')).toBe('auto_2');
    expect(puttingModeOr(undefined)).toBe('putt_out');
    expect(puttingModeOr('two_putt')).toBe('putt_out');
  });

  it('holds the feet inside the range as a whole number; nonsense is the default', () => {
    expect(clampGimmeFeet(6)).toBe(6);
    expect(clampGimmeFeet(0)).toBe(1);
    expect(clampGimmeFeet(40)).toBe(15);
    expect(clampGimmeFeet(7.6)).toBe(8);
    expect(clampGimmeFeet('9')).toBe(9);
    expect(clampGimmeFeet(undefined)).toBe(6);
    expect(clampGimmeFeet('')).toBe(6);
    expect(clampGimmeFeet(NaN)).toBe(6);
  });

  it('the composer sends nothing outdoors; indoors the mode, and the feet only for gimme', () => {
    expect(puttingPayload(false, 'gimme', 8)).toEqual({});
    expect(puttingPayload(true, 'putt_out', 8)).toEqual({ putting_rule: 'putt_out' });
    expect(puttingPayload(true, 'auto_2', 8)).toEqual({ putting_rule: 'auto_2' });
    expect(puttingPayload(true, 'gimme', 8)).toEqual({ putting_rule: 'gimme', gimme_feet: 8 });
  });

  describe('the write gate', () => {
    it('an outdoor round has no rule, whatever was sent', () => {
      expect(parsePuttingRule('outdoor', 'gimme', 6)).toEqual({ ok: true, rule: null });
      expect(parsePuttingRule('outdoor', 'nonsense', 99)).toEqual({ ok: true, rule: null });
    });
    it('an indoor round with nothing sent has none (it reads as Putt out)', () => {
      expect(parsePuttingRule('indoor', undefined, undefined)).toEqual({ ok: true, rule: null });
      expect(parsePuttingRule('indoor', null, 6)).toEqual({ ok: true, rule: null });
    });
    it('keeps the mode; the feet only for gimme', () => {
      expect(parsePuttingRule('indoor', 'putt_out', undefined)).toEqual({ ok: true, rule: { mode: 'putt_out', gimmeFeet: null } });
      expect(parsePuttingRule('indoor', 'auto_2', 6)).toEqual({ ok: true, rule: { mode: 'auto_2', gimmeFeet: null } });
      expect(parsePuttingRule('indoor', 'gimme', 1)).toEqual({ ok: true, rule: { mode: 'gimme', gimmeFeet: 1 } });
      expect(parsePuttingRule('indoor', 'gimme', 15)).toEqual({ ok: true, rule: { mode: 'gimme', gimmeFeet: 15 } });
    });
    it('refuses a wrong value rather than repairing it', () => {
      expect(parsePuttingRule('indoor', 'two_putt', undefined)).toEqual({ ok: false, error: PUTTING_RULE_INVALID });
      for (const feet of [undefined, null, 0, 16, 6.5, '6']) {
        expect(parsePuttingRule('indoor', 'gimme', feet)).toEqual({ ok: false, error: GIMME_FEET_INVALID });
      }
    });
  });

  it('a stored round: none outdoors; an indoor round without one is Putt out', () => {
    expect(puttingRuleOf({ round_type: 'outdoor', putting_rule: null })).toBeNull();
    expect(puttingRuleOf({ round_type: null })).toBeNull();
    expect(puttingRuleOf({ round_type: 'indoor', putting_rule: null, gimme_feet: null })).toEqual({ mode: 'putt_out', gimmeFeet: null });
    expect(puttingRuleOf({ round_type: 'indoor', putting_rule: 'gimme', gimme_feet: 9 })).toEqual({ mode: 'gimme', gimmeFeet: 9 });
    expect(puttingRuleOf({ round_type: 'indoor', putting_rule: 'auto_2', gimme_feet: null })).toEqual({ mode: 'auto_2', gimmeFeet: null });
  });

  it("the info key's line, word for word; the gimme line follows the slider", () => {
    expect(puttingInfoLine('putt_out', 6)).toBe('Every putt is played and counted.');
    expect(puttingInfoLine('gimme', 6)).toBe('A ball that stops inside 6 ft is holed for 1 putt.');
    expect(puttingInfoLine('gimme', 12)).toBe('A ball that stops inside 12 ft is holed for 1 putt.');
    expect(puttingInfoLine('auto_2', 6)).toBe('Any ball on the green is holed for 2 putts.');
  });

  it("the Start step's Putting row, word for word; the gimme line carries the feet", () => {
    expect(puttingSummary('putt_out', 6)).toBe('Putt out · every putt counts');
    expect(puttingSummary('gimme', 6)).toBe('Gimme · inside 6 ft, 1 putt');
    expect(puttingSummary('gimme', 15)).toBe('Gimme · inside 15 ft, 1 putt');
    expect(puttingSummary('auto_2', 6)).toBe('Auto 2 · on the green, 2 putts');
  });

  it('is pure: the module imports nothing', () => {
    expect(read('src/lib/golf/putting-rule.ts')).not.toMatch(/^import /m);
  });
});

describe('the putting rule is stored and carried (migration 322)', () => {
  const migration = read('database/migrations/322_golf_putting_rule.sql');
  it('both tables get both columns, indoor only, the feet paired with gimme', () => {
    for (const table of ['golf_scorecard_data', 'golf_rounds']) {
      expect(migration).toContain(`ALTER TABLE public.${table}\n  ADD COLUMN IF NOT EXISTS putting_rule text,\n  ADD COLUMN IF NOT EXISTS gimme_feet smallint;`);
      expect(migration).toContain(`${table}_putting_indoor_check\n      CHECK (putting_rule IS NULL OR round_type = 'indoor')`);
      expect(migration).toContain(`${table}_gimme_feet_check`);
    }
    expect(migration).toContain("putting_rule IN ('putt_out', 'gimme', 'auto_2')");
    expect(migration).toContain('gimme_feet BETWEEN 1 AND 15');
  });
  it('the one writer gates it; the composer sends it; the mirror and the round reads carry it', () => {
    const route = read('src/app/api/group-posts/route.ts');
    expect(route).toContain('parsePuttingRule(golf_data.round_type, golf_data.putting_rule, golf_data.gimme_feet)');
    expect(route).toContain('putting_rule: puttingRule?.mode ?? null,');
    expect(route).toContain('gimme_feet: puttingRule?.gimmeFeet ?? null,');
    expect(read('src/components/golf/shared-round-submit.ts')).toContain('...puttingPayload(');
    const mirror = read('src/lib/golf/round-mirror.ts');
    expect(mirror).toContain('putting_rule, gimme_feet,');
    expect(mirror).toContain('putting_rule: golfData.putting_rule ?? null,');
    expect(read('src/lib/golf/scorecard-transform.ts')).toMatch(/course_rating,\n\s+putting_rule,\n\s+gimme_feet,/);
    expect(read('src/app/api/golf/rounds/[roundId]/route.ts').match(/putting_rule, gimme_feet,/g)).toHaveLength(3);
  });
  it('the scoring card does not read it yet (setup only)', () => {
    for (const file of ['src/lib/golf/score-card.ts', 'src/lib/golf/score-entry.ts', 'src/components/golf/scoring/ScoreControls.tsx']) {
      expect(read(file)).not.toMatch(/putting_rule|gimme/i);
    }
  });
});
