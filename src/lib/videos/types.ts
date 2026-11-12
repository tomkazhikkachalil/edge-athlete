/**
 * Videos (296) — the row and payload shapes. Types only.
 */
import type { OrgKind } from '@/lib/orgs/org-ref';
import type { HighlightMeta, VideoStatus } from './rules';
import type { LiveStatus } from './live-rules';

export interface VideoRow {
  id: string;
  provider: 'youtube';
  provider_video_id: string;
  profile_id: string | null;
  org_id: string | null;
  sport_event_id: string | null;
  contest_id: string | null;
  /** Phase 1b (297): a golf round, an activity, a workout session. */
  group_post_id: string | null;
  activity_id: string | null;
  workout_session_id: string | null;
  created_by_user_id: string | null;
  title: string;
  description: string | null;
  sport_key: string | null;
  duration_ms: number | null;
  status: VideoStatus;
  /** Phase 4a (299): what YouTube last said about a broadcast; a plain video is `none`. */
  live_status: LiveStatus;
  scheduled_start_at: string | null;
  live_started_at: string | null;
  live_ended_at: string | null;
  live_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HighlightRow {
  id: string;
  video_id: string;
  start_ms: number;
  end_ms: number | null;
  label: string;
  meta: HighlightMeta;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  /** Sprint 3 (307): the game sheet's event this highlight is, or null for a plain marker. */
  event_key: string | null;
  period: number | null;
  side: 1 | 2 | null;
  value: number | null;
  /** Who is in it (active tags only), in the order they were added. */
  people: HighlightPerson[];
}

/** One person on a tag, as a reader gets it: a linked profile (its name as THIS viewer may see it) or a typed name. */
export interface HighlightPerson {
  id: string;
  profile_id: string | null;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  role: string;
  side: 1 | 2 | null;
}

export type VideoOwnerView =
  | { kind: 'profile'; id: string; name: string; handle: string | null; avatar_url: string | null }
  | { kind: 'org'; id: string; side: OrgKind; name: string };

export type VideoPlaceKind = 'sport_event' | 'contest' | 'round' | 'activity' | 'workout';
export type VideoPlaceView = { kind: VideoPlaceKind; id: string; name: string } | null;

/** What the API hands a page: the row, the URLs rebuilt from the id, the
 *  owner and the place by name, the marker count, and the viewer's right. */
export interface VideoView {
  id: string;
  provider: 'youtube';
  provider_video_id: string;
  watch_url: string;
  embed_src: string;
  thumb_url: string;
  title: string;
  description: string | null;
  sport_key: string | null;
  duration_ms: number | null;
  status: VideoStatus;
  created_at: string;
  updated_at: string;
  /** Phase 4a: the live state from the row — a card never asks YouTube itself. */
  live_status: LiveStatus;
  scheduled_start_at: string | null;
  live_started_at: string | null;
  live_ended_at: string | null;
  owner: VideoOwnerView;
  place: VideoPlaceView;
  highlight_count: number;
  can_manage: boolean;
}
