'use client';

import { useEffect, useState } from 'react';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import { orgSitePath } from '@/lib/org-sites/urls';

// Org news for MEMBERS (phase 9 V5; leagues in program 11 L2): every
// published post, including the members-only ones a private org keeps off
// its site. Reads the session-gated /news/mine; renders nothing for
// visitors, non-members or when there is no site. Public posts link to the
// site; the rest expand here (headings, paragraphs, images — the block
// model, text-first).

interface NewsBlock {
  type: string;
  text?: string;
  path?: string;
  alt?: string;
  links?: { label: string; url: string }[];
}
interface MemberPost {
  id: string;
  slug: string;
  title: string;
  publishedAt: string;
  audience: 'public' | 'members';
  blocks: NewsBlock[];
}

export default function OrgNewsCard({ side, orgId, isMember }: { side: 'league' | 'club'; orgId: string; isMember: boolean }) {
  const plural = side === 'league' ? 'leagues' : 'clubs';
  const label = side === 'league' ? 'League news' : 'Club news';
  const [posts, setPosts] = useState<MemberPost[] | null>(null);
  const [site, setSite] = useState<{ id: string; subdomain: string; published: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!isMember) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/${plural}/${encodeURIComponent(orgId)}/news/mine`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { posts: MemberPost[]; site: { id: string; subdomain: string; published: boolean } | null };
        if (!cancelled) {
          setPosts(body.posts);
          setSite(body.site);
        }
      } catch {
        /* the card simply stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plural, orgId, isMember]);

  if (!isMember || !posts || posts.length === 0) return null;

  return (
    <section aria-label={label} className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-org-news={posts.length}>
      <h2 className="text-lg font-semibold text-primary">{label}</h2>
      <ul className="mt-2 divide-y divide-border-subtle">
        {posts.map(p => (
          <li key={p.id} className="py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={() => setOpen(o => (o === p.id ? null : p.id))}
                className="text-left text-sm font-medium text-primary hover:text-brand-fg"
                aria-expanded={open === p.id}
              >
                {p.title}
              </button>
              <span className="text-xs text-muted">
                {p.publishedAt.slice(0, 10)}
                {p.audience === 'members' ? ' · members only' : ''}
              </span>
            </div>
            {open === p.id && (
              <div className="mt-2 space-y-2 text-sm text-secondary" data-news-body={p.slug}>
                {p.blocks.map((b, i) =>
                  b.type === 'heading' ? (
                    <p key={i} className="font-semibold text-primary">{b.text}</p>
                  ) : b.type === 'paragraph' ? (
                    <p key={i} className="whitespace-pre-wrap">{b.text}</p>
                  ) : b.type === 'image' && site && b.path ? (
                    // eslint-disable-next-line @next/next/no-img-element -- org-media rides the tokenless streamer, not next/image (the image policy)
                    <img key={i} src={orgMediaUrl(site.id, b.path) ?? undefined} alt={b.alt ?? ''} className="max-w-full rounded-md" />
                  ) : b.type === 'link-list' && b.links ? (
                    <ul key={i} className="list-disc pl-5">
                      {b.links.map(l => (
                        <li key={l.url}>
                          <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-brand-fg hover:underline">
                            {l.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null
                )}
                {p.audience === 'public' && site?.published && (
                  <p>
                    <a href={`${orgSitePath(site.subdomain)}/news/${p.slug}`} className="text-brand-fg font-medium hover:underline">
                      Read on the site →
                    </a>
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
