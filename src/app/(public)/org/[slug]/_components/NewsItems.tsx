import Image from 'next/image';
import Link from 'next/link';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import { formatEventWhen } from '@/lib/org-sites/format';
import type { PublicNewsItem } from '@/lib/org-sites/public-data';

// ── The news list rows (N1, program 10) ─────────────────────────────────────
// Shared by /news and the home's "Latest news" teaser: title, date, the
// first-paragraph excerpt and — when the post's body carries an image —
// a cover thumbnail (its first image block, orgMediaUrl re-asserting the
// site prefix). A fixed 16:9 box so a tall photo never grows the row;
// `unoptimized` because the streamer serves the bytes (the PageBlocks
// rule). Props-only, server-safe.

export default function NewsItems({
  posts,
  siteId,
  basePath,
}: {
  posts: PublicNewsItem[];
  siteId: string;
  basePath: string;
}) {
  return (
    <ul className="divide-y divide-border-subtle">
      {posts.map(post => {
        const cover = post.cover ? orgMediaUrl(siteId, post.cover.path) : null;
        return (
          <li key={post.slug} className="py-3 flex gap-3 items-start">
            {cover && (
              <Link
                href={`${basePath}/news/${post.slug}`}
                className="shrink-0 w-24 sm:w-32 aspect-video overflow-hidden rounded-lg bg-surface-muted"
                aria-hidden="true"
                tabIndex={-1}
                data-news-cover={post.slug}
              >
                <Image
                  src={cover}
                  alt=""
                  width={post.cover?.width ?? 1200}
                  height={post.cover?.height ?? 675}
                  unoptimized
                  className="h-full w-full object-cover"
                />
              </Link>
            )}
            <div className="min-w-0 flex-1">
              <Link href={`${basePath}/news/${post.slug}`} className="text-base font-semibold text-brand-fg">
                {post.title}
              </Link>
              <p className="mt-0.5 text-xs text-muted">
                {formatEventWhen({ starts_at: post.publishedAt, all_day: true, timezone: null })}
              </p>
              {post.excerpt && <p className="mt-1 text-sm text-secondary">{post.excerpt}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
