import { describe, expect, it } from 'vitest';
import { ACTIVITY_TYPES } from '../catalog';
import { detailFieldsFor, detailLine, detailsFromRow, prefillFrom, SHOWN_MAX, splitFields } from '../details';
import { parseFinishAnswers } from '../details-schema';
import { lengths } from '../pool';
import { formatQuantity, fromInput, toDisplay } from '../units';

describe('the per-type questions', () => {
  it('show at most three up front for every type; keys are unique', () => {
    for (const t of ACTIVITY_TYPES) {
      const { shown, more } = splitFields(t);
      // a sub-field (showIf — the room's temperature under "Heated") is part of its question
      expect(shown.filter(f => !f.showIf).length).toBeLessThanOrEqual(SHOWN_MAX);
      expect(shown.length + more.length).toBe(detailFieldsFor(t).length);
      const keys = detailFieldsFor(t).map(f => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('the yoga questions (the user’s complaint)', () => {
  it('shows style, heated (with its temperature) and class up front; focus and poses behind More', () => {
    const { shown, more } = splitFields('yoga');
    expect(shown.map(f => f.key)).toEqual(['style', 'heated', 'room_temp_c', 'guided']);
    expect(more.map(f => f.key)).toEqual(['focus', 'poses']);
    expect(detailLine('yoga', { style: 'vinyasa', heated: true, room_temp_c: 40, guided: 'class', focus: ['hips', 'back'] }, 'metric')).toBe('Vinyasa · Heated · 40 °C · Class · Hips, Back');
    expect(prefillFrom('yoga', { style: 'yin', heated: true, room_temp_c: 40, poses: 'pigeon' })).toEqual({ style: 'yin', heated: true });
  });

  it('a temperature without Heated is dropped', () => {
    expect(parseFinishAnswers('yoga', { details: { heated: false, room_temp_c: 38 } })).toMatchObject({ ok: true, value: { details: { heated: false } } });
  });

  it('sparring rounds hang off Sparring', () => {
    const { shown } = splitFields('martial_arts');
    expect(shown.map(f => f.key)).toEqual(['discipline', 'session', 'sparring_rounds', 'rank']);
    expect(parseFinishAnswers('martial_arts', { details: { discipline: 'bjj', session: 'sparring', sparring_rounds: 5, rank: 'Blue belt' } })).toMatchObject({ ok: true });
  });
});

describe('parseFinishAnswers', () => {
  it('reads effort, notes and a pool swim’s details', () => {
    const r = parseFinishAnswers('swim', { effort: 7, notes: '  felt smooth ', details: { pool: '25m', stroke: 'freestyle' } });
    expect(r).toEqual({ ok: true, value: { effort: 7, notes: 'felt smooth', details: { pool: '25m', stroke: 'freestyle' }, avgPower: null, avgCadence: null } });
  });

  it('routes a column field to its column, never into details', () => {
    const r = parseFinishAnswers('row', { details: { setting: 'machine', stroke_rate: 26, watts: 210 } });
    expect(r).toMatchObject({ ok: true, value: { details: { setting: 'machine' }, avgCadence: 26, avgPower: 210 } });
  });

  it('refuses by name: an effort of 11, an unknown key, an option that is not one, a number out of range', () => {
    expect(parseFinishAnswers('swim', { effort: 11 })).toMatchObject({ ok: false });
    expect(parseFinishAnswers('swim', { details: { colour: 'blue' } })).toMatchObject({ ok: false, error: expect.stringContaining('finish.details') });
    expect(parseFinishAnswers('swim', { details: { pool: '33m' } })).toMatchObject({ ok: false });
    expect(parseFinishAnswers('treadmill', { details: { incline_pct: 90 } })).toMatchObject({ ok: false });
    expect(parseFinishAnswers('swim', { effort: 5, sneaky: true })).toMatchObject({ ok: false });
  });

  it('nothing answered is nothing stored', () => {
    expect(parseFinishAnswers('swim', undefined)).toEqual({ ok: true, value: { effort: null, notes: null, details: null, avgPower: null, avgCadence: null } });
    expect(parseFinishAnswers('swim', { notes: '   ', details: {} })).toMatchObject({ ok: true, value: { notes: null, details: null } });
    // a type with no questions refuses any detail
    expect(parseFinishAnswers('run', { details: { pool: '25m' } })).toMatchObject({ ok: false });
  });
});

describe('prefillFrom — choices only (Tom’s rule)', () => {
  it('copies a choice and a yes/no, never a number', () => {
    expect(prefillFrom('swim', { pool: '50m', stroke: 'mixed' })).toEqual({ pool: '50m', stroke: 'mixed' });
    expect(prefillFrom('open_water_swim', { water_temp_c: 18, wetsuit: true })).toEqual({ wetsuit: true });
    expect(prefillFrom('stair_climber', { climbed: 120, climbed_unit: 'floors' })).toEqual({ climbed_unit: 'floors' });
    expect(prefillFrom('treadmill', { incline_pct: 3 })).toEqual({});
  });

  it('walks every field of every type: only choice / multi / bool survive', () => {
    for (const t of ACTIVITY_TYPES) {
      const last: Record<string, unknown> = {};
      for (const f of detailFieldsFor(t)) {
        if (f.kind === 'choice') last[f.key] = f.options[0].value;
        if (f.kind === 'multi') last[f.key] = [f.options[0].value];
        if (f.kind === 'bool') last[f.key] = true;
        if (f.kind === 'number' && !f.column) last[f.key] = f.min;
        if (f.kind === 'text') last[f.key] = 'x';
      }
      const kept = prefillFrom(t, last);
      for (const k of Object.keys(kept)) {
        const f = detailFieldsFor(t).find(x => x.key === k)!;
        expect(['choice', 'multi', 'bool'], `${t}.${k}`).toContain(f.kind);
      }
    }
  });

  it('a stored value the type no longer knows is dropped quietly', () => {
    expect(detailsFromRow('swim', { pool: '25m', old_key: 1 })).toEqual({ pool: '25m' });
    expect(detailsFromRow('swim', 'nonsense')).toEqual({});
  });
});

describe('detailLine and units', () => {
  it('reads a swim, a stair climb and an open-water swim in either unit', () => {
    expect(detailLine('swim', { pool: '25m', stroke: 'freestyle' }, 'metric')).toBe('Pool 25 m · Freestyle');
    expect(detailLine('stair_climber', { climbed: 120, climbed_unit: 'floors' }, 'metric')).toBe('120 floors');
    expect(detailLine('open_water_swim', { water_temp_c: 18, wetsuit: true }, 'imperial')).toBe('64 °F · Wetsuit');
    expect(detailLine('run', {}, 'metric')).toBeNull();
  });

  it('round-trips °C↔°F, kg↔lb and 25 yd', () => {
    expect(toDisplay('temp', 40, 'imperial')).toBeCloseTo(104, 5);
    expect(fromInput('temp', 104, 'imperial')).toBeCloseTo(40, 5);
    expect(fromInput('weight', toDisplay('weight', 12.5, 'imperial'), 'imperial')).toBeCloseTo(12.5, 6);
    expect(toDisplay('length', 22.86, 'imperial')).toBeCloseTo(25, 6);
    expect(formatQuantity('weight', 9, 'imperial')).toBe('19.8 lb');
  });

  it('counts lengths: 1,500 m in a 25 yd pool is 66', () => {
    expect(lengths(1500, '25yd')).toBe(66);
    expect(lengths(1500, '25m')).toBe(60);
    expect(lengths(null, '25m')).toBeNull();
    expect(lengths(1500, null)).toBeNull();
  });
});
