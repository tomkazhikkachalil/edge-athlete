'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { MapPin, MoreHorizontal, Trophy, Users } from 'lucide-react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { orgSitePath } from '@/lib/org-sites/urls';
import type { OrgBrand } from '@/lib/org-sites/brand-types';
import { SIDE_COPY } from './side-copy';
import type { OrgInfo, OrgSide } from './types';

// The org page's hero — Org Pages R2 (Sep 8 2026), the first surface to
// carry the org's own media in the app. The public site's hero photo and
// logo, which every visitor already saw on the site (and which the
// tokenless streamers serve anonymously, draft or not), finally reach the
// page members actually live on. Band = the hero photo under the accent
// scrim, else the accent gradient (byte-identical to the old violet strip
// when a site sets no accent). The logo tile overlaps the band like a
// profile avatar; the name, chips and description keep their strings.
//
// Actions: from sm: up a wrapping pill row + a line of links (the same five
// controls the twins stacked on the right); below sm the join control
// stays and the rest move behind one "More actions" button that opens a
// LargerWindow — the bubble language's own sheet, not a second pattern.
// Different trees per width, so useIsDesktop (the chat-dock precedent)
// rather than duplicating the controls with CSS hiding.

interface OrgHeroProps {
  side: OrgSide;
  org: OrgInfo;
  brand: OrgBrand | null | undefined;
  sportLabels: string[];
  showSportChip: boolean;
  placeLine: string | null;
  memberCount: number;
  signedIn: boolean;
  viewerRole: string | null;
  viewerRequestPending: boolean;
  joinPolicy: 'open' | 'approval' | undefined;
  publishedSubdomain: string | null;
  canManage: boolean;
  isOwner: boolean;
  busy: boolean;
  onJoinOrLeave: () => void;
  onEdit: () => void;
  onShareJoinLink: () => void;
}

const PILL = 'px-4 py-2 text-sm min-h-[40px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors';

export default function OrgHero({
  side,
  org,
  brand,
  sportLabels,
  showSportChip,
  placeLine,
  memberCount,
  signedIn,
  viewerRole,
  viewerRequestPending,
  joinPolicy,
  publishedSubdomain,
  canManage,
  isOwner,
  busy,
  onJoinOrLeave,
  onEdit,
  onShareJoinLink,
}: OrgHeroProps) {
  const copy = SIDE_COPY[side];
  const wide = useIsDesktop('(min-width: 640px)');
  const [moreOpen, setMoreOpen] = useState(false);

  const heroImage = brand?.hero.imageUrl ?? null;
  const logoUrl = brand?.logoUrl ?? null;
  const tagline = brand?.hero.tagline ?? '';
  // Links take the derived, theme-readable accent tint when the site sets
  // one (stamped as --org-accent-fg by OrgPage); otherwise the house brand.
  const linkClass = brand?.accent
    ? 'text-sm font-medium text-[var(--org-accent-fg)] hover:underline'
    : 'text-sm text-brand-fg hover:text-brand-fg-strong hover:underline';

  const joinControl = signedIn ? (
    viewerRole === 'owner' ? (
      <button
        type="button"
        disabled
        className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-surface-sunken text-muted cursor-default"
      >
        Owner
      </button>
    ) : (
      <button
        type="button"
        onClick={onJoinOrLeave}
        disabled={busy}
        className={`px-4 py-2 text-sm min-h-[40px] rounded-lg font-medium transition-colors disabled:opacity-60 ${
          viewerRole || viewerRequestPending
            ? 'border border-border-strong text-secondary hover:bg-surface-sunken'
            : 'bg-brand text-white hover:bg-brand-hover'
        }`}
      >
        {viewerRole
          ? `Leave ${copy.noun}`
          : viewerRequestPending
            ? 'Request sent · withdraw'
            : joinPolicy === 'approval'
              ? 'Request to join'
              : `Join ${copy.noun}`}
      </button>
    )
  ) : null;

  // The secondary controls, rendered as pills on a wide screen and as rows
  // in the phone sheet — same accessible names either way.
  const secondary: Array<{ key: string; node: (rowClass: string) => ReactNode }> = [];
  if (canManage) {
    secondary.push({
      key: 'edit',
      node: cls => (
        <button type="button" onClick={onEdit} className={cls}>
          Edit {copy.noun}
        </button>
      ),
    });
    secondary.push({
      key: 'share',
      node: cls => (
        <button type="button" onClick={onShareJoinLink} className={cls}>
          Share join link
        </button>
      ),
    });
  }
  const links: Array<{ key: string; href: string; label: ReactNode }> = [];
  {/* Phase 6b A1: the two doors this page lacked — the org's public site
      (published only) and its console. */}
  if (publishedSubdomain) links.push({ key: 'site', href: orgSitePath(publishedSubdomain), label: 'Public site →' });
  if (canManage) links.push({ key: 'manage', href: `/app/org/${side}/${org.id}`, label: `Manage ${copy.noun} →` });
  {/* Org staff program (178): owners' door to who-runs-what + invites. */}
  if (isOwner) links.push({ key: 'staff', href: `/app/org/${side}/${org.id}#hierarchy`, label: <>Staff &amp; hierarchy →</> });

  const hasMore = secondary.length > 0 || links.length > 0;

  return (
    <div className="ea-bubble ea-pop-in overflow-hidden" data-org-hero={heroImage ? 'photo' : 'band'}>
      <div className="relative h-32 sm:h-44 org-app-band">
        {heroImage && (
          <>
            {/* A site asset through the tokenless streamer — /api/media/* is
                never optimizer-eligible (the image policy), so a bare img. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- org-media rides the tokenless streamer, not next/image */}
            <img
              src={heroImage}
              alt={brand?.hero.imageAlt ?? ''}
              className="absolute inset-0 h-full w-full object-cover"
              data-org-hero-image=""
            />
            <div aria-hidden="true" className="absolute inset-0 org-app-band-scrim" />
          </>
        )}
      </div>
      <div className="px-4 sm:px-6 pb-5">
        <div className="-mt-8 sm:-mt-10 flex items-end justify-between gap-3">
          <div
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white border border-border-subtle shadow-md overflow-hidden flex items-center justify-center shrink-0"
            data-org-logo={logoUrl ? 'image' : 'initial'}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- org-logo rides the tokenless streamer, not next/image
              <img src={logoUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="text-2xl sm:text-3xl font-black text-violet-700" aria-hidden="true">
                {org.name.trim().charAt(0).toUpperCase() || '·'}
              </span>
            )}
          </div>
          {brand && !brand.published && canManage && (
            <span
              className="mb-1 inline-flex items-center rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-muted"
              data-site-draft=""
            >
              Site draft
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-primary break-words">{org.name}</h1>
            {tagline && <p className="mt-1 text-sm text-tertiary">{tagline}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-tertiary">
              {showSportChip && (
                <span className="inline-flex items-center gap-1">
                  <Trophy className="w-4 h-4" />
                  {sportLabels.join(' · ')}
                </span>
              )}
              {placeLine && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-4 h-4" />
                  {placeLine}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Users className="w-4 h-4" />
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </span>
            </div>
            {org.description && (
              <p className="mt-3 text-secondary max-w-xl whitespace-pre-wrap">{org.description}</p>
            )}
          </div>

          {wide ? (
            <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {joinControl}
                {secondary.map(s => (
                  <span key={s.key} className="contents">{s.node(PILL)}</span>
                ))}
              </div>
              {links.length > 0 && (
                <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                  {links.map(l => (
                    <Link key={l.key} href={l.href} className={linkClass}>
                      {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {joinControl}
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setMoreOpen(true)}
                  aria-label="More actions"
                  aria-haspopup="dialog"
                  className="ea-icon-btn inline-flex items-center justify-center text-secondary"
                >
                  <MoreHorizontal className="w-5 h-5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {moreOpen && (
        <LargerWindow title="More" windowKey="hero-actions" onClose={() => setMoreOpen(false)}>
          <div className="flex flex-col gap-2">
            {secondary.map(s => (
              <span key={s.key} className="contents" onClick={() => setMoreOpen(false)}>
                {s.node(`${PILL} w-full text-left min-h-[44px]`)}
              </span>
            ))}
            {links.map(l => (
              <Link
                key={l.key}
                href={l.href}
                onClick={() => setMoreOpen(false)}
                className={`${linkClass} flex min-h-[44px] items-center px-1`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </LargerWindow>
      )}
    </div>
  );
}
