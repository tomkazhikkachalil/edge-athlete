import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ABANDON_AFTER_MS as ROUND_ABANDON_MS } from '../golf/round-status';
import { ABANDON_AFTER_MS as WORKOUT_ABANDON_MS } from '../workouts/status';
import { RECORDING_TTL_MS, IDLE_SETUP_TTL_MS, isExpired } from '../activities/record/storage';
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

describe('an idle set-up is a page, not a session (Program E, Oct 2026)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  it('lives a day, a recording a week; a meta without a status keeps the week', () => {
    expect(IDLE_SETUP_TTL_MS).toBe(DAY);
    expect(isExpired({ savedAt: 0, status: 'idle' }, DAY + 1)).toBe(true);
    expect(isExpired({ savedAt: 0, status: 'idle' }, DAY - 1)).toBe(false);
    expect(isExpired({ savedAt: 0, status: 'paused' }, DAY + 1)).toBe(false);
    expect(isExpired({ savedAt: 0, status: 'paused' }, SEVEN_DAYS + 1)).toBe(true);
    expect(isExpired({ savedAt: 0 }, DAY + 1)).toBe(false);
  });
  it('the pill, the reopen prompt and Drafts never list it; the store restores it; the new screens obey the import ban', () => {
    const root = process.cwd();
    expect(fs.readFileSync(path.join(root, 'src/lib/drafts/recording-like.ts'), 'utf8')).toMatch(/if \(!state \|\| state\.status === 'idle'\) return null;/);
    const storage = fs.readFileSync(path.join(root, 'src/lib/activities/record/storage.ts'), 'utf8');
    expect(storage).not.toMatch(/m\.status !== 'idle'/);
    for (const f of ['src/components/activities/record/SetupCard.tsx', 'src/components/activities/record/DetailsSheet.tsx']) {
      const p = path.join(root, f);
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, 'utf8'), f).not.toMatch(/purgeExpired|openRecordingStore|useWatchPosition|useWakeLock|useDirtyClose/);
    }
  });
});
