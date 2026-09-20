'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import HelpVideo from '@/components/help/HelpVideo';
import GuestRequestForm from '@/components/help/GuestRequestForm';
import { SubmitRequest, MyRequests } from '@/components/settings/SupportSettings';
import { COPY } from '@/lib/copy';
import { HELP_TOPICS, HELP_TOPIC_LABELS, type HelpTopic, type PublicHelpArticle } from '@/lib/help/types';

// The Help Center (Support & Reporting, Spec 3) — the doc's four parts, top
// to bottom: how-to videos, the searchable article list by topic, Submit a
// request (the signed-in form with a screenshot, or the guest form), and
// Contact — plus My requests for a signed-in reader. PUBLIC: a signed-out
// visitor reads everything and files through the guest form; AppHeader's
// signed-out branch handles the chrome. `?ticket=<id>` deep-links a
// request (the bells' link points at Settings → Support, which hosts the
// same components; both work).

type Section = 'videos' | 'articles' | 'request' | 'contact' | 'mine';

export default function HelpCenterPage() {
  const { user, initialAuthCheckComplete } = useAuth();
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [articles, setArticles] = useState<PublicHelpArticle[]>([]);
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState<HelpTopic | ''>('');
  const [listKey, setListKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/help/articles');
        if (!res.ok) { if (!cancelled) setState('error'); return; }
        const data = (await res.json()) as { supported: boolean; articles: PublicHelpArticle[] };
        if (cancelled) return;
        setArticles(data.articles);
        setState(data.supported ? 'ready' : 'unsupported');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const videos = useMemo(() => articles.filter(a => a.videoId), [articles]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return articles.filter(a => (!topic || a.topic === topic) && (!needle || a.title.toLowerCase().includes(needle) || a.excerpt.toLowerCase().includes(needle)));
  }, [articles, q, topic]);
  const byTopic = useMemo(() => {
    const groups = new Map<HelpTopic, PublicHelpArticle[]>();
    for (const t of HELP_TOPICS) groups.set(t, []);
    for (const a of filtered) groups.get(a.topic)?.push(a);
    return [...groups.entries()].filter(([, list]) => list.length > 0);
  }, [filtered]);

  const sections: Array<{ id: Section; label: string }> = [
    { id: 'videos', label: 'How-to videos' },
    { id: 'articles', label: 'Articles' },
    { id: 'request', label: 'Submit a request' },
    ...(user ? [{ id: 'mine' as const, label: 'My requests' }] : []),
    { id: 'contact', label: 'Contact' },
  ];

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8" data-help-center="">
        <h1 className="text-2xl sm:text-3xl font-bold text-primary mb-1">
          <i className="fas fa-life-ring mr-2 text-brand-fg"></i>
          Help Center
        </h1>
        <p className="text-sm text-tertiary mb-4">How-to videos, short articles, and a way to reach us that gets a ticket number.</p>
        <nav aria-label="Help sections" className="flex flex-wrap gap-2 mb-8">
          {sections.map(s => (
            <a key={s.id} href={`#${s.id}`} className="px-3 py-1.5 min-h-[36px] inline-flex items-center rounded-full border border-border bg-surface text-xs font-semibold text-secondary ea-interactive">
              {s.label}
            </a>
          ))}
        </nav>

        {/* 1. How-to videos */}
        <section id="videos" className="mb-10 scroll-mt-24" aria-labelledby="help-videos">
          <h2 id="help-videos" className="text-lg font-semibold text-primary mb-1">How-to videos</h2>
          <p className="text-sm text-tertiary mb-4">Short, one per task. Tap to play.</p>
          {state === 'loading' && <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand my-6"></div>}
          {state !== 'loading' && videos.length === 0 && <p className="text-sm text-muted">Videos are on their way — the first five are being recorded.</p>}
          {videos.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2" data-help-videos="">
              {videos.map(v => (
                <div key={v.slug} className="ea-surface rounded-lg p-3">
                  <HelpVideo videoId={v.videoId!} title={v.title} />
                  <Link href={`/help/${v.slug}`} className="block mt-2 text-sm font-semibold text-primary hover:text-brand-fg">{v.title}</Link>
                  <p className="text-xs text-muted">{HELP_TOPIC_LABELS[v.topic]}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 2. Articles */}
        <section id="articles" className="mb-10 scroll-mt-24" aria-labelledby="help-articles">
          <h2 id="help-articles" className="text-lg font-semibold text-primary mb-1">Articles</h2>
          <p className="text-sm text-tertiary mb-4">Search, or browse by topic.</p>
          <div className="flex flex-wrap gap-2 mb-4">
            <input type="search" aria-label="Search articles" placeholder="Search the articles" value={q} onChange={e => setQ(e.target.value)} className="min-h-[44px] flex-1 min-w-[12rem] rounded-lg border border-border bg-surface px-3 text-sm text-primary" data-help-search="" />
            <select aria-label="Topic" value={topic} onChange={e => setTopic(e.target.value as HelpTopic | '')} className="min-h-[44px] rounded-lg border border-border bg-surface px-2 text-sm text-primary">
              <option value="">All topics</option>
              {HELP_TOPICS.map(t => <option key={t} value={t}>{HELP_TOPIC_LABELS[t]}</option>)}
            </select>
          </div>
          {state === 'unsupported' && <p className="text-sm text-muted">Articles are not available yet.</p>}
          {state === 'error' && <p role="alert" className="text-sm text-muted">Couldn&apos;t load the articles.</p>}
          {state === 'ready' && filtered.length === 0 && <p className="text-sm text-muted">{articles.length === 0 ? 'The first articles are being written.' : 'Nothing matches.'}</p>}
          {byTopic.map(([t, list]) => (
            <div key={t} className="mb-5" data-help-topic={t}>
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wide mb-2">{HELP_TOPIC_LABELS[t]}</h3>
              <ul className="space-y-2">
                {list.map(a => (
                  <li key={a.slug}>
                    <Link href={`/help/${a.slug}`} className="block ea-surface ea-surface-raised rounded-lg p-4 ea-interactive" data-help-article={a.slug}>
                      <p className="text-sm font-semibold text-primary">{a.videoId ? <i className="fas fa-circle-play text-brand-fg mr-2" aria-hidden="true"></i> : null}{a.title}</p>
                      {a.excerpt && <p className="text-xs text-muted mt-1">{a.excerpt}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* 3. Submit a request */}
        <section id="request" className="mb-10 scroll-mt-24" aria-labelledby="help-request">
          {!initialAuthCheckComplete ? (
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand my-6"></div>
          ) : user ? (
            <SubmitRequest onCreated={() => setListKey(k => k + 1)} />
          ) : (
            <>
              <h2 id="help-request" className="text-lg font-semibold text-primary mb-1">Submit a request</h2>
              <p className="text-sm text-tertiary mb-4">
                You are not signed in — leave an email and we reply there. <Link href="/" className="text-brand-fg hover:underline">Sign in</Link> to follow your requests in the app.
              </p>
              <GuestRequestForm />
            </>
          )}
        </section>

        {/* 4. My requests (signed in) */}
        {user && (
          <section id="mine" className="mb-10 scroll-mt-24">
            <Suspense fallback={null}>
              <MyRequests listKey={listKey} openId={null} />
            </Suspense>
          </section>
        )}

        {/* 5. Contact */}
        <section id="contact" className="mb-10 scroll-mt-24" aria-labelledby="help-contact">
          <h2 id="help-contact" className="text-lg font-semibold text-primary mb-1">Contact</h2>
          <p className="text-sm text-tertiary mb-4">{COPY.SUPPORT.CONTACT_NOTE}</p>
          <div className="ea-surface rounded-lg p-4" data-help-contact="">
            <p className="text-sm font-semibold text-primary">{COPY.SUPPORT.CONTACT_NAME}</p>
            <p className="text-xs text-muted">{COPY.SUPPORT.CONTACT_ROLE}</p>
            <a href={`mailto:${COPY.SUPPORT.CONTACT_EMAIL}`} className="inline-flex items-center gap-2 mt-2 text-sm text-brand-fg hover:underline min-h-[44px]">
              <i className="fas fa-envelope" aria-hidden="true"></i>
              {COPY.SUPPORT.CONTACT_EMAIL}
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
