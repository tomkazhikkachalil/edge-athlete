import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ATTACH_COLUMN, activityAttachable, activityPlate, attachRefOf, attachRowLabel, clockOf, holeTone, parseAttachRef, readingFor,
  roundAttachable, roundPlate, sortAttachable, statLineAttachable, statLinePlate, toParWords, trimNumber, workoutAttachable, workoutPlate,
} from '@/lib/posts/attachment';
import { locationOf, parsePostLocation } from '@/lib/posts/location';
import { scoreName } from '@/lib/golf/score-card';

const ID = '11111111-2222-4333-8444-555555555555';
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('the reference a post holds (321)', () => {
  it('a request names a kind and a uuid, or nothing', () => {
    expect(parseAttachRef(undefined)).toBeNull();
    expect(parseAttachRef(null)).toBeNull();
    expect(parseAttachRef({ kind: 'round', id: ID })).toEqual({ kind: 'round', id: ID });
    expect(parseAttachRef({ kind: 'round', id: 'nope' })).toBe('invalid');
    expect(parseAttachRef({ kind: 'post', id: ID })).toBe('invalid');
    expect(parseAttachRef('round')).toBe('invalid');
  });
  it('each kind has its own column; a row reads back as one reference', () => {
    expect(ATTACH_COLUMN).toEqual({ round: 'attached_round_id', workout: 'attached_workout_id', activity: 'attached_activity_id', stat_line: 'attached_post_id' });
    expect(attachRefOf({ attached_workout_id: ID })).toEqual({ kind: 'workout', id: ID });
    expect(attachRefOf({ round_id: ID })).toBeNull(); // round_id is the round's OWN card, never an attachment
    expect(attachRefOf({})).toBeNull();
  });
});

describe('what may be attached (Tom, Nov 26 2026: all but hidden and Only me)', () => {
  it('a round: finished, scored, not hidden from the profile', () => {
    expect(roundAttachable({ is_complete: true, gross_score: 78, profile_hidden_at: null })).toBe(true);
    expect(roundAttachable({ is_complete: false, gross_score: 78, profile_hidden_at: null })).toBe(false);
    expect(roundAttachable({ is_complete: true, gross_score: null, profile_hidden_at: null })).toBe(false);
    expect(roundAttachable({ is_complete: true, gross_score: 78, profile_hidden_at: '2026-11-01' })).toBe(false);
  });
  it('a workout: finished, not hidden — shared or not', () => {
    expect(workoutAttachable({ status: 'completed', profile_hidden_at: null })).toBe(true);
    expect(workoutAttachable({ status: 'active', profile_hidden_at: null })).toBe(false);
    expect(workoutAttachable({ status: 'completed', profile_hidden_at: '2026-11-01' })).toBe(false);
  });
  it('an activity: not Only me; a stat line: its published post', () => {
    expect(activityAttachable({ only_me: false })).toBe(true);
    expect(activityAttachable({ only_me: true })).toBe(false);
    expect(statLineAttachable({ status: 'published', stats_type: 'stat_line' })).toBe(true);
    expect(statLineAttachable({ status: 'draft', stats_type: 'stat_line' })).toBe(false);
    expect(statLineAttachable({ status: 'hidden', stats_type: 'stat_line' })).toBe(false);
    expect(statLineAttachable({ status: 'published', stats_type: 'workout_session' })).toBe(false);
  });
});

describe('numbers as words', () => {
  it('trims, clocks and reads to par', () => {
    expect(trimNumber(140)).toBe('140');
    expect(trimNumber(62.5)).toBe('62.5');
    expect(clockOf(2892)).toBe('48:12');
    expect(clockOf(3723)).toBe('1:02:03');
    expect(toParWords(78, 72)).toBe('+6');
    expect(toParWords(72, 72)).toBe('E');
    expect(toParWords(70, 72)).toBe('-2');
  });
  it('a hole\'s block follows the live round\'s scale', () => {
    expect(holeTone(2, 4)).toBe('great');
    expect(holeTone(3, 4)).toBe('good');
    expect(holeTone(4, 4)).toBe('good');
    expect(holeTone(5, 4)).toBe('text');
    expect(holeTone(6, 4)).toBe('warn');
    expect(holeTone(7, 4)).toBe('bad');
    expect(holeTone(null, 4)).toBe('none');
    expect(holeTone(4, null)).toBe('none');
    // The same answer as the scoring card's own rule, for every score on a par 3, 4 and 5.
    for (const par of [3, 4, 5]) for (let strokes = 1; strokes <= par + 5; strokes += 1) expect(holeTone(strokes, par), `${strokes} on a par ${par}`).toBe(scoreName(strokes, par).tone);
  });
});

describe('the plates', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, strokes: i < 6 ? 5 : 4 }));
  it('golf: the total score, to par and the holes; a block per hole when the card was kept', () => {
    const plate = roundPlate({ id: ID, date: '2026-11-20', course: 'Loch March', holes: 18, par: 72, gross_score: 78 }, holes);
    expect(plate).toMatchObject({ kind: 'round', sport: 'Golf', name: 'Loch March', headline: '78', unit: null, detail: '+6 · 18 holes', tone: 'golf' });
    expect(plate.holes).toHaveLength(18);
    expect(plate.holes?.slice(0, 7)).toEqual(['text', 'text', 'text', 'text', 'text', 'text', 'good']);
  });
  it('golf: a quick-entry round has no strip; nine holes never borrow the round\'s default par', () => {
    const quick = roundPlate({ id: ID, date: null, course: 'Loch March', holes: 18, par: 72, gross_score: 80 });
    expect(quick.holes).toBeUndefined();
    expect(quick.detail).toBe('+8 · 18 holes');
    const nine = roundPlate({ id: ID, date: null, course: 'The Marshes', holes: 9, par: 72, gross_score: 41 });
    expect(nine.detail).toBe('9 holes');
    const nineCard = roundPlate({ id: ID, date: null, course: 'The Marshes', holes: 9, par: 72, gross_score: 41 }, holes.slice(0, 9));
    expect(nineCard.holes).toHaveLength(9);
    expect(nineCard.detail).toBe('+6 · 9 holes');
  });
  it('strength: the heaviest set in the unit it was logged in, its exercise as the name', () => {
    const plate = workoutPlate({ id: ID, title: 'Leg day', started_at: '2026-11-21T10:00:00Z', duration_seconds: 3600 }, [
      { exercise: 'Back squat', weight: 140, weight_unit: 'kg', reps: 5 },
      { exercise: 'Leg press', weight: 300, weight_unit: 'lb', reps: 8 },
      { exercise: 'Plank', weight: null, weight_unit: null, reps: null },
    ]);
    expect(plate).toMatchObject({ kind: 'workout', sport: 'Strength', name: 'Back squat', headline: '140', unit: 'kg', detail: '5 reps · 3 sets', tone: 'strength' });
  });
  it('strength without weights reads its sets, then its time', () => {
    expect(workoutPlate({ id: ID, title: 'Core', started_at: null, duration_seconds: 725 }, [{ exercise: 'Plank', weight: null, weight_unit: null, reps: null }])).toMatchObject({ name: 'Core', headline: '1', unit: 'set', detail: '12:05' });
    expect(workoutPlate({ id: ID, title: null, started_at: null, duration_seconds: 725 }, [])).toMatchObject({ name: 'Workout', headline: '12:05', unit: null });
  });
  it('a run: the distance, the time and the pace — in miles for a viewer who chose them', () => {
    const plate = activityPlate({ id: ID, name: 'Morning run', label: 'Run', started_at: '2026-11-22T07:00:00Z', distance_m: 10200, moving_s: 2892, elapsed_s: 3000, paceStyle: 'pace' });
    expect(plate).toMatchObject({ kind: 'activity', sport: 'Run', name: 'Morning run', headline: '10.2', unit: 'km', detail: '48:12 · 4:44 /km', tone: 'run' });
    expect(readingFor(plate, 'mi')).toEqual({ headline: '6.3', unit: 'mi', detail: '48:12 · 7:36 /mi' });
    expect(readingFor(plate, 'km').unit).toBe('km');
  });
  it('an activity without a distance reads its time; a ride reads a speed', () => {
    expect(activityPlate({ id: ID, name: 'Yoga', label: 'Yoga', started_at: null, distance_m: null, moving_s: null, elapsed_s: 1800, paceStyle: 'pace' })).toMatchObject({ headline: '30:00', unit: null, detail: null });
    expect(activityPlate({ id: ID, name: 'Ride', label: 'Ride', started_at: null, distance_m: 30000, moving_s: 3600, elapsed_s: 3600, paceStyle: 'speed' }).detail).toBe('1:00:00 · 30.0 km/h');
  });
  it('a stat line: the sport\'s hero number; nothing to headline is not offered', () => {
    expect(statLinePlate({ id: ID, sport: 'Ice Hockey', colour: '#0EA5E9', date: '2026-11-19', opponent: 'Ottawa 67s', heroLabel: 'Points', heroValue: 3, line: '2 G • 1 A' }))
      .toMatchObject({ kind: 'stat_line', sport: 'Ice Hockey', name: 'Ice Hockey · Ottawa 67s', headline: '3', unit: 'points', detail: '2 G • 1 A', tone: 'sport', colour: '#0EA5E9' });
    expect(statLinePlate({ id: ID, sport: 'Soccer', colour: null, date: null, opponent: null, heroLabel: 'Points', heroValue: null, line: null })).toBeNull();
  });
  it('the picker lists newest first; the row names the sport once', () => {
    const a = roundPlate({ id: ID, date: '2026-11-01', course: 'A', holes: 18, par: 72, gross_score: 80 });
    const b = workoutPlate({ id: ID, title: 'B', started_at: '2026-11-20T10:00:00Z', duration_seconds: 60 }, []);
    expect(sortAttachable([a, b]).map(p => p.kind)).toEqual(['workout', 'round']);
    expect(attachRowLabel({ sport: 'Golf', name: 'Loch March' })).toBe('Golf · Loch March');
    expect(attachRowLabel({ sport: 'Ice Hockey', name: 'Ice Hockey · Ottawa 67s' })).toBe('Ice Hockey · Ottawa 67s');
    expect(attachRowLabel({ sport: 'Yoga', name: 'Yoga' })).toBe('Yoga');
  });
});

describe('a post\'s one location (321)', () => {
  it('a label of 1 to 120 characters, a place id when it was picked', () => {
    expect(parsePostLocation(undefined)).toBeNull();
    expect(parsePostLocation({ label: '   ' })).toBeNull();
    expect(parsePostLocation({ label: '  Ottawa,   ON ' })).toEqual({ label: 'Ottawa, ON', placeId: null });
    expect(parsePostLocation({ label: 'Ottawa, ON', placeId: ID })).toEqual({ label: 'Ottawa, ON', placeId: ID });
    expect(parsePostLocation({ label: 'x'.repeat(121) })).toBe('invalid');
    expect(parsePostLocation({ label: 'Ottawa', placeId: 'nope' })).toBe('invalid');
    expect(parsePostLocation('Ottawa')).toBe('invalid');
    expect(locationOf({ location_label: 'Ottawa, ON' })).toBe('Ottawa, ON');
    expect(locationOf({ location_label: null })).toBeNull();
  });
});

describe('the wiring', () => {
  const route = read('src/app/api/posts/route.ts');
  const server = read('src/lib/posts/attachment-server.ts');
  it('the write checks the reference against the AUTHOR; a repost cannot attach', () => {
    expect(route).toContain('const checked = await checkAttachment(supabase, attachRef, userId);');
    expect(route).toContain("'A repost cannot attach an activity'");
    expect(route).toContain('...(attachRef ? { [ATTACH_COLUMN[attachRef.kind]]: attachRef.id } : {}),');
  });
  it('all three reads carry the plate and the location', () => {
    expect(route.match(/attached_plate:/g)).toHaveLength(3);
    expect(route.match(/location: locationOf\(/g)).toHaveLength(3);
    expect(route).toContain('const attachedPlatesPromise = platesFor(supabase, finalVisiblePosts);');
  });
  it('a plate is built only for the post\'s own author, from a source that may still be attached', () => {
    expect(server).toContain('if (found && found.ownerId === ownerId) out.set(postId, found.plate);');
    expect(server).toContain('if (!roundAttachable(row)) return null;');
    expect(server).toContain('if (!workoutAttachable(row)) return null;');
    expect(server).toContain('if (!activityAttachable(row)) return null;');
  });
  it('the picker\'s list is private and never cached; round_id is never the attachment', () => {
    expect(read('src/app/api/posts/attachable/route.ts')).toContain("'Cache-Control': 'private, no-store'");
    expect(route).not.toMatch(/attachRef[^\n]*round_id:/);
  });
  it('migration 321: six columns, one attachment per post, an index per foreign key, the ledger line', () => {
    const sql = read('database/migrations/321_post_attachment_location.sql').replace(/--[^\n]*/g, '');
    for (const col of ['attached_round_id', 'attached_workout_id', 'attached_activity_id', 'attached_post_id', 'location_place_id']) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col} uuid`);
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS idx_posts_${col} ON public.posts USING btree (${col})`);
    }
    expect(sql).toContain('CHECK (num_nonnulls(attached_round_id, attached_workout_id, attached_activity_id, attached_post_id) <= 1)');
    expect(sql.match(/ON DELETE SET NULL/g)).toHaveLength(5);
    expect(sql).not.toMatch(/RAISE EXCEPTION/);
    expect(sql).toContain("INSERT INTO public.schema_migrations (number, name) VALUES (321, '321_post_attachment_location.sql') ON CONFLICT (number) DO NOTHING;");
  });
});
