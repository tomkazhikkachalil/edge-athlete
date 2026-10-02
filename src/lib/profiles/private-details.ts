// ── The private sign-up details (pure) ──────────────────────────────────────
// Sign-up collects a nickname, a phone number, a gender and a postal code
// (src/components/signup/RegistrationSteps.tsx). Until Sep 30 2026 no screen
// showed or edited them afterwards. Edit Profile's Basic tab now carries
// them as a private group; PUT /api/profile cleans them with this rule.
//
// All four are OWNER-ONLY on read (`OWNER_ONLY_FIELDS` in the profile route)
// and never offered for a supervised profile — the route strips them there.
// A nickname leads `display_name` (src/lib/profiles/derive-names.ts).

export const PRIVATE_DETAIL_FIELDS = ['nickname', 'phone', 'gender', 'postal_code'] as const;
export type PrivateDetailField = (typeof PRIVATE_DETAIL_FIELDS)[number];

/** The `profiles_gender_check` values, in sign-up's order. */
export const GENDERS = ['female', 'male', 'custom'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABEL: Record<Gender, string> = { female: 'Female', male: 'Male', custom: 'Custom' };

export const NICKNAME_MAX = 40;
export const PHONE_MAX = 32;
export const POSTAL_CODE_MAX = 16;

const MAX: Record<Exclude<PrivateDetailField, 'gender'>, { max: number; label: string }> = {
  nickname: { max: NICKNAME_MAX, label: 'Nickname' },
  phone: { max: PHONE_MAX, label: 'Phone number' },
  postal_code: { max: POSTAL_CODE_MAX, label: 'Postal code' },
};

/**
 * The cleaned values for whichever of the four the payload names: trimmed,
 * `''` / null → null (the route's clear convention). A value that cannot be
 * stored is refused by name — never truncated, never silently dropped.
 */
export function cleanPrivateDetails(
  payload: Record<string, unknown>
): { update: Partial<Record<PrivateDetailField, string | null>>; error?: string } {
  const update: Partial<Record<PrivateDetailField, string | null>> = {};
  for (const field of PRIVATE_DETAIL_FIELDS) {
    if (!(field in payload)) continue;
    const raw = payload[field];
    if (raw === null || raw === undefined || raw === '') {
      update[field] = null;
      continue;
    }
    if (typeof raw !== 'string') {
      return { update: {}, error: `${field === 'gender' ? 'Gender' : MAX[field].label} is not valid` };
    }
    const value = raw.trim();
    if (value === '') {
      update[field] = null;
      continue;
    }
    if (field === 'gender') {
      if (!(GENDERS as readonly string[]).includes(value)) {
        return { update: {}, error: 'Gender must be Female, Male or Custom' };
      }
    } else if (value.length > MAX[field].max) {
      return { update: {}, error: `${MAX[field].label} must be ${MAX[field].max} characters or fewer` };
    }
    update[field] = value;
  }
  return { update };
}
