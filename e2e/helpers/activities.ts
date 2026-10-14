import { randomUUID } from 'node:crypto';
import { toWire, type WireActivity } from '../../src/lib/activities/wire';
import type { ActivityType } from '../../src/lib/activities/catalog';
import type { ActivitySegment } from '../../src/lib/activities/segments';
import { line } from '../../src/lib/activities/__tests__/fixtures';

/**
 * ONE live wire for every spec that seeds an activity (Oct 13 2026, when the
 * file import left and `POST /api/activities` became the recorder's door
 * only): a straight-line walk of `n` fixes, `stepM` metres every `stepS`
 * seconds from `t0`, named by its own `recordingId` (a fresh uuid unless the
 * spec wants to retry the SAME recording), with the segments it marked.
 */
export interface LiveWireOpts {
  t0?: number;
  n?: number;
  stepM?: number;
  stepS?: number;
  hr?: number;
  climbPerStep?: number;
  name?: string | null;
  type?: ActivityType;
  recordingId?: string;
  segments?: ActivitySegment[];
  tz?: string | null;
}

export function liveWire(opts: LiveWireOpts = {}): WireActivity {
  const { t0, n = 600, stepM = 1.4, stepS = 1, hr, climbPerStep, name = null, type = 'walk', recordingId = randomUUID(), segments, tz = 'America/Toronto' } = opts;
  const w = toWire({ format: 'live', type, name, points: line(n, { t0, stepM, stepS, hr, climbPerStep }), device: {}, tzOffsetMin: null }, tz);
  return { ...w, recordingId, ...(segments ? { segments } : {}) };
}
