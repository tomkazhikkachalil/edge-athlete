'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  VITAL_CATEGORIES,
  VITAL_METRICS_MAP,
  getAgeAtDate,
  getVitalDisplayValue,
  getYearsTracked,
  getTrendArrow,
  formatSecondsToDisplay,
} from '@/lib/vitals-config';
import AddVitalModal from './AddVitalModal';
import CreatePostModal from './CreatePostModal';
import PostCard from './PostCard';
import PostDetailModal from './PostDetailModal';
import FilterBar from './filters/FilterBar';
import MultiSelectDropdown from './filters/MultiSelectDropdown';
import { deriveYearOptions, matchesYearFilter } from '@/lib/profile-filters';

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
  const trendColor = trend === '▲' ? 'text-emerald-600' : trend === '▼' ? 'text-red-500' : 'text-gray-400';

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
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Card header — clickable to expand/collapse */}
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-gray-700">{metric.label}</span>
              <span className="text-xs text-gray-400">{metric.unit}</span>
              {trend !== '—' && (
                <span className={`text-xs font-bold ${trendColor}`}>{trend}</span>
              )}
            </div>

            {/* Current value — prominent */}
            <div className="text-2xl font-bold text-gray-900 mb-1">
              {formatEntryValue(latest)}
            </div>

            {/* PB badge */}
            {isCurrentBest ? (
              <div className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full mb-2">
                <i className="fas fa-star text-amber-500" style={{ fontSize: '9px' }}></i>
                Personal Best
              </div>
            ) : best.value !== null && (
              <div className="text-xs text-gray-500 mb-2">
                PB: <span className="font-semibold">{formatEntryValue(best)}</span>
                <span className="text-gray-400 ml-1">({new Date(best.recorded_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})</span>
              </div>
            )}

            {/* First recorded + progression */}
            {sorted.length >= 2 && (
              <div className="text-xs text-gray-500">
                First: <span className="font-medium">{formatEntryValue(first)}</span>
                {athleteBirthday && (
                  <span className="text-gray-400 ml-1">· {getAgeAtDate(athleteBirthday, first.recorded_at)}</span>
                )}
                {deltaText && (
                  <span className={`ml-2 font-medium ${
                    metric.lower_is_better !== null
                      ? (latest.value! < first.value!) === metric.lower_is_better
                        ? 'text-emerald-600'
                        : 'text-red-500'
                      : 'text-gray-600'
                  }`}>{deltaText}</span>
                )}
              </div>
            )}

            {/* Years tracked */}
            {yearsTracked && (
              <div className="text-xs text-gray-400 mt-0.5">{yearsTracked}</div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="text-xs text-gray-400">
              {new Date(latest.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <i className={`fas fa-chevron-${expanded ? 'up' : 'down'} text-xs text-gray-400`}></i>
          </div>
        </div>
      </button>

      {/* Inline history panel */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50">
          <div className="px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">History</p>
            {years.map(year => (
              <div key={year} className="mb-4 last:mb-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-gray-700">{year}</span>
                  {year === oldestYear && (
                    <span className="text-xs text-gray-400">· First recorded</span>
                  )}
                </div>
                <div className="space-y-2">
                  {byYear[year].map(entry => (
                    <div key={entry.id} className="flex items-start justify-between text-sm py-2 px-3 bg-white rounded-lg border border-gray-100">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{formatEntryValue(entry)}</span>
                          {entry.id === best.id && (
                            <span className="text-xs text-amber-600 font-medium">
                              <i className="fas fa-star text-amber-500 mr-0.5" style={{ fontSize: '9px' }}></i>PB
                            </span>
                          )}
                          {athleteBirthday && (
                            <span className="text-xs text-gray-400">{getAgeAtDate(athleteBirthday, entry.recorded_at)}</span>
                          )}
                          {entry.source !== 'manual' && (
                            <span className="text-xs text-blue-500">{entry.source}</span>
                          )}
                        </div>
                        {entry.notes && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{entry.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <span className="text-xs text-gray-400">
                          {new Date(entry.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        {entry.linked_post_id && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onOpenPost(entry.linked_post_id!); }}
                            className="text-violet-500 hover:text-violet-700 transition-colors"
                            title="View media post"
                          >
                            <i className="fas fa-camera text-xs"></i>
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
  const [vitals, setVitals] = useState<VitalEntry[]>([]);
  const [trainingPosts, setTrainingPosts] = useState<TrainingPost[]>([]);
  const [athleteBirthday, setAthleteBirthday] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddVital, setShowAddVital] = useState(false);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [linkedPostId, setLinkedPostId] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const res = await fetch(`/api/vitals?profileId=${profileId}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to load vitals');
        return;
      }
      const data = await res.json();
      setVitals(data.vitals || []);
      setTrainingPosts(data.trainingPosts || []);
      setAthleteBirthday(data.athleteBirthday || null);
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
        <i className="fas fa-spinner fa-spin text-gray-400 text-2xl"></i>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-16 text-center text-gray-500">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
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
            <h3 className="text-base font-bold text-gray-900">Performance Metrics</h3>
            {totalMetrics > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">{totalMetrics} metric{totalMetrics !== 1 ? 's' : ''} tracked</p>
            )}
          </div>
          {isOwnProfile && (
            <button
              onClick={() => setShowAddVital(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors"
            >
              <i className="fas fa-plus text-xs"></i>
              Add Metric
            </button>
          )}
        </div>

        {totalMetrics === 0 && vitals.length > 0 ? (
          <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl">
            <p className="text-sm text-gray-600">No metrics match your filters.</p>
          </div>
        ) : totalMetrics === 0 ? (
          <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
              <i className="fas fa-ruler-vertical text-gray-400 text-xl"></i>
            </div>
            <h4 className="text-sm font-semibold text-gray-700 mb-1">No metrics recorded yet</h4>
            <p className="text-xs text-gray-500 max-w-xs mx-auto mb-4">
              Track physical development over time — speed, strength, conditioning, and body metrics.
            </p>
            {isOwnProfile && (
              <button
                onClick={() => setShowAddVital(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors"
              >
                <i className="fas fa-plus text-xs"></i>
                Add First Metric
              </button>
            )}
          </div>
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
                    <i className={`${category.icon} text-sm text-gray-500`}></i>
                    <h4 className="text-sm font-semibold text-gray-600">{category.label}</h4>
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

      {/* ── Section B: Training Activity Feed ───────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-bold text-gray-900">Training Activity</h3>
            {visibleTrainingPosts.length > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">{visibleTrainingPosts.length} session{visibleTrainingPosts.length !== 1 ? 's' : ''} logged</p>
            )}
          </div>
          {isOwnProfile && (
            <button
              onClick={() => setShowCreatePost(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors"
            >
              <i className="fas fa-plus text-xs"></i>
              Log Training
            </button>
          )}
        </div>

        {visibleTrainingPosts.length === 0 && trainingPosts.length > 0 ? (
          <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl">
            <p className="text-sm text-gray-600">No sessions match your filters.</p>
          </div>
        ) : trainingPosts.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
              <i className="fas fa-dumbbell text-gray-400 text-xl"></i>
            </div>
            <h4 className="text-sm font-semibold text-gray-700 mb-1">No training activity logged yet</h4>
            <p className="text-xs text-gray-500 max-w-xs mx-auto mb-4">
              Share training sessions, workouts, and gym progress to build your development history.
            </p>
            {isOwnProfile && (
              <button
                onClick={() => setShowCreatePost(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors"
              >
                <i className="fas fa-plus text-xs"></i>
                Log First Session
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {visibleTrainingPosts.map(post => (
              <PostCard
                key={post.id}
                post={post as Parameters<typeof PostCard>[0]['post']}
                currentUserId={currentUserId}
              />
            ))}
            {trainingPosts.length >= 20 && (
              <div className="text-center py-4">
                <p className="text-xs text-gray-400">Showing most recent 20 sessions</p>
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

      {showCreatePost && currentUserId && (
        <CreatePostModal
          isOpen={showCreatePost}
          onClose={() => setShowCreatePost(false)}
          userId={currentUserId}
          defaultSportKey="training"
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
