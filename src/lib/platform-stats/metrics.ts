/**
 * The metric registry (migration 267's `platform_rollup_day`, mirrored —
 * a vitest pins every key here as a literal in the function's body). Pure,
 * ZERO imports. Groups are the unit of work: the caller runs them one at a
 * time inside its budget; a group that times out leaves the others alone.
 */
export const ROLLUP_GROUPS = ['users', 'cohorts', 'content', 'community', 'totals', 'site', 'storage'] as const;
export type RollupGroup = (typeof ROLLUP_GROUPS)[number];

/** Groups that make sense for a day still in progress ("today so far"). */
export const PARTIAL_GROUPS: readonly RollupGroup[] = ['users', 'content', 'community', 'totals', 'site'];

export interface MetricDef {
  key: string;
  group: RollupGroup;
  /** '' alone, or the dim prefixes the rows carry. */
  dims: readonly string[];
  /** How the number is made — the words the page's "ⓘ" shows. */
  how: 'range' | 'seen' | 'estimate' | 'snapshot' | 'sum' | 'external';
  label: string;
}

export const PLATFORM_METRICS: readonly MetricDef[] = [
  { key: 'users.new', group: 'users', dims: ['', 'type:'], how: 'seen', label: 'New accounts' },
  { key: 'users.departed', group: 'users', dims: [''], how: 'range', label: 'Departed accounts' },
  { key: 'users.deletion_requested', group: 'users', dims: [''], how: 'range', label: 'Deletions requested' },
  { key: 'users.dau', group: 'users', dims: [''], how: 'seen', label: 'Daily actives' },
  { key: 'users.wau', group: 'users', dims: [''], how: 'seen', label: 'Weekly actives' },
  { key: 'users.mau', group: 'users', dims: [''], how: 'seen', label: 'Monthly actives' },
  { key: 'cohort.size', group: 'cohorts', dims: ['cohort:'], how: 'seen', label: 'Cohort size' },
  { key: 'cohort.d1', group: 'cohorts', dims: ['cohort:'], how: 'seen', label: 'Back on day 1' },
  { key: 'cohort.d7', group: 'cohorts', dims: ['cohort:'], how: 'seen', label: 'Back on day 7' },
  { key: 'cohort.d30', group: 'cohorts', dims: ['cohort:'], how: 'seen', label: 'Back on day 30' },
  { key: 'posts.new', group: 'content', dims: ['', 'status:'], how: 'range', label: 'Posts' },
  { key: 'activities.new', group: 'content', dims: ['', 'type:'], how: 'range', label: 'Activities' },
  { key: 'workouts.new', group: 'content', dims: ['', 'status:'], how: 'range', label: 'Workouts' },
  { key: 'orgs.new', group: 'community', dims: ['kind:'], how: 'range', label: 'New orgs' },
  { key: 'orgs.total', group: 'community', dims: ['kind:'], how: 'snapshot', label: 'Orgs' },
  { key: 'tickets.new', group: 'community', dims: ['', 'type:'], how: 'range', label: 'Tickets opened' },
  { key: 'tickets.closed', group: 'community', dims: [''], how: 'range', label: 'Tickets closed' },
  { key: 'tickets.open', group: 'community', dims: [''], how: 'snapshot', label: 'Tickets open' },
  { key: 'contacts.new', group: 'community', dims: ['source:'], how: 'range', label: 'Contacts' },
  { key: 'total', group: 'totals', dims: ['table:'], how: 'estimate', label: 'Rows (≈)' },
  { key: 'storage.objects', group: 'storage', dims: ['bucket:'], how: 'snapshot', label: 'Stored files' },
  { key: 'storage.bytes', group: 'storage', dims: ['bucket:'], how: 'snapshot', label: 'Stored bytes' },
  { key: 'site.views', group: 'site', dims: [''], how: 'sum', label: 'Org-site views' },
  { key: 'site.visitors', group: 'site', dims: [''], how: 'sum', label: 'Org-site visitors' },
  { key: 'errors.sentry', group: 'totals', dims: [''], how: 'external', label: 'Errors (Sentry)' },
];

/** The keys the SQL writes for a group (errors.sentry is the TS side's — H3). */
export function sqlKeysFor(group: RollupGroup): string[] {
  return PLATFORM_METRICS.filter(m => m.group === group && m.how !== 'external').map(m => m.key);
}

/** UTC calendar arithmetic — the project's day convention. */
export function dayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function yesterdayUTC(now: Date = new Date()): string {
  return addDays(dayUTC(now), -1);
}
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A day the rollup may recompute: well-formed, not in the future, not older than the retention of its sources (400 d). */
export function recomputableDay(day: string, now: Date = new Date()): boolean {
  if (!DAY_RE.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== day) return false;
  const today = Date.parse(`${dayUTC(now)}T00:00:00.000Z`);
  return t <= today && today - t <= 400 * 86_400_000;
}

/**
 * Which groups to run with the budget left: the plan is the full list; a
 * group starts only while time remains. The ORDER is the priority — the
 * cheap, most-read groups first; storage (a full scan) last.
 */
export function groupsForRun(opts: { partial: boolean; only?: readonly RollupGroup[] }): RollupGroup[] {
  const base = opts.partial ? PARTIAL_GROUPS : ROLLUP_GROUPS;
  return opts.only ? base.filter(g => opts.only!.includes(g)) : [...base];
}
