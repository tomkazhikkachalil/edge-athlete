'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatDisplayName } from '@/lib/formatters';
import { isOptimizableImageSrc } from '@/lib/media/image-src';

// Household archive (Wave 9): the family's shared history — every post
// across the household, newest first, month-grouped, phone-first. Read-only
// by nature, so view-only seats get the whole surface. Media renders through
// the same proxy URLs as everywhere else (the proxy re-authorizes live).

interface ArchiveMedia {
  type: 'image' | 'video';
  url: string;
  thumbnailUrl: string | null;
}

interface ArchiveItem {
  id: string;
  profileId: string;
  caption: string | null;
  status: string;
  createdAt: string;
  media: ArchiveMedia[];
}

interface RosterAthlete {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
}

const STATUS_CHIPS: Record<string, string> = {
  pending_approval: 'Waiting for approval',
  changes_requested: 'Sent back',
  rejected: 'Not approved',
};

function monthKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function HouseholdArchivePage() {
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const [athletes, setAthletes] = useState<RosterAthlete[]>([]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [child, setChild] = useState<string>('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (initialAuthCheckComplete && !loading && !user) router.replace('/');
  }, [initialAuthCheckComplete, loading, user, router]);

  // One loader for first page + child switches (the effect owns it — the
  // Load-more path reuses the ref like the consent dashboard's pattern).
  const loadRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      setState('loading');
      try {
        const [rosterRes, pageRes] = await Promise.all([
          fetch('/api/guardian/athletes'),
          fetch(`/api/guardian/archive${child ? `?child=${child}` : ''}`),
        ]);
        if (cancelled) return;
        if (!rosterRes.ok || !pageRes.ok) { setState('error'); return; }
        const roster = await rosterRes.json();
        const page = await pageRes.json();
        if (cancelled) return;
        setAthletes(roster.athletes ?? []);
        setItems(page.items ?? []);
        setNextCursor(page.nextCursor ?? null);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };
    loadRef.current = run;
    run();
    return () => { cancelled = true; };
  }, [user, child, retryKey]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/guardian/archive?cursor=${encodeURIComponent(nextCursor)}${child ? `&child=${child}` : ''}`
      );
      if (res.ok) {
        const page = await res.json();
        setItems(prev => [...prev, ...(page.items ?? [])]);
        setNextCursor(page.nextCursor ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const nameOf = (id: string) => {
    const a = athletes.find(x => x.id === id);
    return a ? formatDisplayName(a.first_name, null, a.last_name, a.display_name) : '';
  };

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  // Month grouping preserves the newest-first order the API returns.
  const groups: Array<{ month: string; items: ArchiveItem[] }> = [];
  for (const item of items) {
    const month = monthKey(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <Link
          href="/app/guardian"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300 mb-4 min-h-[44px]"
        >
          <i className="fas fa-chevron-left text-xs"></i>
          Family console
        </Link>
        <h1 className="text-2xl font-bold text-primary mb-1">Family archive</h1>
        <p className="text-sm text-tertiary mb-4">
          Everything your athletes have shared, in one place.
        </p>

        {athletes.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              type="button"
              onClick={() => setChild('')}
              className={`px-3 py-2 min-h-[44px] inline-flex items-center rounded-full text-sm font-semibold border transition-colors ${
                child === '' ? 'border-brand bg-brand-soft text-brand-fg-strong' : 'border-border-strong text-secondary hover:bg-surface-muted'
              }`}
            >
              Everyone
            </button>
            {athletes.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => setChild(a.id)}
                className={`px-3 py-2 min-h-[44px] inline-flex items-center rounded-full text-sm font-semibold border transition-colors ${
                  child === a.id ? 'border-brand bg-brand-soft text-brand-fg-strong' : 'border-border-strong text-secondary hover:bg-surface-muted'
                }`}
              >
                {nameOf(a.id)}
              </button>
            ))}
          </div>
        )}

        {state === 'loading' && (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>
        )}
        {state === 'error' && (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <p role="alert" className="text-sm text-tertiary mb-4">Couldn&apos;t load the archive.</p>
            <button
              type="button"
              onClick={() => setRetryKey(k => k + 1)}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] bg-brand text-white rounded-lg text-sm font-semibold hover:bg-brand-hover transition"
            >
              <i className="fas fa-rotate-right text-xs"></i>
              Try again
            </button>
          </div>
        )}
        {state === 'ready' && items.length === 0 && (
          <p className="text-sm text-muted bg-surface border border-border rounded-lg p-6 text-center">
            Nothing here yet — posts your athletes share will build the family
            archive automatically.
          </p>
        )}

        {state === 'ready' &&
          groups.map(group => (
            <section key={group.month} className="mb-8">
              <h2 className="text-xs font-bold uppercase tracking-wide text-tertiary mb-3">{group.month}</h2>
              <div className="space-y-3">
                {group.items.map(item => (
                  <article key={item.id} className="bg-surface border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                      <p className="text-sm font-semibold text-primary">{nameOf(item.profileId)}</p>
                      <span className="text-xs text-muted">
                        {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {STATUS_CHIPS[item.status] && (
                          <span className="ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-tertiary">
                            {STATUS_CHIPS[item.status]}
                          </span>
                        )}
                      </span>
                    </div>
                    {item.caption && <p className="text-sm text-secondary mb-2">{item.caption}</p>}
                    {item.media.length > 0 && (
                      <div className="grid grid-cols-3 gap-1.5">
                        {item.media.slice(0, 6).map((m, i) => {
                          const src = m.thumbnailUrl ?? m.url;
                          return (
                            <div key={i} className="relative aspect-square rounded-md overflow-hidden bg-surface-sunken">
                              {m.type === 'video' && !m.thumbnailUrl ? (
                                <span className="absolute inset-0 flex items-center justify-center text-muted">
                                  <i className="fas fa-video"></i>
                                </span>
                              ) : (
                                <Image
                                  src={src}
                                  alt=""
                                  fill
                                  sizes="(max-width: 640px) 33vw, 200px"
                                  className="object-cover"
                                  unoptimized={!isOptimizableImageSrc(src)}
                                />
                              )}
                              {m.type === 'video' && m.thumbnailUrl && (
                                <span className="absolute bottom-1 right-1 text-white text-xs drop-shadow">
                                  <i className="fas fa-video"></i>
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}

        {state === 'ready' && nextCursor && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="w-full px-4 py-3 min-h-[44px] border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load older posts'}
          </button>
        )}
      </main>
    </div>
  );
}
