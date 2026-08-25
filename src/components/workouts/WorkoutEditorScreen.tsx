'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Flag, MoreVertical, Plus, Timer, Trash2 } from 'lucide-react';
import ExerciseCard from './ExerciseCard';
import AddExerciseSheet from './AddExerciseSheet';
import { FinishSummary, ShareStep } from './FinishFlow';
import ConfirmModal from '../ConfirmModal';
import { useToast } from '../Toast';
import { MAX_EXERCISES, type EntryExercise } from '@/lib/workouts/entries';
import { entriesToRoutineExercises } from '@/lib/workouts/routines';
import {
  MANUAL_DRAFT_ID,
  clearDraft,
  readDraft,
  resolveEntries,
  writeDraft,
} from '@/lib/workouts/draft';
import {
  buildWorkoutStatsData,
  computeSummary,
  collectWorkoutMedia,
  formatElapsed,
  MAX_POST_MEDIA,
} from '@/lib/workouts/summary';
import { detectPRs, type PRCandidate } from '@/lib/workouts/pr-detection';
import { serverToEntries, type ServerWorkoutSession } from '@/lib/workouts/serialize';
import { localDayKey } from '@/lib/calendar/grid';

type Phase = 'editing' | 'summary' | 'share';

const SYNC_DEBOUNCE_MS = 2000;
const KEEPALIVE_BODY_LIMIT = 60_000; // fetch keepalive shares a 64KiB in-flight cap

interface WorkoutEditorScreenProps {
  /** live = active session with ticking timer; manual = backdated log (no
   *  server row until Save); review = a COMPLETED session reopened to edit
   *  (static duration, Done never re-finishes, share offered if unshared). */
  mode: 'live' | 'manual' | 'review';
  /** Required for live/review mode; the loaded session. */
  session?: ServerWorkoutSession;
  currentUserId: string;
  /** review only: 'share' deep-links straight to the share step (?share=1). */
  initialPhase?: 'editing' | 'share';
}

export default function WorkoutEditorScreen({ mode, session, currentUserId, initialPhase }: WorkoutEditorScreenProps) {
  const router = useRouter();
  const { showSuccess, showError } = useToast();

  // live + review both edit a persisted server session (draft keyed by id,
  // debounced entries PUT); manual is client-local until its one atomic POST.
  const isServerSession = mode !== 'manual';
  const draftId = isServerSession ? session!.id : MANUAL_DRAFT_ID;

  // ── Editor state (source of truth while editing) ─────────────────────────
  const [initial] = useState(() => {
    const draft = readDraft(draftId);
    if (isServerSession && session) {
      return resolveEntries(serverToEntries(session), Date.parse(session.updated_at), draft);
    }
    // Manual: no server copy — any draft wins
    return {
      exercises: draft?.exercises ?? [],
      title: draft?.title ?? null,
      fromDraft: draft !== null && (draft.exercises.length > 0 || !!draft.title),
    };
  });
  const [exercises, setExercises] = useState<EntryExercise[]>(initial.exercises);
  const [title, setTitle] = useState<string>(initial.title ?? session?.title ?? '');
  const [phase, setPhase] = useState<Phase>(
    mode === 'review' && initialPhase === 'share' ? 'share' : 'editing'
  );
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Manual-mode fields
  const [manualDate, setManualDate] = useState(() => localDayKey(new Date()));
  const [manualDurationMin, setManualDurationMin] = useState<number | ''>('');

  // Post-finish state
  const [finishedSessionId, setFinishedSessionId] = useState<string | null>(
    session?.status === 'completed' ? session.id : null
  );
  const [finishedDuration, setFinishedDuration] = useState<number>(session?.duration_seconds ?? 0);
  const [prCandidates, setPrCandidates] = useState<PRCandidate[]>([]);
  const [checkedPRs, setCheckedPRs] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<Set<number>>(new Set());

  // Save-as-routine (summary phase). Name is null until the user types, so
  // the input tracks the final title without an effect.
  const [routineName, setRoutineName] = useState<string | null>(null);
  const [routineSaving, setRoutineSaving] = useState(false);
  const [routineSaved, setRoutineSaved] = useState(false);
  const [routineError, setRoutineError] = useState('');

  // ── Live timer (derived from started_at, never counted) ─────────────────
  // The tick stores the TIMESTAMP, not a throwaway counter: reading Date.now()
  // during render is impure (react-hooks/purity) and makes the displayed time
  // depend on whenever React happens to re-render. Now the rendered value is
  // exactly the ticked value.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (mode !== 'live' || phase !== 'editing') return;
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mode, phase]);

  const elapsedSeconds =
    mode === 'live' && session ? Math.floor((now - Date.parse(session.started_at)) / 1000) : 0;

  // Rest indicator: seconds since the most recent completed set
  const lastCompletedMs = useMemo(() => {
    let latest = 0;
    for (const exercise of exercises) {
      for (const set of exercise.sets) {
        if (set.completedAt) latest = Math.max(latest, Date.parse(set.completedAt));
      }
    }
    return latest;
  }, [exercises]);
  const restSeconds = lastCompletedMs > 0 ? Math.floor((now - lastCompletedMs) / 1000) : null;

  // ── Server sync engine (live mode): debounced single-flight PUT ──────────
  // Latest exercises/title for the async sync + draft writers below. Written
  // in an effect, never during render (react-hooks/refs).
  const stateRef = useRef({ exercises, title });
  useEffect(() => {
    stateRef.current = { exercises, title };
  }, [exercises, title]);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncState, setSyncState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const syncNow = useCallback(async (): Promise<boolean> => {
    if (!isServerSession || !session) return true;
    if (inFlightRef.current) {
      pendingRef.current = true;
      return true;
    }
    inFlightRef.current = true;
    try {
      // Loops instead of recursing. An edit that lands mid-flight sets
      // pendingRef, and we re-send from here rather than calling syncNow()
      // again — that self-reference is what stopped React Compiler preserving
      // this memoization. The flag is now held for the whole chain, so this is
      // a true single-flight, and the returned value is the LAST attempt's
      // result rather than the first's.
      let ok = true;
      for (;;) {
        setSyncState('saving');
        try {
          const response = await fetch(`/api/workouts/${session.id}/entries`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ savedAt: Date.now(), exercises: stateRef.current.exercises }),
          });
          ok = response.ok;
          setSyncState(ok ? 'saved' : 'error');
        } catch {
          setSyncState('error');
          ok = false;
        }
        if (!pendingRef.current) break;
        pendingRef.current = false;
      }
      return ok;
    } finally {
      inFlightRef.current = false;
    }
  }, [isServerSession, session]);

  const scheduleSync = useCallback(() => {
    if (!isServerSession) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void syncNow(), SYNC_DEBOUNCE_MS);
  }, [isServerSession, syncNow]);

  // Keepalive flush on pagehide / tab-hide (belt = draft, suspenders = this)
  const flushRef = useRef<() => void>(() => {});
  useEffect(() => {
    flushRef.current = () => {
      if (!isServerSession || !session || phase !== 'editing') return;
      const body = JSON.stringify({ savedAt: Date.now(), exercises: stateRef.current.exercises });
      if (body.length > KEEPALIVE_BODY_LIMIT) return; // draft covers; next debounce syncs
      fetch(`/api/workouts/${session.id}/entries`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        body,
      }).catch(() => {});
    };
  });
  useEffect(() => {
    const flush = () => flushRef.current();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Draft-restored state: reconcile to the server immediately
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    reconciledRef.current = true;
    if (initial.fromDraft) {
      showSuccess('Restored', 'Unsaved sets were restored');
      if (isServerSession) void syncNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mutations: state → draft (always) → debounced sync (live) ────────────
  const mutate = useCallback(
    (next: EntryExercise[], nextTitle?: string) => {
      setExercises(next);
      const t = nextTitle !== undefined ? nextTitle : stateRef.current.title;
      writeDraft(draftId, { title: t || null, exercises: next });
      scheduleSync();
    },
    [draftId, scheduleSync]
  );

  const updateTitle = (next: string) => {
    setTitle(next);
    writeDraft(draftId, { title: next || null, exercises: stateRef.current.exercises });
    // Title persists via the finish PATCH / manual POST — no entries sync needed
  };

  // ── Finish flows ─────────────────────────────────────────────────────────
  const loadPRs = async (finalExercises: EntryExercise[]) => {
    try {
      const response = await fetch(`/api/vitals?profileId=${currentUserId}`, { credentials: 'include' });
      const data = response.ok ? await response.json() : { vitals: [] };
      const candidates = detectPRs(finalExercises, data.vitals || []);
      setPrCandidates(candidates);
      setCheckedPRs(new Set(candidates.map(c => c.metricKey)));
    } catch {
      setPrCandidates([]);
    }
  };

  const finishLive = async () => {
    if (!session || finishing) return;
    setFinishing(true);
    try {
      const flushed = await syncNow();
      if (!flushed) throw new Error('Could not save your sets — check your connection and try again.');
      const response = await fetch(`/api/workouts/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: title || null,
          finish: { endedAt: new Date().toISOString() },
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to finish workout');
      }
      const data = await response.json();
      clearDraft(draftId);
      setFinishedSessionId(session.id);
      setFinishedDuration(data.session?.duration_seconds ?? elapsedSeconds);
      await loadPRs(exercises);
      setPhase('summary');
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Failed to finish workout');
    } finally {
      setFinishing(false);
    }
  };

  const saveManual = async () => {
    if (finishing) return;
    const durationMin = Number(manualDurationMin);
    if (!Number.isFinite(durationMin) || durationMin < 1) {
      showError('Error', 'Enter the workout duration in minutes');
      return;
    }
    setFinishing(true);
    try {
      const response = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode: 'manual',
          title: title || null,
          startedAt: `${manualDate}T12:00:00.000Z`,
          durationSeconds: Math.min(durationMin * 60, 86400),
          exercises,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to save workout');
      }
      const data = await response.json();
      clearDraft(draftId);
      setFinishedSessionId(data.session.id);
      setFinishedDuration(data.session.duration_seconds ?? durationMin * 60);
      await loadPRs(exercises);
      setPhase('summary');
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Failed to save workout');
    } finally {
      setFinishing(false);
    }
  };

  // Review mode: save edits, never re-finish (the server 409s finish on a
  // completed session anyway). Unshared workouts get the share offer; PR
  // detection stays a finish-time concept — no "new PB!" for backdated edits.
  const doneReview = async () => {
    if (!session || finishing) return;
    setFinishing(true);
    try {
      const flushed = await syncNow();
      if (!flushed) throw new Error('Could not save your sets — check your connection and try again.');
      // Always send title so the no-fields 400 can't fire
      const response = await fetch(`/api/workouts/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: title || null }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to save workout');
      }
      clearDraft(draftId);
      if (session.post_id) {
        showSuccess('Saved', 'Workout updated');
        router.push('/athlete');
      } else {
        setPhase('share');
      }
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Failed to save workout');
    } finally {
      setFinishing(false);
    }
  };

  const recordPRs = async (postId: string | null) => {
    const recordedAt =
      mode === 'manual' ? manualDate : (session?.started_at ?? new Date().toISOString()).slice(0, 10);
    for (const pr of prCandidates) {
      if (!checkedPRs.has(pr.metricKey)) continue;
      try {
        await fetch('/api/vitals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            metric_key: pr.metricKey,
            metric_category: 'strength',
            metric_label: pr.metricLabel,
            value: pr.value,
            value_display: pr.valueDisplay,
            unit: pr.unit,
            recorded_at: recordedAt,
            source: 'edge_vitals',
            linked_post_id: postId,
            notes: title ? `Set during "${title}"` : 'Set during a workout',
          }),
        });
      } catch (err) {
        console.error('Failed to record PR:', err);
      }
    }
  };

  const saveRoutine = async () => {
    if (routineSaving) return;
    const name = (routineName ?? title ?? '').trim() || 'Workout';
    setRoutineSaving(true);
    setRoutineError('');
    try {
      const response = await fetch('/api/workout-routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, exercises: entriesToRoutineExercises(exercises) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRoutineError(data.error || 'Failed to save routine');
        return;
      }
      setRoutineSaved(true);
    } catch (err) {
      console.error('Failed to save routine:', err);
      setRoutineError('Failed to save routine');
    } finally {
      setRoutineSaving(false);
    }
  };

  const summary = useMemo(() => computeSummary(exercises), [exercises]);
  const mediaOptions = useMemo(() => collectWorkoutMedia(exercises), [exercises]);

  // Default the share selection to the first MAX_POST_MEDIA clips
  const mediaDefaultedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'share' || mediaDefaultedRef.current) return;
    mediaDefaultedRef.current = true;
    setSelectedMedia(new Set(mediaOptions.slice(0, MAX_POST_MEDIA).map((_, i) => i)));
  }, [phase, mediaOptions]);

  const handleShare = async () => {
    if (!finishedSessionId || sharing) return;
    setSharing(true);
    setShareError('');
    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          postType: 'general',
          postCategory: 'training',
          caption,
          visibility: 'public',
          media: mediaOptions
            .filter((_, index) => selectedMedia.has(index))
            .slice(0, MAX_POST_MEDIA)
            .map((media, order) => ({ url: media.url, type: media.type, sortOrder: order })),
          taggedProfiles: [],
          stats_data: buildWorkoutStatsData({
            sessionId: finishedSessionId,
            title,
            durationSeconds: finishedDuration,
            summary,
            // Only CONFIRMED PRs ride the post — same gate as recordPRs.
            prs: prCandidates
              .filter(pr => checkedPRs.has(pr.metricKey))
              .map(pr => ({ label: pr.metricLabel, display: pr.valueDisplay })),
          }),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to share workout');
      }
      const data = await response.json();
      const postId: string = data.post.id;
      await fetch(`/api/workouts/${finishedSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ postId }),
      });
      await recordPRs(postId);
      showSuccess('Shared', 'Your workout is on the feed');
      router.push('/athlete');
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Failed to share workout');
      setSharing(false);
    }
  };

  const handleKeepPrivate = async () => {
    if (sharing) return;
    setSharing(true);
    await recordPRs(null);
    showSuccess('Saved', 'Workout saved to your history');
    router.push('/athlete');
  };

  const handleDiscard = async () => {
    setDiscardOpen(false);
    clearDraft(draftId);
    if (isServerSession && session) {
      try {
        await fetch(`/api/workouts/${session.id}`, { method: 'DELETE', credentials: 'include' });
      } catch { /* draft cleared; session finalizes lazily if delete failed */ }
    }
    router.push('/athlete');
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (phase === 'summary') {
    return (
      <FinishSummary
        title={title}
        durationSeconds={finishedDuration}
        summary={summary}
        prCandidates={prCandidates}
        checkedPRs={checkedPRs}
        onTogglePR={key =>
          setCheckedPRs(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })
        }
        onContinue={() => setPhase('share')}
        routineSave={
          exercises.length > 0
            ? {
                name: routineName ?? title ?? '',
                onNameChange: next => {
                  setRoutineName(next);
                  setRoutineError('');
                },
                saving: routineSaving,
                saved: routineSaved,
                error: routineError,
                onSave: saveRoutine,
              }
            : null
        }
      />
    );
  }

  if (phase === 'share') {
    return (
      <ShareStep
        caption={caption}
        onCaptionChange={setCaption}
        mediaOptions={mediaOptions}
        selectedMedia={selectedMedia}
        onToggleMedia={index =>
          setSelectedMedia(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
          })
        }
        sharing={sharing}
        error={shareError}
        onShare={handleShare}
        onKeepPrivate={handleKeepPrivate}
      />
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pb-28">
      {/* Sticky header: timer / manual fields + finish */}
      <div className="sticky top-0 z-10 bg-canvas pt-4 pb-3 border-b border-border mb-4">
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={title}
            onChange={e => updateTitle(e.target.value.slice(0, 120))}
            placeholder="Workout title (e.g. Push Day)"
            className="flex-1 min-w-0 px-3 py-2 border border-border-strong rounded-lg text-base font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              className="w-11 h-11 flex items-center justify-center text-faint hover:text-tertiary rounded-lg transition-colors"
              aria-label="Workout options"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-surface-raised border border-border rounded-lg shadow-lg z-20 w-44">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDiscardOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  {mode === 'review' ? 'Delete workout' : 'Discard workout'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* flex-wrap: at 320px the date + duration inputs and the shrink-0
            Save Workout button cannot share one line, and without wrapping the
            button was pushed ~19px past the container (3px past the viewport,
            producing a horizontally scrolling page). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {mode === 'live' ? (
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-1.5 text-brand-fg-strong">
                <Timer className="w-5 h-5" aria-hidden="true" />
                <span className="text-2xl font-bold tabular-nums">{formatElapsed(elapsedSeconds)}</span>
              </div>
              {restSeconds !== null && restSeconds < 3600 && (
                <span className="text-xs text-muted whitespace-nowrap">
                  Rest {formatElapsed(restSeconds)}
                </span>
              )}
              {syncState === 'saving' && <span className="text-xs text-faint">Saving…</span>}
              {syncState === 'saved' && <span className="text-xs text-emerald-600">Saved</span>}
              {syncState === 'error' && <span className="text-xs text-amber-600 dark:text-amber-400">Offline — kept locally</span>}
            </div>
          ) : mode === 'review' ? (
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-1.5 text-brand-fg-strong">
                <Timer className="w-5 h-5" aria-hidden="true" />
                <span className="text-2xl font-bold tabular-nums">
                  {formatElapsed(session?.duration_seconds ?? 0)}
                </span>
              </div>
              {session && (
                <span className="text-xs text-muted whitespace-nowrap">
                  {new Date(session.started_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </span>
              )}
              {syncState === 'saving' && <span className="text-xs text-faint">Saving…</span>}
              {syncState === 'saved' && <span className="text-xs text-emerald-600">Saved</span>}
              {syncState === 'error' && <span className="text-xs text-amber-600 dark:text-amber-400">Offline — kept locally</span>}
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={manualDate}
                onChange={e => setManualDate(e.target.value)}
                max={localDayKey(new Date())}
                className="px-2 py-2 border border-border-strong rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-violet-500"
                aria-label="Workout date"
              />
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={manualDurationMin}
                onChange={e => setManualDurationMin(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="min"
                className="w-20 px-2 py-2 border border-border-strong rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-500"
                aria-label="Duration in minutes"
              />
            </div>
          )}

          <button
            type="button"
            onClick={mode === 'live' ? finishLive : mode === 'review' ? doneReview : saveManual}
            disabled={finishing}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-brand text-white rounded-lg font-bold text-sm hover:bg-brand-hover transition-colors disabled:opacity-60 shrink-0"
          >
            {finishing ? (
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" aria-hidden="true" />
            ) : (
              <Flag className="w-4 h-4" aria-hidden="true" />
            )}
            {mode === 'live' ? 'Finish' : mode === 'review' ? 'Done' : 'Save Workout'}
          </button>
        </div>
      </div>

      {/* Exercises */}
      <div className="space-y-3">
        {exercises.map((exercise, index) => (
          <ExerciseCard
            key={index}
            exercise={exercise}
            onChange={next => mutate(exercises.map((e, i) => (i === index ? next : e)))}
            onDelete={() => mutate(exercises.filter((_, i) => i !== index))}
          />
        ))}

        {exercises.length === 0 && (
          <div className="text-center py-10 border border-dashed border-border-strong rounded-xl">
            <p className="text-sm text-muted">
              {mode === 'live'
                ? 'Timer is running — add your first exercise.'
                : mode === 'review'
                  ? 'Add exercises or clips to this workout.'
                  : 'Add the exercises you did.'}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => setAddSheetOpen(true)}
          disabled={exercises.length >= MAX_EXERCISES}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-surface border-2 border-dashed border-violet-300 dark:border-violet-700 text-brand-fg-strong rounded-xl font-bold text-base hover:bg-brand-soft transition-colors disabled:opacity-50"
        >
          <Plus className="w-5 h-5" />
          Add Exercise
        </button>
      </div>

      <AddExerciseSheet
        isOpen={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onAdd={exercise => mutate([...exercises, exercise])}
      />

      <ConfirmModal
        isOpen={discardOpen}
        title={mode === 'review' ? 'Delete Workout' : 'Discard Workout'}
        message={
          mode === 'review'
            ? `This permanently deletes this workout and everything you logged. This cannot be undone.${session?.post_id ? ' Your shared post stays on the feed.' : ''}`
            : "This deletes the session and everything you've logged. This cannot be undone."
        }
        confirmText={mode === 'review' ? 'Delete' : 'Discard'}
        onConfirm={handleDiscard}
        onCancel={() => setDiscardOpen(false)}
      />
    </div>
  );
}
