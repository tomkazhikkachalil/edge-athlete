/**
 * Videos (296) — the row and payload shapes. Types only.
 */
import type { OrgKind } from '@/lib/orgs/org-ref';
import type { HighlightMeta, VideoStatus } from './rules';

export interface VideoRow {
  id: string;
  provider: 'youtube';
  provider_video_id: string;
  profile_id: string | null;
  org_id: string | null;
  sport_event_id: string | null;
  contest_id: string | null;
  created_by_user_id: string | null;
  title: string;
  description: string | null;
  sport_key: string | null;
  duration_ms: number | null;
  status: VideoStatus;
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
}

export type VideoOwnerView =
  | { kind: 'profile'; id: string; name: string; handle: string | null; avatar_url: string | null }
  | { kind: 'org'; id: string; side: OrgKind; name: string };

export type VideoPlaceView = { kind: 'sport_event' | 'contest'; id: string; name: string } | null;

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
  owner: VideoOwnerView;
  place: VideoPlaceView;
  highlight_count: number;
  can_manage: boolean;
}
