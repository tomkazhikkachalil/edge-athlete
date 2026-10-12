import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ABANDON_AFTER_MS as ROUND_ABANDON_MS } from '../golf/round-status';
import { ABANDON_AFTER_MS as WORKOUT_ABANDON_MS } from '../workouts/status';
import { RECORDING_TTL_MS } from '../activities/record/storage';
import { DRAFT_TTL_MS } from '../workouts/draft';
import { STASH_TTL_MS } from '../workouts/media-stash';

// Resume pill program (Oct 12 2026): an unfinished session is kept for 7
// days from when it was last active — on the server (the round and workout
// sweeps) and on the device (the recording, the workout draft, the clip
// stash) alike. One number, pinned equal everywhere it is spelled.

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

describe('the 7-day retention is one number', () => {
  it('the sweeps, the device recording and the workout draft agree', () => {
    expect(ROUND_ABANDON_MS).toBe(SEVEN_DAYS);
    expect(WORKOUT_ABANDON_MS).toBe(SEVEN_DAYS);
    expect(RECORDING_TTL_MS).toBe(SEVEN_DAYS);
    expect(DRAFT_TTL_MS).toBe(SEVEN_DAYS);
    expect(STASH_TTL_MS).toBe(SEVEN_DAYS);
  });
  it('the root engine is the one that purges the device store at boot (the recorder page no longer does)', () => {
    const root = process.cwd();
    const provider = fs.readFileSync(path.join(root, 'src/components/activities/record/RecordingProvider.tsx'), 'utf8');
    expect(provider).toMatch(/purgeExpired\(Date\.now\(\)\)/);
    const screen = fs.readFileSync(path.join(root, 'src/components/activities/record/RecordActivityScreen.tsx'), 'utf8');
    expect(screen).not.toMatch(/purgeExpired|openRecordingStore|useWatchPosition|useWakeLock|useDirtyClose/);
  });
});
