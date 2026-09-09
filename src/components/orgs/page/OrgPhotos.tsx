'use client';

import { useState } from 'react';
import Link from 'next/link';
import MediaCollage, { type CollageItem } from '@/components/media/MediaCollage';
import MediaGrid from '@/components/media/MediaGrid';
import MediaLightbox from '@/components/media/MediaLightbox';

// The Photos bubble (Org Pages R4, Sep 8 2026) — the first in-app gallery
// an org has had. Items come from /api/{side}s/[id]/gallery: the public
// site's list under the public site's gates (members' round photos a
// manager picked + published contest media), ordered as one timeline.
// Face: the count over a four-up collage. Window: the full grid, each tile
// opening the house MediaLightbox (z-[60], above the window). Streamer
// URLs (/api/media/*) are never optimizer-eligible; MediaTile already
// handles that.

export interface AppGalleryItem {
  id: string;
  url: string;
  mediaType: 'image' | 'video';
  caption: string | null;
  date: string | null;
  competitionName: string;
  tagLabels: string[];
  kind: 'member' | 'contest';
  width: number | null;
  height: number | null;
}

export interface PhotosRead {
  count: number;
  items: CollageItem[];
  meta: Map<string, AppGalleryItem>;
  sitePublished: boolean | null;
}

export function pickPhotos(body: unknown): PhotosRead {
  const b = body as { items?: AppGalleryItem[]; site?: { id: string; published: boolean } | null };
  const raw = b.items ?? [];
  const items: CollageItem[] = raw.map(i => ({
    id: i.id,
    url: i.url,
    kind: i.mediaType,
    alt: i.caption ?? i.competitionName,
  }));
  return {
    count: raw.length,
    items,
    meta: new Map(raw.map(i => [i.id, i])),
    sitePublished: b.site ? b.site.published : null,
  };
}

export function PhotosFace({ read }: { read: PhotosRead }) {
  return (
    <div>
      <div className="text-2xl sm:text-3xl font-bold text-primary tabular-nums leading-none">{read.count}</div>
      <div className="mt-1.5 text-xs text-muted">{read.count === 1 ? 'photo' : 'photos'}</div>
      {read.items.length > 0 && (
        <MediaCollage
          items={read.items}
          max={4}
          className="mt-3 rounded-lg overflow-hidden"
          sizes="(max-width: 640px) 45vw, 200px"
        />
      )}
    </div>
  );
}

export function PhotosEmptyFace({
  read,
  canManage,
  consolePath,
}: {
  read: PhotosRead | null;
  canManage: boolean;
  consolePath: string;
}) {
  return (
    <div>
      <div className="text-2xl sm:text-3xl font-bold text-primary tabular-nums leading-none">0</div>
      <div className="mt-1.5 text-xs text-muted">photos</div>
      {canManage && (
        <Link href={`${consolePath}#website`} className="mt-1.5 inline-block text-xs font-medium text-brand-fg hover:text-brand-fg-strong">
          {read?.sitePublished === false ? 'Publish the site to show members’ round photos →' : 'Pick photos on your site →'}
        </Link>
      )}
    </div>
  );
}

function captionFor(item: CollageItem, meta: Map<string, AppGalleryItem>): string {
  const m = meta.get(item.id);
  if (!m) return item.alt ?? '';
  return [m.competitionName, m.date, m.tagLabels.join(', ')].filter(Boolean).join(' · ');
}

export function PhotosWindow({ read }: { read: PhotosRead }) {
  const [index, setIndex] = useState<number | null>(null);
  return (
    <section aria-label="Photos" data-org-gallery={read.count}>
      <h2 className="text-lg font-semibold text-primary mb-4">Photos</h2>
      <MediaGrid items={read.items} onSelect={setIndex} />
      {index !== null && (
        <MediaLightbox
          items={read.items}
          index={index}
          onIndexChange={setIndex}
          onClose={() => setIndex(null)}
          footerFor={item => <span className="text-sm">{captionFor(item, read.meta)}</span>}
        />
      )}
    </section>
  );
}
