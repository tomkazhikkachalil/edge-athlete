/**
 * The autosave's decisions — Site Builder hardening H5 (Sep 9 2026). Pure
 * and node-tested; `useDraft` is a thin shell around it. What it fixes:
 * overlapping PUTs (a save while one was in flight carried a stale rev and
 * 409'd against itself), a stale response overwriting a newer rev, a 400 or
 * a 429 flattened into "Could not save" with no way out, and a Publish
 * button that answered "wait for the draft to finish saving" forever when
 * the status was one that never resolves on its own.
 */

import type { SiteLayout } from './layout';

export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'invalid' | 'conflict' | 'unsupported' | 'ratelimited' | 'offline' | 'error';

export interface SaveIssue {
  id?: string;
  path?: string;
  message: string;
}

/** What one PUT answered — the wire mapped to the six things the editor
 *  can act on. */
export type SaveOutcome =
  | { kind: 'ok'; rev: number }
  | { kind: 'invalid'; issues: SaveIssue[] }
  | { kind: 'conflict' }
  | { kind: 'unsupported' }
  | { kind: 'ratelimited' }
  | { kind: 'network' };

export interface DraftState {
  status: DraftSaveStatus;
  rev: number | null;
  /** The last layout the server accepted (dirty = layout !== saved). */
  saved: SiteLayout;
  /** The save in flight — its sequence number and the layout it carries. */
  inFlight: { seq: number; layout: SiteLayout } | null;
  seq: number;
  issues: SaveIssue[];
  /** 429 retries spent since the last success (one automatic retry). */
  retries: number;
}

export const RATELIMIT_RETRY_MS = 4000;
export const RATELIMIT_MAX_RETRIES = 1;

export function initialDraftState(layout: SiteLayout, rev: number | null): DraftState {
  return { status: 'idle', rev, saved: layout, inFlight: null, seq: 0, issues: [], retries: 0 };
}

/** Should the hook START a save for `layout` now? Not while one is in
 *  flight (the settle re-arms), not when nothing changed. */
export function shouldSave(state: DraftState, layout: SiteLayout): boolean {
  return state.inFlight === null && layout !== state.saved;
}

export function beginSave(state: DraftState, layout: SiteLayout): DraftState {
  const seq = state.seq + 1;
  return { ...state, status: 'saving', seq, inFlight: { seq, layout } };
}

/** A response for save `seq` came back. A response for a save that is no
 *  longer the one in flight is IGNORED — it can never move the rev. */
export function settleSave(state: DraftState, seq: number, outcome: SaveOutcome, online = true): DraftState {
  if (!state.inFlight || state.inFlight.seq !== seq) return state;
  const sent = state.inFlight.layout;
  const base = { ...state, inFlight: null };
  switch (outcome.kind) {
    case 'ok':
      return { ...base, status: 'saved', rev: outcome.rev, saved: sent, issues: [], retries: 0 };
    case 'invalid':
      return { ...base, status: 'invalid', issues: outcome.issues };
    case 'conflict':
      return { ...base, status: 'conflict' };
    case 'unsupported':
      return { ...base, status: 'unsupported' };
    case 'ratelimited':
      return { ...base, status: 'ratelimited', retries: state.retries + 1 };
    case 'network':
      return { ...base, status: online ? 'error' : 'offline' };
  }
}

/** After a 429: retry automatically once, after a pause; then wait for the
 *  next edit. */
export function shouldRetryAfterRatelimit(state: DraftState): boolean {
  return state.status === 'ratelimited' && state.retries <= RATELIMIT_MAX_RETRIES;
}

/** A content save through the panel bumped the same draft's rev. The rev
 *  only ADVANCES — a rev adopted from a fresh canvas read never regresses
 *  to what an older response reports. */
export function adoptRev(state: DraftState, rev: number | null): DraftState {
  if (rev === null) return state;
  if (state.rev !== null && rev <= state.rev) return state;
  return { ...state, rev };
}

/** Why Publish must wait — null when it may go ahead. Every message names
 *  what will change the situation; none of them is "wait for the draft to
 *  finish saving" on a status that never finishes by itself. */
export function publishBlocker(state: Pick<DraftState, 'status' | 'issues'>, dirty: boolean): string | null {
  switch (state.status) {
    case 'saving':
      return 'Saving — one moment, then publish.';
    case 'invalid':
      return `Fix the highlighted section before publishing${state.issues[0] ? `: ${state.issues[0].message}` : ''}.`;
    case 'conflict':
      return 'The draft changed elsewhere — reload to pick up those changes, then publish.';
    case 'unsupported':
      return 'Drafts and revisions need a database migration first (180).';
    case 'offline':
      return 'You’re offline — reconnect, and the draft saves itself; then publish.';
    case 'ratelimited':
      return 'Saving is paused for a moment — try again shortly.';
    case 'error':
      return 'Your last change hasn’t saved — try again in a moment.';
    default:
      return dirty ? 'Saving — one moment, then publish.' : null;
  }
}

/** The status chip. */
export function chipFor(state: Pick<DraftState, 'status' | 'issues'>, dirty: boolean): { text: string; cls: string } {
  switch (state.status) {
    case 'saving':
      return { text: 'Saving…', cls: 'text-tertiary' };
    case 'invalid':
      return { text: state.issues[0] ? `Not saved — ${state.issues[0].message}` : 'Not saved — a section is invalid', cls: 'text-red-600' };
    case 'conflict':
      return { text: 'Changed elsewhere — reload', cls: 'text-amber-700' };
    case 'unsupported':
      return { text: 'Drafts need migration 180', cls: 'text-amber-700' };
    case 'ratelimited':
      return { text: 'Saving paused — retrying', cls: 'text-amber-700' };
    case 'offline':
      return { text: 'Offline — changes are kept here', cls: 'text-amber-700' };
    case 'error':
      return { text: 'Could not save — retrying on your next change', cls: 'text-red-600' };
    case 'saved':
      return dirty ? { text: 'Unsaved', cls: 'text-tertiary' } : { text: 'Saved to draft', cls: 'text-emerald-700' };
    default:
      return dirty ? { text: 'Unsaved', cls: 'text-tertiary' } : { text: 'Draft', cls: 'text-tertiary' };
  }
}
