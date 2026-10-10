// Composer draft persistence (dummy-proofing round). The post composer's
// dirty-close confirm + beforeunload guard cover deliberate exits and
// reload prompts; this covers the crash/eviction case — caption, hashtags,
// tags, sport, visibility AND (since Sep 2026, the G1 follow-up) the golf
// scorecard section survive to the next open, offered back as a
// "restore?" notice, never silently applied. Media Files can't ride
// localStorage; since Oct 10 2026 (maintenance pass) their BYTES wait in the
// device's IndexedDB stash (workouts/media-stash.ts, session `composer`) and
// the draft records how many (`mediaCount`) so a media-only post is offered
// back too. An edit recipe is not kept: a restored file comes back as it was
// attached. Workouts-draft skeleton: versioned key + TTL, pure parse for
// node tests, storage ops no-op on throw.

import type { GolfComposerValue } from '@/components/golf/GolfComposerSection';

export interface ComposerDraft {
  postType: string;
  caption: string;
  hashtags: string[];
  tags: string[];
  visibility: 'public' | 'private';
  /** The golf section's reported value, present only when it was dirty.
   *  Type-only import — no runtime edge from this lib into components. */
  golf?: GolfComposerValue;
  /** How many attachments wait in the device's media stash. */
  mediaCount?: number;
}

const KEY = 'ea:composer-draft:v1';
export const COMPOSER_DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

export function isEmptyComposerDraft(draft: ComposerDraft): boolean {
  return (
    draft.caption.trim() === '' &&
    draft.hashtags.length === 0 &&
    draft.tags.length === 0 &&
    draft.golf === undefined &&
    !(draft.mediaCount && draft.mediaCount > 0)
  );
}

export function parseComposerDraft(raw: string | null, now: number = Date.now()): ComposerDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown } & Partial<ComposerDraft>;
    if (parsed?.v !== 1 || typeof parsed.savedAt !== 'number') return null;
    if (now - parsed.savedAt > COMPOSER_DRAFT_TTL_MS) return null;
    // Golf rides along shape-checked, not deep-validated: the section's
    // own state setters tolerate its fields, and a malformed blob just
    // means no golf restore (never a crash).
    const golf =
      parsed.golf &&
      typeof parsed.golf === 'object' &&
      typeof (parsed.golf as { sharedRoundDetails?: unknown }).sharedRoundDetails === 'object'
        ? (parsed.golf as GolfComposerValue)
        : undefined;
    const draft: ComposerDraft = {
      postType: typeof parsed.postType === 'string' ? parsed.postType : 'general',
      caption: typeof parsed.caption === 'string' ? parsed.caption : '',
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter(h => typeof h === 'string') : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter(t => typeof t === 'string') : [],
      visibility: parsed.visibility === 'private' ? 'private' : 'public',
      ...(golf ? { golf } : {}),
      ...(typeof parsed.mediaCount === 'number' && parsed.mediaCount > 0 ? { mediaCount: Math.min(10, Math.floor(parsed.mediaCount)) } : {}),
    };
    return isEmptyComposerDraft(draft) ? null : draft;
  } catch {
    return null;
  }
}

export function loadComposerDraft(): ComposerDraft | null {
  try {
    return parseComposerDraft(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveComposerDraft(draft: ComposerDraft): void {
  try {
    if (isEmptyComposerDraft(draft)) {
      window.localStorage.removeItem(KEY);
      return;
    }
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now(), ...draft }));
  } catch {
    /* ignore */
  }
}

export function clearComposerDraft(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
