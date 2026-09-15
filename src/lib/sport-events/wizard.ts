/**
 * The creation wizard's rules (Events program, the wizard) — pure. Four
 * steps, one validator per step (the copy is the refusal the user reads),
 * and the body the POST takes. The wizard component is the I/O.
 */
import type { CourseHole } from '@/types/golf';
import { NAME_MAX, DESCRIPTION_MAX, isDateOnly } from './validate';
import type { SportEventFormat, SportEventJoinMode, SportEventVisibility } from './types';

export const WIZARD_STEPS = ['basics', 'round', 'format', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const WIZARD_STEP_LABEL: Readonly<Record<WizardStep, string>> = {
  basics: 'Basics',
  round: 'Round',
  format: 'Format',
  review: 'Review',
};

export interface WizardCourse {
  id: string | null;
  name: string;
  /** Tee names the catalog rates (free text keys). */
  tees: string[];
  holesCount: number | null;
}

/** One round as the round fields edit it (the wizard's step, the event page's add / edit window). */
export interface RoundDraft {
  scheduled_on: string;
  course: WizardCourse | null;
  tee: string;
  holes: 9 | 18;
  starting_hole: 1 | 10;
}

export function emptyRoundDraft(): RoundDraft {
  return { scheduled_on: '', course: null, tee: '', holes: 18, starting_hole: 1 };
}

/** A stored round → a draft for the edit window (the catalog's tees are not on the row: the tee stays free text). */
export function roundDraftFrom(round: { scheduled_on: string; course_id: string | null; course_name: string; tee: string | null; holes: number; starting_hole: number }): RoundDraft {
  return {
    scheduled_on: round.scheduled_on,
    course: { id: round.course_id, name: round.course_name, tees: [], holesCount: null },
    tee: round.tee ?? '',
    holes: round.holes === 9 ? 9 : 18,
    starting_hole: round.holes === 9 && round.starting_hole === 10 ? 10 : 1,
  };
}

/** The first refusal on a round draft, or null. */
export function validateRoundDraft(d: RoundDraft): string | null {
  if (!isDateOnly(d.scheduled_on)) return 'Pick the date.';
  if (!d.course || !d.course.name.trim()) return 'Pick a course, or type its name.';
  if (d.holes === 18 && d.starting_hole === 10) return 'An 18-hole round starts on hole 1.';
  return null;
}

/** The round body the routes take (parseRoundInput's shape). */
export function roundBodyFrom(d: RoundDraft) {
  return {
    scheduled_on: d.scheduled_on,
    course_id: d.course?.id ?? null,
    course_name: d.course?.name.trim() ?? null,
    tee: d.tee.trim() || null,
    holes: d.holes,
    starting_hole: d.holes === 9 ? d.starting_hole : 1,
  };
}

/** The wizard state's round as a draft (the state keeps the round flat until the rounds-list PR). */
export function wizardRoundDraft(s: Pick<WizardState, 'scheduled_on' | 'course' | 'tee' | 'holes' | 'starting_hole'>): RoundDraft {
  return { scheduled_on: s.scheduled_on, course: s.course, tee: s.tee, holes: s.holes, starting_hole: s.starting_hole };
}

export interface WizardState {
  name: string;
  description: string;
  visibility: SportEventVisibility;
  join_mode: SportEventJoinMode;
  org: { kind: 'club' | 'league'; id: string } | null;
  scheduled_on: string;
  course: WizardCourse | null;
  tee: string;
  holes: 9 | 18;
  starting_hole: 1 | 10;
  format: SportEventFormat;
  capacity: string;
  host_plays: boolean;
}

export function emptyWizardState(): WizardState {
  return { name: '', description: '', visibility: 'private', join_mode: 'invite', org: null, scheduled_on: '', course: null, tee: '', holes: 18, starting_hole: 1, format: 'stroke_gross', capacity: '', host_plays: true };
}

export function isWizardDirty(s: WizardState): boolean {
  const e = emptyWizardState();
  return s.name !== e.name || s.description !== e.description || s.scheduled_on !== e.scheduled_on || s.course !== null || s.tee !== '' || s.capacity !== '' || s.visibility !== e.visibility || s.join_mode !== e.join_mode || s.org !== null || s.holes !== e.holes || s.format !== e.format || s.host_plays !== e.host_plays;
}

/** The first refusal on a step, or null when it may advance. */
export function validateWizardStep(step: WizardStep, s: WizardState): string | null {
  switch (step) {
    case 'basics': {
      const name = s.name.trim();
      if (!name) return 'Give the event a name.';
      if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
      if (s.description.length > DESCRIPTION_MAX) return `Keep the description under ${DESCRIPTION_MAX} characters.`;
      return null;
    }
    case 'round':
      return validateRoundDraft(wizardRoundDraft(s));
    case 'format': {
      if (s.capacity.trim() !== '') {
        const n = Number(s.capacity);
        if (!Number.isInteger(n) || n < 1 || n > 500) return 'Field size is a whole number from 1 to 500, or blank.';
      }
      return null;
    }
    case 'review':
      return validateWizardStep('basics', s) ?? validateWizardStep('round', s) ?? validateWizardStep('format', s);
  }
}

/** The POST body (parseCreateBody's shape). `publish` = the review's Publish; false = Save draft. */
export function wizardToCreateBody(s: WizardState, opts: { publish: boolean; profileId: string | null }) {
  return {
    name: s.name.trim(),
    description: s.description.trim() || null,
    sport_key: 'golf',
    visibility: s.visibility,
    join_mode: s.join_mode,
    format: s.format,
    capacity: s.capacity.trim() === '' ? null : Number(s.capacity),
    club_id: s.org?.kind === 'club' ? s.org.id : null,
    league_id: s.org?.kind === 'league' ? s.org.id : null,
    host_plays: s.host_plays,
    publish: opts.publish,
    profile_id: opts.profileId,
    round: roundBodyFrom(wizardRoundDraft(s)),
  };
}

/** A catalog course → the wizard's course (its tees from the rating keys, then the yardage keys). */
export function wizardCourseFrom(course: { id: string; name: string; courseRating?: Record<string, number>; slopeRating?: Record<string, number>; holes?: CourseHole[]; holesCount?: number }): WizardCourse {
  const tees = new Set<string>([...Object.keys(course.courseRating ?? {}), ...Object.keys(course.slopeRating ?? {})]);
  if (tees.size === 0) for (const h of course.holes ?? []) for (const k of Object.keys(h.yardage ?? {})) tees.add(k);
  return { id: course.id, name: course.name, tees: [...tees], holesCount: course.holesCount ?? (course.holes && course.holes.length > 0 ? course.holes.length : null) };
}
