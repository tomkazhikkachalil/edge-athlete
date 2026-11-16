'use client';

// Training's timeline ("one wave", phase 2, Nov 2026; Tom: Year → Month → Week
// → Session). History opens on the years; a year lists its months, a month its
// weeks, a week its sessions day by day. Every level has its own address
// (&year= / &month= / &week=) and is a history entry, so Back walks up; the
// trail above the heading is the same way up, by name. One narrow read (the
// timeline route) feeds every level; the grouping is the viewer's own calendar
// (src/lib/training/timeline.ts).

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import FaIcon from '@/components/FaIcon';
import { faDumbbell } from '@/lib/icons/fa/dumbbell';
import { activityGlyph } from '@/lib/activities/activity-icons';
import { ACTIVITY_TYPE_DEFS, isActivityType } from '@/lib/activities/catalog';
import { formatDistance, formatDuration, type DistanceUnit } from '@/lib/activities/format';
import {
  dateOfKey,
  dayRangeLabel,
  monthLabel,
  scopeTrail,
  timelineDays,
  timelineMonths,
  timelineTotals,
  timelineWeeks,
  timelineYears,
  totalTimeLabel,
  weekRange,
  weekSessions,
  type HistoryScope,
  type TimelineSession,
  type TimelineTotals,
} from '@/lib/training/timeline';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'hidden' } | { kind: 'ready'; sessions: TimelineSession[] };

/** The levels that count sessions; one session's page is SessionPage's. */
export type PeriodScope = Exclude<HistoryScope, { level: 'session' }>;

interface TrainingTimelineProps {
  profileId: string;
  isOwnProfile: boolean;
  scope: PeriodScope;
  onScope: (scope: HistoryScope) => void;
  unit: DistanceUnit;
}

export function scopeLabel(scope: HistoryScope, short = false): string {
  if (scope.level === 'year') return String(scope.year);
  if (scope.level === 'month') return monthLabel(scope.year, scope.month, !short);
  if (scope.level === 'week') {
    const { from, to } = weekRange(scope.week);
    return short ? dayRangeLabel(from, to) : `${dayRangeLabel(from, to)}, ${dateOfKey(to).getFullYear()}`;
  }
  return 'History';
}

const sessionsWord = (n: number) => `${n} ${n === 1 ? 'session' : 'sessions'}`;

/** A row's one line: what the period held. */
function totalsLine(t: TimelineTotals, unit: DistanceUnit): string {
  return [sessionsWord(t.sessions), t.seconds > 0 ? totalTimeLabel(t.seconds) : null, `${t.activeDays} ${t.activeDays === 1 ? 'day' : 'days'}`, t.distanceM > 0 ? formatDistance(t.distanceM, unit) : null]
    .filter(Boolean)
    .join(' · ');
}

function Tiles({ totals, unit }: { totals: TimelineTotals; unit: DistanceUnit }) {
  const tiles: Array<{ label: string; value: string; note?: string }> = [
    { label: 'Sessions', value: String(totals.sessions) },
    { label: 'Time', value: totalTimeLabel(totals.seconds) },
    { label: 'Active days', value: String(totals.activeDays) },
    ...(totals.distanceM > 0 ? [{ label: 'Distance', value: formatDistance(totals.distanceM, unit) }] : []),
    ...(totals.rated > 0 ? [{ label: 'Load', value: totals.load.toLocaleString('en-US'), note: `${totals.rated} of ${totals.sessions} rated` }] : []),
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-timeline-tiles="">
      {tiles.map(t => (
        <div key={t.label} className="ea-surface rounded-lg p-3">
          <dt className="text-xs text-muted">{t.label}</dt>
          <dd className="text-lg font-bold text-primary tabular-nums">{t.value}</dd>
          {t.note && <dd className="text-xs text-muted">{t.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Row({ label, line, rowKey, onOpen }: { label: string; line: string; rowKey: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="ea-surface ea-interactive flex min-h-[56px] w-full items-center justify-between gap-3 rounded-lg p-3 text-left" data-timeline-row={rowKey}>
        <span className="min-w-0">
          <span className="block font-semibold text-primary">{label}</span>
          <span className="block text-sm text-secondary tabular-nums">{line}</span>
        </span>
        <span className="shrink-0 text-muted" aria-hidden="true">›</span>
      </button>
    </li>
  );
}

function SessionRow({ session: s, unit, onOpen }: { session: TimelineSession; unit: DistanceUnit; onOpen: () => void }) {
  const def = s.kind === 'activity' && isActivityType(s.type) ? ACTIVITY_TYPE_DEFS[s.type] : null;
  const line = [
    def ? def.label : 'Workout',
    new Date(s.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    s.distanceM ? formatDistance(s.distanceM, unit) : null,
    s.seconds > 0 ? formatDuration(s.seconds) : null,
    typeof s.effort === 'number' ? `Effort ${s.effort}` : null,
  ].filter(Boolean).join(' · ');
  const body = (
    <>
      <FaIcon icon={def ? activityGlyph(def.icon) : faDumbbell} className="w-5 shrink-0 text-center text-sm text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-primary">{s.title || (def ? def.label : 'Workout')}</span>
        <span className="block text-sm text-secondary tabular-nums">{line}</span>
      </span>
    </>
  );
  const shell = 'ea-surface flex min-h-[56px] items-center gap-3 rounded-lg p-3';
  return s.kind === 'activity' ? (
    <Link href={`/activities/${s.id}`} className={`ea-interactive ${shell}`} data-timeline-session={s.id} data-session-kind="activity">
      {body}
      <span className="shrink-0 text-muted" aria-hidden="true">›</span>
    </Link>
  ) : (
    <button type="button" onClick={onOpen} className={`ea-interactive w-full text-left ${shell}`} data-timeline-session={s.id} data-session-kind="workout">
      {body}
      <span className="shrink-0 text-muted" aria-hidden="true">›</span>
    </button>
  );
}

export default function TrainingTimeline({ profileId, isOwnProfile, scope, onScope, unit }: TrainingTimelineProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/profile/${profileId}/training/timeline`, { credentials: 'include', cache: 'no-store' })
      .then(async res => {
        if (cancelled) return;
        // A 404 is the gate's refusal (blocked, departed): nothing to show, never an error.
        if (res.status === 404) return setState({ kind: 'hidden' });
        if (!res.ok) return setState({ kind: 'error' });
        const body = (await res.json()) as { sessions?: TimelineSession[]; hidden?: boolean };
        if (cancelled) return;
        setState(body.hidden ? { kind: 'hidden' } : { kind: 'ready', sessions: body.sessions ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  // A step down or up starts at the top of its level (the first paint keeps the host's own deep-link pin).
  const scopeKey = JSON.stringify(scope);
  const firstScope = useRef(scopeKey);
  useEffect(() => {
    if (firstScope.current === scopeKey) return;
    firstScope.current = scopeKey;
    sectionRef.current?.scrollIntoView({ block: 'start' });
  }, [scopeKey]);

  const sessions = state.kind === 'ready' ? state.sessions : null;
  const view = useMemo(() => {
    if (!sessions) return null;
    if (scope.level === 'all') return { rows: timelineYears(sessions).map(y => ({ key: String(y.year), label: String(y.year), totals: y as TimelineTotals, to: { level: 'year', year: y.year } as HistoryScope })), totals: null, days: null };
    if (scope.level === 'year') {
      const months = timelineMonths(sessions, scope.year);
      return {
        rows: months.map(m => ({ key: m.key, label: monthLabel(m.year, m.month, false), totals: m as TimelineTotals, to: { level: 'month', year: m.year, month: m.month } as HistoryScope })),
        totals: timelineTotals(sessions.filter(s => new Date(s.startedAt).getFullYear() === scope.year)),
        days: null,
      };
    }
    if (scope.level === 'month') {
      const weeks = timelineWeeks(sessions, scope.year, scope.month);
      return {
        rows: weeks.map(w => ({ key: w.week, label: dayRangeLabel(w.from, w.to), totals: w as TimelineTotals, to: { level: 'week', week: w.week } as HistoryScope })),
        totals: timelineTotals(sessions.filter(s => { const d = new Date(s.startedAt); return d.getFullYear() === scope.year && d.getMonth() + 1 === scope.month; })),
        days: null,
      };
    }
    const inWeek = weekSessions(sessions, scope.week);
    return { rows: [], totals: timelineTotals(inWeek), days: timelineDays(inWeek) };
  }, [sessions, scope]);

  // The whole History: the years sit above the list, and only when there is something to open.
  if (scope.level === 'all') {
    if (!view || view.rows.length === 0) return null;
    return (
      <section className="space-y-2" aria-label="By year" data-timeline-level="all">
        <h3 className="text-base font-bold text-primary">By year</h3>
        <ul className="space-y-2">
          {view.rows.map(r => <Row key={r.key} rowKey={r.key} label={r.label} line={totalsLine(r.totals, unit)} onOpen={() => onScope(r.to)} />)}
        </ul>
      </section>
    );
  }

  const trail = scopeTrail(scope);
  const up = trail[trail.length - 1];
  const empty = view && view.totals && view.totals.sessions === 0;
  return (
    <section ref={sectionRef} className="space-y-4 scroll-mt-24" aria-label={scopeLabel(scope)} data-timeline-level={scope.level}>
      <nav aria-label="Training history" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
        {trail.map(step => (
          <span key={JSON.stringify(step)} className="inline-flex items-center gap-1">
            <button type="button" onClick={() => onScope(step)} className="ea-interactive inline-flex min-h-[44px] items-center rounded-lg px-2 font-semibold text-brand-fg" data-timeline-up={step.level}>
              {scopeLabel(step, true)}
            </button>
            <span className="text-muted" aria-hidden="true">›</span>
          </span>
        ))}
        <span className="px-2 font-semibold text-primary" aria-current="page">{scopeLabel(scope, true)}</span>
      </nav>
      <h3 className="text-lg font-bold text-primary" data-timeline-heading="">{scopeLabel(scope)}</h3>

      {state.kind === 'loading' && (
        <div className="flex justify-center py-12" aria-busy="true">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
        </div>
      )}
      {state.kind === 'error' && <p className="py-8 text-center text-secondary">Could not load this. Check your connection and try again.</p>}
      {(state.kind === 'hidden' || empty) && (
        <div className="ea-surface rounded-lg p-8 text-center" data-timeline-empty="">
          <p className="font-semibold text-primary">{isOwnProfile ? 'Nothing recorded here' : 'Nothing to show here'}</p>
          {up && (
            <button type="button" onClick={() => onScope(up)} className="ea-interactive mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-border px-4 text-sm font-semibold text-primary">
              Back to {scopeLabel(up, true)}
            </button>
          )}
        </div>
      )}

      {view && view.totals && !empty && (
        <>
          <Tiles totals={view.totals} unit={unit} />
          {view.rows.length > 0 && (
            <ul className="space-y-2">
              {view.rows.map(r => <Row key={r.key} rowKey={r.key} label={r.label} line={totalsLine(r.totals, unit)} onOpen={() => onScope(r.to)} />)}
            </ul>
          )}
          {view.days && (
            <div className="space-y-4">
              {view.days.map(day => (
                <div key={day.key} data-timeline-day={day.key}>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{dateOfKey(day.key).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h4>
                  <ul className="space-y-2">
                    {day.sessions.map(s => <li key={`${s.kind}:${s.id}`}><SessionRow session={s} unit={unit} onOpen={() => onScope({ level: 'session', id: s.id })} /></li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
