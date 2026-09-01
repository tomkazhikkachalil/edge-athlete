import Image from 'next/image';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import type { PageBlock } from '@/lib/org-sites/validate';

// Custom-page block renderer (phase 3 R3). Blocks arrive through
// parsePageBody, so everything here is already schema-valid — but images
// still route through orgMediaUrl (which re-asserts the site prefix) and
// external links carry noopener + nofollow. Server component; no client
// hooks, no Font Awesome, light-only (the public-segment rules). Page
// images have no stored dimensions — width/height are aspect placeholders
// and h-auto w-full governs (accepted tradeoff).
export default function PageBlocks({
  blocks,
  siteId,
}: {
  blocks: PageBlock[];
  siteId: string;
}) {
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':
            return (
              <h2 key={i} className="text-lg font-semibold text-primary pt-2">
                {block.text}
              </h2>
            );
          case 'paragraph':
            return (
              <p key={i} className="text-sm text-secondary whitespace-pre-wrap">
                {block.text}
              </p>
            );
          case 'image': {
            const src = orgMediaUrl(siteId, block.path);
            if (!src) return null;
            return (
              <Image
                key={i}
                src={src}
                alt={block.alt}
                width={1200}
                height={675}
                unoptimized
                className="h-auto w-full rounded-lg"
              />
            );
          }
          case 'link-list':
            return (
              <ul key={i} className="divide-y divide-border-subtle">
                {block.links.map((link, j) => (
                  <li key={j} className="py-2">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener nofollow"
                      className="text-sm font-medium text-brand-fg"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            );
        }
      })}
    </div>
  );
}
