import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTrainingView, TRAINING_VIEWS, trainingViewSearch } from '../training/views';

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
