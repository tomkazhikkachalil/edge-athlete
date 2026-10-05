import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import ResultShareCard from '@/components/play/ResultShareCard';
import ViewBeacon from '@/components/ViewBeacon';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { appBaseUrl } from '@/lib/org-sites/urls';
import { readShareCard } from '@/lib/play/share-server';

// ── /r/[postId] — a result, shareable (the Play program, 244) ──────────────
// The page a share link lands on and a link preview unfurls from. It is
// VIEWER-INDEPENDENT (the service role; the session is never read): a
// public result of a public profile renders for everyone, signed out
// included, with its 1200×630 card as og:image. A real post with no public
// card redirects to the in-app link (the normal privacy gate runs there);
// anything else is the house 404. Never a dead end: the header's signed-out
// branch carries Log in / Sign up, and the page links the athlete's public
// profile and the app.

interface PageParams { params: Promise<{ postId: string }> }

const read = cache((postId: string) => readShareCard(getSupabaseAdmin(), postId));

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { postId } = await params;
  const result = await read(postId);
  if (!result || !('card' in result)) return { title: 'Result — Edge Athlete' };
  const url = `${appBaseUrl()}/r/${postId}`;
  const image = `${url}/card.png`;
  return {
    title: `${result.card.title} — Edge Athlete`,
    description: result.card.description,
    alternates: { canonical: url },
    openGraph: { title: result.card.title, description: result.card.description, url, type: 'article', images: [{ url: image, width: 1200, height: 630, alt: result.card.title }] },
    twitter: { card: 'summary_large_image', title: result.card.title, description: result.card.description, images: [image] },
  };
}

export default async function ResultPage({ params }: PageParams) {
  const { postId } = await params;
  const result = await read(postId);
  if (!result) notFound();
  if ('fallback' in result) redirect(result.fallback);
  const { card, handle } = result;
  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-xl mx-auto px-4 py-6 sm:py-10" data-share-page>
        {/* Impact (252): a visit to the share page is a view — the server decides whose and whether it counts. */}
        <ViewBeacon postId={postId} />
        <ResultShareCard card={card} />
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          {handle && (
            <Link href={`/u/@${handle}`} className="ea-interactive flex-1 inline-flex justify-center items-center min-h-[44px] rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-primary">
              See {card.athleteName}&apos;s profile
            </Link>
          )}
          <Link href="/" className="ea-cta flex-1 inline-flex justify-center items-center min-h-[44px] rounded-lg px-4 text-sm font-semibold text-white">
            Track your own on Edge Athlete
          </Link>
        </div>
      </main>
    </div>
  );
}
