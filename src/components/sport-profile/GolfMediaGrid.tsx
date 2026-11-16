'use client';

/**
 * A round's photos and clips as tiles (golf's sport profile, "one wave" phase 3):
 * tiles crop, the viewer contains — the shared MediaTile and MediaLightbox.
 * Each tile can carry a caption that is a door (the hole it was taken on).
 */
import Link from 'next/link';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import MediaLightbox from '@/components/media/MediaLightbox';
import MediaTile from '@/components/media/MediaTile';
import type { GolfMedia } from '@/lib/sport-profile/golf-rules';

interface Props {
  media: GolfMedia[];
  /** What a tile is, in words ("Hole 7, The Marshes, Oct 18") — its alt text and the viewer's footer. */
  describe: (m: GolfMedia) => string;
  /** Under a tile: where it was taken, as a door. Omitted on the hole's own page. */
  caption?: (m: GolfMedia) => { text: string; href: string } | null;
}

export default function GolfMediaGrid({ media, describe, caption }: Props) {
  const [viewing, setViewing] = useState<number | null>(null);
  if (media.length === 0) return null;
  const items = media.map(m => ({ id: m.id, url: m.url, kind: m.type, thumbnailUrl: m.poster, durationSeconds: m.seconds, alt: describe(m) }));
  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-golf-media="">
        {media.map((m, i) => {
          const c = caption?.(m) ?? null;
          return (
            <li key={m.id} data-golf-media-item={m.id}>
              <MediaTile src={m.url} thumbnailUrl={m.poster} kind={m.type} alt={describe(m)} durationSeconds={m.seconds} onClick={() => setViewing(i)} className="aspect-square rounded-lg" />
              {c && (
                <Link href={c.href} className="ea-interactive mt-1 flex min-h-[44px] items-start rounded text-xs text-secondary underline decoration-border underline-offset-4" data-golf-media-door="">
                  {c.text}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {viewing !== null && items[viewing] && typeof document !== 'undefined' && createPortal(
        <MediaLightbox items={items} index={viewing} onIndexChange={setViewing} onClose={() => setViewing(null)} footerFor={item => items.find(i => i.id === item.id)?.alt ?? null} />,
        document.body,
      )}
    </>
  );
}
