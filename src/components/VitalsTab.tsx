'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { VITAL_CATEGORIES } from '@/lib/vitals-config';
import {
  Plus, History, Ruler, Dumbbell, Loader2, ChevronDown, Settings, BarChart3, Lock,
} from 'lucide-react';
import AddVitalModal from './AddVitalModal';
import CreatePostModal from './CreatePostModal';
import PostCard from './PostCard';
import PostDetailModal from './PostDetailModal';
import { useToast } from './Toast';
import { formatHeight, formatWeightWithUnit, formatAge, parseDateLocal } from '@/lib/formatters';
import { effectiveSessionStatus } from '@/lib/workouts/status';
import { weeklySummary, streakWeeks, latestPB, sessionSeconds } from '@/lib/workouts/dashboard';
import { activeDaysThisWeek, weeklyBars } from '@/lib/vitals/derive';
import { formatDuration } from '@/lib/workouts/summary';
import VitalsHero from './vitals/VitalsHero';
import PBShowcase from './vitals/PBShowcase';
import ProgressSection from './vitals/ProgressSection';
import StatBubbleCard from './vitals/StatBubbleCard';
import MetricBubbleCard from './vitals/MetricBubbleCard';
import MetricDetailOverlay from './vitals/MetricDetailOverlay';
import WorkoutDetailOverlay from './vitals/WorkoutDetailOverlay';
import WeeklyActivityOverlay from './vitals/WeeklyActivityOverlay';
import BodyDetailOverlay from './vitals/BodyDetailOverlay';
import RoundedBarChart from './vitals/RoundedBarChart';
import VitalsSettingsModal from './vitals/VitalsSettingsModal';
import StartWorkoutSheet from './workouts/StartWorkoutSheet';
import WorkoutRoutinesModal from './workouts/WorkoutRoutinesModal';
import SectionEmptyState from './SectionEmptyState';
import { categoryAccent } from './vitals/category-colors';
import { useTheme } from '@/lib/use-theme';
import type { VitalEntry } from './vitals/metric-stats';
import type { VitalsPrivacy } from '@/lib/vitals-privacy';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';
import type { WorkoutRoutine } from '@/lib/workouts/routines';

// ── Types ──────────────────────────────────────────────────────────────────
// VitalEntry moved to vitals/metric-stats.ts with the metric math.

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

interface HeroProfile {
  firstName: string | null;
  avatarUrl: string | null;
}

// Shared look for the two responsive placements of the settings gear.
// Display classes (flex/hidden) stay per-instance — a display value in a
// shared string is the .ea-icon-btn lg:hidden trap.
const VITALS_GEAR_CLASSES =
  'vt-pill items-center justify-center p-2.5 border border-border-strong text-secondary rounded-full hover:bg-surface-muted transition-colors';

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
  const [heroProfile, setHeroProfile] = useState<HeroProfile | null>(null);
  const [vitalsPrivacy, setVitalsPrivacy] = useState<VitalsPrivacy | null>(null);
  const [hiddenByPrivacy, setHiddenByPrivacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddVital, setShowAddVital] = useState(false);
  const [showVitalsSettings, setShowVitalsSettings] = useState(false);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [linkedPostId, setLinkedPostId] = useState<string | null>(null);
  const [metricOverlayKey, setMetricOverlayKey] = useState<string | null>(null);
  const [showWorkoutsOverlay, setShowWorkoutsOverlay] = useState(false);
  const [showActivityOverlay, setShowActivityOverlay] = useState(false);
  const [showBodyOverlay, setShowBodyOverlay] = useState(false);
  const [startingWorkout, setStartingWorkout] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [routines, setRoutines] = useState<WorkoutRoutine[]>([]);
  const [showStartSheet, setShowStartSheet] = useState(false);
  const [showRoutinesModal, setShowRoutinesModal] = useState(false);


  // Loader defined inside the effect and published on a ref — four handlers
  // refetch after a mutation (workout delete, vitals save, post create).
  const fetchDataRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const run = async () => {
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
          setHeroProfile(data.profile || null);
          setVitalsPrivacy(data.vitalsPrivacy ?? null);
          setHiddenByPrivacy(Boolean(data.hidden));
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
    };
    fetchDataRef.current = run;
    run();
  }, [profileId]);

  // Saved routines feed the Start Workout picker — owner only, and a failure
  // just degrades to the plain one-tap start. Inlined cancellable IIFE (not a
  // callback call) so it stays out of the set-state-in-effect warning list;
  // event handlers refresh by bumping routinesReload.
  const [routinesReload, setRoutinesReload] = useState(0);
  useEffect(() => {
    if (!isOwnProfile) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/workout-routines', { credentials: 'include' });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setRoutines(data.routines ?? []);
      } catch {
        /* keep whatever we had */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwnProfile, routinesReload]);
  const refreshRoutines = () => setRoutinesReload(k => k + 1);

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

  // Effect-owned deliberately: per-session dismissal lives in sessionStorage,
  // and it re-reads per workout id, so it cannot move into render.
  useEffect(() => {
    if (!activeWorkout) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBannerDismissed(
        sessionStorage.getItem(`ea:workout-banner-dismissed:${activeWorkout.id}`) === '1'
      );
    } catch {
      setBannerDismissed(false);
    }
  }, [activeWorkout]);

  const handleStartWorkout = async (routineId: string | null = null) => {
    if (startingWorkout) return;
    setStartingWorkout(true);
    try {
      const response = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: 'live', ...(routineId ? { routineId } : {}) }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 409 && data?.activeSessionId) {
        showError('Workout in progress', 'Resuming your workout in progress.');
        router.push(`/app/workout/${data.activeSessionId}`);
        return;
      }
      if (routineId && response.status === 404) {
        // Deleted between opening the sheet and tapping it
        showError('Routine not found', 'That routine no longer exists.');
        setShowStartSheet(false);
        refreshRoutines();
        setStartingWorkout(false);
        return;
      }
      if (!response.ok) throw new Error(data?.error || 'Failed to start workout');
      router.push(`/app/workout/${data.session.id}`);
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Failed to start workout');
      setStartingWorkout(false);
    }
  };

  // With saved routines the button opens the picker; without, one-tap start.
  const openStartWorkout = () => {
    if (routines.length > 0) setShowStartSheet(true);
    else handleStartWorkout();
  };

  // Dashboard headline stats — all-time on purpose: the year filter now
  // lives inside the workouts overlay, and "this week" / PBs must never lie.
  const completedWorkouts = useMemo(
    () => workouts.filter(s => s.status === 'completed'),
    [workouts]
  );
  const weekly = useMemo(() => weeklySummary(completedWorkouts), [completedWorkouts]);
  const streak = useMemo(() => streakWeeks(completedWorkouts), [completedWorkouts]);
  const activeDays = useMemo(() => activeDaysThisWeek(completedWorkouts), [completedWorkouts]);
  const pbSpotlight = useMemo(() => latestPB(vitals), [vitals]);
  const [showAllActivity, setShowAllActivity] = useState(false);

  // The weekly-activity bubble's bars — last 8 weeks, workouts per week.
  // Labels only on the first and current bars; more reads as clutter at
  // bubble size, and the overlay carries the full detail.
  const activityBars = useMemo(
    () =>
      weeklyBars(completedWorkouts, 8).map((bar, i, all) => {
        const label = parseDateLocal(bar.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return {
          label: i === 0 || i === all.length - 1 ? label : '',
          value: bar.workouts,
          highlight: bar.isCurrent,
          meta: `Week of ${label} — ${bar.workouts} workout${bar.workouts !== 1 ? 's' : ''}`,
        };
      }),
    [completedWorkouts]
  );

  // API order is newest-first; the bubble shows the top of the diary.
  const recentWorkouts = completedWorkouts.slice(0, 3);

  // Group vitals by metric key (all-time — bubbles never lie either)
  const vitalsByMetric: Record<string, VitalEntry[]> = {};
  for (const entry of vitals) {
    if (!vitalsByMetric[entry.metric_key]) vitalsByMetric[entry.metric_key] = [];
    vitalsByMetric[entry.metric_key].push(entry);
  }

  const totalMetrics = Object.keys(vitalsByMetric).length;

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

  // Vitals privacy: the athlete elected to keep this section to themselves.
  // A friendly lock, not an error — the rest of the profile stays open.
  if (hiddenByPrivacy && !isOwnProfile) {
    return (
      <div className="vt-scope">
        <h2 className="text-h2 text-primary">Edge Vitals</h2>
        <div className="mt-6">
          <SectionEmptyState
            icon={Lock}
            title="These vitals are private"
            body="This athlete keeps their training numbers to themselves."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="vt-scope space-y-8">
      {/* ── Edge Vitals header + workout actions ─────────────────────── */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-h2 text-primary">Edge Vitals</h2>
              <p className="text-sm text-muted mt-0.5">
                Live workouts, performance metrics, and training history.
              </p>
            </div>
            {/* Section-wide quick settings (body measurements + workout
                routines). The form seeds from currentVitals when present and
                from an empty snapshot when not — routines must stay reachable
                either way. Two placements, one visible at a time: on phones
                the action cluster stacks BELOW the heading, so the gear sits
                up here on the heading line instead; ≥sm it rides the cluster. */}
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => setShowVitalsSettings(true)}
                aria-label="Vitals settings"
                title="Vitals settings"
                className={`${VITALS_GEAR_CLASSES} flex sm:hidden`}
              >
                <Settings className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
          </div>
          {isOwnProfile && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={openStartWorkout}
                disabled={startingWorkout}
                className="vt-pill flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-full font-bold text-sm hover:bg-brand-hover transition-colors shadow-sm disabled:opacity-60"
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
                className="vt-pill flex items-center gap-1.5 px-5 py-2.5 border border-border-strong text-secondary rounded-full font-semibold text-sm hover:bg-surface-muted transition-colors"
              >
                <History className="w-3.5 h-3.5" aria-hidden="true" />
                Log Past Workout
              </button>
              <button
                type="button"
                onClick={() => setShowVitalsSettings(true)}
                aria-label="Vitals settings"
                title="Vitals settings"
                className={`${VITALS_GEAR_CLASSES} hidden sm:flex`}
              >
                <Settings className="w-5 h-5" aria-hidden="true" />
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

      {/* ── Hero: greeting, active-days ring, this week, streak, latest PB —
             always all-time-true ─────────────────────────────────────────── */}
      <VitalsHero
        profile={heroProfile}
        isOwnProfile={isOwnProfile}
        summary={weekly}
        streak={streak}
        activeDays={activeDays}
        pb={pbSpotlight}
      />

      {/* ── Bubble grid — tap a card for its larger window ───────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatBubbleCard
          span="md"
          icon={BarChart3}
          label="Weekly activity"
          onOpen={() => setShowActivityOverlay(true)}
          staggerIndex={0}
        >
          <RoundedBarChart
            bars={activityBars}
            color="var(--brand-fg)"
            height={72}
            ariaLabel="Workouts per week, last 8 weeks"
          />
        </StatBubbleCard>

        {recentWorkouts.length > 0 ? (
          <StatBubbleCard
            span="md"
            icon={Dumbbell}
            label="Recent workouts"
            onOpen={() => setShowWorkoutsOverlay(true)}
            staggerIndex={1}
          >
            <div className="space-y-2">
              {recentWorkouts.map(session => (
                <div key={session.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-primary truncate">{session.title || 'Workout'}</span>
                  <span className="text-xs text-muted whitespace-nowrap shrink-0">
                    {new Date(session.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {sessionSeconds(session) > 0 && <> · {formatDuration(sessionSeconds(session))}</>}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs font-bold text-brand-fg-strong">
              See all {completedWorkouts.length} workout{completedWorkouts.length !== 1 ? 's' : ''}
            </div>
          </StatBubbleCard>
        ) : (
          <StatBubbleCard span="md" icon={Dumbbell} label="Recent workouts" staggerIndex={1}>
            <p className="text-sm text-muted mb-3">
              {isOwnProfile
                ? 'Record live — exercises, sets, reps, and weight as you go.'
                : "This athlete hasn't recorded workouts yet."}
            </p>
            {isOwnProfile && (
              <button
                onClick={openStartWorkout}
                disabled={startingWorkout}
                className="vt-pill px-4 py-2 bg-brand text-white rounded-full text-xs font-bold hover:bg-brand-hover transition-colors disabled:opacity-60"
              >
                Start Your First Workout
              </button>
            )}
          </StatBubbleCard>
        )}

        {/* Owners update height/weight via the header gear (each save also
            appends a dated timeline entry); DOB stays an Edit Profile job and
            shows only inside the owner's detail overlay. */}
        {currentVitals && (
          <StatBubbleCard
            span="lg"
            icon={Ruler}
            iconClassName={categoryAccent('body').text}
            iconBgClassName={categoryAccent('body').chip}
            label="Body metrics"
            onOpen={() => setShowBodyOverlay(true)}
            staggerIndex={2}
          >
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold text-primary mb-0.5">{formatHeight(currentVitals.heightCm)}</div>
                <div className="text-xs text-muted uppercase tracking-wide">Height</div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold text-primary mb-0.5">
                  {currentVitals.weightDisplay && currentVitals.weightUnit
                    ? `${currentVitals.weightDisplay} ${currentVitals.weightUnit}`
                    : formatWeightWithUnit(currentVitals.weightKg, currentVitals.weightUnit)}
                </div>
                <div className="text-xs text-muted uppercase tracking-wide">Weight</div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold text-primary mb-0.5">{formatAge(currentVitals.dob)}</div>
                <div className="text-xs text-muted uppercase tracking-wide">Age</div>
              </div>
            </div>
          </StatBubbleCard>
        )}
      </div>

      {/* ── Personal bests — the trophy wall (each trophy opens its metric) */}
      <PBShowcase vitals={vitals} onOpenMetric={key => setMetricOverlayKey(key)} />

      {/* ── Progress — one big chart, pick what to track ─────────────── */}
      <ProgressSection vitals={vitals} sessions={completedWorkouts} />

      {/* ── Metrics library — bubbles by category; history behind a tap ── */}
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
              className="vt-pill flex items-center gap-1.5 px-4 py-2 bg-brand text-white rounded-full text-sm font-semibold hover:bg-brand-hover transition-colors"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Add Metric
            </button>
          )}
        </div>

        {totalMetrics === 0 ? (
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {categoryMetrics.map((m, i) => (
                      <MetricBubbleCard
                        key={m.key}
                        metricKey={m.key}
                        entries={vitalsByMetric[m.key]}
                        staggerIndex={i}
                        onOpen={() => setMetricOverlayKey(m.key)}
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
            <h3 className="text-base font-bold text-primary">Training Activity</h3>
            {trainingPosts.length > 0 && (
              <p className="text-xs text-muted mt-0.5">{trainingPosts.length} session{trainingPosts.length !== 1 ? 's' : ''} logged</p>
            )}
          </div>
          {isOwnProfile && (
            <button
              onClick={() => setShowCreatePost(true)}
              className="vt-pill flex items-center gap-1.5 px-4 py-2 border border-border-strong text-secondary rounded-full text-sm font-semibold hover:bg-surface-muted transition-colors"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Log Training
            </button>
          )}
        </div>

        {trainingPosts.length === 0 ? (
          <SectionEmptyState
            icon={Dumbbell}
            title="No training activity logged yet"
            body="Share training sessions, workouts, and gym progress to build your development history. Workouts count even when you don't post."
            cta={isOwnProfile ? { label: 'Log First Session', onClick: () => setShowCreatePost(true) } : undefined}
          />
        ) : (
          <div className="space-y-4">
            {(showAllActivity ? trainingPosts : trainingPosts.slice(0, 3)).map(post => (
              <PostCard
                key={post.id}
                post={post as Parameters<typeof PostCard>[0]['post']}
                currentUserId={currentUserId}
              />
            ))}
            {!showAllActivity && trainingPosts.length > 3 && (
              <button
                onClick={() => setShowAllActivity(true)}
                className="ea-interactive vt-pill w-full flex items-center justify-center gap-2 py-3 rounded-full border border-border text-sm font-semibold text-brand-fg-strong"
              >
                Show all {trainingPosts.length} posts
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
          fetchDataRef.current();
        }}
      />

      {showVitalsSettings && (
        <VitalsSettingsModal
          currentVitals={currentVitals ?? { heightCm: null, weightDisplay: null, weightUnit: null }}
          vitalsPrivacy={vitalsPrivacy}
          onClose={() => setShowVitalsSettings(false)}
          onSaved={() => fetchDataRef.current()}
          onManageRoutines={() => {
            setShowVitalsSettings(false);
            setShowRoutinesModal(true);
          }}
        />
      )}

      {showRoutinesModal && (
        <WorkoutRoutinesModal
          onClose={() => {
            setShowRoutinesModal(false);
            refreshRoutines();
          }}
        />
      )}

      {showStartSheet && (
        <StartWorkoutSheet
          routines={routines}
          starting={startingWorkout}
          onStart={routineId => handleStartWorkout(routineId)}
          onClose={() => setShowStartSheet(false)}
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
            fetchDataRef.current();
          }}
        />
      )}

      {/* ── Larger windows — one per bubble ──────────────────────────── */}
      {metricOverlayKey && vitalsByMetric[metricOverlayKey] && (
        <MetricDetailOverlay
          metricKey={metricOverlayKey}
          entries={vitalsByMetric[metricOverlayKey]}
          athleteBirthday={athleteBirthday}
          onOpenPost={postId => setLinkedPostId(postId)}
          onClose={() => setMetricOverlayKey(null)}
        />
      )}

      {showWorkoutsOverlay && (
        <WorkoutDetailOverlay
          sessions={completedWorkouts}
          isOwnProfile={isOwnProfile}
          onOpenPost={postId => setLinkedPostId(postId)}
          onEdit={id => router.push(`/app/workout/${id}`)}
          onShare={id => router.push(`/app/workout/${id}?share=1`)}
          onDeleted={id => {
            setWorkouts(ws => ws.filter(w => w.id !== id));
            fetchDataRef.current();
          }}
          onClose={() => setShowWorkoutsOverlay(false)}
        />
      )}

      {showActivityOverlay && (
        <WeeklyActivityOverlay
          sessions={completedWorkouts}
          onClose={() => setShowActivityOverlay(false)}
        />
      )}

      {showBodyOverlay && (
        <BodyDetailOverlay
          currentVitals={currentVitals}
          vitals={vitals}
          isOwnProfile={isOwnProfile}
          onOpenPost={postId => setLinkedPostId(postId)}
          onClose={() => setShowBodyOverlay(false)}
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
