'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Flag, Layers, MoreVertical, Pause, Play, Plus, Repeat, Timer } from 'lucide-react';
import ExerciseCard, { SET_MEDIA_EDITOR_CONFIG } from './ExerciseCard';
import LiveClock from './LiveClock';
import { useSetMediaUploads } from './useSetMediaUploads';
import { MediaEditor } from '@/components/media-editor';
import type { EditedMedia, MediaAsset } from '@/lib/media/types';
import { uploadPostMedia } from '@/lib/media/upload';
import { POST_VISIBILITY } from '@/lib/posts/audience';
import { fetchStoredMediaFile } from '@/lib/workouts/set-media-file';
import {
  defaultShareOrder,
  moveShare,
  pruneShareOrder,
  removeMediaAt,
  replaceMediaAt,
  replaceShareUrl,
  shareList,
  toggleShare,
} from '@/lib/workouts/share-media';
import AddExerciseSheet from './AddExerciseSheet';
import ExerciseGroupCard from './ExerciseGroupCard';
import WorkoutControls from './WorkoutControls';
import { applyStopwatchToSet, completedSetDiff, REST_IDLE, restForCompletedSet, type RestTimer, type SetTarget, type Stopwatch } from '@/lib/workouts/rest';
import { clearTimers, readTimers, writeTimers, TIMERS_IDLE, type TimersState } from '@/lib/workouts/timers-store';
import { addRound, addToGroup, copyRound, deleteRound, GROUP_HINT, GROUP_LABEL, makeGroup, removeFromGroup, removeGroup, renderItems, setRounds, ungroup } from '@/lib/workouts/groups';
import type { GroupView } from '@/lib/workouts/rounds-view';
import { newId } from '@/lib/ids';
import type { ExerciseGroupKind } from '@/lib/workouts/entries';
import { FinishSummary, ShareStep } from './FinishFlow';
import ConfirmModal from '../ConfirmModal';
import { useToast } from '../Toast';
import { ensureClientIds, MAX_EXERCISES, type EntryExercise } from '@/lib/workouts/entries';
import { isTimed, workoutElapsedS } from '@/lib/workouts/timing';
import { readGroupView, readTimerHidden, writeGroupView, writeTimerHidden } from '@/lib/workouts/timer-prefs';
import ActionMenu from '@/components/ActionMenu';
import { isPendingMedia, stripPendingMedia } from '@/lib/workouts/set-media-pending';
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
  type CollectedMedia,
} from '@/lib/workouts/summary';
import { detectPRs, type PRCandidate } from '@/lib/workouts/pr-detection';
import { serverToEntries, type ServerWorkoutSession } from '@/lib/workouts/serialize';
import { localDayKey } from '@/lib/calendar/grid';
import { refreshDrafts } from '@/hooks/useDrafts';
import { publishProgress } from '@/lib/sessions/progress-store';

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
  const { showError, showNotice } = useToast();

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
  // 260: every exercise carries its stable id — a draft written before it is minted one here.
  const [exercises, setExercises] = useState<EntryExercise[]>(() => ensureClientIds(initial.exercises));
  const [title, setTitle] = useState<string>(initial.title ?? session?.title ?? '');
  const [phase, setPhase] = useState<Phase>(
    mode === 'review' && initialPhase === 'share' ? 'share' : 'editing'
  );
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  // PR 3: the sheet's purpose — one exercise, a new superset / circuit (optionally seeded from an existing exercise), or more members for a group.
  const [addMode, setAddMode] = useState<{ kind: 'single' } | { kind: ExerciseGroupKind; seed?: string } | { kind: 'addTo'; groupId: string }>({ kind: 'single' });
  const openAdd = (mode: typeof addMode) => {
    setAddMode(mode);
    setAddSheetOpen(true);
  };
  const [discardOpen, setDiscardOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Manual-mode fields
  const [manualDate, setManualDate] = useState(() => localDayKey(new Date()));
  const [manualDurationMin, setManualDurationMin] = useState<number | ''>('');

  // Post-finish state
  const [finishedSessionId, setFinishedSessionId] = useState<string | null>(
    session?.status === 'completed' ? session.id : null
  );
  // NULL = an untimed workout (260): the summary says "Not timed", the post carries no duration.
  const [finishedDuration, setFinishedDuration] = useState<number | null>(session ? (session.timed === false ? null : session.duration_seconds ?? 0) : 0);
  // ── The clock's facts (260) — SERVER facts seeded from the session, applied from every PATCH ──
  const [timed, setTimed] = useState<boolean>(session ? isTimed(session) : true);
  const [clock, setClock] = useState<{ pausedSeconds: number; pausedAt: string | null }>({ pausedSeconds: session?.paused_seconds ?? 0, pausedAt: session?.paused_at ?? null });
  const [timerHidden, setTimerHidden] = useState<boolean>(() => readTimerHidden());
  // Rounds as a swipe (Oct 13 2026): how every group on this device shows its rounds.
  const [groupView, setGroupView] = useState<GroupView>(() => readGroupView());
  const changeGroupView = (next: GroupView) => {
    setGroupView(next);
    writeGroupView(next);
  };
  // ── The rest timer and the stopwatch (PR 4): screen state, kept on the device ──
  const [timers, setTimers] = useState<TimersState>(() => (mode === 'live' ? readTimers(draftId) : TIMERS_IDLE));
  const [lastEditedClientId, setLastEditedClientId] = useState<string | null>(null);
  const persistTimers = (next: TimersState) => {
    setTimers(next);
    writeTimers(draftId, next);
  };
  const [clockBusy, setClockBusy] = useState(false);
  const [prCandidates, setPrCandidates] = useState<PRCandidate[]>([]);
  const [checkedPRs, setCheckedPRs] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  // The post's carousel IS this order (workout capture round PR 2): clip URLs,
  // never indices — an edit swaps a URL in place, a removal prunes it.
  const [shareOrder, setShareOrder] = useState<string[]>([]);
  /** The share step's pencil: the clip being edited, and the editor's asset. */
  const [shareEditor, setShareEditor] = useState<{ clip: CollectedMedia; assets: MediaAsset[] } | null>(null);
  const [shareClipBusy, setShareClipBusy] = useState(false);
  /** The share step's bin: the clip awaiting the confirm. */
  const [removeClip, setRemoveClip] = useState<CollectedMedia | null>(null);

  // Save-as-routine (summary phase). Name is null until the user types, so
  // the input tracks the final title without an effect.
  const [routineName, setRoutineName] = useState<string | null>(null);
  const [routineSaving, setRoutineSaving] = useState(false);
  const [routineSaved, setRoutineSaved] = useState(false);
  const [routineError, setRoutineError] = useState('');

  // ── Live timer ───────────────────────────────────────────────────────────
  // Derived from started_at, never counted — and it TICKS IN A LEAF
  // (`LiveClock`, PR 3 of the capture round): the one-second tick used to be
  // this screen's state and re-rendered every exercise row and an open media
  // editor each second. The finish fallback reads the clock once, here.
  const elapsedNow = () => (session ? workoutElapsedS({ started_at: session.started_at, paused_seconds: clock.pausedSeconds, paused_at: clock.pausedAt }, Date.now()) : 0);

  /** Pause / resume / timed — one PATCH each; the response's session is the truth (a 409 re-reads it). */
  const patchClock = async (body: Record<string, unknown>, failTitle: string) => {
    if (!session || clockBusy) return;
    setClockBusy(true);
    try {
      const res = await fetch(`/api/workouts/${session.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
      let next: { timed?: boolean | null; paused_seconds?: number | null; paused_at?: string | null } | null = null;
      if (res.ok) next = (await res.json()).session ?? null;
      else if (res.status === 409) next = (await (await fetch(`/api/workouts/${session.id}`, { credentials: 'include' })).json()).session ?? null;
      else {
        const data = await res.json().catch(() => null);
        showError(failTitle, data?.error ?? 'Please try again.');
      }
      if (next) {
        setTimed(isTimed(next));
        setClock({ pausedSeconds: next.paused_seconds ?? 0, pausedAt: next.paused_at ?? null });
        void refreshDrafts();
      }
    } catch {
      showError(failTitle, 'Please try again.');
    } finally {
      setClockBusy(false);
    }
  };
  const toggleTimerHidden = () => {
    const next = !timerHidden;
    writeTimerHidden(next);
    setTimerHidden(next);
  };

  // Rest indicator: seconds since the most recent completed set (LiveClock shows it)
  const lastCompletedMs = useMemo(() => {
    let latest = 0;
    for (const exercise of exercises) {
      for (const set of exercise.sets) {
        if (set.completedAt) latest = Math.max(latest, Date.parse(set.completedAt));
      }
    }
    return latest;
  }, [exercises]);

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
            // A clip still uploading is `pending:` in its set — never sent
            // (set-media-pending.ts); the hook writes the stored URL when it lands.
            body: JSON.stringify({ savedAt: Date.now(), exercises: stripPendingMedia(stateRef.current.exercises) }),
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
      const body = JSON.stringify({ savedAt: Date.now(), exercises: stripPendingMedia(stateRef.current.exercises) });
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

  // An in-app route change abandons a pending debounce (the localStorage
  // draft catches it; the server copy lagged by up to one edit). The resume
  // pill program: the server copy is current when you leave — the same
  // keepalive flush as pagehide, only when an edit is still waiting.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        flushRef.current();
      }
    };
  }, []);

  // Draft-restored state: reconcile to the server immediately
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    reconciledRef.current = true;
    if (initial.fromDraft) {
      showNotice('Restored', 'Unsaved sets were restored');
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

  /** Every exercise edit (a single or a group member): a set completed while a
   *  rest runs — or is held — takes the rest's seconds (rest.ts), then the rest clears. */
  const handleExerciseChange = useCallback(
    (clientId: string, next: EntryExercise) => {
      const prev = exercises.find(e => e.clientId === clientId);
      let patched = next;
      if (mode === 'live' && prev) {
        const idx = completedSetDiff(prev, next);
        const seconds = idx === null ? null : restForCompletedSet(timers.rest, Date.now());
        if (idx !== null && seconds !== null) {
          patched = { ...next, sets: next.sets.map((st, i) => (i === idx ? { ...st, restSeconds: seconds } : st)) };
          const cleared = { ...timers, rest: REST_IDLE };
          setTimers(cleared);
          writeTimers(draftId, cleared);
        }
      }
      setLastEditedClientId(clientId);
      mutate(exercises.map(e => (e.clientId === clientId ? patched : e)));
    },
    [exercises, mode, timers, draftId, mutate]
  );
  const saveStopwatch = useCallback(
    (target: SetTarget, elapsedMs: number) => {
      const nowIso = new Date().toISOString();
      setLastEditedClientId(target.clientId);
      mutate(exercises.map(e => (e.clientId === target.clientId ? { ...e, sets: e.sets.map((st, i) => (i === target.setIndex ? applyStopwatchToSet(st, elapsedMs, nowIso) : st)) } : e)));
    },
    [exercises, mutate]
  );

  const updateTitle = (next: string) => {
    setTitle(next);
    writeDraft(draftId, { title: next || null, exercises: stateRef.current.exercises });
    // Title persists via the finish PATCH / manual POST — no entries sync needed
  };

  // ── Set clips (workout capture round, Oct 8 2026) ───────────────────────
  // ONE upload queue for the screen: a capture is a tile at once, its bytes
  // in IndexedDB, the upload in the background; a reload resumes it. The
  // hook reads the latest exercises and writes through `mutate` (state →
  // draft → sync), so a landed clip finds its set by URL, never by index.
  const getExercises = useCallback(() => stateRef.current.exercises, []);
  const uploads = useSetMediaUploads({ sessionId: draftId, getExercises, commit: mutate, notify: showError });

  /** Finish / Save wait for the queue; a clip that stayed failed stops them
   *  with a message — a clip is never dropped silently. */
  const settleClips = async (): Promise<boolean> => {
    const { failed } = await uploads.settle();
    if (failed > 0) {
      showError(
        failed === 1 ? 'A clip did not upload' : `${failed} clips did not upload`,
        'Tap Retry on the clip, or remove it, then finish.'
      );
      return false;
    }
    return true;
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

  // B1 recovery (Sep 2026): PRs are recorded only by Share / Keep private,
  // so re-entering a finished-but-unshared session (review mode) must
  // recompute the candidates — without this the share step records
  // nothing. Training are unchanged until a PR is recorded, so the recompute
  // matches the one at finish time; once recorded, detectPRs finds no
  // improvement and the list is empty (self-limiting, no double-record).
  useEffect(() => {
    if (mode !== 'review' || session?.status !== 'completed') return;
    // setTimeout(0) recipe — the recompute sets state, which the lint
    // forbids synchronously inside an effect.
    const timer = setTimeout(() => {
      void loadPRs(initial.exercises);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh/close from summary/share with candidates still unrecorded →
  // the native prompt (the SiteBlockEditor beforeunload recipe; in-app
  // nav is not guarded — those exits go through Share / Keep private).
  useEffect(() => {
    if ((phase !== 'summary' && phase !== 'share') || prCandidates.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase, prCandidates.length]);

  const finishLive = async () => {
    if (!session || finishing) return;
    setFinishing(true);
    try {
      if (!(await settleClips())) return;
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
      clearTimers(draftId);
      uploads.clearStash();
      void refreshDrafts();
      setFinishedSessionId(session.id);
      setFinishedDuration(data.session?.duration_seconds ?? (timed ? elapsedNow() : null));
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
      if (!(await settleClips())) return;
      const response = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode: 'manual',
          title: title || null,
          startedAt: `${manualDate}T12:00:00.000Z`,
          durationSeconds: Math.min(durationMin * 60, 86400),
          exercises: stripPendingMedia(stateRef.current.exercises),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to save workout');
      }
      const data = await response.json();
      clearDraft(draftId);
      uploads.clearStash();
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
      if (!(await settleClips())) return;
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
  // The resume pill's number: sets with something in them, published as they
  // change so the pill is right the moment you leave this screen.
  useEffect(() => {
    if (mode === 'live' && session) publishProgress('workout', session.id, { setsCompleted: summary.totalSets });
  }, [mode, session, summary.totalSets]);
  // A clip still uploading never reaches the share step's list (Finish waits
  // for the queue; this covers a review-mode attach that is mid-flight).
  const mediaOptions = useMemo(() => collectWorkoutMedia(exercises).filter(m => !isPendingMedia(m)), [exercises]);

  // Default the share selection to the first MAX_POST_MEDIA clips
  const mediaDefaultedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'share' || mediaDefaultedRef.current) return;
    mediaDefaultedRef.current = true;
    setShareOrder(defaultShareOrder(mediaOptions, MAX_POST_MEDIA));
  }, [phase, mediaOptions]);
  const shareClips = useMemo(() => shareList(mediaOptions, shareOrder), [mediaOptions, shareOrder]);

  // ── The share step's clip controls (PR 2) ───────────────────────────────
  // An edit or a removal changes the SET (through mutate → the draft → the
  // entries PUT, which review mode already relies on for a completed
  // session), then the order follows; the draft is cleared once the server
  // has it, so a later reopen never offers to "restore" the share-step edit.
  const saveShareEdit = async (next: EntryExercise[]) => {
    mutate(next);
    const ok = await syncNow();
    if (ok) clearDraft(draftId);
    else showError('Not saved yet', 'Your change is kept on this device and will save when you are back online.');
  };
  const editShareClip = async (clip: CollectedMedia) => {
    if (shareClipBusy) return;
    setShareClipBusy(true);
    try {
      const file = await fetchStoredMediaFile(clip.url, clip.type);
      setShareEditor({ clip, assets: [{ id: `share-${clip.url}`, file, kind: clip.type }] });
    } catch (err) {
      showError('Could not open the clip', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setShareClipBusy(false);
    }
  };
  const shareEditorDone = async (results: EditedMedia[]) => {
    const target = shareEditor?.clip;
    setShareEditor(null);
    const first = results[0];
    if (!target || !first) return;
    setShareClipBusy(true);
    try {
      const uploaded = await uploadPostMedia(first.file);
      const next = replaceMediaAt(stateRef.current.exercises, target, { url: uploaded.url, type: uploaded.type });
      if (next !== stateRef.current.exercises) {
        setShareOrder(prev => replaceShareUrl(prev, target.url, uploaded.url));
        await saveShareEdit(next);
      }
    } catch (err) {
      showError('Upload failed', err instanceof Error ? err.message : 'Could not save the edited clip');
    } finally {
      setShareClipBusy(false);
    }
  };
  const confirmRemoveClip = async () => {
    const target = removeClip;
    setRemoveClip(null);
    if (!target) return;
    setShareClipBusy(true);
    try {
      const next = removeMediaAt(stateRef.current.exercises, target);
      if (next !== stateRef.current.exercises) {
        setShareOrder(prev => pruneShareOrder(prev, collectWorkoutMedia(next)));
        await saveShareEdit(next);
      }
    } finally {
      setShareClipBusy(false);
    }
  };

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
          // The account decides who sees it (src/lib/posts/audience.ts).
          visibility: POST_VISIBILITY,
          // The carousel is the chosen order (shareOrder), not the reading order.
          media: shareClips.selected
            .slice(0, MAX_POST_MEDIA)
            // A clip's poster rides the post (video posters PR 2b) — post_media.thumbnail_url.
            .map((media, order) => ({ url: media.url, type: media.type, sortOrder: order, thumbnailUrl: media.thumbnailUrl, blurHash: media.blurHash })),
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
      router.push('/athlete');
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Failed to share workout');
      setSharing(false);
    }
  };

  const handleKeepPrivate = async () => {
    if (sharing) return;
    setSharing(true);
    // The decision is a fact (253): without it a finished workout is a DRAFT
    // and Drafts keeps offering Share / Keep private.
    if (finishedSessionId) {
      await fetch(`/api/workouts/${finishedSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ keepPrivate: true }),
      }).catch(() => undefined);
    }
    await recordPRs(null);
    router.push('/athlete');
  };

  const handleDiscard = async () => {
    setDiscardOpen(false);
    clearDraft(draftId);
    clearTimers(draftId);
    uploads.clearStash();
    if (isServerSession && session) {
      try {
        await fetch(`/api/workouts/${session.id}`, { method: 'DELETE', credentials: 'include' });
      } catch { /* draft cleared; the sweep settles the session if the delete failed */ }
      void refreshDrafts();
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
      <>
        <ShareStep
          caption={caption}
          onCaptionChange={setCaption}
          clips={shareClips}
          onToggleClip={url => setShareOrder(prev => toggleShare(prev, url, MAX_POST_MEDIA))}
          onMoveClip={(url, dir) => setShareOrder(prev => moveShare(prev, url, dir))}
          onEditClip={clip => void editShareClip(clip)}
          onRemoveClip={clip => setRemoveClip(clip)}
          clipsBusy={shareClipBusy || sharing}
          sharing={sharing}
          error={shareError}
          onShare={handleShare}
          onKeepPrivate={handleKeepPrivate}
        />
        {shareEditor && (
          <MediaEditor
            assets={shareEditor.assets}
            config={SET_MEDIA_EDITOR_CONFIG}
            onDone={shareEditorDone}
            onCancel={() => setShareEditor(null)}
          />
        )}
        <ConfirmModal
          isOpen={removeClip !== null}
          title="Remove this clip?"
          message={
            removeClip
              ? `It is deleted from ${removeClip.exerciseName} set ${removeClip.setNumber} and from this workout, and your post will not include it. This cannot be undone.`
              : ''
          }
          confirmText="Remove"
          cancelText="Keep it"
          onConfirm={() => void confirmRemoveClip()}
          onCancel={() => setRemoveClip(null)}
        />
      </>
    );
  }

  return (
    <div className={`max-w-md mx-auto px-4 ${mode === 'live' ? 'ea-bar-clearance' : 'pb-28'}`}>
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
          {/* The house menu (ActionMenu): portalled, never clipped by the sticky header. */}
          <ActionMenu
            ariaLabel="Workout options"
            triggerTestAttr="workout-menu"
            trigger={<MoreVertical className="w-5 h-5" aria-hidden="true" />}
            items={[
              ...(mode === 'live' && session
                ? [
                    { key: 'hide-timer', label: timerHidden ? 'Show timer' : 'Hide timer', icon: timerHidden ? 'fa-eye' : 'fa-eye-slash', onSelect: toggleTimerHidden, testId: 'workout-menu-hide-timer' },
                    { key: 'timed', label: timed ? "Don't time this workout" : 'Time this workout', icon: 'fa-stopwatch', onSelect: () => void patchClock({ timed: !timed }, 'Could not change the timer'), disabled: clockBusy, testId: 'workout-menu-timed' },
                  ]
                : []),
              { key: 'discard', label: mode === 'review' ? 'Delete workout' : 'Discard workout', icon: 'fa-trash', tone: 'danger', onSelect: () => setDiscardOpen(true), testId: 'workout-menu-discard' },
            ]}
          />
        </div>

        {/* flex-wrap: at 320px the date + duration inputs and the shrink-0
            Save Workout button cannot share one line, and without wrapping the
            button was pushed ~19px past the container (3px past the viewport,
            producing a horizontally scrolling page). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {mode === 'live' && session ? (
            <div className="flex items-center gap-3 min-w-0" data-workout-timer={!timed ? 'off' : timerHidden ? 'hidden' : clock.pausedAt ? 'paused' : 'running'}>
              {timed && !timerHidden && (
                <>
                  <LiveClock startedAt={session.started_at} pausedSeconds={clock.pausedSeconds} pausedAt={clock.pausedAt} lastCompletedMs={lastCompletedMs} />
                  {/* Start/Pause beside the timer (Tom): a pause stops the clock, never the workout. */}
                  <button
                    type="button"
                    onClick={() => void patchClock(clock.pausedAt ? { resume: { at: new Date().toISOString() } } : { pause: { at: new Date().toISOString() } }, clock.pausedAt ? 'Could not resume the timer' : 'Could not pause the timer')}
                    disabled={clockBusy}
                    aria-pressed={!!clock.pausedAt}
                    aria-label={clock.pausedAt ? 'Resume the timer' : 'Pause the timer'}
                    data-workout-pause={clock.pausedAt ? 'paused' : 'running'}
                    className="ea-interactive inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-border-strong text-primary disabled:opacity-50"
                  >
                    {clock.pausedAt ? <Play className="w-4 h-4" aria-hidden="true" /> : <Pause className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </>
              )}
              {timed && timerHidden && <span className="text-xs text-muted" data-workout-timer-hidden="">Timer hidden</span>}
              {!timed && <span className="text-xs text-muted" data-workout-untimed="">Not timed</span>}
              {/* Autosave is silent (Tom): a message only when a save fails. */}
              {syncState === 'error' && <span className="text-xs text-amber-600 dark:text-amber-400" data-workout-save-error="">Offline — kept locally</span>}
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
            {finishing && uploads.pendingCount > 0
              ? `Saving ${uploads.pendingCount} ${uploads.pendingCount === 1 ? 'clip' : 'clips'}…`
              : mode === 'live' ? 'Finish' : mode === 'review' ? 'Done' : 'Save Workout'}
          </button>
        </div>
      </div>

      {/* Exercises */}
      <div className="space-y-3">
        {renderItems(exercises).map(item =>
          item.type === 'single' ? (
            <ExerciseCard
              key={item.exercise.clientId}
              exercise={item.exercise}
              onChange={next => handleExerciseChange(item.exercise.clientId, next)}
              onDelete={() => mutate(exercises.filter(e => e.clientId !== item.exercise.clientId))}
              uploads={uploads}
            />
          ) : (
            <ExerciseGroupCard
              key={item.group.groupId}
              group={item.group}
              uploads={uploads}
              view={groupView}
              onSetView={changeGroupView}
              onChangeMember={handleExerciseChange}
              onRemoveMember={clientId => mutate(removeFromGroup(exercises, clientId))}
              onAddExercise={() => openAdd({ kind: 'addTo', groupId: item.group.groupId })}
              onSetRounds={rounds => {
                const out = setRounds(exercises, item.group.groupId, rounds);
                if (out.rounds > rounds) showError('A round still holds data', `Rounds stay at ${out.rounds} — clear or delete that round first.`);
                mutate(out.exercises);
              }}
              onAddRound={() => mutate(addRound(exercises, item.group.groupId))}
              onDeleteRound={roundIndex => mutate(deleteRound(exercises, item.group.groupId, roundIndex))}
              onCopyRound={roundIndex => mutate(copyRound(exercises, item.group.groupId, roundIndex))}
              onUngroup={() => mutate(ungroup(exercises, item.group.groupId))}
              onRemoveGroup={() => mutate(removeGroup(exercises, item.group.groupId))}
            />
          )
        )}

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
          onClick={() => openAdd({ kind: 'single' })}
          disabled={exercises.length >= MAX_EXERCISES}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-surface border-2 border-dashed border-violet-300 dark:border-violet-700 text-brand-fg-strong rounded-xl font-bold text-base hover:bg-brand-soft transition-colors disabled:opacity-50"
        >
          <Plus className="w-5 h-5" />
          Add Exercise
        </button>
        {/* PR 3: a superset or a circuit — several exercises picked at once (groups.ts). */}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => openAdd({ kind: 'superset' })} disabled={exercises.length >= MAX_EXERCISES - 1} className="ea-interactive flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface px-3 text-sm font-semibold text-primary disabled:opacity-50" data-workout-add-group="superset">
            <Layers className="w-4 h-4 text-brand-fg-strong" aria-hidden="true" />
            Add superset
          </button>
          <button type="button" onClick={() => openAdd({ kind: 'circuit' })} disabled={exercises.length >= MAX_EXERCISES - 1} className="ea-interactive flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface px-3 text-sm font-semibold text-primary disabled:opacity-50" data-workout-add-group="circuit">
            <Repeat className="w-4 h-4 text-brand-fg-strong" aria-hidden="true" />
            Add circuit
          </button>
        </div>
      </div>

      {mode === 'live' && session && (
        <WorkoutControls
          exercises={exercises}
          rest={timers.rest}
          onRest={(rest: RestTimer) => persistTimers({ ...timers, rest })}
          stopwatch={timers.stopwatch}
          onStopwatch={(stopwatch: Stopwatch) => persistTimers({ ...timers, stopwatch })}
          lastEditedClientId={lastEditedClientId}
          onSaveStopwatch={saveStopwatch}
        />
      )}

      <AddExerciseSheet
        isOpen={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onAdd={exercise => mutate([...exercises, exercise])}
        multi={
          addMode.kind === 'single'
            ? null
            : addMode.kind === 'addTo'
              ? { title: 'Add to this group', hint: 'Pick one or more exercises to add.', min: 1, cta: n => (n === 0 ? 'Pick an exercise' : `Add ${n} to the group`), onAddMany: picks => mutate(picks.reduce((acc, p) => addToGroup(acc, addMode.groupId, p), exercises)) }
              : {
                  title: addMode.seed ? `${GROUP_LABEL[addMode.kind]} with ${exercises.find(e => e.clientId === addMode.seed)?.name ?? 'this exercise'}` : `Add ${GROUP_LABEL[addMode.kind].toLowerCase()}`,
                  hint: GROUP_HINT[addMode.kind],
                  min: addMode.seed ? 1 : 2,
                  cta: n => {
                    const total = n + (addMode.seed ? 1 : 0);
                    return total < 2 ? `Pick ${2 - total} more` : `Create ${GROUP_LABEL[addMode.kind].toLowerCase()} (${total})`;
                  },
                  onAddMany: picks => {
                    const seed = addMode.seed ? exercises.find(e => e.clientId === addMode.seed) : undefined;
                    mutate(makeGroup(exercises, addMode.kind, seed ? [seed, ...picks] : picks, newId()));
                  },
                }
        }
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
