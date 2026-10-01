// ── Edit Profile: what the form holds, and when it is (re)filled ────────────
// Pure, so both rules are node-testable (there is no jsdom).
//
// Why this exists (Sep 30 2026): the modal used to fill its forms in a
// render-phase sync whose tracker started EQUAL to the mount-time profile —
// `useState({ profile })` then `if (synced.profile !== profile)`. Every host
// mounts the modal after auth has resolved, so the first comparison was
// always equal and the forms kept their empty defaults: Edit Profile opened
// blank, and saving a blank Vitals or Socials tab wrote the blanks. The same
// check also refilled every form whenever the profile OBJECT changed (a
// save's refresh, the 15-minute token refresh), wiping unsaved typing.
//
// The rule now: fill when the modal OPENS, and when the profile it edits
// becomes a different profile. Never on a same-profile refresh while open.

import type { Profile } from '@/lib/supabase';
import type { PlaceValue } from '@/components/PlacePicker';
import { profileToPlace } from '@/lib/geo/profile-place';
import { formatHeight, formatSocialHandle } from '@/lib/formatters';
import {
  isTargetLevel,
  parseRecruitingStatus,
  type RecruitingStatus,
  type TargetLevel,
} from '@/lib/recruiting/profile';

export type WeightUnitChoice = 'lbs' | 'kg' | 'stone';

export interface BasicForm {
  first_name: string;
  middle_name: string;
  last_name: string;
  /** Fallback display name — shown (avatar alt, initials), never sent. */
  full_name: string;
  handle: string;
  bio: string;
  avatar_file: File | null;
  visibility: 'public' | 'private';
}

export interface VitalsForm {
  /** The height input's TEXT (5'10"), not centimetres — the name is historical. */
  height_cm: string;
  /** The weight input's text in `weight_unit` — the name is historical. */
  weight_kg: string;
  weight_unit: WeightUnitChoice;
  dob: string;
  location: string;
  /** Structured place behind the location text (migration 108). Null = free text only. */
  place: PlaceValue | null;
  class_year: string | number;
}

export interface SocialsForm {
  social_twitter: string;
  social_instagram: string;
  social_facebook: string;
  social_tiktok: string;
}

export interface RecruitingForm {
  status: RecruitingStatus;
  school: string;
  gpa: string;
  academic_notes: string;
  target_level: '' | TargetLevel;
}

export interface ProfileForms {
  basic: BasicForm;
  vitals: VitalsForm;
  socials: SocialsForm;
  recruiting: RecruitingForm;
}

/** The academics as the recruiting form holds them (also fed by the recruiting GET in acting-as). */
export function recruitingAcademics(
  rp: { gpa?: number | null; academic_notes?: string | null; target_level?: string | null } | null | undefined
): Pick<RecruitingForm, 'gpa' | 'academic_notes' | 'target_level'> {
  return {
    gpa: typeof rp?.gpa === 'number' ? String(rp.gpa) : '',
    academic_notes: rp?.academic_notes ?? '',
    target_level: isTargetLevel(rp?.target_level) ? rp.target_level : '',
  };
}

/** A profile row → the four forms. A null profile gives the empty forms. */
export function formsFromProfile(profile: Profile | null | undefined): ProfileForms {
  return {
    basic: {
      first_name: (profile?.first_name || '').toString(),
      middle_name: (profile?.middle_name || '').toString(),
      last_name: (profile?.last_name || '').toString(),
      full_name: (profile?.full_name || '').toString(),
      handle: (profile?.handle || '').toString(),
      bio: (profile?.bio || '').toString(),
      avatar_file: null,
      visibility: (profile?.visibility || 'public') as 'public' | 'private',
    },
    vitals: {
      height_cm: profile?.height_cm ? formatHeight(profile.height_cm) : '',
      // The saved display value exactly as entered — no conversion.
      weight_kg: profile?.weight_display ? String(profile.weight_display) : '',
      weight_unit: (profile?.weight_unit || 'lbs') as WeightUnitChoice,
      // Signup writes both columns, org registration only `birthday`
      // (/api/vitals reads the pair the same way).
      dob: (profile?.dob || profile?.birthday || '').toString(),
      location: (profile?.location || '').toString(),
      place: profileToPlace(profile),
      class_year: profile?.class_year ? String(profile.class_year) : '',
    },
    socials: {
      social_twitter: formatSocialHandle(profile?.social_twitter),
      social_instagram: formatSocialHandle(profile?.social_instagram),
      social_facebook: formatSocialHandle(profile?.social_facebook),
      social_tiktok: formatSocialHandle(profile?.social_tiktok),
    },
    recruiting: {
      status: parseRecruitingStatus(profile?.recruiting_status),
      school: profile?.school ?? '',
      ...recruitingAcademics(profile?.recruiting_profile),
    },
  };
}

/** What the seeding decision looks at: is the modal open, and whose profile is it. */
export interface SeedKey {
  isOpen: boolean;
  /** `null` = open with no profile yet; `undefined` only on the sentinel. */
  profileId: string | null | undefined;
}

/**
 * The tracker's FIRST value. Deliberately not the mount-time props: a modal
 * that mounts already open (a lazily loaded chunk, a deep link) must still
 * read as "just opened".
 */
export const UNSEEDED: SeedKey = { isOpen: false, profileId: undefined };

export const seedKeyChanged = (prev: SeedKey, next: SeedKey): boolean =>
  prev.isOpen !== next.isOpen || prev.profileId !== next.profileId;

/** Did the modal just open (closed → open, or mounted open)? */
export const justOpened = (prev: SeedKey, next: SeedKey): boolean => next.isOpen && !prev.isOpen;

/**
 * Fill the forms now? Only while open, and only when the modal just opened
 * or the profile became a different profile (null → loaded included). A new
 * object for the SAME profile is not a reason: the form is the truth while
 * it is open.
 */
export function shouldSeed(prev: SeedKey, next: SeedKey): boolean {
  if (!next.isOpen) return false;
  return !prev.isOpen || prev.profileId !== next.profileId;
}
