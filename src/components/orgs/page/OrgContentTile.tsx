'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Film, Image as ImageIcon, Type } from 'lucide-react';
import type { AppSlot } from '@/lib/site-builder/app-layout';
import { WIDGETS } from '@/lib/site-builder/catalog';
import BubbleCard from '@/components/bubbles/BubbleCard';
import PageBlocks from '@/app/(public)/org/[slug]/_components/PageBlocks';

/**
 * A content tile on the in-app org page — Site Builder P10-B (Sep 9 2026).
 * The site's text / image / embed widgets, rendered where the manager placed
 * them (reading order), from the composition the org GET already RESOLVED
 * (blocks, a streamer URL, a rebuilt frame src — never raw config, never
 * zod here: guardrail 4c). A tile is content, not a bubble: no window, no
 * `data-org-bubble`; its identity is the instance (`data-org-tile`).
 *
 * Titled → the house bubble card, static (the whole card is not a button);
 * untitled → a bare `.ea-bubble` (a paragraph or a photo needs no "Text"
 * above it — the public frame's `headingOptional` rule). An EMPTY tile only
 * reaches managers (the server drops it for everyone else) and shows the
 * catalog's staff line as a door to the editor.
 */
const SPAN_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'col-span-1',
  md: 'col-span-2',
  lg: 'col-span-2 lg:col-span-4',
};

const ICONS = { text: Type, image: ImageIcon, embed: Film } as const;

export default function OrgContentTile({
  slot,
  siteId,
  side,
  orgId,
  canManage,
  staggerIndex,
}: {
  slot: AppSlot;
  siteId: string | null;
  side: 'league' | 'club';
  orgId: string;
  canManage: boolean;
  staggerIndex: number;
}) {
  const kind = slot.key as keyof typeof ICONS;
  const Icon = ICONS[kind] ?? Type;
  const rootAttrs = { 'data-org-tile': slot.instanceId ?? '', 'data-org-tile-kind': slot.key } as Record<`data-${string}`, string>;

  let body: React.ReactNode;
  if (!slot.tile) {
    // Empty (managers only — the server pruned it for everyone else).
    const staff = WIDGETS[slot.key].emptyState?.staff;
    body = canManage ? (
      <Link href={`/app/org/${side}/${orgId}/site/edit`} className="text-xs font-medium text-brand-fg hover:text-brand-fg-strong">
        {staff?.label ?? 'Open the editor →'}
      </Link>
    ) : null;
  } else if (slot.tile.kind === 'text') {
    body = siteId ? <PageBlocks blocks={slot.tile.blocks} siteId={siteId} headingLevel="h3" /> : null;
  } else if (slot.tile.kind === 'image') {
    const t = slot.tile;
    const img = <Image src={t.src} alt={t.alt} width={t.width} height={t.height} unoptimized className="h-auto w-full rounded-lg" />;
    body = (
      <figure>
        {t.href ? (
          <a href={t.href} target="_blank" rel="noopener nofollow">
            {img}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          img
        )}
        {t.caption && <figcaption className="mt-2 text-xs text-tertiary">{t.caption}</figcaption>}
      </figure>
    );
  } else {
    const t = slot.tile;
    body = (
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-surface-sunken" data-embed={t.provider}>
        <iframe
          src={t.src}
          title={t.title}
          loading="lazy"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="h-full w-full border-0"
        />
      </div>
    );
  }
  if (body === null) return null;

  if (slot.title) {
    return (
      <BubbleCard span={slot.span} icon={Icon} label={slot.title} staggerIndex={staggerIndex} rootAttrs={rootAttrs}>
        {body}
      </BubbleCard>
    );
  }
  return (
    <div style={{ animationDelay: `${Math.min(staggerIndex, 10) * 40}ms` }} {...rootAttrs} className={`ea-bubble ea-pop-in p-4 sm:p-5 ${SPAN_CLASSES[slot.span]}`}>
      {body}
    </div>
  );
}
