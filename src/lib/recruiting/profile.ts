// ── Recruiting profile — the pure half (Recruiting skeleton R1) ───────────
// Zero heavy imports on purpose: the edit modal (a client chunk) and the
// profile pages read the vocabulary and the one predicate from here; the
// zod parsing lives in ./schema.ts (server routes only).
//
// THE ONE GATE: recruiting_status. 'closed' (the default) means nothing
// recruiting-facing renders and recruiting_profile is never selected;
// 'open' | 'committed' render the card and enter scout surfaces.
//
// THE ONE PREDICATE: isRecruitable — the search index (R4), the shortlist
// POST (R3) and the button all call it. Tom's call (Sep 10 2026): a
// supervised athlete IS recruitable when their guardian opened recruiting
// (the manage_settings matrix is the only way a supervised profile's
// status changes), so supervision is deliberately NOT a term here; stubs
// (unclaimed profiles) and private profiles never are.

import { isStubEmail } from '@/lib/config/stubs-config';

export const RECRUITING_STATUSES = ['closed', 'open', 'committed'] as const;
export type RecruitingStatus = (typeof RECRUITING_STATUSES)[number];

export const RECRUITING_STATUS_LABEL: Record<RecruitingStatus, string> = {
  closed: 'Not recruiting',
  open: 'Open to recruiting',
  committed: 'Committed',
};

export const TARGET_LEVELS = ['high_school', 'club', 'collegiate', 'professional'] as const;
export type TargetLevel = (typeof TARGET_LEVELS)[number];

export const TARGET_LEVEL_LABEL: Record<TargetLevel, string> = {
  high_school: 'High school',
  club: 'Club',
  collegiate: 'Collegiate',
  professional: 'Professional',
};

export const ACADEMIC_NOTES_MAX = 300;
export const SCHOOL_MAX = 120;

export interface RecruitingProfile {
  /** 0–5, two decimals; self-reported and labelled so. */
  gpa: number | null;
  academic_notes: string | null;
  target_level: TargetLevel | null;
}

export const EMPTY_RECRUITING_PROFILE: RecruitingProfile = { gpa: null, academic_notes: null, target_level: null };

export function parseRecruitingStatus(raw: unknown): RecruitingStatus {
  return (RECRUITING_STATUSES as readonly string[]).includes(raw as string) ? (raw as RecruitingStatus) : 'closed';
}

export function isTargetLevel(raw: unknown): raw is TargetLevel {
  return (TARGET_LEVELS as readonly string[]).includes(raw as string);
}

export interface RecruitableInput {
  email: string | null;
  visibility: string | null;
  recruiting_status: string | null | undefined;
}

/** THE predicate: a claimed, PUBLIC profile whose recruiting is open or
 *  committed. Supervision is not a term (Tom's call — see the header). */
export function isRecruitable(p: RecruitableInput): boolean {
  if (isStubEmail(p.email)) return false;
  if (p.visibility !== 'public') return false;
  return parseRecruitingStatus(p.recruiting_status) !== 'closed';
}

/** "Class of 2027" for the card; null when unknown. */
export function gradYearLabel(classYear: number | null | undefined): string | null {
  return typeof classYear === 'number' && Number.isFinite(classYear) ? `Class of ${classYear}` : null;
}

/** "3.80" — GPA renders with two decimals, always beside "self-reported". */
export function formatGpa(gpa: number | null | undefined): string | null {
  return typeof gpa === 'number' && Number.isFinite(gpa) ? gpa.toFixed(2) : null;
}
