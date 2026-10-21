// ── The finish flow's device draft (Training fixes PR 4, Oct 21 2026) ────────
// Tom: "a finished workout must be saved as a draft until it's posted or the
// user deletes it … When the user comes back, they return to the step where
// they left off." The SESSION is the server's (completed, undecided); what
// only the screen knew — the step, the caption, the confirmed PRs, the clips'
// order — is kept here on the device, keyed by the session, and cleared by
// Post, Done or Delete. The draft.ts recipe: versioned, TTL'd, fail-open.
// Zero imports.

export type FinishStep = 'editing' | 'summary' | 'preview';

export interface FinishDraft {
  v: 1;
  sessionId: string;
  savedAt: number;
  step: FinishStep;
  caption: string;
  /** The confirmed body-metric PR keys (a Set on the screen). */
  checkedPRs: string[];
  /** The post's carousel order — clip URLs (share-media.ts). */
  shareOrder: string[];
}

/** 7 days — the retention every unfinished session has. */
export const FINISH_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function finishDraftKey(sessionId: string): string {
  return `ea:workout-finish:v1:${sessionId}`;
}

const STEPS: ReadonlySet<string> = new Set(['editing', 'summary', 'preview']);

export function isFinishStep(v: unknown): v is FinishStep {
  return typeof v === 'string' && STEPS.has(v);
}

/** The step a URL asks for: `?step=summary|preview`, or the Oct 2026 alias `?share=1` (the preview). Anything else is the editor. */
export function stepFromSearch(search: string | null | undefined): FinishStep {
  if (!search) return 'editing';
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const step = params.get('step');
    if (isFinishStep(step) && step !== 'editing') return step;
    if (params.get('share') === '1') return 'preview';
  } catch {
    /* a malformed query is the editor */
  }
  return 'editing';
}

export function parseFinishDraft(raw: string | null, sessionId: string, now: number = Date.now()): FinishDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<FinishDraft>;
    if (d.v !== 1 || d.sessionId !== sessionId) return null;
    if (typeof d.savedAt !== 'number' || now - d.savedAt > FINISH_DRAFT_TTL_MS) return null;
    return {
      v: 1,
      sessionId,
      savedAt: d.savedAt,
      step: isFinishStep(d.step) ? d.step : 'preview',
      caption: typeof d.caption === 'string' ? d.caption.slice(0, 2000) : '',
      checkedPRs: Array.isArray(d.checkedPRs) ? d.checkedPRs.filter((k): k is string => typeof k === 'string') : [],
      shareOrder: Array.isArray(d.shareOrder) ? d.shareOrder.filter((u): u is string => typeof u === 'string') : [],
    };
  } catch {
    return null;
  }
}

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readFinishDraft(sessionId: string, now: number = Date.now()): FinishDraft | null {
  if (typeof window === 'undefined') return null;
  return parseFinishDraft(storageGet(finishDraftKey(sessionId)), sessionId, now);
}

export function writeFinishDraft(sessionId: string, data: Omit<FinishDraft, 'v' | 'sessionId' | 'savedAt'>, now: number = Date.now()): void {
  try {
    const draft: FinishDraft = { v: 1, sessionId, savedAt: now, ...data };
    window.localStorage.setItem(finishDraftKey(sessionId), JSON.stringify(draft));
  } catch {
    /* best-effort */
  }
}

export function clearFinishDraft(sessionId: string): void {
  try {
    window.localStorage.removeItem(finishDraftKey(sessionId));
  } catch {
    /* best-effort */
  }
}
