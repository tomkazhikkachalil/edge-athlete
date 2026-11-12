// ── The ONE writer and the readers of training_pins (migration 306) ─────────
// Training redesign PR 7 (Nov 11 2026). Posture A: RLS on, no policies, the
// admin client only — the ROUTE decides who may read or write. A pin stores
// what is pinned (pins.ts); `resolvePins` turns the list into what ONE viewer
// may see: an exercise's best from the fold that viewer gets (bests-server —
// a visitor's from the sessions they may open), a test's best from the rows
// the privacy filter leaves. A pin whose value that viewer cannot see, or
// whose exercise or test no longer has a number, is simply not in the answer.

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeMetricStats, formatEntryValue, type BodyMetricEntry } from '@/components/training/metric-stats';
import { readBestsSources } from '@/lib/workouts/bests-server';
import { describeExercise, sessionBests } from '@/lib/workouts/exercise-list';
import { foldBests, formatPr, PR_LABELS, workoutUnit } from '@/lib/workouts/prs';
import { MAX_PINS, parsePin, type ResolvedPin, type TrainingPin } from './pins';

interface PinRow {
  position: number;
  kind: string;
  ref: string;
  record_kind: string | null;
}

/** The profile's pins, in the athlete's order. A row that is not a pin any more (a kind this code does not write) is skipped. */
export async function readPins(admin: SupabaseClient, profileId: string): Promise<TrainingPin[]> {
  const { data, error } = await admin.from('training_pins').select('position, kind, ref, record_kind').eq('profile_id', profileId).order('position', { ascending: true }).limit(MAX_PINS);
  if (error) {
    console.error('[training/pins] read failed:', error.message);
    return [];
  }
  const out: TrainingPin[] = [];
  for (const r of (data ?? []) as PinRow[]) {
    const pin = parsePin({ kind: r.kind, ref: r.ref, recordKind: r.record_kind });
    if (pin) out.push(pin);
  }
  return out;
}

/**
 * Replace the profile's pins with this list (already validated by parsePins):
 * the old rows go, the new ones are written at positions 1…n. Two calls, not
 * a transaction — a failure between them leaves no pins, never a mixed list;
 * the screen says the save failed and the athlete's next tap writes it whole.
 */
export async function writePins(admin: SupabaseClient, profileId: string, pins: readonly TrainingPin[]): Promise<boolean> {
  const cleared = await admin.from('training_pins').delete().eq('profile_id', profileId);
  if (cleared.error) {
    console.error('[training/pins] clear failed:', cleared.error.message);
    return false;
  }
  if (pins.length === 0) return true;
  const { error } = await admin.from('training_pins').insert(
    pins.map((p, i) => ({ profile_id: profileId, position: i + 1, kind: p.kind, ref: p.ref, record_kind: p.kind === 'exercise' ? p.recordKind : null }))
  );
  if (error) {
    console.error('[training/pins] write failed:', error.message);
    return false;
  }
  return true;
}

/** The pins as ONE viewer may see them. `visitor` = a non-owner (the route has already applied the records privacy aspect). */
export async function resolvePins(admin: SupabaseClient, profileId: string, pins: readonly TrainingPin[], opts: { visitor: boolean }): Promise<ResolvedPin[]> {
  if (pins.length === 0) return [];
  const wantsExercises = pins.some(p => p.kind === 'exercise');
  const testKeys = [...new Set(pins.filter(p => p.kind === 'test').map(p => p.ref))];
  const [sources, tests] = await Promise.all([
    wantsExercises ? readBestsSources(admin, profileId, { visitor: opts.visitor }) : Promise.resolve(null),
    testKeys.length > 0
      ? admin.from('athlete_vitals').select('id, metric_key, metric_category, metric_label, value, value_display, unit, recorded_at, source, notes, linked_post_id').eq('profile_id', profileId).in('metric_key', testKeys).neq('metric_category', 'strength').neq('metric_category', 'body').limit(2000)
      : Promise.resolve(null),
  ]);
  const bests = sources && sources.ok ? foldBests(sources.sessions.map(sessionBests)) : new Map();
  const unit = sources && sources.ok ? workoutUnit(sources.workouts.flatMap(s => s.exercises)) : 'lb';
  // A numeric column arrives as a string; the best is a comparison of numbers.
  const testRows = ((tests?.data ?? []) as unknown as BodyMetricEntry[]).map(r => ({ ...r, value: r.value === null ? null : Number(r.value) }));

  const out: ResolvedPin[] = [];
  for (const pin of pins) {
    if (pin.kind === 'exercise') {
      const b = bests.get(pin.ref);
      const value = b ? (b[pin.recordKind] ?? null) : null;
      if (!b || value === null) continue;
      out.push({ pin, label: describeExercise(pin.ref, b.name).name, kindLabel: PR_LABELS[pin.recordKind], display: formatPr(pin.recordKind, value, unit) });
    } else {
      const stats = computeMetricStats(pin.ref, testRows.filter(r => r.metric_key === pin.ref));
      if (!stats || stats.best.value === null) continue;
      out.push({ pin, label: stats.metric.label, kindLabel: null, display: formatEntryValue(stats.best) });
    }
  }
  return out;
}
