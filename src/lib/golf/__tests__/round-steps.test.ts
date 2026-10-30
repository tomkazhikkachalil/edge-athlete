import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROUND_ANSWERS,
  LIVE_OUTDOOR_STEPS,
  conditionsLine,
  liveOutdoorStepNumber,
  weatherWord,
  windRange,
  REFUSAL_COURSE,
  REFUSAL_DATE,
  roundBusyLabel,
  roundDateForMode,
  roundFinishLabel,
  roundStepIndex,
  roundStepRefusal,
  stepsForRound,
} from '../round-steps';

// The golf round setup as steps (Oct 28 2026): the list follows the first
// step's answers, only the course step refuses, the date is locked while live.
const ids = (a: Parameters<typeof stepsForRound>[0]) => stepsForRound(a).map(s => s.id);

describe('stepsForRound — the list follows the first step', () => {
  it('Playing now + Outdoor (the defaults) is six steps ending in Start', () => {
    expect(DEFAULT_ROUND_ANSWERS).toEqual({ alreadyPlayed: false, indoor: false });
    expect(ids(DEFAULT_ROUND_ANSWERS)).toEqual(['type', 'course', 'format', 'conditions', 'players', 'finish']);
    expect(stepsForRound(DEFAULT_ROUND_ANSWERS).at(-1)?.label).toBe('Start');
  });
  it('Indoor drops Conditions', () => {
    expect(ids({ alreadyPlayed: false, indoor: true })).toEqual(['type', 'course', 'format', 'players', 'finish']);
  });
  it('Already played adds Scores before the finish, labelled Create', () => {
    expect(ids({ alreadyPlayed: true, indoor: false })).toEqual(['type', 'course', 'format', 'conditions', 'players', 'scores', 'finish']);
    expect(ids({ alreadyPlayed: true, indoor: true })).toEqual(['type', 'course', 'format', 'players', 'scores', 'finish']);
    expect(stepsForRound({ alreadyPlayed: true, indoor: false }).at(-1)?.label).toBe('Create');
  });
  it('Conditions, Players and Scores are skippable (nothing on them was ever required); Type, Course, Format and the finish are not', () => {
    const steps = stepsForRound({ alreadyPlayed: true, indoor: false });
    const skippable = steps.filter(s => s.skippable).map(s => s.id);
    expect(skippable).toEqual(['conditions', 'players', 'scores']);
  });
  it('every step has a label and ids are unique', () => {
    for (const a of [DEFAULT_ROUND_ANSWERS, { alreadyPlayed: true, indoor: true }]) {
      const steps = stepsForRound(a);
      expect(new Set(steps.map(s => s.id)).size).toBe(steps.length);
      for (const s of steps) expect(s.label.length).toBeGreaterThan(0);
    }
  });
});

describe('roundStepIndex — a step the list no longer holds starts over', () => {
  it('finds a step, and falls back to 0 for a missing or undefined id', () => {
    const live = stepsForRound(DEFAULT_ROUND_ANSWERS);
    expect(roundStepIndex(live, 'players')).toBe(4);
    expect(roundStepIndex(live, 'scores')).toBe(0); // no Scores step while Playing now
    expect(roundStepIndex(live, undefined)).toBe(0);
  });
});

describe('roundStepRefusal — only course and the finish refuse, only for course + date', () => {
  const ok = { courseName: 'Eagle Creek', date: '2026-10-28', alreadyPlayed: true };
  it('the course step refuses without a course, then without a date for an already-played round', () => {
    expect(roundStepRefusal('course', { ...ok, courseName: '  ' })).toBe(REFUSAL_COURSE);
    expect(roundStepRefusal('course', { ...ok, date: '' })).toBe(REFUSAL_DATE);
    expect(roundStepRefusal('course', ok)).toBeNull();
  });
  it('a live round never needs a date (it is locked to today)', () => {
    expect(roundStepRefusal('course', { courseName: 'Eagle Creek', date: '', alreadyPlayed: false })).toBeNull();
  });
  it('the finish mirrors the course step; every other step always advances', () => {
    expect(roundStepRefusal('finish', { ...ok, courseName: '' })).toBe(REFUSAL_COURSE);
    for (const id of ['type', 'format', 'conditions', 'players', 'scores'] as const) {
      expect(roundStepRefusal(id, { courseName: '', date: '', alreadyPlayed: true })).toBeNull();
    }
  });
});

describe('the date, the finish and the busy labels', () => {
  it('a live round is dated today; an already-played round keeps the pick', () => {
    expect(roundDateForMode(false, '2026-10-01', '2026-10-28')).toBe('2026-10-28');
    expect(roundDateForMode(true, '2026-10-01', '2026-10-28')).toBe('2026-10-01');
  });
  it('the two labels the one-page form used', () => {
    expect(roundFinishLabel(false)).toBe('Go Live');
    expect(roundFinishLabel(true)).toBe('Create Post');
    expect(roundBusyLabel(false)).toBe('Starting…');
    expect(roundBusyLabel(true)).toBe('Creating...');
  });
});

// The live + outdoor path's numbering and the one-line conditions (Oct 29 2026).
describe('LIVE_OUTDOOR_STEPS — the numbering the refinement spec names', () => {
  it('is exactly stepsForRound of the defaults: 1 Round type · 2 Course · 3 Game format · 4 Conditions · 5 Players · 6 Start', () => {
    expect([...LIVE_OUTDOOR_STEPS]).toEqual(stepsForRound(DEFAULT_ROUND_ANSWERS).map(s => s.id));
    expect(liveOutdoorStepNumber('conditions')).toBe(4);
    expect(liveOutdoorStepNumber('finish')).toBe(6);
    expect(liveOutdoorStepNumber('scores')).toBe(0);
  });
});

describe('conditionsLine — "Cloudy, 7°C, 5–10 mph"', () => {
  it('the word without its emoji, the temperature tight in the viewer\'s unit, the band as its mph range', () => {
    expect(conditionsLine({ weather: 'cloudy', temperature: 7, unit: '°C', wind: 'light' })).toBe('Cloudy, 7°C, 5–10 mph');
    expect(conditionsLine({ weather: 'partly-cloudy', temperature: 54.3, unit: '°F', wind: 'moderate' })).toBe('Partly cloudy, 54°F, 10–20 mph');
  });
  it('drops what was not entered, and is null when nothing was', () => {
    expect(conditionsLine({ weather: '', temperature: null, unit: '°C', wind: 'strong' })).toBe('20+ mph');
    expect(conditionsLine({ weather: 'sunny', temperature: null, unit: '°F', wind: '' })).toBe('Sunny');
    expect(conditionsLine({ weather: '', temperature: null, unit: '°F', wind: '' })).toBeNull();
    expect(windRange('calm')).toBe('0–5 mph');
    expect(windRange('gale')).toBeNull();
    expect(weatherWord('windy')).toBe('Windy');
    expect(weatherWord('hail')).toBeNull();
  });
});
