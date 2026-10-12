import { describe, it, expect } from 'vitest';
import {
  validateEntriesPayload,
  MAX_EXERCISES,
  MAX_SETS_PER_EXERCISE,
  type EntryExercise,
} from '../workouts/entries';

const validSet = (n = 1) => ({
  setNumber: n,
  reps: 5,
  weight: 185,
  weightUnit: 'lbs',
  durationSeconds: null,
  distance: null,
  distanceUnit: null,
  completedAt: '2026-07-26T12:00:00.000Z',
});

const validExercise = (name = 'Bench Press'): Record<string, unknown> => ({
  name,
  exerciseKey: 'bench_press',
  category: 'strength',
  notes: null,
  sets: [validSet(1), validSet(2)],
});

describe('validateEntriesPayload', () => {
  it('accepts a valid payload and normalizes it', () => {
    const result = validateEntriesPayload([validExercise()]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exercises).toHaveLength(1);
      expect(result.exercises[0].sets).toHaveLength(2);
      expect(result.exercises[0].name).toBe('Bench Press');
    }
  });

  it('accepts an empty exercise list and null-heavy sets', () => {
    expect(validateEntriesPayload([]).ok).toBe(true);
    const cardio = {
      ...validExercise('Run'),
      category: 'cardio',
      sets: [{ setNumber: 1, reps: null, weight: null, weightUnit: null, durationSeconds: 1800, distance: 3.1, distanceUnit: 'mi', completedAt: null }],
    };
    expect(validateEntriesPayload([cardio]).ok).toBe(true);
  });

  it('rejects non-array and malformed shapes', () => {
    expect(validateEntriesPayload('nope').ok).toBe(false);
    expect(validateEntriesPayload([null]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), sets: 'x' }]).ok).toBe(false);
  });

  it('enforces the exercise and set caps', () => {
    const tooManyExercises = Array.from({ length: MAX_EXERCISES + 1 }, () => validExercise());
    expect(validateEntriesPayload(tooManyExercises).ok).toBe(false);

    const tooManySets = {
      ...validExercise(),
      sets: Array.from({ length: MAX_SETS_PER_EXERCISE + 1 }, (_, i) => validSet(Math.min(i + 1, 99))),
    };
    expect(validateEntriesPayload([tooManySets]).ok).toBe(false);
  });

  it('rejects out-of-range numbers and bad enums', () => {
    expect(validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(), weight: -5 }] }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(), weight: 6000 }] }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(), reps: 2000 }] }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(), weightUnit: 'stone' }] }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), category: 'esports' }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(), setNumber: 0 }] }]).ok).toBe(false);
  });

  it('rejects oversize strings', () => {
    expect(validateEntriesPayload([{ ...validExercise('x'.repeat(81)) }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), notes: 'x'.repeat(501) }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(''), name: '' }]).ok).toBe(false);
  });

  it('produces typed EntryExercise output usable downstream', () => {
    const result = validateEntriesPayload([validExercise()]);
    if (result.ok) {
      const exercises: EntryExercise[] = result.exercises;
      expect(exercises[0].exerciseKey).toBe('bench_press');
    }
  });

  describe('set media', () => {
    const withMedia = (media: unknown) => [
      { ...validExercise(), sets: [{ ...validSet(), media }] },
    ];

    it('absent media normalizes to [] (pre-046 snapshots stay valid)', () => {
      const result = validateEntriesPayload([validExercise()]);
      expect(result.ok && result.exercises[0].sets[0].media).toEqual([]);
    });

    it('accepts valid https media up to the cap', () => {
      const media = [
        { url: 'https://x.supabase.co/storage/v1/clip.mp4', type: 'video' },
        { url: 'https://x.supabase.co/storage/v1/pic.jpg', type: 'image' },
      ];
      const result = validateEntriesPayload(withMedia(media));
      expect(result.ok && result.exercises[0].sets[0].media).toHaveLength(2);
    });

    it('rejects more than 4 items per set', () => {
      const media = Array.from({ length: 5 }, (_, i) => ({
        url: `https://x/clip${i}.mp4`,
        type: 'video',
      }));
      expect(validateEntriesPayload(withMedia(media)).ok).toBe(false);
    });

    it('rejects bad URLs and bad types', () => {
      expect(validateEntriesPayload(withMedia([{ url: 'javascript:alert(1)', type: 'image' }])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia([{ url: 'http://insecure/x.jpg', type: 'image' }])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia([{ url: 'https://x.supabase.co/y.gif', type: 'gif' }])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia([{ url: '', type: 'image' }])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia(['nope'])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia('nope')).ok).toBe(false);
    });

    it('only accepts first-party storage hosts (set media renders ungated in <video>/<a>)', () => {
      expect(validateEntriesPayload(withMedia([{ url: 'https://evil.example.com/track.gif', type: 'image' }])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia([{ url: 'https://notsupabase.co/x.jpg', type: 'image' }])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia([{ url: '//evil.example.com/x.jpg', type: 'image' }])).ok).toBe(false);
      expect(validateEntriesPayload(withMedia([{ url: '/uploads/local.jpg', type: 'image' }])).ok).toBe(true);
      expect(validateEntriesPayload(withMedia([{ url: 'https://abc.supabase.in/storage/v1/object/public/uploads/x.mp4', type: 'video' }])).ok).toBe(true);
    });
  });
});

describe('set media URLs — a media-proxy path is never the stored value (Oct 4 2026)', () => {
  it('refuses /api/media/… by name and keeps same-origin paths and storage URLs', async () => {
    const { isAllowedMediaUrl } = await import('../workouts/entries');
    expect(isAllowedMediaUrl('/api/media/abc.def')).toBe(false);
    expect(isAllowedMediaUrl('/api/media/o/abc.def')).toBe(false);
    expect(isAllowedMediaUrl('https://proj.supabase.co/storage/v1/object/public/uploads/posts/u/a.jpg')).toBe(true);
    expect(isAllowedMediaUrl('/uploads/x.jpg')).toBe(true);
    expect(isAllowedMediaUrl('//evil.example/x.jpg')).toBe(false);
  });

  it('healEntriesMedia rewrites proxied set-media URLs and leaves the rest of the payload untouched', async () => {
    process.env.MEDIA_PROXY_SECRET = 'test-secret-bbbbbbbbbbbbbbbbbbbbbbbb';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
    try {
      const { toProxyUrl } = await import('../media/proxy-url');
      const { healEntriesMedia, healSetMediaValue } = await import('../workouts/entries-heal-server');
      const stored = 'https://proj.supabase.co/storage/v1/object/public/uploads/posts/u/a.jpg';
      const proxied = toProxyUrl(stored, { type: 'workout', id: 'p' })!;
      const healed = healEntriesMedia([
        { name: 'Squat', exerciseKey: 'squat', category: 'strength', notes: null, sets: [{ setNumber: 1, media: [{ url: proxied, type: 'image' }, { url: stored, type: 'image' }] }] },
      ]) as Array<{ sets: Array<{ media: Array<{ url: string }> }> }>;
      expect(healed[0].sets[0].media.map(m => m.url)).toEqual([stored, stored]);
      expect(healSetMediaValue([{ url: proxied, type: 'image' }])).toEqual([{ url: stored, type: 'image' }]);
      // An unverifiable proxied path stays as it is — the validator refuses it.
      expect(healSetMediaValue([{ url: '/api/media/forged.x', type: 'image' }])).toEqual([{ url: '/api/media/forged.x', type: 'image' }]);
      expect(healSetMediaValue('not an array')).toBe('not an array');
    } finally {
      delete process.env.MEDIA_PROXY_SECRET;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    }
  });
});

// ── Workout screen program PR 1 (Oct 12 2026, migration 260) ────────────────
import { ensureClientIds, healGroups } from '../workouts/entries';
import { serverToEntries } from '../workouts/serialize';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';

describe('the stable exercise id (260)', () => {
  it('absent is minted (an old client, an old draft); present must be a uuid and unique', () => {
    const minted = validateEntriesPayload([validExercise()]);
    expect(minted.ok && /^[0-9a-f-]{36}$/.test(minted.exercises[0].clientId)).toBe(true);
    const kept = validateEntriesPayload([{ ...validExercise(), clientId: UUID_A }]);
    expect(kept.ok && kept.exercises[0].clientId).toBe(UUID_A);
    expect(validateEntriesPayload([{ ...validExercise(), clientId: 'not-a-uuid' }])).toMatchObject({ ok: false, error: expect.stringContaining('invalid exercise id') });
    expect(validateEntriesPayload([{ ...validExercise(), clientId: UUID_A }, { ...validExercise('Row'), clientId: UUID_A }])).toMatchObject({ ok: false, error: expect.stringContaining('duplicate exercise id') });
  });
  it('ensureClientIds mints only what is missing and returns the same array when nothing was', () => {
    let n = 0;
    const mint = () => `m-${++n}`;
    const full = [{ clientId: 'a', name: 'x' }];
    expect(ensureClientIds(full, mint)).toBe(full);
    const out = ensureClientIds([{ clientId: 'a', name: 'x' }, { name: 'y' }, { clientId: '', name: 'z' }], mint);
    expect(out.map(e => e.clientId)).toEqual(['a', 'm-1', 'm-2']);
  });
  it('serverToEntries carries client_id, the group fields and rest; a pre-260 row literal is minted an id', () => {
    const entries = serverToEntries({
      id: 's', profile_id: 'p', title: null, notes: null, status: 'active', source: 'live', started_at: '2026-10-12T08:00:00Z', ended_at: null, duration_seconds: null, post_id: null, last_activity_at: '2026-10-12T08:00:00Z', updated_at: '2026-10-12T08:00:00Z',
      exercises: [
        { name: 'Bench', exercise_key: 'bench_press', category: 'strength', position: 1, notes: null, client_id: UUID_A, group_id: GROUP, group_kind: 'superset', group_rounds: 3,
          sets: [{ set_number: 1, reps: 5, weight: 100, weight_unit: 'lbs', duration_seconds: null, distance: null, distance_unit: null, completed_at: null, rest_seconds: 90 }] },
        { name: 'Old row', exercise_key: null, category: 'other', position: 0, notes: null, sets: [] },
      ],
    });
    expect(entries[0].name).toBe('Old row');
    expect(entries[0].clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entries[1]).toMatchObject({ clientId: UUID_A, groupId: GROUP, groupKind: 'superset', groupRounds: 3 });
    expect(entries[1].sets[0].restSeconds).toBe(90);
  });
  it('a set\'s rest rides the payload (absent = null; out of range refused)', () => {
    const ok = validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(1), restSeconds: 75.4 }, validSet(2)] }]);
    expect(ok.ok && ok.exercises[0].sets.map(s => s.restSeconds)).toEqual([75, null]);
    expect(validateEntriesPayload([{ ...validExercise(), sets: [{ ...validSet(1), restSeconds: -1 }] }]).ok).toBe(false);
  });
});

describe('groups are HEALED, never refused (a 400 would wedge the autosave loop)', () => {
  const ex = (name: string, over: Partial<EntryExercise> = {}): EntryExercise => ({ clientId: `c-${name}`, name, exerciseKey: null, category: 'strength', notes: null, sets: [], ...over });
  it('a singleton group is ungrouped; an ungrouped exercise with stray kind/rounds is cleaned', () => {
    const out = healGroups([ex('A', { groupId: GROUP, groupKind: 'superset', groupRounds: 3 }), ex('B')]);
    expect(out[0]).toMatchObject({ groupId: null, groupKind: null, groupRounds: null });
    expect(healGroups([ex('A', { groupKind: 'circuit' })])[0].groupKind).toBeNull();
  });
  it('members become consecutive at the first member\'s place; the kind is the first\'s; rounds = max(declared, longest member) and every member is padded, never truncated', () => {
    const out = healGroups([
      ex('A', { groupId: GROUP, groupKind: 'superset', groupRounds: 2, sets: [validSet(1) as never, validSet(2) as never, validSet(3) as never] }),
      ex('X'),
      ex('B', { groupId: GROUP, groupKind: 'circuit', groupRounds: 1, sets: [validSet(1) as never] }),
    ]);
    expect(out.map(e => e.name)).toEqual(['A', 'B', 'X']);
    expect(out[0]).toMatchObject({ groupKind: 'superset', groupRounds: 3 });
    expect(out[1]).toMatchObject({ groupKind: 'superset', groupRounds: 3 });
    expect(out[0].sets).toHaveLength(3);
    expect(out[1].sets.map(s => s.setNumber)).toEqual([1, 2, 3]);
    expect(out[1].sets[2].reps).toBeNull();
  });
  it('rounds are capped at 10; a healthy group is the same array', () => {
    const healthy = [ex('A', { groupId: GROUP, groupKind: 'circuit', groupRounds: 2, sets: [validSet(1) as never, validSet(2) as never] }), ex('B', { groupId: GROUP, groupKind: 'circuit', groupRounds: 2, sets: [validSet(1) as never, validSet(2) as never] })];
    expect(healGroups(healthy)).toBe(healthy);
    const big = healGroups([ex('A', { groupId: GROUP, groupKind: 'circuit', groupRounds: 40 }), ex('B', { groupId: GROUP, groupKind: 'circuit', groupRounds: 40 })]);
    expect(big[0].groupRounds).toBe(10);
    expect(big[0].sets).toHaveLength(10);
  });
  it('the validator applies the healing and refuses only type errors', () => {
    const healed = validateEntriesPayload([{ ...validExercise('A'), clientId: UUID_A, groupId: GROUP, groupKind: 'superset', groupRounds: 2 }]);
    expect(healed.ok && healed.exercises[0].groupId).toBeNull();
    expect(validateEntriesPayload([{ ...validExercise(), groupKind: 'pyramid' }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), groupId: 'nope' }]).ok).toBe(false);
    expect(validateEntriesPayload([{ ...validExercise(), groupRounds: 11 }]).ok).toBe(false);
    const two = validateEntriesPayload([
      { ...validExercise('A'), clientId: UUID_A, groupId: GROUP, groupKind: 'circuit', groupRounds: 3, sets: [] },
      { ...validExercise('B'), clientId: UUID_B, groupId: GROUP, groupKind: 'circuit', groupRounds: 3, sets: [] },
    ]);
    expect(two.ok && two.exercises.map(e => e.sets.length)).toEqual([3, 3]);
  });
});
