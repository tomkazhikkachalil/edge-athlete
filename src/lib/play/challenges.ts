import { STAT_SCHEMAS } from '@/lib/sports/stat-schemas';

/**
 * Friend challenges — the Play program (244). Pure, client-safe, every sport.
 *
 * "Beat my 78 at Eagle Creek in 30 days" / "Score 20+ points this month":
 * a metric in the sport's OWN vocabulary (golf's round facts; a stat-line
 * sport's schema fields), a target, a direction, a window. Settled from the
 * fact table by the post-write hook (a real result of the challengee's, in
 * the window) — never by a claim. Tom's rules (plan mode, Sep 28): mutual
 * follows only; every result counts, a verified one is marked.
 *
 *  • `lower` (golf's strokes, a goals-against, a race time) — BEAT the
 *    target: strictly under it.
 *  • `higher` (points, birdies, kills) — REACH the target: at or over it.
 *
 * Status: pending → accepted | declined | cancelled | expired (the window
 * passed unanswered); accepted → won | lost (the window passed unmet) |
 * cancelled. Won / lost / declined / cancelled / expired are final.
 */

export type ChallengeDirection = 'lower' | 'higher';
export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'won' | 'lost' | 'expired';
export const OPEN_STATUSES: readonly ChallengeStatus[] = ['pending', 'accepted'];

export interface ChallengeMetric {
  key: string;
  label: string;
  direction: ChallengeDirection;
  /** Whole numbers only (a stroke, a goal); a race time takes decimals. */
  decimal?: boolean;
}

const GOLF_METRICS: ChallengeMetric[] = [
  { key: 'gross', label: 'Score', direction: 'lower' },
  { key: 'to_par', label: 'Score to par', direction: 'lower' },
  { key: 'birdies', label: 'Birdies', direction: 'higher' },
  { key: 'putts', label: 'Putts', direction: 'lower' },
];

/** Stat fields where less is better — the stat schemas carry no direction, so it lives here (one list, pinned by test). */
export const LOWER_IS_BETTER: ReadonlySet<string> = new Set([
  'goals_against', 'earned_runs', 'turnovers', 'service_errors', 'attack_errors', 'yellow_cards', 'pim',
]);

/** The metrics a challenge may name in a sport; empty for a sport with no vocabulary. */
export function challengeMetrics(sportKey: string): ChallengeMetric[] {
  if (sportKey === 'golf') return GOLF_METRICS;
  const schema = STAT_SCHEMAS[sportKey as keyof typeof STAT_SCHEMAS];
  if (!schema) return [];
  return schema.fields.map(f => ({
    key: f.key,
    label: f.label,
    direction: LOWER_IS_BETTER.has(f.key) || f.key.startsWith('time_') ? 'lower' : 'higher',
    ...(f.decimal ? { decimal: true } : {}),
  }));
}

export const MIN_DAYS = 1;
export const MAX_DAYS = 90;

export interface ChallengeDraft {
  challengeeId: string;
  sportKey: string;
  metric: string;
  target: number;
  days: number;
  courseId?: string | null;
  /** Golf: the round must be this many holes (a 9 never answers an 18's challenge). */
  holes?: 9 | 18 | null;
  message?: string | null;
  /** The challenger's own result it was made from ("Beat my 78"). */
  sourceKey?: string | null;
}

export interface ValidChallenge {
  challengee_id: string;
  sport_key: string;
  metric: string;
  direction: ChallengeDirection;
  target: number;
  course_id: string | null;
  min_holes: 9 | 18 | null;
  message: string | null;
  source_key: string | null;
  starts_on: string;
  ends_on: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const addDays = (ymd: string, days: number): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

export function validateChallenge(draft: ChallengeDraft, challengerId: string, today: string): { ok: true; value: ValidChallenge } | { ok: false; error: string } {
  if (!UUID.test(draft.challengeeId ?? '')) return { ok: false, error: 'Pick someone to challenge.' };
  if (draft.challengeeId === challengerId) return { ok: false, error: 'You cannot challenge yourself.' };
  const metric = challengeMetrics(draft.sportKey).find(m => m.key === draft.metric);
  if (!metric) return { ok: false, error: 'Pick what the challenge is about.' };
  if (typeof draft.target !== 'number' || !Number.isFinite(draft.target)) return { ok: false, error: 'Set a target.' };
  if (!metric.decimal && !Number.isInteger(draft.target)) return { ok: false, error: `${metric.label} is a whole number.` };
  if (metric.key !== 'to_par' && draft.target < 0) return { ok: false, error: 'The target cannot be negative.' };
  if (Math.abs(draft.target) > 10_000) return { ok: false, error: 'That target is out of range.' };
  if (!Number.isInteger(draft.days) || draft.days < MIN_DAYS || draft.days > MAX_DAYS) return { ok: false, error: `A challenge runs ${MIN_DAYS}–${MAX_DAYS} days.` };
  const isGolf = draft.sportKey === 'golf';
  if (draft.courseId && (!isGolf || !UUID.test(draft.courseId))) return { ok: false, error: 'A course applies to golf only.' };
  if (draft.holes != null && (!isGolf || (draft.holes !== 9 && draft.holes !== 18))) return { ok: false, error: 'A round is 9 or 18 holes.' };
  const message = typeof draft.message === 'string' ? draft.message.trim() : '';
  if (message.length > 140) return { ok: false, error: 'Keep the message under 140 characters.' };
  const sourceKey = typeof draft.sourceKey === 'string' && /^(post|golf_round|contest_stat_line):[0-9a-f-]{36}$/.test(draft.sourceKey) ? draft.sourceKey : null;
  return {
    ok: true,
    value: {
      challengee_id: draft.challengeeId,
      sport_key: draft.sportKey,
      metric: metric.key,
      direction: metric.direction,
      target: draft.target,
      course_id: isGolf ? draft.courseId ?? null : null,
      // Golf's score metrics need a round length; default the full 18.
      min_holes: isGolf && (metric.key === 'gross' || metric.key === 'to_par' || metric.key === 'putts') ? (draft.holes ?? 18) : isGolf ? draft.holes ?? null : null,
      message: message || null,
      source_key: sourceKey,
      starts_on: today,
      ends_on: addDays(today, draft.days),
    },
  };
}

export interface ChallengeTerms {
  sport_key: string;
  metric: string;
  direction: ChallengeDirection;
  target: number;
  course_id: string | null;
  min_holes: number | null;
  starts_on: string;
  ends_on: string;
}

export interface QualifyingRow {
  sport_key: string;
  occurred_on: string;
  metrics: Record<string, number>;
  context?: Record<string, unknown> | null;
}

/** Does one result answer the challenge? The window, the sport, the course, the holes, the number. */
export function qualifies(c: ChallengeTerms, row: QualifyingRow): boolean {
  if (row.sport_key !== c.sport_key) return false;
  if (row.occurred_on < c.starts_on || row.occurred_on > c.ends_on) return false;
  if (c.course_id && row.context?.course_id !== c.course_id) return false;
  if (c.min_holes != null && row.metrics.holes !== c.min_holes) return false;
  const v = row.metrics[c.metric];
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  return c.direction === 'lower' ? v < Number(c.target) : v >= Number(c.target);
}

export type ChallengeAction = 'accept' | 'decline' | 'cancel';

/** The next status for an action by a role, or null when refused. */
export function nextStatus(status: ChallengeStatus, action: ChallengeAction, by: 'challenger' | 'challengee'): ChallengeStatus | null {
  if (action === 'cancel') return by === 'challenger' && (status === 'pending' || status === 'accepted') ? 'cancelled' : null;
  if (by !== 'challengee' || status !== 'pending') return null;
  return action === 'accept' ? 'accepted' : 'declined';
}

/** The daily sweep: an open challenge past its window. */
export function expiredStatus(status: ChallengeStatus, endsOn: string, today: string): ChallengeStatus | null {
  if (endsOn >= today) return null;
  if (status === 'pending') return 'expired';
  if (status === 'accepted') return 'lost';
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (ymd: string) => {
  const [, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

/** "Beat 78 (18 holes) at Eagle Creek" / "Score 20+ points" — the challenge in words. */
export function challengeLine(c: ChallengeTerms & { courseName?: string | null }): string {
  const metric = challengeMetrics(c.sport_key).find(m => m.key === c.metric);
  const label = (metric?.label ?? c.metric).toLowerCase();
  const target = Number(c.target);
  let core: string;
  if (c.sport_key === 'golf' && c.metric === 'gross') core = `Shoot under ${target}`;
  else if (c.sport_key === 'golf' && c.metric === 'to_par') core = `Finish better than ${target > 0 ? `+${target}` : target === 0 ? 'even' : target}`;
  else if (c.direction === 'lower') core = `Get ${label} under ${target}`;
  else core = `${target}+ ${label}`;
  const holes = c.sport_key === 'golf' && c.min_holes ? ` (${c.min_holes} holes)` : '';
  const at = c.courseName ? ` at ${c.courseName}` : '';
  return `${core}${holes}${at} by ${shortDate(c.ends_on)}`;
}
