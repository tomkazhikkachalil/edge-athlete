import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseExerciseParam, parseTrainingView, TRAINING_VIEWS, trainingViewSearch } from '../training/views';

// Training's four views (Training redesign PR 3, Nov 11 2026).
describe('training views', () => {
  it('are four, in Tom\'s order', () => {
    expect(TRAINING_VIEWS.map(v => v.label)).toEqual(['Overview', 'History', 'Exercises', 'Body & tests']);
  });

  it('the URL names the view; anything else is the Overview; the old activities link is History', () => {
    expect(parseTrainingView('history')).toBe('history');
    expect(parseTrainingView('exercises', 'training')).toBe('exercises');
    expect(parseTrainingView('body', 'activities')).toBe('body');
    expect(parseTrainingView(null)).toBe('overview');
    expect(parseTrainingView('')).toBe('overview');
    expect(parseTrainingView('constructor')).toBe('overview');
    expect(parseTrainingView('<script>')).toBe('overview');
    expect(parseTrainingView(null, 'activities')).toBe('history');
    expect(parseTrainingView(undefined, 'vitals')).toBe('overview');
  });

  it('a view round-trips through its address; the Overview is the bare tab every old link has', () => {
    expect(trainingViewSearch('overview')).toBe('?tab=training');
    for (const v of TRAINING_VIEWS) {
      const q = new URLSearchParams(trainingViewSearch(v.id));
      expect(q.get('tab')).toBe('training');
      expect(parseTrainingView(q.get('view'), q.get('tab'))).toBe(v.id);
    }
  });

  it('an open exercise rides the Exercises view only; the URL\'s value is an identity or nothing', () => {
    expect(trainingViewSearch('exercises', 'bench_press')).toBe('?tab=training&view=exercises&exercise=bench_press');
    expect(trainingViewSearch('exercises', null)).toBe('?tab=training&view=exercises');
    expect(trainingViewSearch('history', 'bench_press')).toBe('?tab=training&view=history');
    expect(trainingViewSearch('overview', 'bench_press')).toBe('?tab=training');
    expect(parseExerciseParam('bench_press')).toBe('bench_press');
    expect(parseExerciseParam('élévation_latérale')).toBe('élévation_latérale');
    for (const v of [null, undefined, '', 'bench press', 'a,b', 'x.eq.1', '"', 'x'.repeat(81)]) expect(parseExerciseParam(v)).toBeNull();
  });

  it('the rule file imports nothing; the tab reads the view from the URL and mirrors it without navigating', () => {
    const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
    expect(src('lib/training/views.ts')).not.toMatch(/^import /m);
    const tab = src('components/TrainingTab.tsx');
    expect(tab).toContain("parseTrainingView(query.get('view')");
    expect(tab).toContain('window.history.replaceState(null, \'\', `${window.location.pathname}${trainingViewSearch(next)}`)');
    expect(tab).not.toMatch(/router\.(push|replace)\([^)]*view=/);
    // Every section sits under exactly one view: the nine stacked sections are gone.
    for (const v of TRAINING_VIEWS) expect(tab).toContain(`view === '${v.id}' && (`);
    expect(tab).not.toContain('setShowWorkoutsOverlay');
    expect(tab).not.toContain('WorkoutDetailOverlay');
  });
});
