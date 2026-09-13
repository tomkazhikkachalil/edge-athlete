import Image from 'next/image';
import Link from 'next/link';
import type { PublicGalleryItem } from '@/lib/org-sites/public-data';
import ScrollStrip from './ScrollStrip';

// The gallery ON THE HOME — Site Builder program 3, D1b. The teaser link
// was all the home had; a `strip` scrolls the picked photos sideways, a
// `grid` tiles them. Every photo links to the gallery page (the lightbox
// lives there — no script here). Videos show their poster frame as an
// image link. Props-only; the items arrive resolved (the consent-gated
// public reader, names masked upstream).
export default function GalleryStrip({ items, basePath, variant }: { items: PublicGalleryItem[]; basePath: string; variant: 'strip' | 'grid' }) {
  const tile = (it: PublicGalleryItem) => (
    <Link href={`${basePath}/gallery`} className="block overflow-hidden rounded-lg bg-surface-sunken" aria-label={it.caption ?? 'Open the gallery'}>
      <Image src={it.url} alt={it.caption ?? ''} width={it.width ?? 800} height={it.height ?? 600} unoptimized className="aspect-[4/3] h-auto w-full object-cover" />
    </Link>
  );
  if (variant === 'strip') {
    return (
      <ScrollStrip label="Gallery" itemWidth="12rem" testId="gallery">
        {items.map(it => (
          <div key={it.id}>{tile(it)}</div>
        ))}
      </ScrollStrip>
    );
  }
  return (
    <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" data-variant="grid">
      {items.map(it => (
        <li key={it.id}>{tile(it)}</li>
      ))}
    </ul>
  );
}
