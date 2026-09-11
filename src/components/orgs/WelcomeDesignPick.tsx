'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/Toast';
import type { PublicSite } from '@/lib/org-sites/server';
import { moduleLabel, parseNavConfig, parseThemeTokens, resolveAccentPair } from '@/lib/org-sites/validate';
import { templateSpec } from '@/lib/org-sites/templates';
import { WIDGETS, isContentWidgetKey } from '@/lib/site-builder/catalog';
import { galleryEntriesFor, galleryMap, gallerySeed, type GalleryEntry, type GalleryOrg } from '@/lib/site-builder/gallery';
import type { SiteLayout } from '@/lib/site-builder/layout';
import { isFreshSite } from '@/lib/site-builder/seeds';
import { publishPlan } from '@/lib/site-builder/publish-target';
import { GalleryThumb } from '@/components/site-builder/Gallery';

// ── The design moment at creation (Sep 11 2026) ───────────────────────────
// The wizard lands on `?welcome=1` right after the sport was picked, on a
// phone too, and the site already exists — so THIS is where a manager first
// sees the designs, not the ≥lg editor. Each card is the same block-diagram
// thumbnail the editor's gallery draws, from the org's REAL facts (the
// canvas GET's `gallery`: name, city, venue coordinates for the map) — a
// sketch of the arrangement, honestly labelled, never a fake screenshot. One
// tap applies the design to the DRAFT through the same reducer action the
// editor uses (`apply_gallery`, clean — a fresh site has nothing to keep);
// then: take the site live, open the editor, or later. Renders only for a
// fresh site (`isFreshSite`, the editor's first-open rule); after a pick
// `draft !== null`, so the editor never offers twice.

interface CanvasBody {
  site: PublicSite;
  layout: SiteLayout;
  draft: { id: string; rev: number } | null;
  published?: boolean;
  gallery?: GalleryOrg;
}

interface Props {
  side: 'league' | 'club';
  orgId: string;
  plural: 'leagues' | 'clubs';
}

const USE = 'min-h-[44px] rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const PILL = 'inline-flex min-h-[44px] items-center rounded-md border border-border-strong px-3 text-sm text-secondary hover:bg-surface-sunken transition-colors';

export default function WelcomeDesignPick({ side, orgId, plural }: Props) {
  const { showError, showSuccess } = useToast();
  const [canvas, setCanvas] = useState<CanvasBody | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'hidden' | 'applied'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [applied, setApplied] = useState<GalleryEntry | null>(null);
  const [live, setLive] = useState(false);
  const [goingLive, setGoingLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/${plural}/${orgId}/site/canvas`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setState('hidden'); // no site yet, or not this manager's to arrange — the card is additive
          return;
        }
        const body = (await res.json()) as CanvasBody;
        if (cancelled) return;
        if (!isFreshSite({ draft: body.draft, published: body.published, layout: body.layout, site: body.site })) {
          setState('hidden');
          return;
        }
        setCanvas(body);
        setState('ready');
      } catch {
        if (!cancelled) setState('hidden');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plural, orgId]);

  if (state === 'loading' || state === 'hidden' || !canvas) return null;

  const { site } = canvas;
  const org: GalleryOrg = canvas.gallery ?? { orgName: site.orgName, city: null, region: null, venues: [] };
  const entries = galleryEntriesFor(site.side, site.sportKey);
  const shape = { hero_config: site.hero_config, contact_config: site.contact_config, visibility: site.visibility, modules: site.modules };
  const nav = parseNavConfig(site.nav_config);
  const tokens = parseThemeTokens(site.theme_token_set);
  const { accent, strong } = resolveAccentPair(tokens);
  const wordmark = tokens.wordmark?.trim() || site.orgName;
  const label = (key: string) => (isContentWidgetKey(key) ? WIDGETS[key as 'text'].defaultTitle ?? key : moduleLabel(key, nav, site.side, site.sportKey));
  const venueName = galleryMap(org)?.venueName ?? null;
  const editorHref = `/app/org/${side}/${orgId}/site/edit`;

  const use = async (entry: GalleryEntry) => {
    setBusyId(entry.id);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/site`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply_gallery', entryId: entry.id, mode: 'clean' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError('Website', body.error || 'Could not apply the design');
        return;
      }
      setApplied(entry);
      setState('applied');
    } catch {
      showError('Website', 'Could not apply the design');
    } finally {
      setBusyId(null);
    }
  };

  const takeLive = async () => {
    setGoingLive(true);
    try {
      const plan = publishPlan(false);
      const res = await fetch(`/api/${plural}/${orgId}/site`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });
      if (res.ok) {
        setLive(true);
        showSuccess('Website', plan.success);
        return;
      }
      if (res.status === 403) {
        showError('Website', plan.forbidden ?? 'Could not publish the site');
        return;
      }
      const body = await res.json().catch(() => ({}));
      showError('Website', body.error || 'Could not publish the site');
    } catch {
      showError('Website', 'Could not publish the site');
    } finally {
      setGoingLive(false);
    }
  };

  if (state === 'applied' && applied) {
    return (
      <section aria-label="Your site's design" className="rounded-xl border border-border bg-surface p-4 sm:p-5" data-welcome-design="applied">
        <p className="font-medium text-primary">{`Your site is arranged — ${applied.name}.`}</p>
        <p className="mt-0.5 text-sm text-secondary">
          {live
            ? 'It is live at your link. Every section still moves, resizes and can be removed in the editor.'
            : 'Saved to your draft. Take it live now, or open the editor to make it yours first.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {!live && (
            <button type="button" onClick={() => void takeLive()} disabled={goingLive} className={USE} data-welcome-design-live="">
              {goingLive ? 'Publishing…' : 'Take it live'}
            </button>
          )}
          <Link href={editorHref} className={PILL} data-welcome-design-editor="">
            Open the editor
          </Link>
          {!live && (
            <button type="button" onClick={() => setState('hidden')} className={PILL}>
              Later
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Pick a starting design" className="rounded-xl border border-border bg-surface p-4 sm:p-5" data-welcome-design="pick">
      <p className="font-medium text-primary">Pick a starting design for your site</p>
      <p className="mt-0.5 text-sm text-secondary">
        A sketch of the arrangement — your real sections, your name, your venue. Nothing goes live until you say so.
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {entries.map(entry => {
          const seed = gallerySeed(entry, { ...shape, template_id: entry.family }, org, site.side, site.sportKey);
          const family = templateSpec(entry.family);
          return (
            <li key={entry.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3" data-welcome-design-card={entry.id}>
              <GalleryThumb seed={seed} entry={entry} accent={accent} strong={strong} wordmark={wordmark} label={label} venueName={venueName} />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-primary">
                    {entry.name}{' '}
                    <span className="ml-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tertiary">{family.name}</span>
                  </p>
                  <p className="text-xs text-tertiary">{entry.blurb}</p>
                </div>
                <button type="button" onClick={() => void use(entry)} disabled={busyId !== null} className={USE} data-welcome-design-use="">
                  {busyId === entry.id ? 'Applying…' : 'Use this'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-tertiary">A design is a start — every section still moves, resizes and can be removed afterwards.</p>
        <button type="button" onClick={() => setState('hidden')} className={PILL} data-welcome-design-later="">
          Later
        </button>
      </div>
    </section>
  );
}
