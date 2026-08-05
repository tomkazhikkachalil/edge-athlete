'use client';

import { useMemo, useState } from 'react';
import TrendLineChart, { type TrendChartPoint } from '@/components/charts/TrendLineChart';
import { VITAL_METRICS_MAP, formatSecondsToDisplay } from '@/lib/vitals-config';
import { metricSeries, exerciseProgression, type VitalEntryLike } from '@/lib/workouts/dashboard';
import { categoryAccent, metricCategory } from './category-colors';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';

/**
 * One large progress chart with a picker: every vitals metric with ≥2
 * entries and every exercise with ≥2 sessions of history. Single series,
 * single axis (dataviz rule — comparing two measures means two charts, not
 * a dual axis). Rolling average only for exercise progressions with enough
 * sessions; vitals series are often sparse/annual, where a 5-point average
 * misleads.
 */

interface ProgressSectionProps {
  vitals: VitalEntryLike[];
  sessions: ServerWorkoutSession[];
}

interface PickerOption {
  id: string;            // "metric:bench_press" | "exercise:pull_ups"
  label: string;
  color: string;
  unit: string;
  timeFormat: 'mm:ss' | 'decimal_seconds' | null;
  points: TrendChartPoint[];
}

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

export default function ProgressSection({ vitals, sessions }: ProgressSectionProps) {
  const options = useMemo<PickerOption[]>(() => {
    const built: PickerOption[] = [];

    // Vitals metrics with enough history
    const metricKeys = [...new Set(vitals.map(v => v.metric_key))];
    for (const key of metricKeys) {
      const metric = VITAL_METRICS_MAP[key];
      if (!metric) continue;
      const series = metricSeries(vitals, key);
      if (series.length < 2) continue;
      built.push({
        id: `metric:${key}`,
        label: metric.label,
        color: categoryAccent(metricCategory(key)).hex,
        unit: metric.unit,
        timeFormat: metric.time_format,
        points: series.map(p => ({ label: dateLabel(p.date), value: p.value })),
      });
    }

    // Exercises with cross-session history (strength accent)
    for (const [, prog] of exerciseProgression(sessions)) {
      if (prog.points.length < 2) continue;
      built.push({
        id: `exercise:${prog.key}`,
        label: `${prog.label} (workouts)`,
        color: categoryAccent('strength').hex,
        unit: prog.unit,
        timeFormat: prog.unit === 'sec' ? 'mm:ss' : null,
        points: prog.points.map(p => ({ label: dateLabel(p.date), value: p.value, meta: p.meta })),
      });
    }

    return built.sort((a, b) => a.label.localeCompare(b.label));
  }, [vitals, sessions]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    options.find(o => o.id === selectedId) ?? options[0] ?? null;

  if (!selected) return null;

  const isExercise = selected.id.startsWith('exercise:');
  const formatValue =
    selected.timeFormat === 'mm:ss'
      ? (v: number) => formatSecondsToDisplay(v, 'mm:ss')
      : selected.timeFormat === 'decimal_seconds'
        ? (v: number) => `${Math.round(v * 100) / 100} sec`
        : (v: number) => `${Math.round(v * 10) / 10}${selected.unit ? ` ${selected.unit}` : ''}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label htmlFor="progress-picker" className="text-sm font-semibold text-gray-900 shrink-0">
          Tracking
        </label>
        <select
          id="progress-picker"
          value={selected.id}
          onChange={e => setSelectedId(e.target.value)}
          className="min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          {options.map(option => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </div>
      <TrendLineChart
        title={selected.label}
        points={selected.points}
        color={selected.color}
        pointNoun={isExercise ? 'session' : 'entry'}
        rollingWindow={isExercise && selected.points.length >= 8 ? 5 : 0}
        formatValue={formatValue}
      />
    </div>
  );
}
