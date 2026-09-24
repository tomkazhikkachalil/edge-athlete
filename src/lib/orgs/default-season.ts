// ── The implicit season (Onboarding v2 R4) ──────────────────────────────────
// `competitions.season_id` is NOT NULL (151) and every competition reader
// keys on it, so the wall "Create a season first." was real. The Club
// Model's answer: a friends club uses one open-ended season it never has
// to name. This mints it on demand — calendar-year label, no dates — and
// finds it again next time (`seasons_org_label_uniq` makes the insert
// idempotent: 23505 → re-read). Structure-server's seasonCreatePOST stays
// the console's explicit path; this is the one-tap path's.

import type { SupabaseClient } from '@supabase/supabase-js';

import { ORG_ID, pairFor, type OrgKind } from './org-ref';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

/** PURE: the label an implicit season gets — the calendar year of `today`. */
export function defaultSeasonLabel(today: Date): string {
  return String(today.getUTCFullYear());
}

export async function ensureDefaultSeason(
  admin: Admin,
  scope: { side: OrgKind; orgId: string },
  sportKey: string | null,
  today: Date = new Date()
): Promise<{ seasonId: string; label: string; created: boolean } | { error: string }> {
  const label = defaultSeasonLabel(today);
  const find = () =>
    admin.from('seasons').select('id').eq(ORG_ID, scope.orgId).eq('label', label).maybeSingle();
  const existing = await find();
  if (existing.error) return { error: existing.error.message };
  if (existing.data) return { seasonId: existing.data.id as string, label, created: false };
  const { data: inserted, error } = await admin
    .from('seasons')
    .insert({ ...pairFor(scope), label, starts_on: null, ends_on: null, sport_key: sportKey })
    .select('id')
    .single();
  if (!error && inserted) return { seasonId: inserted.id as string, label, created: true };
  if (error?.code === '23505') {
    const again = await find();
    if (again.data) return { seasonId: again.data.id as string, label, created: false };
  }
  return { error: error?.message ?? 'season insert failed' };
}
