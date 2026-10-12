import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { addRound, addToGroup, currentRound, deleteRound, groupLine, groupsOf, makeGroup, removeFromGroup, removeGroup, renderItems, roundsCompleted, setRounds, ungroup } from '../workouts/groups';
import { emptyEntrySet, healGroups, validateEntriesPayload, type EntryExercise, type EntrySet } from '../workouts/entries';

// Workout screen PR 3 (Oct 12 2026): supersets and circuits — grouped
// exercises done for rounds, each keeping its own reps and weight per round.

const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const set = (n: number, reps: number | null = 5): EntrySet => ({ ...emptyEntrySet(n), reps, weight: reps === null ? null : 100, weightUnit: reps === null ? null : 'lbs' });
// uuid-shaped client ids (the validator requires a uuid), deterministic per name.
const idFor = (name: string) => `${name.toLowerCase().charCodeAt(0).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const ex = (name: string, sets: EntrySet[] = [], over: Partial<EntryExercise> = {}): EntryExercise => ({ clientId: idFor(name), name, exerciseKey: null, category: 'strength', notes: null, sets, ...over });
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('makeGroup', () => {
  it('stamps every member, gives each `rounds` sets (existing sets kept, rounds grown to the longest), and takes the first existing member\'s place', () => {
    const a = ex('A', [set(1), set(2), set(3), set(4)]);
    const b = ex('B');
    const x = ex('X');
    const out = makeGroup([x, a, ex('Y')], 'superset', [a, b], G, 3);
    expect(out.map(e => e.name)).toEqual(['X', 'A', 'B', 'Y']);
    expect(out[1]).toMatchObject({ groupId: G, groupKind: 'superset', groupRounds: 4 });
    expect(out[1].sets).toHaveLength(4);
    expect(out[2].sets.map(s => s.setNumber)).toEqual([1, 2, 3, 4]);
    expect(out[2].sets[0].reps).toBeNull();
    // Nothing existing: the group goes at the end; one member is no group.
    expect(makeGroup([x], 'circuit', [ex('P'), ex('Q')], G).map(e => e.name)).toEqual(['X', 'P', 'Q']);
    expect(makeGroup([x], 'circuit', [ex('P')], G)).toEqual([x]);
    // The validator finds nothing to heal.
    expect(healGroups(out)).toBe(out);
  });
});

describe('groupsOf / renderItems', () => {
  it('finds consecutive members and renders singles and groups in order', () => {
    const list = makeGroup([ex('X'), ex('A'), ex('B'), ex('Y')], 'circuit', [ex('A'), ex('B')], G, 2);
    const groups = groupsOf(list);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ groupId: G, kind: 'circuit', rounds: 2, start: 1 });
    expect(renderItems(list).map(i => (i.type === 'single' ? i.exercise.name : `group:${i.group.members.map(m => m.name).join('+')}`))).toEqual(['X', 'group:A+B', 'Y']);
  });
});

describe('membership', () => {
  const list = makeGroup([ex('X'), ex('A'), ex('B'), ex('Y')], 'circuit', [ex('A'), ex('B')], G, 2);
  it('addToGroup appends after the last member, grows the rounds to its sets and pads the others', () => {
    const out = addToGroup(list, G, ex('C', [set(1), set(2), set(3)]));
    expect(out.map(e => e.name)).toEqual(['X', 'A', 'B', 'C', 'Y']);
    expect(out.slice(1, 4).every(e => e.groupRounds === 3 && e.sets.length === 3)).toBe(true);
  });
  it('removeFromGroup keeps the exercise and its sets; a group left with one member dissolves', () => {
    const three = addToGroup(list, G, ex('C'));
    const two = removeFromGroup(three, idFor('C'));
    expect(two.find(e => e.name === 'C')).toMatchObject({ groupId: null, groupKind: null, groupRounds: null });
    expect(two.filter(e => e.groupId === G)).toHaveLength(2);
    const none = removeFromGroup(list, idFor('A'));
    expect(none.every(e => !e.groupId)).toBe(true);
    expect(none.find(e => e.name === 'A')!.sets).toHaveLength(2);
  });
  it('ungroup keeps every set; removeGroup drops the members', () => {
    expect(ungroup(list, G).every(e => !e.groupId)).toBe(true);
    expect(ungroup(list, G).find(e => e.name === 'B')!.sets).toHaveLength(2);
    expect(removeGroup(list, G).map(e => e.name)).toEqual(['X', 'Y']);
  });
});

describe('rounds', () => {
  const list = makeGroup([ex('A', [set(1), set(2)]), ex('B', [set(1), set(2)])], 'superset', [ex('A', [set(1), set(2)]), ex('B', [set(1), set(2)])], G, 2);
  it('setRounds adds empty rounds to every member and trims trailing EMPTY ones; a round with data is kept and the count grows back', () => {
    const up = setRounds(list, G, 4);
    expect(up.rounds).toBe(4);
    expect(up.exercises.every(e => e.sets.length === 4 && e.groupRounds === 4)).toBe(true);
    const down = setRounds(up.exercises, G, 1);
    expect(down.rounds).toBe(2);
    expect(down.exercises.every(e => e.sets.length === 2)).toBe(true);
    const cleared = setRounds(list.map(e => ({ ...e, sets: [e.sets[0], { ...e.sets[1], reps: null, weight: null, weightUnit: null }] })), G, 1);
    expect(cleared.rounds).toBe(1);
    expect(setRounds(list, G, 99).rounds).toBe(10);
    expect(setRounds(list, G2, 3)).toEqual({ exercises: list, rounds: 0 });
  });
  it('addRound clones the previous round\'s reps and weight on every member, never media or completion; deleteRound takes the round from every member and renumbers', () => {
    const withMedia = list.map(e => ({ ...e, sets: [e.sets[0], { ...e.sets[1], completedAt: '2026-10-12T08:00:00Z', media: [{ url: 'https://x.supabase.co/a.jpg', type: 'image' as const }] }] }));
    const more = addRound(withMedia, G);
    expect(more.every(e => e.groupRounds === 3 && e.sets.length === 3)).toBe(true);
    expect(more[0].sets[2]).toMatchObject({ setNumber: 3, reps: 5, weight: 100, completedAt: null, media: [], restSeconds: null });
    const fewer = deleteRound(more, G, 0);
    expect(fewer.every(e => e.groupRounds === 2 && e.sets.map(s => s.setNumber).join() === '1,2')).toBe(true);
    expect(fewer[0].sets[0].media).toHaveLength(1);
    const one = deleteRound(deleteRound(fewer, G, 0), G, 0);
    expect(one.every(e => e.groupRounds === 1 && e.sets.length === 1)).toBe(true);
    const capped = Array.from({ length: 9 }).reduce<EntryExercise[]>(acc => addRound(acc, G), list);
    expect(capped[0].groupRounds).toBe(10);
    expect(addRound(capped, G)).toEqual(capped);
  });
  it('roundsCompleted counts rounds where EVERY member has data; currentRound is the first not complete', () => {
    const g = groupsOf(list)[0];
    expect(roundsCompleted(g)).toBe(2);
    expect(currentRound(g)).toBe(2);
    const half = groupsOf(list.map(e => (e.name === 'B' ? { ...e, sets: [e.sets[0], set(2, null)] } : e)))[0];
    expect(roundsCompleted(half)).toBe(1);
    expect(currentRound(half)).toBe(2);
    const fresh = groupsOf(makeGroup([], 'circuit', [ex('P'), ex('Q')], G, 3))[0];
    expect(roundsCompleted(fresh)).toBe(0);
    expect(currentRound(fresh)).toBe(1);
  });
  it('every shape the editor produces passes the validator without healing', () => {
    const shapes = [list, setRounds(list, G, 4).exercises, addRound(list, G), deleteRound(list, G, 1), addToGroup(list, G, ex('C', [set(1), set(2), set(3)])), removeFromGroup(list, idFor('A'))];
    for (const shape of shapes) {
      const r = validateEntriesPayload(shape);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.exercises.map(e => [e.groupId, e.groupRounds, e.sets.length])).toEqual(shape.map(e => [e.groupId ?? null, e.groupRounds ?? null, e.sets.length]));
    }
  });
  it('the one spelling of a group line', () => {
    expect(groupLine('superset', 3)).toBe('Superset · 3 rounds');
    expect(groupLine('circuit', 1)).toBe('Circuit · 1 round');
  });
});

describe('the screen', () => {
  it('renders singles and groups through renderItems, offers Add superset / Add circuit, and the group card drives every edit through groups.ts', () => {
    const editor = read('src/components/workouts/WorkoutEditorScreen.tsx');
    expect(editor).toMatch(/renderItems\(exercises\)\.map/);
    expect(editor).toMatch(/data-workout-add-group="superset"/);
    expect(editor).toMatch(/data-workout-add-group="circuit"/);
    for (const fn of ['addRound', 'addToGroup', 'deleteRound', 'makeGroup', 'removeFromGroup', 'removeGroup', 'setRounds', 'ungroup']) expect(editor, fn).toMatch(new RegExp(`\\b${fn}\\(`));
    const card = read('src/components/workouts/ExerciseCard.tsx');
    expect(card).toMatch(/grouped\.onDeleteRound\(index\)/);
    expect(card).toMatch(/roundLabel \? `R\$\{set\.setNumber\}` : set\.setNumber/);
    const group = read('src/components/workouts/ExerciseGroupCard.tsx');
    expect(group).toMatch(/data-group-round=\{current\}/);
    expect(group).toMatch(/data-group-add-round=""/);
    for (const f of ['src/components/workouts/WorkoutPostCard.tsx', 'src/components/workouts/WorkoutCard.tsx']) expect(read(f), f).toMatch(/groupLine\(exercise\.groupKind/);
  });
});
