import { describe, it, expect } from 'vitest';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_DEFS, indoorTwin, INDOOR_TWIN } from '../catalog';
import { detailFieldsFor, SHOWN_MAX } from '../details';
import { RECORD_LAYOUT_BY_TYPE, recordLayout } from '../record/layout';
import fs from 'node:fs';
import path from 'node:path';

// Program E (Oct 2026): ONE layout table, read by the set-up card, the live
// area and the Finish. These pins hold it to the catalog and the questions.

describe('the recorder layout table', () => {
  it('names every catalog type, with something recorded and a live area', () => {
    for (const t of ACTIVITY_TYPES) {
      const l = recordLayout(t);
      expect(l, t).toBeDefined();
      expect(l.records.length, t).toBeGreaterThan(0);
      expect(l.live.length, t).toBeGreaterThan(0);
      expect(l.records, t).toContain('time');
      // The elapsed clock lives in the 'stats' panel: every type shows it (Oct 20 2026 — the first
      // table left it off the rounds, calm and climb families and the clock vanished on production).
      expect(l.live, t).toContain('stats');
    }
    expect(Object.keys(RECORD_LAYOUT_BY_TYPE).sort()).toEqual([...ACTIVITY_TYPES].sort());
  });
  it('a type asks at most three of ITS OWN questions before Start — choices and yes/no only, never one behind More details', () => {
    for (const t of ACTIVITY_TYPES) {
      const fields = detailFieldsFor(t);
      const l = recordLayout(t);
      expect(l.setupFields.length, t).toBeLessThanOrEqual(SHOWN_MAX);
      for (const key of l.setupFields) {
        const f = fields.find(x => x.key === key);
        expect(f, `${t}.${key}`).toBeDefined();
        expect(['choice', 'multi', 'bool'], `${t}.${key}`).toContain(f!.kind);
        expect(f!.more, `${t}.${key}`).toBeFalsy();
        expect(f!.showIf, `${t}.${key}`).toBeUndefined();
      }
    }
  });
  it('a control appears only where it makes sense', () => {
    for (const t of ACTIVITY_TYPES) {
      const l = recordLayout(t);
      const rec = ACTIVITY_TYPE_DEFS[t].recording;
      if (l.setup.includes('map')) expect(rec, t).toBe('gps_optional');
      if (l.setup.includes('indoorTwin')) expect(indoorTwin(t), t).not.toBeNull();
      if (l.setup.includes('timer') || l.live.includes('timer')) expect(['duration', 'gps_optional'], t).toContain(rec);
      if (l.setup.includes('climbScale') || l.live.includes('climbs')) expect(t).toBe('climb');
      if (l.live.includes('lengths') || l.records.includes('lengths')) expect(t).toBe('swim');
      if (l.live.includes('map') || l.records.includes('map')) expect(['gps', 'gps_optional'], t).toContain(rec);
      if (l.calm) {
        expect(l.liveStats, t).toEqual([]);
        expect(l.mark, t).toBe(false); // F2: no segments on a calm session
      }
      if (l.mark === false) expect(l.calm, t).toBe(true);
      if (l.timerDefault) expect(l.setup, t).toContain('timer');
    }
    expect(INDOOR_TWIN).toEqual({ run: 'treadmill', ride: 'indoor_ride', open_water_swim: 'swim' });
  });
  it('the family defaults Tom named: hiit arms Tabata, martial arts Rounds, the calm four, the sport session asks its sport', () => {
    expect(recordLayout('hiit').timerDefault).toBe('tabata');
    expect(recordLayout('martial_arts').timerDefault).toBe('rounds');
    // F1 — the rounds family: the timer leads the live area (phase + remaining), the clock after it;
    // "other" offers a timer without preselecting one, and asks what it was.
    for (const t of ['hiit', 'martial_arts', 'other'] as const) {
      expect(recordLayout(t).live.slice(0, 2), t).toEqual(['timer', 'stats']);
      expect(recordLayout(t).setup, t).toContain('timer');
    }
    expect(recordLayout('other').timerDefault).toBeNull();
    expect(detailFieldsFor('other').map(f => f.key)).toEqual(['what']);
    expect(recordLayout('martial_arts').setupFields).toEqual(['discipline', 'session']);
    // F3 — climb: the scale is set up before Start; the log leads the live area.
    expect(recordLayout('climb').setup).toContain('climbScale');
    expect(recordLayout('climb').live[0]).toBe('climbs');
    for (const t of ['yoga', 'pilates', 'stretch', 'dance'] as const) expect(recordLayout(t).calm, t).toBe(true);
    expect(recordLayout('sport_session').setupFields).toEqual(['sport', 'session_kind']);
    expect(recordLayout('swim').setupFields).toEqual(['pool', 'stroke']);
  });
  it('the table itself imports only types (it ships in the engine chunk)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/activities/record/layout.ts'), 'utf8');
    const imports = src.match(/^import .*$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^import type /);
  });
});
