'use client';

import { useEffect, useRef, useState } from 'react';
import HolePlate from '@/components/golf/scoring/HolePlate';
import StrokesDial from '@/components/golf/scoring/StrokesDial';
import { HoleKeys, PlayerTabs, PuttsCapsule, RoundBadge, ScoreFooter, StatLamp, TotalsStrip, type PlayerTab } from '@/components/golf/scoring/ScoreControls';
import { ActionRow, PenaltyEntryRow, PenaltyStack } from '@/components/golf/scoring/PenaltyParts';
import { CloseIcon } from '@/components/golf/scoring/icons';
import { groupScoresForHole, holeHeaderFacts, liveLine, teeSheetForHole, type GroupPlayer, type TeeSheetSource } from '@/lib/golf/hole-detail';
import type { HoleLine, GreenRing } from '@/lib/golf/hole-geometry';
import type { HoleElevation } from '@/lib/golf/elevation';
import { holePar } from '@/lib/golf/scoring';
import { cardTotals, confirmedScore, holeKeyRows, maxPutts, nextHoleNumber, shownScore, withPutts, withStrokes } from '@/lib/golf/score-card';
import { playerColour } from '@/lib/golf/player-colour';
import {
  firstUnscoredHole,
  readDraft,
  writeDraft,
  removeHoleFromDraft,
  clearDraft,
  mergeDraftIntoHoles,
  holeNumberAtPosition,
  type DraftHole,
} from '@/lib/golf/score-entry';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { penaltyColumns, penaltyEntries, totalPenaltyStrokes, type PenaltyEntry } from '@/lib/golf/penalties';
import type { GolfHoleScore } from '@/types/group-posts';
import type { HoleData } from '@/types/golf';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import { uploadPostMedia } from '@/lib/media/upload';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';
import { MAX_UPLOAD_BYTES } from '@/lib/media/upload-rules';

const HOLE_MEDIA_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['free', '1:1', '4:5', '9:16', '16:9'],
  allowVideo: true, // trim/split/cover via WebCodecs; degrades to pass-through without it
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

// The most penalties one hole can carry — validatePenalties' own cap.
const PENALTIES_MAX = 20;

interface ScoreEntryModalProps {
  groupPostId: string;
  participantId: string;
  holesPlayed: number;
  /** First hole number (10 for back-9 rounds). Defaults to 1. */
  startingHoleNumber?: number;
  /** Per-hole course data (real pars/yardage). Absent → par-4 fallback. */
  holeData?: { hole: number; par: number; yardage?: number; handicap?: number; parEstimated?: boolean }[] | null;
  /** Course name for the hole context line ("Hole 3 · Eagle Creek · Par 4"). */
  courseName?: string | null;
  /** All players in the round (creator view) — renders the switcher chips.
   *  The current hole is persisted before any switch. */
  players?: ScoreEntryPlayer[];
  /** `holeNumber`: the hole on screen when the chip was tapped. The next
   *  player's card opens on THAT hole (Nov 19 2026), not on their first
   *  unscored one. */
  onSwitchPlayer?: (participantId: string, holeNumber: number) => void;
  /** The round's status, so the badge says what the round is (Nov 19 2026): a
   *  completed round reads Final, never LIVE. Absent = live while it saves. */
  roundStatus?: 'pending' | 'active' | 'completed' | 'cancelled';
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
    penalty_strokes?: number[] | null;
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
    penalty_strokes?: number[] | null;
  }) => Promise<void>;
  onClose: () => void;
  /** Renders a map button in the header that closes the scorer (same
   *  save-state path as the X) and hands off to the caller's map view. The
   *  live portal's Map tab is otherwise invisible behind the auto-opened
   *  scorer — this is its discoverability affordance mid-round. */
  /** Opens the course map ON the hole the scorer is showing (a hole NUMBER). */
  onShowMap?: (holeNumber: number) => void;
  // ── The hole header (PR E) — every one optional; the composer's batch
  //    stepper and the feed card pass none and render as before. ──
  /** golf_data.tee_color — the tee in play ("white"). */
  teeInPlay?: string | null;
  /** The catalog's tee sheet (`?holes=1`'s `sheet`). */
  teeSheet?: TeeSheetSource | null;
  /** The hole lines the map draws (trimmed to the tee in play). */
  holeLines?: HoleLine[] | null;
  /** PR 3: the green outlines beside the lines — a numbered ring without a
   *  line, or the unnumbered rings of a greens-only course. */
  greens?: GreenRing[] | null;
  /** The cached elevation profiles (`?holes=1`'s `elevation`). */
  holeElevation?: HoleElevation | null;
  /** The map's live GPS fix, published up — the scorer never prompts. */
  fix?: [number, number] | null;
  /** Everyone's hole scores, for "Sam 5 · Alex 4" on this hole and a tab's score to par. */
  group?: GroupPlayer[];
  /** The course's position, for the map preview of a hole without a line. */
  courseAt?: [number, number] | null;
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
  roundStatus,
  uploaderId,
  playerName,
  existingScores = [],
  initialHole,
  focusSection,
  onSave,
  onSaveHole,
  onClose,
  onShowMap,
  teeInPlay = null,
  teeSheet = null,
  holeLines = null,
  greens = null,
  holeElevation = null,
  fix = null,
  group,
  courseAt = null,
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
        penalty_strokes: existing?.penalty_strokes ?? null,
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

  // Opened from a penalty badge: the penalty entry is already in place of the
  // action row (X3 — there is no always-visible penalty form to scroll to).
  const [penaltyOpen, setPenaltyOpen] = useState(focusSection === 'penalties');

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
  // What the card SHOWS for this hole: its own values, else par and 2 putts
  // (A3 — score-card.ts). Par falls back to 4 when the round carries no
  // course hole data (scoring.ts holePar).
  const shown = shownScore(currentHoleData);

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
      // No `expected_version` here (nor on this modal's saves or the composer's): the solo
      // scorer's card has one writer, so these stay unchecked — last writer wins (209).
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
              // Named even when empty: an absent key leaves the stored penalties alone,
              // so removing the last one never reached the server (fixed Nov 25 2026).
              penalties: hole.penalties ?? [],
              penalty_strokes: hole.penalties?.length ? hole.penalty_strokes ?? null : null,
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
          penalty_strokes: h.penalty_strokes ?? null,
        };
      }
    }
    writeDraft(participantId, draftHoles);
    return next[currentHole - 1] ?? null;
  };

  // ── A4: when a hole is RECORDED ────────────────────────────────────────────
  // A change of strokes or putts, or a tap on either number, writes BOTH
  // numbers at once (score-card.ts) — the hole has strokes from that moment,
  // which is the one meaning of "recorded" everywhere in golf. Putts follow
  // the strokes down when they would exceed them (the scores API refuses
  // putts > strokes: a hole in one with the resting 2 putts could not save).
  const handleStrokes = (strokes: number) => { patchCurrentHole(withStrokes(currentHoleData, strokes)); };
  const handlePutts = (putts: number) => { patchCurrentHole(withPutts(currentHoleData, putts)); };
  const handleConfirm = () => { patchCurrentHole(confirmedScore(currentHoleData)); };
  // FIR / GIR start off on every hole (null) and are on or off — never a
  // third state. Neither records a hole by itself.
  const toggleStat = (field: 'fairway_hit' | 'green_in_regulation') => {
    patchCurrentHole({ [field]: currentHoleData[field] === true ? false : true } as Partial<HoleData>);
  };

  // ── Penalties: a TYPE and its STROKES each (migration 320) ────────────────
  // One row per penalty, in the order added; they belong to this hole and
  // this player. Descriptive: the strokes on the dial are the golfer's total
  // and are never changed here. A penalty alone does not record a hole.
  const penalties = penaltyEntries(currentHoleData.penalties, currentHoleData.penalty_strokes);
  const writePenalties = (entries: PenaltyEntry[]) => {
    const cols = penaltyColumns(entries);
    patchCurrentHole({ penalties: cols.penalties.length > 0 ? cols.penalties : null, penalty_strokes: cols.penalty_strokes });
  };
  const handleAddPenalty = (entry: PenaltyEntry) => {
    writePenalties([...penalties, entry].slice(0, PENALTIES_MAX));
    setPenaltyOpen(false);
  };
  const handleRemovePenalty = (index: number) => {
    writePenalties(penalties.filter((_, i) => i !== index));
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
        penalties: hole.penalties ?? [],
        penalty_strokes: hole.penalties?.length ? hole.penalty_strokes ?? null : null,
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

  // ── Next records what is shown (A4) ───────────────────────────────────────
  // Next — and the last hole's finish — saves whatever strokes and putts are
  // showing, the defaults included: a par with two putts needs no input.
  // Leaving a hole any OTHER way (Previous, a jump key, the map, the X, a
  // player tab) records nothing new: a hole that was only looked at has no
  // strokes, so it counts in no total, gets no check mark, and cannot carry a
  // round to `completed` just by being paged through (a golf_hole_scores row
  // EXISTING is what "played" means downstream).
  const commitShown = (): HoleData | null => {
    const hole = holeData[currentHole - 1];
    if (!hole) return null;
    if (typeof hole.strokes === 'number' && typeof hole.putts === 'number') return null;
    return patchCurrentHole(confirmedScore(hole));
  };

  const handleNext = async () => {
    const committed = commitShown();
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
    const committed = commitCurrent ? commitShown() : null;
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
  //
  // Nov 19 2026 (Tom: "switching players resets to hole 1"). Two faults, both
  // here. (1) The switch told the parent WHO but not WHERE, so the next
  // player's card opened on their first unscored hole: any gap earlier in
  // their card, and the scorer jumped back to it. The hole on screen now
  // travels with the switch. (2) A hole left by a chip was saved without the
  // resting wheel being committed, where Next commits it: set strokes, leave
  // putts, tap another player, and that hole was never written, which made
  // the very gap that (1) then jumped to. A switch is a confirmation of the
  // hole exactly as Next is (an untouched hole still records nothing).
  const handleSwitchPlayer = async (nextParticipantId: string) => {
    if (!onSwitchPlayer || nextParticipantId === participantId) return;
    const holeOnScreen = holeNumberAtPosition(startingHoleNumber, currentHole);
    if (isLive) {
      // A tab is not Next: it saves what is recorded and records nothing new.
      if (!(await persistHole(currentHole))) return;
    } else {
      // Batch mode (composer grid): the parent only receives scores through
      // onSave, and the switch remounts the modal — flush everything entered
      // first, with the same resting-wheel commit rules as Save Scores.
      const scores = collectCompletedScores(holeData);
      if (scores.length > 0) {
        setSaving(true);
        setError(null);
        try {
          await onSave(scores);
          clearDraft(participantId);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to save scores');
          return;
        } finally {
          setSaving(false);
        }
      }
    }
    onSwitchPlayer(nextParticipantId, holeOnScreen);
  };

  // Hole photos/videos (live rounds only): upload → attach to this hole.
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
      maxBytes: MAX_UPLOAD_BYTES,
      allowVideo: true,
      maxCount: 1,
    });
    if (rejected.length > 0) {
      setError(rejected[0].message);
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
    }
  };

  const activePlayer = players?.find(p => p.participantId === participantId) ?? null;
  const enteringForOther = activePlayer ? !activePlayer.isSelf : !!playerName;

  // ── The hole header's inputs (PR E) — one ladder shared with the map chip
  //    (hole-detail.ts); every input optional, so the batch stepper and the
  //    feed card see the same header they always had, minus nothing. ──
  const headerHoleNumber = currentHoleData.hole_number ?? holeNumberAtPosition(startingHoleNumber, currentHole);
  const headerHole = holeLines?.find(h => h.hole === headerHoleNumber) ?? null;
  const headerLine = headerHole?.line ?? null;
  const headerFacts = holeHeaderFacts({
    hole: headerHoleNumber,
    holeData: courseHoleData,
    sheet: teeSheet,
    teeInPlay,
    line: headerLine,
    fallbackPar: currentHoleData.par,
  });
  const headerTees = teeSheetForHole(teeSheet, headerHoleNumber, teeInPlay);
  const headerLive = liveLine({
    fix,
    line: headerLine,
    green: headerHole?.green ?? greens?.find(g => g.hole === headerHoleNumber)?.ring ?? null,
    nearestRings: greens?.filter(g => g.hole == null).map(g => g.ring) ?? null,
    profile: holeElevation?.holes.find(h => h.hole === headerHoleNumber) ?? null,
    cardYards: courseHoleData?.find(h => h.hole === headerHoleNumber)?.yardage ?? null,
  });
  const headerGroup = groupScoresForHole(group, headerHoleNumber, participantId);
  // The Map pill's path and the thumbnail's are ONE: save first (a failed
  // flush keeps the scorer open instead of stranding it over the map), close,
  // then hand the page the hole the player is on.
  const goToMap = async () => {
    if (!onShowMap) return;
    if (isLive) {
      setSaving(true);
      const ok = await persistHole(currentHole);
      setSaving(false);
      if (!ok) return;
    }
    onClose();
    // After onClose on purpose: the page's close clears its viewed hole, and
    // this sets the one the player is on.
    onShowMap(holeNumberAtPosition(startingHoleNumber, currentHole));
  };

  /** Batch-mode payload: every hole with a recorded stroke count, in the
   *  shape onSave expects. Shared by Save Scores and the player switch. */
  const collectCompletedScores = (effective: HoleData[]) =>
    effective
      .filter(h => h.strokes !== null)
      .map(h => ({
        hole_number: h.hole_number!,
        strokes: h.strokes!,
        putts: h.putts ?? undefined,
        fairway_hit: h.fairway_hit ?? undefined,
        green_in_regulation: h.green_in_regulation ?? undefined,
        penalties: h.penalties ?? [],
        penalty_strokes: h.penalties?.length ? h.penalty_strokes ?? null : null,
      }));

  const handleSave = async () => {
    // "Save Scores" is the explicit finish in batch mode, so it commits the
    // current hole's resting wheels like the live Done button does. Work from
    // the returned array rather than `holeData` — the state update has not
    // landed yet, so the freshly committed hole would otherwise be dropped by
    // the strokes !== null filter below.
    const committed = commitShown();
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
      const scores = collectCompletedScores(effective);

      await onSave(scores);
      clearDraft(participantId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save scores');
      setSaving(false);
    }
  };

  // ── What the card draws ────────────────────────────────────────────────────
  const totals = cardTotals(holeData);
  const recorded = new Set(holeData.filter(h => typeof h.strokes === 'number' && h.hole_number != null).map(h => h.hole_number as number));
  // A colour per player, by their place in the round (player-colour.ts); a
  // card with no tabs wears the first.
  const activeIndex = players ? Math.max(0, players.findIndex(p => p.participantId === participantId)) : 0;
  const activeColour = playerColour(activeIndex);
  const showTabs = !!players && players.length > 1 && !!onSwitchPlayer;
  const tabs: PlayerTab[] = showTabs
    ? players.map((p, i) => {
        // The open card's own number is the one on screen; the others' come
        // from the round's scores.
        const theirs = p.participantId === participantId
          ? totals.toPar
          : cardTotals((group?.find(g => g.participantId === p.participantId)?.holeScores ?? []).map(h => ({ strokes: h.strokes, putts: null, par: holePar(h.hole_number, courseHoleData) }))).toPar;
        return { participantId: p.participantId, name: p.isSelf ? 'You' : p.name.split(' ')[0] || p.name, fullName: p.name, avatarUrl: p.avatarUrl, colour: playerColour(i), toPar: theirs };
      })
    : [];
  const nextNumber = nextHoleNumber(currentHole, holesPlayed, startingHoleNumber);
  const lastLabel = !isLive ? 'Save Scores' : roundStatus === 'completed' ? 'Done' : 'Finish round';
  const busy = saving || savingHole !== null;
  const status = savingHole !== null || saving ? 'Saving…' : isLive && savedHoles.has(currentHole) && !dirtyHoles.has(currentHole) ? 'Saved' : null;

  return (
    // z-[60] — the house convention for overlays that stack above a z-50
    // modal (ConfirmModal, TagPeopleModal). MediaEditor inside stays above at
    // z-[65]. The mechanical dialect (Tom's live-round spec, Nov 25 2026): a
    // full screen on a phone, a centred dialog from 640 px, two columns from
    // 900 px. The top line, the tabs and the footer stay put; the middle
    // scrolls only when it does not fit.
    <div className="ea-mech ea-mech-overlay fixed inset-0 z-[60] flex items-stretch justify-center sm:items-center sm:p-4" data-score-card="">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-card-title"
        className="ea-mech-dialog ea-mech-scorecard flex w-full flex-col sm:py-5"
      >
        {/* C1 — the top line */}
        <div className="flex h-11 shrink-0 items-center gap-2.5 px-4 pt-[env(safe-area-inset-top)] sm:px-5 sm:pt-0 box-content sm:box-border">
          <h2 id="score-card-title" className="text-[17px] font-bold text-[color:var(--mech-text)]">Scores</h2>
          {isLive && <RoundBadge status={roundStatus === 'completed' ? 'final' : 'live'} />}
          {enteringForOther && !showTabs && (
            <span className="ea-mech-micro min-w-0 truncate" data-scorer-for="">for {activePlayer?.name ?? playerName}</span>
          )}
          <span className="ea-mech-micro ml-auto shrink-0" aria-live="polite" data-scorer-save-state="">{status}</span>
          <button
            type="button"
            onClick={() => (isLive ? handleDone(false) : onClose())}
            disabled={saving}
            aria-label="Close"
            className="ea-mech-close inline-flex shrink-0 items-center justify-center disabled:opacity-50"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* C2 — the player tabs: the whole card follows the selected player */}
        {showTabs && (
          <div className="shrink-0 px-4 pb-1 pt-1.5 sm:px-5">
            <PlayerTabs tabs={tabs} selectedId={participantId} onSelect={id => { void handleSwitchPlayer(id); }} disabled={busy} />
          </div>
        )}

        <div className="ea-mech-scroll min-h-0 flex-1 overflow-y-auto px-4 py-2.5 sm:px-5" data-scorer-body="">
          <div className="ea-mech-scorecard-grid">
            <div className="flex min-w-0 flex-col gap-2.5">
              <HolePlate
                holeNumber={headerHoleNumber}
                facts={headerFacts}
                tees={headerTees}
                teeInPlay={teeInPlay}
                live={headerLive}
                courseName={courseName}
                line={headerLine}
                courseAt={courseAt}
                onOpenMap={onShowMap ? goToMap : undefined}
              />
              {headerGroup.length > 0 && (
                <p className="text-xs text-[color:var(--mech-text-soft)]" data-hole-group="">
                  {headerGroup.map((g, i) => (
                    <span key={g.label}>{i > 0 ? ' · ' : ''}{g.label} <span className="ea-mech-readout">{g.strokes}</span></span>
                  ))}
                </p>
              )}

              {/* C4 – C6 — the scoring cluster: dial, putts, lamps */}
              <div className="flex items-center gap-2.5 max-[389px]:gap-2" data-scoring-cluster="">
                <div className="min-w-0 max-w-[190px] flex-1">
                  <StrokesDial strokes={shown.strokes} par={currentHoleData.par} onChange={handleStrokes} onConfirm={handleConfirm} disabled={busy} />
                </div>
                <PuttsCapsule putts={shown.putts} max={maxPutts(currentHoleData)} onChange={handlePutts} onConfirm={handleConfirm} disabled={busy} />
                <div className="flex shrink-0 flex-col gap-4">
                  <StatLamp label="FIR" caption="Fairway" on={currentHoleData.fairway_hit === true} onToggle={() => toggleStat('fairway_hit')} disabled={busy} />
                  <StatLamp label="GIR" caption="Green" on={currentHoleData.green_in_regulation === true} onToggle={() => toggleStat('green_in_regulation')} disabled={busy} />
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2.5">
              {/* C7 — the action row; X3: the penalty entry takes its place */}
              {penaltyOpen ? (
                <PenaltyEntryRow onAdd={handleAddPenalty} onCancel={() => setPenaltyOpen(false)} full={penalties.length >= PENALTIES_MAX} />
              ) : (
                <ActionRow
                  penaltyStrokes={totalPenaltyStrokes(currentHoleData.penalties, currentHoleData.penalty_strokes)}
                  onPenalty={() => setPenaltyOpen(true)}
                  onMedia={handleMediaSelect}
                  mediaEnabled={canAttachMedia}
                  mediaBusy={uploadingMedia}
                  mediaCount={mediaCountByHole[headerHoleNumber] ?? 0}
                />
              )}

              <TotalsStrip totals={totals} holesPlayed={holesPlayed} />

              <HoleKeys
                rows={holeKeyRows(holesPlayed, startingHoleNumber)}
                current={headerHoleNumber}
                recorded={recorded}
                colour={activeColour}
                onJump={n => { void handleJumpToHole(n - startingHoleNumber + 1); }}
                disabled={busy}
              />

              <PenaltyStack entries={penalties} onRemove={handleRemovePenalty} disabled={busy} />

              {uploadingMedia && <p className="ea-mech-micro" role="status">Adding to hole {headerHoleNumber}…</p>}
              {error && (
                <p className="rounded-xl px-3 py-2 text-[13px] text-[color:var(--mech-text)]" style={{ backgroundColor: 'var(--mech-danger-fill)', boxShadow: 'inset 0 0 0 1px var(--mech-danger-ring)' }} role="alert" data-scorer-error="">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* C9 — the footer */}
        <div className="shrink-0 px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-2.5 sm:px-5 sm:pb-0">
          <ScoreFooter
            onPrevious={() => { void handlePrevious(); }}
            onNext={() => {
              if (nextNumber !== null) void handleNext();
              else if (isLive) void handleDone(true);
              else void handleSave();
            }}
            nextLabel={nextNumber !== null ? `Hole ${nextNumber}` : lastLabel}
            first={currentHole === 1}
            busy={busy}
            busyLabel="Saving…"
          />
        </div>
      </div>

      {/* Shared media editor for hole photos/clips (z-[65]) */}
      {holeEditorAssets && (
        <MediaEditor
          assets={holeEditorAssets}
          config={HOLE_MEDIA_EDITOR_CONFIG}
          onDone={handleHoleMediaDone}
          onCancel={() => setHoleEditorAssets(null)}
        />
      )}
    </div>
  );
}
