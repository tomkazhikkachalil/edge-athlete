import Image from 'next/image';
import Link from 'next/link';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import { formatEventWhen } from '@/lib/org-sites/format';
import { parsePageBody } from '@/lib/org-sites/validate';
import type { PublicNewsItem } from '@/lib/org-sites/public-data';
import PageBlocks from './PageBlocks';

// ── The news list rows (N1, program 10) ─────────────────────────────────────
// Shared by /news and the home's "Latest news" teaser: title, date, the
// first-paragraph excerpt and — when the post's body carries an image —
// a cover thumbnail (its first image block, orgMediaUrl re-asserting the
// site prefix). A fixed 16:9 box so a tall photo never grows the row;
// `unoptimized` because the streamer serves the bytes (the PageBlocks
// rule). Props-only, server-safe.
//
// Program 3, D4: `variant` — the list (today), a grid of cards (cover on
// top), or a featured post (the first, large) over the list; `click` —
// the post's page (today) or "expands in place": a native `<details>`
// carrying the body (server-rendered, no script — the (public) contract);
// a pinned post (189) wears a "Pinned" chip.

const when = (post: PublicNewsItem) => formatEventWhen({ starts_at: post.publishedAt, all_day: true, timezone: null });

export default function NewsItems({
  posts,
  siteId,
  basePath,
  variant = 'list',
  click = 'detail',
}: {
  posts: PublicNewsItem[];
  siteId: string;
  basePath: string;
  variant?: 'list' | 'grid' | 'featured';
  click?: 'detail' | 'inline';
}) {
  const href = (post: PublicNewsItem) => `${basePath}/news/${post.slug}`;
  const coverSrc = (post: PublicNewsItem) => (post.cover ? orgMediaUrl(siteId, post.cover.path) : null);
  const pin = (post: PublicNewsItem) =>
    post.pinned ? (
      <span className="ml-2 inline-block rounded-full border border-border px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-tertiary" data-news-pinned={post.slug}>
        Pinned
      </span>
    ) : null;
  const cover = (post: PublicNewsItem, cls: string, linked: boolean) => {
    const src = coverSrc(post);
    if (!src) return null;
    const img = <Image src={src} alt="" width={post.cover?.width ?? 1200} height={post.cover?.height ?? 675} unoptimized className="h-full w-full object-cover" />;
    return linked ? (
      <Link href={href(post)} className={cls} aria-hidden="true" tabIndex={-1} data-news-cover={post.slug}>
        {img}
      </Link>
    ) : (
      <span className={cls} data-news-cover={post.slug}>
        {img}
      </span>
    );
  };
  const title = (post: PublicNewsItem, cls: string) =>
    click === 'detail' ? (
      <Link href={href(post)} className={`${cls} text-brand-fg`}>
        {post.title}
      </Link>
    ) : (
      <span className={`${cls} text-primary`}>{post.title}</span>
    );
  /** The body in place — a native disclosure; the summary is the row. */
  const inline = (post: PublicNewsItem, summary: React.ReactNode, cls?: string) => (
    <details className={cls} data-news-inline={post.slug}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{summary}</summary>
      <div className="mt-3 border-t border-border-subtle pt-3">
        <PageBlocks blocks={parsePageBody(post.body)} siteId={siteId} headingLevel="h3" />
        <Link href={href(post)} className="mt-3 inline-block text-sm font-medium text-brand-fg">
          Open the post →
        </Link>
      </div>
    </details>
  );

  const row = (post: PublicNewsItem) => {
    const summary = (
      <div className="flex gap-3 items-start">
        {cover(post, 'shrink-0 w-24 sm:w-32 aspect-video overflow-hidden rounded-lg bg-surface-muted', click === 'detail')}
        <div className="min-w-0 flex-1">
          {title(post, 'text-base font-semibold')}
          {pin(post)}
          <p className="mt-0.5 text-xs text-muted">{when(post)}</p>
          {post.excerpt && <p className="mt-1 text-sm text-secondary">{post.excerpt}</p>}
        </div>
      </div>
    );
    return (
      <li key={post.slug} className="py-3">
        {click === 'inline' ? inline(post, summary) : summary}
      </li>
    );
  };

  const card = (post: PublicNewsItem, big = false) => {
    const summary = (
      <div>
        {cover(post, `block aspect-video w-full overflow-hidden rounded-lg bg-surface-muted ${big ? 'mb-3' : 'mb-2'}`, click === 'detail')}
        {title(post, big ? 'text-xl font-bold' : 'text-base font-semibold')}
        {pin(post)}
        <p className="mt-0.5 text-xs text-muted">{when(post)}</p>
        {post.excerpt && <p className={`mt-1 text-sm text-secondary ${big ? '' : 'line-clamp-3'}`}>{post.excerpt}</p>}
      </div>
    );
    return click === 'inline' ? inline(post, summary) : summary;
  };

  if (variant === 'grid') {
    return (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-variant="grid">
        {posts.map(post => (
          <li key={post.slug} className="rounded-lg border border-border bg-canvas p-3">
            {card(post)}
          </li>
        ))}
      </ul>
    );
  }
  if (variant === 'featured' && posts.length > 0) {
    const [first, ...rest] = posts;
    return (
      <div data-variant="featured">
        <div className="rounded-lg border border-border bg-canvas p-4" data-news-featured={first.slug}>
          {card(first, true)}
        </div>
        {rest.length > 0 && <ul className="mt-2 divide-y divide-border-subtle">{rest.map(row)}</ul>}
      </div>
    );
  }
  return <ul className="divide-y divide-border-subtle">{posts.map(row)}</ul>;
}
