// Identity-field diffing for supervised profiles (guardian gap-closure Round
// H, "both edit, guardian notified"): the child keeps editing their profile,
// and guardians get a bell naming exactly which identity fields changed. Pure
// and node-testable; PUT /api/profile supplies the looked-up old row.
//
// NOT the safety fields (visibility/messaging/comment_moderation — those live
// on the guardian PATCH route with safety_settings_audit rows), and NOT
// audited into safety_settings_audit: 095's field CHECK admits only the three
// safety fields, so the changed-field list rides the notification metadata
// instead. `school` is absent on purpose — no editor writes it anywhere.

export const IDENTITY_FIELDS = [
  'first_name',
  'middle_name',
  'last_name',
  'full_name',
  'bio',
  'location',
  'class_year',
  'social_twitter',
  'social_instagram',
  'social_facebook',
  'social_tiktok',
] as const;

export type IdentityField = (typeof IDENTITY_FIELDS)[number];

/** Treat null, undefined and '' as the same "empty" so a form round-tripping
 *  null → '' → null never reads as a change. */
function normalized(value: unknown): unknown {
  return value === undefined || value === null || value === '' ? null : value;
}

/**
 * Which identity fields does `incoming` actually change relative to `old`?
 * Fields absent from `incoming` are untouched by definition (profile PUTs are
 * partial). Order follows IDENTITY_FIELDS for stable notification copy.
 */
export function diffIdentityFields(
  old: Record<string, unknown>,
  incoming: Record<string, unknown>
): IdentityField[] {
  const changed: IdentityField[] = [];
  for (const field of IDENTITY_FIELDS) {
    if (!(field in incoming)) continue;
    if (normalized(incoming[field]) !== normalized(old[field])) changed.push(field);
  }
  return changed;
}

/** Human-readable field list for notification copy ("name, bio and location"). */
export function describeIdentityFields(fields: IdentityField[]): string {
  const labels = new Map<IdentityField, string>([
    ['first_name', 'name'],
    ['middle_name', 'name'],
    ['last_name', 'name'],
    ['full_name', 'name'],
    ['bio', 'bio'],
    ['location', 'location'],
    ['class_year', 'class year'],
    ['social_twitter', 'social links'],
    ['social_instagram', 'social links'],
    ['social_facebook', 'social links'],
    ['social_tiktok', 'social links'],
  ]);
  const seen: string[] = [];
  for (const f of fields) {
    const label = labels.get(f) ?? f;
    if (!seen.includes(label)) seen.push(label);
  }
  if (seen.length === 0) return '';
  if (seen.length === 1) return seen[0];
  return `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}`;
}
