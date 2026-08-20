// Family-console rollup shaping — pure and node-testable. The route fetches
// four batched IN-queries (constant query count regardless of roster size);
// this module reduces them into one summary per athlete, and owns the chip
// vocabulary the console renders.

import { stateFromAction, type ConsentState } from './consent';
import type { TransferState } from './transfer-ui';

export interface AthleteSummary {
  consentState: ConsentState;
  /** A supervised SELF-row exists → the guardian has issued a login. */
  hasLogin: boolean;
  pendingPostCount: number;
  activeTransfer: { state: TransferState } | null;
}

/** Chip tones follow the transfers page's vocabulary: amber = the guardian
 *  must act, violet = healthy/moving, gray = neutral/waiting. */
export type ChipTone = 'violet' | 'amber' | 'gray';
export interface Chip {
  label: string;
  tone: ChipTone;
}

/**
 * Reduce the four batched query results into per-athlete summaries.
 *
 * `consentRows` MUST arrive ordered created_at DESC — consent_records is
 * append-only and the latest action per profile decides the state, so the
 * first row seen per profile wins.
 */
export function buildAthleteSummaries(
  athleteIds: string[],
  consentRows: Array<{ profile_id: string; action: string }>,
  supervisedRows: Array<{ user_id: string; profile_id: string }>,
  pendingRows: Array<{ profile_id: string }>,
  transferRows: Array<{ profile_id: string; state: string }>
): Record<string, AthleteSummary> {
  const summaries: Record<string, AthleteSummary> = {};
  for (const id of athleteIds) {
    summaries[id] = {
      consentState: 'none',
      hasLogin: false,
      pendingPostCount: 0,
      activeTransfer: null,
    };
  }

  const consentSeen = new Set<string>();
  for (const row of consentRows) {
    if (!summaries[row.profile_id] || consentSeen.has(row.profile_id)) continue;
    consentSeen.add(row.profile_id);
    summaries[row.profile_id].consentState = stateFromAction(row.action);
  }

  for (const row of supervisedRows) {
    // Only a SELF row means the child has credentials — a supervised row
    // pointing elsewhere must never read as "has login".
    if (row.user_id === row.profile_id && summaries[row.profile_id]) {
      summaries[row.profile_id].hasLogin = true;
    }
  }

  for (const row of pendingRows) {
    if (summaries[row.profile_id]) summaries[row.profile_id].pendingPostCount += 1;
  }

  for (const row of transferRows) {
    if (summaries[row.profile_id]) {
      summaries[row.profile_id].activeTransfer = { state: row.state as TransferState };
    }
  }

  return summaries;
}

export function consentChip(state: ConsentState): Chip {
  switch (state) {
    case 'approved': return { label: 'Consent approved', tone: 'violet' };
    case 'pending_review': return { label: 'Consent in review', tone: 'gray' };
    case 'rejected': return { label: 'Consent rejected', tone: 'amber' };
    case 'withdrawn': return { label: 'Consent withdrawn', tone: 'gray' };
    case 'none': return { label: 'Consent needed', tone: 'amber' };
  }
}

export function loginChip(hasLogin: boolean): Chip {
  return hasLogin
    ? { label: 'Has login', tone: 'violet' }
    : { label: 'No login yet', tone: 'amber' };
}

export function visibilityChip(visibility: string | null | undefined): Chip {
  return visibility === 'public'
    ? { label: 'Public', tone: 'violet' }
    : { label: 'Private', tone: 'gray' };
}

/** Who may message the athlete (Round D — the one safety control the console
 *  card didn't surface). Values mirror MESSAGING_OPTIONS in profile-privacy.
 *  'everyone' is the only state a guardian should glance twice at → amber;
 *  unknown/null reads as the locked-down default → gray. */
export function messagingChip(permission: string | null | undefined): Chip {
  switch (permission) {
    case 'everyone': return { label: 'Messages: everyone', tone: 'amber' };
    case 'fans_only': return { label: 'Messages: fans', tone: 'violet' };
    case 'mutual_fans': return { label: 'Messages: mutual fans', tone: 'violet' };
    default: return { label: 'Messages: off', tone: 'gray' };
  }
}
