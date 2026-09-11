'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

// Program 2, B5 (Sep 11 2026): a page is a composition — it is arranged in
// the site editor (`?page=<id>`). This subpage was the block editor's door;
// it now sends the manager to the editor and keeps a link for a browser that
// does not follow. The block editor stays for news.
export default function OrgSitePageEditorPage() {
  const params = useParams();
  const router = useRouter();
  const side = params.side as string;
  const id = params.id as string;
  const pageId = params.pageId as string;
  const href = `/app/org/${side}/${id}/site/edit?page=${pageId}`;
  useEffect(() => {
    router.replace(href);
  }, [router, href]);
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <p className="text-sm text-secondary">
        Pages are arranged in the site editor —{' '}
        <Link href={href} className="text-brand-fg font-medium">
          open it
        </Link>
        .
      </p>
    </div>
  );
}
