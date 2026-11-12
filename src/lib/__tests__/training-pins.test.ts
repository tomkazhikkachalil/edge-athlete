import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPinned, MAX_PINS, parsePin, parsePins, pinKey, togglePin, type TrainingPin } from '../training/pins';

// The pinned showcase (Training redesign PR 7, Nov 11 2026).
const bench: TrainingPin = { kind: 'exercise', ref: 'bench_press', recordKind: 'heaviest' };
const benchEst: TrainingPin = { kind: 'exercise', ref: 'bench_press', recordKind: 'e1rm' };
const dash: TrainingPin = { kind: 'test', ref: '40_yard_dash' };

describe('a pin', () => {
  it('is an exercise\'s best of one kind, or a test\'s best — nothing else from untrusted JSON', () => {
    expect(parsePin({ kind: 'exercise', ref: 'bench_press', recordKind: 'heaviest', value: 999 })).toEqual(bench);
    expect(parsePin({ kind: 'test', ref: '40_yard_dash', recordKind: 'heaviest' })).toEqual(dash);
    for (const bad of [null, 'x', {}, { kind: 'exercise', ref: 'bench_press' }, { kind: 'exercise', ref: 'bench_press', recordKind: 'fastest' }, { kind: 'effort', ref: 'run_5k' }, { kind: 'test', ref: 'a b' }, { kind: 'test', ref: 'x,y' }, { kind: 'test', ref: '' }, { kind: 'test', ref: 'x'.repeat(81) }, { kind: 'test', ref: 7 }]) {
      expect(parsePin(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it('two kinds of one exercise are two pins; the same thing is one', () => {
    expect(pinKey(bench)).not.toBe(pinKey(benchEst));
    expect(pinKey(bench)).toBe(pinKey({ ...bench }));
    expect(pinKey(dash)).toBe('test:40_yard_dash');
  });
});

describe('the list', () => {
  const six: TrainingPin[] = (['heaviest', 'e1rm', 'reps', 'volume', 'duration'] as const).map(recordKind => ({ kind: 'exercise', ref: 'squat', recordKind }));
  six.push(dash);
  it('is at most six, each once, in the athlete\'s order — or it is refused whole', () => {
    expect(MAX_PINS).toBe(6);
    expect(parsePins([bench, dash, benchEst])).toEqual([bench, dash, benchEst]);
    expect(parsePins([])).toEqual([]);
    expect(parsePins(six)).toHaveLength(6);
    expect(parsePins([...six, bench])).toBeNull();
    expect(parsePins([bench, { ...bench }])).toBeNull();
    expect(parsePins([bench, { kind: 'nope' }])).toBeNull();
    expect(parsePins('bench')).toBeNull();
    expect(parsePins(undefined)).toBeNull();
  });
  it('a tap pins at the end or unpins; a seventh is refused and nothing is dropped to make room', () => {
    expect(togglePin([], bench)).toEqual({ pins: [bench] });
    expect(togglePin([bench, dash], bench)).toEqual({ pins: [dash] });
    expect(togglePin([bench], dash)).toEqual({ pins: [bench, dash] });
    expect(togglePin(six, bench)).toEqual({ full: true });
    expect(togglePin(six, dash)).toEqual({ pins: six.slice(0, 5) }); // unpinning is always allowed
    expect(isPinned([bench, dash], { kind: 'test', ref: '40_yard_dash' })).toBe(true);
    expect(isPinned([bench], benchEst)).toBe(false);
  });
});

describe('the routes and the writer hold the rules', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
  it('the rules import nothing', () => {
    expect(src('lib/training/pins.ts')).not.toMatch(/^import /m);
  });
  it('reading: the gate, then the records aspect, before the pins are read; private, no-store; the raw list is the athlete\'s alone', () => {
    const route = src('app/api/profile/[profileId]/training/pins/route.ts');
    const order = ['resolveActivityAccess(', "'records', isOwner)", 'readPins(', 'resolvePins('].map(m => route.indexOf(m));
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(route).toContain('resolvePins(admin, profileId, pins, { visitor: !isOwner })');
    expect(route).toContain('user?.id === profileId ? { mine: pins } : {}');
    const answers = route.match(/NextResponse\.json\(/g)?.length ?? 0;
    expect(route.match(/headers: NO_STORE/g)?.length).toBe(answers);
  });
  it('writing: the session\'s own profile, never one from the request; a list that is not exactly pins writes nothing', () => {
    const route = src('app/api/training/pins/route.ts');
    expect(route).toContain('const user = await requireAuth(request);');
    expect(route).toContain('writePins(admin, user.id, pins)');
    expect(route).not.toMatch(/profileId|profile_id/);
    expect(route.indexOf('parsePins(')).toBeLessThan(route.indexOf('writePins('));
    expect(route).toMatch(/if \(!pins\) return NextResponse\.json\([^)]*status: 400/);
  });
  it('a pin stores no value: the writer inserts what is pinned; a value is folded for the viewer', () => {
    const server = src('lib/training/pins-server.ts');
    expect(server).toContain("record_kind: p.kind === 'exercise' ? p.recordKind : null");
    expect(server).not.toMatch(/insert\([\s\S]{0,300}(value|display)/);
    expect(server).toContain('readBestsSources(admin, profileId, { visitor: opts.visitor })');
    // A test pin never resolves a lift row or a body measurement.
    expect(server).toContain(".neq('metric_category', 'strength').neq('metric_category', 'body')");
    const migration = readFileSync(join(process.cwd(), 'database/migrations/306_training_exercise_ref_pins.sql'), 'utf8');
    expect(migration).toContain('CHECK (position BETWEEN 1 AND 6)');
  });
  it('nothing pinned renders nothing, for the owner too; the toggle is the athlete\'s own', () => {
    expect(src('components/training/PinnedBests.tsx')).toContain('if (pins.length === 0) return null;');
    const tab = src('components/TrainingTab.tsx');
    expect(tab).toContain('const isSelf = !!currentUserId && currentUserId === profileId;');
    expect(tab).toContain('useTrainingPins(profileId, isSelf)');
    expect(tab).toContain('pins={isSelf ? pins.mine : undefined}');
  });
});
