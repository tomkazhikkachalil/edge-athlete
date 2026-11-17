'use client';

import Link from 'next/link';

/**
 * The headline tiles of a level (career or a season) — the sport's own profile tiles, computed over the counted games.
 * A tile with an `href` is a door (its stat's clips). A tile with nothing to say ("-": a track event never raced) is not drawn; a real zero is.
 */
export default function Tiles({ tiles }: { tiles: Array<{ label: string; value: string | null; href?: string | null }> }) {
  const shown = tiles.filter(t => t.value !== null && t.value.trim() !== '-' && t.value.trim() !== '–');
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-sport-tiles="">
      {shown.map(t => {
        const body = (
          <>
            <dt className="text-xs text-muted">{t.label}</dt>
            <dd className="text-2xl font-bold tabular-nums text-primary">{t.value}</dd>
            {t.href && <dd className="mt-0.5 text-xs font-semibold text-brand-fg">Watch the clips <span aria-hidden="true">›</span></dd>}
          </>
        );
        return t.href ? (
          <Link key={t.label} href={t.href} scroll={false} className="ea-surface ea-interactive block rounded-lg p-3" data-sport-tile-door={t.label}>{body}</Link>
        ) : (
          <div key={t.label} className="ea-surface rounded-lg p-3">{body}</div>
        );
      })}
    </dl>
  );
}
