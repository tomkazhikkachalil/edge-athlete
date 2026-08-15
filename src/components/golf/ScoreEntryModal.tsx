'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import NumberWheel from '@/components/golf/NumberWheel';
import { holePar } from '@/lib/golf/scoring';
import {
  firstUnscoredHole,
  readDraft,
  writeDraft,
  removeHoleFromDraft,
  clearDraft,
  mergeDraftIntoHoles,
  type DraftHole,
} from '@/lib/golf/score-entry';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import {
  PENALTY_TYPES,
  PENALTY_LABELS,
  isPenaltyType,
  aggregatePenalties,
  totalPenalties,
} from '@/lib/golf/penalties';
import { GOLF_LABEL, GOLF_SELECT, GOLF_INPUT_COMPACT } from '@/components/golf/golf-form-styles';
import type { GolfHoleScore } from '@/types/group-posts';
import type { HoleData } from '@/types/golf';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import { uploadPostMedia } from '@/lib/media/upload';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';

const HOLE_MEDIA_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['free', '1:1', '4:5', '16:9'],
  allowVideo: true, // videos pass through untouched until the video phase
  maxAssets: 1,
  output: { maxDimension: 1600, mime: 'image/jpeg', quality: 0.85 },
};

export interface ScoreEntryPlayer {
  participantId: string;
  name: string;
  avatarUrl: string | null;
  holesCompleted: number;
  isSelf: boolean;
}

// Wheel ranges. Strokes matches what the API accepts (1-15,
// scorecards/[id]/scores route) — the old button grid started at 2, so a
// hole-in-one could not be entered at all.
const STROKES_MIN = 1;
const STROKES_MAX = 15;
const PUTTS_MIN = 0;
const PUTTS_MAX = 10;
/** Two putts is the ordinary hole; see the DEFAULTS note by the wheels. */
const PUTTS_DEFAULT = 2;

interface ScoreEntryModalProps {
  groupPostId: string;
  participantId: string;
  holesPlayed: number;
  /** First hole number (10 for back-9 rounds). Defaults to 1. */
  startingHoleNumber?: number;
  /** Per-hole course data (real pars/yardage). Absent → par-4 fallback. */
  holeData?: { hole: number; par: number; yardage?: number }[] | null;
  /** Course name for the hole context line ("Hole 3 · Eagle Creek · Par 4"). */
  courseName?: string | null;
  /** All players in the round (creator view) — renders the switcher chips.
   *  The current hole is persisted before any switch. */
  players?: ScoreEntryPlayer[];
  onSwitchPlayer?: (participantId: string) => void;
  /** Session user id — required for hole photo/video uploads. */
  uploaderId?: string;
  /** Whose scorecard this is — shown in the header when the creator enters
   *  scores for another player, so it's unmistakable whose card is open. */
  playerName?: string;
  existingScores?: GolfHoleScore[];
  /** Open at this HOLE NUMBER instead of the first incomplete hole (solo
   *  grid's PEN cells jump straight to the tapped hole). Out-of-range values
   *  fall back to the default resume logic. */
  initialHole?: number;
  /** Scroll this section into view when the modal opens (penalty badges jump
   *  straight to the Penalties block). Additive — omitted, opens as today. */
  focusSection?: 'penalties';
  onSave: (scores: Array<{
    hole_number: number;
    strokes: number;
    putts?: number;
    fairway_hit?: boolean;
    green_in_regulation?: boolean;
    penalties?: string[] | null;
  }>) => Promise<void>;
  // LIVE mode: when provided, each hole is persisted as you advance (rather
  // than all-at-once via onSave), so co-players watching the round see your
  // scores stream in hole-by-hole. Should POST the single hole and resolve.
  onSaveHole?: (hole: {
    hole_number: number;
    strokes: number;
    putts?: number;
    fairway_hit?: boolean;
    green_in_regulation?: boolean;
    penalties?: string[] | null;
  }) => Promise<void>;
  onClose: () => void;
}

export default function ScoreEntryModal({
  groupPostId,
  participantId,
  holesPlayed,
  startingHoleNumber = 1,
  holeData: courseHoleData = null,
  courseName = null,
  players,
  onSwitchPlayer,
  uploaderId,
  playerName,
  existingScores = [],
  initialHole,
  focusSection,
  onSave,
  onSaveHole,
  onClose
}: ScoreEntryModalProps) {
  const isLive = !!onSaveHole;
  // Mounted only while open — lock background scroll for the whole lifetime
  useBodyScrollLock();

  // Seed holes from the server's scores, then restore any localStorage draft
  // (typed-but-never-saved holes from a killed tab). The merge only applies
  // draft holes the server does NOT have — see mergeDraftIntoHoles. Computed
  // once via lazy state so holeData / dirty set / starting hole stay coherent.
  const [initialSession] = useState(() => {
    const base: HoleData[] = [];
    for (let i = 1; i <= holesPlayed; i++) {
      const holeNumber = startingHoleNumber + i - 1;
      const existing = existingScores.find(s => s.hole_number === holeNumber);
      base.push({
        hole_number: holeNumber,
        strokes: existing?.strokes ?? null,
        putts: existing?.putts ?? null,
        fairway_hit: existing?.fairway_hit ?? null,
        green_in_regulation: existing?.green_in_regulation ?? null,
        penalties: existing?.penalties ?? null,
        // Real course par when the round carries hole_data; par-4 fallback
        // otherwise. Keyed by HOLE NUMBER (not position — back-9 rounds
        // start at 10).
        par: holePar(holeNumber, courseHoleData),
      });
    }
    const { holes, restored } = mergeDraftIntoHoles(
      base as Array<HoleData & DraftHole & { hole_number: number | null }>,
      readDraft(participantId),
      existingScores
    );
    // Restored draft holes are "dirty": they exist locally but not on the
    // server, so the next advance persists them. Sets are keyed by POSITION
    // (1..holesPlayed), matching currentHole; convert from hole numbers.
    const toPos = (holeNumber: number) => holeNumber - startingHoleNumber + 1;
    // A caller-requested hole (solo grid PEN cell) overrides the resume
    // logic; out-of-range requests fall through to the default.
    const requestedPos = initialHole != null ? toPos(initialHole) : null;
    return {
      holes: holes as HoleData[],
      dirty: new Set(restored.map(toPos)),
      // Resume at the first hole with no strokes AFTER the draft merge
      start: requestedPos != null && requestedPos >= 1 && requestedPos <= holesPlayed
        ? requestedPos
        : firstUnscoredHole(
            holes.filter(h => h.strokes !== null && h.hole_number !== null) as Array<{ hole_number: number }>,
            holesPlayed,
            startingHoleNumber
          ),
    };
  });

  const [currentHole, setCurrentHole] = useState(initialSession.start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PEN-flow fix: opened from a penalty badge, bring the Penalties block into
  // view immediately — it sits four sections down and the flow felt backwards
  // landing on Strokes. focusSection is stable for a mount, so this runs once.
  const penaltiesSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusSection === 'penalties') {
      penaltiesSectionRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }, [focusSection]);

  // Per-hole persistence state, keyed by POSITION. Holes present in
  // existingScores start "saved"; any local edit marks a hole dirty until it
  // re-saves.
  const [savedHoles, setSavedHoles] = useState<Set<number>>(
    () => new Set(existingScores.map(s => s.hole_number - startingHoleNumber + 1))
  );
  const [dirtyHoles, setDirtyHoles] = useState<Set<number>>(initialSession.dirty);
  const [savingHole, setSavingHole] = useState<number | null>(null);

  const [holeData, setHoleData] = useState<HoleData[]>(initialSession.holes);

  const currentHoleData = holeData[currentHole - 1];
  // Where the strokes wheel rests while nothing is entered. Par falls back to 4
  // when the round carries no course hole data (scoring.ts holePar), so on such
  // a round every hole rests on 4.
  const restingStrokes = currentHoleData?.par ?? 4;

  // Best-effort flush of the current dirty hole when the page is being left
  // (navigate away, tab switch, tab kill where the browser cooperates).
  // keepalive lets the request outlive the page. Fire-and-forget: success is
  // unconfirmed, so the draft is NOT cleared here — if the flush landed, the
  // next open sees the hole in existingScores and the merge drops the draft
  // copy; if it didn't, the draft restores it. Refs keep the listener stable
  // across keystrokes. Live mode only (batch mode has no per-hole endpoint
  // contract; its draft still protects typed input).
  const flushRef = useRef({ holeData, dirtyHoles, currentHole });
  useEffect(() => {
    flushRef.current = { holeData, dirtyHoles, currentHole };
  }, [holeData, dirtyHoles, currentHole]);

  useEffect(() => {
    if (!isLive) return;

    const flush = () => {
      const { holeData: holes, dirtyHoles: dirty, currentHole: pos } = flushRef.current;
      const hole = holes[pos - 1];
      if (!dirty.has(pos) || !hole || hole.strokes === null || hole.hole_number === null) return;
      try {
        fetch(`/api/golf/scorecards/${participantId}/scores`, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scores: [{
              hole_number: hole.hole_number,
              strokes: hole.strokes,
              putts: hole.putts ?? undefined,
              fairway_hit: hole.fairway_hit ?? undefined,
              green_in_regulation: hole.green_in_regulation ?? undefined,
              penalties: hole.penalties?.length ? hole.penalties : undefined,
            }],
          }),
        }).catch(() => { /* page is going away — nothing to do */ });
      } catch { /* best-effort */ }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isLive, participantId]);

  /** Patch several fields of the current hole at once.
   *
   *  Multi-field on purpose: this rebuilds `next` from the `holeData` CLOSURE,
   *  so two back-to-back single-field calls would each start from the stale
   *  array and the first write would be lost. Returns the resulting hole so a
   *  caller that must act on it immediately (persistHole) does not have to wait
   *  for the state update to land. */
  const patchCurrentHole = (patch: Partial<HoleData>): HoleData | null => {
    const next = holeData.map((h, idx) =>
      idx === currentHole - 1 ? { ...h, ...patch } : h
    );
    const nextDirty = new Set(dirtyHoles).add(currentHole);
    setHoleData(next);
    // Editing a hole marks it dirty (live: needs a re-save on advance)
    setDirtyHoles(nextDirty);
    setError(null);
    // Mirror every dirty hole into the localStorage draft so a refresh or
    // killed tab can't lose typed-but-unsaved input. Best-effort.
    const draftHoles: Record<number, DraftHole> = {};
    for (const pos of nextDirty) {
      const h = next[pos - 1];
      if (h?.hole_number != null) {
        draftHoles[h.hole_number] = {
          strokes: h.strokes ?? null,
          putts: h.putts ?? null,
          fairway_hit: h.fairway_hit ?? null,
          green_in_regulation: h.green_in_regulation ?? null,
          penalties: h.penalties ?? null,
        };
      }
    }
    writeDraft(participantId, draftHoles);
    return next[currentHole - 1] ?? null;
  };

  const updateCurrentHole = (field: keyof HoleData, value: number | boolean | string[] | null) => {
    patchCurrentHole({ [field]: value } as Partial<HoleData>);
  };

  const handleStrokeClick = (strokes: number) => {
    updateCurrentHole('strokes', strokes);
  };

  const handlePuttClick = (putts: number) => {
    updateCurrentHole('putts', putts);
  };

  // Penalty entry: pick a type + how many times it happened; Add appends that
  // many occurrences (the storage model is one array element per occurrence —
  // see src/lib/golf/penalties.ts). The × on a row removes ALL occurrences of
  // that type. Capped at 20 per hole, matching validatePenalties server-side.
  const [penaltyType, setPenaltyType] = useState('');
  const [penaltyCount, setPenaltyCount] = useState(1);

  const handleAddPenalty = () => {
    if (!isPenaltyType(penaltyType)) return;
    const count = Math.min(9, Math.max(1, Math.floor(penaltyCount) || 1));
    const next = [
      ...(currentHoleData.penalties ?? []),
      ...Array.from({ length: count }, () => penaltyType),
    ].slice(0, 20);
    updateCurrentHole('penalties', next);
    setPenaltyType('');
    setPenaltyCount(1);
  };

  const handleRemovePenalty = (type: string) => {
    const remaining = (currentHoleData.penalties ?? []).filter(p => p !== type);
    updateCurrentHole('penalties', remaining.length > 0 ? remaining : null);
  };

  // Live mode: persist a single hole (if it has a score and is dirty).
  // Returns true if OK to proceed (saved or nothing to save), false on error.
  // `override` carries a hole just committed in the same tick, whose state
  // update has not landed in `holeData` yet.
  const persistHole = async (holeNum: number, override?: HoleData | null): Promise<boolean> => {
    if (!isLive || !onSaveHole) return true;
    const hole = override ?? holeData[holeNum - 1];
    if (!hole || hole.strokes === null) return true; // nothing complete to save
    if (!override && !dirtyHoles.has(holeNum) && savedHoles.has(holeNum)) return true; // unchanged

    setSavingHole(holeNum);
    setError(null);
    try {
      await onSaveHole({
        hole_number: hole.hole_number!,
        strokes: hole.strokes!,
        putts: hole.putts ?? undefined,
        fairway_hit: hole.fairway_hit ?? undefined,
        green_in_regulation: hole.green_in_regulation ?? undefined,
        penalties: hole.penalties?.length ? hole.penalties : undefined,
      });
      setSavedHoles(prev => new Set(prev).add(holeNum));
      setDirtyHoles(prev => { const n = new Set(prev); n.delete(holeNum); return n; });
      // Server has it now — the draft copy is obsolete
      if (hole.hole_number != null) removeHoleFromDraft(participantId, hole.hole_number);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save this hole');
      return false;
    } finally {
      setSavingHole(null);
    }
  };

  // ── DEFAULTS: when a resting wheel becomes a recorded score ────────────────
  // Only when the user moves PAST the hole (Next) or explicitly finishes
  // (footer Done / Save Scores). Landing on a hole records nothing, and neither
  // do Previous, jump-to-hole, switching player, or closing with the X —
  // otherwise merely navigating would invent scores for holes nobody played,
  // and "holes actually played" is what a partial round is scored against.
  //
  // Note updateCurrentHole marks the hole dirty regardless of whether the value
  // changed, which is exactly what we want here: a genuine par has to be
  // written explicitly or it would never be marked dirty and never saved.
  // Returns the committed hole so the caller can persist it WITHOUT waiting for
  // the state update — persistHole would otherwise read the stale null and save
  // nothing at all.
  const commitRestingScores = (): HoleData | null => {
    const hole = holeData[currentHole - 1];
    if (!hole || hole.strokes !== null) return null;
    return patchCurrentHole({
      strokes: restingStrokes,
      ...(hole.putts === null ? { putts: PUTTS_DEFAULT } : {}),
    });
  };

  const handleNext = async () => {
    // No "enter a stroke count" guard any more — advancing IS the entry. The
    // wheel already shows par/2, so Next on an untouched hole records that.
    const committed = commitRestingScores();
    if (isLive && !(await persistHole(currentHole, committed))) return; // save before advancing
    if (currentHole < holesPlayed) {
      setCurrentHole(prev => prev + 1);
      setError(null);
    }
  };

  // One rule for ALL navigation: you can't leave a hole that didn't save.
  // (Previous/Jump used to ignore persistHole's result and clear the error —
  // a failed save was silently swallowed and the hole lost on exit.)
  const handlePrevious = async () => {
    if (isLive && !(await persistHole(currentHole))) return;
    if (currentHole > 1) {
      setCurrentHole(prev => prev - 1);
      setError(null);
    }
  };

  const handleJumpToHole = async (holeNum: number) => {
    if (holeNum === currentHole) return;
    if (isLive && !(await persistHole(currentHole))) return;
    setCurrentHole(holeNum);
    setError(null);
  };

  // Live mode: holes are already saved as you go, so "Done" just flushes the
  // current hole and closes. Also used as the close handler so nothing dirty
  // is lost when the user taps ✕.
  // `commitCurrent` distinguishes the two callers that share this handler:
  // the footer's Done button means "this is my round", so an untouched current
  // hole is recorded at its resting par/2. The header X means "get me out of
  // here" and must record nothing.
  const handleDone = async (commitCurrent: boolean) => {
    const committed = commitCurrent ? commitRestingScores() : null;
    setSaving(true);
    const ok = await persistHole(currentHole, committed);
    setSaving(false);
    if (ok) {
      // No clearDraft here: persistHole prunes each hole from the draft as
      // it saves, so a fully-saved session already removed the key. Anything
      // still in the draft is strokes-less partial input (typed putts/FIR on
      // a hole persistHole skips as incomplete) — exactly what the draft
      // exists to protect across a close.
      onClose();
    }
  };

  // Player switching (creator view): NEVER lose typed input — the current
  // hole persists before the switch; the parent remounts the modal keyed by
  // participant so the next player's card seeds fresh.
  const handleSwitchPlayer = async (nextParticipantId: string) => {
    if (!onSwitchPlayer || nextParticipantId === participantId) return;
    if (isLive && !(await persistHole(currentHole))) return;
    onSwitchPlayer(nextParticipantId);
  };

  // Hole photos/videos (live rounds only): upload → attach to this hole.
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaCountByHole, setMediaCountByHole] = useState<Record<number, number>>({});
  const canAttachMedia = isLive && !!groupPostId && !!uploaderId;

  // Picked file goes through the shared media editor (crop/adjust) before
  // uploading; pick-time validation mirrors the server allowlist (was
  // missing entirely on this surface).
  const [holeEditorAssets, setHoleEditorAssets] = useState<MediaAsset[] | null>(null);

  const handleMediaSelect = (file: File | undefined) => {
    if (!file || !canAttachMedia) return;
    const { accepted, rejected } = validateFiles([file], {
      maxBytes: 50 * 1024 * 1024,
      allowVideo: true,
      maxCount: 1,
    });
    if (rejected.length > 0) {
      setError(rejected[0].message);
      if (mediaInputRef.current) mediaInputRef.current.value = '';
      return;
    }
    setError(null);
    setHoleEditorAssets([{
      id: `${Date.now()}`,
      file: accepted[0],
      kind: accepted[0].type.startsWith('video/') ? 'video' as const : 'image' as const,
    }]);
  };

  const handleHoleMediaDone = async (results: EditedMedia[]) => {
    setHoleEditorAssets(null);
    const result = results[0];
    const holeNumber = currentHoleData?.hole_number;
    if (!result || !holeNumber) return;
    setUploadingMedia(true);
    setError(null);
    try {
      const uploadData = await uploadPostMedia(result.file);
      URL.revokeObjectURL(result.previewUrl);

      // The editor already captured a poster frame for videos; without
      // uploading it, <video preload="metadata"> renders a black tile on the
      // scorecard and on the mirrored feed post. Never fail the capture over
      // a poster — the clip itself is the point.
      let thumbnailUrl: string | undefined;
      if (result.posterBlob) {
        try {
          const poster = new File([result.posterBlob], 'poster.jpg', { type: 'image/jpeg' });
          thumbnailUrl = (await uploadPostMedia(poster)).url;
        } catch (err) {
          console.warn('Hole poster upload failed:', err);
        }
      }

      const attachRes = await fetch(`/api/group-posts/${groupPostId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          media_url: uploadData.url,
          media_type: uploadData.type,
          // Sport-agnostic since migration 061 — the server resolves what a
          // segment means from the round's sport and writes segment_kind.
          segment_number: holeNumber,
          thumbnail_url: thumbnailUrl,
        }),
      });
      if (!attachRes.ok) {
        const attachData = await attachRes.json().catch(() => ({}));
        throw new Error(attachData.error || 'Could not attach media to the hole');
      }
      setMediaCountByHole(prev => ({ ...prev, [holeNumber]: (prev[holeNumber] ?? 0) + 1 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add media');
    } finally {
      setUploadingMedia(false);
      if (mediaInputRef.current) mediaInputRef.current.value = '';
    }
  };

  const activePlayer = players?.find(p => p.participantId === participantId) ?? null;
  const enteringForOther = activePlayer ? !activePlayer.isSelf : !!playerName;

  const handleSave = async () => {
    // "Save Scores" is the explicit finish in batch mode, so it commits the
    // current hole's resting wheels like the live Done button does. Work from
    // the returned array rather than `holeData` — the state update has not
    // landed yet, so the freshly committed hole would otherwise be dropped by
    // the strokes !== null filter below.
    const committed = commitRestingScores();
    const effective = committed
      ? holeData.map((h, idx) => (idx === currentHole - 1 ? committed : h))
      : holeData;

    // Validate: at least some scores entered
    const hasScores = effective.some(h => h.strokes !== null);
    if (!hasScores) {
      setError('Please enter scores for at least one hole');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Filter out holes with no strokes entered
      const scores = effective
        .filter(h => h.strokes !== null)
        .map(h => ({
          hole_number: h.hole_number!,
          strokes: h.strokes!,
          putts: h.putts ?? undefined,
          fairway_hit: h.fairway_hit ?? undefined,
          green_in_regulation: h.green_in_regulation ?? undefined,
          penalties: h.penalties?.length ? h.penalties : undefined,
        }));

      await onSave(scores);
      clearDraft(participantId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save scores');
      setSaving(false);
    }
  };

  // Calculate totals
  const totalStrokes = holeData.reduce((sum, h) => sum + (h.strokes || 0), 0);
  const totalPutts = holeData.reduce((sum, h) => sum + (h.putts || 0), 0);
  const holesCompleted = holeData.filter(h => h.strokes !== null).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-surface-raised rounded-lg shadow-2xl max-w-md w-full max-h-modal overflow-hidden flex flex-col">
        {/* Header — color signals WHOSE card is open: green for your own,
            amber when entering for someone else (unmissable identity) */}
        <div className={`${enteringForOther ? 'bg-amber-600' : 'bg-green-600'} text-white p-4`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              {activePlayer && (
                activePlayer.avatarUrl ? (
                  <Image
                    src={activePlayer.avatarUrl}
                    alt=""
                    width={28}
                    height={28}
                    className="w-7 h-7 rounded-full object-cover border-2 border-white/60 flex-shrink-0"
                    unoptimized={!isOptimizableImageSrc(activePlayer.avatarUrl)}
                  />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {activePlayer.name.charAt(0)}
                  </span>
                )
              )}
              {/* min-w-0 on the h2 itself — the row's min-w-0 doesn't reach
                  it, so "Entering for <long name>" refused to shrink and
                  squeezed the LIVE badge. */}
              <h2 className="text-xl font-black truncate min-w-0">
                {activePlayer
                  ? activePlayer.isSelf ? 'Your Scores' : `Entering for ${activePlayer.name}`
                  : playerName ? `Entering for ${playerName}` : 'Enter Scores'}
              </h2>
              {isLive && (
                <span className="inline-flex shrink-0 items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full text-xs font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span>
                  LIVE
                </span>
              )}
            </div>
            <button
              onClick={isLive ? () => handleDone(false) : onClose}
              className="text-white hover:text-white/80 text-xl font-bold min-w-[44px] min-h-[44px] -m-2 flex items-center justify-center"
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <span>Hole {currentHole} of {holesPlayed}</span>
            {isLive && savingHole === currentHole && (
              <span className="text-xs font-normal opacity-90"><i className="fas fa-spinner fa-spin mr-1"></i>Saving…</span>
            )}
            {isLive && savingHole !== currentHole && savedHoles.has(currentHole) && !dirtyHoles.has(currentHole) && (
              <span className="text-xs font-normal opacity-90"><i className="fas fa-check mr-1"></i>Saved</span>
            )}
          </div>
        </div>

        {/* Player switcher (creator view) — tap a chip to enter that
            player's scores; the current hole saves first */}
        {players && players.length > 1 && onSwitchPlayer && (
          // shrink-0 on the ROW as well as the chips and avatars.
          //
          // The row is a flex item of the max-h-modal panel, and `overflow-x-auto`
          // computes overflow-y to `auto` too — so (a) its automatic minimum size
          // resolves to 0 instead of its content height, letting it be squashed,
          // and (b) being a scrollport it then CLIPS the chips rather than
          // overflowing them. Measured before this class: the row collapsed to
          // 40px at 1280x800 (losing exactly its py-2) and to 24px at 740x420,
          // slicing the 40px pills — "the border is too high and it cuts off the
          // names". SharedRoundFullCard already wraps its own scrolling tab strip
          // in a shrink-0 parent for this reason; this row merged both roles and
          // was missed.
          <div className="shrink-0 bg-surface-muted border-b border-border px-3 py-2 flex gap-2 overflow-x-auto scrollbar-hide">
            {players.map(p => {
              const active = p.participantId === participantId;
              return (
                <button
                  key={p.participantId}
                  onClick={() => handleSwitchPlayer(p.participantId)}
                  disabled={savingHole !== null}
                  className={`flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 min-h-[40px] rounded-full text-xs font-bold whitespace-nowrap transition-all border-2 disabled:opacity-60 ${
                    active
                      ? 'bg-green-600 text-white border-green-700 shadow'
                      : 'bg-surface text-secondary border-border-strong hover:border-green-400'
                  }`}
                >
                  {p.avatarUrl ? (
                    <Image
                      src={p.avatarUrl}
                      alt=""
                      width={20}
                      height={20}
                      className="w-5 h-5 shrink-0 rounded-full object-cover"
                      unoptimized={!isOptimizableImageSrc(p.avatarUrl)}
                    />
                  ) : (
                    <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] ${active ? 'bg-white/25' : 'bg-surface-sunken'}`}>
                      {p.name.charAt(0)}
                    </span>
                  )}
                  {p.isSelf ? 'You' : p.name.split(' ')[0]}
                  <span className={active ? 'opacity-80' : 'text-faint'}>· {p.holesCompleted}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Progress Bar */}
        <div className="bg-surface-sunken h-2">
          <div
            className="bg-green-600 h-full transition-all duration-300"
            style={{ width: `${(holesCompleted / holesPlayed) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
          {/* Current Hole Display */}
          <div className="text-center mb-6">
            <div className="text-5xl font-black text-green-900 dark:text-green-100 mb-2">
              Hole {currentHoleData.hole_number}
            </div>
            <div className="text-sm text-tertiary">
              {courseName && <span className="font-semibold">{courseName} · </span>}
              Par {currentHoleData.par}
              {(() => {
                const yardage = courseHoleData?.find(
                  h => h.hole === currentHoleData.hole_number
                )?.yardage;
                return yardage ? <span className="text-muted"> · {yardage} yds</span> : null;
              })()}
            </div>
          </div>

          {/* Strokes + Putts, side by side. Each wheel RESTS on the common
              answer — this hole's par, and two putts — so a routine hole is
              zero interaction and only a different result needs a flick.

              The resting position is NOT a value. currentHoleData.strokes
              stays null until the user scrolls a wheel or advances past the
              hole (see DEFAULTS below), because `strokes === null` is the only
              thing separating "played" from "not played" anywhere in this app:
              it gates the autosave, persistHole, the batch submit filter, the
              resume position and the progress bar — and downstream a
              golf_hole_scores ROW EXISTING is what "hole played" means, with
              holes_completed a raw COUNT(*) in a DB trigger. Writing a default
              in here would flip rounds to `completed` (terminal — they cannot
              be reopened) and mirror invented even-par rounds into permanent
              history and handicap data. */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <NumberWheel
              label="Strokes"
              min={STROKES_MIN}
              max={STROKES_MAX}
              value={currentHoleData?.strokes ?? null}
              defaultValue={restingStrokes}
              onChange={handleStrokeClick}
              tone="green"
            />
            <NumberWheel
              label="Putts"
              min={PUTTS_MIN}
              max={PUTTS_MAX}
              value={currentHoleData?.putts ?? null}
              defaultValue={PUTTS_DEFAULT}
              onChange={handlePuttClick}
              tone="brand"
            />
          </div>

          {/* Optional Stats */}
          <div className="border-t border-border pt-4 mb-4">
            <div className="text-xs font-bold text-secondary mb-2">Optional Stats</div>
            <div className="flex gap-2">
              <button
                onClick={() => updateCurrentHole('fairway_hit', !currentHoleData.fairway_hit)}
                className={`flex-1 py-2 px-3 min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                  currentHoleData.fairway_hit
                    ? 'bg-green-600 text-white'
                    : 'bg-surface-sunken text-secondary hover:bg-border'
                }`}
              >
                <i className="fas fa-check mr-1"></i>
                FIR
              </button>
              <button
                onClick={() => updateCurrentHole('green_in_regulation', !currentHoleData.green_in_regulation)}
                className={`flex-1 py-2 px-3 min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                  currentHoleData.green_in_regulation
                    ? 'bg-green-600 text-white'
                    : 'bg-surface-sunken text-secondary hover:bg-border'
                }`}
              >
                <i className="fas fa-check mr-1"></i>
                GIR
              </button>
            </div>

            {/* Penalties — type + count entry; rows below aggregate per type */}
            <div className="mt-4" ref={penaltiesSectionRef}>
              <label className={GOLF_LABEL} htmlFor="penalty-type-select">Penalties</label>
              <div className="flex items-center gap-2">
                <select
                  id="penalty-type-select"
                  value={penaltyType}
                  onChange={e => setPenaltyType(e.target.value)}
                  className={GOLF_SELECT}
                >
                  <option value="">Add penalty…</option>
                  {PENALTY_TYPES.map(type => (
                    <option key={type} value={type}>{PENALTY_LABELS[type]}</option>
                  ))}
                </select>
                {/* w-16 wrapper (not on the input): GOLF_INPUT_COMPACT carries
                    w-full, and utility precedence comes from stylesheet order,
                    so a sibling w-16 on the input can't reliably win. */}
                <div className="w-16 shrink-0">
                  <input
                    type="number"
                    min={1}
                    max={9}
                    value={penaltyCount}
                    onChange={e => setPenaltyCount(e.target.value ? Number(e.target.value) : 1)}
                    className={GOLF_INPUT_COMPACT}
                    aria-label="How many times"
                  />
                </div>
                <button
                  onClick={handleAddPenalty}
                  disabled={!isPenaltyType(penaltyType)}
                  className="shrink-0 py-2 px-3 min-h-[40px] rounded-lg text-sm font-semibold bg-surface-sunken text-secondary hover:bg-border transition-colors disabled:opacity-50"
                >
                  <i className="fas fa-plus mr-1"></i>
                  Add
                </button>
              </div>
              {(currentHoleData.penalties?.length ?? 0) > 0 && (
                <div className="mt-2 space-y-1.5">
                  {aggregatePenalties(currentHoleData.penalties).map(({ type, count }) => (
                    <div
                      key={type}
                      className="flex items-center justify-between bg-surface-sunken rounded-lg px-3 py-1.5 text-sm text-primary"
                    >
                      <span>
                        {PENALTY_LABELS[type]}
                        {count > 1 && <span className="text-tertiary font-semibold"> ×{count}</span>}
                      </span>
                      <button
                        onClick={() => handleRemovePenalty(type)}
                        className="-my-1.5 -mr-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-tertiary hover:text-primary"
                        aria-label={`Remove ${PENALTY_LABELS[type]} penalties`}
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Hole photo/video (live rounds) */}
          {canAttachMedia && (
            <div className="mb-4">
              <input
                ref={mediaInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={e => handleMediaSelect(e.target.files?.[0])}
              />
              <button
                onClick={() => mediaInputRef.current?.click()}
                disabled={uploadingMedia}
                className="w-full py-2.5 px-3 min-h-[40px] rounded-lg text-sm font-semibold bg-surface-sunken text-secondary hover:bg-border transition-colors disabled:opacity-60"
              >
                {uploadingMedia ? (
                  <><i className="fas fa-spinner fa-spin mr-2"></i>Uploading…</>
                ) : (
                  <>
                    <i className="fas fa-camera mr-2"></i>
                    Add photo or video to hole {currentHoleData.hole_number}
                    {(mediaCountByHole[currentHoleData.hole_number ?? -1] ?? 0) > 0 && (
                      <span className="ml-2 text-green-700 dark:text-green-300 font-bold">
                        <i className="fas fa-check mr-1"></i>
                        {mediaCountByHole[currentHoleData.hole_number ?? -1]}
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm mb-4">
              {error}
            </div>
          )}

          {/* Current Totals */}
          <div className="bg-surface-muted rounded-lg p-4 mb-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xs text-tertiary mb-1">Holes</div>
                <div className="text-xl font-black text-primary">{holesCompleted}/{holesPlayed}</div>
              </div>
              <div>
                <div className="text-xs text-tertiary mb-1">Strokes</div>
                <div className="text-xl font-black text-primary">{totalStrokes}</div>
              </div>
              <div>
                <div className="text-xs text-tertiary mb-1">Putts</div>
                <div className="text-xl font-black text-primary">{totalPutts}</div>
              </div>
            </div>
          </div>

          {/* Hole Navigation Grid */}
          <div>
            <div className="text-xs font-bold text-secondary mb-2">Jump to Hole:</div>
            <div className="grid grid-cols-6 sm:grid-cols-9 gap-1">
              {Array.from({ length: holesPlayed }, (_, i) => i + 1).map(holeNum => {
                const hole = holeData[holeNum - 1];
                const hasScore = hole.strokes !== null;
                const isCurrent = holeNum === currentHole;
                const isSaved = isLive && savedHoles.has(holeNum) && !dirtyHoles.has(holeNum);

                return (
                  <button
                    key={holeNum}
                    onClick={() => handleJumpToHole(holeNum)}
                    disabled={savingHole !== null}
                    className={`relative py-2 px-1 min-h-[40px] rounded text-xs font-bold transition-colors disabled:opacity-60 ${
                      isCurrent
                        ? 'bg-green-600 text-white ring-2 ring-green-800'
                        : hasScore
                        ? 'bg-violet-100 text-violet-900 hover:bg-violet-200 dark:bg-violet-950/60 dark:text-violet-200 dark:hover:bg-violet-900/60'
                        : 'bg-surface-sunken text-tertiary hover:bg-border'
                    }`}
                    title={isSaved ? 'Saved' : undefined}
                  >
                    {hole.hole_number}
                    {isSaved && !isCurrent && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
                        <i className="fas fa-check text-white" style={{ fontSize: '7px' }}></i>
                      </span>
                    )}
                    {/* Penalty count — top-LEFT corner (the saved check owns
                        the right one) */}
                    {totalPenalties(hole.penalties) > 0 && (
                      <span className="absolute -top-1 -left-1 text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                        {totalPenalties(hole.penalties)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Navigation. safe-bottom: this is the primary live-scoring
            control, used one-handed on a course — without it Previous/Next/
            Done sit under the iOS home indicator. */}
        <div className="bg-surface-sunken border-t border-border-strong p-4 safe-bottom">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={handlePrevious}
              disabled={currentHole === 1 || savingHole !== null}
              className="flex-1 bg-surface-sunken hover:bg-border disabled:opacity-50 disabled:cursor-not-allowed text-secondary font-bold py-3 px-4 rounded-lg transition-colors"
            >
              <i className="fas fa-chevron-left mr-2"></i>
              Previous
            </button>

            {currentHole < holesPlayed ? (
              <button
                onClick={handleNext}
                disabled={savingHole !== null}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-bold py-3 px-4 rounded-lg transition-colors"
              >
                {savingHole === currentHole ? (
                  <><i className="fas fa-spinner fa-spin mr-2"></i>Saving…</>
                ) : (
                  <>Next<i className="fas fa-chevron-right ml-2"></i></>
                )}
              </button>
            ) : isLive ? (
              <button
                onClick={() => handleDone(true)}
                disabled={saving || savingHole !== null}
                className="flex-1 bg-brand hover:bg-brand-hover disabled:bg-violet-400 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors"
              >
                {saving || savingHole !== null ? (
                  <><i className="fas fa-spinner fa-spin mr-2"></i>Saving…</>
                ) : (
                  <><i className="fas fa-check mr-2"></i>Done</>
                )}
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-brand hover:bg-brand-hover disabled:bg-violet-400 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors"
              >
                {saving ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Saving...
                  </>
                ) : (
                  <>
                    <i className="fas fa-save mr-2"></i>
                    Save Scores
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Shared media editor for hole photos/clips (z-[65]) */}
      {holeEditorAssets && (
        <MediaEditor
          assets={holeEditorAssets}
          config={HOLE_MEDIA_EDITOR_CONFIG}
          onDone={handleHoleMediaDone}
          onCancel={() => {
            setHoleEditorAssets(null);
            if (mediaInputRef.current) mediaInputRef.current.value = '';
          }}
        />
      )}
    </div>
  );
}
