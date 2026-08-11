'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  VITAL_CATEGORIES,
  VITAL_METRICS_MAP,
  getAgeAtDate,
  getVitalDisplayValue,
  getYearsTracked,
  getTrendArrow,
  formatSecondsToDisplay,
} from '@/lib/vitals-config';
import {
  Plus, History, Ruler, Timer, Dumbbell, Loader2, Star, Camera, ChevronDown, Settings,
} from 'lucide-react';
import AddVitalModal from './AddVitalModal';
import CreatePostModal from './CreatePostModal';
import PostCard from './PostCard';
import PostDetailModal from './PostDetailModal';
import FilterBar from './filters/FilterBar';
import MultiSelectDropdown from './filters/MultiSelectDropdown';
import WorkoutCard from './workouts/WorkoutCard';
import { useToast } from './Toast';
import { deriveYearOptions, matchesYearFilter } from '@/lib/profile-filters';
import { formatHeight, formatWeightWithUnit, formatAge, formatDate } from '@/lib/formatters';
import { effectiveSessionStatus } from '@/lib/workouts/status';
import { weeklySummary, streakWeeks, latestPB } from '@/lib/workouts/dashboard';
import HeroStrip from './vitals/HeroStrip';
import PBShowcase from './vitals/PBShowcase';
import ProgressSection from './vitals/ProgressSection';
import VitalsSettingsModal from './vitals/VitalsSettingsModal';
import SectionEmptyState from './SectionEmptyState';
import { categoryAccent } from './vitals/category-colors';
import { useTheme } from '@/lib/use-theme';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';

// ── Types ──────────────────────────────────────────────────────────────────

interface VitalEntry {
  id: string;
  profile_id: string;
  metric_key: string;
  metric_category: string;
  metric_label: string;
  value: number | null;
  value_display: string | null;
  unit: string;
  notes: string | null;
  source: string;
  recorded_at: string;
  created_at: string;
  linked_post_id: string | null;
}

interface PostMedia {
  id: string;
  media_url: string;
  media_type: 'image' | 'video';
  display_order: number;
}

interface TrainingPost {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: Record<string, unknown> | null;
  visibility: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  saves_count: number;
  profile: {
    id: string;
    first_name: string | null;
    middle_name?: string | null;
    last_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
    handle?: string | null;
  };
  media: PostMedia[];
  likes: { profile_id: string }[];
}

interface VitalsTabProps {
  profileId: string;
  currentUserId?: string;
  isOwnProfile?: boolean;
}

interface CurrentVitals {
  heightCm: number | null;
  weightKg: number | null;
  weightDisplay: number | null;
  weightUnit: 'lbs' | 'kg' | 'stone' | null;
  dob: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatEntryValue(entry: VitalEntry): string {
  const metric = VITAL_METRICS_MAP[entry.metric_key];
  if (!metric) return getVitalDisplayValue(entry.value, entry.value_display, entry.unit);

  if (entry.value_display) return entry.value_display;
  if (entry.value === null || entry.value === undefined) return '—';

  if (metric.time_format === 'mm:ss') {
    return formatSecondsToDisplay(entry.value, 'mm:ss');
  }
  if (metric.time_format === 'decimal_seconds') {
    return `${entry.value} sec`;
  }
  return `${entry.value} ${entry.unit}`;
}

function isBetter(a: number, b: number, lowerIsBetter: boolean | null): boolean {
  if (lowerIsBetter === null) return false;
  return lowerIsBetter ? a < b : a > b;
}

// ── MetricCard ─────────────────────────────────────────────────────────────

interface MetricCardProps {
  metricKey: string;
  entries: VitalEntry[];  // all entries for this metric, chronological (oldest first)
  athleteBirthday: string | null;
  onOpenPost: (postId: string) => void;
}

function MetricCard({ metricKey, entries, athleteBirthday, onOpenPost }: MetricCardProps) {
  const [expanded, setExpanded] = useState(false);
  const metric = VITAL_METRICS_MAP[metricKey];
  if (!metric || entries.length === 0) return null;

  const sorted = [...entries].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];

  // Personal best
  let best = sorted[0];
  for (const e of sorted) {
    if (e.value !== null && best.value !== null && isBetter(e.value, best.value, metric.lower_is_better)) {
      best = e;
    }
  }

  const isCurrentBest = best.id === latest.id;

  // Progression delta
  let deltaText: string | null = null;
  if (
    sorted.length >= 2 &&
    first.value !== null &&
    latest.value !== null &&
    metric.lower_is_better !== null
  ) {
    const diff = latest.value - first.value;
    if (diff !== 0) {
      const sign = diff > 0 ? '+' : '';
      if (metric.time_format === 'mm:ss') {
        const absDiff = Math.abs(diff);
        const mins = Math.floor(absDiff / 60);
        const secs = Math.round(absDiff % 60);
        const formatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        deltaText = `${diff < 0 ? '-' : '+'}${formatted} since first recorded`;
      } else if (metric.time_format === 'decimal_seconds') {
        deltaText = `${sign}${diff.toFixed(2)} sec since first recorded`;
      } else {
        deltaText = `${sign}${diff} ${metric.unit} since first recorded`;
      }
    }
  }

  const yearsTracked = sorted.length >= 2 ? getYearsTracked(first.recorded_at, latest.recorded_at) : null;
  const trend = getTrendArrow(first.value, latest.value, metric.lower_is_better);
  const trendColor = trend === '▲' ? 'text-emerald-600' : trend === '▼' ? 'text-red-500' : 'text-faint';

  // History grouped by year (newest first)
  const byYear: Record<string, VitalEntry[]> = {};
  for (const e of [...sorted].reverse()) {
    const year = new Date(e.recorded_at).getFullYear().toString();
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(e);
  }
  const years = Object.keys(byYear).sort((a, b) => parseInt(b) - parseInt(a));
  const oldestYear = years[years.length - 1];

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Card header — clickable to expand/collapse */}
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="w-full text-left p-4 hover:bg-surface-muted transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-secondary">{metric.label}</span>
              <span className="text-xs text-faint">{metric.unit}</span>
              {trend !== '—' && (
                <span className={`text-xs font-bold ${trendColor}`}>{trend}</span>
              )}
            </div>

            {/* Current value — prominent */}
            <div className="text-2xl font-bold text-primary mb-1">
              {formatEntryValue(latest)}
            </div>

            {/* PB badge */}
            {isCurrentBest ? (
              <div className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full mb-2">
                <Star className="w-2.5 h-2.5 text-amber-500 inline" aria-hidden="true" />
                Personal Best
              </div>
            ) : best.value !== null && (
              <div className="text-xs text-muted mb-2">
                PB: <span className="font-semibold">{formatEntryValue(best)}</span>
                <span className="text-faint ml-1">({new Date(best.recorded_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})</span>
              </div>
            )}

            {/* First recorded + progression */}
            {sorted.length >= 2 && (
              <div className="text-xs text-muted">
                First: <span className="font-medium">{formatEntryValue(first)}</span>
                {athleteBirthday && (
                  <span className="text-faint ml-1">· {getAgeAtDate(athleteBirthday, first.recorded_at)}</span>
                )}
                {deltaText && (
                  <span className={`ml-2 font-medium ${
                    metric.lower_is_better !== null
                      ? (latest.value! < first.value!) === metric.lower_is_better
                        ? 'text-emerald-600'
                        : 'text-red-500'
                      : 'text-tertiary'
                  }`}>{deltaText}</span>
                )}
              </div>
            )}

            {/* Years tracked */}
            {yearsTracked && (
              <div className="text-xs text-faint mt-0.5">{yearsTracked}</div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="text-xs text-faint">
              {new Date(latest.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <ChevronDown className={`w-4 h-4 text-faint transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
          </div>
        </div>
      </button>

      {/* Inline history panel */}
      {expanded && (
        <div className="border-t border-border-subtle bg-surface-muted">
          <div className="px-4 py-3">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">History</p>
            {years.map(year => (
              <div key={year} className="mb-4 last:mb-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-secondary">{year}</span>
                  {year === oldestYear && (
                    <span className="text-xs text-faint">· First recorded</span>
                  )}
                </div>
                <div className="space-y-2">
                  {byYear[year].map(entry => (
                    <div key={entry.id} className="flex items-start justify-between text-sm py-2 px-3 bg-surface rounded-lg border border-border-subtle">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-primary">{formatEntryValue(entry)}</span>
                          {entry.id === best.id && (
                            <span className="text-xs text-amber-600 font-medium">
                              <Star className="w-2.5 h-2.5 text-amber-500 inline mr-0.5" aria-hidden="true" />PB
                            </span>
                          )}
                          {athleteBirthday && (
                            <span className="text-xs text-faint">{getAgeAtDate(athleteBirthday, entry.recorded_at)}</span>
                          )}
                          {entry.source !== 'manual' && (
                            <span className="text-xs text-violet-500">{entry.source}</span>
                          )}
                        </div>
                        {entry.notes && (
                          <p className="text-xs text-muted mt-0.5 truncate">{entry.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <span className="text-xs text-faint">
                          {new Date(entry.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        {entry.linked_post_id && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onOpenPost(entry.linked_post_id!); }}
                            className="text-violet-500 hover:text-brand-fg-strong transition-colors"
                            title="View media post"
                          >
                            <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── VitalsTab (main) ────────────────────────────────────────────────────────

export default function VitalsTab({ profileId, currentUserId, isOwnProfile = false }: VitalsTabProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const { showError } = useToast();
  const [vitals, setVitals] = useState<VitalEntry[]>([]);
  const [trainingPosts, setTrainingPosts] = useState<TrainingPost[]>([]);
  const [workouts, setWorkouts] = useState<ServerWorkoutSession[]>([]);
  const [athleteBirthday, setAthleteBirthday] = useState<string | null>(null);
  const [currentVitals, setCurrentVitals] = useState<CurrentVitals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddVital, setShowAddVital] = useState(false);
  const [showVitalsSettings, setShowVitalsSettings] = useState(false);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [linkedPostId, setLinkedPostId] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [startingWorkout, setStartingWorkout] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const [vitalsRes, workoutsRes] = await Promise.all([
        fetch(`/api/vitals?profileId=${profileId}`),
        fetch(`/api/workouts?profileId=${profileId}&limit=50`, { credentials: 'include' }),
      ]);
      if (!vitalsRes.ok) {
        const data = await vitalsRes.json();
        setError(data.error || 'Failed to load vitals');
        return;
      }
      const data = await vitalsRes.json();
      setVitals(data.vitals || []);
      setTrainingPosts(data.trainingPosts || []);
      setAthleteBirthday(data.athleteBirthday || null);
      setCurrentVitals(data.currentVitals || null);
      if (workoutsRes.ok) {
        const workoutData = await workoutsRes.json();
        setWorkouts(workoutData.sessions || []);
      }
    } catch (e) {
      console.error('Failed to load vitals data:', e);
      setError('Failed to load vitals data');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Live session in progress (owner only sees actives from the API)
  const activeWorkout = useMemo(
    () =>
      workouts.find(
        s =>
          s.status === 'active' &&
          effectiveSessionStatus({ status: s.status, lastActivityAt: s.last_activity_at }) === 'active'
      ) ?? null,
    [workouts]
  );

  useEffect(() => {
    if (!activeWorkout) return;
    try {
      setBannerDismissed(
        sessionStorage.getItem(`ea:workout-banner-dismissed:${activeWorkout.id}`) === '1'
      );
    } catch {
      setBannerDismissed(false);
    }
  }, [activeWorkout]);

  const handleStartWorkout = async () => {
    if (startingWorkout) return;
    setStartingWorkout(true);
    try {
      const response = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: 'live' }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 409 && data?.activeSessionId) {
        router.push(`/app/workout/${data.activeSessionId}`);
        return;
      }
      if (!response.ok) throw new Error(data?.error || 'Failed to start workout');
      router.push(`/app/workout/${data.session.id}`);
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Failed to start workout');
      setStartingWorkout(false);
    }
  };

  // Filter options derived from the data actually present
  const categoryOptions = useMemo(() => {
    const present = new Set(vitals.map(v => v.metric_category));
    return VITAL_CATEGORIES.filter(c => present.has(c.key)).map(c => ({
      value: c.key,
      label: c.label,
    }));
  }, [vitals]);

  const yearOptions = useMemo(
    () => deriveYearOptions(vitals.map(v => v.recorded_at)),
    [vitals]
  );

  // Apply filters BEFORE grouping — MetricCards (PB, first, trend, history)
  // are scoped to the filtered range, not all-time.
  const visibleVitals = vitals.filter(
    v =>
      matchesYearFilter(v.recorded_at, selectedYears) &&
      (selectedCategories.length === 0 || selectedCategories.includes(v.metric_category))
  );

  // Year filter also narrows the training feed (category doesn't apply there)
  const visibleTrainingPosts = trainingPosts.filter(p =>
    matchesYearFilter(p.created_at, selectedYears)
  );

  // Completed workouts, year-filtered (active sessions live in the banner)
  const visibleWorkouts = workouts.filter(
    s => s.status === 'completed' && matchesYearFilter(s.started_at, selectedYears)
  );

  // Dashboard headline stats — all-time / unfiltered on purpose: filters
  // narrow the library below, but "this week" and PBs must never lie.
  const completedWorkouts = useMemo(
    () => workouts.filter(s => s.status === 'completed'),
    [workouts]
  );
  const weekly = useMemo(() => weeklySummary(completedWorkouts), [completedWorkouts]);
  const streak = useMemo(() => streakWeeks(completedWorkouts), [completedWorkouts]);
  const pbSpotlight = useMemo(() => latestPB(vitals), [vitals]);
  const [showAllActivity, setShowAllActivity] = useState(false);

  // Group vitals by metric key
  const vitalsByMetric: Record<string, VitalEntry[]> = {};
  for (const entry of visibleVitals) {
    if (!vitalsByMetric[entry.metric_key]) vitalsByMetric[entry.metric_key] = [];
    vitalsByMetric[entry.metric_key].push(entry);
  }

  const totalMetrics = Object.keys(vitalsByMetric).length;
  const activeFilterCount = selectedCategories.length + selectedYears.length;

  if (loading) {
    return (
      <div className="py-16 flex items-center justify-center">
        <Loader2 className="w-7 h-7 text-faint animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-16 text-center text-muted">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Edge Vitals header + workout actions ─────────────────────── */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-h2 text-primary">Edge Vitals</h2>
            <p className="text-sm text-muted mt-0.5">
              Live workouts, performance metrics, and training history.
            </p>
          </div>
          {isOwnProfile && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleStartWorkout}
                disabled={startingWorkout}
                className="flex items-center gap-2 px-4 py-2.5 bg-brand text-white rounded-lg font-bold text-sm hover:bg-brand-hover transition-colors shadow-sm disabled:opacity-60"
              >
                {startingWorkout ? (
                  <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" aria-hidden="true" />
                ) : (
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse" aria-hidden="true" />
                )}
                Start Workout
              </button>
              <button
                onClick={() => router.push('/app/workout/new')}
                className="flex items-center gap-1.5 px-4 py-2.5 border border-border-strong text-secondary rounded-lg font-semibold text-sm hover:bg-surface-muted transition-colors"
              >
                <History className="w-3.5 h-3.5" aria-hidden="true" />
                Log Past Workout
              </button>
            </div>
          )}
        </div>

        {/* Resume banner — a live session is in progress */}
        {isOwnProfile && activeWorkout && !bannerDismissed && (
          <div className="mt-4 flex items-center justify-between gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" aria-hidden="true" />
              <p className="text-sm text-amber-900 dark:text-amber-200 truncate">
                <span className="font-bold">Workout in progress</span>
                {activeWorkout.title ? ` — ${activeWorkout.title}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => router.push(`/app/workout/${activeWorkout.id}`)}
                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 transition-colors"
              >
                Resume
              </button>
              <button
                onClick={() => {
                  try {
                    sessionStorage.setItem(`ea:workout-banner-dismissed:${activeWorkout.id}`, '1');
                  } catch { /* ignore */ }
                  setBannerDismissed(true);
                }}
                className="px-2 py-1.5 text-amber-700 text-xs font-semibold hover:text-amber-900 transition-colors"
                aria-label="Dismiss banner"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Hero: this week, streak, latest PB — always all-time-true ── */}
      <HeroStrip summary={weekly} streak={streak} pb={pbSpotlight} />

      {/* ── Personal bests — the trophy wall ─────────────────────────── */}
      <PBShowcase vitals={vitals} />

      {/* ── Progress — one big chart, pick what to track ─────────────── */}
      <ProgressSection vitals={vitals} sessions={completedWorkouts} />

      {/* ── Current Vitals — the athlete's present-day snapshot from their
             profile. Owners update height/weight via the gear (each save also
             appends a dated athlete_vitals timeline entry); DOB stays an Edit
             Profile job. DOB tile is owner-only; visitors see Age. ────────── */}
      {currentVitals && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-primary">Current Vitals</h3>
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => setShowVitalsSettings(true)}
                aria-label="Update body measurements"
                title="Update body measurements"
                className="shrink-0 flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong bg-surface text-tertiary hover:bg-surface-muted transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className={`grid grid-cols-2 gap-4 ${isOwnProfile ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
            <div className="text-center bg-surface rounded-lg border border-border p-4">
              <div className="text-2xl font-bold text-primary mb-1">
                {formatHeight(currentVitals.heightCm)}
              </div>
              <div className="text-xs text-muted uppercase tracking-wide">Height</div>
            </div>
            <div className="text-center bg-surface rounded-lg border border-border p-4">
              <div className="text-2xl font-bold text-primary mb-1">
                {currentVitals.weightDisplay && currentVitals.weightUnit
                  ? `${currentVitals.weightDisplay} ${currentVitals.weightUnit}`
                  : formatWeightWithUnit(currentVitals.weightKg, currentVitals.weightUnit)}
              </div>
              <div className="text-xs text-muted uppercase tracking-wide">Weight</div>
            </div>
            <div className="text-center bg-surface rounded-lg border border-border p-4">
              <div className="text-2xl font-bold text-primary mb-1">
                {formatAge(currentVitals.dob)}
              </div>
              <div className="text-xs text-muted uppercase tracking-wide">Age</div>
            </div>
            {isOwnProfile && (
              <div className="text-center bg-surface rounded-lg border border-border p-4">
                <div className="text-2xl font-bold text-primary mb-1">
                  {/* T00:00:00 suffix → parsed as LOCAL midnight; a bare DATE
                      string parses as UTC and shows the previous day in the US */}
                  {currentVitals.dob ? formatDate(`${currentVitals.dob.slice(0, 10)}T00:00:00`) : '—'}
                </div>
                <div className="text-xs text-muted uppercase tracking-wide">Date of Birth</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Filters (shared FilterBar treatment; always visible — dropdowns
             disable until there's data to narrow) ──────────────────────── */}
      <div className="space-y-6">
        <FilterBar
            resultCount={visibleVitals.length}
            resultNoun="entry"
            resultNounPlural="entries"
            activeCount={activeFilterCount}
            onClearAll={() => {
              setSelectedCategories([]);
              setSelectedYears([]);
            }}
          >
            <MultiSelectDropdown<string>
              allLabel="All Categories"
              itemNounPlural="categories"
              searchPlaceholder="Search categories..."
              options={categoryOptions}
              selected={selectedCategories}
              onChange={setSelectedCategories}
              disabled={categoryOptions.length === 0}
            />
            <MultiSelectDropdown<number>
              allLabel="All Years"
              itemNounPlural="years"
              searchPlaceholder="Search years..."
              options={yearOptions.map(year => ({ value: year, label: String(year) }))}
              selected={selectedYears}
              onChange={setSelectedYears}
              disabled={yearOptions.length === 0}
            />
          </FilterBar>
      </div>

      {/* ── Section A: Metrics ───────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-bold text-primary">Performance Metrics</h3>
            {totalMetrics > 0 && (
              <p className="text-xs text-muted mt-0.5">{totalMetrics} metric{totalMetrics !== 1 ? 's' : ''} tracked</p>
            )}
          </div>
          {isOwnProfile && (
            <button
              onClick={() => setShowAddVital(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-brand text-white rounded-lg text-sm font-semibold hover:bg-brand-hover transition-colors"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Add Metric
            </button>
          )}
        </div>

        {totalMetrics === 0 && vitals.length > 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-lg">
            <p className="text-sm text-tertiary">No metrics match your filters.</p>
          </div>
        ) : totalMetrics === 0 ? (
          <SectionEmptyState
            icon={Ruler}
            title="No metrics recorded yet"
            body="Track physical development over time — speed, strength, conditioning, and body metrics."
            cta={isOwnProfile ? { label: 'Add First Metric', onClick: () => setShowAddVital(true) } : undefined}
          />
        ) : (
          <div className="space-y-6">
            {VITAL_CATEGORIES.map(category => {
              const categoryMetrics = category.metrics.filter(
                m => vitalsByMetric[m.key] && vitalsByMetric[m.key].length > 0
              );
              if (categoryMetrics.length === 0) return null;

              return (
                <div key={category.key}>
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: theme === 'dark' ? categoryAccent(category.key).hexDark : categoryAccent(category.key).hex }}
                      aria-hidden="true"
                    />
                    <h4 className={`text-sm font-semibold ${categoryAccent(category.key).text}`}>{category.label}</h4>
                  </div>
                  <div className="space-y-2">
                    {categoryMetrics.map(m => (
                      <MetricCard
                        key={m.key}
                        metricKey={m.key}
                        entries={vitalsByMetric[m.key]}
                        athleteBirthday={athleteBirthday}
                        onOpenPost={(postId) => setLinkedPostId(postId)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Workouts — Edge Vitals session history ───────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-bold text-primary">Workouts</h3>
            {visibleWorkouts.length > 0 && (
              <p className="text-xs text-muted mt-0.5">
                {visibleWorkouts.length} session{visibleWorkouts.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>

        {visibleWorkouts.length === 0 && workouts.some(s => s.status === 'completed') ? (
          <div className="text-center py-12 border border-dashed border-border rounded-lg">
            <p className="text-sm text-tertiary">No workouts match your filters.</p>
          </div>
        ) : visibleWorkouts.length === 0 ? (
          <SectionEmptyState
            icon={Timer}
            title="No workouts recorded yet"
            body={isOwnProfile
              ? 'Hit Start Workout to record live — exercises, sets, reps, and weight as you go.'
              : "This athlete hasn't recorded workouts yet."}
            cta={isOwnProfile ? { label: 'Start Your First Workout', onClick: handleStartWorkout } : undefined}
          />
        ) : (
          <div className="space-y-5">
            {/* Month-grouped log — the training diary reads by month */}
            {visibleWorkouts.reduce<Array<{ month: string; sessions: ServerWorkoutSession[] }>>((groups, session) => {
              const month = new Date(session.started_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              const last = groups[groups.length - 1];
              if (last && last.month === month) last.sessions.push(session);
              else groups.push({ month, sessions: [session] });
              return groups;
            }, []).map(group => (
              <div key={group.month}>
                <h4 className="text-xs font-bold text-muted uppercase tracking-wide mb-2">{group.month}</h4>
                <div className="space-y-2">
                  {group.sessions.map(session => (
                    <WorkoutCard
                      key={session.id}
                      session={session}
                      onOpenPost={postId => setLinkedPostId(postId)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section B: Training Activity Feed ───────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-bold text-primary">Training Activity</h3>
            {visibleTrainingPosts.length > 0 && (
              <p className="text-xs text-muted mt-0.5">{visibleTrainingPosts.length} session{visibleTrainingPosts.length !== 1 ? 's' : ''} logged</p>
            )}
          </div>
          {isOwnProfile && (
            <button
              onClick={() => setShowCreatePost(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-border-strong text-secondary rounded-lg text-sm font-semibold hover:bg-surface-muted transition-colors"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Log Training
            </button>
          )}
        </div>

        {visibleTrainingPosts.length === 0 && trainingPosts.length > 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-lg">
            <p className="text-sm text-tertiary">No sessions match your filters.</p>
          </div>
        ) : trainingPosts.length === 0 ? (
          <SectionEmptyState
            icon={Dumbbell}
            title="No training activity logged yet"
            body="Share training sessions, workouts, and gym progress to build your development history. Workouts count even when you don't post."
            cta={isOwnProfile ? { label: 'Log First Session', onClick: () => setShowCreatePost(true) } : undefined}
          />
        ) : (
          <div className="space-y-4">
            {(showAllActivity ? visibleTrainingPosts : visibleTrainingPosts.slice(0, 3)).map(post => (
              <PostCard
                key={post.id}
                post={post as Parameters<typeof PostCard>[0]['post']}
                currentUserId={currentUserId}
              />
            ))}
            {!showAllActivity && visibleTrainingPosts.length > 3 && (
              <button
                onClick={() => setShowAllActivity(true)}
                className="ea-interactive w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-border text-sm font-semibold text-brand-fg-strong"
              >
                Show all {visibleTrainingPosts.length} posts
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            {showAllActivity && trainingPosts.length >= 20 && (
              <div className="text-center py-4">
                <p className="text-xs text-faint">Showing most recent 20 sessions</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────── */}
      <AddVitalModal
        isOpen={showAddVital}
        onClose={() => setShowAddVital(false)}
        onSaved={() => {
          setShowAddVital(false);
          fetchData();
        }}
      />

      {showVitalsSettings && currentVitals && (
        <VitalsSettingsModal
          currentVitals={currentVitals}
          onClose={() => setShowVitalsSettings(false)}
          onSaved={fetchData}
        />
      )}

      {showCreatePost && currentUserId && (
        <CreatePostModal
          isOpen={showCreatePost}
          onClose={() => setShowCreatePost(false)}
          userId={currentUserId}
          defaultSportKey="general"
          defaultPostCategory="training"
          onPostCreated={() => {
            setShowCreatePost(false);
            fetchData();
          }}
        />
      )}

      <PostDetailModal
        postId={linkedPostId}
        isOpen={linkedPostId !== null}
        onClose={() => setLinkedPostId(null)}
        currentUserId={currentUserId}
      />
    </div>
  );
}
