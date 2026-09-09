import Image from 'next/image';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import type { PageBlock } from '@/lib/org-sites/validate';

// Custom-page block renderer (phase 3 R3). Blocks arrive through
// parsePageBody, so everything here is already schema-valid — but images
// still route through orgMediaUrl (which re-asserts the site prefix) and
// external links carry noopener + nofollow. Server component; no client
// hooks, no Font Awesome, light-only (the public-segment rules). Page
// images carry client-measured intrinsic dimensions when available
// (correct aspect reserved before load); 1200×675 is the legacy-block
// fallback and h-auto w-full still governs the layout width.
// `headingLevel`: a page's blocks head at h2; inside a home-page section
// (the text widget, phase 6) the section's own heading is the h2, so the
// blocks' headings step down to h3.
export default function PageBlocks({
  blocks,
  siteId,
  headingLevel = 'h2',
}: {
  blocks: PageBlock[];
  siteId: string;
  headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':
            return (
              <Heading key={i} className={`${headingLevel === 'h3' ? 'text-base' : 'text-lg'} font-semibold text-primary pt-2`}>
                {block.text}
              </Heading>
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
                width={block.width ?? 1200}
                height={block.height ?? 675}
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
                      <span className="sr-only"> (opens in a new tab)</span>
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
