'use client';

import { SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BODY_METRIC_CATEGORIES } from '@/lib/body-metrics-config';
import { Plus, History, Ruler, Dumbbell, Loader2, ChevronDown, Settings, BarChart3, Lock, MapPin } from 'lucide-react';
import AddBodyMetricModal from './AddBodyMetricModal';
import CreatePostModal from './CreatePostModal';
import PostCard from './PostCard';
import PostDetailModal from './PostDetailModal';
import { useAuth } from '@/lib/auth';
import { formatHeight, formatWeightWithUnit, formatAge, parseDateLocal } from '@/lib/formatters';
import { latestPB } from '@/lib/workouts/dashboard';
import {
  mergeSessions,
  sessionsActiveDays,
  sessionsStreakWeeks,
  sessionsWeeklyBars,
  sessionsWeeklySummary,
  type ActivitySession,
} from '@/lib/training/sessions';
import { ACTIVITY_TYPE_DEFS, isActivityType } from '@/lib/activities/catalog';
import { formatDistance, readUnitPreference } from '@/lib/activities/format';
import ActivitiesTab from './activities/ActivitiesTab';
import { formatDuration } from '@/lib/workouts/summary';
import { useStartWorkout } from '@/hooks/useStartWorkout';
import TrainingHero from './training/TrainingHero';
import PBShowcase from './training/PBShowcase';
import ProgressSection from './training/ProgressSection';
import StatBubbleCard from './training/StatBubbleCard';
import MetricBubbleCard from './training/MetricBubbleCard';
import MetricDetailOverlay from './training/MetricDetailOverlay';
import WorkoutDetailOverlay from './training/WorkoutDetailOverlay';
import WeeklyActivityOverlay from './training/WeeklyActivityOverlay';
import BodyDetailOverlay from './training/BodyDetailOverlay';
import RoundedBarChart from './training/RoundedBarChart';
import TrainingSettingsModal from './training/TrainingSettingsModal';
import StartWorkoutSheet from './workouts/StartWorkoutSheet';
import WorkoutRoutinesModal from './workouts/WorkoutRoutinesModal';
import SectionEmptyState from './SectionEmptyState';
import { categoryAccent } from './training/category-colors';
import { useTheme } from '@/lib/use-theme';
import type { BodyMetricEntry } from './training/metric-stats';
import type { TrainingPrivacy } from '@/lib/training-privacy';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';

/** A9: a sport session's kind, as the row reads it. */
const SESSION_KIND_LABELS: Record<string, string> = { practice: 'Practice', game: 'Game', other: 'Other' };

// ── Types ──────────────────────────────────────────────────────────────────
// BodyMetricEntry moved to bodyMetrics/metric-stats.ts with the metric math.

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

interface TrainingTabProps {
  profileId: string;
  currentUserId?: string;
  isOwnProfile?: boolean;
  /** `?tab=activities` (the old tab's deep link): open Training AT its
   *  Activities section. */
  focusSection?: 'activities';
}

interface CurrentBodyMetrics {
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
const TRAINING_GEAR_CLASSES =
  'tr-pill items-center justify-center p-2.5 border border-border-strong text-secondary rounded-full hover:bg-surface-muted transition-colors';

// ── TrainingTab (main) ────────────────────────────────────────────────────────

export default function TrainingTab({ profileId, currentUserId, isOwnProfile = false, focusSection }: TrainingTabProps) {
  const router = useRouter();
  const { theme } = useTheme();
  // A body measurement also writes profiles.height_cm / weight_display — the
  // shared profile (Edit Profile, Settings → Account) must follow it.
  const { refreshProfile, profile: ownProfile } = useAuth();
  // Edit Profile's Body Metrics tab changes height / weight (and now adds the
  // timeline entry) from OUTSIDE this tab — reload when the owner's current
  // values change so the chart and Current Body Metrics follow without a reload.
  const ownBodyKey = isOwnProfile
    ? `${ownProfile?.height_cm ?? ''}|${ownProfile?.weight_display ?? ''}|${ownProfile?.weight_unit ?? ''}`
    : '';
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetricEntry[]>([]);
  const [trainingPosts, setTrainingPosts] = useState<TrainingPost[]>([]);
  const [workouts, setWorkouts] = useState<ServerWorkoutSession[]>([]);
  // Activities (runs, rides, swims recorded on the phone) are part of Training
  // since Oct 1 2026: they count in the week, the streak and the active
  // days. Their own gated read — "Only me" and the Training privacy aspect
  // are applied on the server.
  const [activitySessions, setActivitySessions] = useState<ActivitySession[]>([]);
  const [activitiesHidden, setActivitiesHidden] = useState(false);
  const [athleteBirthday, setAthleteBirthday] = useState<string | null>(null);
  const [currentBodyMetrics, setCurrentBodyMetrics] = useState<CurrentBodyMetrics | null>(null);
  const [heroProfile, setHeroProfile] = useState<HeroProfile | null>(null);
  const [trainingPrivacy, setTrainingPrivacy] = useState<TrainingPrivacy | null>(null);
  const [hiddenByPrivacy, setHiddenByPrivacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddBodyMetric, setShowAddBodyMetric] = useState(false);
  const [showTrainingSettings, setShowTrainingSettings] = useState(false);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [linkedPostId, setLinkedPostId] = useState<string | null>(null);
  const [metricOverlayKey, setMetricOverlayKey] = useState<string | null>(null);
  const [showWorkoutsOverlay, setShowWorkoutsOverlay] = useState(false);
  const [showActivityOverlay, setShowActivityOverlay] = useState(false);
  const [showBodyOverlay, setShowBodyOverlay] = useState(false);
  const [showRoutinesModal, setShowRoutinesModal] = useState(false);


  // Loader defined inside the effect and published on a ref — four handlers
  // refetch after a mutation (workout delete, bodyMetrics save, post create).
  const fetchDataRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const run = async () => {
        try {
          setError('');
          const [bodyMetricsRes, workoutsRes, activitiesRes] = await Promise.all([
            fetch(`/api/vitals?profileId=${profileId}`),
            fetch(`/api/workouts?profileId=${profileId}&limit=50`, { credentials: 'include' }),
            // A failure here costs the activities, never the tab.
            fetch(`/api/profile/${profileId}/activities?sessions=1`, { credentials: 'include', cache: 'no-store' }).catch(() => null),
          ]);
          if (!bodyMetricsRes.ok) {
            const data = await bodyMetricsRes.json();
            setError(data.error || 'Failed to load training');
            return;
          }
          const data = await bodyMetricsRes.json();
          setBodyMetrics(data.vitals || []);
          setTrainingPosts(data.trainingPosts || []);
          setAthleteBirthday(data.athleteBirthday || null);
          setCurrentBodyMetrics(data.currentVitals || null);
          setHeroProfile(data.profile || null);
          setTrainingPrivacy(data.vitalsPrivacy ?? null);
          setHiddenByPrivacy(Boolean(data.hidden));
          if (workoutsRes.ok) {
            const workoutData = await workoutsRes.json();
            setWorkouts(workoutData.sessions || []);
          }
          if (activitiesRes?.ok) {
            const activityData = await activitiesRes.json();
            setActivitySessions(Array.isArray(activityData.sessions) ? activityData.sessions : []);
            setActivitiesHidden(Boolean(activityData.hidden));
          } else {
            setActivitySessions([]);
            // A 404 is the activity gate's refusal (blocked, departed) — no section.
            setActivitiesHidden(activitiesRes?.status === 404);
          }
        } catch (e) {
          console.error('Failed to load training data:', e);
          setError('Failed to load training data');
        } finally {
          setLoading(false);
        }
    };
    fetchDataRef.current = run;
    run();
  }, [profileId, ownBodyKey]);

  // ONE start path, shared with the header's Create → Record Activity →
  // Start a workout (useStartWorkout, Oct 13 2026): the same POST, the same
  // 409 → resume, the same refreshDrafts(), the same screen.
  const {
    routines,
    refreshRoutines,
    starting: startingWorkout,
    showStartSheet,
    setShowStartSheet,
    start: handleStartWorkout,
    open: openStartWorkout,
  } = useStartWorkout(isOwnProfile);

  // Dashboard headline stats — all-time on purpose: the year filter now
  // lives inside the workouts overlay, and "this week" / PBs must never lie.
  const completedWorkouts = useMemo(
    () => workouts.filter(s => s.status === 'completed'),
    [workouts]
  );
  // Every session — completed workouts and activities — newest first.
  const sessions = useMemo(() => mergeSessions(workouts, activitySessions), [workouts, activitySessions]);
  const weekly = useMemo(() => sessionsWeeklySummary(sessions), [sessions]);
  const streak = useMemo(() => sessionsStreakWeeks(sessions), [sessions]);
  const activeDays = useMemo(() => sessionsActiveDays(sessions), [sessions]);
  const pbSpotlight = useMemo(() => latestPB(bodyMetrics), [bodyMetrics]);
  const [showAllActivity, setShowAllActivity] = useState(false);

  // The weekly-activity bubble's bars — last 8 weeks, sessions per week.
  // Labels only on the first and current bars; more reads as clutter at
  // bubble size, and the overlay carries the full detail.
  const activityBars = useMemo(
    () =>
      sessionsWeeklyBars(sessions, 8).map((bar, i, all) => {
        const label = parseDateLocal(bar.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return {
          label: i === 0 || i === all.length - 1 ? label : '',
          value: bar.workouts,
          highlight: bar.isCurrent,
          meta: `Week of ${label} — ${bar.workouts} session${bar.workouts !== 1 ? 's' : ''}`,
        };
      }),
    [sessions]
  );

  // The bubble shows the top of the diary, whichever kind it is.
  const recentSessions = sessions.slice(0, 3);
  const [unit] = useState(() => (typeof window === 'undefined' ? 'km' : readUnitPreference()));
  const scrollToActivities = () =>
    document.getElementById('training-activities')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // `?tab=activities` lands on the Activities section once it has rendered
  // (it loads its own page; a couple of frames is not enough on a slow link).
  useEffect(() => {
    if (focusSection !== 'activities' || loading) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById('training-activities');
      tries += 1;
      if (el) el.scrollIntoView({ block: 'start' });
      if (el || tries > 40) clearInterval(timer);
    }, 150);
    return () => clearInterval(timer);
  }, [focusSection, loading]);

  // Group bodyMetrics by metric key (all-time — bubbles never lie either)
  const bodyMetricsByMetric: Record<string, BodyMetricEntry[]> = {};
  for (const entry of bodyMetrics) {
    if (!bodyMetricsByMetric[entry.metric_key]) bodyMetricsByMetric[entry.metric_key] = [];
    bodyMetricsByMetric[entry.metric_key].push(entry);
  }

  const totalMetrics = Object.keys(bodyMetricsByMetric).length;

  // Height/weight for the hero — pre-formatted, null when unset (or privacy-
  // hidden for a non-owner, since currentBodyMetrics is API-gated). Both null → the
  // hero falls back to the greeting. Mirrors the Body metrics bubble formatting.
  const heroHeightDisplay = currentBodyMetrics?.heightCm != null ? formatHeight(currentBodyMetrics.heightCm) : null;
  const heroWeightDisplay = currentBodyMetrics
    ? (currentBodyMetrics.weightDisplay != null && currentBodyMetrics.weightUnit
        ? `${currentBodyMetrics.weightDisplay} ${currentBodyMetrics.weightUnit}`
        : currentBodyMetrics.weightKg != null
          ? formatWeightWithUnit(currentBodyMetrics.weightKg, currentBodyMetrics.weightUnit)
          : null)
    : null;

  // Tap a hero value → its progress overlay when there's dated history; with no
  // entries yet, an owner is sent to the editor to log the first one.
  const openBodyMetric = (key: 'height' | 'weight') => {
    if (bodyMetricsByMetric[key]?.length) setMetricOverlayKey(key);
    else if (isOwnProfile) setShowTrainingSettings(true);
  };

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

  // Training privacy: the athlete elected to keep this section to themselves.
  // A friendly lock, not an error — the rest of the profile stays open.
  if (hiddenByPrivacy && !isOwnProfile) {
    return (
      <div className="tr-scope">
        <h2 className="text-h2 text-primary">Training</h2>
        <div className="mt-6">
          <SectionEmptyState
            icon={Lock}
            title="Your training is private"
            body="This athlete keeps their training numbers to themselves."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="tr-scope space-y-8">
      {/* ── Training header + workout actions ─────────────────────── */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-h2 text-primary">Training</h2>
              <p className="text-sm text-muted mt-0.5">
                Workouts, activities, body metrics, and training history.
              </p>
            </div>
            {/* Section-wide quick settings (body measurements + workout
                routines). The form seeds from currentBodyMetrics when present and
                from an empty snapshot when not — routines must stay reachable
                either way. Two placements, one visible at a time: on phones
                the action cluster stacks BELOW the heading, so the gear sits
                up here on the heading line instead; ≥sm it rides the cluster. */}
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => setShowTrainingSettings(true)}
                aria-label="Training settings"
                title="Training settings"
                className={`${TRAINING_GEAR_CLASSES} flex sm:hidden`}
              >
                <Settings className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
          </div>
          {isOwnProfile && (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={openStartWorkout}
                disabled={startingWorkout}
                className="tr-pill flex items-center gap-2 min-h-[44px] px-5 bg-brand text-white rounded-full font-bold text-sm hover:bg-brand-hover transition-colors shadow-sm disabled:opacity-60"
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
                className="tr-pill flex items-center gap-1.5 min-h-[44px] px-5 border border-border-strong text-secondary rounded-full font-semibold text-sm hover:bg-surface-muted hover:text-primary transition-colors"
              >
                <History className="w-3.5 h-3.5" aria-hidden="true" />
                Log Past Workout
              </button>
              <button
                onClick={() => router.push('/activities/record')}
                className="tr-pill flex items-center gap-1.5 min-h-[44px] px-5 border border-border-strong text-secondary rounded-full font-semibold text-sm hover:bg-surface-muted hover:text-primary transition-colors"
                data-training-record-activity
              >
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                Record Activity
              </button>
              <button
                type="button"
                onClick={() => setShowTrainingSettings(true)}
                aria-label="Training settings"
                title="Training settings"
                className={`${TRAINING_GEAR_CLASSES} hidden sm:flex`}
              >
                <Settings className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* Live Activities: a recording this phone did not finish */}

      </div>

      {/* ── Hero: greeting, active-days ring, this week, streak, latest PB —
             always all-time-true ─────────────────────────────────────────── */}
      <TrainingHero
        profile={heroProfile}
        isOwnProfile={isOwnProfile}
        summary={weekly}
        streak={streak}
        activeDays={activeDays}
        pb={pbSpotlight}
        heightDisplay={heroHeightDisplay}
        weightDisplay={heroWeightDisplay}
        onOpenMetric={openBodyMetric}
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
            ariaLabel="Sessions per week, last 8 weeks"
          />
        </StatBubbleCard>

        {recentSessions.length > 0 ? (
          <StatBubbleCard
            span="md"
            icon={Dumbbell}
            label="Recent sessions"
            // The whole card is one button: the workout diary when there is
            // one, else the Activities section further down.
            onOpen={() => (completedWorkouts.length > 0 ? setShowWorkoutsOverlay(true) : scrollToActivities())}
            staggerIndex={1}
          >
            <div className="space-y-2" data-training-recent-sessions>
              {recentSessions.map(session => {
                const def = session.kind === 'activity' && isActivityType(session.activityType) ? ACTIVITY_TYPE_DEFS[session.activityType] : null;
                // A9: a sport session wears its sport — "Soccer · Practice".
                const sport = session.sportKey && session.sportKey in SPORT_REGISTRY ? SPORT_REGISTRY[session.sportKey as SportKey] : null;
                const sportLine = sport ? [sport.display_name, session.sessionKind ? SESSION_KIND_LABELS[session.sessionKind] : null].filter(Boolean).join(' · ') : null;
                return (
                  <div key={`${session.kind}:${session.id}`} className="flex items-center justify-between gap-2 text-sm" data-session-kind={session.kind}>
                    <span className="flex min-w-0 items-center gap-2 font-semibold text-primary">
                      <i className={`${sport ? sport.icon_id : `fas fa-${def ? def.icon : 'dumbbell'}`} w-4 shrink-0 text-center text-xs text-muted`} aria-hidden="true" />
                      {/* A sport session's sport sits under its name: side by side, both truncate at 375 px. */}
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{session.title}</span>
                        {sportLine && <span className="truncate text-xs font-normal text-muted" data-session-sport={session.sportKey}>{sportLine}</span>}
                      </span>
                    </span>
                    <span className="text-xs text-muted whitespace-nowrap shrink-0">
                      {new Date(session.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {session.kind === 'activity' && session.distanceM ? <> · {formatDistance(session.distanceM, unit)}</> : null}
                      {session.seconds > 0 && <> · {formatDuration(session.seconds)}</>}
                      {session.sourceName && <> · {session.sourceName}</>}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-xs font-bold text-brand-fg-strong">
              {completedWorkouts.length > 0
                ? `See all ${completedWorkouts.length} workout${completedWorkouts.length !== 1 ? 's' : ''}`
                : 'See activities'}
            </div>
          </StatBubbleCard>
        ) : (
          <StatBubbleCard span="md" icon={Dumbbell} label="Recent sessions" staggerIndex={1}>
            <p className="text-sm text-muted mb-3">
              {isOwnProfile
                ? 'Record live — exercises, sets, reps, and weight as you go.'
                : "This athlete hasn't recorded a session yet."}
            </p>
            {isOwnProfile && (
              <button
                onClick={openStartWorkout}
                disabled={startingWorkout}
                className="tr-pill px-4 py-2 bg-brand text-white rounded-full text-xs font-bold hover:bg-brand-hover transition-colors disabled:opacity-60"
              >
                Start Your First Workout
              </button>
            )}
          </StatBubbleCard>
        )}

        {/* Owners update height/weight via the header gear (each save also
            appends a dated timeline entry); DOB stays an Edit Profile job and
            shows only inside the owner's detail overlay. */}
        {currentBodyMetrics && (
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
                <div className="text-xl sm:text-2xl font-bold text-primary mb-0.5">{formatHeight(currentBodyMetrics.heightCm)}</div>
                <div className="text-xs text-muted uppercase tracking-wide">Height</div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold text-primary mb-0.5">
                  {currentBodyMetrics.weightDisplay && currentBodyMetrics.weightUnit
                    ? `${currentBodyMetrics.weightDisplay} ${currentBodyMetrics.weightUnit}`
                    : formatWeightWithUnit(currentBodyMetrics.weightKg, currentBodyMetrics.weightUnit)}
                </div>
                <div className="text-xs text-muted uppercase tracking-wide">Weight</div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl font-bold text-primary mb-0.5">{formatAge(currentBodyMetrics.dob)}</div>
                <div className="text-xs text-muted uppercase tracking-wide">Age</div>
              </div>
            </div>
          </StatBubbleCard>
        )}
      </div>

      {/* ── Personal bests — the trophy wall (each trophy opens its metric) */}
      <PBShowcase bodyMetrics={bodyMetrics} onOpenMetric={key => setMetricOverlayKey(key)} />

      {/* ── Progress — one big chart, pick what to track ─────────────── */}
      <ProgressSection bodyMetrics={bodyMetrics} sessions={completedWorkouts} />

      {/* ── Activities — runs, rides, swims recorded on the phone. Its own
             gated fetch (routes are trimmed for a viewer, "Only me" is the
             owner's); hidden with the Workouts privacy aspect. ─────────── */}
      {!activitiesHidden && <ActivitiesTab profileId={profileId} />}

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
              onClick={() => setShowAddBodyMetric(true)}
              className="tr-pill flex items-center gap-1.5 px-4 py-2 bg-brand text-white rounded-full text-sm font-semibold hover:bg-brand-hover transition-colors"
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
            cta={isOwnProfile ? { label: 'Add First Metric', onClick: () => setShowAddBodyMetric(true) } : undefined}
          />
        ) : (
          <div className="space-y-6">
            {BODY_METRIC_CATEGORIES.map(category => {
              const categoryMetrics = category.metrics.filter(
                m => bodyMetricsByMetric[m.key] && bodyMetricsByMetric[m.key].length > 0
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
                        entries={bodyMetricsByMetric[m.key]}
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
              className="tr-pill flex items-center gap-1.5 px-4 py-2 border border-border-strong text-secondary rounded-full text-sm font-semibold hover:bg-surface-muted transition-colors"
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
                className="ea-interactive tr-pill w-full flex items-center justify-center gap-2 py-3 rounded-full border border-border text-sm font-semibold text-brand-fg-strong"
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
      <AddBodyMetricModal
        isOpen={showAddBodyMetric}
        onClose={() => setShowAddBodyMetric(false)}
        onSaved={() => {
          setShowAddBodyMetric(false);
          fetchDataRef.current();
          if (isOwnProfile) void refreshProfile();
        }}
      />

      {showTrainingSettings && (
        <TrainingSettingsModal
          currentBodyMetrics={currentBodyMetrics ?? { heightCm: null, weightDisplay: null, weightUnit: null }}
          trainingPrivacy={trainingPrivacy}
          onClose={() => setShowTrainingSettings(false)}
          onSaved={() => {
            fetchDataRef.current();
            if (isOwnProfile) void refreshProfile();
          }}
          onManageRoutines={() => {
            setShowTrainingSettings(false);
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
      {metricOverlayKey && bodyMetricsByMetric[metricOverlayKey] && (
        <MetricDetailOverlay
          metricKey={metricOverlayKey}
          entries={bodyMetricsByMetric[metricOverlayKey]}
          athleteBirthday={athleteBirthday}
          onOpenPost={postId => setLinkedPostId(postId)}
          onClose={() => setMetricOverlayKey(null)}
          // Own-profile body metrics get an Update button → the bodyMetrics editor
          // (each save also appends a dated timeline entry).
          onEdit={
            isOwnProfile && (metricOverlayKey === 'height' || metricOverlayKey === 'weight')
              ? () => { setMetricOverlayKey(null); setShowTrainingSettings(true); }
              : undefined
          }
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
          sessions={sessions}
          onClose={() => setShowActivityOverlay(false)}
        />
      )}

      {showBodyOverlay && (
        <BodyDetailOverlay
          currentBodyMetrics={currentBodyMetrics}
          bodyMetrics={bodyMetrics}
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
