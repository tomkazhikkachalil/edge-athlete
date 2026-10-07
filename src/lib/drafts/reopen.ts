// ── The reopen prompt's rules (Drafts round PR 4, Oct 2026) ──────────────────
// Tom: "When the user reopens the app, they get a prompt to resume, finish,
// or discard." ONE prompt, once per app open, about the ONE most recently
// touched in-progress thing (pickReopenCandidate). Pure: the host component
// reads these; nothing here touches the DOM.

import type { DraftItem } from './list';

/** Once per app open: the key that remembers the prompt was shown (sessionStorage — a new tab or a relaunch asks again). */
export function reopenSeenKey(userId: string): string {
  return `ea:reopen-prompt:v1:${userId}`;
}

/** Screens that ARE the thing (or its list): no prompt over them. */
const SKIP_PREFIXES = ['/live/', '/activities/record', '/app/workout/', '/athlete/drafts'] as const;

export function reopenSkipsPath(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  return SKIP_PREFIXES.some(p => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

export interface ReopenActions {
  /** Always: the way back in. */
  resume: true;
  /** Finish records it (a scored round → the review screen; a workout → its summary and share). */
  finish: boolean;
  /** Discard: nothing was posted; a scored round's scores go with it. Never a partner's. */
  discard: boolean;
  /** What the dialog says it is. */
  line: string;
}

export function reopenActions(item: DraftItem): ReopenActions {
  if (item.kind === 'round') {
    return {
      resume: true,
      finish: item.isCreator && item.scored,
      discard: item.isCreator,
      line: item.isCreator
        ? (item.scored ? 'A round you were scoring is still open.' : 'A round you started has no scores yet.')
        : 'A round you are playing in is still open.',
    };
  }
  if (item.kind === 'workout') {
    return { resume: true, finish: true, discard: true, line: 'A workout is still in progress.' };
  }
  return { resume: true, finish: true, discard: true, line: 'A recording is waiting on this phone.' };
}
