'use client';

import { useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import VitalsTrendChart from '@/components/charts/VitalsTrendChart';
import type { TrendChartPoint } from '@/components/charts/TrendLineChart';
import { VITAL_CATEGORIES, VITAL_METRICS_MAP, formatSecondsToDisplay } from '@/lib/vitals-config';
import { metricSeries, exerciseProgression, type VitalEntryLike } from '@/lib/workouts/dashboard';
import { categoryAccent, metricCategory } from './category-colors';
import { parseDateLocal } from '@/lib/formatters';
import { useTheme } from '@/lib/use-theme';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';

/**
 * The star of the dashboard: one big growth-over-time chart. Pick what to
 * track from category-grouped chips (the old <select> — OS chrome, no color
 * language), switch the time range, and see personal-best moments starred
 * on the curve and listed under it. Single series, single axis (dataviz
 * rule); rolling average only for exercise progressions with enough
 * sessions. Always the athlete's own history — progress, never comparison.
 */

interface ProgressSectionProps {
  vitals: VitalEntryLike[];
  sessions: ServerWorkoutSession[];
}

interface PickerOption {
  id: string;            // "metric:bench_press" | "exercise:pull_ups"
  label: string;
  category: string | undefined;  // undefined → the Workouts group
  color: string;
  unit: string;
  timeFormat: 'mm:ss' | 'decimal_seconds' | null;
  lowerIsBetter: boolean;
  points: TrendChartPoint[];
  /** Raw dates parallel to points — range filtering needs real dates. */
  dates: string[];
}

// parseDateLocal, not new Date(): metric dates are DATE-column values and
// would label the previous day in US timezones.
const dateLabel = (iso: string) =>
  parseDateLocal(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

const RANGES = [
  { key: '3m', months: 3, label: '3M' },
  { key: '6m', months: 6, label: '6M' },
  { key: '1y', months: 12, label: '1Y' },
  { key: 'all', months: null, label: 'All' },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

export default function ProgressSection({ vitals, sessions }: ProgressSectionProps) {
  const { theme } = useTheme();
  const options = useMemo<PickerOption[]>(() => {
    const built: PickerOption[] = [];

    const metricKeys = [...new Set(vitals.map(v => v.metric_key))];
    for (const key of metricKeys) {
      const metric = VITAL_METRICS_MAP[key];
      if (!metric) continue;
      const series = metricSeries(vitals, key);
      if (series.length < 2) continue;
      const category = metricCategory(key);
      built.push({
        id: `metric:${key}`,
        label: metric.label,
        category,
        color: theme === 'dark' ? categoryAccent(category).hexDark : categoryAccent(category).hex,
        unit: metric.unit,
        timeFormat: metric.time_format,
        lowerIsBetter: metric.lower_is_better === true,
        points: series.map(p => ({ label: dateLabel(p.date), value: p.value })),
        dates: series.map(p => p.date),
      });
    }

    for (const [, prog] of exerciseProgression(sessions)) {
      if (prog.points.length < 2) continue;
      built.push({
        id: `exercise:${prog.key}`,
        label: prog.label,
        category: undefined,
        color: theme === 'dark' ? categoryAccent('strength').hexDark : categoryAccent('strength').hex,
        unit: prog.unit,
        timeFormat: prog.unit === 'sec' ? 'mm:ss' : null,
        // Progression values are "best set per session" maxima — higher wins.
        lowerIsBetter: false,
        points: prog.points.map(p => ({ label: dateLabel(p.date), value: p.value, meta: p.meta })),
        dates: prog.points.map(p => p.date),
      });
    }

    return built;
  }, [vitals, sessions, theme]);

  // Category-grouped picker rows, catalog order; exercises last.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; options: PickerOption[] }> = [];
    for (const category of VITAL_CATEGORIES) {
      const inCategory = options.filter(o => o.category === category.key);
      if (inCategory.length) out.push({ key: category.key, label: category.label, options: inCategory });
    }
    const exercises = options.filter(o => o.category === undefined);
    if (exercises.length) out.push({ key: 'workouts', label: 'Workouts', options: exercises });
    return out;
  }, [options]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('all');
  const selected = options.find(o => o.id === selectedId) ?? groups[0]?.options[0] ?? null;

  // Milestones (running personal best, ties count) on the FULL series, so a
  // narrowed range can never promote a lesser value to "best".
  const milestoneFlags = useMemo(() => {
    if (!selected) return [];
    const flags: boolean[] = [];
    let best: number | undefined;
    for (const p of selected.points) {
      const beats = best === undefined || (selected.lowerIsBetter ? p.value <= best : p.value >= best);
      flags.push(beats);
      if (beats) best = p.value;
    }
    return flags;
  }, [selected]);

  if (!selected) return null;

  const cutoff = (() => {
    const months = RANGES.find(r => r.key === range)?.months;
    if (!months) return null;
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.getTime();
  })();
  const startIndex = cutoff === null
    ? 0
    : selected.dates.findIndex(d => parseDateLocal(d).getTime() >= cutoff);
  const visiblePoints = startIndex === -1 ? [] : selected.points.slice(startIndex);
  // The first entry ever is trivially a "best" — only star improvements.
  const visibleMilestones = startIndex === -1 ? [] : milestoneFlags
    .map((flag, i) => ({ flag, i }))
    .filter(({ flag, i }) => flag && i > 0 && i >= startIndex)
    .map(({ i }) => i - startIndex);

  const isExercise = selected.id.startsWith('exercise:');
  const formatValue =
    selected.timeFormat === 'mm:ss'
      ? (v: number) => formatSecondsToDisplay(v, 'mm:ss')
      : selected.timeFormat === 'decimal_seconds'
        ? (v: number) => `${Math.round(v * 100) / 100} sec`
        : (v: number) => `${Math.round(v * 10) / 10}${selected.unit ? ` ${selected.unit}` : ''}`;

  const milestoneChips = milestoneFlags
    .map((flag, i) => ({ flag, i }))
    .filter(({ flag, i }) => flag && i > 0 && i >= startIndex && startIndex !== -1)
    .map(({ i }) => selected.points[i])
    .reverse()
    .slice(0, 6);

  return (
    <section className="vt-card vt-pop-in p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="text-base font-bold text-primary">Progress</h3>
        <div role="group" aria-label="Time range" className="flex gap-1.5">
          {RANGES.map(r => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={`vt-pill rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                range === r.key
                  ? 'bg-brand text-white'
                  : 'border border-border text-secondary hover:bg-surface-muted'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-label="Tracking" className="space-y-2.5 mb-4">
        {groups.map(group => (
          <div key={group.key}>
            <div className="text-[11px] font-semibold text-faint uppercase tracking-wide mb-1">
              {group.label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.options.map(option => {
                const isSelected = option.id === selected.id;
                const accent = categoryAccent(option.category ?? 'strength');
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedId(option.id)}
                    className={`vt-pill rounded-full px-3 py-1.5 text-xs transition-colors ${
                      isSelected
                        ? `${accent.chip} font-bold`
                        : 'border border-border text-secondary font-semibold hover:bg-surface-muted'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* key remounts the chart so the draw-in replays on every switch */}
      <VitalsTrendChart
        key={`${selected.id}:${range}`}
        title={selected.label}
        points={visiblePoints}
        color={selected.color}
        pointNoun={isExercise ? 'session' : 'entry'}
        rollingWindow={isExercise && visiblePoints.length >= 8 ? 5 : 0}
        formatValue={formatValue}
        milestones={visibleMilestones}
        emptyMessage={
          range !== 'all'
            ? 'Not enough entries in this range — try a longer one.'
            : undefined
        }
      />

      {milestoneChips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-faint uppercase tracking-wide mr-1">
            Milestones
          </span>
          {milestoneChips.map((point, i) => (
            <span
              key={`${point.label}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 px-2.5 py-1 text-xs font-semibold"
            >
              <Star className="w-2.5 h-2.5 text-amber-500" aria-hidden="true" />
              {formatValue(point.value)}
              <span className="text-amber-600/70 dark:text-amber-400/70">{point.label}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
