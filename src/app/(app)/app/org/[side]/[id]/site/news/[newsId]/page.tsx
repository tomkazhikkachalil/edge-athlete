'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

// Sports-team website program, N4 (Sep 27 2026): news is written in the site
// editor's newsroom now (`?news=<id>`) — one home for the site. This subpage
// was the block editor's door; it sends the manager to the post in the
// editor and keeps a link for a browser that does not follow (the pages
// subpage's recipe, program 2 B5).
export default function OrgSiteNewsEditorPage() {
  const params = useParams();
  const router = useRouter();
  const side = params.side as string;
  const id = params.id as string;
  const newsId = params.newsId as string;
  const href = `/app/org/${side}/${id}/site/edit?news=${newsId}`;
  useEffect(() => {
    router.replace(href);
  }, [router, href]);
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <p className="text-sm text-secondary">
        News is written in the site editor —{' '}
        <Link href={href} className="text-brand-fg font-medium">
          open the post
        </Link>
        .
      </p>
    </div>
  );
}
