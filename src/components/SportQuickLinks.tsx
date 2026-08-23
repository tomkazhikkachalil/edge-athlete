'use client';

import Link from 'next/link';
import { getSportAdapter } from '@/lib/sports';
import { resolveSportKey } from '@/lib/sports/resolve-sport-key';
import { getSportDefinition } from '@/lib/sports/SportRegistry';

/**
 * Link chips to a sport's dedicated pages (rounds list, trends, …).
 *
 * The routes come from the sport adapter's `getNavLinks()` — the same
 * declaration `MultiSportActivity` used to consume before it was orphaned —
 * so nothing here hardcodes a sport's pages, and a sport without dedicated
 * pages renders nothing. That made these pages reachable only by direct URL;
 * this component is their entry point (own profile + feed sidebar).
 */
interface SportQuickLinksProps {
  /** The athlete's sport, as stored on the profile (display name or key). */
  sport: string | null | undefined;
  /** 'chips' = inline row (profile header); 'card' = sidebar card (feed). */
  variant?: 'chips' | 'card';
}

export default function SportQuickLinks({ sport, variant = 'chips' }: SportQuickLinksProps) {
  const key = resolveSportKey(sport);
  if (!key) return null;

  let links: { href: string; label: string }[];
  try {
    links = getSportAdapter(key).getNavLinks();
  } catch {
    // 'training' (deliberately adapter-less) and anything unregistered.
    return null;
  }
  if (links.length === 0) return null;

  const chips = (
    <div className="flex flex-wrap gap-2">
      {links.map(link => (
        <Link
          key={link.href}
          href={link.href}
          className="ea-interactive inline-flex min-h-[40px] items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-brand-fg"
        >
          {link.label}
        </Link>
      ))}
    </div>
  );

  if (variant === 'card') {
    return (
      <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
        <h3 className="font-bold text-primary mb-3">
          <i className={`${getSportDefinition(key).icon_id} mr-2 text-brand-fg`} aria-hidden="true"></i>
          Your {getSportDefinition(key).display_name}
        </h3>
        {chips}
      </div>
    );
  }
  return chips;
}
