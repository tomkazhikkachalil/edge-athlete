// ── The derived name columns, and the DOB pair (pure) ───────────────────────
// `profiles` keeps a person's name three ways: the parts (first / middle /
// last — what the user edits), `full_name` and `display_name`. Signup writes
// all three together (src/app/api/signup/route.ts). Nothing kept the derived
// two current afterwards: Edit Profile sent the loaded `full_name` back
// unchanged, the trigger `auto_update_display_name` fills `full_name` only
// when it is EMPTY, and nothing ever rewrote `display_name`. A renamed
// athlete kept the old name wherever those columns lead — the /u/ page
// title, message notifications, the composer, the tag picker, search,
// suggestions, the guardian and registration screens (Sep 30 2026).
//
// The rule is signup's, applied by PUT /api/profile on every name write:
//   full_name    = first + last
//   display_name = nickname, else full name, else handle
//
// Date of birth is the same story in two columns: signup writes `dob` AND
// `birthday`; org eligibility reads `birthday`; Edit Profile wrote only
// `dob`. `mirrorDob` keeps them one value.

export interface NameParts {
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  handle?: string | null;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Signup's rule. `display_name` is null only when there is nothing to show at all. */
export function deriveNameColumns(parts: NameParts): { full_name: string | null; display_name: string | null } {
  const full = [clean(parts.first_name), clean(parts.last_name)].filter(Boolean).join(' ');
  const display = clean(parts.nickname) || full || clean(parts.handle);
  return { full_name: full || null, display_name: display || null };
}

/** Does this profile payload change something the derived names depend on? */
export function touchesNames(payload: Record<string, unknown>): boolean {
  return 'first_name' in payload || 'last_name' in payload || 'nickname' in payload;
}

/**
 * The derived columns for a PARTIAL profile update: the payload's name
 * parts over the stored row's. Returns only the keys to write — nothing
 * when the payload names no name part, and never an empty `display_name`
 * (the column's CHECK refuses one) nor a `full_name` cleared to nothing by
 * derivation alone (a payload that empties both parts keeps its own value).
 */
export function derivedNameUpdate(
  payload: Record<string, unknown>,
  stored: Record<string, unknown> | null
): { full_name?: string; display_name?: string } {
  if (!touchesNames(payload)) return {};
  const pick = (key: keyof NameParts): string | null => {
    const v = key in payload ? payload[key] : stored?.[key];
    return typeof v === 'string' ? v : null;
  };
  const derived = deriveNameColumns({
    first_name: pick('first_name'),
    last_name: pick('last_name'),
    nickname: pick('nickname'),
    handle: pick('handle'),
  });
  return {
    ...(derived.full_name ? { full_name: derived.full_name } : {}),
    ...(derived.display_name ? { display_name: derived.display_name } : {}),
  };
}

/**
 * `dob` and `birthday` are one value. A payload that still carries `dob`
 * (after the supervised / dob_locked strip — a stripped date is never
 * mirrored) writes the same value to `birthday`; `''` and null clear both.
 */
export function mirrorDob(payload: Record<string, unknown>): { birthday?: string | null } {
  if (!('dob' in payload)) return {};
  const dob = payload.dob;
  return { birthday: typeof dob === 'string' && dob !== '' ? dob : null };
}
