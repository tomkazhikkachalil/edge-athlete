import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CREATE_OPTIONS, CREATE_PICK_BEAT_MS, toggleInfo } from '../create-options';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

// The Create sheet as a tile grid (Tom's spec, Nov 23 2026): titles only, the
// description behind an info button, one open at a time, nothing moves.
describe('the Create sheet\'s options', () => {
  it('six options in the Nov 20 order, with the spec\'s titles, shapes and info texts', () => {
    expect(CREATE_OPTIONS.map((o) => [o.key, o.title, o.shape])).toEqual([
      ['post', 'Post', 'hero'],
      ['sport', 'Sport session', 'tile'],
      ['workout', 'Gym workout', 'tile'],
      ['recording', 'Live activity', 'tile'],
      ['event', 'Event & leaderboard', 'tile'],
      ['full-game', 'Game highlights', 'row'],
    ]);
    expect(CREATE_OPTIONS.map((o) => o.info)).toEqual([
      'Share text, photos and video.',
      'Pick a sport and start a session, like a golf round.',
      'Log sets, reps and weight, with a rest timer, supersets and circuits.',
      'Track a run, ride, yoga session or climb live, with a timer or a map.',
      'Invite players, go live and keep a leaderboard.',
      'Link a YouTube game or tournament and mark the highlights.',
    ]);
  });

  it('one info text open at a time: the same option closes, another takes its place', () => {
    expect(toggleInfo(null, 'sport')).toBe('sport');
    expect(toggleInfo('sport', 'sport')).toBeNull();
    expect(toggleInfo('sport', 'event')).toBe('event');
  });

  it('the rule file imports nothing; a pick is answered within a short beat', () => {
    expect(read('src/lib/create-options.ts')).not.toMatch(/^import /m);
    expect(CREATE_PICK_BEAT_MS).toBeGreaterThanOrEqual(100);
    expect(CREATE_PICK_BEAT_MS).toBeLessThanOrEqual(200);
  });

  it('the sheet: sibling buttons with the spec\'s names, a pick closes the info text, heights are fixed, the press is the option\'s own', () => {
    const sheet = read('src/components/CreateSheet.tsx');
    expect(sheet).toContain("'aria-label': o.title");
    expect(sheet).toContain("'aria-pressed': isSelected");
    expect(sheet).toContain('aria-label={`About ${o.title}`}');
    expect(sheet).toContain('aria-expanded={isOpen}');
    expect(sheet).toContain('aria-label="Close"');
    expect(sheet).toContain('setInfoOpen(toggleInfo(infoOpen, o.key))');
    expect(sheet).toMatch(/setSelected\(key\);\s+setInfoOpen\(null\);/);
    expect(sheet).toContain('if (selected !== null) return;');
    expect(sheet).toContain('h-[136px]');
    expect(sheet).toContain('h-[72px]');
    expect(sheet).toContain('w-11 h-11'); // every info button and the close button: 44 px
    expect(sheet).not.toMatch(/focus:|focus-visible:/);
    const css = read('src/app/globals.css');
    expect(css).toContain('.ea-create-opt[data-pressed] { transform: scale(0.97); }');
    expect(css).not.toContain('.ea-create-opt:active');
    const rule = css.slice(css.indexOf('.ea-create-opt {'), css.indexOf('.ea-create-layer {'));
    expect(rule).not.toMatch(/display:|\bwidth:|color-mix/);
  });
});
