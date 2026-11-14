'use client';

import Link from 'next/link';
import { AddVideoLink, VideoCardGrid } from '@/components/videos/VideoCards';
import type { OpenClaim } from '@/lib/videos/video-claims-server';
import type { VideoView } from '@/lib/videos/types';
import type { OrgKind } from '@/lib/orgs/org-ref';

// The Videos bubble (Videos program, 296): the full games and long videos
// the org linked from YouTube. Items come from /api/videos?side=&orgId= —
// the org gallery's gate (public org: everyone; private: members) plus the
// manage_video capability for the hidden rows and the door. Face: the count
// over the newest poster. Window: the cards, each opening /videos/[id].

export interface VideosRead {
  count: number;
  items: VideoView[];
  canAdd: boolean;
  /** Managers only: athletes asking to be linked to the tags of one of these videos. */
  claims: OpenClaim[];
}

export function pickVideos(body: unknown): VideosRead {
  const b = body as { videos?: VideoView[]; can_add?: boolean; claims?: OpenClaim[] };
  const items = b.videos ?? [];
  return { count: items.length, items, canAdd: !!b.can_add, claims: b.claims ?? [] };
}

export function addVideoHref(side: OrgKind, orgId: string): string {
  return `/videos/new?side=${side}&orgId=${encodeURIComponent(orgId)}`;
}

export function VideosFace({ read }: { read: VideosRead }) {
  const first = read.items[0];
  return (
    <div>
      <div className="text-2xl sm:text-3xl font-bold text-primary tabular-nums leading-none">{read.count}</div>
      <div className="mt-1.5 text-xs text-muted">{read.count === 1 ? 'video' : 'videos'}</div>
      {read.claims.length > 0 && <div className="mt-1 text-xs font-medium text-brand-fg" data-org-videos-claims-hint={read.claims.length}>{read.claims.length} asking to be linked</div>}
      {first && (
        <div className="mt-3 rounded-lg overflow-hidden aspect-video bg-surface-muted relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- a third-party thumbnail; not an optimizer candidate */}
          <img src={first.thumb_url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        </div>
      )}
    </div>
  );
}

export function VideosEmptyFace({ side, orgId, canAdd }: { side: OrgKind; orgId: string; canAdd: boolean }) {
  return (
    <div>
      <div className="text-2xl sm:text-3xl font-bold text-primary tabular-nums leading-none">0</div>
      <div className="mt-1.5 text-xs text-muted">videos</div>
      {canAdd && (
        <span className="mt-1.5 inline-block text-xs font-medium text-brand-fg" data-org-videos-add-hint={addVideoHref(side, orgId)}>
          Add a full game →
        </span>
      )}
    </div>
  );
}

export function VideosWindow({ read, side, orgId }: { read: VideosRead; side: OrgKind; orgId: string }) {
  return (
    <section aria-label="Videos" data-org-videos={read.count}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-primary">Videos</h2>
        {read.canAdd && <AddVideoLink href={addVideoHref(side, orgId)} />}
      </div>
      {read.claims.length > 0 && (
        <div className="mb-4 rounded-lg border border-border bg-surface p-3" data-org-videos-claims={read.claims.length}>
          <p className="text-sm font-semibold text-primary">Asking to be linked</p>
          <p className="text-xs text-muted mb-2">Athletes who say they are in one of these games. Open the video to say which name or player they are, or to decline.</p>
          <ul className="divide-y divide-border-subtle">
            {read.claims.map(c => (
              <li key={c.id}>
                <Link href={`/videos/${c.video_id}`} className="ea-interactive flex min-h-[44px] flex-col justify-center py-2" data-org-videos-claim={c.id}>
                  <span className="text-sm text-primary break-words"><span className="font-semibold">{c.requester_name}</span>{c.asked_name ? ` — “${c.asked_name}”` : ''}</span>
                  <span className="text-xs text-muted break-words">{c.video_title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {read.count === 0 ? (
        <p className="text-sm text-muted">{read.canAdd ? 'No videos yet. Link a full game from YouTube and mark its highlights.' : 'No videos yet.'}</p>
      ) : (
        <VideoCardGrid videos={read.items} />
      )}
    </section>
  );
}
