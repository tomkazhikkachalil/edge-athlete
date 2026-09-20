'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import HelpVideo from '@/components/help/HelpVideo';
import HelpArticleBody from '@/components/help/HelpArticleBody';
import { HELP_TOPIC_LABELS, type PublicHelpArticle } from '@/lib/help/types';

// One help article (Spec 3): the video first when it carries one, then the
// body as blocks. PUBLIC; a draft or an unknown slug lands on "not found"
// with the way back — never a dead end.
export default function HelpArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [article, setArticle] = useState<(PublicHelpArticle & { body: string }) | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/help/articles/${encodeURIComponent(slug)}`);
        if (cancelled) return;
        if (res.status === 404) { setState('missing'); return; }
        if (!res.ok) { setState('error'); return; }
        const data = (await res.json()) as { article: PublicHelpArticle & { body: string } };
        if (cancelled) return;
        setArticle(data.article);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/help" className="text-sm text-brand-fg hover:underline mb-4 inline-flex items-center gap-2">
          <i className="fas fa-arrow-left text-xs"></i> Help Center
        </Link>
        {state === 'loading' && <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>}
        {state === 'missing' && <p className="text-sm text-tertiary">That article does not exist (or is not published yet).</p>}
        {state === 'error' && <p role="alert" className="text-sm text-tertiary">Couldn&apos;t load the article.</p>}
        {state === 'ready' && article && (
          <article data-help-article-page={article.slug}>
            <p className="text-xs text-muted uppercase tracking-wide mb-1">{HELP_TOPIC_LABELS[article.topic]}</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-primary mb-4">{article.title}</h1>
            {article.videoId && (
              <div className="mb-6">
                <HelpVideo videoId={article.videoId} title={article.title} />
              </div>
            )}
            <HelpArticleBody body={article.body} />
            <p className="text-xs text-muted mt-8">Updated {new Date(article.updated_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            <p className="text-sm text-secondary mt-6">
              Still stuck? <Link href="/help#request" className="text-brand-fg hover:underline">Submit a request</Link>.
            </p>
          </article>
        )}
      </main>
    </div>
  );
}
