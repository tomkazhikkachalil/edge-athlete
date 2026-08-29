// Household safety policy (Wave 4, mig 132) — pure and node-testable. A
// guardian's defaults for every athlete they manage, stored as schema-less
// jsonb on THEIR OWN profiles row (the vitals_privacy pattern). Reads are
// tolerant (unknown keys dropped, bad values dropped, defaults back-filled)
// so the stored JSON can never wedge a surface; writes go through
// parseHouseholdPolicy in the PATCH route so what's stored is always
// in-contract. Enforcement is app-layer, and NEVER silent: creation
// inheritance is the guardian's own act of creating; everything else is a
// click behind a confirm.

import {
  COMMENT_MODERATION_VALUES,
  MESSAGING_VALUES,
  VISIBILITY_VALUES,
  type CommentModeration,
  type MessagingPermission,
  type Visibility,
} from './profile-privacy';
import { ageOn, isUnderThreshold, LADDER_AGES } from './config/minors-config';

export interface HouseholdPresets {
  /** 'public' is storable but ALWAYS clamped to private at athlete creation
   *  (consent cannot pre-exist) and consent-gated at apply time. */
  visibility: Visibility;
  messaging_permission: MessagingPermission;
  comment_moderation: CommentModeration;
}

export type SafetyField = keyof HouseholdPresets;

/**
 * Wave 8 widened the two-band model to the 4-step ladder:
 *   child   — under LADDER_AGES.childMax (13): defaults + childDefaults
 *   younger — 13 up to the jurisdiction consent threshold: defaults
 *   older   — threshold up to LADDER_AGES.adult (18): defaults + olderDefaults
 *   adult   — 18+ while still supervised: same as older (the policy answer
 *             for an 18-year-old is the handover prompt, not more presets)
 * The younger/older boundary still delegates to the SAME isUnderThreshold
 * the transfer sweep uses — the deliberate-agreement invariant holds.
 */
export type AgeBand = 'child' | 'younger' | 'older' | 'adult';

export interface HouseholdPolicy {
  /** Complete after parse — missing/invalid fields fill from RESTRICTIVE_PRESETS. */
  defaults: HouseholdPresets;
  /** Sparse per-field overrides once a child crosses the legal threshold.
   *  null = not configured: age-crossing prompts never fire, and defining it
   *  later never retro-prompts (mig 133's NULL-rider rule). */
  olderDefaults: Partial<HouseholdPresets> | null;
  /** Sparse per-field STRICTER overrides for under-13s (Wave 8). Same
   *  null-semantics as olderDefaults; there is no crossing prompt in this
   *  direction — leaving the child band relaxes back to defaults, which is
   *  never a safety downgrade a guardian must be asked about (chips still
   *  surface any deviation). */
  childDefaults: Partial<HouseholdPresets> | null;
}

/** The pre-Wave-4 creation literals, verbatim (athletes POST). */
export const RESTRICTIVE_PRESETS: HouseholdPresets = {
  visibility: 'private',
  messaging_permission: 'nobody',
  comment_moderation: 'held',
};

export const SAFETY_FIELDS: SafetyField[] = [
  'visibility',
  'messaging_permission',
  'comment_moderation',
];

const FIELD_VALUES: Record<SafetyField, readonly string[]> = {
  visibility: VISIBILITY_VALUES,
  messaging_permission: MESSAGING_VALUES,
  comment_moderation: COMMENT_MODERATION_VALUES,
};

function pickPresets(raw: unknown): Partial<HouseholdPresets> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: Partial<HouseholdPresets> = {};
  for (const field of SAFETY_FIELDS) {
    const value = source[field];
    if (typeof value === 'string' && FIELD_VALUES[field].includes(value)) {
      (out as Record<string, string>)[field] = value;
    }
  }
  return out;
}

/**
 * Tolerant parse of a stored/submitted policy. null/garbage → null ("not
 * adopted"); otherwise defaults back-fill from RESTRICTIVE_PRESETS and an
 * empty olderDefaults normalizes to null.
 */
export function parseHouseholdPolicy(raw: unknown): HouseholdPolicy | null {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const defaults: HouseholdPresets = {
    ...RESTRICTIVE_PRESETS,
    ...pickPresets(source.defaults),
  };
  const older = pickPresets(source.olderDefaults);
  const olderDefaults =
    source.olderDefaults !== null &&
    source.olderDefaults !== undefined &&
    Object.keys(older).length > 0
      ? older
      : null;
  const child = pickPresets(source.childDefaults);
  const childDefaults =
    source.childDefaults !== null &&
    source.childDefaults !== undefined &&
    Object.keys(child).length > 0
      ? child
      : null;
  return { defaults, olderDefaults, childDefaults };
}

/**
 * Which ladder step the child is on. The younger/older boundary delegates
 * to the SAME isUnderThreshold the transfer sweep uses — the age-crossing
 * prompt and transfer eligibility are one event and can never disagree; the
 * child/adult anchors are product steps (LADDER_AGES), not legal ones.
 */
export function ageBand(dob: string, jurisdiction: string | null | undefined, asOf: string): AgeBand {
  const age = ageOn(dob, asOf);
  if (age < LADDER_AGES.childMax) return 'child';
  if (age >= LADDER_AGES.adult) return 'adult';
  return isUnderThreshold(dob, jurisdiction, asOf) ? 'younger' : 'older';
}

/** The presets that apply to a child in a band (most-specific wins). */
export function effectivePresets(policy: HouseholdPolicy, band: AgeBand): HouseholdPresets {
  if (band === 'child' && policy.childDefaults) {
    return { ...policy.defaults, ...policy.childDefaults };
  }
  if ((band === 'older' || band === 'adult') && policy.olderDefaults) {
    return { ...policy.defaults, ...policy.olderDefaults };
  }
  return policy.defaults;
}

interface AthleteSettings {
  visibility: string | null;
  messaging_permission: string | null;
  comment_moderation: string | null;
}

function currentValue(athlete: AthleteSettings, field: SafetyField): string {
  const value = athlete[field];
  // comment_moderation predates 095 on some rows client-side; the DB default
  // (and the enforcement fallback) is 'held'.
  if (field === 'comment_moderation') return value ?? 'held';
  return value ?? '';
}

/**
 * The fields where an athlete's settings differ from the guardian's policy
 * (band-aware). [] when there's no policy or no dob to band on.
 */
export function deviationFields(
  athlete: AthleteSettings & { dob: string | null; jurisdiction: string | null },
  policy: HouseholdPolicy | null,
  asOf: string = new Date().toISOString().slice(0, 10)
): SafetyField[] {
  if (!policy || !athlete.dob) return [];
  const presets = effectivePresets(policy, ageBand(athlete.dob, athlete.jurisdiction, asOf));
  return SAFETY_FIELDS.filter(field => currentValue(athlete, field) !== presets[field]);
}

/**
 * The concrete changes applying the OLDER overrides would make to a child's
 * current settings. [] when olderDefaults isn't configured — the prompt
 * machinery (sweep, queue, decision route) keys off exactly this.
 *
 * Deliberately compares ONLY the fields olderDefaults names: the crossing
 * prompt proposes what the guardian configured for older athletes, and never
 * drags unrelated fields back to the base defaults (a deliberate per-child
 * choice on another field is respected — the deviation chips surface it).
 */
export function agePresetChanges(
  athlete: AthleteSettings,
  policy: HouseholdPolicy | null
): Array<{ field: SafetyField; from: string; to: string }> {
  if (!policy || !policy.olderDefaults) return [];
  const older = policy.olderDefaults;
  return SAFETY_FIELDS.flatMap(field => {
    const to = older[field];
    if (to === undefined) return [];
    const from = currentValue(athlete, field);
    return from !== to ? [{ field, from, to }] : [];
  });
}
