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
import {
  MANUAL_DRAFT_ID,
  clearDraft,
  readDraft,
  resolveEntries,
  writeDraft,
} from '@/lib/workouts/draft';
import { computeSummary, collectWorkoutMedia, formatElapsed, MAX_POST_MEDIA } from '@/lib/workouts/summary';
import { detectPRs, type PRCandidate } from '@/lib/workouts/pr-detection';
import { serverToEntries, type ServerWorkoutSession } from '@/lib/workouts/serialize';

type Phase = 'editing' | 'summary' | 'share';

const SYNC_DEBOUNCE_MS = 2000;
const KEEPALIVE_BODY_LIMIT = 60_000; // fetch keepalive shares a 64KiB in-flight cap

interface WorkoutEditorScreenProps {
  mode: 'live' | 'manual';
  /** Required for live mode; the loaded session. */
  session?: ServerWorkoutSession;
  currentUserId: string;
}

export default function WorkoutEditorScreen({ mode, session, currentUserId }: WorkoutEditorScreenProps) {
  const router = useRouter();
  const { showSuccess, showError } = useToast();

  const draftId = mode === 'live' ? session!.id : MANUAL_DRAFT_ID;

  // ── Editor state (source of truth while editing) ─────────────────────────
  const [initial] = useState(() => {
    const draft = readDraft(draftId);
    if (mode === 'live' && session) {
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
  const [phase, setPhase] = useState<Phase>('editing');
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Manual-mode fields
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualDurationMin, setManualDurationMin] = useState<number | ''>('');

  // Post-finish state
  const [finishedSessionId, setFinishedSessionId] = useState<string | null>(
    mode === 'live' && session?.status === 'completed' ? session.id : null
  );
  const [finishedDuration, setFinishedDuration] = useState<number>(session?.duration_seconds ?? 0);
  const [prCandidates, setPrCandidates] = useState<PRCandidate[]>([]);
  const [checkedPRs, setCheckedPRs] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<Set<number>>(new Set());

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
    if (mode !== 'live' || !session) return true;
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
  }, [mode, session]);

  const scheduleSync = useCallback(() => {
    if (mode !== 'live') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void syncNow(), SYNC_DEBOUNCE_MS);
  }, [mode, syncNow]);

  // Keepalive flush on pagehide / tab-hide (belt = draft, suspenders = this)
  const flushRef = useRef<() => void>(() => {});
  useEffect(() => {
    flushRef.current = () => {
      if (mode !== 'live' || !session || phase !== 'editing') return;
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
      if (mode === 'live') void syncNow();
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
          postType: 'training',
          caption,
          visibility: 'public',
          media: mediaOptions
            .filter((_, index) => selectedMedia.has(index))
            .slice(0, MAX_POST_MEDIA)
            .map((media, order) => ({ url: media.url, type: media.type, sortOrder: order })),
          taggedProfiles: [],
          stats_data: {
            type: 'workout_session',
            workout_session_id: finishedSessionId,
            title: title || 'Workout',
            duration_seconds: finishedDuration,
            exercise_count: summary.exerciseCount,
            total_sets: summary.totalSets,
            total_volume_lbs: summary.totalVolumeLbs,
            top_line: summary.topLine,
          },
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
    if (mode === 'live' && session) {
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
      <div className="sticky top-0 z-10 bg-gray-50 pt-4 pb-3 border-b border-gray-200 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={title}
            onChange={e => updateTitle(e.target.value.slice(0, 120))}
            placeholder="Workout title (e.g. Push Day)"
            className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-base font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              className="w-11 h-11 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
              aria-label="Workout options"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 w-44">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDiscardOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Discard workout
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
              <div className="flex items-center gap-1.5 text-violet-700">
                <Timer className="w-5 h-5" aria-hidden="true" />
                <span className="text-2xl font-bold tabular-nums">{formatElapsed(elapsedSeconds)}</span>
              </div>
              {restSeconds !== null && restSeconds < 3600 && (
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  Rest {formatElapsed(restSeconds)}
                </span>
              )}
              {syncState === 'saving' && <span className="text-xs text-gray-400">Saving…</span>}
              {syncState === 'saved' && <span className="text-xs text-emerald-600">Saved</span>}
              {syncState === 'error' && <span className="text-xs text-amber-600">Offline — kept locally</span>}
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={manualDate}
                onChange={e => setManualDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                className="px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
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
                className="w-20 px-2 py-2 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-500"
                aria-label="Duration in minutes"
              />
            </div>
          )}

          <button
            type="button"
            onClick={mode === 'live' ? finishLive : saveManual}
            disabled={finishing}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-violet-600 text-white rounded-lg font-bold text-sm hover:bg-violet-700 transition-colors disabled:opacity-60 shrink-0"
          >
            {finishing ? (
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" aria-hidden="true" />
            ) : (
              <Flag className="w-4 h-4" aria-hidden="true" />
            )}
            {mode === 'live' ? 'Finish' : 'Save Workout'}
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
          <div className="text-center py-10 border border-dashed border-gray-300 rounded-xl">
            <p className="text-sm text-gray-500">
              {mode === 'live' ? 'Timer is running — add your first exercise.' : 'Add the exercises you did.'}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => setAddSheetOpen(true)}
          disabled={exercises.length >= MAX_EXERCISES}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-white border-2 border-dashed border-violet-300 text-violet-700 rounded-xl font-bold text-base hover:bg-violet-50 transition-colors disabled:opacity-50"
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
        title="Discard Workout"
        message="This deletes the session and everything you've logged. This cannot be undone."
        confirmText="Discard"
        onConfirm={handleDiscard}
        onCancel={() => setDiscardOpen(false)}
      />
    </div>
  );
}
