/**
 * Training privacy: a public profile can elect to hide the whole Training
 * section, or individual aspects of it (migration 122,
 * profiles.vitals_privacy JSONB). true = private; a NULL/absent column is
 * today's behavior — everything follows profile visibility.
 *
 * Reads are TOLERANT (unknown keys ignored, malformed input → all-visible
 * defaults) so a bad row can never lock an athlete out of their own data
 * or crash a viewer. Writes go through parseTrainingPrivacy in the PATCH
 * route, so stored JSON is always in-contract. Enforcement is app-layer in
 * the body-metrics / workouts / media-count routes — those reads use the admin
 * client, so RLS cannot carry this (the app norm).
 */

import { z } from 'zod';

export interface TrainingPrivacy {
  /** Whole Training section hidden from non-owners. */
  hidden: boolean;
  /** Body-category entries + current height/weight. */
  body: boolean;
  /** Performance records: speed/strength/conditioning entries (PBs, metrics). */
  records: boolean;
  /** Workout sessions: log, weekly activity, training numbers. */
  workouts: boolean;
}

export type TrainingAspect = 'body' | 'records' | 'workouts';

export const DEFAULT_TRAINING_PRIVACY: TrainingPrivacy = {
  hidden: false,
  body: false,
  records: false,
  workouts: false,
};

const trainingPrivacySchema = z.object({
  hidden: z.boolean().optional(),
  body: z.boolean().optional(),
  records: z.boolean().optional(),
  workouts: z.boolean().optional(),
});

/** Tolerant parse: null/undefined/malformed → all visible; unknown keys dropped. */
export function parseTrainingPrivacy(raw: unknown): TrainingPrivacy {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_TRAINING_PRIVACY };
  }
  const result = trainingPrivacySchema.safeParse(raw);
  if (!result.success) return { ...DEFAULT_TRAINING_PRIVACY };
  return { ...DEFAULT_TRAINING_PRIVACY, ...result.data };
}

/** Owners always see everything; the master switch covers every aspect. */
export function aspectHidden(
  privacy: TrainingPrivacy,
  aspect: TrainingAspect,
  isOwner: boolean
): boolean {
  if (isOwner) return false;
  return privacy.hidden || privacy[aspect];
}

/**
 * Row filter for athlete_vitals payloads: the body category is the "body"
 * aspect; every other category is a performance record.
 */
export function filterTrainingRows<T extends { metric_category: string }>(
  rows: T[],
  privacy: TrainingPrivacy,
  isOwner: boolean
): T[] {
  if (isOwner) return rows;
  if (privacy.hidden) return [];
  return rows.filter(row =>
    row.metric_category === 'body' ? !privacy.body : !privacy.records
  );
}
