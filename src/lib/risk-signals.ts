// Pure risk-signal detectors (Wave 7) — heuristic, METADATA-ONLY.
//
// ── THE STANDING LINE: NO DM TRANSCRIPTS, EVER ──────────────────────────────
// This module (and the sweep that feeds it, risk-sweep.ts) consumes
// TIMESTAMPS AND COUNTS ONLY. It must never receive, and its callers must
// never select, a message content column. A signal says "worth a look",
// never what was said — guardians who want the content ask their kid.
//
// Detectors are pure over ISO timestamp arrays so the node suite can pin
// the thresholds. Windows are anchored to the UTC day (startOfUtcDay) so a
// daily sweep dedups naturally against risk_signals' UNIQUE
// (profile_id, kind, window_start).
//
// Thresholds are deliberately conservative — a false "worth a look" costs
// guardian trust; hub copy stays calm and non-accusatory either way.

export type RiskSignalKind =
  | 'new_contact_burst'
  | 'message_volume_spike'
  | 'report_filed'
  | 'late_night_activity'; // in the DB CHECK; no writer until profiles carry a timezone

export interface DetectedSignal {
  kind: RiskSignalKind;
  windowStart: string;
  windowEnd: string;
  magnitude: Record<string, number>;
}

/** UTC midnight of the given moment — the dedup anchor. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export const BURST_WINDOW_HOURS = 48;
export const BURST_MIN_CONTACTS = 4;

/**
 * New-contact burst: the child joined ≥4 new conversations in the trailing
 * 48h. Input = conversation_participants.joined_at values (any range; the
 * detector windows them itself).
 */
export function detectNewContactBurst(joinedAtIsos: string[], now: Date): DetectedSignal | null {
  const cutoff = now.getTime() - BURST_WINDOW_HOURS * 3_600_000;
  const recent = joinedAtIsos.filter(t => {
    const ms = Date.parse(t);
    return Number.isFinite(ms) && ms > cutoff && ms <= now.getTime();
  }).length;
  if (recent < BURST_MIN_CONTACTS) return null;
  return {
    kind: 'new_contact_burst',
    windowStart: startOfUtcDay(now).toISOString(),
    windowEnd: now.toISOString(),
    magnitude: { newContacts: recent, windowHours: BURST_WINDOW_HOURS },
  };
}

export const SPIKE_MIN_MESSAGES = 30;
export const SPIKE_MIN_RATIO = 4;
export const SPIKE_BASELINE_DAYS = 7;

/**
 * Volume spike: messages sent in the trailing 24h are both ≥30 and ≥4× the
 * prior-7-day daily average (floored at 1 so a quiet baseline can still
 * spike). Input = messages.created_at values for the trailing 8 days.
 */
export function detectVolumeSpike(sentAtIsos: string[], now: Date): DetectedSignal | null {
  const nowMs = now.getTime();
  const dayMs = 24 * 3_600_000;
  let last24 = 0;
  let baseline = 0;
  for (const t of sentAtIsos) {
    const ms = Date.parse(t);
    if (!Number.isFinite(ms) || ms > nowMs) continue;
    const age = nowMs - ms;
    if (age <= dayMs) last24 += 1;
    else if (age <= (SPIKE_BASELINE_DAYS + 1) * dayMs) baseline += 1;
  }
  const baselineAvg = Math.max(1, baseline / SPIKE_BASELINE_DAYS);
  if (last24 < SPIKE_MIN_MESSAGES || last24 < SPIKE_MIN_RATIO * baselineAvg) return null;
  return {
    kind: 'message_volume_spike',
    windowStart: startOfUtcDay(now).toISOString(),
    windowEnd: now.toISOString(),
    magnitude: {
      last24,
      baselineAvg: Math.round(baselineAvg * 10) / 10,
    },
  };
}

/** Calm, non-accusatory copy per kind — shared by the bell and the hub. */
export function signalCopy(kind: RiskSignalKind, childName: string): { title: string; message: string } {
  switch (kind) {
    case 'new_contact_burst':
      return {
        title: `Worth a look — ${childName} met several new people`,
        message: `${childName} started conversations with several new people in the last couple of days. Nothing is wrong automatically — it might be worth asking who they've been meeting.`,
      };
    case 'message_volume_spike':
      return {
        title: `Worth a look — ${childName}'s messaging picked up`,
        message: `${childName} sent quite a bit more than usual in the last day. Nothing is wrong automatically — it might be worth a casual check-in.`,
      };
    case 'report_filed':
      return {
        title: `Worth a look — ${childName} reported someone`,
        message: `${childName} used the report button. Our team reviews every report; you may also want to check in with them.`,
      };
    case 'late_night_activity':
      return {
        title: `Worth a look — late-night activity from ${childName}`,
        message: `${childName} was active late at night. Nothing is wrong automatically — worth knowing.`,
      };
  }
}
