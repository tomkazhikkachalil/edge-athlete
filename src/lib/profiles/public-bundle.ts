import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawMembershipRow } from '@/lib/orgs/members';

/**
 * The public profile's ONE read (trip-count program PR 1, Oct 26 2026):
 * `public_profile_bundle(handle)` (migration 280) returns every row
 * GET /api/public/profile and its helpers used to fetch in fifteen trips —
 * raw, as jsonb. The rules stay in the route and the helpers; this module
 * only types the bundle and asks for it. service_role (the admin client).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface BundleProfile {
  id: string;
  handle: string;
  followers_count: number | null;
  following_count: number | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  bio: string | null;
  sport: string | null;
  school: string | null;
  location: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  weight_unit: string | null;
  dob: string | null;
  class_year: number | null;
  social_twitter: string | null;
  social_instagram: string | null;
  social_facebook: string | null;
  social_tiktok: string | null;
  visibility: string;
  created_at: string;
  vitals_privacy: unknown;
}

export interface BundleRecentPost {
  id: string;
  caption: string | null;
  sport_key: string | null;
  created_at: string;
  likes_count: number | null;
  comments_count: number | null;
  stats_data: Record<string, unknown> | null;
  post_category: string | null;
  round_id: string | null;
  group_post_id: string | null;
  shared_post_id: string | null;
  post_media: Array<{ id: string; media_url: string; media_type: string }>;
}

export interface BundleOriginal {
  id: string;
  caption: string | null;
  visibility: string | null;
  owner_full_name: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  owner_visibility: string | null;
}

export interface PublicProfileBundle {
  /** null = no such handle; `{ id, visibility }` only = not public. */
  profile: BundleProfile | { id: string; visibility: string } | null;
  counts?: { posts: number; statements: number; training: number };
  recent_posts?: BundleRecentPost[];
  repost_originals?: BundleOriginal[];
  achievements?: Array<{ id: string; title: string; placement: string | null; achieved_on: string }>;
  sport_settings?: Array<{ sport_key: string; settings: unknown; pinned: boolean | null; pin_order: number | null }>;
  post_sport_keys?: string[];
  golf_rounds_count?: number;
  stat_posts?: Record<string, unknown[]>;
  memberships?: Array<RawMembershipRow & { org_kind: string | null }>;
  organizations?: Array<{ id: string; kind: string; name: string; sport_key: string | null; city: string | null; region: string | null; country: string | null; listing_status: string | null; approved_at: string | null; visibility: string | null }>;
}

/** The function is not on this database yet (a deploy ahead of 280). */
export class BundleUnavailableError extends Error {
  constructor() { super('public_profile_bundle is not available'); this.name = 'BundleUnavailableError'; }
}

export function isFullBundleProfile(p: PublicProfileBundle['profile']): p is BundleProfile {
  return !!p && 'handle' in p;
}

export async function readPublicProfileBundle(admin: Admin, handle: string): Promise<PublicProfileBundle> {
  const { data, error } = await admin.rpc('public_profile_bundle', { p_handle: handle });
  if (error) {
    if (error.code === 'PGRST202') throw new BundleUnavailableError();
    throw new Error(`public_profile_bundle: ${error.message}`);
  }
  return (data ?? { profile: null }) as PublicProfileBundle;
}
