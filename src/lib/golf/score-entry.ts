// ── Score-entry session logic ─────────────────────────────────────────────────
// Pure helpers behind ScoreEntryModal, extracted so the resume/durability rules
// are unit-testable (the modal itself has no test harness — no jsdom).

/**
 * The 1-based POSITION (index into the modal's holeData, not the hole number)
 * of the first hole without a score. Back-9 rounds pass startingHoleNumber=10,
 * so position 1 = hole 10. Gaps count: scored 1-3, skipped 4, scored 5 → 4.
 * Everything scored → the last position (an "Edit Scores" reopen lands on the
 * final hole rather than hole 1).
 */
export function firstUnscoredHole(
  existingScores: Array<{ hole_number: number }>,
  holesPlayed: number,
  startingHoleNumber = 1
): number {
  if (holesPlayed < 1) return 1;
  const scored = new Set(existingScores.map(s => s.hole_number));
  for (let pos = 1; pos <= holesPlayed; pos++) {
    if (!scored.has(startingHoleNumber + pos - 1)) return pos;
  }
  return holesPlayed;
}

// ── Draft persistence ─────────────────────────────────────────────────────────
// A typed-but-not-yet-saved hole lives only in React state; refresh/tab-kill
// loses it. The draft mirrors dirty holes into localStorage so the modal can
// restore them on reopen. Belt (draft) + suspenders (keepalive flush on
// pagehide): iOS doesn't reliably fire pagehide on tab-kill, and localStorage
// can be unavailable in private mode — each mechanism covers the other's gap.

export interface DraftHole {
  strokes: number | null;
  putts: number | null;
  fairway_hit: boolean | null;
  green_in_regulation: boolean | null;
}

export interface ScoreDraft {
  v: 1;
  participantId: string;
  savedAt: number;
  /** Keyed by hole_number (stable across sessions, unlike modal positions). */
  holes: Record<number, DraftHole>;
}

/** Drafts older than this are stale garbage, not a round in progress
 *  (mirrors the round-status LIVE window). */
export const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

export function draftKey(participantId: string): string {
  return `ea:golf-draft:v1:${participantId}`;
}

/**
 * Drafts exist only for participants with a stable id (shared-round scoring).
 * The solo quick-entry renders ScoreEntryModal with participantId="" — an
 * empty id would collapse every solo round onto ONE localStorage key and
 * resurrect round A's typed holes inside round B. No id → no draft.
 */
function canDraft(participantId: string): boolean {
  return participantId.length > 0;
}

/**
 * Parse + validate a raw draft string. Pure (testable without a DOM).
 * Returns null for garbage, wrong participant, or expired drafts.
 */
export function parseDraft(
  raw: string | null,
  participantId: string,
  now: number = Date.now()
): ScoreDraft | null {
  if (!raw || !canDraft(participantId)) return null;
  try {
    const d = JSON.parse(raw) as ScoreDraft;
    if (
      !d || d.v !== 1 ||
      d.participantId !== participantId ||
      typeof d.savedAt !== 'number' ||
      now - d.savedAt > DRAFT_TTL_MS ||
      !d.holes || typeof d.holes !== 'object' || Array.isArray(d.holes)
    ) {
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

/**
 * Merge a draft into the modal's seeded holes. THE RULE: a draft hole applies
 * only when that hole is ABSENT from existingScores — anything the server has
 * was saved as typed, and resurrecting a stale local edit over fresher server
 * data is the worse failure. (Tradeoff: an edit to an already-saved hole that
 * dies with the tab is lost; the keepalive flush covers most of those.)
 * Returns the merged array plus which hole NUMBERS were restored.
 */
export function mergeDraftIntoHoles<T extends { hole_number: number | null } & DraftHole>(
  holes: T[],
  draft: ScoreDraft | null,
  existingScores: Array<{ hole_number: number }>
): { holes: T[]; restored: number[] } {
  if (!draft) return { holes, restored: [] };
  const onServer = new Set(existingScores.map(s => s.hole_number));
  const restored: number[] = [];
  const merged = holes.map(h => {
    if (h.hole_number === null) return h;
    const d = draft.holes[h.hole_number];
    if (!d || onServer.has(h.hole_number)) return h;
    if (d.strokes === null && d.putts === null && d.fairway_hit === null && d.green_in_regulation === null) {
      return h;
    }
    restored.push(h.hole_number);
    return { ...h, strokes: d.strokes, putts: d.putts, fairway_hit: d.fairway_hit, green_in_regulation: d.green_in_regulation };
  });
  return { holes: merged, restored };
}

// ── Storage wrappers (private-mode safe, SSR safe) ────────────────────────────
// Same defensive pattern as GifPicker's recents: localStorage access can throw
// (private mode, quota, disabled) — every touch is try/catch, failure is a
// silent no-op (the draft is best-effort by design).

function storage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch { /* disabled */ }
  return null;
}

export function readDraft(participantId: string, now: number = Date.now()): ScoreDraft | null {
  if (!canDraft(participantId)) return null;
  const s = storage();
  if (!s) return null;
  try {
    return parseDraft(s.getItem(draftKey(participantId)), participantId, now);
  } catch {
    return null;
  }
}

export function writeDraft(
  participantId: string,
  holes: Record<number, DraftHole>,
  now: number = Date.now()
): void {
  if (!canDraft(participantId)) return;
  const s = storage();
  if (!s) return;
  try {
    if (Object.keys(holes).length === 0) {
      s.removeItem(draftKey(participantId));
      return;
    }
    const draft: ScoreDraft = { v: 1, participantId, savedAt: now, holes };
    s.setItem(draftKey(participantId), JSON.stringify(draft));
  } catch { /* best-effort */ }
}

export function removeHoleFromDraft(participantId: string, holeNumber: number): void {
  const existing = readDraft(participantId);
  if (!existing || !(holeNumber in existing.holes)) return;
  const holes = { ...existing.holes };
  delete holes[holeNumber];
  writeDraft(participantId, holes, existing.savedAt);
}

export function clearDraft(participantId: string): void {
  if (!canDraft(participantId)) return;
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(draftKey(participantId));
  } catch { /* best-effort */ }
}
