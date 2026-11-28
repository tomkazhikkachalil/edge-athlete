import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROUND_ANSWERS,
  ALREADY_PLAYED_OFFERED,
  ALREADY_PLAYED_STEPS_BUILT,
  REFUSAL_PLAYED_STEPS,
  REFUSAL_SCORES,
  REFUSAL_DATE_FUTURE,
  playedDateAllowed,
  LIVE_OUTDOOR_STEPS,
  offeredAlreadyPlayed,
  conditionsLine,
  liveOutdoorStepNumber,
  weatherWord,
  windOptionLabel,
  windRange,
  REFUSAL_COURSE,
  REFUSAL_COURSE_ADD,
  REFUSAL_TEE,
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
  it('Already played walks the same steps plus Scores before its finish, labelled Create; a live round has no Scores step', () => {
    expect(ids({ alreadyPlayed: true, indoor: false })).toEqual(['type', 'course', 'format', 'conditions', 'players', 'scores', 'finish']);
    expect(ids({ alreadyPlayed: true, indoor: true })).toEqual(['type', 'course', 'format', 'players', 'scores', 'finish']);
    for (const indoor of [true, false]) {
      expect(ids({ alreadyPlayed: false, indoor }) as string[]).not.toContain('scores');
    }
    expect(stepsForRound({ alreadyPlayed: true, indoor: false }).at(-1)?.label).toBe('Create');
  });
  it('Conditions and Players are skippable (nothing on them was ever required); Type, Course, Format, Scores and the finish are not', () => {
    const steps = stepsForRound({ alreadyPlayed: true, indoor: false });
    const skippable = steps.filter(s => s.skippable).map(s => s.id);
    expect(skippable).toEqual(['conditions', 'players']);
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
    expect(roundStepIndex(live, 'finish')).toBe(5);
    // A draft saved on the retired Scores step starts over.
    expect(roundStepIndex(live, 'scores')).toBe(0);
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
    for (const id of ['format', 'conditions', 'players'] as const) {
      expect(roundStepRefusal(id, { courseName: '', date: '', alreadyPlayed: true })).toBeNull();
    }
  });
});

// Nov 27 2026 (Tom): Live / Already played are keys on step 1 again; the
// played steps are built next, so the played path stops on step 1 until then.
describe('step 1 can hold an already-played round (the switch in round-steps.ts)', () => {
  const played = { courseName: '', date: '', alreadyPlayed: true };
  it('the steps are built, so step 1 lets Already played through', () => {
    expect(ALREADY_PLAYED_STEPS_BUILT).toBe(true);
    expect(roundStepRefusal('type', played)).toBeNull();
    expect(roundStepRefusal('type', { ...played, indoor: true })).toBeNull();
  });
  it('switched off, it refuses Next for Already played, outdoor and indoor', () => {
    expect(roundStepRefusal('type', played, false)).toBe(REFUSAL_PLAYED_STEPS);
    expect(roundStepRefusal('type', { ...played, indoor: true }, false)).toBe(REFUSAL_PLAYED_STEPS);
  });
  it('a live round never meets the rule', () => {
    expect(roundStepRefusal('type', { ...played, alreadyPlayed: false }, false)).toBeNull();
    expect(roundStepRefusal('type', { ...played, alreadyPlayed: false, indoor: true }, false)).toBeNull();
  });
  it('once the steps are built, step 1 lets it through', () => {
    expect(roundStepRefusal('type', played, true)).toBeNull();
  });
});

describe('an indoor round waits for its tee on the course step (Tom, Nov 27 2026)', () => {
  const indoor = { courseName: 'Eagle Creek', date: '', alreadyPlayed: false, indoor: true, courseShown: true };
  it('Next is refused until a tee is picked, then allowed', () => {
    expect(roundStepRefusal('course', { ...indoor, teeColor: '' })).toBe(REFUSAL_TEE);
    expect(roundStepRefusal('course', { ...indoor })).toBe(REFUSAL_TEE);
    expect(roundStepRefusal('course', { ...indoor, teeColor: 'blue' })).toBeNull();
  });
  it('a name typed but not yet added is asked for the course, not for a tee it cannot see', () => {
    expect(roundStepRefusal('course', { ...indoor, courseShown: false, teeColor: '' })).toBe(REFUSAL_COURSE_ADD);
    expect(roundStepRefusal('course', { ...indoor, courseName: '', teeColor: '' })).toBe(REFUSAL_COURSE);
  });
  it('an outdoor round never needs a tee; the finish never asks for one', () => {
    expect(roundStepRefusal('course', { ...indoor, indoor: false, teeColor: '' })).toBeNull();
    expect(roundStepRefusal('finish', { ...indoor, teeColor: '' })).toBeNull();
  });
});

describe('an already-played round needs a score, and a date not after today (Nov 27 2026)', () => {
  const ok = { courseName: 'Eagle Creek', date: '2026-11-20', alreadyPlayed: true, scoresEntered: true, today: '2026-11-27' };
  it('the Scores step and the Create refuse until one hole is scored', () => {
    expect(roundStepRefusal('scores', { ...ok, scoresEntered: false })).toBe(REFUSAL_SCORES);
    expect(roundStepRefusal('scores', { ...ok, scoresEntered: undefined })).toBe(REFUSAL_SCORES);
    expect(roundStepRefusal('scores', ok)).toBeNull();
    expect(roundStepRefusal('finish', { ...ok, scoresEntered: false })).toBe(REFUSAL_SCORES);
    expect(roundStepRefusal('finish', ok)).toBeNull();
  });
  it('the course and the date are asked for before the scores', () => {
    expect(roundStepRefusal('finish', { ...ok, courseName: '', scoresEntered: false })).toBe(REFUSAL_COURSE);
    expect(roundStepRefusal('finish', { ...ok, date: '', scoresEntered: false })).toBe(REFUSAL_DATE);
  });
  it('a live round never needs a score', () => {
    expect(roundStepRefusal('finish', { ...ok, alreadyPlayed: false, scoresEntered: false })).toBeNull();
    expect(roundStepRefusal('scores', { ...ok, alreadyPlayed: false, scoresEntered: false })).toBeNull();
  });
  it('a date after today is refused on the course step and the Create; today and earlier pass', () => {
    expect(roundStepRefusal('course', { ...ok, date: '2026-11-28' })).toBe(REFUSAL_DATE_FUTURE);
    expect(roundStepRefusal('finish', { ...ok, date: '2026-11-28' })).toBe(REFUSAL_DATE_FUTURE);
    expect(roundStepRefusal('course', { ...ok, date: '2026-11-27' })).toBeNull();
    expect(roundStepRefusal('course', { ...ok, date: '2019-06-01' })).toBeNull();
    expect(roundStepRefusal('course', { ...ok, alreadyPlayed: false, date: '2026-11-28' })).toBeNull();
  });
  it('the server judges the date by the latest day anywhere on Earth', () => {
    const now = new Date('2026-11-27T12:00:00Z');
    expect(playedDateAllowed('2026-11-27', now)).toBe(true);
    expect(playedDateAllowed('2026-11-28', now)).toBe(true); // already the 28th at UTC+14
    expect(playedDateAllowed('2026-11-29', now)).toBe(false);
    expect(playedDateAllowed('2020-02-29', now)).toBe(true);
    expect(playedDateAllowed('2026-02-30', now)).toBe(false);
    expect(playedDateAllowed('27/11/2026', now)).toBe(false);
    expect(playedDateAllowed('', now)).toBe(false);
    expect(playedDateAllowed(undefined, now)).toBe(false);
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
    expect(LIVE_OUTDOOR_STEPS).toHaveLength(6);
  });
});

describe('conditionsLine — "Sunny · 11 °C · 5 to 10 mph" (Nov 24 2026, the design wording)', () => {
  it('the word without its emoji, the temperature in the viewer\'s unit, the band as its mph range', () => {
    expect(conditionsLine({ weather: 'cloudy', temperature: 7, unit: '°C', wind: 'light' })).toBe('Cloudy · 7 °C · 5 to 10 mph');
    expect(conditionsLine({ weather: 'partly-cloudy', temperature: 54.3, unit: '°F', wind: 'moderate' })).toBe('Partly cloudy · 54 °F · 10 to 20 mph');
    expect(conditionsLine({ weather: 'sunny', temperature: 11, unit: '°C', wind: 'light' })).toBe('Sunny · 11 °C · 5 to 10 mph');
  });
  it('drops what was not entered, and is null when nothing was', () => {
    expect(conditionsLine({ weather: '', temperature: null, unit: '°C', wind: 'strong' })).toBe('20+ mph');
    expect(conditionsLine({ weather: 'sunny', temperature: null, unit: '°F', wind: '' })).toBe('Sunny');
    expect(conditionsLine({ weather: '', temperature: null, unit: '°F', wind: '' })).toBeNull();
    expect(windRange('calm')).toBe('0 to 5 mph');
    expect(windOptionLabel('light')).toBe('Light (5 to 10 mph)');
    expect(windOptionLabel('strong')).toBe('Strong (20+ mph)');
    expect(windOptionLabel('gale')).toBeNull();
    expect(windRange('gale')).toBeNull();
    expect(weatherWord('windy')).toBe('Windy');
    expect(weatherWord('hail')).toBeNull();
  });
});

describe('roundFrame — the dialog width on a desktop', () => {
  it('every step is narrow except a shown course (Nov 24 2026: the later steps are 480 px again)', async () => {
    const { roundFrame } = await import('../round-steps');
    expect(roundFrame('type', false)).toBe('narrow');
    expect(roundFrame('type', true)).toBe('narrow');
    expect(roundFrame('course', false)).toBe('narrow');
    expect(roundFrame('course', true)).toBe('wide');
    for (const id of ['format', 'conditions', 'players', 'finish'] as const) {
      expect(roundFrame(id, false)).toBe('narrow');
      expect(roundFrame(id, true)).toBe('narrow');
    }
  });
  it('the open scorecard of a shown course takes the full frame — and only there', async () => {
    const { roundFrame } = await import('../round-steps');
    expect(roundFrame('course', true, true)).toBe('full');
    expect(roundFrame('course', false, true)).toBe('narrow');
    expect(roundFrame('type', true, true)).toBe('narrow');
    expect(roundFrame('format', true, true)).toBe('narrow');
  });
});

// Nov 25 2026 (Tom): "Already played" was hidden until its rebuild — a round
// logged that way would have no scores and no door to add them. Nov 27 2026:
// the key is offered again and its steps are built, so a saved draft comes
// back in the mode it was saved in.
describe('ALREADY_PLAYED_OFFERED — the key is back, a restored draft keeps its mode', () => {
  it('is on: an already-played answer in a draft stands; switched off it is a live round', () => {
    expect(ALREADY_PLAYED_OFFERED).toBe(true);
    expect(offeredAlreadyPlayed(true)).toBe(true);
    expect(offeredAlreadyPlayed(true, false)).toBe(false);
    expect(offeredAlreadyPlayed(false)).toBe(false);
    expect(offeredAlreadyPlayed(undefined)).toBe(false);
  });
  it('once offered again, the answer stands', () => {
    expect(offeredAlreadyPlayed(true, true)).toBe(true);
    expect(offeredAlreadyPlayed(false, true)).toBe(false);
  });
});
